"use client";

import { useCallback, useEffect, useState } from "react";
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
import PaintStudio from "./PaintStudio";


function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString();
}
function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function SubstanceWeaverClient() {
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
    if (user?.id) refreshLibrary();
  }, [creatorStatus, user?.id, refreshLibrary]);

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

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
          {/* ---- left+center: paint studio, always mounted ---- */}
          <div>
            <PaintStudio asset={openedAsset} userId={user?.id ?? ""} onBack={() => setOpenedAsset(null)} onAssetCreated={refreshLibrary} />
          </div>

          {/* ---- right: upload + library, always visible ---- */}
          <div className="flex flex-col gap-5">
            <div className="bg-panel border border-line rounded-[12px] p-4">
              <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-2.5">Upload</p>
              <DropZone onFile={onFile} hint="Drop a GLB" compact />
              {busy && <p className="text-[11.5px] text-dim mt-2 text-center">Uploading…</p>}
              <p className="text-[11px] text-dim mt-2.5 leading-relaxed">
                Select an asset below, or drop a new one — paint albedo color and relief detail, with a channel switcher to inspect the result.
              </p>
            </div>

            <div className="bg-panel border border-line rounded-[12px] p-5">
              <div className="flex items-center mb-3">
                <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted">Your asset library</p>
                <button onClick={refreshLibrary} className="ml-auto text-[11.5px] text-dim hover:text-ink">Refresh</button>
              </div>
              {assets.length === 0 ? (
                <div className="text-[12.5px] text-dim">No assets yet. Drop a GLB to get started — private by default.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {assets.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2.5 p-2.5 rounded-[9px] border bg-[#0a0e13]"
                      style={{ borderColor: openedAsset?.id === a.id ? "#56a6e8" : "#26384a" }}
                    >
                      <button onClick={() => setOpenedAsset(a)} className="min-w-0 flex-1 text-left">
                        <div className="font-semibold text-[13px] truncate">{a.name}</div>
                        <div className="text-[11.5px] text-dim flex items-center gap-1.5">
                          <span>{fmt(a.poly_count)} tris · {bytes(a.file_bytes)}{a.clerk_user_id !== user?.id ? " · shared" : ""}</span>
                          {a.meta?.ktx2Compressed ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(86,166,232,.14)", color: "#8fc6f0" }}>KTX2</span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,.06)", color: "#6b7684" }}>Uncompressed</span>
                          )}
                        </div>
                      </button>
                      {a.clerk_user_id === user?.id ? (
                        <>
                          <select
                            value={a.visibility}
                            onChange={(e) => setAssetVisibility(a.id, e.target.value as Visibility, { sharedWith: a.shared_with, priceCents: a.price_cents }).then(refreshLibrary)}
                            className="bg-panel2 border border-line rounded-md px-1.5 py-1 text-[11.5px]"
                          >
                            <option value="private">Private</option>
                            <option value="shared">Shared</option>
                            <option value="public">Public</option>
                            <option value="sellable">Sellable</option>
                          </select>
                          <button onClick={() => setConfirmDelete(a)} className="text-[12px] text-dim hover:text-[#e88]">✕</button>
                        </>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "rgba(86,166,232,.14)", color: "#8fc6f0" }}>{a.visibility}</span>
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
          message={`"${confirmDelete.name}" will be permanently deleted. This can't be undone.`}
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
