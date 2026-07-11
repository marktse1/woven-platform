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
      reAtlas?: boolean;
      ktx2?: boolean;
      sourceAssetId?: string;
    };

    const { userId, loResAssetId, bakeMaps, reAtlas = true, ktx2 = true, sourceAssetId } = body;
    if (!userId || !loResAssetId) {
      return NextResponse.json({ error: "userId and loResAssetId required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
    }

    // Verify ownership and get the storage path.
    const { data: asset, error: assetErr } = await admin
      .from("creator_assets")
      .select("id, name, storage_path")
      .eq("id", loResAssetId)
      .eq("clerk_user_id", userId)
      .single();
    if (assetErr || !asset) {
      return NextResponse.json({ error: "Asset not found or access denied" }, { status: 404 });
    }

    // Download the lo-res GLB from storage.
    const { data: fileBlob, error: dlErr } = await admin.storage
      .from(BUCKET)
      .download(asset.storage_path as string);
    if (dlErr || !fileBlob) {
      return NextResponse.json({ error: "Failed to download asset" }, { status: 500 });
    }

    const inputBuf = await fileBlob.arrayBuffer();
    const maps = bakeMaps ?? ["albedo", "normal", "ao"];

    // Optionally download the source (hi-res) asset for texture data.
    let texSourceBuf: ArrayBuffer | undefined;
    if (sourceAssetId && sourceAssetId !== loResAssetId) {
      const { data: srcAsset } = await admin
        .from("creator_assets")
        .select("storage_path")
        .eq("id", sourceAssetId)
        .eq("clerk_user_id", userId)
        .single();
      if (srcAsset) {
        const { data: srcBlob } = await admin.storage
          .from(BUCKET)
          .download(srcAsset.storage_path as string);
        if (srcBlob) texSourceBuf = await srcBlob.arrayBuffer();
      }
    }

    // Stream NDJSON progress events to the client.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: object) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

        // Fire immediately so the progress bar appears right away.
        send({ stage: "starting", progress: 0.01 });

        try {
          const output = await unwrapAndBake(inputBuf, {
            bakeMaps: maps,
            reAtlas,
            ktx2,
            texSourceBuf,
            onProgress: (stage, progress) => send({ stage, progress }),
          });

          send({ stage: "uploading", progress: 0.95 });

          const baseName = (asset.name as string).replace(/\.(glb|gltf)$/i, "");
          const suffix = reAtlas ? "-baked" : "-textured";
          const outputName = `${baseName}${suffix}.glb`;
          const safeName = outputName.replace(/[^a-zA-Z0-9._-]/g, "_");
          const outputId = crypto.randomUUID();
          const outputPath = `${userId}/${outputId}-${safeName}`;

          const { error: upErr } = await admin.storage
            .from(BUCKET)
            .upload(outputPath, new Blob([Buffer.from(output)], { type: "model/gltf-binary" }), {
              contentType: "model/gltf-binary",
              upsert: false,
            });
          if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

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
              meta: { pipelineOp: "bake", bakeMaps: maps, reAtlas, ktx2, ktx2Compressed: ktx2 },
            })
            .select("id")
            .single();
          if (insertErr || !outputAsset) {
            throw new Error(`DB insert failed: ${insertErr?.message ?? "no data returned"}`);
          }

          send({ done: true, outputAssetId: outputAsset.id, progress: 1.0 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[bake] error:", msg, e);
          send({ error: msg });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bake] outer error:", msg, e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
