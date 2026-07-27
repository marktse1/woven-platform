// ZBrush-style mask extraction: given a source geometry and a per-vertex
// mask (0..1, painted by applyMaskDab in brushes.ts), builds a brand-new,
// independent, thickened+closed shell mesh from the masked region. The
// source geometry is never read-written — this only ever reads it and
// returns a fresh BufferGeometry.
//
// Pure geometry logic, no THREE.Mesh/scene concerns — mirrors this
// codebase's existing split (lib/sculpt/* = math, SculptViewer.tsx =
// orchestration), and lets this, the highest-risk new code in the
// feature, be verified standalone with no browser/WebGL needed.
//
// Reuses two patterns already proven elsewhere in this codebase:
// - The canonical "minIdx_maxIdx" edge-key convention (topology.ts,
//   dyntopo.ts, catmullclark.ts) for the boundary-edge map.
// - topology.ts's walkEdgeLoop() technique (walk from an edge via the
//   unique "other" boundary neighbor at each step) — generalized here
//   into "find and walk every boundary loop", since a mask can produce
//   several: multiple disconnected islands, or a single island shaped
//   like a ring (two loops).

import * as THREE from "three";

export type ExtractOptions = {
  mask: Float32Array;
  /** 0..1 — a triangle is included if the average of its 3 vertices' mask values exceeds this. */
  threshold: number;
  /** Signed, local-space units — how far the back layer is offset along each vertex's own normal. */
  thickness: number;
};

