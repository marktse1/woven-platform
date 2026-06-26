// Server-side UV unwrap + texture bake.
// Runs xatlas (via WASM, works in Node.js) to generate a packed UV atlas for
// the lo-res mesh, then rasterises every triangle into the new atlas space,
// sampling the original embedded textures at the original UV coordinates.
// Output is the same GLB with new UV layout and freshly baked textures.

import createXAtlas from "xatlas-wasm";
import sharp from "sharp";
import { WebIO, type Texture as GltfTexture } from "@gltf-transform/core";
import { dedup, prune } from "@gltf-transform/functions";

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
  bakeMaps?: string[]; // subset of ["albedo", "normal", "ao"]
  onProgress?: (stage: string, fraction: number) => void;
};

export async function unwrapAndBake(
  inputBuf: ArrayBuffer,
  opts: BakeOptions = {},
): Promise<Uint8Array> {
  const bakeMaps = opts.bakeMaps ?? ["albedo", "normal", "ao"];
  const onProgress = opts.onProgress;

  const io = new WebIO();
  const doc = await io.readBinary(new Uint8Array(inputBuf));
  const xatlasModule = await createXAtlas();

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getIndices() || !prim.getAttribute("POSITION")) continue;

      // Per-primitive material — each prim may reference different textures
      const mat = prim.getMaterial() ?? null;

      onProgress?.("decoding textures", 0.05);
      const [albedoSrc, normalSrc, aoSrc] = await Promise.all([
        bakeMaps.includes("albedo") ? decodeTex(mat?.getBaseColorTexture()) : Promise.resolve(null),
        bakeMaps.includes("normal") ? decodeTex(mat?.getNormalTexture())    : Promise.resolve(null),
        bakeMaps.includes("ao")     ? decodeTex(mat?.getOcclusionTexture()) : Promise.resolve(null),
      ]);

      // Skip prims with no embedded textures — avoid replacing valid UVs with a useless atlas
      if (!albedoSrc && !normalSrc && !aoSrc) continue;

      const rawPos = prim.getAttribute("POSITION")!.getArray()!;
      const rawIdx = prim.getIndices()!.getArray()!;
      const rawUV  = prim.getAttribute("TEXCOORD_0")?.getArray() ?? null;

      const positions = rawPos instanceof Float32Array ? rawPos : Float32Array.from(rawPos as ArrayLike<number>);
      const indices   = rawIdx instanceof Uint32Array  ? rawIdx  : Uint32Array.from(rawIdx as ArrayLike<number>);
      const origUVs   = rawUV instanceof Float32Array  ? rawUV   : (rawUV ? Float32Array.from(rawUV as ArrayLike<number>) : null);

      // Run xatlas to generate a new packed UV atlas
      onProgress?.("running xatlas", 0.15);
      const atlas = xatlasModule.createAtlas();
      const addErr = atlas.addMesh({ positions, indices });
      if (addErr !== 0) {
        atlas.destroy();
        throw new Error(`xatlas error: ${xatlasModule.addMeshErrorString(addErr)}`);
      }
      atlas.generate(
        { maxCost: 2, normalSeamWeight: 4, maxIterations: 1 },
        { resolution: ATLAS_SIZE, padding: 4, bilinear: true },
      );
      onProgress?.("uv atlas done", 0.25);

      const outMesh = atlas.getMesh(0);
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

        // Original UVs via xref — maps xatlas output vertex → input vertex index
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

      // Encode baked pixels to PNG and embed as new material textures
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
        if (name === "albedo" && mat) mat.setBaseColorTexture(newTex);
        if (name === "normal" && mat) mat.setNormalTexture(newTex);
        if (name === "ao"     && mat) mat.setOcclusionTexture(newTex);
      }

      // Expand all vertex attributes to the xatlas output vertex count
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

      // Write new UV layout and expanded index buffer
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
  return io.writeBinary(doc);
}
