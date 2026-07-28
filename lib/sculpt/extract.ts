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
// Reuses a pattern already proven elsewhere in this codebase: the
// canonical "minIdx_maxIdx" edge-key convention (topology.ts, dyntopo.ts,
// catmullclark.ts) for the boundary-edge map.
//
// Every boundary edge gets its own independent stitched wall quad — no
// loop assembly. An earlier version walked boundary edges into closed
// loops first (topology.ts's walkEdgeLoop() technique, generalized to
// "find every boundary loop"), but that required every canonical vertex
// along the way to have exactly 2 boundary neighbors, which UV-seam
// canonicalization can violate (two raw vertices that were each
// individually fine can merge into one canonical vertex with 4+
// neighbors). Hitting that dropped the *entire* loop being walked, not
// just the one problematic edge — a large, real hole, not "a small gap."
// Stitching per-edge instead sidesteps this rather than working around
// it: nothing here ever inspects vertex degree.

import * as THREE from "three";
import type { SeamData } from "./seams";

export type ExtractOptions = {
  mask: Float32Array;
  /** 0..1 — a triangle is included if the average of its 3 vertices' mask values exceeds this. */
  threshold: number;
  /** Signed, local-space units — how far the back layer is offset along each vertex's own normal. */
  thickness: number;
  /**
   * UV-seam co-location data (same convention as applyBrush/applyMaskDab
   * in brushes.ts — built once by the caller, not recomputed here). Used
   * only to canonicalize boundary-edge detection: without it, a masked
   * region crossing a seam (adjacent duplicate-index vertices at the same
   * position — a UV sphere's longitude seam, or even BoxGeometry's own
   * face boundaries) gets misread as two separate boundary loops instead
   * of one, spuriously splitting the extraction into two coincident-but-
   * disconnected shells that visibly tear apart under smoothing.
   */
  seams: SeamData;
};

export type ExtractResult =
  | { ok: true; geometry: THREE.BufferGeometry }
  | { ok: false; reason: string };

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Stable representative vertex index for `i`'s seam group — two raw
 * indices at the same position (UV-seam duplicates) always canonicalize
 * to the same value, which is what makes seam-crossing edges collapse
 * to a single edgeInfo entry instead of one per side. */
