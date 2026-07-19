// Face extrude and boundary edge-loop extrude — the two topology-mutating
// poly-edit operations. Both rebuild the index buffer wholesale (matching
// this codebase's existing convention: subdivide/remesh never patch a live
// index buffer in place either), and both route new "wall" geometry through
// buildWallTriangles() so the UV-offset fix (see below) only has to be
// gotten right once.
//
// UV handling: a naively copied UV on a new (extruded) vertex produces a
// DEGENERATE (zero UV-space area) side wall — not just "stretched" — because
// the wall's top and bottom rows would collapse to the same UV points.
// buildWallTriangles offsets the new row's V coordinate proportionally to
// the extrude distance instead, giving the wall real UV-space height. Cap
// faces (face extrude only) don't go through buildWallTriangles — they copy
// their source vertex's UV directly, since the cap is just the original
// face's shape relocated, so a direct copy stays non-degenerate.

import * as THREE from "three";
import type { EdgeLoop, LoopEdge } from "./topology";

function wallUVDelta(distance: number, baseEdgeLen: number): number {
  const denom = baseEdgeLen > 1e-6 ? baseEdgeLen : Math.abs(distance) || 1;
  return Math.sign(distance || 1) * Math.max(Math.abs(distance) / denom, 0.05);
}

type WallRingVertex = { srcIdx: number; normal: THREE.Vector3 };

/** Duplicates `ring` into a new base row (at the source position) and a new
 * cap row (offset along each vertex's own normal by `distance`), and builds
 * the quad-strip of triangles connecting them. Shared by extrudeFaces (one
 * normal, repeated per corner) and extrudeEdgeLoop (one normal per vertex,
 * from the mesh's own vertex-normal attribute). */
function buildWallTriangles(
  positions: number[],
  uvs: number[] | null,
  srcPositions: THREE.BufferAttribute,
  srcUVs: THREE.BufferAttribute | null,
  ring: WallRingVertex[],
  distance: number,
  uvDelta: number,
  closed: boolean,
): { baseIdx: number[]; capIdx: number[]; wallTriangles: number[] } {
  const n = ring.length;
  const baseIdx: number[] = [];
  const capIdx: number[] = [];
  const p = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const { srcIdx, normal } = ring[i];
    p.fromBufferAttribute(srcPositions, srcIdx);

    baseIdx.push(positions.length / 3);
    positions.push(p.x, p.y, p.z);

    capIdx.push(positions.length / 3);
    positions.push(p.x + normal.x * distance, p.y + normal.y * distance, p.z + normal.z * distance);

    if (uvs && srcUVs) {
      const u = srcUVs.getX(srcIdx), v = srcUVs.getY(srcIdx);
      uvs.push(u, v);
      uvs.push(u, v + uvDelta);
    }
  }

  const wallTriangles: number[] = [];
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % n;
    const b0 = baseIdx[i], b1 = baseIdx[j], c0 = capIdx[i], c1 = capIdx[j];
    // Two triangles per wall segment quad (b0,b1,c1,c0), split along the
    // b0–c1 diagonal. Winding matches ring order — see extrudeFaces/
    // extrudeEdgeLoop for why ring order is trusted to already be CCW as
    // seen from outside the mesh.
    wallTriangles.push(b0, b1, c1, b0, c1, c0);
  }

  return { baseIdx, capIdx, wallTriangles };
}

export type ExtrudeFace = {
  /** 3 or 4 original vertex indices, CCW as seen from outside — either
   * entry.topology.quadCorners[quadIndex] or a raw triangle's [a,b,c]. */
  ring: number[];
  /** Original triangle index(es) this face occupies — 1 for a raw triangle,
   * 2 for a quad-paired face. Removed from the rebuilt index buffer. */
  triIndices: number[];
  /** Present only for a quad-paired face — its old entry is dropped from
   * quadIndices (it no longer corresponds to any triangle after extrude). */
  quadIndex?: number;
};

