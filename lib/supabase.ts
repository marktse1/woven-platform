import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Clerk's browser SDK (which @clerk/nextjs wraps) always exposes the active
// session on window.Clerk once loaded — this is the supported way to reach
// Clerk imperatively outside of a React render, which is what we need here:
// getSupabaseClient() is a plain module-level singleton called from ~30
// non-hook async functions across lib/assets.ts and friends, not a hook
// itself, so it can't call useSession() directly. Using the global instead
// of threading a session object through every call site keeps this a
// one-file change instead of a call-site rewrite everywhere Supabase is used.
declare global {
  interface Window {
    Clerk?: {
      session?: {
        getToken(): Promise<string | null>;
      } | null;
    };
  }
}

let browserSupabase: SupabaseClient | null = null;

type SupabaseEnvStatus = {
  ok: boolean;
  missing: Array<"NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY">;
};

export function getSupabaseEnvStatus(): SupabaseEnvStatus {
  const missing: SupabaseEnvStatus["missing"] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { ok: missing.length === 0, missing };
}

export function getSupabaseClient() {
  if (browserSupabase) return browserSupabase;
  const { ok } = getSupabaseEnvStatus();
  if (!ok) return null;
  browserSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      // Called by supabase-js on every request — always returns the
      // *current* Clerk session's token (short-lived, auto-rotated by
      // Clerk), not a token captured once at client-construction time.
      // No JWT template name needed: Clerk's native Supabase integration
      // (the JWT-template method was deprecated April 2025) verifies this
      // token directly. See supabase/migrations/0018_creator_assets_rls.sql
      // for the RLS policies that depend on this.
      accessToken: async () => {
        const token = await window.Clerk?.session?.getToken();
        return token ?? null;
      },
    },
  );
  return browserSupabase;
}

// Lazy proxy — defers createClient until first use so the module can be
// imported at build time before env vars are available.
export const supabase = new Proxy(
  {} as NonNullable<ReturnType<typeof getSupabaseClient>>,
  {
    get(_, prop) {
      const client = getSupabaseClient();
      if (!client) throw new Error("Supabase env vars not configured");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (client as any)[prop];
    },
  }
);
