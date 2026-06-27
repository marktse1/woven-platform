// Tier-1 mesh optimization that runs entirely in the browser.
//
// This is real, working decimation: it welds, simplifies to a target triangle
// budget, and prunes unused data — preserving the original UVs so the model's
// existing albedo / normal / spec maps keep working with no re-bake.
//
// Tier-2 (true quad retopology, new UVs, and hi->lo map baking for characters)
// is heavier and runs on the Forge worker via a queued retopo_jobs row.

import { WebIO, type Document } from "@gltf-transform/core";
import { weld, dedup, prune } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

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
  const io = new WebIO();
  const doc = await io.readBinary(new Uint8Array(input));
  return countTriangles(doc);
}

// ---------------------------------------------------------------------------
// UV-safe triangle selection fallback for flat-shaded / disconnected meshes.
//
// simplifySloppy and every vertex-merging algorithm corrupt UV seams:
// when two vertices share the same geometric position but have different UV
// coordinates (the two sides of a UV seam), the algorithm picks one UV and
// discards the other, producing scrambled textures.
//
// For flat-shaded / disconnected meshes where edge-collapse simplify() finds
// nothing to do (no shared vertex indices = no collapsible edges), we fall
// back to pure triangle selection: assign each triangle to a 3-D grid cell
// based on its centroid, keep one representative per cell, and output those
// triangles' ORIGINAL vertex indices completely untouched.  No vertex data is
// ever merged or rewritten — textures are preserved exactly.
// ---------------------------------------------------------------------------
function selectTrianglesByGrid(
  srcIndices: Uint32Array,
  srcPositions: Float32Array,
  targetTriCount: number,
): Uint32Array {
  const triCount = srcIndices.length / 3;
  if (targetTriCount >= triCount) return srcIndices;

  // Triangle centroids + bounding box
  const cx = new Float32Array(triCount);
  const cy = new Float32Array(triCount);
  const cz = new Float32Array(triCount);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let t = 0; t < triCount; t++) {
    const i0 = srcIndices[t * 3], i1 = srcIndices[t * 3 + 1], i2 = srcIndices[t * 3 + 2];
    const x = (srcPositions[i0 * 3] + srcPositions[i1 * 3] + srcPositions[i2 * 3]) / 3;
    const y = (srcPositions[i0 * 3 + 1] + srcPositions[i1 * 3 + 1] + srcPositions[i2 * 3 + 1]) / 3;
    const z = (srcPositions[i0 * 3 + 2] + srcPositions[i1 * 3 + 2] + srcPositions[i2 * 3 + 2]) / 3;
    cx[t] = x; cy[t] = y; cz[t] = z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const dz = maxZ - minZ || 1;

  // Resolution: aim for ~2× target cells so surface-only cells land near target
  const res = Math.max(1, Math.ceil(Math.cbrt(targetTriCount * 2)));

  // One representative triangle per occupied grid cell
  const cellToTri = new Map<number, number>();
  for (let t = 0; t < triCount; t++) {
    const gx = Math.min(res - 1, Math.floor(((cx[t] - minX) / dx) * res));
    const gy = Math.min(res - 1, Math.floor(((cy[t] - minY) / dy) * res));
    const gz = Math.min(res - 1, Math.floor(((cz[t] - minZ) / dz) * res));
    const key = gx + gy * res + gz * res * res;
    if (!cellToTri.has(key)) cellToTri.set(key, t);
  }

  const selected = Array.from(cellToTri.values());
  const out = new Uint32Array(selected.length * 3);
  for (let i = 0; i < selected.length; i++) {
    const t = selected[i];
    out[i * 3] = srcIndices[t * 3];
    out[i * 3 + 1] = srcIndices[t * 3 + 1];
    out[i * 3 + 2] = srcIndices[t * 3 + 2];
  }
  return out;
}

// UV weight used when including texture coordinates in the error metric.
// A large UV jump (at a UV seam) has the same cost as a proportionally large
// position jump, making the simplifier strongly prefer NOT to collapse edges
// that cross UV seams.
const UV_SEAM_WEIGHT = 2.0;

