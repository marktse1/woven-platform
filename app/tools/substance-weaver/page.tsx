import { Suspense } from "react";
import type { Metadata } from "next";
import SubstanceWeaverClient from "./SubstanceWeaverClient";

export const dynamic = "force-dynamic";

const title = "Mesh Painter — Texture & Paint 3D Models in Your Browser | Woven";
const description = "Paint PBR textures — color, roughness, and metalness — directly onto your 3D models in your browser, no software to install.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export default function SubstanceWeaverPage() {
  return (
    <Suspense
      fallback={
        <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center">
          <div className="text-[13px] text-dim">Loading Mesh Painter…</div>
        </main>
      }
    >
      <SubstanceWeaverClient />
    </Suspense>
  );
}
