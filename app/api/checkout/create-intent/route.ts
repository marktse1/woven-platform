import { auth } from "@clerk/nextjs/server";
import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { gameId, priceCents } = body as { gameId: string; priceCents: number };

  if (!gameId || typeof priceCents !== "number" || priceCents < 50) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Look up the game's creator and their Stripe Connect status
  let creatorAccountId: string | null = null;
  let creatorChargesEnabled = false;

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

  const intentParams: Parameters<typeof stripe.paymentIntents.create>[0] = {
    amount: priceCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    metadata: { clerk_user_id: userId, game_id: gameId },
  };

  // If creator has a connected Stripe account, split automatically
  if (creatorAccountId && creatorChargesEnabled) {
    intentParams.application_fee_amount = Math.round(priceCents * 0.12);
    intentParams.transfer_data = { destination: creatorAccountId };
  }
  // Otherwise: full amount goes to platform; webhook tracks for later manual transfer

  const intent = await stripe.paymentIntents.create(intentParams);

  return Response.json({ clientSecret: intent.client_secret });
}
