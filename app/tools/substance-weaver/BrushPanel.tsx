"use client";
import { useRef } from "react";

import StepCard from "../retopology/StepCard";
import type { BrushSettings, LightInfo, PaintChannel } from "@/components/tools/PaintViewer";
import type { Rgb } from "@/lib/paint/brush";


// ── Brush alpha uploader sub-component ─────────────────────────────────────
function AlphaUploader({ brushAlpha, onBrushAlphaChange }: {
  brushAlpha: ImageBitmap | null;
  onBrushAlphaChange: (b: ImageBitmap | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    createImageBitmap(file).then((bmp) => {
      onBrushAlphaChange(bmp);
      // Draw preview
      const c = previewRef.current;
      if (!c) return;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(bmp, 0, 0, 64, 64);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <canvas
        ref={previewRef}
        width={64} height={64}
        className="rounded border border-line flex-shrink-0"
        style={{ width: 64, height: 64, background: brushAlpha ? "transparent" : "#0d141c",
          cursor: "pointer", imageRendering: "pixelated" }}
        onClick={() => fileRef.current?.click()}
      />
      <div
        onClick={() => fileRef.current?.click()}
        className="flex-1 border border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors hover:border-[#56a6e8]"
        style={{ borderColor: "#26384a" }}>
        <p className="text-[11px] text-dim">{brushAlpha ? "Click to replace" : "Click to upload PNG"}</p>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
        className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
const ACCENT = "#56a6e8";

function rgbToHex(c: Rgb): string {
  return "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function pillButton(active: boolean) {
  return {
    className: "text-[12px] px-2.5 py-1 rounded-full border capitalize",
    style: {
      borderColor: active ? ACCENT : "#26384a",
      background: active ? "rgba(86,166,232,.14)" : "#0d141c",
      color: active ? "#cfe6fb" : "#8aa0b4",
    },
  };
}

type Props = {
  showGrid: boolean;
  onShowGridChange: (v: boolean) => void;
  paintChannel: PaintChannel;
  onPaintChannelChange: (c: PaintChannel) => void;
  erasing: boolean;
  onErasingChange: (v: boolean) => void;
  brush: BrushSettings;
  onBrushChange: (b: BrushSettings) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  // Lights
  selectedLight: LightInfo | null;
  lightsGizmosVisible: boolean;
  onAddLight: () => void;
  onDeleteSelectedLight: () => void;
  onDeleteAllLights: () => void;
  onSetLightIntensity: (v: number) => void;
  onSetLightDistance: (v: number) => void;
  onSetLightsGizmosVisible: (v: boolean) => void;
  brushAlpha: ImageBitmap | null;
  onBrushAlphaChange: (b: ImageBitmap | null) => void;
};

export default function BrushPanel({
  showGrid,
  onShowGridChange,
  paintChannel,
  onPaintChannelChange,
  erasing,
  onErasingChange,
  brush,
  onBrushChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  selectedLight,
  lightsGizmosVisible,
  onAddLight,
  onDeleteSelectedLight,
  onDeleteAllLights,
  onSetLightIntensity,
  onSetLightDistance,
  onSetLightsGizmosVisible,
  brushAlpha,
  onBrushAlphaChange,
}: Props) {
  return (
    <div className="flex flex-col gap-5">
      <StepCard title="Brush" description="Click on mesh to paint, drag off mesh to orbit.">
        <button onClick={() => onShowGridChange(!showGrid)} {...pillButton(showGrid)} className={pillButton(showGrid).className + " w-full mb-4"}>
          Grid {showGrid ? "on" : "off"}
        </button>
        <div className="flex gap-2 mb-4">
          {(["albedo", "relief"] as const).map((c) => (
            <button key={c} onClick={() => onPaintChannelChange(c)} {...pillButton(paintChannel === c)}>
              {c === "albedo" ? "Albedo" : "Relief"}
            </button>
          ))}
          <button onClick={() => onErasingChange(!erasing)} {...pillButton(erasing)} className={pillButton(erasing).className + " ml-auto"}>
            Eraser
          </button>
        </div>

        {paintChannel === "albedo" ? (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[12.5px] text-muted">Color</span>
            <input
              type="color"
              value={rgbToHex(brush.color)}
              onChange={(e) => onBrushChange({ ...brush, color: hexToRgb(e.target.value) })}
              className="w-8 h-8 rounded-md border border-line bg-transparent cursor-pointer"
            />
          </div>
        ) : (
          <div className="mb-3">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[12.5px] text-muted">Relief strength</span>
              <span className="font-bold text-[13px]" style={{ color: ACCENT }}>
                {brush.reliefStrength > 0 ? "Raise" : brush.reliefStrength < 0 ? "Lower" : "—"} {Math.abs(brush.reliefStrength).toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={brush.reliefStrength}
              onChange={(e) => onBrushChange({ ...brush, reliefStrength: Number(e.target.value) })}
              className="w-full accent-[#56a6e8]"
            />
          </div>
        )}

        {(
          [
            ["size", "Size", 2, 256, 1],
            ["opacity", "Opacity", 0.05, 1, 0.05],
            ["hardness", "Hardness", 0, 1, 0.05],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <div key={key} className="mb-2.5">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[12.5px] text-muted">{label}</span>
              <span className="font-semibold text-[12.5px]" style={{ color: ACCENT }}>
                {brush[key].toFixed(key === "size" ? 0 : 2)}
              </span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={brush[key]}
              onChange={(e) => onBrushChange({ ...brush, [key]: Number(e.target.value) })}
              className="w-full accent-[#56a6e8]"
            />
          </div>
        ))}

        <div className="flex gap-2 mt-3 pt-3 border-t border-line">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="flex-1 py-2 rounded-lg border border-line bg-panel2 text-[12.5px] font-semibold disabled:opacity-40"
          >
            Undo
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="flex-1 py-2 rounded-lg border border-line bg-panel2 text-[12.5px] font-semibold disabled:opacity-40"
          >
            Redo
          </button>
        </div>

        {/* Brush Alpha (shape mask) */}
        <div className="mt-4 pt-4 border-t border-line">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12.5px] text-muted font-medium">Brush shape</span>
            {brushAlpha && (
              <button onClick={() => onBrushAlphaChange(null)}
                className="text-[11px] px-2 py-0.5 rounded-full border"
                style={{ borderColor: "#5a2020", background: "#1a0a0a", color: "#e88" }}>
                Clear
              </button>
            )}
          </div>
          <AlphaUploader brushAlpha={brushAlpha} onBrushAlphaChange={onBrushAlphaChange} />
          <p className="text-[11px] text-dim mt-2">Greyscale PNG — white = full stroke, black = no stroke</p>
        </div>
      </StepCard>

      <StepCard title="Lights" description="Switch to Orbit mode to drag light balls. Click a ball to select it.">
        <div className="flex gap-2 mb-3">
          <button
            onClick={onAddLight}
            className="flex-1 py-2 rounded-lg border text-[12.5px] font-semibold"
            style={{ borderColor: ACCENT, background: "rgba(86,166,232,.14)", color: "#cfe6fb" }}
          >
            + Add light
          </button>
          <button
            onClick={() => onSetLightsGizmosVisible(!lightsGizmosVisible)}
            {...pillButton(!lightsGizmosVisible)}
            className={pillButton(!lightsGizmosVisible).className}
          >
            {lightsGizmosVisible ? "Hide" : "Show"}
          </button>
          <button
            onClick={onDeleteAllLights}
            className="text-[12px] px-2.5 py-1 rounded-full border capitalize"
            style={{ borderColor: "#5a2020", background: "#1a0a0a", color: "#e88" }}
          >
            Clear
          </button>
        </div>

        {selectedLight ? (
          <div className="flex flex-col gap-2.5 pt-3 border-t border-line">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-dim font-semibold">Selected light</span>
              <button
                onClick={onDeleteSelectedLight}
                className="text-[12px] px-2.5 py-0.5 rounded-full border"
                style={{ borderColor: "#5a2020", background: "#1a0a0a", color: "#e88" }}
              >
                Delete
              </button>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[12.5px] text-muted">Intensity</span>
                <span className="font-semibold text-[12.5px]" style={{ color: ACCENT }}>
                  {selectedLight.intensity.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={20}
                step={0.1}
                value={selectedLight.intensity}
                onChange={(e) => onSetLightIntensity(Number(e.target.value))}
                className="w-full accent-[#56a6e8]"
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[12.5px] text-muted">Range</span>
                <span className="font-semibold text-[12.5px]" style={{ color: ACCENT }}>
                  {selectedLight.distance === 0 ? "∞" : selectedLight.distance.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                step={0.5}
                value={selectedLight.distance}
                onChange={(e) => onSetLightDistance(Number(e.target.value))}
                className="w-full accent-[#56a6e8]"
              />
              <p className="text-[11px] text-dim mt-1">0 = no falloff</p>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-dim">No light selected. Switch to Orbit and click a light ball.</p>
        )}
      </StepCard>
    </div>
  );
}
