import { auth } from "@clerk/nextjs/server";
import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { gameId, assetId, priceCents } = body as { gameId?: string; assetId?: string; priceCents?: number };

  const supabase = getSupabaseAdmin();

  let creatorAccountId: string | null = null;
  let creatorChargesEnabled = false;
  let amountCents: number;
  let metadata: Record<string, string>;

  if (assetId) {
    // Asset purchases derive the charge amount from the asset's own
    // price_cents server-side — never from a client-sent value, unlike the
    // games path below (which trusts priceCents as-is; not touching that
    // existing behavior, just not repeating it here).
    if (!supabase) return Response.json({ error: "Server error" }, { status: 500 });

    const { data: asset } = await supabase
      .from("creator_assets")
      .select("clerk_user_id, price_cents, visibility")
      .eq("id", assetId)
      .maybeSingle<{ clerk_user_id: string; price_cents: number; visibility: string }>();

    if (!asset || asset.visibility !== "sellable") {
      return Response.json({ error: "This asset isn't for sale" }, { status: 400 });
    }
    if (asset.price_cents < 50) {
      return Response.json({ error: "Invalid price" }, { status: 400 });
    }

    amountCents = asset.price_cents;
    metadata = { clerk_user_id: userId, asset_id: assetId };

    const { data: creatorProfile } = await supabase
      .from("creator_profiles")
      .select("stripe_account_id, stripe_charges_enabled")
      .eq("clerk_user_id", asset.clerk_user_id)
      .maybeSingle<{ stripe_account_id: string | null; stripe_charges_enabled: boolean }>();

    creatorAccountId = creatorProfile?.stripe_account_id ?? null;
    creatorChargesEnabled = creatorProfile?.stripe_charges_enabled ?? false;
  } else {
    if (!gameId || typeof priceCents !== "number" || priceCents < 50) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    amountCents = priceCents;
    metadata = { clerk_user_id: userId, game_id: gameId };

    // Look up the game's creator and their Stripe Connect status
    if (supabase) {
      const { data: game } = await supabase
        .from("games")
        .select("creator_id")
        .eq("id", gameId)
        .maybeSingle<{ creator_id: string }>();

      if (game?.creator_id) {
        const { data: creatorProfile } = await supabase
          .from("creator_profiles")
          .select("stripe_account_id, stripe_charges_enabled")
          .eq("id", game.creator_id)
          .maybeSingle<{ stripe_account_id: string | null; stripe_charges_enabled: boolean }>();

        creatorAccountId = creatorProfile?.stripe_account_id ?? null;
        creatorChargesEnabled = creatorProfile?.stripe_charges_enabled ?? false;
      }
    }
  }

  const intentParams: Parameters<typeof stripe.paymentIntents.create>[0] = {
    amount: amountCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    metadata,
  };

  // If creator has a connected Stripe account, split automatically
  if (creatorAccountId && creatorChargesEnabled) {
    intentParams.application_fee_amount = Math.round(amountCents * 0.20);
    intentParams.transfer_data = { destination: creatorAccountId };
  }
  // Otherwise: full amount goes to platform; webhook tracks for later manual transfer

  const intent = await stripe.paymentIntents.create(intentParams);

  return Response.json({ clientSecret: intent.client_secret });
}
