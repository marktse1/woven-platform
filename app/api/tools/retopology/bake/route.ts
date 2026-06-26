import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { unwrapAndBake } from "@/lib/retopo/bake";

// Allow up to 5 minutes — xatlas + per-pixel rasterisation for large meshes.
export const maxDuration = 300;

const BUCKET = "creator-assets";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId: string;
      loResAssetId: string;
      bakeMaps?: string[];
    };

    const { userId, loResAssetId, bakeMaps } = body;
    if (!userId || !loResAssetId) {
      return NextResponse.json({ error: "userId and loResAssetId required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
    }

    // Verify ownership and get the storage path
    const { data: asset, error: assetErr } = await admin
      .from("creator_assets")
      .select("id, name, storage_path")
      .eq("id", loResAssetId)
      .eq("clerk_user_id", userId)
      .single();
    if (assetErr || !asset) {
      return NextResponse.json({ error: "Asset not found or access denied" }, { status: 404 });
    }

    // Download the lo-res GLB from storage
    const { data: fileBlob, error: dlErr } = await admin.storage
      .from(BUCKET)
      .download(asset.storage_path as string);
    if (dlErr || !fileBlob) {
      return NextResponse.json({ error: "Failed to download asset" }, { status: 500 });
    }

    const inputBuf = await fileBlob.arrayBuffer();

    // Run UV unwrap + texture bake
    const output = await unwrapAndBake(inputBuf, {
      bakeMaps: bakeMaps ?? ["albedo", "normal", "ao"],
    });

    // Upload the baked GLB
    const baseName = (asset.name as string).replace(/\.(glb|gltf)$/i, "");
    const outputName = `${baseName}-baked.glb`;
    const safeName = outputName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const outputId = crypto.randomUUID();
    const outputPath = `${userId}/${outputId}-${safeName}`;

    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(outputPath, new Blob([output.buffer as ArrayBuffer], { type: "model/gltf-binary" }), {
        contentType: "model/gltf-binary",
        upsert: false,
      });
    if (upErr) {
      return NextResponse.json({ error: "Failed to upload baked result" }, { status: 500 });
    }

    const { data: outputAsset, error: insertErr } = await admin
      .from("creator_assets")
      .insert({
        id: outputId,
        clerk_user_id: userId,
        name: outputName,
        kind: "model",
        format: "glb",
        visibility: "private",
        storage_path: outputPath,
        file_bytes: output.byteLength,
        poly_count: null,
        meta: { pipelineOp: "bake", bakeMaps: bakeMaps ?? ["albedo", "normal", "ao"] },
      })
      .select("id")
      .single();
    if (insertErr || !outputAsset) {
      return NextResponse.json({ error: "Failed to record baked asset" }, { status: 500 });
    }

    return NextResponse.json({ outputAssetId: outputAsset.id });
  } catch (e) {
    console.error("[bake] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Bake failed" },
      { status: 500 },
    );
  }
}
