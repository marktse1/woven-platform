// Brush displacement math — all operations work in world space for distance
// checks, then write back to local-space position attributes.

import * as THREE from "three";
import type { SeamData } from "./seams";
import type { MirrorData } from "./mirror";

export type BrushMode = "clay_buildup" | "push" | "smooth" | "flatten" | "move" | "paint";

export type BrushHit = {
  point: THREE.Vector3;   // world-space hit point
  normal: THREE.Vector3;  // world-space hit normal
};

export type BrushParams = {
  mode: BrushMode;
  radius: number;       // world-space outer radius
  innerRadius: number;  // 0–1 fraction of radius that stays at full strength
  strength: number;     // 0–1
  invert?: boolean;
  hit: BrushHit;
  prevHit?: BrushHit;
  mesh: THREE.Mesh;
  seams: SeamData;
  /** ZBrush-style X-axis symmetry — every mode except "paint" also applies
   * the equivalent displacement to each affected vertex's mirror partner. */
  mirror?: MirrorData;
};

/** For every vertex in `foMap`, finds its mirror partner (seam-expanded) and
 * carries its falloff over — giving a second falloff map keyed by mirror-side
 * vertex indices, directly usable the same way the primary foMap already is.
 * Vertices whose mirror partner is already IN foMap (a selection straddling
 * the centerline) are skipped, so a stroke near the centerline doesn't double
 * -apply itself. */
function mirrorFalloffMap(foMap: Map<number, number>, mirror: MirrorData, seams: SeamData): Map<number, number> {
  const out = new Map<number, number>();
  for (const [idx, fo] of foMap) {
    const midx = mirror.get(idx);
    if (midx === undefined || midx === idx || foMap.has(midx)) continue;
    const group = seams.groups[seams.vertToGroup[midx]];
    for (const j of group) {
      const prev = out.get(j);
      if (prev === undefined || fo > prev) out.set(j, fo);
    }
  }
  return out;
}

/**
 * Falloff with an inner flat zone.
 * Inside innerRadius*radius → strength 1.0.
 * Between innerRadius and outer radius → smooth (1-t²) taper to 0.
 */
function falloff(dist: number, radius: number, innerRadius: number): number {
  const inner = innerRadius * radius;
  if (dist <= inner) return 1.0;
  const t = (dist - inner) / Math.max(radius - inner, 1e-6);
  return Math.max(0, 1 - t * t);
}

const _wp = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _localCenter = new THREE.Vector3();

/** Returns vertices within world-space radius, with falloffs. */
export function gatherVertices(
  positions: THREE.BufferAttribute,
  mesh: THREE.Mesh,
  worldCenter: THREE.Vector3,
  radius: number,
  innerRadius: number,
): Array<{ idx: number; fo: number }> {
  const mat = mesh.matrixWorld;
  const r2 = radius * radius;
  const result: Array<{ idx: number; fo: number }> = [];

  for (let i = 0; i < positions.count; i++) {
    _wp.fromBufferAttribute(positions, i).applyMatrix4(mat);
    const d2 = _wp.distanceToSquared(worldCenter);
    if (d2 <= r2) {
      result.push({ idx: i, fo: falloff(Math.sqrt(d2), radius, innerRadius) });
    }
  }
  return result;
}

/** Expand a vertex index set to include all UV-seam co-located vertices. */
export function expandSeams(indices: number[], seams: SeamData): Set<number> {
  const out = new Set<number>();
  for (const i of indices) {
    const group = seams.groups[seams.vertToGroup[i]];
    for (const j of group) out.add(j);
  }
  return out;
}