export type ExtractResult =
  | { ok: true; geometry: THREE.BufferGeometry }
  | { ok: false; reason: string };

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function extractMaskedRegion(geometry: THREE.BufferGeometry, options: ExtractOptions): ExtractResult {
  const { mask, threshold, thickness } = options;
  const index = geometry.index;
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined;
  const normalAttr = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  if (!index || !position) return { ok: false, reason: "Geometry has no index/position buffer." };
  if (!normalAttr) return { ok: false, reason: "Geometry has no normal buffer." };
  if (mask.length < position.count) return { ok: false, reason: "Mask doesn't cover every vertex." };

  // ── 1. Select triangles whose average mask exceeds the threshold ──────────
  const triCount = index.count / 3;
  const includedTris: [number, number, number][] = [];
  for (let t = 0; t < triCount; t++) {
    const a = index.getX(t * 3), b = index.getX(t * 3 + 1), c = index.getX(t * 3 + 2);
    if ((mask[a] + mask[b] + mask[c]) / 3 > threshold) includedTris.push([a, b, c]);
  }
  if (includedTris.length === 0) return { ok: false, reason: "Nothing is masked above the threshold." };

  // ── 2. Boundary edges: undirected edges used by exactly one included
  // triangle. Also records the edge's actual directed order as it appeared
  // in that triangle's own winding (dir0->dir1) — needed later to get the
  // stitched wall's winding right regardless of which direction the loop
  // walk below happens to traverse that edge.
  const edgeInfo = new Map<string, { dir0: number; dir1: number; count: number }>();
  for (const [a, b, c] of includedTris) {
    for (const [v0, v1] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = edgeKey(v0, v1);
      const e = edgeInfo.get(k);
      if (e) e.count++;
      else edgeInfo.set(k, { dir0: v0, dir1: v1, count: 1 });
    }
  }
  const boundaryNeighbors = new Map<number, number[]>();
  for (const { dir0, dir1, count } of edgeInfo.values()) {
    if (count !== 1) continue;
    const add = (a: number, b: number) => {
      const list = boundaryNeighbors.get(a);
      if (list) list.push(b); else boundaryNeighbors.set(a, [b]);
    };
    add(dir0, dir1);
    add(dir1, dir0);
  }

  // ── 3. Walk every boundary loop. A well-formed boundary vertex has
  // exactly 2 boundary neighbors; a vertex with more (a branch/pinch point,
  // e.g. two masked islands touching at a single vertex) is a dead end for
  // whichever loop reaches it first — same "stop rather than guess" choice
  // topology.ts's walkEdgeLoop already makes. Those edges simply don't get
  // a stitched wall (a small gap in an unusual mask shape), not a crash.
  const visitedEdges = new Set<string>();
  const loops: number[][] = [];
  for (const v0 of boundaryNeighbors.keys()) {
    for (const v1 of boundaryNeighbors.get(v0)!) {
      const startKey = edgeKey(v0, v1);
      if (visitedEdges.has(startKey)) continue;
      visitedEdges.add(startKey);
      const loop = [v0, v1];
      let prev = v0, cur = v1, closed = false;
      for (let guard = 0; guard < 200_000; guard++) {
        const neighbors = boundaryNeighbors.get(cur) ?? [];
        if (neighbors.length !== 2) break; // dead end / branch point
        const next = neighbors.find((n) => n !== prev);
        if (next === undefined) break;
        const k = edgeKey(cur, next);
        if (next === v0) { visitedEdges.add(k); closed = true; break; }
        if (visitedEdges.has(k)) break;
        visitedEdges.add(k);
        loop.push(next);
        prev = cur; cur = next;
      }
      if (closed && loop.length >= 3) loops.push(loop);
    }
  }

  // ── 4. Remap the used vertex subset into a fresh 0..k-1 index space ───────
  const usedVerts: number[] = [];
  const remap = new Map<number, number>();
  const noteVertex = (i: number) => {
    if (!remap.has(i)) { remap.set(i, usedVerts.length); usedVerts.push(i); }
  };
  for (const [a, b, c] of includedTris) { noteVertex(a); noteVertex(b); noteVertex(c); }
  const frontCount = usedVerts.length;

  const positions: number[] = [];
  for (const srcIdx of usedVerts) {
    positions.push(position.getX(srcIdx), position.getY(srcIdx), position.getZ(srcIdx));
  }
  // Back layer: same vertex subset, offset along each vertex's own
  // (source-geometry) normal by `thickness`.
  for (const srcIdx of usedVerts) {
    positions.push(
      position.getX(srcIdx) + normalAttr.getX(srcIdx) * thickness,
      position.getY(srcIdx) + normalAttr.getY(srcIdx) * thickness,
      position.getZ(srcIdx) + normalAttr.getZ(srcIdx) * thickness,
    );
  }

  const indices: number[] = [];
  // Front cap — original winding, original positions.
  for (const [a, b, c] of includedTris) {
    indices.push(remap.get(a)!, remap.get(b)!, remap.get(c)!);
  }
  // Back cap — same triangles on the offset layer, winding reversed so it
  // faces the opposite direction from the front cap.
  for (const [a, b, c] of includedTris) {
    indices.push(frontCount + remap.get(a)!, frontCount + remap.get(c)!, frontCount + remap.get(b)!);
  }
  // Stitched walls along every boundary loop — for each directed boundary
  // edge (p0->p1, using the edge's TRUE triangle-derived direction, not
  // necessarily the loop walk's own traversal direction), the standard
  // outward-consistent wall is (p0,p1,p1b),(p0,p1b,p0b). Using dir0/dir1
  // from edgeInfo rather than the walk's own (cur,next) order is what makes
  // this correct regardless of which way any given loop happened to be
  // walked above.
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const cur = loop[i], next = loop[(i + 1) % loop.length];
      const info = edgeInfo.get(edgeKey(cur, next));
      if (!info) continue; // shouldn't happen — every loop edge came from edgeInfo
      const [p0, p1] = info.dir0 === cur ? [cur, next] : [next, cur];
      const f0 = remap.get(p0)!, f1 = remap.get(p1)!;
      const b0 = frontCount + f0, b1 = frontCount + f1;
      indices.push(f0, f1, b1, f0, b1, b0);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { ok: true, geometry: geo };
}
