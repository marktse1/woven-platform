"use client";

import type { Node } from "@xyflow/react";
import { getNodeDef, type ParamSpec } from "@/lib/shader-graph/nodes";

type Props = {
  node: Node | undefined;
  onChange: (patch: Record<string, unknown>) => void;
};

const fieldClass = "w-full bg-[#18141c] border border-[#2a2320] rounded px-2 py-1 text-[11px] text-ink outline-none focus:border-[#5a4455]";

function NumberField({ spec, value, onChange }: { spec: ParamSpec; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-dim">{spec.label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={spec.min}
        max={spec.max}
        step={spec.step ?? "any"}
        onChange={(e) => onChange(Number(e.target.value))}
        className={fieldClass}
      />
    </label>
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
