// Tier-1 mesh optimization that runs entirely in the browser.
//
// This is real, working decimation: it welds, simplifies to a target triangle
// budget, and prunes unused data — preserving the original UVs so the model's
// existing albedo / normal / spec maps keep working with no re-bake.
//
// Tier-2 (true quad retopology, new UVs, and hi->lo map baking for characters)
// is heavier and runs on the Forge worker via a queued retopo_jobs row.

import { WebIO, type Document } from "@gltf-transform/core";
import { weld, simplify, dedup, prune } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

export type OptimizeOptions = {
  /** Fraction of triangles to keep (0–1). */
  ratio: number;
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
  const io = new WebIO();
  const doc = await io.readBinary(new Uint8Array(input));
  return countTriangles(doc);
}

export async function optimizeGlb(
  input: ArrayBuffer,
  opts: OptimizeOptions,
): Promise<OptimizeResult> {
  if (opts.adaptive) return optimizeGlbAdaptive(input, { ratio: opts.ratio });

  await MeshoptSimplifier.ready;

  const io = new WebIO();
  const doc = await io.readBinary(new Uint8Array(input));

  const sourcePolys = countTriangles(doc);
  const ratio = Math.min(0.99, Math.max(0.01, opts.ratio));

  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: true }),
    dedup(),
    prune(),
  );

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
// The plain `simplify()` transform above only forwards a single uniform
// `error` threshold to meshoptimizer — it has no concept of "spend more
// polygons on high-curvature regions." Real per-region density needs
// meshoptimizer's lower-level `simplifyWithAttributes`, which accepts a
// per-vertex attribute (we feed it a curvature estimate) plus a weight for
// that attribute, and an explicit vertex-lock mask so the sharpest creases
// are pinned and survive simplification entirely.
// ---------------------------------------------------------------------------

/**
 * Per-vertex curvature estimate in [0, 1]: the average angular deviation
 * between a vertex's incident face normals and the vertex's own
 * area-weighted average normal. ~0 on flat regions, higher on creases/edges.
 * Pure geometry — no AI, no heuristics beyond "how sharp is this corner."
 */
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
    // Magnitude is proportional to 2x triangle area — keep it as the area weight.
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

export type AdaptiveOptimizeOptions = {
  /** Fraction of triangles to keep (0–1). */
  ratio: number;
  /** How strongly curvature steers the simplifier away from sharp regions. */
  curvatureWeight?: number;
  /** Curvature above this (0–1) hard-locks a vertex so it never collapses. */
  lockThreshold?: number;
};

/**
 * Decimates with real per-region density: curvature drives both a soft
 * attribute weight (meshoptimizer prefers collapsing flat regions first) and
 * a hard per-vertex lock (the sharpest creases are pinned outright). Falls
 * back to leaving a primitive untouched if it has no indices/positions.
 */
export async function optimizeGlbAdaptive(
  input: ArrayBuffer,
  opts: AdaptiveOptimizeOptions,
): Promise<OptimizeResult> {
  await MeshoptSimplifier.ready;

  const io = new WebIO();
  const doc = await io.readBinary(new Uint8Array(input));

  const sourcePolys = countTriangles(doc);
  const ratio = Math.min(0.99, Math.max(0.01, opts.ratio));
  const curvatureWeight = opts.curvatureWeight ?? 2.5;
  const lockThreshold = opts.lockThreshold ?? 0.6;

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

      const curvature = computeVertexCurvature(srcPositions, srcIndices);
      const vertexCount = srcPositions.length / 3;
      const vertexLock = new Uint8Array(vertexCount);
      for (let v = 0; v < vertexCount; v++) {
        if (curvature[v] > lockThreshold) vertexLock[v] = 1;
      }

      const [dstIndices] = MeshoptSimplifier.simplifyWithAttributes(
        srcIndices,
        srcPositions,
        3,
        curvature,
        1,
        [curvatureWeight],
        vertexLock,
        targetIndexCount,
        1, // unbounded relative error — curvature weight + lock mask drive the result, not an error cap
        ["LockBorder"],
      );

      indicesAccessor.setArray(Uint32Array.from(dstIndices));
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
export type Classification = "auto" | "object" | "biped" | "quadruped" | "creature";

export const CLASSIFICATIONS: {
  value: Classification;
  label: string;
  icon: string;
  blurb: string;
}[] = [
  { value: "auto", label: "Auto-detect", icon: "✨", blurb: "Inspect the mesh and pick the best strategy." },
  { value: "object", label: "Object / Prop", icon: "📦", blurb: "Optimize for silhouette & surface detail. No edgeloops." },
  { value: "biped", label: "Biped", icon: "🧍", blurb: "Edgeloops for eyes, mouth, and limb articulation." },
  { value: "quadruped", label: "Quadruped", icon: "🐾", blurb: "Spine + 4-limb deformation loops." },
  { value: "creature", label: "Creature", icon: "🐉", blurb: "Adaptive loops for non-standard anatomy." },
];

export function needsRetopoWorker(cls: Classification): boolean {
  // Characters/creatures need true quad retopology + edgeloops (Tier-2 worker).
  // Objects are well served by in-browser decimation (Tier-1).
  return cls === "biped" || cls === "quadruped" || cls === "creature";
}

export const BAKE_OPTIONS = ["normal", "ao", "albedo", "roughness", "metallic", "thickness"] as const;
