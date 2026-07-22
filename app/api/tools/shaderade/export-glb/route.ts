import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import sharp from "sharp";
import { Document } from "@gltf-transform/core";
import { dedup, prune } from "@gltf-transform/functions";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createWebIO } from "@/lib/gltf/io";
import { compressGlbTextures } from "@/lib/textures/ktx2";
import { buildUvSphere } from "@/lib/shader-graph/sphereGeometry";
import { PBR_DEFAULTS } from "@/lib/shader-graph/compiler";

// Exports a Shaderade PBR material as a standalone GLB (a sphere carrying
// the material), saved to My Assets — the way Three.js/Babylon.js/
// PlayCanvas actually receive a "pure PBR" material in practice: their glTF
// loaders auto-build a native PBR material from an embedded glTF material
// block, not from hand-written shader code.
//
// Only channels that are unconnected (flat default), texture-backed, or fed
// by a literal Float/Color node can be represented — a glTF material has no
// way to express arbitrary node-graph logic (Noise, math chains, etc). The
// client (ShaderadeClient.tsx's gatherExportChannels) is responsible for
// classifying the graph and refusing to call this route for unsupported
// channels; this route trusts the classification it's given.
export const maxDuration = 120;

const BUCKET = "creator-assets";

type ChannelInput3 = { kind: "texture"; assetId: string } | { kind: "literal"; rgb: [number, number, number] } | null;
type ChannelInput1 = { kind: "texture"; assetId: string } | { kind: "literal"; value: number } | null;

