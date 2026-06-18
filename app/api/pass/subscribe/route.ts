import { auth } from "@clerk/nextjs/server";
import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type Stripe from "stripe";

// Lazily find or create the Woven Pass product in Stripe
let _passProductId: string | null = null;

async function getOrCreatePassProduct(): Promise<string> {
  if (_passProductId) return _passProductId;
  if (process.env.STRIPE_PASS_PRODUCT_ID) {
    _passProductId = process.env.STRIPE_PASS_PRODUCT_ID;
    return _passProductId;
  }

  const existing = await stripe.products.search({
    query: 'name:"Woven Pass" AND active:"true"',
    limit: 1,
  });

  if (existing.data.length > 0) {
    _passProductId = existing.data[0].id;
  } else {
    const product = await stripe.products.create({
      name: "Woven Pass",
      description: "All-you-can-play monthly subscription — 400+ games included.",
    });
    _passProductId = product.id;
  }

  return _passProductId;
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if already subscribed
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data: existing } = await supabase
      .from("pass_subscriptions")
      .select("status, stripe_subscription_id")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (existing && ["active", "trialing"].includes(existing.status ?? "")) {
      return Response.json({ error: "Already subscribed" }, { status: 409 });
    }
  }

  const productId = await getOrCreatePassProduct();

  // Create a Stripe customer for this user
  const customer = await stripe.customers.create({
    metadata: { clerk_user_id: userId },
  });

  // Create a subscription with 14-day trial — no charge today
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{
      price_data: {
        currency: "usd",
        product: productId,
        recurring: { interval: "month" },
        unit_amount: 999,
      },
    }],
    trial_period_days: 14,
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["pending_setup_intent"],
    metadata: { clerk_user_id: userId },
  });

  const setupIntent = subscription.pending_setup_intent as Stripe.SetupIntent | null;
  if (!setupIntent?.client_secret) {
    return Response.json({ error: "Could not create setup intent" }, { status: 500 });
  }

  return Response.json({
    clientSecret: setupIntent.client_secret,
    subscriptionId: subscription.id,
    customerId: customer.id,
  });
}
