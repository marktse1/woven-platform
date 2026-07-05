/**
 * Catmull-Clark subdivision for quad-dominant meshes loaded from GLB.
 *
 * GLB stores only triangles, so we first detect which triangle pairs form quads
 * (detectQuads), then apply true CC subdivision (catmullClarkSubdivide).
 * Falls back to Loop subdivision if quad coverage is below MIN_QUAD_RATIO.
 */

import * as THREE from "three";
import { LoopSubdivision } from "three-subdivide";

/** Cos of max angular deviation between two adjacent triangle normals to be
 *  considered coplanar (and therefore part of the same quad). cos(22°) ≈ 0.927 */
const PLANARITY_COS = 0.927;

/** If fewer than this fraction of triangles pair into quads, fall back to Loop. */
const MIN_QUAD_RATIO = 0.5;

// ─── Quad detection ──────────────────────────────────────────────────────────

/**
 * Detects quad faces from a triangulated mesh.
 * Returns a Uint32Array of quad vertex indices (4 per quad, CCW winding),
 * or an empty array if fewer than 50 % of triangles pair up (Loop fallback).
 */
export function detectQuads(geometry: THREE.BufferGeometry): Uint32Array {
  const idxAttr = geometry.index;
  if (!idxAttr) return new Uint32Array(0);

  const pos = geometry.attributes.position;
  const nTris = idxAttr.count / 3;

  // Map each undirected edge → up to 2 {triIdx, oppositeVert} records.
  const edgeMap = new Map<number, Array<{ tri: number; opp: number }>>();

  function edgeKey(a: number, b: number): number {
    // Pack two 20-bit vertex indices into one 40-bit float-safe integer.
    // Works correctly for meshes with < 1 048 576 verts (all real-world cases).
    return (Math.min(a, b) * 1_100_000 + Math.max(a, b));
  }

  for (let t = 0; t < nTris; t++) {
    const a = idxAttr.getX(t * 3), b = idxAttr.getX(t * 3 + 1), c = idxAttr.getX(t * 3 + 2);
    for (const [v0, v1, vopp] of [[a, b, c], [b, c, a], [c, a, b]] as [number, number, number][]) {
      const k = edgeKey(v0, v1);
      let arr = edgeMap.get(k);
      if (!arr) { arr = []; edgeMap.set(k, arr); }
      arr.push({ tri: t, opp: vopp });
    }
  }

  const _na = new THREE.Vector3(), _nb = new THREE.Vector3();
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3();

  function triNormal(t: number, out: THREE.Vector3): void {
    const a = idxAttr!.getX(t * 3), b = idxAttr!.getX(t * 3 + 1), c = idxAttr!.getX(t * 3 + 2);
    _pa.fromBufferAttribute(pos, a);
    _pb.fromBufferAttribute(pos, b);
    _pc.fromBufferAttribute(pos, c);
    out.crossVectors(_pb.sub(_pa), _pc.sub(_pa)).normalize();
  }

  const quads: number[] = [];
  const paired = new Set<number>();

  for (let t0 = 0; t0 < nTris; t0++) {
    if (paired.has(t0)) continue;

    const a = idxAttr.getX(t0 * 3), b = idxAttr.getX(t0 * 3 + 1), c = idxAttr.getX(t0 * 3 + 2);
    triNormal(t0, _na);

    for (const [v0, v1, vopp0] of [[a, b, c], [b, c, a], [c, a, b]] as [number, number, number][]) {
      const data = edgeMap.get(edgeKey(v0, v1));
      if (!data || data.length !== 2) continue;

      const other = data[0].tri === t0 ? data[1] : data[0];
      if (paired.has(other.tri)) continue;

      triNormal(other.tri, _nb);
      if (Math.abs(_na.dot(_nb)) < PLANARITY_COS) continue;

      // CCW quad: [vopp0, v0, vopp1, v1]
      // Derivation: T0 has directed edge v0→v1 in its winding;
      // T1 has that edge reversed (v1→v0). Going around the outer boundary:
      // vopp0 → v0 (T0) → vopp1 (T1) → v1 (T0) → vopp0 ✓
      quads.push(vopp0, v0, other.opp, v1);
      paired.add(t0);
      paired.add(other.tri);
      break;
    }
  }

  const coverage = paired.size / (2 * nTris); // paired triangles / total triangles
  if (coverage < MIN_QUAD_RATIO) return new Uint32Array(0);

  return new Uint32Array(quads);
}

// ─── Catmull-Clark subdivision ────────────────────────────────────────────────

function ek(a: number, b: number) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

type EdgeEntry = { v0: number; v1: number; adjQuads: number[] };

/**
 * One level of Catmull-Clark subdivision.
 * Returns the subdivided BufferGeometry (triangulated) and the updated quad
 * indices (4× as many quads) for chaining further levels.
 *
 * Falls back to LoopSubdivision when quadIndices is empty.
 */
