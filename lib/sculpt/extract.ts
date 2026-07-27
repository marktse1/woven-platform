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

/** Triangles whose average vertex mask exceeds `threshold` — shared by extract and detach. */
function selectMaskedTriangles(
  index: THREE.BufferAttribute | THREE.Uint16BufferAttribute | THREE.Uint32BufferAttribute,
  mask: Float32Array,
  threshold: number,
): [number, number, number][] {
  const triCount = index.count / 3;
  const includedTris: [number, number, number][] = [];
  for (let t = 0; t < triCount; t++) {
    const a = index.getX(t * 3), b = index.getX(t * 3 + 1), c = index.getX(t * 3 + 2);
    if ((mask[a] + mask[b] + mask[c]) / 3 > threshold) includedTris.push([a, b, c]);
  }
  return includedTris;
}

export function extractMaskedRegion(geometry: THREE.BufferGeometry, options: ExtractOptions): ExtractResult {
  const { mask, threshold, thickness } = options;
  const index = geometry.index;
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined;
  const normalAttr = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  const uvAttr = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  const colorAttr = geometry.attributes.color as THREE.BufferAttribute | undefined;
  if (!index || !position) return { ok: false, reason: "Geometry has no index/position buffer." };
  if (!normalAttr) return { ok: false, reason: "Geometry has no normal buffer." };
  if (mask.length < position.count) return { ok: false, reason: "Mask doesn't cover every vertex." };

  // ── 1. Select triangles whose average mask exceeds the threshold ──────────
  const includedTris = selectMaskedTriangles(index, mask, threshold);
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
  const uvs: number[] | null = uvAttr ? [] : null;
  const colors: number[] | null = colorAttr ? [] : null;
  for (const srcIdx of usedVerts) {
    positions.push(position.getX(srcIdx), position.getY(srcIdx), position.getZ(srcIdx));
    if (uvs) uvs.push(uvAttr!.getX(srcIdx), uvAttr!.getY(srcIdx));
    if (colors) colors.push(colorAttr!.getX(srcIdx), colorAttr!.getY(srcIdx), colorAttr!.getZ(srcIdx));
  }
  // Back layer: same vertex subset, offset along each vertex's own
  // (source-geometry) normal by `thickness`. UVs/colors are duplicated
  // unchanged — same surface point, just pushed along its normal.
  for (const srcIdx of usedVerts) {
    positions.push(
      position.getX(srcIdx) + normalAttr.getX(srcIdx) * thickness,
      position.getY(srcIdx) + normalAttr.getY(srcIdx) * thickness,
      position.getZ(srcIdx) + normalAttr.getZ(srcIdx) * thickness,
    );
    if (uvs) uvs.push(uvAttr!.getX(srcIdx), uvAttr!.getY(srcIdx));
    if (colors) colors.push(colorAttr!.getX(srcIdx), colorAttr!.getY(srcIdx), colorAttr!.getZ(srcIdx));
  }

  // Winding: built below assuming POSITIVE thickness (back layer offset
  // outward along the source normal). Under that convention the FRONT
  // (unmoved) layer becomes the shell's inner-facing wall — it must be
  // wound OPPOSITE to the source triangle's own winding, no longer facing
  // the way the original surface faced. The BACK (offset) layer becomes
  // the shell's new outward-facing side and keeps the source winding.
  // (Verified via explicit cross-product computation on concrete
  // coordinates, not by intuition — see this file's header/plan notes.)
  // If thickness is actually negative, every triangle below gets its
  // winding flipped in one uniform pass afterward, rather than threading
  // a sign check through each push site.
  const indices: number[] = [];
  // Front cap — reversed winding, original positions.
  for (const [a, b, c] of includedTris) {
    indices.push(remap.get(a)!, remap.get(c)!, remap.get(b)!);
  }
  // Back cap — original winding, offset positions.
  for (const [a, b, c] of includedTris) {
    indices.push(frontCount + remap.get(a)!, frontCount + remap.get(b)!, frontCount + remap.get(c)!);
  }
  // Stitched walls along every boundary loop — for each directed boundary
  // edge (p0->p1, using the edge's TRUE triangle-derived direction, not
  // necessarily the loop walk's own traversal direction), the standard
  // outward-consistent wall (for positive thickness) is
  // (p0,p1,p1b),(p0,p1b,p0b). Using dir0/dir1 from edgeInfo rather than the
  // walk's own (cur,next) order is what makes this correct regardless of
  // which way any given loop happened to be walked above.
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

  // Uniform post-process: the whole shell above is built for the
  // positive-thickness convention. For negative thickness the entire
  // relationship inverts (independently re-verified via the same
  // cross-product method with the sign flipped), so flip every triangle's
  // winding in one pass here rather than duplicating the shell logic.
  if (thickness < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const tmp = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = tmp;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (uvs) geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { ok: true, geometry: geo };
}

export type DetachOptions = {
  mask: Float32Array;
  /** 0..1 — a triangle is included if the average of its 3 vertices' mask values exceeds this. */
  threshold: number;
};

export type DetachResult =
  | { ok: true; geometry: THREE.BufferGeometry; selectedTris: [number, number, number][] }
  | { ok: false; reason: string };

/**
 * Detach: pulls triangles that already have real geometry (e.g. a vehicle
 * door or wheel) out of the source mesh into a new independent geometry,
 * copying every existing attribute (position/normal/uv/color) as-authored —
 * no synthetic shell, no offset, no boundary walk. Distinct from
 * extractMaskedRegion, which adds thickness to a flat painted patch.
 * Returns the selected triangles too, so the caller can remove exactly
 * those from the source mesh's own index buffer.
 */
export function detachMaskedRegion(geometry: THREE.BufferGeometry, options: DetachOptions): DetachResult {
  const { mask, threshold } = options;
  const index = geometry.index;
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined;
  const normalAttr = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  const uvAttr = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  const colorAttr = geometry.attributes.color as THREE.BufferAttribute | undefined;
  if (!index || !position) return { ok: false, reason: "Geometry has no index/position buffer." };
  if (mask.length < position.count) return { ok: false, reason: "Mask doesn't cover every vertex." };

  const includedTris = selectMaskedTriangles(index, mask, threshold);
  if (includedTris.length === 0) return { ok: false, reason: "Nothing is masked above the threshold." };

  const usedVerts: number[] = [];
  const remap = new Map<number, number>();
  const noteVertex = (i: number) => {
    if (!remap.has(i)) { remap.set(i, usedVerts.length); usedVerts.push(i); }
  };
  for (const [a, b, c] of includedTris) { noteVertex(a); noteVertex(b); noteVertex(c); }

  const positions: number[] = [];
  const normals: number[] | null = normalAttr ? [] : null;
  const uvs: number[] | null = uvAttr ? [] : null;
  const colors: number[] | null = colorAttr ? [] : null;
  for (const srcIdx of usedVerts) {
    positions.push(position.getX(srcIdx), position.getY(srcIdx), position.getZ(srcIdx));
    if (normals) normals!.push(normalAttr!.getX(srcIdx), normalAttr!.getY(srcIdx), normalAttr!.getZ(srcIdx));
    if (uvs) uvs.push(uvAttr!.getX(srcIdx), uvAttr!.getY(srcIdx));
    if (colors) colors.push(colorAttr!.getX(srcIdx), colorAttr!.getY(srcIdx), colorAttr!.getZ(srcIdx));
  }

  const indices: number[] = [];
  for (const [a, b, c] of includedTris) {
    indices.push(remap.get(a)!, remap.get(b)!, remap.get(c)!);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (normals) geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  if (uvs) geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  if (!normals) geo.computeVertexNormals();
  return { ok: true, geometry: geo, selectedTris: includedTris };
}
