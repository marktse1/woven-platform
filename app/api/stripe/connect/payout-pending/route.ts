import { auth } from "@clerk/nextjs/server";
import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

async function transferRows(
  supabase: SupabaseAdmin,
  destination: string,
  rows: { id: string; payment_intent_id: string | null; creator_amount_cents: number | null }[],
  table: "user_library" | "marketplace_purchases",
): Promise<{ transferred: number; totalCents: number }> {
  let transferred = 0;
  let totalCents = 0;

  for (const row of rows) {
    if (!row.payment_intent_id || row.creator_amount_cents == null) continue;
    try {
      const intent = await stripe.paymentIntents.retrieve(row.payment_intent_id, { expand: ["latest_charge"] });
      const charge = intent.latest_charge;
      const chargeId = typeof charge === "string" ? charge : charge?.id;
      if (!chargeId) continue;

      await stripe.transfers.create({
        amount: row.creator_amount_cents,
        currency: "usd",
        destination,
        source_transaction: chargeId,
      });

      await supabase.from(table).update({ creator_paid_out: true }).eq("id", row.id);

      transferred++;
      totalCents += row.creator_amount_cents;
    } catch {
      // Skip rows that fail (already transferred, charge not found, etc.)
    }
  }

  return { transferred, totalCents };
}

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

  let transferred = 0;
  let totalCents = 0;

  const { data: games } = await supabase.from("games").select("id").eq("creator_id", profile.id);
  const gameIds = (games ?? []).map((g: { id: string }) => g.id);
  if (gameIds.length > 0) {
    const { data: rows } = await supabase
      .from("user_library")
      .select("id, payment_intent_id, creator_amount_cents")
      .in("game_id", gameIds)
      .eq("creator_paid_out", false)
      .not("payment_intent_id", "is", null)
      .not("creator_amount_cents", "is", null);
    const result = await transferRows(supabase, profile.stripe_account_id, rows ?? [], "user_library");
    transferred += result.transferred;
    totalCents += result.totalCents;
  }

  const { data: assets } = await supabase.from("creator_assets").select("id").eq("clerk_user_id", userId);
  const assetIds = (assets ?? []).map((a: { id: string }) => a.id);
  if (assetIds.length > 0) {
    const { data: rows } = await supabase
      .from("marketplace_purchases")
      .select("id, stripe_payment_intent_id, creator_amount_cents")
      .eq("item_type", "asset")
      .in("item_id", assetIds)
      .eq("creator_paid_out", false)
      .not("stripe_payment_intent_id", "is", null)
      .not("creator_amount_cents", "is", null);
    const mapped = (rows ?? []).map((r) => ({ id: r.id, payment_intent_id: r.stripe_payment_intent_id, creator_amount_cents: r.creator_amount_cents }));
    const result = await transferRows(supabase, profile.stripe_account_id, mapped, "marketplace_purchases");
    transferred += result.transferred;
    totalCents += result.totalCents;
  }

  return Response.json({ transferred, total_cents: totalCents });
}
