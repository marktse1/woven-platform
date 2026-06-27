import { Suspense } from "react";
import MeshSculptClient from "./MeshSculptClient";

export const dynamic = "force-dynamic";

export default function MeshSculptorPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[calc(100vh-73px)] bg-[#0c0a08] text-ink flex items-center justify-center">
          <div className="text-[13px] text-dim">Loading Mesh Sculptor…</div>
        </main>
      }
    >
      <MeshSculptClient />
    </Suspense>
  );
}
