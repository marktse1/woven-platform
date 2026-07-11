import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createWebIO } from "@/lib/gltf/io";
import { decompressGlbTextures } from "@/lib/textures/ktx2-decode";

// Mesh Painter's decode-on-read path: browsers can't createImageBitmap() a
// KTX2 blob, so before an asset's textures can be seeded onto the paint
// canvases they need to be decoded back to PNG server-side. Same
// storage-mediated shape as compress-ktx2/route.ts — decompresses in place
// and marks the asset as no-longer-compressed (it stays that way until the
// next save recompresses it, if the KTX2 toggle is on).
export const maxDuration = 120;

const BUCKET = "creator-assets";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { userId: string; assetId: string };
    const { userId, assetId } = body;
    if (!userId || !assetId) {
      return NextResponse.json({ error: "userId and assetId required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
    }

    const { data: asset, error: assetErr } = await admin
      .from("creator_assets")
      .select("id, storage_path, meta")
      .eq("id", assetId)
      .eq("clerk_user_id", userId)
      .single();
    if (assetErr || !asset) {
      return NextResponse.json({ error: "Asset not found or access denied" }, { status: 404 });
    }

    const { data: fileBlob, error: dlErr } = await admin.storage
      .from(BUCKET)
      .download(asset.storage_path as string);
    if (dlErr || !fileBlob) {
      return NextResponse.json({ error: "Failed to download asset" }, { status: 500 });
    }

    const inputBuf = await fileBlob.arrayBuffer();
    const io = createWebIO();
    const doc = await io.readBinary(new Uint8Array(inputBuf));

    await decompressGlbTextures(doc);

    const output = await io.writeBinary(doc);

    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(asset.storage_path as string, new Blob([Buffer.from(output)], { type: "model/gltf-binary" }), {
        contentType: "model/gltf-binary",
        upsert: true,
      });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const existingMeta = (asset.meta as Record<string, unknown> | null) ?? {};
    const { error: updateErr } = await admin
      .from("creator_assets")
      .update({
        file_bytes: output.byteLength,
        meta: { ...existingMeta, ktx2Compressed: false },
      })
      .eq("id", assetId);
    if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

    return NextResponse.json({ ok: true, fileBytes: output.byteLength });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[decompress-ktx2] error:", msg, e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
