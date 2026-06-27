import { Suspense } from "react";
import ForgeClient from "./ForgeClient";
import CreatorSubNav from "@/components/shell/CreatorSubNav";

export default function ForgePage() {
  return (
    <>
      <CreatorSubNav />
      <Suspense
        fallback={
          <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink flex items-center justify-center">
            <div className="text-[13px] text-dim">Loading Forge...</div>
          </main>
        }
      >
        <ForgeClient />
      </Suspense>
    </>
  );
}
