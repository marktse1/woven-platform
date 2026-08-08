import { Suspense } from "react";
import type { Metadata } from "next";
import MeshSculptClient from "./MeshSculptClient";

export const dynamic = "force-dynamic";

const title = "Mesh Sculptor — Free Browser 3D Sculpting & Rigging Tool | Woven";
const description = "Sculpt, paint, rig, and pose 3D characters and props directly in your browser — no software to install. Export as GLB for your games.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export default function MeshSculptorPage() {
  return (
    <Suspense
      fallback={
        <main className="tool-min-h bg-[#0c0a08] text-ink flex items-center justify-center">
          <div className="text-[13px] text-dim">Loading Mesh Sculptor…</div>
        </main>
      }
    >
      <MeshSculptClient />
    </Suspense>
  );
}
