// Lazily-built mesh adjacency for poly-edit mode (vertex/edge/face
// selection, edge-loop walking). Sculpt-brush mode never needs this — it's
// built the first time poly-edit mode is entered for a mesh, and thrown
// away (not incrementally patched) whenever the mesh's topology changes,
// matching this codebase's existing convention of rebuilding auxiliary
// structures wholesale after every topology-changing operation (seams via
// buildSeamData, quad pairing via detectQuads, the BVH itself).
//
// The edge-key convention ("minIdx_maxIdx" as a string) matches the spirit
// of dyntopo.ts/catmullclark.ts's own canonical-edge-key approach, even
// though this module doesn't share code with them directly.

import * as THREE from "three";

export type MeshTopology = {
  /** Undirected edge key -> its two endpoints and every triangle touching it. */
  edgeToTris: Map<string, { v0: number; v1: number; tris: number[] }>;
  /** Vertex index -> every triangle it's a corner of. */
  vertToTris: Map<number, number[]>;
  /** Triangle index -> quad index, only for triangles detectQuads paired up. */
  triToQuad: Map<number, number>;
  /** Quad index -> its 4 corner vertex indices, in the CCW cycle detectQuads produced. */
  quadCorners: number[][];
  /**
   * Vertex -> its neighbors across true mesh-boundary edges (edges with
   * exactly one adjacent triangle — an open rim/border, independent of
   * quad pairing). A well-formed boundary vertex has exactly 2; used to
   * walk the connected boundary chain for edge-loop extrude.
   */
  boundaryNeighbors: Map<number, number[]>;
};

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function buildTopology(geometry: THREE.BufferGeometry, quadIndices?: Uint32Array): MeshTopology {
  const index = geometry.index;
  const edgeToTris: MeshTopology["edgeToTris"] = new Map();
  const vertToTris: MeshTopology["vertToTris"] = new Map();
  const triToQuad: MeshTopology["triToQuad"] = new Map();
  const quadCorners: MeshTopology["quadCorners"] = [];
  const boundaryNeighbors: MeshTopology["boundaryNeighbors"] = new Map();

  if (index) {
    const triCount = index.count / 3;
    for (let t = 0; t < triCount; t++) {
      const a = index.getX(t * 3), b = index.getX(t * 3 + 1), c = index.getX(t * 3 + 2);
      for (const v of [a, b, c]) {
        const list = vertToTris.get(v);
        if (list) list.push(t); else vertToTris.set(v, [t]);
      }
      for (const [v0, v1] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        const k = edgeKey(v0, v1);
        const entry = edgeToTris.get(k);
        if (entry) entry.tris.push(t);
        else edgeToTris.set(k, { v0, v1, tris: [t] });
      }
    }
  }

  function addBoundaryNeighbor(a: number, b: number) {
    const list = boundaryNeighbors.get(a);
    if (list) list.push(b); else boundaryNeighbors.set(a, [b]);
  }
  for (const { v0, v1, tris } of edgeToTris.values()) {
    if (tris.length !== 1) continue;
    addBoundaryNeighbor(v0, v1);
    addBoundaryNeighbor(v1, v0);
  }

  if (quadIndices && quadIndices.length > 0) {
    // Reconstruct which triangles each quad was paired from by matching the
    // quad's 4 boundary edges back against edgeToTris — detectQuads hands
    // back only the vertex cycle, not the source triangle indices.
    const quadCount = quadIndices.length / 4;
    for (let q = 0; q < quadCount; q++) {
      const corners = [quadIndices[q * 4], quadIndices[q * 4 + 1], quadIndices[q * 4 + 2], quadIndices[q * 4 + 3]];
      quadCorners.push(corners);
      const quadTris = new Set<number>();
      for (let slot = 0; slot < 4; slot++) {
        const a = corners[slot], b = corners[(slot + 1) % 4];
        const edge = edgeToTris.get(edgeKey(a, b));
        if (edge) for (const t of edge.tris) quadTris.add(t);
      }
      for (const t of quadTris) triToQuad.set(t, q);
    }
  }

  return { edgeToTris, vertToTris, triToQuad, quadCorners, boundaryNeighbors };
}

export type LoopEdge = { v0: number; v1: number };
export type EdgeLoop = { edges: LoopEdge[]; closed: boolean; boundary: boolean };

/**
 * Walks the mesh-boundary chain starting at edge (startV0, startV1) — e.g.
 * the open rim of a cylinder/capsule primitive. This is deliberately NOT
 * the general "cross to the opposite edge of each quad" edge-loop
 * algorithm: that rule walks *perpendicular* to a boundary edge (through
 * the mesh's interior), which is the wrong direction for what this tool
 * actually needs (extrude-along-loop wants the whole rim, to lengthen a
 * tube). Verified empirically against a generated plane and open cylinder
 * before wiring this in — see the risk note in the implementation plan
 * about index-buffer/topology code being the highest-risk part of this
 * feature.
 *
 * `boundary: true` only when the starting edge is itself a true
 * mesh-boundary edge (exactly one adjacent triangle) — anything else is
 * out of scope for V1's extrude-along-loop and the caller should reject it
 * with an explanatory message rather than attempting a walk.
 */
export function walkEdgeLoop(topology: MeshTopology, startV0: number, startV1: number): EdgeLoop {
  const startEdge = topology.edgeToTris.get(edgeKey(startV0, startV1));
  if (!startEdge || startEdge.tris.length !== 1) {
    return { edges: [{ v0: startV0, v1: startV1 }], closed: false, boundary: false };
  }

  function walk(from: number, to: number): { verts: number[]; closedBackToStart: boolean } {
    const verts = [from, to];
    let prev = from, cur = to;
    for (let guard = 0; guard < 100_000; guard++) {
      const neighbors = topology.boundaryNeighbors.get(cur) ?? [];
      const next = neighbors.find((n) => n !== prev);
      if (next === undefined || neighbors.length !== 2) return { verts, closedBackToStart: false }; // dead end or a branch point — chain stops here
      if (next === from) return { verts, closedBackToStart: true };
      verts.push(next);
      prev = cur; cur = next;
    }
    return { verts, closedBackToStart: false };
  }

  const forward = walk(startV0, startV1);
  const toEdges = (verts: number[]): LoopEdge[] => {
    const edges: LoopEdge[] = [];
    for (let i = 0; i < verts.length - 1; i++) edges.push({ v0: verts[i], v1: verts[i + 1] });
    return edges;
  };

  if (forward.closedBackToStart) {
    // toEdges() only connects consecutive entries, so the closing edge back
    // to the start needs to be added explicitly — verts is [v0, v1, ..., vN],
    // and the actual cycle also needs vN -> v0.
    const edges = toEdges(forward.verts);
    edges.push({ v0: forward.verts[forward.verts.length - 1], v1: forward.verts[0] });
    return { edges, closed: true, boundary: true };
  }

  const backward = walk(startV1, startV0);
  // backward.verts runs [startV1, startV0, ...further back...] — reverse it
  // and drop the duplicate overlap with forward's [startV0, startV1, ...]
  // so the two halves join into one continuous ordered chain.
  const mergedVerts = [...backward.verts.slice(2).reverse(), ...forward.verts];
  return { edges: toEdges(mergedVerts), closed: false, boundary: true };
}
