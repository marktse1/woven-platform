"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { getMyCreatorProfile, type CreatorProfileRow } from "@/lib/games";

/** The signed-in user's own approved studio profile, or null if they don't
 * have one — the gate for showing a "post as studio" toggle on the
 * Discussion board and Community Feed. Not "pending"/"rejected": only an
 * approved studio can post under its own identity. */
export function useMyStudio(): CreatorProfileRow | null {
  const { user, isLoaded } = useUser();
  const [studio, setStudio] = useState<CreatorProfileRow | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!isLoaded || !user?.id) return;
      try {
        const p = await getMyCreatorProfile(user.id);
        if (active && p?.status === "approved") setStudio(p);
      } catch {
        // no studio, or the fetch failed — just means no toggle shows
      }
    }
    load();
    return () => { active = false; };
  }, [isLoaded, user?.id]);

  return studio;
}
