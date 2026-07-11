// Tier-1 mesh optimization that runs entirely in the browser.
//
// This is real, working decimation: it welds, simplifies to a target triangle
// budget, and prunes unused data — preserving the original UVs so the model's
// existing albedo / normal / spec maps keep working with no re-bake.
//
// Tier-2 (true quad retopology, new UVs, and hi->lo map baking for characters)
// is heavier and runs on the Forge worker via a queued retopo_jobs row.

import { type Document } from "@gltf-transform/core";
import { weld, dedup, prune } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { createWebIO } from "@/lib/gltf/io";

export type OptimizeOptions = {
  /** Absolute triangle target — ratio is computed inside from the actual mesh count. */
  targetPolys: number;
  /** Preserve high-curvature detail by allowing a tighter error bound. */
  adaptive: boolean;
};

export type OptimizeResult = {
  output: Uint8Array;
  sourcePolys: number;
  resultPolys: number;
  reduction: number; // 0–1
};

function countTriangles(doc: Document): number {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const position = prim.getAttribute("POSITION");
      if (indices) tris += indices.getCount() / 3;
      else if (position) tris += position.getCount() / 3;
    }
  }
  return Math.round(tris);
}

/** Count triangles in a GLB without modifying it (drives the target slider). */
export async function countGlbTriangles(input: ArrayBuffer): Promise<number> {
  const io = createWebIO();
  const doc = await io.readBinary(new Uint8Array(input));
  return countTriangles(doc);
}

function decimatePrimIndices(
  srcIndices: Uint32Array,
  srcPositions: Float32Array,
  targetIndexCount: number,
): Uint32Array {
  // weld() (called before this) keeps UV-seam vertices as separate indices,
  // so simplify() cannot collapse an edge that crosses a UV seam — those edges
  // simply don't exist in the index buffer.  No need to include UV coordinates
  // in the error metric; doing so blocks simplification when tiling UVs have
  // values >> 1 (error contribution = weight * UV_delta >> target_error = 1).
  // LockBorder: keep open boundary edges in place so hems, mesh cuts, and
  // flat-shaded seams don't collapse inward.
  const [dstIndices] = MeshoptSimplifier.simplify(srcIndices, srcPositions, 3, targetIndexCount, 1, ["LockBorder"]);

  if (dstIndices.length > srcIndices.length * 0.9) {
    // Edge-collapse found no collapsible edges (flat-shaded / fully disconnected mesh).
    // simplifySloppy welds by position and is guaranteed to hit the target count.
    // Flat-shaded meshes have per-face UVs with no cross-triangle continuity to protect.
    const [sloppy] = MeshoptSimplifier.simplifySloppy(srcIndices, srcPositions, 3, null, targetIndexCount, 1);
    return sloppy;
  }
  return dstIndices;
}

// ---------------------------------------------------------------------------
// Position-only welding — used ONLY for curvature estimation in the adaptive
// path, never for the final index output.
// ---------------------------------------------------------------------------

type WeldedConnectivity = {
  weldedIndices: Uint32Array;
  compactPositions: Float32Array;
  /** compact index → N-welded canonical vertex index */
  reverseRemap: Uint32Array;
  /** N-welded vertex → compact index (0xffffffff if unreferenced) */
  nWeldedToCompact: Uint32Array;
};

