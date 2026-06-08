"use client";
import { useState } from "react";

export default function Chip({
  label, dot, defaultOn = false, onToggle, exclusive = false,
}: {
  label: string; dot?: string; defaultOn?: boolean;
  onToggle?: (on: boolean) => void; exclusive?: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      onClick={() => { const next = !on; setOn(next); onToggle?.(next); }}
      className="inline-flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-full border cursor-pointer select-none transition-all"
      style={{
        background: on ? "rgba(86,166,232,.14)" : "#1b2836",
        borderColor: on ? "#56a6e8" : "#26384a",
        color: on ? "#cfe6fb" : "#e7eef4",
      }}>
      {dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />}
      {label}
    </button>
  );
}
