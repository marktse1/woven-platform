import { getSupabaseClient } from "./supabase";

export async function getAutoApproveCreators(): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "auto_approve_creators")
    .maybeSingle();
  return data?.value === true;
}

export async function setAutoApproveCreators(value: boolean): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase
    .from("platform_settings")
    .upsert({ key: "auto_approve_creators", value, updated_at: new Date().toISOString() });
  if (error) throw error;
}
