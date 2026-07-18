"use client";

import { useState } from "react";
import { setAssetVisibility, deleteAsset, type AssetRow, type Visibility } from "@/lib/assets";

// Named *Row, not AssetRow, to avoid colliding with the AssetRow type this
// file imports from lib/assets. Visual pattern (select styling, chip
// colors) intentionally matches the existing inline asset lists in
// SubstanceWeaverClient.tsx/RetopologyClient.tsx — the plan is for this to
// be the one shared component both the "my assets" panel and a future
// asset-marketplace listing card pull from, instead of three copies of the
// same row drifting apart.
const KIND_LABEL: Record<string, string> = { model: "Model", texture: "Texture", other: "Other" };

export default function AssetLibraryRow({
  asset,
  onChange,
}: {
  asset: AssetRow;
  onChange: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [priceInput, setPriceInput] = useState(() => (asset.price_cents / 100).toFixed(2));

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

  return (
    <div className="flex flex-col gap-1.5 px-3.5 py-2.5 border-b border-line last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-ink truncate" title={asset.name}>{asset.name}</span>
        <button
          onClick={handleDelete}
          disabled={saving}
          className="text-[12px] text-dim hover:text-[#e88] shrink-0 disabled:opacity-40"
        >
          ✕
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[.06em] text-dim">
          {KIND_LABEL[asset.kind] ?? asset.kind} · {asset.format}
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
