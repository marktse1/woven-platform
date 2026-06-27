import { auth } from "@clerk/nextjs/server";
import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return Response.json({ error: "Server error" }, { status: 500 });

  const { data: profile } = await supabase
    .from("creator_profiles")
    .select("id, stripe_account_id, stripe_charges_enabled")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string; stripe_account_id: string | null; stripe_charges_enabled: boolean }>();

  if (!profile?.stripe_account_id || !profile.stripe_charges_enabled) {
    return Response.json({ transferred: 0, total_cents: 0 });
  }

  const { data: games } = await supabase
    .from("games")
    .select("id")
    .eq("creator_id", profile.id);
  const gameIds = (games ?? []).map((g: { id: string }) => g.id);
  if (gameIds.length === 0) return Response.json({ transferred: 0, total_cents: 0 });

  const { data: rows } = await supabase
    .from("user_library")
    .select("id, payment_intent_id, creator_amount_cents")
    .in("game_id", gameIds)
    .eq("creator_paid_out", false)
    .not("payment_intent_id", "is", null)
    .not("creator_amount_cents", "is", null);

  let transferred = 0;
  let totalCents = 0;

  for (const row of rows ?? []) {
    try {
      // Retrieve the charge ID from the payment intent
      const intent = await stripe.paymentIntents.retrieve(row.payment_intent_id, {
        expand: ["latest_charge"],
      });
      const charge = intent.latest_charge;
      const chargeId = typeof charge === "string" ? charge : charge?.id;
      if (!chargeId) continue;

      await stripe.transfers.create({
        amount: row.creator_amount_cents,
        currency: "usd",
        destination: profile.stripe_account_id!,
        source_transaction: chargeId,
      });

      await supabase
        .from("user_library")
        .update({ creator_paid_out: true })
        .eq("id", row.id);

      transferred++;
      totalCents += row.creator_amount_cents;
    } catch {
      // Skip rows that fail (already transferred, charge not found, etc.)
    }
  }

  return Response.json({ transferred, total_cents: totalCents });
}
