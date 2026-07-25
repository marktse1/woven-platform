import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type Stripe from "stripe";

// Disable body parsing — Stripe needs the raw body to verify signature
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "Missing signature or secret" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  switch (event.type) {
    // Game or asset purchase completed
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const { clerk_user_id, game_id, asset_id } = intent.metadata ?? {};
      if (clerk_user_id && game_id && supabase) {
        await supabase.from("user_library").upsert({
          clerk_user_id,
          game_id,
          source: "purchase",
          stripe_payment_intent_id: intent.id,
          payment_intent_id: intent.id,
          // If transfer_data is set, creator was paid immediately; otherwise held
          creator_paid_out: !!intent.transfer_data?.destination,
          creator_amount_cents: Math.round(intent.amount * 0.80),
        }, { onConflict: "clerk_user_id,game_id" });
      } else if (clerk_user_id && asset_id && supabase) {
        await supabase.from("marketplace_purchases").upsert({
          clerk_user_id,
          item_type: "asset",
          item_id: asset_id,
          price_paid_cents: intent.amount,
          stripe_payment_intent_id: intent.id,
          creator_paid_out: !!intent.transfer_data?.destination,
          creator_amount_cents: Math.round(intent.amount * 0.80),
        }, { onConflict: "clerk_user_id,item_type,item_id" });
      }
      break;
    }

    // Creator's Stripe Connect account updated — sync charges_enabled flag
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const clerk_user_id = (account.metadata as Record<string, string> | null)?.clerk_user_id;
      if (clerk_user_id && supabase) {
        await supabase
          .from("creator_profiles")
          .update({ stripe_charges_enabled: account.charges_enabled })
          .eq("stripe_account_id", account.id);
      }
      break;
    }
  }

  return Response.json({ received: true });
}
