"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import DropZone from "@/components/tools/DropZone";
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

  const refreshLibrary = useCallback(async () => {
    if (!user?.id) return;
    try {
      setAssets(await listVisibleAssets(user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load library.");
    }
  }, [user?.id]);

  useEffect(() => {
    if (creatorStatus === "approved" && user?.id && !openedAsset) refreshLibrary();
  }, [creatorStatus, user?.id, openedAsset, refreshLibrary]);

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
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not upload the model.");
      } finally {
        setBusy(false);
      }
    },
    [user?.id],
  );

  // ---- access gating --------------------------------------------------------
  if (!isLoaded || creatorStatus === "loading") {
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink flex items-center justify-center">
        <div className="text-[13px] text-dim">Loading Mesh Loom…</div>
      </main>
    );
  }
  if (creatorStatus !== "approved") {
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink flex items-center justify-center px-6">
        <div className="max-w-[520px] w-full bg-panel border border-line rounded-[10px] p-6">
          <div className="text-[20px] font-extrabold tracking-[-0.02em] mb-2">Mesh Loom</div>
          <p className="text-[13px] text-dim leading-relaxed">
            Forge tools are available once your creator profile is approved.
          </p>
          <div className="flex gap-2 mt-5">
            <Link href="/creator" className="px-4 py-2 rounded-[8px] font-bold text-[13px] no-underline" style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}>
              Become a creator
            </Link>
            <Link href="/tools" className="px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">
              All tools
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-10 pt-6 pb-16">
        {!openedAsset && (
          <div className="flex items-center gap-3 mb-5">
            <Link href="/tools" className="text-[12px] text-dim no-underline hover:text-ink">← Tools</Link>
            <span className="text-dim">/</span>
            <div className="text-[13px] font-bold">🔻 Mesh Loom</div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-[9px] border text-[13px]" style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}>
            {error}
          </div>
        )}

        {openedAsset && user?.id ? (
          <PipelineStudio
            asset={openedAsset}
            userId={user.id}
            onBack={() => {
              setOpenedAsset(null);
              refreshLibrary();
            }}
          />
        ) : (
          <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 380px" }}>
            <div className="bg-panel border border-line rounded-[12px] p-8 flex items-center justify-center">
              <div className="w-full max-w-[480px]">
                <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3 text-center">Drop a high-res GLB to start</p>
                <DropZone onFile={onFile} />
                {busy && <p className="text-[12px] text-dim mt-3 text-center">Uploading to your library…</p>}
                <p className="text-[11.5px] text-dim mt-3 text-center">
                  Decimate, retopologize with edge loops, segment, and finalize in any order — stays private until you share it.
                </p>
              </div>
            </div>

            <div className="bg-panel border border-line rounded-[12px] p-5">
              <div className="flex items-center mb-3">
                <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted">Your asset library</p>
                <button onClick={refreshLibrary} className="ml-auto text-[11.5px] text-dim hover:text-ink">Refresh</button>
              </div>
              {assets.length === 0 ? (
                <div className="text-[12.5px] text-dim">No assets yet. Drop a GLB to get started — private by default.</div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[520px] overflow-y-auto">
                  {assets.map((a) => (
                    <div key={a.id} className="flex items-center gap-2.5 p-2.5 rounded-[9px] border border-line bg-[#0a0e13]">
                      <button onClick={() => setOpenedAsset(a)} className="min-w-0 flex-1 text-left">
                        <div className="font-semibold text-[13px] truncate">{a.name}</div>
                        <div className="text-[11.5px] text-dim">{fmt(a.poly_count)} tris · {bytes(a.file_bytes)}{a.clerk_user_id !== user?.id ? " · shared" : ""}</div>
                      </button>
                      {a.clerk_user_id === user?.id ? (
                        <>
                          <select
                            value={a.visibility}
                            onChange={(e) => setAssetVisibility(a.id, e.target.value as Visibility, a.shared_with).then(refreshLibrary)}
                            className="bg-panel2 border border-line rounded-md px-1.5 py-1 text-[11.5px]"
                          >
                            <option value="private">Private</option>
                            <option value="shared">Shared</option>
                            <option value="public">Public</option>
                          </select>
                          <button onClick={() => deleteAsset(a).then(refreshLibrary)} className="text-[12px] text-dim hover:text-[#e88]">✕</button>
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
        )}
      </div>
    </main>
  );
}