function decimatePrimIndices(
  srcIndices: Uint32Array,
  srcPositions: Float32Array,
  srcUVs: Float32Array | null,
  targetIndexCount: number,
): Uint32Array {
  let dstIndices: Uint32Array;

  if (srcUVs && srcUVs.length === (srcPositions.length / 3) * 2) {
    // Include UV coordinates in the simplification error metric so the
    // simplifier avoids collapsing edges that cross UV seams. Without this,
    // the simplifier picks up half of a seam and the surviving vertex ends up
    // with the wrong UV for the triangles that referenced the removed vertex.
    [dstIndices] = MeshoptSimplifier.simplifyWithAttributes(
      srcIndices, srcPositions, 3,
      srcUVs, 2, [UV_SEAM_WEIGHT, UV_SEAM_WEIGHT],
      null,
      targetIndexCount, 1,
    );
  } else {
    [dstIndices] = MeshoptSimplifier.simplify(srcIndices, srcPositions, 3, targetIndexCount, 1);
  }

  if (dstIndices.length > srcIndices.length * 0.9) {
    // Edge-collapse found no collapsible edges (flat-shaded / fully disconnected mesh).
    // Use UV-safe triangle selection — never merges any vertex data.
    return selectTrianglesByGrid(srcIndices, srcPositions, Math.round(targetIndexCount / 3));
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

  const io = new WebIO();
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

      // Extract UV coordinates for seam-aware simplification.
      const rawUVs = prim.getAttribute("TEXCOORD_0")?.getArray() ?? null;
      const srcUVs = rawUVs ? (rawUVs instanceof Float32Array ? rawUVs : Float32Array.from(rawUVs as ArrayLike<number>)) : null;

      const targetIndexCount = Math.max(12, Math.round((srcIndices.length / 3) * ratio) * 3);
      if (targetIndexCount >= srcIndices.length) continue;

      const finalIndices = decimatePrimIndices(srcIndices, srcPositions, srcUVs, targetIndexCount);

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

  const io = new WebIO();
  const doc = await io.readBinary(new Uint8Array(input));

  const sourcePolys = countTriangles(doc);
  const ratio = Math.min(0.99, Math.max(0.001, opts.targetPolys / Math.max(1, sourcePolys)));
  const curvatureWeight = opts.curvatureWeight ?? 2.5;
  const lockFraction = opts.lockFraction ?? 0.02;

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

      // Extract UV coordinates for seam-aware simplification.
      const rawUVs = prim.getAttribute("TEXCOORD_0")?.getArray() ?? null;
      const srcUVs = rawUVs ? (rawUVs instanceof Float32Array ? rawUVs : Float32Array.from(rawUVs as ArrayLike<number>)) : null;

      const targetIndexCount = Math.max(12, Math.round((srcIndices.length / 3) * ratio) * 3);
      if (targetIndexCount >= srcIndices.length) continue;

      // Build position-welded connectivity to estimate per-vertex curvature.
      // We then EXPAND the curvature back to the N-welded vertex space so
      // simplifyWithAttributes can operate on the original data with correct UVs.
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

      // Interleave curvature + UV into a single attribute array so the simplifier
      // penalises both high-curvature collapses AND UV-seam crossings.
      const hasUVs = srcUVs && srcUVs.length === nwv * 2;
      const attribStride = hasUVs ? 3 : 1;
      const nWeldedAttribs = new Float32Array(nwv * attribStride);
      const attribWeights: number[] = hasUVs ? [curvatureWeight, UV_SEAM_WEIGHT, UV_SEAM_WEIGHT] : [curvatureWeight];
      for (let v = 0; v < nwv; v++) {
        nWeldedAttribs[v * attribStride] = nWeldedCurvature[v];
        if (hasUVs) {
          nWeldedAttribs[v * attribStride + 1] = srcUVs![v * 2];
          nWeldedAttribs[v * attribStride + 2] = srcUVs![v * 2 + 1];
        }
      }

      // Attempt attribute-weighted simplification on the N-welded (original) mesh.
      // Works for smooth-shaded meshes; for flat-shaded (no connectivity) it no-ops.
      const [dstIndices] = MeshoptSimplifier.simplifyWithAttributes(
        srcIndices,
        srcPositions,
        3,
        nWeldedAttribs,
        attribStride,
        attribWeights,
        nWeldedLock,
        targetIndexCount,
        1,
      );

      // Fall back to UV-safe triangle selection for flat-shaded / disconnected meshes.
      const finalIndices =
        dstIndices.length > srcIndices.length * 0.9
          ? selectTrianglesByGrid(srcIndices, srcPositions, Math.round(targetIndexCount / 3))
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
  { value: "auto", label: "Auto-detect", icon: "✨", blurb: "Inspect the mesh and pick the best strategy." },
  { value: "object", label: "Object / Prop", icon: "📦", blurb: "Optimize for silhouette & surface detail. No edgeloops." },
  { value: "biped", label: "Biped", icon: "🧍", blurb: "Edgeloops for eyes, mouth, and limb articulation." },
  { value: "creature", label: "Creature", icon: "🐉", blurb: "Adaptive loops for non-standard anatomy." },
];

export function needsRetopoWorker(cls: Classification): boolean {
  return cls === "biped" || cls === "creature";
}

export const BAKE_OPTIONS = ["normal", "ao", "albedo", "roughness", "metallic", "thickness"] as const;
