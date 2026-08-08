import { Suspense } from "react";
import type { Metadata } from "next";
import RetopologyClient from "./RetopologyClient";

export const dynamic = "force-dynamic";

const title = "Mesh Loom — Browser-Based 3D Retopology & Decimation | Woven";
const description = "Clean up and retopologize high-poly 3D models into game-ready meshes right in your browser — no software to install.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export default function RetopologyPage() {
  return (
    <Suspense
      fallback={
        <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center">
          <div className="text-[13px] text-dim">Loading Mesh Loom…</div>
        </main>
      }
    >
      <RetopologyClient />
    </Suspense>
  );
}
