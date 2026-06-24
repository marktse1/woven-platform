"use client";

import StepCard from "../retopology/StepCard";
import type { BrushSettings, PaintChannel, ViewChannel } from "@/components/tools/PaintViewer";
import type { Rgb } from "@/lib/paint/brush";

const ACCENT = "#56a6e8";

function rgbToHex(c: Rgb): string {
  return "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const VIEW_CHANNELS: { value: ViewChannel; label: string }[] = [
  { value: "combined", label: "Combined" },
  { value: "albedo", label: "Albedo" },
  { value: "normal", label: "Normal" },
  { value: "ao", label: "AO" },
];

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
  paintMode: boolean;
  onPaintModeChange: (v: boolean) => void;
  paintChannel: PaintChannel;
  onPaintChannelChange: (c: PaintChannel) => void;
  erasing: boolean;
  onErasingChange: (v: boolean) => void;
  brush: BrushSettings;
  onBrushChange: (b: BrushSettings) => void;
  viewChannel: ViewChannel;
  onViewChannelChange: (c: ViewChannel) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  busy: boolean;
};

export default function BrushPanel({
  paintMode,
  onPaintModeChange,
  paintChannel,
  onPaintChannelChange,
  erasing,
  onErasingChange,
  brush,
  onBrushChange,
  viewChannel,
  onViewChannelChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  busy,
}: Props) {
  return (
    <div className="flex flex-col gap-5">
      <StepCard title="Mode" description="Drag to paint, or switch to orbit to rotate the model.">
        <div className="flex gap-2">
          {([false, true] as const).map((paint) => (
            <button
              key={String(paint)}
              onClick={() => onPaintModeChange(paint)}
              className="flex-1 py-2 rounded-lg border text-[12.5px] font-semibold"
              style={{
                borderColor: paintMode === paint ? ACCENT : "#26384a",
                background: paintMode === paint ? "rgba(86,166,232,.14)" : "#0d141c",
                color: paintMode === paint ? "#cfe6fb" : "#8aa0b4",
              }}
            >
              {paint ? "Paint" : "Orbit"}
            </button>
          ))}
        </div>
      </StepCard>

      <StepCard title="Brush" description="Paint color (albedo) or relief detail (height -> normal map).">
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
      </StepCard>

      <StepCard title="View channel" description="Preview the live painted result, or inspect a single texture.">
        <div className="flex flex-wrap gap-1.5">
          {VIEW_CHANNELS.map((c) => (
            <button key={c.value} onClick={() => onViewChannelChange(c.value)} {...pillButton(viewChannel === c.value)}>
              {c.label}
            </button>
          ))}
        </div>
      </StepCard>

      <button
        onClick={onSave}
        disabled={busy}
        className="w-full py-3.5 rounded-[10px] font-bold text-[14px] disabled:opacity-50"
        style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}
      >
        {busy ? "Saving…" : "Save as new asset"}
      </button>
    </div>
  );
}
