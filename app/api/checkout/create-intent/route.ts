import { auth } from "@clerk/nextjs/server";
import { stripe } from "@/lib/stripe";

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

  const intent = await stripe.paymentIntents.create({
    amount: priceCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    metadata: { clerk_user_id: userId, game_id: gameId },
  });

  return Response.json({ clientSecret: intent.client_secret });
}
