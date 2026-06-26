"use client";

import { BAKE_OPTIONS } from "@/lib/retopo/optimize";
import StepCard from "./StepCard";

const ACCENT = "#e2562a";

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
              style={{ borderColor: on ? ACCENT : "#26384a", background: on ? "rgba(226,86,42,.14)" : "#0d141c", color: on ? "#fff3ec" : "#8aa0b4" }}
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
        className="w-full accent-[#e2562a] mb-1.5"
      />
      <p className="text-[11px] text-dim mb-3">
        Pushes edge-texel color past each UV island&apos;s boundary so filtering never samples blank padding — the actual fix for bleeding at seams.
      </p>

      <button
        onClick={onFinalize}
        disabled={busy || disabled || working}
        className="w-full py-3 rounded-[10px] font-bold text-[13.5px] disabled:opacity-50"
        style={{ background: "#e2562a", color: "#fff3ec" }}
      >
        {working ? "Finalizing on Forge worker…" : "Finalize"}
      </button>

      {error && <p className="text-[12px] mt-2" style={{ color: "#e88" }}>{error}</p>}
    </StepCard>
  );
}
