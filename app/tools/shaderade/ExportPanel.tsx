"use client";

import { useState } from "react";
import type { CompileResult } from "@/lib/shader-graph/compiler";
import { exportThreeJs, exportBabylon, exportPlayCanvas, exportGlsl } from "@/lib/shader-graph/export";

type Tab = "threejs" | "babylon" | "playcanvas" | "glsl";

const TABS: { id: Tab; label: string }[] = [
  { id: "threejs", label: "Three.js" },
  { id: "babylon", label: "Babylon.js" },
  { id: "playcanvas", label: "PlayCanvas" },
  { id: "glsl", label: "Raw GLSL" },
];

type Props = {
  compiled: CompileResult | null;
};

export default function ExportPanel({ compiled }: Props) {
  const [tab, setTab] = useState<Tab>("threejs");
  const [copied, setCopied] = useState(false);

  const getCode = (): string => {
    if (!compiled || !compiled.ok) return "";
    switch (tab) {
      case "threejs": return exportThreeJs(compiled);
      case "babylon": return exportBabylon(compiled);
      case "playcanvas": return exportPlayCanvas(compiled);
      case "glsl": return exportGlsl(compiled);
    }
  };

  const code = getCode();

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex flex-col h-full bg-[#0e0b08] border-t border-[#2a2320]">
      {/* Tab bar */}
      <div className="flex border-b border-[#2a2320] px-2 pt-2 gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-t text-[11px] font-semibold transition-colors ${
              tab === t.id
                ? "bg-[#1e1a17] text-[#e8875a] border border-b-0 border-[#2a2320]"
                : "text-dim hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={copy}
          disabled={!code}
          className="px-3 py-1.5 mb-1 rounded text-[11px] font-semibold bg-[#e8875a] hover:bg-[#d4713f] disabled:opacity-40 disabled:cursor-not-allowed text-[#0e0b08] transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Code area */}
      <div className="flex-1 overflow-auto p-3">
        {!compiled || !compiled.ok ? (
          <p className="text-[11px] text-dim">
            {compiled && !compiled.ok ? compiled.error : "Connect nodes to generate shader code."}
          </p>
        ) : (
          <pre className="text-[11px] text-[#c8c0d8] font-mono whitespace-pre-wrap leading-relaxed">
            {code}
          </pre>
        )}
      </div>
    </div>
  );
}
