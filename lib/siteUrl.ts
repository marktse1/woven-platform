// Single source of truth for the site's real public URL. Previously
// app/api/stripe/connect/onboard/route.ts had its own inline fallback of
// "https://woven.gg" — a domain that isn't configured in Vercel and isn't
// the live site (wovengames.app) — so creator Stripe onboarding redirects
// were pointing at the wrong domain whenever NEXT_PUBLIC_APP_URL was unset,
// which it is in production today (confirmed via `vercel env ls`).
export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://wovengames.app";
}
