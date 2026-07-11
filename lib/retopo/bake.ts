// Server-side UV unwrap + texture bake.
//
// Two modes:
//   reAtlas=true  (default) — runs xatlas to generate a packed UV atlas, then
//                             rasterises each triangle to transfer textures into
//                             the new UV space.  Needed after retopology.
//   reAtlas=false           — preserves the existing TEXCOORD_0 layout.  Embeds
//                             textures from texSourceBuf (or from the lo-res
//                             itself when already embedded).  Much faster and
//                             correct for post-decimation use.

import createXAtlas from "xatlas-wasm";
import sharp from "sharp";
import { type Texture as GltfTexture } from "@gltf-transform/core";
import { dedup, prune } from "@gltf-transform/functions";
import { createWebIO } from "@/lib/gltf/io";
import { compressGlbTextures } from "@/lib/textures/ktx2";

const ATLAS_SIZE = 1024;

// ---------------------------------------------------------------------------
// Texture helpers
// ---------------------------------------------------------------------------

interface TexData {
  pixels: Uint8Array; // RGBA, row-major, top-left origin
  width: number;
  height: number;
}

async function decodeTex(tex: GltfTexture | null | undefined): Promise<TexData | null> {
  const img = tex?.getImage();
  if (!img) return null;
  const { data, info } = await sharp(Buffer.from(img))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Use new Uint8Array(data) — not data.buffer — to respect byteOffset when
  // the Buffer comes from Node's shared memory pool.
  return { pixels: new Uint8Array(data), width: info.width, height: info.height };
}

function sampleBilinear(t: TexData, u: number, v: number, out: number[]) {
  u = ((u % 1) + 1) % 1;
  v = ((v % 1) + 1) % 1;
  const fx = u * (t.width - 1);
  const fy = v * (t.height - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, t.width - 1), y1 = Math.min(y0 + 1, t.height - 1);
  const tx = fx - x0, ty = fy - y0;
  for (let c = 0; c < 4; c++) {
    out[c] = Math.round(
      t.pixels[(y0 * t.width + x0) * 4 + c] * (1 - tx) * (1 - ty) +
      t.pixels[(y0 * t.width + x1) * 4 + c] * tx * (1 - ty) +
      t.pixels[(y1 * t.width + x0) * 4 + c] * (1 - tx) * ty +
      t.pixels[(y1 * t.width + x1) * 4 + c] * tx * ty,
    );
  }
}

// ---------------------------------------------------------------------------
// Triangle rasteriser — fills pixels covered by a triangle in atlas space,
// sampling a source texture at interpolated original UV coordinates.
// ---------------------------------------------------------------------------

function rasteriseTri(
  out: Uint8Array,
  p: readonly [[number, number], [number, number], [number, number]], // atlas pixel coords
  uvOrig: readonly [[number, number], [number, number], [number, number]], // original UVs
  src: TexData,
) {
  const denom =
    (p[1][1] - p[2][1]) * (p[0][0] - p[2][0]) +
    (p[2][0] - p[1][0]) * (p[0][1] - p[2][1]);
  if (Math.abs(denom) < 1e-8) return;

  const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])));
  const maxX = Math.min(ATLAS_SIZE - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
  const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])));
  const maxY = Math.min(ATLAS_SIZE - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));

  const rgba = [0, 0, 0, 0];

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((p[1][1] - p[2][1]) * (px - p[2][0]) + (p[2][0] - p[1][0]) * (py - p[2][1])) / denom;
      const w1 = ((p[2][1] - p[0][1]) * (px - p[2][0]) + (p[0][0] - p[2][0]) * (py - p[2][1])) / denom;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;

      const u = w0 * uvOrig[0][0] + w1 * uvOrig[1][0] + w2 * uvOrig[2][0];
      const v = w0 * uvOrig[0][1] + w1 * uvOrig[1][1] + w2 * uvOrig[2][1];

      sampleBilinear(src, u, v, rgba);

      const idx = (y * ATLAS_SIZE + x) * 4;
      out[idx]     = rgba[0];
      out[idx + 1] = rgba[1];
      out[idx + 2] = rgba[2];
      out[idx + 3] = rgba[3];
    }
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type BakeOptions = {
  bakeMaps?: string[];     // subset of ["albedo", "normal", "ao"]
  reAtlas?: boolean;       // default true; false = preserve existing UVs
  texSourceBuf?: ArrayBuffer; // optional second GLB to read textures from
  ktx2?: boolean;          // default true; compress embedded textures to KTX2 before writing
  onProgress?: (stage: string, fraction: number) => void;
};

