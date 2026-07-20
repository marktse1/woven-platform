"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useCreatorStatus } from "@/lib/useCreatorStatus";

// The editor owns its entire UI (panels, toolbars, canvas) as a single
// imperative DOM subtree — see components/tools/WorldBuilderViewer.tsx for
// why that's mounted whole rather than split into React-driven chrome the
// way MeshSculptClient.tsx splits sidebar state from SculptViewer's canvas.
const WorldBuilderViewer = dynamic(() => import("@/components/tools/WorldBuilderViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-dim text-[13px]">
      Initialising 3D canvas…
    </div>
  ),
});

export default function WorldBuilderClient() {
  const { user, isLoaded } = useUser();
  const creatorStatus = useCreatorStatus();

  if (!isLoaded || creatorStatus === "loading") return null;

  if (!user) {
    return (
      <main className="tool-min-h bg-[#0b0f14] flex items-center justify-center">
        <div className="text-center">
          <p className="text-dim text-sm mb-4">Sign in to use the World Builder.</p>
          <Link href="/sign-in" className="px-4 py-2 bg-accent text-white rounded-md text-sm">Sign in</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="tool-h bg-[#0b0f14]">
      <WorldBuilderViewer userId={user.id} />
    </main>
  );
}
