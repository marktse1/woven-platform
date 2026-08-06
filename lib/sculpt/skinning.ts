// Automatic skin-weight computation for Mesh Sculptor's "Bind Skin" —
// pure math, no Three.js scene wiring beyond THREE.Vector3 (just a math
// type), same lib/sculpt/* = math / SculptViewer.tsx = orchestration split
// as rig.ts/mirror.ts/topology.ts.
//
// Two algorithms, both producing glTF's standard 4-influence-per-vertex
// skinIndex/skinWeight attributes:
//
// - computeDistanceWeights: each vertex weights toward its nearest bone
//   SEGMENTS by inverse squared distance. Simple and fast, but purely
//   geometric — it has no idea what's mesh surface vs. empty space, so it
//   can bleed across thin gaps (fingers pressed together, a hand near the
//   torso).
// - computeDiffusionWeights: a practical approximation of Blender-style
//   heat-diffusion binding. Seeds each bone's influence with the same
//   distance-based values, then iteratively spreads it along the mesh's
//   OWN vertex-adjacency graph (Laplacian smoothing) instead of straight
//   3D distance — influence has to travel along the surface to reach a
//   vertex, so it naturally respects thin gaps without per-region tuning.
//   This is not Blender's actual voxelized heat-equation solve (no
//   library for that in this stack) — it's a lighter, buildable
//   approximation that gets the same core property (mesh-aware, not
//   Euclidean-only).

import * as THREE from "three";

export type BoneSegment = {
  /** Index into the skeleton's bones[] array — written directly into skinIndex. */
  index: number;
  /** The bone's own position (its end of the segment). */
  a: THREE.Vector3;
  /** The parent bone's position (root bones: same as `a`, a zero-length
   * segment, so distance-to-segment degenerates to distance-to-point). */
  b: THREE.Vector3;
};

export type SkinWeightResult = {
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
};

const MAX_INFLUENCES = 4;

/** Closest point on segment a-b to point p, returned as a distance. */
function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-12) return p.distanceTo(a);
  const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / lenSq));
  const closest = a.clone().addScaledVector(ab, t);
  return p.distanceTo(closest);
}

/** Picks each vertex's top MAX_INFLUENCES weights from a per-bone raw-weight
 * array, normalizes them to sum to 1, and writes glTF-standard attributes. */
function packTopInfluences(vertexCount: number, boneCount: number, raw: Float32Array): SkinWeightResult {
  const skinIndex = new Uint16Array(vertexCount * MAX_INFLUENCES);
  const skinWeight = new Float32Array(vertexCount * MAX_INFLUENCES);
  const candidates: { bone: number; w: number }[] = [];
  for (let v = 0; v < vertexCount; v++) {
    candidates.length = 0;
    for (let b = 0; b < boneCount; b++) {
      const w = raw[v * boneCount + b];
      if (w > 0) candidates.push({ bone: b, w });
    }
    candidates.sort((a, b) => b.w - a.w);
    const top = candidates.slice(0, MAX_INFLUENCES);
    const total = top.reduce((s, c) => s + c.w, 0) || 1;
    for (let i = 0; i < MAX_INFLUENCES; i++) {
      const c = top[i];
      skinIndex[v * MAX_INFLUENCES + i] = c ? c.bone : 0;
      skinWeight[v * MAX_INFLUENCES + i] = c ? c.w / total : 0;
    }
  }
  return { skinIndex, skinWeight };
}

/** Raw (unnormalized) inverse-squared-distance weight per vertex per bone —
 * shared by both algorithms (diffusion seeds from this, distance packs it
 * directly). Returned flat, [vertex * boneCount + bone]. */
function rawDistanceWeights(positions: Float32Array, segments: BoneSegment[]): Float32Array {
  const vertexCount = positions.length / 3;
  const boneCount = segments.length;
  const raw = new Float32Array(vertexCount * boneCount);
  const p = new THREE.Vector3();
  for (let v = 0; v < vertexCount; v++) {
    p.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    for (let b = 0; b < boneCount; b++) {
      const seg = segments[b];
      const d = distanceToSegment(p, seg.a, seg.b);
      raw[v * boneCount + b] = 1 / (d * d + 1e-6);
    }
  }
  return raw;
}

export function computeDistanceWeights(positions: Float32Array, segments: BoneSegment[]): SkinWeightResult {
  const vertexCount = positions.length / 3;
  const raw = rawDistanceWeights(positions, segments);
  return packTopInfluences(vertexCount, segments.length, raw);
}

/** Vertex -> neighboring vertex indices, derived from topology.ts's
 * edgeToTris (every mesh edge) — the caller already has this built for
 * poly-edit mode; this is just a reshape, not a new mesh walk. */
export function buildAdjacency(edgeToTris: Map<string, { v0: number; v1: number }>, vertexCount: number): number[][] {
  const adjacency: number[][] = Array.from({ length: vertexCount }, () => []);
  for (const { v0, v1 } of edgeToTris.values()) {
    adjacency[v0].push(v1);
    adjacency[v1].push(v0);
  }
  return adjacency;
}

export function computeDiffusionWeights(
  positions: Float32Array,
  segments: BoneSegment[],
  adjacency: number[][],
  iterations = 12,
  alpha = 0.5,
): SkinWeightResult {
  const vertexCount = positions.length / 3;
  const boneCount = segments.length;
  let heat: Float32Array = rawDistanceWeights(positions, segments);
  let next: Float32Array = new Float32Array(heat.length);
  for (let iter = 0; iter < iterations; iter++) {
    for (let v = 0; v < vertexCount; v++) {
      const neighbors = adjacency[v];
      if (neighbors.length === 0) {
        for (let b = 0; b < boneCount; b++) next[v * boneCount + b] = heat[v * boneCount + b];
        continue;
      }
      for (let b = 0; b < boneCount; b++) {
        let sum = 0;
        for (const n of neighbors) sum += heat[n * boneCount + b];
        const avg = sum / neighbors.length;
        next[v * boneCount + b] = (1 - alpha) * heat[v * boneCount + b] + alpha * avg;
      }
    }
    const tmp = heat;
    heat = next;
    next = tmp;
  }
  return packTopInfluences(vertexCount, boneCount, heat);
}
