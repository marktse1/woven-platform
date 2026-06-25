"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { type AssetRow, uploadAsset, signedAssetUrl } from "@/lib/assets";
import {
  loadGlbForPainting,
  decodeImage,
  canvasToPng,
  imageDataToPng,
  writePaintedTextures,
  exportPaintedGlb,
} from "@/lib/paint/textures";
import type { PaintViewerHandle, ViewChannel, PaintChannel, BrushSettings } from "@/components/tools/PaintViewer";
import BrushPanel from "./BrushPanel";

const PaintViewer = dynamic(() => import("@/components/tools/PaintViewer"), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-dim text-[12px]">Loading viewer…</div>,
});

const DEFAULT_TEXTURE_SIZE = 1024;

type Props = {
  asset: AssetRow;
  userId: string;
  onBack: () => void;
};

export default function PaintStudio({ asset, userId, onBack }: Props) {
  const viewerRef = useRef<PaintViewerHandle>(null);

  const [sourceBuf, setSourceBuf] = useState<ArrayBuffer | null>(null);
  const [seedAlbedo, setSeedAlbedo] = useState<ImageBitmap | null>(null);
  const [seedBaseNormal, setSeedBaseNormal] = useState<ImageData | null>(null);
  const [seedAO, setSeedAO] = useState<ImageBitmap | null>(null);
  const [textureSize, setTextureSize] = useState(DEFAULT_TEXTURE_SIZE);

  const [viewChannel, setViewChannel] = useState<ViewChannel>("combined");
  const [paintChannel, setPaintChannel] = useState<PaintChannel>("albedo");
  const [erasing, setErasing] = useState(false);
  const [paintMode, setPaintMode] = useState(true);
  const [brush, setBrush] = useState<BrushSettings>({
    size: 32,
    opacity: 0.8,
    hardness: 0.6,
    color: { r: 230, g: 70, b: 70 },
    reliefStrength: 0.5,
  });

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setBusy(true);
      setError("");
      setStatus("Loading model…");
      try {
        const url = await signedAssetUrl(asset.storage_path);
        const buf = await (await fetch(url)).arrayBuffer();
        if (!active) return;
        setSourceBuf(buf);

        const loaded = await loadGlbForPainting(buf);
        if (!active) return;

        const size = loaded.material?.getBaseColorTexture()?.getSize()?.[0] ?? DEFAULT_TEXTURE_SIZE;
        setTextureSize(size);

        const albedoBitmap = await decodeImage(loaded.albedo);
        if (!active) return;
        setSeedAlbedo(albedoBitmap);

        const normalBitmap = await decodeImage(loaded.normal);
        if (!active) return;
        if (normalBitmap) {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(normalBitmap, 0, 0, size, size);
          setSeedBaseNormal(ctx.getImageData(0, 0, size, size));
        } else {
          setSeedBaseNormal(null);
        }

        const aoBitmap = await decodeImage(loaded.occlusion);
        if (!active) return;
        setSeedAO(aoBitmap);

        setStatus("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load model.");
      } finally {
        setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [asset.id, asset.storage_path]);

  const handleSave = useCallback(async () => {
    if (!sourceBuf) return;
    setBusy(true);
    setError("");
    setStatus("Saving…");
    try {
      const exportData = viewerRef.current?.getExport();
      if (!exportData) throw new Error("Nothing to save yet.");

      // Re-read a fresh Document for export - keeps the live preview's Document
      // (owned by PaintViewer) untouched, and avoids stale-state surprises.
      const loaded = await loadGlbForPainting(sourceBuf);
      let material = loaded.material;
      if (!material) {
        material = loaded.document.createMaterial("painted");
        const mesh = loaded.document.getRoot().listMeshes()[0];
        mesh?.listPrimitives()[0]?.setMaterial(material);
      }

      const albedoPng = await canvasToPng(exportData.albedoCanvas);
      const normalPng = await imageDataToPng(exportData.normalImage);
      writePaintedTextures(loaded.document, material, { albedoPng, normalPng });

      const outputBytes = await exportPaintedGlb(loaded.document);
      const saved = await uploadAsset({
        userId,
        name: `${asset.name.replace(/\.(glb|gltf)$/i, "")} (painted).glb`,
        bytes: outputBytes,
        polyCount: asset.poly_count ?? undefined,
        visibility: "private",
        meta: { sourceAssetId: asset.id, tool: "substance-weaver" },
      });
      setStatus(`Saved as "${saved.name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }, [sourceBuf, userId, asset.id, asset.name, asset.poly_count]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-[12px] text-dim hover:text-ink">
          ← Library
        </button>
        <span className="text-dim">/</span>
        <div className="text-[13px] font-bold truncate max-w-[28ch]">{asset.name}</div>
        <div className="flex-1" />
        {status && <div className="text-[12px] text-dim truncate max-w-[34ch]">{status}</div>}
      </div>

      {error && (
        <div
          className="p-3 rounded-[9px] border text-[13px]"
          style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}
        >
          {error}
        </div>
      )}

      <div className="grid gap-6 items-start" style={{ gridTemplateColumns: "1fr 340px" }}>
        <div className="bg-panel border border-line rounded-[12px] overflow-hidden h-[600px]">
          {!sourceBuf ? (
            <div className="w-full h-full flex items-center justify-center text-dim text-[13px]">Loading…</div>
          ) : (
            <PaintViewer
              ref={viewerRef}
              data={sourceBuf}
              seedAlbedo={seedAlbedo}
              seedBaseNormal={seedBaseNormal}
              seedAO={seedAO}
              textureSize={textureSize}
              viewChannel={viewChannel}
              paintChannel={paintChannel}
              erasing={erasing}
              brush={brush}
              paintMode={paintMode}
              onUndoRedoChange={(s) => {
                setCanUndo(s.canUndo);
                setCanRedo(s.canRedo);
              }}
              onLoadError={setError}
            />
          )}
        </div>

        <BrushPanel
          paintMode={paintMode}
          onPaintModeChange={setPaintMode}
          paintChannel={paintChannel}
          onPaintChannelChange={setPaintChannel}
          erasing={erasing}
          onErasingChange={setErasing}
          brush={brush}
          onBrushChange={setBrush}
          viewChannel={viewChannel}
          onViewChannelChange={setViewChannel}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => viewerRef.current?.undo()}
          onRedo={() => viewerRef.current?.redo()}
          onSave={handleSave}
          busy={busy}
        />
      </div>
    </div>
  );
}