function weldByPosition(indices: Uint32Array, positions: Float32Array): WeldedConnectivity {
  const nWelded = positions.length / 3;
  const positionRemap = MeshoptSimplifier.generatePositionRemap(positions, 3);

  const weldedIndices = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) weldedIndices[i] = positionRemap[indices[i]];

  // compactMesh remaps weldedIndices IN PLACE to [0, uniqueCount) and returns
  // [forwardRemap, uniqueCount] where forwardRemap[canonical] = compact.
  const [forwardRemap, uniqueCount] = MeshoptSimplifier.compactMesh(weldedIndices);

  // Build true reverse: reverseRemap[compact] = canonical (a valid N-welded index)
  const reverseRemap = new Uint32Array(uniqueCount);
  for (let canonical = 0; canonical < forwardRemap.length; canonical++) {
    const compact = forwardRemap[canonical];
    if (compact < uniqueCount) reverseRemap[compact] = canonical;
  }

  // Build N-welded → compact lookup for curvature expansion
  const nWeldedToCompact = new Uint32Array(nWelded).fill(0xffffffff);
  for (let v = 0; v < nWelded; v++) {
    const canonical = positionRemap[v];
    const compact = forwardRemap[canonical];
    if (compact < uniqueCount) nWeldedToCompact[v] = compact;
  }

  const compactPositions = new Float32Array(uniqueCount * 3);
  for (let i = 0; i < uniqueCount; i++) {
    const src = reverseRemap[i];
    compactPositions[i * 3] = positions[src * 3];
    compactPositions[i * 3 + 1] = positions[src * 3 + 1];
    compactPositions[i * 3 + 2] = positions[src * 3 + 2];
  }

  return { weldedIndices, compactPositions, reverseRemap, nWeldedToCompact };
}

export async function optimizeGlb(
  input: ArrayBuffer,
  opts: OptimizeOptions,
): Promise<OptimizeResult> {
  if (opts.adaptive) return optimizeGlbAdaptive(input, { targetPolys: opts.targetPolys });

  await MeshoptSimplifier.ready;

  const io = createWebIO();
  const doc = await io.readBinary(new Uint8Array(input));

  const sourcePolys = countTriangles(doc);
  const ratio = Math.min(0.99, Math.max(0.001, opts.targetPolys / Math.max(1, sourcePolys)));

  await doc.transform(weld());

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indicesAccessor = prim.getIndices();
      const positionAccessor = prim.getAttribute("POSITION");
      if (!indicesAccessor || !positionAccessor) continue;

      const rawIndices = indicesAccessor.getArray();
      const rawPositions = positionAccessor.getArray();
      if (!rawIndices || !rawPositions) continue;

      const srcIndices = rawIndices instanceof Uint32Array ? rawIndices : Uint32Array.from(rawIndices);
      const srcPositions = rawPositions instanceof Float32Array ? rawPositions : Float32Array.from(rawPositions);

      const targetIndexCount = Math.max(12, Math.round((srcIndices.length / 3) * ratio) * 3);
      if (targetIndexCount >= srcIndices.length) continue;

      const finalIndices = decimatePrimIndices(srcIndices, srcPositions, targetIndexCount);

      // Output indices reference the N-welded vertex space — UVs stay attached.
      indicesAccessor.setArray(new Uint32Array(finalIndices));
    }
  }

  await doc.transform(dedup(), prune());

  const resultPolys = countTriangles(doc);
  const output = await io.writeBinary(doc);

  return {
    output,
    sourcePolys,
    resultPolys,
    reduction: sourcePolys ? 1 - resultPolys / sourcePolys : 0,
  };
}

// ---------------------------------------------------------------------------
// Real curvature-weighted adaptive density.
//
// Per-vertex curvature is estimated on a position-welded mesh (which has
// real connectivity), then expanded back to the N-welded vertex space so
// it can be used as an attribute weight with simplifyWithAttributes.
// The output indices still reference the original N-welded vertex space,
// preserving correct UVs/normals across seams.
// ---------------------------------------------------------------------------

