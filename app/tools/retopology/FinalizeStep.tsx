"use client";

import { BAKE_OPTIONS } from "@/lib/retopo/optimize";
import type { TextureChannel } from "@/components/tools/ModelViewer";
import StepCard from "./StepCard";

const ACCENT = "#56a6e8";

const CHANNELS: { value: TextureChannel; label: string }[] = [
  { value: "albedo", label: "Albedo" },
  { value: "normal", label: "Normal" },
  { value: "ao", label: "AO" },
  { value: "roughness", label: "Roughness" },
  { value: "metallic", label: "Metallic" },
];

type Props = {
  stepNumber: number;
  bakeMaps: string[];
  onToggleBakeMap: (map: string) => void;
  dilationPx: number;
  onDilationChange: (px: number) => void;
  onFinalize: () => void;
  busy: boolean;
  disabled: boolean;
  pendingStatus?: "queued" | "processing" | "done" | "failed" | null;
  error?: string | null;
  textureChannel: TextureChannel | null;
  onTextureChannelChange: (c: TextureChannel | null) => void;
  hasFinalResult: boolean;
};

export default function FinalizeStep({
  stepNumber,
  bakeMaps,
  onToggleBakeMap,
  dilationPx,
  onDilationChange,
  onFinalize,
  busy,
  disabled,
  pendingStatus,
  error,
  textureChannel,
  onTextureChannelChange,
  hasFinalResult,
}: Props) {
  const working = pendingStatus === "queued" || pendingStatus === "processing";

  return (
    <StepCard
      title={`${stepNumber} · Finalize`}
      description="Deterministic UV unwrap + hi→lo bake (albedo/AO/normal) on the Forge worker — no generative AI, dilated past seams so it never bleeds."
      disabled={disabled}
    >
      <div className="flex flex-wrap gap-1.5 mb-3">
        {BAKE_OPTIONS.map((m) => {
          const on = bakeMaps.includes(m);
          return (
            <button
              key={m}
              onClick={() => onToggleBakeMap(m)}
              className="text-[12px] px-2.5 py-1 rounded-full border capitalize"
              style={{ borderColor: on ? ACCENT : "#26384a", background: on ? "rgba(86,166,232,.14)" : "#0d141c", color: on ? "#cfe6fb" : "#8aa0b4" }}
            >
              {m}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-[12.5px] text-muted">Seam dilation</span>
        <span className="font-bold text-[13px]" style={{ color: ACCENT }}>{dilationPx}px</span>
      </div>
      <input
        type="range"
        min={4}
        max={32}
        step={2}
        value={dilationPx}
        onChange={(e) => onDilationChange(Number(e.target.value))}
        className="w-full accent-[#56a6e8] mb-1.5"
      />
      <p className="text-[11px] text-dim mb-3">
        Pushes edge-texel color past each UV island&apos;s boundary so filtering never samples blank padding — the actual fix for bleeding at seams.
      </p>

      <button
        onClick={onFinalize}
        disabled={busy || disabled || working}
        className="w-full py-3 rounded-[10px] font-bold text-[13.5px] disabled:opacity-50"
        style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}
      >
        {working ? "Finalizing on Forge worker…" : "Finalize"}
      </button>

      {error && <p className="text-[12px] mt-2" style={{ color: "#e88" }}>{error}</p>}

      {hasFinalResult && (
        <div className="mt-3 pt-3 border-t border-line">
          <p className="text-[12px] text-muted mb-2">Preview baked map</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onTextureChannelChange(null)}
              className="text-[12px] px-2.5 py-1 rounded-full border"
              style={{ borderColor: !textureChannel ? ACCENT : "#26384a", background: !textureChannel ? "rgba(86,166,232,.14)" : "#0d141c", color: !textureChannel ? "#cfe6fb" : "#8aa0b4" }}
            >
              Shaded
            </button>
            {CHANNELS.map((c) => (
              <button
                key={c.value}
                onClick={() => onTextureChannelChange(c.value)}
                className="text-[12px] px-2.5 py-1 rounded-full border"
                style={{ borderColor: textureChannel === c.value ? ACCENT : "#26384a", background: textureChannel === c.value ? "rgba(86,166,232,.14)" : "#0d141c", color: textureChannel === c.value ? "#cfe6fb" : "#8aa0b4" }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </StepCard>
  );
}
