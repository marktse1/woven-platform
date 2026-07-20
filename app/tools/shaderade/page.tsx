import { Suspense } from "react";
import ShaderadeClient from "./ShaderadeClient";

export const dynamic = "force-dynamic";

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
