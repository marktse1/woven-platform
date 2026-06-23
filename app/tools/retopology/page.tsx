import { Suspense } from "react";
import RetopologyClient from "./RetopologyClient";

export const dynamic = "force-dynamic";

export default function RetopologyPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink flex items-center justify-center">
          <div className="text-[13px] text-dim">Loading Mesh Loom…</div>
        </main>
      }
    >
      <RetopologyClient />
    </Suspense>
  );
}
