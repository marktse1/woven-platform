import { Suspense } from "react";
import ForgeClient from "./ForgeClient";

export default function ForgePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink flex items-center justify-center">
          <div className="text-[13px] text-dim">Loading Forge...</div>
        </main>
      }
    >
      <ForgeClient />
    </Suspense>
  );
}
