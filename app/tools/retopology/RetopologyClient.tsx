"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useCreatorStatus } from "@/lib/useCreatorStatus";
import { useActiveLoader } from "@/components/assets/ActiveLoaderContext";
import { countGlbTriangles } from "@/lib/retopo/optimize";
import {
  uploadAsset,
  type AssetRow,
} from "@/lib/assets";
import PipelineStudio from "./PipelineStudio";
import { motion } from "framer-motion";

export default function RetopologyClient() {
  const { user, isLoaded } = useUser();
  const creatorStatus = useCreatorStatus();

  const [openedAsset, setOpenedAsset] = useState<AssetRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Mesh Loom no longer keeps its own "your asset library" list — the
  // global My Assets panel (app/layout.tsx) is the universal loader now.
  // Its own doc comment already stated this exact consolidation intent.
  const { register, notifyAssetsChanged } = useActiveLoader();
  useEffect(() => {
    return register({
      onLoad: setOpenedAsset,
      accepts: (a) => a.format.toLowerCase() === "glb",
    });
  }, [register]);

  // Drag in a hi-res GLB: stored privately in the library immediately, then opened in the Studio.
  const onFile = useCallback(
    async (file: File) => {
      if (!user?.id) return;
      setBusy(true);
      setError("");
      try {
        const buf = await file.arrayBuffer();
        const tris = await countGlbTriangles(buf);
        const asset = await uploadAsset({
          userId: user.id,
          name: file.name,
          bytes: buf,
          polyCount: tris,
          visibility: "private",
        });
        setOpenedAsset(asset);
        notifyAssetsChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not upload the model.");
      } finally {
        setBusy(false);
      }
    },
    [user?.id, notifyAssetsChanged],
  );

  // ---- access gating --------------------------------------------------------
  if (!isLoaded || creatorStatus === "loading") {
    return (
      <motion.main className="tool-min-h bg-[#1b1815] text-ink flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
        <div className="text-[13px]" style={{ color: "#9b9082" }}>Loading Mesh Loom…</div>
      </motion.main>
    );
  }
  if (!user) {
    return (
      <motion.main className="tool-min-h bg-[#1b1815] text-ink flex items-center justify-center px-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
        <div className="max-w-[520px] w-full bg-panel border border-line rounded-[10px] p-6">
          <div className="text-[20px] font-extrabold tracking-[-0.02em] mb-2">Mesh Loom</div>
          <p className="text-[13px] leading-relaxed" style={{ color: "#c7bfb2" }}>
            Sign in to use Mesh Loom.
          </p>
          <div className="flex gap-2 mt-5">
            <Link href="/sign-in" className="px-4 py-2 rounded-[8px] font-bold text-[13px] no-underline" style={{ background: "linear-gradient(180deg,#d65b36,#2c6aa0)", color: "#06121d" }}>
              Sign in
            </Link>
          </div>
        </div>
      </motion.main>
    );
  }

  return (
    <motion.main className="tool-min-h bg-[#1b1815] text-ink" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
      <div className="max-w-[1920px] mx-auto px-6 lg:px-10 pt-6 pb-16">
        {error && (
          <div className="mb-4 p-3 rounded-[9px] border text-[13px]" style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}>
            {error}
          </div>
        )}

        <PipelineStudio asset={openedAsset} userId={user?.id ?? ""} onBack={() => setOpenedAsset(null)} onAssetCreated={notifyAssetsChanged} onFile={onFile} />
      </div>

    </motion.main>
  );
}
