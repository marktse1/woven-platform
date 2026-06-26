// Tier-1 UV unwrap — runs in the browser using the xatlas WASM build.
//
// xatlas generates a packed, non-overlapping UV atlas from positions + indices.
// Seam splits mean the output vertex count can exceed the input's — we expand
// every attribute accessor (POSITION, NORMAL, existing UVs, etc.) to match the
// new vertex layout, then write the fresh atlas UVs into TEXCOORD_0.

import createXAtlas from "xatlas-wasm";
import { WebIO, type Mesh, type Primitive } from "@gltf-transform/core";
import { dedup, prune } from "@gltf-transform/functions";

export type UVUnwrapResult = {
  output: Uint8Array;
  chartCount: number;
  atlasWidth: number;
  atlasHeight: number;
  inputVertexCount: number;
  outputVertexCount: number;
};

export async function unwrapUVs(input: ArrayBuffer): Promise<UVUnwrapResult> {
  const xatlasModule = await createXAtlas();
  const io = new WebIO();
  const doc = await io.readBinary(new Uint8Array(input));

  // Collect all indexed triangle primitives
  const prims: Primitive[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getIndices() && prim.getAttribute("POSITION")) prims.push(prim);
    }
  }
  if (prims.length === 0) throw new Error("No indexed primitives found.");

  // Add each primitive as a separate xatlas mesh
  const atlas = xatlasModule.createAtlas();
  for (const prim of prims) {
    const rawPos = prim.getAttribute("POSITION")!.getArray()!;
    const rawIdx = prim.getIndices()!.getArray()!;
    const positions = rawPos instanceof Float32Array ? rawPos : Float32Array.from(rawPos as ArrayLike<number>);
    const indices = rawIdx instanceof Uint32Array ? rawIdx : Uint32Array.from(rawIdx as ArrayLike<number>);

    const err = atlas.addMesh({ positions, indices });
    if (err !== 0) {
      atlas.destroy();
      throw new Error(`xatlas addMesh error ${xatlasModule.addMeshErrorString(err)}`);
    }
  }

  // Generate the atlas (computeCharts + packCharts in one call)
  atlas.generate(
    { maxCost: 2, normalSeamWeight: 4, maxIterations: 1 },
    { padding: 4, resolution: 1024, bilinear: true },
  );

  const atlasW = atlas.width;
  const atlasH = atlas.height;
  const totalCharts = atlas.chartCount;
  let totalIn = 0;
  let totalOut = 0;

  // Apply the xatlas output back onto each gltf-transform primitive
  for (let mi = 0; mi < prims.length; mi++) {
    const prim = prims[mi];
    const outMesh = atlas.getMesh(mi);
    const outVC = outMesh.vertexCount;

    totalIn += prim.getAttribute("POSITION")!.getCount();
    totalOut += outVC;

    // Expand every existing attribute to the new (larger) vertex layout.
    // outMesh.vertices[i].xref is the original input vertex index.
    for (const semantic of prim.listSemantics()) {
      if (semantic === "TEXCOORD_0") continue; // replaced below
      const acc = prim.getAttribute(semantic)!;
      const raw = acc.getArray()!;
      const stride = acc.getElementSize();

      // Keep the same TypedArray subclass as the original
      const Ctor = (raw as unknown as { constructor: new (n: number) => ArrayBufferView }).constructor as new (n: number) => ArrayBufferView;
      const expanded = new Ctor(outVC * stride) as unknown as ArrayLike<number> & { [n: number]: number };

      for (let i = 0; i < outVC; i++) {
        const src = outMesh.vertices[i].xref;
        for (let c = 0; c < stride; c++) {
          expanded[i * stride + c] = (raw as unknown as ArrayLike<number>)[src * stride + c];
        }
      }
      acc.setArray(expanded as unknown as Parameters<typeof acc.setArray>[0]);
    }

    // Write atlas UVs (normalized to [0, 1]) into TEXCOORD_0
    const outUVs = new Float32Array(outVC * 2);
    for (let i = 0; i < outVC; i++) {
      const v = outMesh.vertices[i];
      outUVs[i * 2] = v.uv[0] / atlasW;
      outUVs[i * 2 + 1] = v.uv[1] / atlasH;
    }

    const existingUV = prim.getAttribute("TEXCOORD_0");
    if (existingUV) {
      existingUV.setArray(outUVs);
    } else {
      const buf = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
      const newAcc = doc.createAccessor().setType("VEC2").setArray(outUVs).setBuffer(buf);
      prim.setAttribute("TEXCOORD_0", newAcc);
    }

    prim.getIndices()!.setArray(new Uint32Array(outMesh.indices));
  }

  atlas.destroy();

  await doc.transform(dedup(), prune());
  const output = await io.writeBinary(doc);

  return { output, chartCount: totalCharts, atlasWidth: atlasW, atlasHeight: atlasH, inputVertexCount: totalIn, outputVertexCount: totalOut };
}
