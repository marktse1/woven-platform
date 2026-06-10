import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserSupabase: SupabaseClient | null = null;

export function getSupabaseClient() {
  if (browserSupabase) return browserSupabase;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return null;

  browserSupabase = createClient(supabaseUrl, supabaseAnonKey);
  return browserSupabase;
}
