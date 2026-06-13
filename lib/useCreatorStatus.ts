"use client";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { getSupabaseClient } from "@/lib/supabase";

export type CreatorStatus = "loading" | "none" | "pending" | "approved" | "rejected";

export function useCreatorStatus(): CreatorStatus {
  const { user, isLoaded } = useUser();
  const [status, setStatus] = useState<CreatorStatus>("loading");

  useEffect(() => {
    if (!isLoaded) return;
    if (!user?.id) { setStatus("none"); return; }
    const supabase = getSupabaseClient();
    if (!supabase) { setStatus("none"); return; }
    supabase
      .from("creator_profiles")
      .select("status")
      .eq("clerk_user_id", user.id)
      .maybeSingle<{ status: "pending" | "approved" | "rejected" }>()
      .then(({ data }) => setStatus(data?.status ?? "none"));
  }, [isLoaded, user?.id]);

  return status;
}
