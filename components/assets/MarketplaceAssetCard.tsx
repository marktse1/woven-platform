"use client";

import { useState } from "react";
import Link from "next/link";
import { signedAssetUrl, type AssetRow } from "@/lib/assets";

// Slim, buyer-facing card — deliberately not a reuse of AssetLibraryRow,
// which carries owner-only chrome (rename, delete, the visibility select
// itself, bulk-select mode) that has no place on a public storefront card.

const KIND_LABEL: Record<string, string> = { model: "Model", texture: "Texture", shader_graph: "Shader", other: "Other" };

type GradPair = [string, string];
const pal: GradPair[] = [
  ["#3a7fc4", "#7d4bd0"], ["#2aa6c4", "#15527a"], ["#5cb85c", "#1e7a4a"],
  ["#e8794b", "#b8431a"], ["#4b7fd0", "#2a3f7a"], ["#c44b9a", "#6a2a7a"],
];

function formatPrice(cents: number): string {
  return cents <= 0 ? "Free" : `$${(cents / 100).toFixed(2)}`;
}

export default function MarketplaceAssetCard({
  asset,
  creatorName,
  creatorHandle,
}: {
  asset: AssetRow;
  creatorName: string;
  creatorHandle: string | null;
}) {
  const [downloading, setDownloading] = useState(false);
  const pair = pal[asset.name.length % pal.length];

  async function handleDownload() {
    setDownloading(true);
    try {
      const url = await signedAssetUrl(asset.storage_path);
      window.open(url, "_blank");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="bg-panel border border-line rounded-lg overflow-hidden">
      {asset.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.thumbnail_url} alt={asset.name} className="w-full h-[130px] object-cover" />
      ) : (
        <div className="relative overflow-hidden h-[130px]" style={{ background: `linear-gradient(140deg, ${pair[0]}, ${pair[1]})` }}>
          <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 25% 14%, rgba(255,255,255,.30), transparent 60%)" }} />
        </div>
      )}
      <div className="px-3 pt-2.5 pb-3">
        <div className="text-[14px] font-semibold truncate">{asset.name}</div>
        <div className="text-[11px] text-dim mt-0.5">{KIND_LABEL[asset.kind] ?? asset.kind}</div>
        {creatorHandle ? (
          <Link href={`/studio/${creatorHandle}`} className="text-[11px] text-accent no-underline hover:underline">{creatorName}</Link>
        ) : (
          <span className="text-[11px] text-dim">{creatorName}</span>
        )}
        <div className="flex items-center justify-between mt-2.5">
          {asset.visibility === "public" ? (
            <>
              <span className="text-accent font-bold text-[12px]">Free</span>
              <button onClick={handleDownload} disabled={downloading}
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                style={{ background: "rgba(86,166,232,.14)", color: "#8fc6f0", border: "1px solid #2c6aa0" }}>
                {downloading ? "…" : "Download"}
              </button>
            </>
          ) : (
            <>
              <span className="font-bold text-[13px]">{formatPrice(asset.price_cents)}</span>
              <Link href={`/checkout?assetId=${asset.id}`}
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg no-underline"
                style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
                Buy
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
