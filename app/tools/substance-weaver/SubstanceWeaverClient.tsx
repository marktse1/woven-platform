"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useCreatorStatus } from "@/lib/useCreatorStatus";
import { useActiveLoader } from "@/components/assets/ActiveLoaderContext";
import { countGlbTriangles } from "@/lib/retopo/optimize";
import { uploadAsset, type AssetRow } from "@/lib/assets";
import PaintStudio from "./PaintStudio";

export default function SubstanceWeaverClient() {
  const { user, isLoaded } = useUser();
  const creatorStatus = useCreatorStatus();

  const [openedAsset, setOpenedAsset] = useState<AssetRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Mesh Painter no longer keeps its own "your asset library" list — the
  // global My Assets panel (app/layout.tsx) is the universal loader now,
  // same consolidation Mesh Loom and Mesh Sculptor already went through.
  const { register, notifyAssetsChanged } = useActiveLoader();
  useEffect(() => {
    return register({
      onLoad: setOpenedAsset,
      accepts: (a) => a.format.toLowerCase() === "glb",
    });
  }, [register]);

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

  if (!isLoaded || creatorStatus === "loading") {
    return (
      <main className="tool-min-h bg-[#070b11] text-ink flex items-center justify-center">
        <div className="text-[13px] text-dim">Loading Mesh Painter…</div>
      </main>
    );
  }

  return (
    <main className="tool-min-h bg-[#070b11] text-ink">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-10 pt-6 pb-16">
        {error && (
          <div className="mb-4 p-3 rounded-[9px] border text-[13px]" style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}>
            {error}
          </div>
        )}

        <PaintStudio asset={openedAsset} userId={user?.id ?? ""} onBack={() => setOpenedAsset(null)} onAssetCreated={notifyAssetsChanged} onFile={onFile} />
      </div>
    </main>
  );
}