function computeVertexCurvature(positions: Float32Array, indices: Uint32Array): Float32Array {
  const vertexCount = positions.length / 3;
  const faceCount = indices.length / 3;

  const normalSumX = new Float64Array(vertexCount);
  const normalSumY = new Float64Array(vertexCount);
  const normalSumZ = new Float64Array(vertexCount);
  const faceNormals = new Float32Array(faceCount * 3);

  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3];
    const i1 = indices[f * 3 + 1];
    const i2 = indices[f * 3 + 2];
    const x0 = positions[i0 * 3], y0 = positions[i0 * 3 + 1], z0 = positions[i0 * 3 + 2];
    const x1 = positions[i1 * 3], y1 = positions[i1 * 3 + 1], z1 = positions[i1 * 3 + 2];
    const x2 = positions[i2 * 3], y2 = positions[i2 * 3 + 1], z2 = positions[i2 * 3 + 2];

    const ex1 = x1 - x0, ey1 = y1 - y0, ez1 = z1 - z0;
    const ex2 = x2 - x0, ey2 = y2 - y0, ez2 = z2 - z0;
    let nx = ey1 * ez2 - ez1 * ey2;
    let ny = ez1 * ex2 - ex1 * ez2;
    let nz = ex1 * ey2 - ey1 * ex2;
    const area = Math.hypot(nx, ny, nz) || 1e-8;
    nx /= area; ny /= area; nz /= area;

    faceNormals[f * 3] = nx;
    faceNormals[f * 3 + 1] = ny;
    faceNormals[f * 3 + 2] = nz;

    normalSumX[i0] += nx * area; normalSumY[i0] += ny * area; normalSumZ[i0] += nz * area;
    normalSumX[i1] += nx * area; normalSumY[i1] += ny * area; normalSumZ[i1] += nz * area;
    normalSumX[i2] += nx * area; normalSumY[i2] += ny * area; normalSumZ[i2] += nz * area;
  }

  const vertexNX = new Float32Array(vertexCount);
  const vertexNY = new Float32Array(vertexCount);
  const vertexNZ = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const len = Math.hypot(normalSumX[v], normalSumY[v], normalSumZ[v]) || 1e-8;
    vertexNX[v] = normalSumX[v] / len;
    vertexNY[v] = normalSumY[v] / len;
    vertexNZ[v] = normalSumZ[v] / len;
  }

  const curvatureSum = new Float64Array(vertexCount);
  const curvatureCount = new Int32Array(vertexCount);
  for (let f = 0; f < faceCount; f++) {
    const nx = faceNormals[f * 3], ny = faceNormals[f * 3 + 1], nz = faceNormals[f * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const v = indices[f * 3 + k];
      const dot = Math.min(1, Math.max(-1, nx * vertexNX[v] + ny * vertexNY[v] + nz * vertexNZ[v]));
      curvatureSum[v] += 1 - dot;
      curvatureCount[v]++;
    }
  }

  const curvature = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    curvature[v] = curvatureCount[v] ? curvatureSum[v] / curvatureCount[v] : 0;
  }
  return curvature;
}

function computeVertexLockMask(curvature: Float32Array, lockFraction: number): Uint8Array {
  const vertexCount = curvature.length;
  const lock = new Uint8Array(vertexCount);
  const lockCount = Math.max(0, Math.min(vertexCount, Math.round(vertexCount * lockFraction)));
  if (lockCount === 0) return lock;

  const sortedDescending = Float32Array.from(curvature).sort((a, b) => b - a);
  const cutoff = sortedDescending[lockCount - 1];

  let locked = 0;
  for (let v = 0; v < vertexCount && locked < lockCount; v++) {
    if (curvature[v] >= cutoff) { lock[v] = 1; locked++; }
  }
  return lock;
}

export type AdaptiveOptimizeOptions = {
  targetPolys: number;
  curvatureWeight?: number;
  lockFraction?: number;
};

