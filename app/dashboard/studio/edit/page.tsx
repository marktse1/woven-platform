"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Studio Profile merged into /dashboard as a tab (see
// components/dashboard/StudioProfileSection.tsx) — this route stays alive
// as a redirect so anything already linking or bookmarked here still lands
// somewhere sane.
export default function EditStudioPageRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard?tab=studio");
  }, [router]);
  return (
    <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center">
      <div className="text-[13px] text-dim">Redirecting…</div>
    </main>
  );
}