export function catmullClarkSubdivide(
  geometry: THREE.BufferGeometry,
  quadIndices: Uint32Array,
): { geometry: THREE.BufferGeometry; newQuadIndices: Uint32Array } {
  // ── Fallback ────────────────────────────────────────────────────────────────
  if (quadIndices.length === 0) {
    const subdivided = LoopSubdivision.modify(geometry, 1, {
      split: true, uvSmooth: false, flatOnly: false,
      preserveEdges: false, maxTriangles: Infinity,
    });
    return { geometry: subdivided, newQuadIndices: new Uint32Array(0) };
  }

  const pos = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  const nVerts = pos.count;
  const nQuads = quadIndices.length / 4;
  const hasUV = !!uvAttr;

  // ── 1. Face points ───────────────────────────────────────────────────────────
  const fpx = new Float32Array(nQuads);
  const fpy = new Float32Array(nQuads);
  const fpz = new Float32Array(nQuads);
  const fpu = hasUV ? new Float32Array(nQuads) : null;
  const fpv = hasUV ? new Float32Array(nQuads) : null;

  for (let q = 0; q < nQuads; q++) {
    let sx = 0, sy = 0, sz = 0, su = 0, sv = 0;
    for (let i = 0; i < 4; i++) {
      const vi = quadIndices[q * 4 + i];
      sx += pos.getX(vi); sy += pos.getY(vi); sz += pos.getZ(vi);
      if (hasUV && uvAttr) { su += uvAttr.getX(vi); sv += uvAttr.getY(vi); }
    }
    fpx[q] = sx / 4; fpy[q] = sy / 4; fpz[q] = sz / 4;
    if (fpu) { fpu[q] = su / 4; fpv![q] = sv / 4; }
  }

  // ── 2. Edge map ──────────────────────────────────────────────────────────────
  const edgeMap = new Map<string, EdgeEntry>();
  for (let q = 0; q < nQuads; q++) {
    for (let i = 0; i < 4; i++) {
      const v0 = quadIndices[q * 4 + i];
      const v1 = quadIndices[q * 4 + (i + 1) % 4];
      const k = ek(v0, v1);
      if (!edgeMap.has(k)) edgeMap.set(k, { v0, v1, adjQuads: [] });
      edgeMap.get(k)!.adjQuads.push(q);
    }
  }

  // ── 3. Allocate output arrays ────────────────────────────────────────────────
  const nEdges = edgeMap.size;
  const totalVerts = nVerts + nQuads + nEdges;
  const outPos = new Float32Array(totalVerts * 3);
  const outUV  = hasUV ? new Float32Array(totalVerts * 2) : null;

  // Copy original positions (will be updated by CC vertex rule below)
  for (let i = 0; i < nVerts; i++) {
    outPos[i * 3]     = pos.getX(i);
    outPos[i * 3 + 1] = pos.getY(i);
    outPos[i * 3 + 2] = pos.getZ(i);
    if (outUV && uvAttr) { outUV[i * 2] = uvAttr.getX(i); outUV[i * 2 + 1] = uvAttr.getY(i); }
  }

  // Write face points starting at nVerts
  for (let q = 0; q < nQuads; q++) {
    const b = (nVerts + q) * 3;
    outPos[b] = fpx[q]; outPos[b + 1] = fpy[q]; outPos[b + 2] = fpz[q];
    if (outUV && fpu) { outUV[(nVerts + q) * 2] = fpu[q]; outUV[(nVerts + q) * 2 + 1] = fpv![q]; }
  }

  // Write edge points starting at nVerts + nQuads
  const edgeToIdx = new Map<string, number>();
  const epStart = nVerts + nQuads;
  let epIdx = 0;
  for (const [k, { v0, v1, adjQuads }] of edgeMap) {
    const idx = epStart + epIdx++;
    edgeToIdx.set(k, idx);
    const b = idx * 3;
    if (adjQuads.length === 2) {
      // Interior edge: (endpoint0 + endpoint1 + facePoint0 + facePoint1) / 4
      outPos[b]     = (pos.getX(v0) + pos.getX(v1) + fpx[adjQuads[0]] + fpx[adjQuads[1]]) / 4;
      outPos[b + 1] = (pos.getY(v0) + pos.getY(v1) + fpy[adjQuads[0]] + fpy[adjQuads[1]]) / 4;
      outPos[b + 2] = (pos.getZ(v0) + pos.getZ(v1) + fpz[adjQuads[0]] + fpz[adjQuads[1]]) / 4;
    } else {
      // Boundary edge: midpoint
      outPos[b]     = (pos.getX(v0) + pos.getX(v1)) / 2;
      outPos[b + 1] = (pos.getY(v0) + pos.getY(v1)) / 2;
      outPos[b + 2] = (pos.getZ(v0) + pos.getZ(v1)) / 2;
    }
    if (outUV && uvAttr) {
      outUV[idx * 2]     = (uvAttr.getX(v0) + uvAttr.getX(v1)) / 2;
      outUV[idx * 2 + 1] = (uvAttr.getY(v0) + uvAttr.getY(v1)) / 2;
    }
  }

  // ── 4. CC vertex update ──────────────────────────────────────────────────────
  const vertAdjQuads = new Map<number, number[]>();
  const vertAdjEdges = new Map<number, EdgeEntry[]>();

  for (let q = 0; q < nQuads; q++) {
    for (let i = 0; i < 4; i++) {
      const v = quadIndices[q * 4 + i];
      if (!vertAdjQuads.has(v)) vertAdjQuads.set(v, []);
      vertAdjQuads.get(v)!.push(q);
    }
  }
  for (const entry of edgeMap.values()) {
    for (const v of [entry.v0, entry.v1]) {
      if (!vertAdjEdges.has(v)) vertAdjEdges.set(v, []);
      vertAdjEdges.get(v)!.push(entry);
    }
  }

  for (const [v, aQuads] of vertAdjQuads) {
    const n = aQuads.length;
    if (n < 2) continue;

    const adjEdges = vertAdjEdges.get(v) ?? [];
    const isBoundary = adjEdges.some(e => e.adjQuads.length === 1);

    const vx = pos.getX(v), vy = pos.getY(v), vz = pos.getZ(v);

    if (isBoundary) {
      // Boundary vertex: average boundary edge midpoints with original 3:1 weight
      const bEdges = adjEdges.filter(e => e.adjQuads.length === 1);
      if (bEdges.length >= 2) {
        let mx = 0, my = 0, mz = 0;
        for (const e of bEdges) {
          const o = e.v0 === v ? e.v1 : e.v0;
          mx += pos.getX(o); my += pos.getY(o); mz += pos.getZ(o);
        }
        const bn = bEdges.length;
        outPos[v * 3]     = (6 * vx + mx / bn) / 8 * 2; // 6:2 = original : midpoints
        outPos[v * 3 + 1] = (6 * vy + my / bn) / 8 * 2;
        outPos[v * 3 + 2] = (6 * vz + mz / bn) / 8 * 2;
      }
      continue;
    }

    // Interior: Q = avg face points, R = avg edge midpoints
    let Qx = 0, Qy = 0, Qz = 0;
    for (const q of aQuads) { Qx += fpx[q]; Qy += fpy[q]; Qz += fpz[q]; }
    Qx /= n; Qy /= n; Qz /= n;

    let Rx = 0, Ry = 0, Rz = 0;
    for (const e of adjEdges) {
      const o = e.v0 === v ? e.v1 : e.v0;
      Rx += (vx + pos.getX(o)) / 2;
      Ry += (vy + pos.getY(o)) / 2;
      Rz += (vz + pos.getZ(o)) / 2;
    }
    const ne = adjEdges.length;
    if (ne > 0) { Rx /= ne; Ry /= ne; Rz /= ne; }

    // CC formula: V' = (Q + 2R + (n-3)S) / n
    outPos[v * 3]     = (Qx + 2 * Rx + (n - 3) * vx) / n;
    outPos[v * 3 + 1] = (Qy + 2 * Ry + (n - 3) * vy) / n;
    outPos[v * 3 + 2] = (Qz + 2 * Rz + (n - 3) * vz) / n;
  }

  // ── 5. New quads + triangulation ─────────────────────────────────────────────
  const newQuadArr: number[] = [];
  const triArr: number[] = [];
  const fpBase = nVerts;

  for (let q = 0; q < nQuads; q++) {
    const v0 = quadIndices[q * 4], v1 = quadIndices[q * 4 + 1];
    const v2 = quadIndices[q * 4 + 2], v3 = quadIndices[q * 4 + 3];
    const fp  = fpBase + q;
    const e01 = edgeToIdx.get(ek(v0, v1))!;
    const e12 = edgeToIdx.get(ek(v1, v2))!;
    const e23 = edgeToIdx.get(ek(v2, v3))!;
    const e30 = edgeToIdx.get(ek(v3, v0))!;

    // 4 child quads
    for (const [a, b, c, d] of [
      [v0, e01, fp, e30],
      [e01, v1, e12, fp],
      [fp, e12, v2, e23],
      [e30, fp, e23, v3],
    ] as [number, number, number, number][]) {
      newQuadArr.push(a, b, c, d);
      triArr.push(a, b, c, a, c, d); // triangulate each child quad
    }
  }

  // ── 6. Build output geometry ─────────────────────────────────────────────────
  const outGeo = new THREE.BufferGeometry();
  outGeo.setAttribute("position", new THREE.BufferAttribute(outPos, 3));
  if (outUV) outGeo.setAttribute("uv", new THREE.BufferAttribute(outUV, 2));
  outGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(triArr), 1));
  outGeo.computeVertexNormals();

  return { geometry: outGeo, newQuadIndices: new Uint32Array(newQuadArr) };
}
