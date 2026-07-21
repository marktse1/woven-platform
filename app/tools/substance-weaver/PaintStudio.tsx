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
import type { PaintViewerHandle, ViewChannel, PaintChannel, BrushSettings, LightInfo, BrushAlpha } from "@/components/tools/PaintViewer";
import { toGlbFile } from "@/lib/convertMeshFile";
import BrushPanel from "./BrushPanel";

const VIEW_CHANNELS: { value: ViewChannel; label: string }[] = [
  { value: "combined", label: "Combined" },
  { value: "albedo", label: "Albedo" },
  { value: "normal", label: "Normal" },
  { value: "ao", label: "AO" },
];

const ACCENT = "#56a6e8";

const PaintViewer = dynamic(() => import("@/components/tools/PaintViewer"), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-dim text-[12px]">Loading viewer…</div>,
});

const DEFAULT_TEXTURE_SIZE = 1024;

type Props = {
  asset: AssetRow | null;
  userId: string;
  onBack: () => void;
  onAssetCreated?: () => void;
  onFile: (file: File) => Promise<void>;
};

export default function PaintStudio({ asset, userId, onBack, onAssetCreated, onFile }: Props) {
  const viewerRef = useRef<PaintViewerHandle>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [sourceBuf, setSourceBuf] = useState<ArrayBuffer | null>(null);
  const [seedAlbedo, setSeedAlbedo] = useState<ImageBitmap | null>(null);
  const [seedBaseNormal, setSeedBaseNormal] = useState<ImageData | null>(null);
  const [seedAO, setSeedAO] = useState<ImageBitmap | null>(null);
  const [seedMetallicRoughness, setSeedMetallicRoughness] = useState<ImageBitmap | null>(null);
  const [roughnessFactor, setRoughnessFactor] = useState(1);
  const [metallicFactor, setMetallicFactor] = useState(1);
  const [textureSize, setTextureSize] = useState(DEFAULT_TEXTURE_SIZE);

  const [viewChannel, setViewChannel] = useState<ViewChannel>("combined");
  const [paintChannel, setPaintChannel] = useState<PaintChannel>("albedo");
  const [erasing, setErasing] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [brush, setBrush] = useState<BrushSettings>({
    size: 32,
    opacity: 0.8,
    hardness: 0.6,
    color: { r: 230, g: 70, b: 70 },
    reliefStrength: 0.5,
  });

  const [canUndo, setCanUndo] = useState(false);
  const [brushAlpha, setBrushAlpha] = useState<BrushAlpha>(null);
  const [canRedo, setCanRedo] = useState(false);
  const [selectedLight, setSelectedLight] = useState<LightInfo | null>(null);
  const [lightsGizmosVisible, setLightsGizmosVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [compressKtx2, setCompressKtx2] = useState(true);

  useEffect(() => {
    if (!asset) {
      setSourceBuf(null);
      setSeedAlbedo(null);
      setSeedBaseNormal(null);
      setSeedAO(null);
      setSeedMetallicRoughness(null);
      setBusy(false);
      setError("");
      setStatus("");
      return;
    }
    let active = true;
    (async () => {
      setBusy(true);
      setError("");
      setStatus("Loading model…");
      try {
        const url = await signedAssetUrl(asset.storage_path);
        let buf = await (await fetch(url)).arrayBuffer();
        if (!active) return;

        // createWebIO() registers KHR_texture_basisu, so this read succeeds
        // structurally even on a KTX2-compressed asset — but the textures'
        // bytes are still Basis-compressed, not decodable pixels.
        let loaded = await loadGlbForPainting(buf);
        if (!active) return;

        const isKtx2 = loaded.document.getRoot().listTextures().some((t) => t.getMimeType() === "image/ktx2");
        if (isKtx2) {
          setStatus("Decompressing textures for editing…");
          const res = await fetch("/api/glb/decompress-ktx2", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, assetId: asset.id }),
          });
          if (!res.ok) throw new Error("Failed to decompress KTX2 textures for editing.");
          const freshUrl = await signedAssetUrl(asset.storage_path);
          buf = await (await fetch(freshUrl)).arrayBuffer();
          if (!active) return;
          loaded = await loadGlbForPainting(buf);
          if (!active) return;
          setStatus("Loading model…");
        }

        setSourceBuf(buf);

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

        const metallicRoughnessBitmap = await decodeImage(loaded.metallicRoughness);
        if (!active) return;
        setSeedMetallicRoughness(metallicRoughnessBitmap);
        setRoughnessFactor(loaded.roughnessFactor);
        setMetallicFactor(loaded.metallicFactor);

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
  }, [asset?.id, asset?.storage_path, userId]);

  const handleSave = useCallback(async () => {
    if (!asset || !sourceBuf) return;
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

      if (compressKtx2) {
        setStatus("Compressing textures…");
        const res = await fetch("/api/glb/compress-ktx2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, assetId: saved.id }),
        });
        setStatus(res.ok ? `Saved as "${saved.name}".` : `Saved as "${saved.name}" (uncompressed — texture compression failed).`);
      } else {
        setStatus(`Saved as "${saved.name}".`);
      }
      onAssetCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }, [sourceBuf, userId, asset?.id, asset?.name, asset?.poly_count, compressKtx2]);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "glb" && ext !== "drc" && ext !== "obj") {
      setError(`Unsupported format: .${ext}. Drop a .glb, .drc, or .obj file.`);
      return;
    }
    try {
      await onFile(await toGlbFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file.");
    }
  }, [onFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {asset && (
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-[12px] text-dim hover:text-ink">
            ← Library
          </button>
          <span className="text-dim">/</span>
          <div className="text-[13px] font-bold truncate max-w-[28ch]">{asset.name}</div>
        </div>
      )}

      {error && (
        <div
          className="p-3 rounded-[9px] border text-[13px]"
          style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">
        {/* ---- left: brush / mode / lights panel ---- */}
        <BrushPanel
          showGrid={showGrid}
          onShowGridChange={setShowGrid}
          paintChannel={paintChannel}
          onPaintChannelChange={setPaintChannel}
          erasing={erasing}
          onErasingChange={setErasing}
          brush={brush}
          onBrushChange={setBrush}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => viewerRef.current?.undo()}
          onRedo={() => viewerRef.current?.redo()}
          selectedLight={selectedLight}
          lightsGizmosVisible={lightsGizmosVisible}
          onAddLight={() => viewerRef.current?.addLight()}
          onDeleteSelectedLight={() => viewerRef.current?.deleteSelectedLight()}
          onDeleteAllLights={() => viewerRef.current?.deleteAllLights()}
          onSetLightIntensity={(v) => {
            viewerRef.current?.setSelectedLightIntensity(v);
            if (selectedLight) setSelectedLight({ ...selectedLight, intensity: v });
          }}
          onSetLightDistance={(v) => {
            viewerRef.current?.setSelectedLightDistance(v);
            if (selectedLight) setSelectedLight({ ...selectedLight, distance: v });
          }}
          onSetLightsGizmosVisible={(v) => {
            viewerRef.current?.setLightsGizmosVisible(v);
            setLightsGizmosVisible(v);
          }}
          brushAlpha={brushAlpha}
          onBrushAlphaChange={setBrushAlpha}
        />

        {/* ---- right: top bar + viewer ---- */}
        <div className="flex flex-col gap-3">
          {/* view channel pills + save */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1.5">
              {VIEW_CHANNELS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setViewChannel(value)}
                  className="text-[12px] px-2.5 py-1 rounded-full border capitalize"
                  style={{
                    borderColor: viewChannel === value ? ACCENT : "#26384a",
                    background: viewChannel === value ? "rgba(86,166,232,.14)" : "#0d141c",
                    color: viewChannel === value ? "#cfe6fb" : "#8aa0b4",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            {status && <span className="text-[12px] text-dim truncate max-w-[28ch]">{status}</span>}
            <button
              onClick={() => setCompressKtx2((v) => !v)}
              className="text-[12px] px-2.5 py-1 rounded-full border"
              style={{
                borderColor: compressKtx2 ? ACCENT : "#26384a",
                background: compressKtx2 ? "rgba(86,166,232,.14)" : "#0d141c",
                color: compressKtx2 ? "#cfe6fb" : "#8aa0b4",
              }}
              title="Compress embedded textures to KTX2 (Basis Universal) on save"
            >
              Compress (KTX2)
            </button>
            <button
              onClick={handleSave}
              disabled={busy || !asset || !sourceBuf}
              className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold disabled:opacity-40"
              style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}
            >
              {busy ? "Saving…" : "Save new asset"}
            </button>
          </div>

          {/* viewer */}
          <div
            className="bg-panel border border-line rounded-[12px] overflow-hidden h-[clamp(500px,65vh,800px)] relative"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            {!asset ? (
              <div className="absolute inset-0 flex items-center justify-center text-center pointer-events-none z-10">
                <div
                  className="rounded-2xl px-10 py-8 flex flex-col items-center gap-2 transition-all"
                  style={{
                    border: isDragging ? `2px dashed ${ACCENT}` : "2px dashed #26384a",
                    background: isDragging ? "rgba(86,166,232,0.07)" : "transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ opacity: isDragging ? 1 : 0.35 }}>
                    <path d="M12 16V4m0 0L8 8m4-4 4 4" stroke={isDragging ? ACCENT : "#8aa0b4"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke={isDragging ? ACCENT : "#8aa0b4"} strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                  <p className="text-sm font-medium" style={{ color: isDragging ? ACCENT : "#c0b8b0" }}>
                    {isDragging ? "Drop to load" : "Drop a GLB, DRC, or OBJ here"}
                  </p>
                  <p className="text-[11px]" style={{ color: "#6a8098" }}>
                    or open one from My Assets
                  </p>
                </div>
              </div>
            ) : !sourceBuf ? (
              <div className="w-full h-full flex items-center justify-center text-[13px] text-dim">Loading…</div>
            ) : (
              <PaintViewer
                ref={viewerRef}
                data={sourceBuf}
                seedAlbedo={seedAlbedo}
                seedBaseNormal={seedBaseNormal}
                seedAO={seedAO}
                seedMetallicRoughness={seedMetallicRoughness}
                roughnessFactor={roughnessFactor}
                metallicFactor={metallicFactor}
                textureSize={textureSize}
                viewChannel={viewChannel}
                paintChannel={paintChannel}
                erasing={erasing}
                brush={brush}
                brushAlpha={brushAlpha}
                paintMode={true}
                showGrid={showGrid}
                onUndoRedoChange={(s) => {
                  setCanUndo(s.canUndo);
                  setCanRedo(s.canRedo);
                }}
                onLoadError={setError}
                onLightSelect={setSelectedLight}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
