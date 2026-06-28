import { Suspense } from "react";
import SubstanceWeaverClient from "./SubstanceWeaverClient";

export const dynamic = "force-dynamic";

export default function SubstanceWeaverPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink flex items-center justify-center">
          <div className="text-[13px] text-dim">Loading Mesh Painter…</div>
        </main>
      }
    >
      <SubstanceWeaverClient />
    </Suspense>
  );
}
