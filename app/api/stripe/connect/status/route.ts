import { auth } from "@clerk/nextjs/server";
import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

// Sums pending (not yet paid out) earnings across both games (user_library,
// joined via creator_profiles.id) and creator-asset sales
// (marketplace_purchases, joined via clerk_user_id directly — creator_assets
// has no creator_profiles.id FK the way games.creator_id does).
async function pendingEarningsCents(supabase: SupabaseAdmin, profileId: string, clerkUserId: string): Promise<number> {
  let total = 0;

  const { data: games } = await supabase.from("games").select("id").eq("creator_id", profileId);
  const gameIds = (games ?? []).map((g: { id: string }) => g.id);
  if (gameIds.length > 0) {
    const { data: pending } = await supabase
      .from("user_library")
      .select("creator_amount_cents")
      .in("game_id", gameIds)
      .eq("creator_paid_out", false)
      .not("creator_amount_cents", "is", null);
    total += (pending ?? []).reduce((sum: number, r: { creator_amount_cents: number }) => sum + (r.creator_amount_cents ?? 0), 0);
  }

  const { data: assets } = await supabase.from("creator_assets").select("id").eq("clerk_user_id", clerkUserId);
  const assetIds = (assets ?? []).map((a: { id: string }) => a.id);
  if (assetIds.length > 0) {
    const { data: pending } = await supabase
      .from("marketplace_purchases")
      .select("creator_amount_cents")
      .eq("item_type", "asset")
      .in("item_id", assetIds)
      .eq("creator_paid_out", false)
      .not("creator_amount_cents", "is", null);
    total += (pending ?? []).reduce((sum: number, r: { creator_amount_cents: number }) => sum + (r.creator_amount_cents ?? 0), 0);
  }

  return total;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return Response.json({ error: "Server error" }, { status: 500 });

  const { data: profile } = await supabase
    .from("creator_profiles")
    .select("id, stripe_account_id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string; stripe_account_id: string | null }>();

  if (!profile?.stripe_account_id) {
    // Sum pending earnings even without a connect account yet
    const pendingCents = profile?.id ? await pendingEarningsCents(supabase, profile.id, userId) : 0;
    return Response.json({ status: "not_started", pending_cents: pendingCents });
  }

  const account = await stripe.accounts.retrieve(profile.stripe_account_id);
  const status = account.charges_enabled ? "active" : "pending";

  const pendingCents = profile.id ? await pendingEarningsCents(supabase, profile.id, userId) : 0;

  return Response.json({
    status,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    pending_cents: pendingCents,
    express_dashboard_url: "https://connect.stripe.com/express_login",
  });
}
