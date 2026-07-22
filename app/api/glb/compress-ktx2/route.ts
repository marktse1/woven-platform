import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createWebIO } from "@/lib/gltf/io";
import { compressGlbTextures } from "@/lib/textures/ktx2";

// Shared KTX2 compression pass for tools that save 100% client-side (Mesh
// Sculptor, Mesh Painter) — they upload the uncompressed GLB via uploadAsset()
// first, then call this route with the resulting asset id. Storage-mediated
// (asset id in, not raw bytes) because Vercel Functions cap request/response
// bodies at 4.5MB, well under a typical textured GLB. Compresses in place and
// updates the same asset row/storage object rather than minting a new asset,
// since this is a finishing touch on a save that just happened, not an
// independently-browsable pipeline step (contrast with Mesh Loom's bake route).
export const maxDuration = 120;

const BUCKET = "creator-assets";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as { assetId: string };
    const { assetId } = body;
    if (!assetId) {
      return NextResponse.json({ error: "assetId required" }, { status: 400 });
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

    await compressGlbTextures(doc);

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
        meta: { ...existingMeta, ktx2Compressed: true },
      })
      .eq("id", assetId);
    if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

    return NextResponse.json({ ok: true, fileBytes: output.byteLength });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[compress-ktx2] error:", msg, e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
