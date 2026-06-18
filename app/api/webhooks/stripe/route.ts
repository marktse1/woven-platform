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
    // Game purchase completed
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const { clerk_user_id, game_id } = intent.metadata ?? {};
      if (clerk_user_id && game_id && supabase) {
        await supabase.from("user_library").upsert({
          clerk_user_id,
          game_id,
          source: "purchase",
          stripe_payment_intent_id: intent.id,
        }, { onConflict: "clerk_user_id,game_id" });
      }
      break;
    }

    // Pass subscription created or updated
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const clerk_user_id = sub.metadata?.clerk_user_id;
      if (clerk_user_id && supabase) {
        await supabase.from("pass_subscriptions").upsert({
          clerk_user_id,
          stripe_subscription_id: sub.id,
          stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
          status: sub.status,
          trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        }, { onConflict: "clerk_user_id" });
      }
      break;
    }

    // Pass subscription cancelled
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const clerk_user_id = sub.metadata?.clerk_user_id;
      if (clerk_user_id && supabase) {
        await supabase
          .from("pass_subscriptions")
          .update({ status: "canceled" })
          .eq("clerk_user_id", clerk_user_id);
      }
      break;
    }
  }

  return Response.json({ received: true });
}
