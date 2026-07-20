"use client";

import { useState } from "react";
import { setAssetVisibility, deleteAsset, renameAsset, type AssetRow, type Visibility } from "@/lib/assets";

// Named *Row, not AssetRow, to avoid colliding with the AssetRow type this
// file imports from lib/assets. Visual pattern (select styling, chip
// colors) intentionally matches the existing inline asset lists in
// SubstanceWeaverClient.tsx/RetopologyClient.tsx — the plan is for this to
// be the one shared component both the "my assets" panel and a future
// asset-marketplace listing card pull from, instead of three copies of the
// same row drifting apart.
const KIND_LABEL: Record<string, string> = { model: "Model", texture: "Texture", shader_graph: "Shader", other: "Other" };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function AssetLibraryRow({
  asset,
  onChange,
  onLoad,
  loadable = false,
  accent,
  selectMode = false,
  selected = false,
  onToggleSelect,
  childCount,
  expanded = false,
  onToggleExpanded,
  nested = false,
  derivedFromName,
  onJumpToSource,
  highlighted = false,
  setRowRef,
}: {
  asset: AssetRow;
  onChange: () => void;
  /** Present when a tool is mounted and registered as the active loader. */
  onLoad?: (asset: AssetRow) => void;
  /** Whether the active tool's `accepts` predicate passed for this asset. */
  loadable?: boolean;
  accent?: string;
  /** Bulk-select mode — shows a checkbox and disables load/delete-on-click. */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  /** Number of related assets nested under this row (a shader's textures, an original's edits) — undefined/0 means no expand toggle. */
  childCount?: number;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** Rendered inside a parent's expanded children list — indented, subtly tinted. */
  nested?: boolean;
  /** Name of the asset this one was derived from, if any and if currently loaded. */
  derivedFromName?: string;
  onJumpToSource?: () => void;
  /** Briefly highlighted after being jumped to from a "derived from" caption. */
  highlighted?: boolean;
  setRowRef?: (el: HTMLDivElement | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [priceInput, setPriceInput] = useState(() => (asset.price_cents / 100).toFixed(2));
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(asset.name);

  async function commitRename() {
    const trimmed = nameInput.trim();
    setRenaming(false);
    if (!trimmed || trimmed === asset.name) {
      setNameInput(asset.name);
      return;
    }
    setSaving(true);
    try {
      await renameAsset(asset.id, trimmed);
      onChange();
    } catch {
      setNameInput(asset.name);
    } finally {
      setSaving(false);
    }
  }

  async function updateVisibility(next: Visibility, priceCents = asset.price_cents) {
    setSaving(true);
    try {
      await setAssetVisibility(asset.id, next, { sharedWith: asset.shared_with, priceCents });
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function commitPrice() {
    const dollars = Number(priceInput);
    const cents = Number.isFinite(dollars) ? Math.max(0, Math.round(dollars * 100)) : 0;
    setPriceInput((cents / 100).toFixed(2));
    if (cents !== asset.price_cents) await updateVisibility(asset.visibility, cents);
  }

  async function handleDelete() {
    if (!confirm(`Delete "${asset.name}"? This can't be undone.`)) return;
    setSaving(true);
    try {
      await deleteAsset(asset);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  const clickable = !selectMode && loadable && !!onLoad;

  const rowStyle: React.CSSProperties = {
    ...(!loadable && onLoad !== undefined && !selectMode ? { opacity: 0.4 } : {}),
    ...(nested ? { background: "rgba(255,255,255,.025)" } : {}),
    ...(highlighted ? { outline: `1px solid ${accent ?? "#c47be8"}` } : {}),
  };

  return (
    <div
      ref={setRowRef}
      className="flex flex-col gap-1.5 px-3.5 py-2.5 border-b border-line last:border-b-0 transition-opacity"
      style={rowStyle}
      onClick={selectMode ? () => onToggleSelect?.(asset.id) : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        {selectMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(asset.id)}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0"
            style={{ accentColor: accent ?? "#c47be8", colorScheme: "dark" }}
          />
        )}
        {selectMode ? (
          <span className="text-[13px] text-ink truncate flex-1" title={asset.name}>{asset.name}</span>
        ) : renaming ? (
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setNameInput(asset.name);
                setRenaming(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            disabled={saving}
            className="text-[13px] text-ink bg-panel2 border border-line rounded px-1.5 py-0.5 flex-1 min-w-0 outline-none focus:border-accent"
          />
        ) : clickable ? (
          <button
            onClick={() => onLoad?.(asset)}
            className="text-[13px] text-left truncate hover:underline"
            style={{ color: accent ?? "var(--color-ink)" }}
            title={`Load "${asset.name}"`}
          >
            {asset.name}
          </button>
        ) : (
          <span className="text-[13px] text-ink truncate" title={asset.name}>{asset.name}</span>
        )}
        {!selectMode && !renaming && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setNameInput(asset.name);
              setRenaming(true);
            }}
            title="Rename"
            className="text-[11px] text-dim hover:text-ink shrink-0"
          >
            ✎
          </button>
        )}
        {!selectMode && (
          <button
            onClick={handleDelete}
            disabled={saving}
            className="text-[12px] text-dim hover:text-[#e88] shrink-0 disabled:opacity-40"
          >
            ✕
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[.06em] text-dim flex items-center gap-1.5">
          {KIND_LABEL[asset.kind] ?? asset.kind} · {asset.format}
          {childCount != null && childCount > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpanded?.();
              }}
              className="text-[10px] px-1.5 py-0.5 rounded-full normal-case tracking-normal text-dim hover:text-ink flex items-center gap-1"
              style={{ background: "rgba(255,255,255,.06)" }}
            >
              <span>{expanded ? "▾" : "▸"}</span>
              {childCount} {childCount === 1 ? "item" : "items"}
            </button>
          )}
        </span>
        <select
          value={asset.visibility}
          disabled={saving}
          onChange={(e) => updateVisibility(e.target.value as Visibility)}
          className="bg-panel2 border border-line rounded-md px-1.5 py-1 text-[11.5px] text-ink disabled:opacity-60"
        >
          <option value="private">Private</option>
          <option value="shared">Shared</option>
          <option value="public">Public</option>
          <option value="sellable">Sellable</option>
        </select>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10.5px] text-dim">{formatBytes(asset.file_bytes)}</span>
        {asset.poly_count != null && (
          <span className="text-[10.5px] text-dim">· {asset.poly_count.toLocaleString()} tris</span>
        )}
        {asset.kind === "model" && (
          asset.meta?.ktx2Compressed ? (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: `${accent ?? "#c47be8"}2e`, color: accent ?? "#c47be8" }}
            >
              KTX2
            </span>
          ) : (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full text-dim"
              style={{ background: "rgba(255,255,255,.06)" }}
            >
              Uncompressed
            </span>
          )
        )}
      </div>
      {derivedFromName && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onJumpToSource?.();
          }}
          className="text-[10.5px] text-dim hover:underline text-left truncate"
          title={`Derived from "${derivedFromName}"`}
        >
          derived from {derivedFromName}
        </button>
      )}
      {asset.visibility === "sellable" && (
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[12px] font-semibold" style={{ color: "var(--color-buy1)" }}>$</span>
          <input
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            onBlur={commitPrice}
            disabled={saving}
            inputMode="decimal"
            className="w-16 bg-[#0a0e13] border border-line rounded-md px-2 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-60"
          />
          <span className="text-[11px] text-dim">marketplace price</span>
        </div>
      )}
    </div>
  );
}
