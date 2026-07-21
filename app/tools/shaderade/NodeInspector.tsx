"use client";

import { useEffect, useState } from "react";
import type { Node } from "@xyflow/react";
import { getNodeDef, type ParamSpec } from "@/lib/shader-graph/nodes";

type Props = {
  node: Node | undefined;
  onChange: (patch: Record<string, unknown>) => void;
};

const fieldClass = "bg-[#18141c] border border-[#2a2320] rounded px-2 py-1 text-[11px] text-ink outline-none focus:border-[#5a4455]";

// Keeps the input's displayed text decoupled from the committed numeric
// value while the user is mid-edit. Committing on every keystroke (the
// previous behavior) meant clearing the field produced Number("") === 0,
// which snapped the controlled input back to "0" before the next keystroke
// landed — so typing "2" after clearing produced "02" instead of "2".
// Only finite, non-empty text commits upstream; blur resets to the last
// committed value if the field was left empty or unparseable (e.g. just "-").
function NumberField({ spec, value, onChange }: { spec: ParamSpec; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(Number.isFinite(value) ? value : 0));

  useEffect(() => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed !== value) {
      setText(String(Number.isFinite(value) ? value : 0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleChange(raw: string) {
    setText(raw);
    const parsed = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(parsed)) onChange(parsed);
  }

  const hasSlider = spec.min !== undefined && spec.max !== undefined;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-dim">{spec.label}</span>
        <input
          type="number"
          value={text}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? "any"}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => setText(String(Number.isFinite(value) ? value : 0))}
          className={`${fieldClass} w-20 text-right`}
        />
      </div>
      {hasSlider && (
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 0.01}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full"
          style={{ accentColor: "#e8875a" }}
        />
      )}
    </div>
  );
}

function BooleanField({ spec, value, onChange }: { spec: ParamSpec; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-[10px] text-dim">{spec.label}</span>
    </label>
  );
}

function Vec2Field({ spec, value, onChange }: { spec: ParamSpec; value: [number, number]; onChange: (v: [number, number]) => void }) {
  const [x, y] = value;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-dim">{spec.label}</span>
      <div className="flex gap-1.5">
        <input type="number" value={x} step="any" onChange={(e) => onChange([Number(e.target.value), y])} className={fieldClass} />
        <input type="number" value={y} step="any" onChange={(e) => onChange([x, Number(e.target.value)])} className={fieldClass} />
      </div>
    </div>
  );
}

// Generic per-node parameter panel — reads NODE_TYPES' `params` schema and
// renders a control per spec with no per-node-type special casing, so new
// node types get inspector support just by declaring `params`.
export default function NodeInspector({ node, onChange }: Props) {
  if (!node) {
    return (
      <div className="w-56 flex-shrink-0 border-l border-[#2a2320] bg-[#0e0b08] p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-dim mb-2">Inspector</p>
        <p className="text-[11px] text-dim">Select a node to edit its parameters.</p>
      </div>
    );
  }

  const def = getNodeDef(node.type as string);
  const params = def?.params ?? [];
  const data = (node.data ?? {}) as Record<string, unknown>;

  return (
    <div className="w-56 flex-shrink-0 border-l border-[#2a2320] bg-[#0e0b08] p-3 overflow-y-auto">
      <p className="text-[10px] font-bold uppercase tracking-widest text-dim mb-3">{def?.label ?? node.type}</p>
      {params.length === 0 ? (
        <p className="text-[11px] text-dim">No editable parameters.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {params.map((spec) => {
            const raw = data[spec.key] ?? spec.default;
            if (spec.type === "number") {
              return <NumberField key={spec.key} spec={spec} value={raw as number} onChange={(v) => onChange({ [spec.key]: v })} />;
            }
            if (spec.type === "boolean") {
              return <BooleanField key={spec.key} spec={spec} value={raw as boolean} onChange={(v) => onChange({ [spec.key]: v })} />;
            }
            if (spec.type === "vec2") {
              return <Vec2Field key={spec.key} spec={spec} value={raw as [number, number]} onChange={(v) => onChange({ [spec.key]: v })} />;
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
