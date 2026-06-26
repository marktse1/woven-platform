"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
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

const ModelViewer = dynamic(() => import("@/components/tools/ModelViewer"), { ssr: false });

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
      <main className="min-h-[calc(100vh-73px)] bg-[#1b1815] text-ink flex items-center justify-center">
        <div className="text-[13px]" style={{ color: "#9b9082" }}>Loading Mesh Loom…</div>
      </main>
    );
  }
  if (creatorStatus !== "approved") {
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#1b1815] text-ink flex items-center justify-center px-6">
        <div className="max-w-[520px] w-full bg-panel border border-line rounded-[10px] p-6">
          <div className="text-[20px] font-extrabold tracking-[-0.02em] mb-2">Mesh Loom</div>
          <p className="text-[13px] leading-relaxed" style={{ color: "#c7bfb2" }}>
            Forge tools are available once your creator profile is approved.
          </p>
          <div className="flex gap-2 mt-5">
            <Link href="/creator" className="px-4 py-2 rounded-[8px] font-bold text-[13px] no-underline" style={{ background: "linear-gradient(180deg,#e2562a,#2c6aa0)", color: "#06121d" }}>
              Become a creator
            </Link>
            <Link href="/forge" className="px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">
              All tools
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#1b1815] text-ink">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-10 pt-6 pb-16">
        {!openedAsset && (
          <div className="flex items-center gap-3 mb-5">
            <Link href="/forge" className="text-[12px] no-underline" style={{ color: "#9b9082" }}>← Forge</Link>
            <span style={{ color: "#9b9082" }}>/</span>
            <div className="text-[13px] font-bold">🔻 Mesh Loom</div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-[9px] border text-[13px]" style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}>
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
          {/* ---- left+center: pipeline studio, or an empty live viewer ---- */}
          <div>
            {openedAsset && user?.id ? (
              <PipelineStudio asset={openedAsset} userId={user.id} onBack={() => setOpenedAsset(null)} onAssetCreated={refreshLibrary} />
            ) : (
              <div className="bg-[#131110] rounded-[12px] overflow-hidden h-[clamp(260px,38vh,420px)]">
                <ModelViewer data={null} wireframe={false} accent="#e2562a" />
              </div>
            )}
          </div>

          {/* ---- right: upload + library, always visible ---- */}
          <div className="flex flex-col gap-5">
            <div className="rounded-[12px] p-4">
              <p className="text-[11px] font-bold tracking-[.12em] uppercase mb-2.5" style={{ color: "#e8e1d5" }}>Upload</p>
              <DropZone onFile={onFile} hint="Drop a GLB" compact accentColor="#e2562a" inactiveBorder="rgba(226,86,42,.25)" baseBg="#1b1815" />
              {busy && <p className="text-[11.5px] mt-2 text-center" style={{ color: "#c7bfb2" }}>Uploading…</p>}
              <p className="text-[11px] mt-2.5 leading-relaxed" style={{ color: "#c7bfb2" }}>
                Select an asset below, or drop a new one — decimate, retopologize with edge loops, segment, and finalize in any order.
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
                <div className="flex flex-col gap-2 max-h-[520px] overflow-y-auto">
                  {assets.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2.5 p-2.5 rounded-[9px] border"
                      style={{
                        background: openedAsset?.id === a.id ? "rgba(226,86,42,.08)" : "#2c2926",
                        borderColor: openedAsset?.id === a.id ? "rgba(226,86,42,.45)" : "rgba(255,255,255,.08)",
                      }}
                    >
                      <button onClick={() => setOpenedAsset(a)} className="min-w-0 flex-1 text-left">
                        <div className="font-semibold text-[13px] truncate" style={{ color: openedAsset?.id === a.id ? "#f7e9df" : "#e2dbcf" }}>{a.name}</div>
                        <div className="text-[11.5px]" style={{ color: openedAsset?.id === a.id ? "#a89c8c" : "#8e8579" }}>{fmt(a.poly_count)} tris · {bytes(a.file_bytes)}{a.clerk_user_id !== user?.id ? " · shared" : ""}</div>
                      </button>
                      {a.clerk_user_id === user?.id ? (
                        <>
                          <select
                            value={a.visibility}
                            onChange={(e) => setAssetVisibility(a.id, e.target.value as Visibility, a.shared_with).then(refreshLibrary)}
                            className="rounded-md px-1.5 py-1 text-[11.5px]"
                            style={{
                              background: "#2c2926",
                              border: `1px solid ${openedAsset?.id === a.id ? "rgba(226,86,42,.45)" : "rgba(255,255,255,0.08)"}`,
                              color: openedAsset?.id === a.id ? "#f3946a" : "#9b9082",
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
                            borderColor: openedAsset?.id === a.id ? "rgba(226,86,42,.40)" : "rgba(255,255,255,.10)",
                          }}
                        >{a.visibility}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
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
    </main>
  );
}