type ExportGlbBody = {
  materialName: string;
  shaderGraphAssetId: string;
  channels: {
    albedo: ChannelInput3;
    normal: ChannelInput3;
    roughness: ChannelInput1;
    metallic: ChannelInput1;
    ao: ChannelInput1;
    emissive: ChannelInput3;
  };
  normalYFlip: boolean;
  normalStrength: number;
  aoStrength: number;
  roughnessStrength: number;
};

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as ExportGlbBody;
    const { materialName, shaderGraphAssetId, channels } = body;
    const normalYFlip = body.normalYFlip === true;
    const normalStrength = body.normalStrength ?? 1;
    const aoStrength = body.aoStrength ?? 1;
    const roughnessStrength = body.roughnessStrength ?? 1;

    if (!materialName || !shaderGraphAssetId || !channels) {
      return NextResponse.json({ error: "materialName, shaderGraphAssetId, channels required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
    }

    // Verify the source shader graph asset belongs to this user — it
    // becomes the derived_from_asset_id link below.
    const { data: shaderAsset, error: shaderErr } = await admin
      .from("creator_assets")
      .select("id")
      .eq("id", shaderGraphAssetId)
      .eq("clerk_user_id", userId)
      .single();
    if (shaderErr || !shaderAsset) {
      return NextResponse.json({ error: "Shader graph asset not found or access denied" }, { status: 404 });
    }

    // Download every distinct texture-backed asset referenced, once each.
    const textureAssetIds = new Set<string>();
    for (const ch of Object.values(channels)) {
      if (ch && ch.kind === "texture") textureAssetIds.add(ch.assetId);
    }
    const textureBytes = new Map<string, Buffer>();
    for (const assetId of textureAssetIds) {
      const { data: texAsset, error: texErr } = await admin
        .from("creator_assets")
        .select("id, storage_path, format")
        .eq("id", assetId)
        .eq("clerk_user_id", userId)
        .single();
      if (texErr || !texAsset) {
        return NextResponse.json({ error: `Texture asset ${assetId} not found or access denied` }, { status: 404 });
      }
      const { data: blob, error: dlErr } = await admin.storage
        .from(BUCKET)
        .download(texAsset.storage_path as string);
      if (dlErr || !blob) {
        return NextResponse.json({ error: `Failed to download texture ${assetId}` }, { status: 500 });
      }
      textureBytes.set(assetId, Buffer.from(await blob.arrayBuffer()));
    }

    // Re-encodes to PNG unless the source is already a glTF-legal embedded
    // image type (PNG/JPEG) — cheapest path when no conversion is needed.
    async function toEmbeddable(assetId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
      const raw = textureBytes.get(assetId)!;
      const meta = await sharp(raw).metadata();
      if (meta.format === "png") return { bytes: new Uint8Array(raw), mimeType: "image/png" };
      if (meta.format === "jpeg") return { bytes: new Uint8Array(raw), mimeType: "image/jpeg" };
      const png = await sharp(raw).png().toBuffer();
      return { bytes: new Uint8Array(png), mimeType: "image/png" };
    }

    // ── Build the Document from scratch ──────────────────────────────────
    const doc = new Document();
    const buf = doc.createBuffer();

    // gltf-transform's TypedArray type pins the buffer type param to
    // ArrayBuffer specifically; plain `new Float32Array(number[])` infers a
    // broader ArrayBufferLike in this TS/lib combo even though it's always
    // backed by a real ArrayBuffer at runtime — same cast idiom already
    // used in lib/retopo/bake.ts for this exact mismatch.
    const asAccessorArray = <T,>(arr: T) => arr as unknown as Parameters<ReturnType<typeof doc.createAccessor>["setArray"]>[0];

    const sphere = buildUvSphere(32, 16, 0.5);
    const posAcc = doc.createAccessor("position").setType("VEC3").setArray(asAccessorArray(sphere.positions)).setBuffer(buf);
    const normAcc = doc.createAccessor("normal").setType("VEC3").setArray(asAccessorArray(sphere.normals)).setBuffer(buf);
    const uvAcc = doc.createAccessor("uv").setType("VEC2").setArray(asAccessorArray(sphere.uvs)).setBuffer(buf);
    const idxAcc = doc.createAccessor("indices").setType("SCALAR").setArray(asAccessorArray(sphere.indices)).setBuffer(buf);

    const material = doc.createMaterial(materialName);

    // Albedo
    if (channels.albedo?.kind === "texture") {
      const { bytes, mimeType } = await toEmbeddable(channels.albedo.assetId);
      const tex = doc.createTexture("albedo").setImage(bytes).setMimeType(mimeType).setURI("");
      material.setBaseColorTexture(tex);
      material.setBaseColorFactor([1, 1, 1, 1]);
    } else {
      const rgb = channels.albedo?.kind === "literal" ? channels.albedo.rgb : PBR_DEFAULTS.albedo;
      material.setBaseColorFactor([rgb[0], rgb[1], rgb[2], 1]);
    }

    // Emissive
    if (channels.emissive?.kind === "texture") {
      const { bytes, mimeType } = await toEmbeddable(channels.emissive.assetId);
      const tex = doc.createTexture("emissive").setImage(bytes).setMimeType(mimeType).setURI("");
      material.setEmissiveTexture(tex);
      material.setEmissiveFactor([1, 1, 1]);
    } else {
      const rgb = channels.emissive?.kind === "literal" ? channels.emissive.rgb : PBR_DEFAULTS.emissive;
      material.setEmissiveFactor([rgb[0], rgb[1], rgb[2]]);
    }

    // Normal — setNormalScale always applies (harmlessly unused with no
    // texture); the Y-flip has no glTF equivalent, so it's baked into the
    // texture's G channel directly to match what the live preview shows.
    material.setNormalScale(normalStrength);
    if (channels.normal?.kind === "texture") {
      let { bytes, mimeType } = await toEmbeddable(channels.normal.assetId);
      if (normalYFlip) {
        const { data, info } = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixels = new Uint8Array(data);
        for (let i = 1; i < pixels.length; i += 4) pixels[i] = 255 - pixels[i];
        const png = await sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } })
          .png()
          .toBuffer();
        bytes = new Uint8Array(png);
        mimeType = "image/png";
      }
      const tex = doc.createTexture("normal").setImage(bytes).setMimeType(mimeType).setURI("");
      material.setNormalTexture(tex);
    }

    // Roughness / Metallic / AO — combined into one ORM texture (R=AO,
    // G=roughness, B=metallic) when at least one is texture-backed, per
    // glTF's own metallicRoughnessTexture convention (roughness+metallic
    // are ALWAYS one texture by spec) plus the common ORM extension of also
    // packing AO into the same texture's R channel. roughnessFactor/
    // metallicFactor are always set too — glTF multiplies factor * texture,
    // so this is what makes literal/default channels correct even when
    // packed alongside a texture-backed sibling.
    const roughnessLiteral = channels.roughness?.kind === "literal" ? channels.roughness.value : PBR_DEFAULTS.roughness;
    const metallicLiteral = channels.metallic?.kind === "literal" ? channels.metallic.value : PBR_DEFAULTS.metallic;
    material.setRoughnessFactor(roughnessLiteral * roughnessStrength);
    material.setMetallicFactor(metallicLiteral);

    const roughnessTexAssetId = channels.roughness?.kind === "texture" ? channels.roughness.assetId : null;
    const metallicTexAssetId = channels.metallic?.kind === "texture" ? channels.metallic.assetId : null;
    const aoTexAssetId = channels.ao?.kind === "texture" ? channels.ao.assetId : null;

    if (roughnessTexAssetId || metallicTexAssetId || aoTexAssetId) {
      // Shaderade always wires roughness/metallic/ao via a Texture2D node's
      // .r output — single-channel-by-convention, so R is "the" value here,
      // not a guess.
      const dims = await Promise.all(
        [roughnessTexAssetId, metallicTexAssetId, aoTexAssetId]
          .filter((id): id is string => !!id)
          .map((id) => sharp(textureBytes.get(id)!).metadata()),
      );
      const width = Math.max(...dims.map((d) => d.width ?? 1));
      const height = Math.max(...dims.map((d) => d.height ?? 1));

      async function channelR(assetId: string | null): Promise<Uint8Array | null> {
        if (!assetId) return null;
        const { data } = await sharp(textureBytes.get(assetId)!)
          .resize(width, height)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const pixels = new Uint8Array(data);
        const out = new Uint8Array(width * height);
        for (let i = 0; i < out.length; i++) out[i] = pixels[i * 4];
        return out;
      }

      const [rChan, gChan, bChan] = await Promise.all([
        channelR(aoTexAssetId),
        channelR(roughnessTexAssetId),
        channelR(metallicTexAssetId),
      ]);

      const orm = new Uint8Array(width * height * 3);
      for (let i = 0; i < width * height; i++) {
        orm[i * 3] = rChan ? rChan[i] : 255;
        orm[i * 3 + 1] = gChan ? gChan[i] : 255;
        orm[i * 3 + 2] = bChan ? bChan[i] : 255;
      }
      const ormPng = await sharp(Buffer.from(orm), { raw: { width, height, channels: 3 } }).png().toBuffer();
      const ormTex = doc.createTexture("orm").setImage(new Uint8Array(ormPng)).setMimeType("image/png").setURI("");
      material.setMetallicRoughnessTexture(ormTex);
      if (aoTexAssetId) {
        material.setOcclusionTexture(ormTex);
        material.setOcclusionStrength(aoStrength);
      }
    }

    const prim = doc.createPrimitive()
      .setAttribute("POSITION", posAcc)
      .setAttribute("NORMAL", normAcc)
      .setAttribute("TEXCOORD_0", uvAcc)
      .setIndices(idxAcc)
      .setMaterial(material);

    const mesh = doc.createMesh("ShaderadeMaterialSphere").addPrimitive(prim);
    const node = doc.createNode("Sphere").setMesh(mesh);
    const scene = doc.createScene("Scene").addChild(node);
    doc.getRoot().setDefaultScene(scene);

    await doc.transform(dedup(), prune());
    await compressGlbTextures(doc);

    const io = createWebIO();
    const output = await io.writeBinary(doc);

    const outputId = crypto.randomUUID();
    const safeName = materialName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const outputPath = `${userId}/${outputId}-${safeName}.glb`;

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
        name: `${materialName}.glb`,
        kind: "model",
        format: "glb",
        visibility: "private",
        storage_path: outputPath,
        file_bytes: output.byteLength,
        poly_count: sphere.indices.length / 3,
        meta: {
          pipelineOp: "shaderade-export",
          sourceAssetId: shaderGraphAssetId,
          normalYFlip,
          normalStrength,
          aoStrength,
          roughnessStrength,
        },
        derived_from_asset_id: shaderGraphAssetId,
      })
      .select("id")
      .single();
    if (insertErr || !outputAsset) {
      throw new Error(`DB insert failed: ${insertErr?.message ?? "no data returned"}`);
    }

    return NextResponse.json({ ok: true, assetId: outputAsset.id, fileBytes: output.byteLength });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[shaderade export-glb] error:", msg, e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