export type ExtrudeFacesResult = {
  geometry: THREE.BufferGeometry;
  quadIndices: Uint32Array;
  /** New quad indices (into the returned quadIndices) for quad-paired caps —
   * re-select these so extrude-chains work the way DCC tools expect. */
  newQuadIdx: number[];
  /** New triangle indices (into the returned geometry.index) for raw-triangle caps. */
  newTriIdx: number[];
};

/** Extrudes each face in `faces` independently along its own normal — no
 * vertex sharing between faces even if they were adjacent in the source
 * mesh, so adjacent independently-extruded faces show a visible seam/crack
 * between their caps. This is intentional (matches standard "extrude
 * individual faces" DCC semantics), not a bug. */
export function extrudeFaces(
  geometry: THREE.BufferGeometry,
  quadIndices: Uint32Array,
  faces: ExtrudeFace[],
  distance: number,
  baseEdgeLen: number,
): ExtrudeFacesResult {
  const srcPos = geometry.attributes.position as THREE.BufferAttribute;
  const srcUV = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  const srcIndex = geometry.index!;
  const hasUV = !!srcUV;

  const positions: number[] = Array.from(srcPos.array as Float32Array);
  const uvs: number[] = hasUV ? Array.from(srcUV!.array as Float32Array) : [];

  const removedTris = new Set<number>();
  const removedQuads = new Set<number>();
  for (const f of faces) {
    for (const t of f.triIndices) removedTris.add(t);
    if (f.quadIndex !== undefined) removedQuads.add(f.quadIndex);
  }

  const indices: number[] = [];
  const triCount = srcIndex.count / 3;
  for (let t = 0; t < triCount; t++) {
    if (removedTris.has(t)) continue;
    indices.push(srcIndex.getX(t * 3), srcIndex.getX(t * 3 + 1), srcIndex.getX(t * 3 + 2));
  }

  const quadList: number[] = [];
  const quadCount = quadIndices.length / 4;
  for (let q = 0; q < quadCount; q++) {
    if (removedQuads.has(q)) continue;
    quadList.push(quadIndices[q * 4], quadIndices[q * 4 + 1], quadIndices[q * 4 + 2], quadIndices[q * 4 + 3]);
  }

  const uvDelta = wallUVDelta(distance, baseEdgeLen);
  const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _p0 = new THREE.Vector3();
  const newQuadIdx: number[] = [];
  const newTriIdx: number[] = [];

  for (const face of faces) {
    const ring = face.ring;
    _p0.fromBufferAttribute(srcPos, ring[0]);
    _e1.fromBufferAttribute(srcPos, ring[1]).sub(_p0);
    _e2.fromBufferAttribute(srcPos, ring[2]).sub(_p0);
    const faceNormal = _e1.clone().cross(_e2).normalize();

    const wallRing: WallRingVertex[] = ring.map((srcIdx) => ({ srcIdx, normal: faceNormal }));
    const wall = buildWallTriangles(positions, hasUV ? uvs : null, srcPos, hasUV ? srcUV! : null, wallRing, distance, uvDelta, true);
    indices.push(...wall.wallTriangles);

    // Cap gets its own brand-new vertices (not shared with the wall's cap
    // row) — its UV copies the source directly (shape-preserving) rather
    // than the wall's offset UV, which would distort the cap's texture.
    const capIdx: number[] = [];
    for (const srcIdx of ring) {
      const p = new THREE.Vector3().fromBufferAttribute(srcPos, srcIdx);
      capIdx.push(positions.length / 3);
      positions.push(p.x + faceNormal.x * distance, p.y + faceNormal.y * distance, p.z + faceNormal.z * distance);
      if (hasUV) uvs.push(srcUV!.getX(srcIdx), srcUV!.getY(srcIdx));
    }

    if (capIdx.length === 4) {
      newQuadIdx.push(quadList.length / 4);
      quadList.push(capIdx[0], capIdx[1], capIdx[2], capIdx[3]);
      indices.push(capIdx[0], capIdx[1], capIdx[2], capIdx[0], capIdx[2], capIdx[3]);
    } else {
      newTriIdx.push(indices.length / 3);
      indices.push(capIdx[0], capIdx[1], capIdx[2]);
    }
  }

  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (hasUV) newGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  newGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  newGeo.computeVertexNormals();

  return { geometry: newGeo, quadIndices: new Uint32Array(quadList), newQuadIdx, newTriIdx };
}

