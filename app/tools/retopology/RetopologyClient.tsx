"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import DropZone from "@/components/tools/DropZone";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useCreatorStatus } from "@/lib/useCreatorStatus";
import { countGlbTriangles } from "@/lib/retopo/optimize";
import {
  uploadAsset,
  listVisibleAssets,
  setAssetVisibility,
  deleteAsset,
  type AssetRow,
  type Visibility,
} from "@/lib/assets";
import PipelineStudio from "./PipelineStudio";
import { motion } from "framer-motion";

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString();
}
function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function RetopologyClient() {
  const { user, isLoaded } = useUser();
  const creatorStatus = useCreatorStatus();

  const [openedAsset, setOpenedAsset] = useState<AssetRow | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<AssetRow | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);

  const refreshLibrary = useCallback(async () => {
    if (!user?.id) return;
    try {
      setAssets(await listVisibleAssets(user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load library.");
    }
  }, [user?.id]);

  // Library is always visible now, not just on a separate landing screen, so it loads as soon as we're approved.
  useEffect(() => {
    if (creatorStatus === "approved" && user?.id) refreshLibrary();
  }, [creatorStatus, user?.id, refreshLibrary]);

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
        refreshLibrary();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not upload the model.");
      } finally {
        setBusy(false);
      }
    },
    [user?.id, refreshLibrary],
  );

  // ---- access gating --------------------------------------------------------
  if (!isLoaded || creatorStatus === "loading") {
    return (
      <motion.main className="min-h-[calc(100vh-73px)] bg-[#1b1815] text-ink flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
        <div className="text-[13px]" style={{ color: "#9b9082" }}>Loading Mesh Loom…</div>
      </motion.main>
    );
  }
  if (creatorStatus !== "approved") {
    return (
      <motion.main className="min-h-[calc(100vh-73px)] bg-[#1b1815] text-ink flex items-center justify-center px-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
        <div className="max-w-[520px] w-full bg-panel border border-line rounded-[10px] p-6">
          <div className="text-[20px] font-extrabold tracking-[-0.02em] mb-2">Mesh Loom</div>
          <p className="text-[13px] leading-relaxed" style={{ color: "#c7bfb2" }}>
            Forge tools are available once your creator profile is approved.
          </p>
          <div className="flex gap-2 mt-5">
            <Link href="/creator" className="px-4 py-2 rounded-[8px] font-bold text-[13px] no-underline" style={{ background: "linear-gradient(180deg,#d65b36,#2c6aa0)", color: "#06121d" }}>
              Become a creator
            </Link>
            <Link href="/forge" className="px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">
              All tools
            </Link>
          </div>
        </div>
      </motion.main>
    );
  }

  return (
    <motion.main className="min-h-[calc(100vh-73px)] bg-[#1b1815] text-ink" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
      <div className="max-w-[1920px] mx-auto px-6 lg:px-10 pt-6 pb-16">
        {error && (
          <div className="mb-4 p-3 rounded-[9px] border text-[13px]" style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}>
            {error}
          </div>
        )}

        <div className={`grid grid-cols-1 gap-6 items-start ${libraryOpen ? "lg:grid-cols-[1fr_300px]" : "lg:grid-cols-1"}`}>
          {/* ---- left+center: pipeline studio, always visible ---- */}
          <PipelineStudio asset={openedAsset} userId={user?.id ?? ""} onBack={() => setOpenedAsset(null)} onAssetCreated={refreshLibrary} />

          {/* ---- right: upload + library, collapsible ---- */}
          {libraryOpen ? (
          <div className="flex flex-col gap-5">
            <div className="rounded-[12px] p-4">
              <div className="flex items-center justify-between mb-2.5">
                <p className="text-[11px] font-bold tracking-[.12em] uppercase" style={{ color: "#e8e1d5" }}>Upload</p>
                <button
                  onClick={() => setLibraryOpen(false)}
                  className="text-[11px] px-2 py-0.5 rounded border"
                  style={{ borderColor: "rgba(255,255,255,0.08)", color: "#6b6460" }}
                  title="Collapse library"
                >✕</button>
              </div>
              <DropZone onFile={onFile} hint="Drop a GLB" compact accentColor="#d65b36" inactiveBorder="rgba(214,91,54,.30)" baseBg="rgba(214,91,54,0.05)" />
              {busy && <p className="text-[11.5px] mt-2 text-center" style={{ color: "#c7bfb2" }}>Uploading…</p>}
              <p className="text-[11px] mt-2.5 leading-relaxed" style={{ color: "#c7bfb2" }}>
                Select an asset below, or drop a new one.
              </p>
            </div>

            <div className="rounded-[12px] p-5">
              <div className="flex items-center mb-3">
                <p className="text-[11px] font-bold tracking-[.12em] uppercase" style={{ color: "#e8e1d5" }}>Your asset library</p>
                <button onClick={refreshLibrary} className="ml-auto text-[11.5px]" style={{ color: "#9b9082" }}>Refresh</button>
              </div>
              {assets.length === 0 ? (
                <div className="text-[12.5px]" style={{ color: "#9b9082" }}>No assets yet. Drop a GLB to get started — private by default.</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {assets.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 p-2.5 rounded-[9px] border transition-colors"
                      style={{
                        background: openedAsset?.id === a.id ? "rgba(214,91,54,.08)" : "transparent",
                        borderColor: openedAsset?.id === a.id ? "rgba(214,91,54,.40)" : "rgba(255,255,255,.06)",
                      }}
                    >
                      <button onClick={() => setOpenedAsset(a)} className="min-w-0 flex-1 text-left">
                        <div className="font-semibold text-[13px] truncate" style={{ color: openedAsset?.id === a.id ? "#f7e9df" : "#e2dbcf" }}>{a.name}</div>
                        <div className="text-[11px] mt-0.5 flex items-center gap-1.5" style={{ color: "#6b6460" }}>
                          <span>{fmt(a.poly_count)} tris · {bytes(a.file_bytes)}{a.clerk_user_id !== user?.id ? " · shared" : ""}</span>
                          {a.meta?.ktx2Compressed ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(214,91,54,.14)", color: "#f3946a" }}>KTX2</span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,.06)", color: "#8a8078" }}>Uncompressed</span>
                          )}
                        </div>
                      </button>
                      {a.clerk_user_id === user?.id ? (
                        <>
                          <select
                            value={a.visibility}
                            onChange={(e) => setAssetVisibility(a.id, e.target.value as Visibility, a.shared_with).then(refreshLibrary)}
                            className="appearance-none rounded-md px-1.5 py-1 text-[11.5px]"
                            style={{
                              background: "#2c2926",
                              border: `1px solid ${openedAsset?.id === a.id ? "rgba(214,91,54,.45)" : "rgba(255,255,255,0.12)"}`,
                              color: "#f3946a",
                              WebkitAppearance: "none",
                            }}
                          >
                            <option value="private">Private</option>
                            <option value="shared">Shared</option>
                            <option value="public">Public</option>
                          </select>
                          <button onClick={() => setConfirmDelete(a)} className="text-[12px] hover:text-[#f3946a]" style={{ color: "#8e8579" }}>✕</button>
                        </>
                      ) : (
                        <span
                          className="text-[11px] px-2 py-0.5 rounded-full border"
                          style={{
                            color: openedAsset?.id === a.id ? "#f3946a" : "#9b9082",
                            borderColor: openedAsset?.id === a.id ? "rgba(214,91,54,.40)" : "rgba(255,255,255,.10)",
                          }}
                        >{a.visibility}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          ) : (
            <div className="hidden lg:flex flex-col items-center pt-2">
              <button
                onClick={() => setLibraryOpen(true)}
                className="text-[11px] px-2.5 py-1.5 rounded-lg border"
                style={{ borderColor: "rgba(255,255,255,0.08)", background: "#2c2926", color: "#9b9082" }}
                title="Open library"
              >
                Library ▸
              </button>
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          theme="warm"
          title="Delete this model?"
          message={`"${confirmDelete.name}" will be permanently deleted, along with its pipeline history. This can't be undone.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            if (openedAsset?.id === target.id) setOpenedAsset(null);
            deleteAsset(target)
              .then(refreshLibrary)
              .catch((e) => setError(e instanceof Error ? e.message : "Could not delete this asset."));
          }}
        />
      )}
    </motion.main>
  );
}