function canonicalVertex(i: number, seams: SeamData): number {
  return seams.groups[seams.vertToGroup[i]][0];
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
  const { mask, threshold, thickness, seams } = options;
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
  // in that triangle's own winding (dir0->dir1) — needed later to get each
  // stitched wall quad's winding right.
  //
  // The map key is canonicalized through `seams` (NOT dir0/dir1, which
  // stay raw) so that a masked region crossing a UV seam — where the
  // "same" edge is walked by different raw vertex indices on each side —
  // is still recognized as one interior edge (used twice) rather than
  // two independent boundary edges (each used once), which would
  // otherwise spuriously split the region into two coincident but
  // disconnected shells (see this file's header/ExtractOptions.seams doc).
  const edgeInfo = new Map<string, { dir0: number; dir1: number; count: number }>();
  for (const [a, b, c] of includedTris) {
    for (const [v0, v1] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = edgeKey(canonicalVertex(v0, seams), canonicalVertex(v1, seams));
      const e = edgeInfo.get(k);
      if (e) e.count++;
      else edgeInfo.set(k, { dir0: v0, dir1: v1, count: 1 });
    }
  }
  // ── 3. Remap the used vertex subset into a fresh 0..k-1 index space ───────
  const usedVerts: number[] = [];
  const remap = new Map<number, number>();
  // A seam-crossing boundary loop can pass through a canonical vertex that
  // TWO different raw indices legitimately claim (one per side of the
  // seam) — e.g. an endpoint of the very edge that just became interior.
  // Caps intentionally keep both raw copies (each with its own UV/color,
  // per this file's "don't weld" design decision), but the wall needs ONE
  // consistent choice per canonical id, or the wall segment arriving via
  // one side's raw index and the one leaving via the other side's would
  // reference different output vertices at the same 3D point — watertight
  // in appearance but not in the index buffer (fails edge-manifold).
  // First-used-wins here, applied consistently below, is what keeps every
  // wall segment touching a given loop vertex pointing at the same output
  // vertex regardless of which side's boundary edge it came from.
  const canonicalRawForWall = new Map<number, number>();
  // At a genuinely interior HARD edge (two masked faces meeting at an
  // angle, e.g. a box corner) each side's raw copy has a DIFFERENT normal
  // even though they share the same front position — offsetting each by
  // its own normal would pull the back layer apart along the entire
  // length of that edge, not just its endpoints (confirmed directly: 12
  // mismatched edges on a subdivided box, scaling with edge density, not
  // a fixed small number). Averaging every used raw copy's normal per
  // seam group and using that shared average for ALL of them closes this
  // — their back positions become identical too, same as their front
  // positions already are. Restricted to `usedVerts` (not the whole
  // mesh's seam group) so an unmasked 3rd face sharing the same corner
  // doesn't skew the average. A no-op whenever a group has only one used
  // member (every currently-passing non-seam test), so this can't change
  // behavior anywhere seams aren't involved.
  const canonicalNormalSum = new Map<number, THREE.Vector3>();
  const noteVertex = (i: number) => {
    if (!remap.has(i)) { remap.set(i, usedVerts.length); usedVerts.push(i); }
    const c = canonicalVertex(i, seams);
    if (!canonicalRawForWall.has(c)) canonicalRawForWall.set(c, i);
    const sum = canonicalNormalSum.get(c);
    if (sum) sum.set(sum.x + normalAttr.getX(i), sum.y + normalAttr.getY(i), sum.z + normalAttr.getZ(i));
    else canonicalNormalSum.set(c, new THREE.Vector3(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i)));
  };
  for (const [a, b, c] of includedTris) { noteVertex(a); noteVertex(b); noteVertex(c); }
  const frontCount = usedVerts.length;

  // Averaged back-offset direction per canonical vertex, normalized once
  // up front. Falls back to the vertex's own raw normal in the (very
  // unusual — e.g. masking both sides of a paper-thin fold) case where a
  // group's normals sum to ~zero, rather than normalizing a near-zero
  // vector into NaN.
  const backOffsetNormal = new Map<number, THREE.Vector3>();
  const backOffsetFor = (srcIdx: number): THREE.Vector3 => {
    const c = canonicalVertex(srcIdx, seams);
    let n = backOffsetNormal.get(c);
    if (n) return n;
    const sum = canonicalNormalSum.get(c)!;
    n = sum.lengthSq() > 1e-10 ? sum.clone().normalize() : new THREE.Vector3(normalAttr.getX(srcIdx), normalAttr.getY(srcIdx), normalAttr.getZ(srcIdx));
    backOffsetNormal.set(c, n);
    return n;
  };

  const positions: number[] = [];
  const uvs: number[] | null = uvAttr ? [] : null;
  const colors: number[] | null = colorAttr ? [] : null;
  for (const srcIdx of usedVerts) {
    positions.push(position.getX(srcIdx), position.getY(srcIdx), position.getZ(srcIdx));
    if (uvs) uvs.push(uvAttr!.getX(srcIdx), uvAttr!.getY(srcIdx));
    if (colors) colors.push(colorAttr!.getX(srcIdx), colorAttr!.getY(srcIdx), colorAttr!.getZ(srcIdx));
  }
  // Back layer: same vertex subset, offset along each vertex's SEAM
  // GROUP's averaged normal (see backOffsetFor above) by `thickness`.
  // UVs/colors are duplicated unchanged — same surface point, just
  // pushed along its (now seam-consistent) offset direction.
  for (const srcIdx of usedVerts) {
    const n = backOffsetFor(srcIdx);
    positions.push(
      position.getX(srcIdx) + n.x * thickness,
      position.getY(srcIdx) + n.y * thickness,
      position.getZ(srcIdx) + n.z * thickness,
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
  // Stitched walls, one independent quad per boundary edge (count === 1
  // entries in edgeInfo) — no loop assembly, so nothing here depends on
  // vertex degree or traversal order (see this file's header comment for
  // why that matters). For each edge, (dir0, dir1) is the TRUE direction
  // as it appeared in its owning triangle's own winding, which is what
  // keeps every wall quad's winding correct regardless of iteration
  // order. Each endpoint is resolved through its canonical group's single
  // consistently-chosen raw vertex (canonicalRawForWall), not dir0/dir1
  // directly — using dir0/dir1 as-is would reintroduce the seam-
  // transition mismatch that map exists to avoid (two wall quads meeting
  // at a seam-crossing corner would otherwise reference different output
  // vertices at the same 3D point).
  for (const { dir0, dir1, count } of edgeInfo.values()) {
    if (count !== 1) continue;
    const p0c = canonicalVertex(dir0, seams), p1c = canonicalVertex(dir1, seams);
    const p0 = canonicalRawForWall.get(p0c)!, p1 = canonicalRawForWall.get(p1c)!;
    const f0 = remap.get(p0)!, f1 = remap.get(p1)!;
    const b0 = frontCount + f0, b1 = frontCount + f1;
    indices.push(f0, f1, b1, f0, b1, b0);
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