export type ExtrudeLoopResult = {
  geometry: THREE.BufferGeometry;
  quadIndices: Uint32Array;
  /** The new outer rim, in the same order/closedness as the input loop — the
   * natural next selection for chaining another loop-extrude. */
  newLoop: EdgeLoop;
};

/** Extrudes a boundary edge loop (the open rim of a tube-like primitive) by
 * duplicating the ring along each vertex's own normal and building walls —
 * no cap, since this just extends the open end. Interior loops (loop.boundary
 * === false) are out of scope for this pass — callers must check that before
 * calling and show an explanatory message instead. */
export function extrudeEdgeLoop(
  geometry: THREE.BufferGeometry,
  quadIndices: Uint32Array,
  loop: EdgeLoop,
  distance: number,
  baseEdgeLen: number,
): ExtrudeLoopResult {
  const srcPos = geometry.attributes.position as THREE.BufferAttribute;
  const srcUV = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  const srcNormal = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  const srcIndex = geometry.index!;
  const hasUV = !!srcUV;

  const positions: number[] = Array.from(srcPos.array as Float32Array);
  const uvs: number[] = hasUV ? Array.from(srcUV!.array as Float32Array) : [];
  const indices: number[] = Array.from(srcIndex.array as ArrayLike<number>);

  const ringVerts = loop.closed
    ? loop.edges.map((e) => e.v0)
    : [loop.edges[0].v0, ...loop.edges.map((e) => e.v1)];

  const n = new THREE.Vector3();
  const wallRing: WallRingVertex[] = ringVerts.map((srcIdx) => {
    const normal = srcNormal ? n.clone().fromBufferAttribute(srcNormal, srcIdx) : new THREE.Vector3(0, 1, 0);
    return { srcIdx, normal };
  });

  const uvDelta = wallUVDelta(distance, baseEdgeLen);
  const wall = buildWallTriangles(positions, hasUV ? uvs : null, srcPos, hasUV ? srcUV! : null, wallRing, distance, uvDelta, loop.closed);
  indices.push(...wall.wallTriangles);

  const newRingEdges: LoopEdge[] = [];
  const segCount = loop.closed ? wall.capIdx.length : wall.capIdx.length - 1;
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % wall.capIdx.length;
    newRingEdges.push({ v0: wall.capIdx[i], v1: wall.capIdx[j] });
  }

  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (hasUV) newGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  newGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  newGeo.computeVertexNormals();

  return {
    geometry: newGeo,
    quadIndices: new Uint32Array(quadIndices), // unchanged — new wall segments stay unpaired (V1 simplification)
    newLoop: { edges: newRingEdges, closed: loop.closed, boundary: true },
  };
}

/** Dev-time sanity check: no zero-area triangles, no edge shared by more
 * than 2 triangles. Returns an empty array when the geometry looks sound. */
export function findGeometryIssues(geometry: THREE.BufferGeometry): string[] {
  const issues: string[] = [];
  const index = geometry.index;
  const pos = geometry.attributes.position;
  if (!index) return ["no index buffer"];

  const edgeCount = new Map<string, number>();
  const triCount = index.count / 3;
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const a = index.getX(t * 3), b = index.getX(t * 3 + 1), c = index.getX(t * 3 + 2);
    p0.fromBufferAttribute(pos, a);
    p1.fromBufferAttribute(pos, b);
    p2.fromBufferAttribute(pos, c);
    const area = p1.clone().sub(p0).cross(p2.clone().sub(p0)).length() * 0.5;
    if (area < 1e-10) issues.push(`triangle ${t} is degenerate (zero area)`);
    for (const [x, y] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = x < y ? `${x}_${y}` : `${y}_${x}`;
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
  for (const [k, count] of edgeCount) {
    if (count > 2) issues.push(`edge ${k} referenced by ${count} triangles (non-manifold)`);
  }
  return issues;
}
