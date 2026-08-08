import { Suspense } from "react";
import type { Metadata } from "next";
import WorldBuilderClient from "./WorldBuilderClient";

export const dynamic = "force-dynamic";

const title = "World Builder — Build 3D Game Worlds in Your Browser | Woven";
const description = "Design terrain, roads, lighting, and place objects to build real-time 3D game worlds — all in your browser, no software to install.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export default function WorldBuilderPage() {
  return (
    <Suspense
      fallback={
        <main className="tool-min-h bg-[#0b0f14] text-ink flex items-center justify-center">
          <div className="text-[13px] text-dim">Loading Three.js World Builder…</div>
        </main>
      }
    >
      <WorldBuilderClient />
    </Suspense>
  );
}
