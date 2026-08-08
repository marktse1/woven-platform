import { Suspense } from "react";
import type { Metadata } from "next";
import ShaderadeClient from "./ShaderadeClient";

export const dynamic = "force-dynamic";

const title = "Shaderade — Node-Based Shader Editor in Your Browser | Woven";
const description = "Create custom materials and shaders with a visual node editor, right in your browser — no software to install.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export default function ShaderadePage() {
  return (
    <Suspense
      fallback={
        <main className="tool-min-h bg-[#0e0b08] text-ink flex items-center justify-center">
          <div className="text-[13px] text-dim">Loading Shaderade…</div>
        </main>
      }
    >
      <ShaderadeClient />
    </Suspense>
  );
}