export function applyBrush(params: BrushParams): void {
  const { mode, radius, innerRadius, strength, hit, mesh, seams, invert = false, mirror } = params;
  const positions = mesh.geometry.attributes.position as THREE.BufferAttribute;

  _inv.copy(mesh.matrixWorld).invert();

  const gathered = gatherVertices(positions, mesh, hit.point, radius, innerRadius);
  if (gathered.length === 0) return;

  // Convert world hit normal to local space (no translation, just rotation+scale).
  const localNormal = hit.normal.clone().transformDirection(_inv).normalize();
  const localHit = hit.point.clone().applyMatrix4(_inv);

  if (mode === "paint") return; // Handled via UV raycasting in SculptViewer

  if (mode === "clay_buildup") {
    const sign = invert ? -1 : 1;
    const allIdx = expandSeams(gathered.map((g) => g.idx), seams);
    const foMap = new Map<number, number>();
    for (const { idx, fo } of gathered) {
      const group = seams.groups[seams.vertToGroup[idx]];
      for (const j of group) {
        const prev = foMap.get(j);
        if (prev === undefined || fo > prev) foMap.set(j, fo);
      }
    }
    for (const idx of allIdx) {
      const fo = foMap.get(idx) ?? 0;
      const disp = sign * strength * fo * radius * 0.07;
      positions.setXYZ(idx, positions.getX(idx) + localNormal.x * disp, positions.getY(idx) + localNormal.y * disp, positions.getZ(idx) + localNormal.z * disp);
    }
    if (mirror) {
      // clay_buildup moves every vertex along ONE shared direction (the
      // brush hit normal), so mirroring means reflecting that direction —
      // not looking up each mirror vertex's own normal.
      const mFoMap = mirrorFalloffMap(foMap, mirror, seams);
      const mnx = -localNormal.x, mny = localNormal.y, mnz = localNormal.z;
      for (const [idx, fo] of mFoMap) {
        const disp = sign * strength * fo * radius * 0.07;
        positions.setXYZ(idx, positions.getX(idx) + mnx * disp, positions.getY(idx) + mny * disp, positions.getZ(idx) + mnz * disp);
      }
    }
  } else if (mode === "push") {
    const sign = invert ? -1 : 1;
    const allIdx = expandSeams(gathered.map((g) => g.idx), seams);

    // Build falloff map so seam-expanded verts use the same falloff.
    const foMap = new Map<number, number>();
    for (const { idx, fo } of gathered) {
      const group = seams.groups[seams.vertToGroup[idx]];
      for (const j of group) {
        const prev = foMap.get(j);
        if (prev === undefined || fo > prev) foMap.set(j, fo);
      }
    }

    const nAttr = mesh.geometry.attributes.normal as THREE.BufferAttribute;
    for (const idx of allIdx) {
      const fo = foMap.get(idx) ?? 0;
      const disp = sign * strength * fo * radius * 0.05;
      positions.setXYZ(
        idx,
        positions.getX(idx) + nAttr.getX(idx) * disp,
        positions.getY(idx) + nAttr.getY(idx) * disp,
        positions.getZ(idx) + nAttr.getZ(idx) * disp,
      );
    }
    if (mirror) {
      // push already displaces along each vertex's OWN normal — no
      // reflection needed, the mirror vertex's own normal already points
      // the geometrically-correct outward direction on its side.
      const mFoMap = mirrorFalloffMap(foMap, mirror, seams);
      for (const [idx, fo] of mFoMap) {
        const disp = sign * strength * fo * radius * 0.05;
        positions.setXYZ(
          idx,
          positions.getX(idx) + nAttr.getX(idx) * disp,
          positions.getY(idx) + nAttr.getY(idx) * disp,
          positions.getZ(idx) + nAttr.getZ(idx) * disp,
        );
      }
    }
  } else if (mode === "smooth") {
    // Ring-1 Laplacian: each vertex moves toward the average of its topology neighbors.
    // Building from the full index buffer once avoids the collapse that happens when all
    // vertices share a single centroid target.
    const idxBuf = mesh.geometry.index!;
    const adj = new Map<number, Set<number>>();
    for (let i = 0; i < idxBuf.count; i += 3) {
      const a = idxBuf.getX(i), b = idxBuf.getX(i + 1), c = idxBuf.getX(i + 2);
      for (const [v, n1, n2] of [[a,b,c],[b,a,c],[c,a,b]] as [number,number,number][]) {
        if (!adj.has(v)) adj.set(v, new Set());
        adj.get(v)!.add(n1); adj.get(v)!.add(n2);
      }
    }

    const allIdx = expandSeams(gathered.map((g) => g.idx), seams);
    const foMap = new Map<number, number>();
    for (const { idx, fo } of gathered) {
      const group = seams.groups[seams.vertToGroup[idx]];
      for (const j of group) {
        const prev = foMap.get(j);
        if (prev === undefined || fo > prev) foMap.set(j, fo);
      }
    }

    for (const idx of allIdx) {
      const neighbors = adj.get(idx);
      if (!neighbors || neighbors.size === 0) continue;
      const fo = foMap.get(idx) ?? 0;
      if (fo === 0) continue;
      let ax = 0, ay = 0, az = 0;
      for (const n of neighbors) {
        ax += positions.getX(n); ay += positions.getY(n); az += positions.getZ(n);
      }
      const inv = 1 / neighbors.size;
      const t = fo * strength * 0.4;
      positions.setXYZ(
        idx,
        positions.getX(idx) * (1 - t) + ax * inv * t,
        positions.getY(idx) * (1 - t) + ay * inv * t,
        positions.getZ(idx) * (1 - t) + az * inv * t,
      );
    }
    if (mirror) {
      // Laplacian smoothing is inherently local/shape-preserving — no
      // directional reflection needed, just smooth the mirror vertex
      // toward ITS OWN neighbors (from the same whole-mesh adjacency map).
      const mFoMap = mirrorFalloffMap(foMap, mirror, seams);
      for (const [idx, fo] of mFoMap) {
        const neighbors = adj.get(idx);
        if (!neighbors || neighbors.size === 0 || fo === 0) continue;
        let ax = 0, ay = 0, az = 0;
        for (const n of neighbors) {
          ax += positions.getX(n); ay += positions.getY(n); az += positions.getZ(n);
        }
        const inv = 1 / neighbors.size;
        const t = fo * strength * 0.4;
        positions.setXYZ(
          idx,
          positions.getX(idx) * (1 - t) + ax * inv * t,
          positions.getY(idx) * (1 - t) + ay * inv * t,
          positions.getZ(idx) * (1 - t) + az * inv * t,
        );
      }
    }
  } else if (mode === "flatten") {
    // Project vertices onto the plane at localHit with normal localNormal.
    const allIdx = expandSeams(gathered.map((g) => g.idx), seams);
    const foMap = new Map<number, number>();
    for (const { idx, fo } of gathered) {
      const group = seams.groups[seams.vertToGroup[idx]];
      for (const j of group) {
        const prev = foMap.get(j);
        if (prev === undefined || fo > prev) foMap.set(j, fo);
      }
    }

    for (const idx of allIdx) {
      const fo = foMap.get(idx) ?? 0;
      const t = fo * strength * 0.3;
      const vx = positions.getX(idx);
      const vy = positions.getY(idx);
      const vz = positions.getZ(idx);
      // dot(v - localHit, localNormal) gives signed distance to plane
      const dist =
        (vx - localHit.x) * localNormal.x +
        (vy - localHit.y) * localNormal.y +
        (vz - localHit.z) * localNormal.z;
      positions.setXYZ(
        idx,
        vx - localNormal.x * dist * t,
        vy - localNormal.y * dist * t,
        vz - localNormal.z * dist * t,
      );
    }
    if (mirror) {
      // flatten projects onto ONE shared plane (localHit + localNormal), so
      // mirroring means reflecting that whole plane across X, not looking
      // up per-vertex data.
      const mFoMap = mirrorFalloffMap(foMap, mirror, seams);
      const mHitX = -localHit.x, mHitY = localHit.y, mHitZ = localHit.z;
      const mnx = -localNormal.x, mny = localNormal.y, mnz = localNormal.z;
      for (const [idx, fo] of mFoMap) {
        const t = fo * strength * 0.3;
        const vx = positions.getX(idx);
        const vy = positions.getY(idx);
        const vz = positions.getZ(idx);
        const dist = (vx - mHitX) * mnx + (vy - mHitY) * mny + (vz - mHitZ) * mnz;
        positions.setXYZ(
          idx,
          vx - mnx * dist * t,
          vy - mny * dist * t,
          vz - mnz * dist * t,
        );
      }
    }
  } else if (mode === "move") {
    if (!params.prevHit) return;
    const localPrev = params.prevHit.point.clone().applyMatrix4(_inv);
    const dx = localHit.x - localPrev.x;
    const dy = localHit.y - localPrev.y;
    const dz = localHit.z - localPrev.z;

    const allIdx = expandSeams(gathered.map((g) => g.idx), seams);
    const foMap = new Map<number, number>();
    for (const { idx, fo } of gathered) {
      const group = seams.groups[seams.vertToGroup[idx]];
      for (const j of group) {
        const prev = foMap.get(j);
        if (prev === undefined || fo > prev) foMap.set(j, fo);
      }
    }

    for (const idx of allIdx) {
      const fo = foMap.get(idx) ?? 0;
      positions.setXYZ(
        idx,
        positions.getX(idx) + dx * fo,
        positions.getY(idx) + dy * fo,
        positions.getZ(idx) + dz * fo,
      );
    }
    if (mirror) {
      // move uses a world-space (well, local-space) XYZ delta — needs its
      // X component sign-flipped for the mirror side; Y/Z are unaffected by
      // reflecting across the X=0 plane.
      const mFoMap = mirrorFalloffMap(foMap, mirror, seams);
      for (const [idx, fo] of mFoMap) {
        positions.setXYZ(
          idx,
          positions.getX(idx) + -dx * fo,
          positions.getY(idx) + dy * fo,
          positions.getZ(idx) + dz * fo,
        );
      }
    }
  }

  positions.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}
