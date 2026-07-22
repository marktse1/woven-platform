import { auth } from "@clerk/nextjs/server";
import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSiteUrl } from "@/lib/siteUrl";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  if (!supabase) return Response.json({ error: "Server error" }, { status: 500 });

  // Load existing connect account if any
  const { data: profile } = await supabase
    .from("creator_profiles")
    .select("stripe_account_id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ stripe_account_id: string | null }>();

  let accountId = profile?.stripe_account_id ?? null;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      metadata: { clerk_user_id: userId },
    });
    accountId = account.id;
    await supabase
      .from("creator_profiles")
      .update({ stripe_account_id: accountId })
      .eq("clerk_user_id", userId);
  }

  const origin = getSiteUrl();
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    return_url: `${origin}/dashboard?connect=success`,
    refresh_url: `${origin}/dashboard?connect=refresh`,
  });

  return Response.json({ url: link.url });
}
