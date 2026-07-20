import { Suspense } from "react";
import WorldBuilderClient from "./WorldBuilderClient";

export const dynamic = "force-dynamic";

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