export async function unwrapAndBake(
  inputBuf: ArrayBuffer,
  opts: BakeOptions = {},
): Promise<Uint8Array> {
  const bakeMaps = opts.bakeMaps ?? ["albedo", "normal", "ao"];
  const reAtlas = opts.reAtlas ?? true;
  const ktx2 = opts.ktx2 ?? true;
  const onProgress = opts.onProgress;

  const io = createWebIO();
  const doc = await io.readBinary(new Uint8Array(inputBuf));

  // ---------------------------------------------------------------------------
  // Preserve-UV mode — no xatlas, just ensure textures are embedded.
  // ---------------------------------------------------------------------------
  if (!reAtlas) {
    onProgress?.("reading textures", 0.2);

    if (opts.texSourceBuf) {
      // Copy embedded textures from the source GLB into this doc's materials.
      // The source is typically the original hi-res upload; the lo-res mesh
      // already has the same UV layout (decimation preserves TEXCOORD_0).
      const srcDoc = await createWebIO().readBinary(new Uint8Array(opts.texSourceBuf));
      const srcMats = srcDoc.getRoot().listMaterials();
      const docMats = doc.getRoot().listMaterials();

      for (let mi = 0; mi < docMats.length; mi++) {
        const mat = docMats[mi];
        // Match by name first, fall back to positional index.
        const srcMat =
          srcMats.find((m) => m.getName() && m.getName() === mat.getName()) ??
          srcMats[mi] ??
          null;
        if (!srcMat) continue;

        const texSlots: Array<[GltfTexture | null, (t: GltfTexture | null) => void]> = [
          [srcMat.getBaseColorTexture(), (t) => mat.setBaseColorTexture(t)],
          [srcMat.getNormalTexture(),    (t) => mat.setNormalTexture(t)],
          [srcMat.getOcclusionTexture(), (t) => mat.setOcclusionTexture(t)],
        ];
        for (const [srcTex, setter] of texSlots) {
          const img = srcTex?.getImage();
          if (!img) continue;
          const copy = doc
            .createTexture(srcTex!.getName())
            .setImage(new Uint8Array(img))
            .setMimeType(srcTex!.getMimeType())
            .setURI("");
          setter(copy);
        }
      }
    } else {
      // No external source: verify the lo-res already has embedded textures.
      const hasAny = doc.getRoot().listMeshes()
        .flatMap((m) => m.listPrimitives())
        .some((p) => {
          const mat = p.getMaterial();
          return (
            mat &&
            (mat.getBaseColorTexture()?.getImage() ||
             mat.getNormalTexture()?.getImage() ||
             mat.getOcclusionTexture()?.getImage())
          );
        });
      if (!hasAny) {
        throw new Error(
          "No embedded textures found in the mesh. " +
          "The model may use external texture references or only baseColorFactor. " +
          "Provide a source asset with embedded textures, or enable 'Re-atlas UVs'.",
        );
      }
    }

    onProgress?.("encoding", 0.9);
    await doc.transform(dedup(), prune());
    if (ktx2) {
      onProgress?.("compressing textures", 0.95);
      await compressGlbTextures(doc);
    }
    return io.writeBinary(doc);
  }

  // ---------------------------------------------------------------------------
  // Re-atlas mode — run xatlas + rasterise textures into new UV space.
  // When texSourceBuf is provided (original hi-res upload), read textures from
  // there rather than from the lo-res mesh, which may have no embedded textures
  // after decimation. The lo-res TEXCOORD_0 values are compatible because UV-safe
  // decimation preserves vertex attributes on surviving vertices.
  // ---------------------------------------------------------------------------
  const xatlasModule = await createXAtlas();

  // Pre-load the hi-res source document once, outside the mesh loop.
  const srcDoc = opts.texSourceBuf
    ? await createWebIO().readBinary(new Uint8Array(opts.texSourceBuf))
    : null;
  const srcMatList = srcDoc?.getRoot().listMaterials() ?? [];

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getIndices() || !prim.getAttribute("POSITION")) continue;

      // Resolve the material to read textures from:
      // 1. Matching source material by name (hi-res → lo-res correspondence)
      // 2. First material in source doc (single-material models)
      // 3. Lo-res own material (fallback when no texSourceBuf provided)
      const lrMat = prim.getMaterial() ?? null;
      const srcMat: typeof lrMat =
        srcMatList.find((m) => m.getName() && m.getName() === lrMat?.getName()) ??
        (srcMatList[0] as typeof lrMat | undefined) ??
        lrMat;

      onProgress?.("decoding textures", 0.05);
      const [albedoSrc, normalSrc, aoSrc] = await Promise.all([
        bakeMaps.includes("albedo") ? decodeTex(srcMat?.getBaseColorTexture()) : Promise.resolve(null),
        bakeMaps.includes("normal") ? decodeTex(srcMat?.getNormalTexture())    : Promise.resolve(null),
        bakeMaps.includes("ao")     ? decodeTex(srcMat?.getOcclusionTexture()) : Promise.resolve(null),
      ]);

      if (!albedoSrc && !normalSrc && !aoSrc) {
        throw new Error(
          "No embedded textures found in the source model. " +
          "Make sure the original GLB has embedded textures (not external URI references).",
        );
      }

      const rawPos = prim.getAttribute("POSITION")!.getArray()!;
      const rawIdx = prim.getIndices()!.getArray()!;
      const rawUV  = prim.getAttribute("TEXCOORD_0")?.getArray() ?? null;

      const positions = rawPos instanceof Float32Array ? rawPos : Float32Array.from(rawPos as ArrayLike<number>);
      const indices   = rawIdx instanceof Uint32Array  ? rawIdx  : Uint32Array.from(rawIdx as ArrayLike<number>);
      const origUVs   = rawUV instanceof Float32Array  ? rawUV   : (rawUV ? Float32Array.from(rawUV as ArrayLike<number>) : null);

      onProgress?.("running xatlas", 0.15);
      const atlas = xatlasModule.createAtlas();
      const addErr = atlas.addMesh({ positions, indices });
      if (addErr !== 0) {
        atlas.destroy();
        throw new Error(`xatlas addMesh error: ${xatlasModule.addMeshErrorString(addErr)}`);
      }
      atlas.generate(
        { maxCost: 2, normalSeamWeight: 4, maxIterations: 1 },
        { resolution: ATLAS_SIZE, padding: 4, bilinear: true },
      );

      const outMesh = atlas.getMesh(0);
      if (outMesh.vertexCount === 0 || outMesh.indexCount === 0) {
        atlas.destroy();
        throw new Error(
          `xatlas produced an empty mesh (${indices.length / 3} input triangles). ` +
          "The mesh may contain degenerate triangles. Try 'Preserve original UVs' mode instead.",
        );
      }
      onProgress?.("uv atlas done", 0.25);

      const outVC = outMesh.vertexCount;

      // New UV coordinates (normalised to [0, 1])
      const newUVs = new Float32Array(outVC * 2);
      for (let i = 0; i < outVC; i++) {
        const v = outMesh.vertices[i];
        newUVs[i * 2]     = v.uv[0] / atlas.width;
        newUVs[i * 2 + 1] = v.uv[1] / atlas.height;
      }

      const bakedPixelSets: Array<{ pixels: Uint8Array; src: TexData; name: string }> = [];
      if (albedoSrc) {
        onProgress?.("baking albedo", 0.30);
        bakedPixelSets.push({ pixels: new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4), src: albedoSrc, name: "albedo" });
      }
      if (normalSrc) {
        onProgress?.("baking normal", 0.55);
        bakedPixelSets.push({ pixels: new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4), src: normalSrc, name: "normal" });
      }
      if (aoSrc) {
        onProgress?.("baking ao", 0.72);
        bakedPixelSets.push({ pixels: new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4), src: aoSrc, name: "ao" });
      }

      const triCount = outMesh.indexCount / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = outMesh.indices[t * 3];
        const i1 = outMesh.indices[t * 3 + 1];
        const i2 = outMesh.indices[t * 3 + 2];

        const p: [[number, number], [number, number], [number, number]] = [
          [newUVs[i0 * 2] * ATLAS_SIZE, newUVs[i0 * 2 + 1] * ATLAS_SIZE],
          [newUVs[i1 * 2] * ATLAS_SIZE, newUVs[i1 * 2 + 1] * ATLAS_SIZE],
          [newUVs[i2 * 2] * ATLAS_SIZE, newUVs[i2 * 2 + 1] * ATLAS_SIZE],
        ];

        // Original UVs via xref — maps xatlas output vertex → input vertex index.
        const getOrigUV = (outIdx: number): [number, number] => {
          if (!origUVs) return [0, 0];
          const src = outMesh.vertices[outIdx].xref;
          return [origUVs[src * 2], origUVs[src * 2 + 1]];
        };
        const uvOrig: [[number, number], [number, number], [number, number]] = [
          getOrigUV(i0), getOrigUV(i1), getOrigUV(i2),
        ];

        for (const { pixels, src } of bakedPixelSets) {
          rasteriseTri(pixels, p, uvOrig, src);
        }
      }

      // Encode baked pixels to PNG and embed as new material textures.
      onProgress?.("encoding", 0.88);
      for (const { pixels, name } of bakedPixelSets) {
        // Buffer.from(pixels) respects byteOffset; Buffer.from(pixels.buffer) would not.
        const pngBuf = await sharp(Buffer.from(pixels), {
          raw: { width: ATLAS_SIZE, height: ATLAS_SIZE, channels: 4 },
        })
          .png()
          .toBuffer();
        const newTex = doc
          .createTexture(name)
          // new Uint8Array(pngBuf) copies correctly; new Uint8Array(pngBuf.buffer) may not.
          .setImage(new Uint8Array(pngBuf))
          .setMimeType("image/png")
          .setURI("");
        if (name === "albedo" && lrMat) lrMat.setBaseColorTexture(newTex);
        if (name === "normal" && lrMat) lrMat.setNormalTexture(newTex);
        if (name === "ao"     && lrMat) lrMat.setOcclusionTexture(newTex);
      }

      // Expand all vertex attributes to the xatlas output vertex count.
      for (const semantic of prim.listSemantics()) {
        if (semantic === "TEXCOORD_0") continue;
        const acc = prim.getAttribute(semantic)!;
        const raw = acc.getArray()!;
        const stride = acc.getElementSize();
        const Ctor = (raw as unknown as { constructor: new (n: number) => ArrayBufferView }).constructor as new (n: number) => ArrayBufferView;
        const expanded = new Ctor(outVC * stride) as unknown as number[];
        const srcArr = raw as unknown as number[];
        for (let i = 0; i < outVC; i++) {
          const src = outMesh.vertices[i].xref;
          for (let c = 0; c < stride; c++) expanded[i * stride + c] = srcArr[src * stride + c];
        }
        acc.setArray(expanded as unknown as Parameters<typeof acc.setArray>[0]);
      }

      // Write new UV layout and expanded index buffer.
      const existingUVAcc = prim.getAttribute("TEXCOORD_0");
      if (existingUVAcc) {
        existingUVAcc.setArray(newUVs);
      } else {
        const buf = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
        prim.setAttribute(
          "TEXCOORD_0",
          doc.createAccessor().setType("VEC2").setArray(newUVs).setBuffer(buf),
        );
      }
      prim.getIndices()!.setArray(new Uint32Array(outMesh.indices));

      atlas.destroy();
    }
  }

  await doc.transform(dedup(), prune());
  if (ktx2) {
    onProgress?.("compressing textures", 0.95);
    await compressGlbTextures(doc);
  }
  return io.writeBinary(doc);
}