export async function optimizeGlbAdaptive(
  input: ArrayBuffer,
  opts: AdaptiveOptimizeOptions,
): Promise<OptimizeResult> {
  await MeshoptSimplifier.ready;

  const io = createWebIO();
  const doc = await io.readBinary(new Uint8Array(input));

  const sourcePolys = countTriangles(doc);
  const ratio = Math.min(0.99, Math.max(0.001, opts.targetPolys / Math.max(1, sourcePolys)));
  const curvatureWeight = opts.curvatureWeight ?? 5.0;
  const lockFraction = opts.lockFraction ?? 0.05;

  await doc.transform(weld());

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indicesAccessor = prim.getIndices();
      const positionAccessor = prim.getAttribute("POSITION");
      if (!indicesAccessor || !positionAccessor) continue;

      const rawIndices = indicesAccessor.getArray();
      const rawPositions = positionAccessor.getArray();
      if (!rawIndices || !rawPositions) continue;

      const srcIndices = rawIndices instanceof Uint32Array ? rawIndices : Uint32Array.from(rawIndices);
      const srcPositions = rawPositions instanceof Float32Array ? rawPositions : Float32Array.from(rawPositions);

      const targetIndexCount = Math.max(12, Math.round((srcIndices.length / 3) * ratio) * 3);
      if (targetIndexCount >= srcIndices.length) continue;

      // Build position-welded connectivity for curvature estimation.
      // Curvature is computed on the position-welded mesh (which has real
      // connectivity) then expanded back to the N-welded vertex space so the
      // simplifier can use it as an attribute weight.
      const { weldedIndices, compactPositions, nWeldedToCompact } = weldByPosition(srcIndices, srcPositions);

      const compactCurvature = computeVertexCurvature(compactPositions, weldedIndices);
      const compactLock = computeVertexLockMask(compactCurvature, lockFraction);

      // Expand curvature + lock from compact → N-welded space
      const nwv = srcPositions.length / 3;
      const nWeldedCurvature = new Float32Array(nwv);
      const nWeldedLock = new Uint8Array(nwv);
      for (let v = 0; v < nwv; v++) {
        const c = nWeldedToCompact[v];
        if (c !== 0xffffffff) {
          nWeldedCurvature[v] = compactCurvature[c];
          nWeldedLock[v] = compactLock[c];
        }
      }

      // Curvature-weighted simplification: preserve high-detail regions.
      // UV seam safety comes from weld() (seam vertices stay as separate indices,
      // so simplify can't collapse across seams regardless of UV values).
      const [dstIndices] = MeshoptSimplifier.simplifyWithAttributes(
        srcIndices,
        srcPositions,
        3,
        nWeldedCurvature,
        1,
        [curvatureWeight],
        nWeldedLock,
        targetIndexCount,
        1,
        ["LockBorder"], // preserve open boundary edges
      );

      // Fall back to simplifySloppy for flat-shaded / disconnected meshes where
      // edge-collapse found nothing to do. simplifySloppy welds by position and
      // always hits the target; flat-shaded meshes have per-face UVs anyway.
      const finalIndices =
        dstIndices.length > srcIndices.length * 0.9
          ? MeshoptSimplifier.simplifySloppy(srcIndices, srcPositions, 3, null, targetIndexCount, 1)[0]
          : dstIndices;

      indicesAccessor.setArray(new Uint32Array(finalIndices));
    }
  }

  await doc.transform(dedup(), prune());

  const resultPolys = countTriangles(doc);
  const output = await io.writeBinary(doc);

  return {
    output,
    sourcePolys,
    resultPolys,
    reduction: sourcePolys ? 1 - resultPolys / sourcePolys : 0,
  };
}

// ---------------------------------------------------------------------------
// Classification presets — drive the Tier-2 retopo job request.
// ---------------------------------------------------------------------------
export type Classification = "auto" | "object" | "biped" | "creature";

export const CLASSIFICATIONS: {
  value: Classification;
  label: string;
  icon: string;
  blurb: string;
}[] = [
  { value: "auto", label: "Auto-detect", icon: "✨", blurb: "Inspect the mesh and choose the best strategy automatically." },
  { value: "object", label: "Object / Prop", icon: "📦", blurb: "Optimise for silhouette and surface detail. No character-specific edgeloops." },
  { value: "biped", label: "Biped", icon: "🧍", blurb: "Locks more high-curvature vertices (face, joints) to prevent collapse. Queues quad retopology with biped edgeloops on the Forge worker." },
  { value: "creature", label: "Creature", icon: "🐉", blurb: "Adaptive curvature for non-standard anatomy. Queues quad retopology on the Forge worker." },
];

export function needsRetopoWorker(cls: Classification): boolean {
  return cls === "biped" || cls === "creature";
}

export const BAKE_OPTIONS = ["normal", "ao", "albedo", "roughness", "metallic", "thickness"] as const;
