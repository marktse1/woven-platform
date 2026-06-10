import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

  browserSupabase = createClient(supabaseUrl, supabaseAnonKey);
  return browserSupabase;
}
