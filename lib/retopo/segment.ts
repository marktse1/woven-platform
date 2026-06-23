// Deterministic connectivity/material segmentation — purely structural, no
// AI, no heuristics beyond "do these triangles touch." Splits each glTF
// primitive (already a material boundary) into its connected components, so
// segmentation works identically regardless of whether it runs before or
// after decimation/retopology: it's always recomputed fresh from whatever
// the mesh's current primitive/material/connectivity structure is.

import { WebIO } from "@gltf-transform/core";

export type Segment = {
  id: number;
  meshIndex: number;
  primitiveIndex: number;
  materialName: string | null;
  triangleCount: number;
  /** Connected-component index within the primitive (a primitive can have multiple disjoint islands). */
  islandIndex: number;
};

export type SegmentationResult = {
  segments: Segment[];
  /** One entry per triangle, in mesh/primitive iteration order, value = index into `segments`. */
  trianglePerSegment: Int32Array;
};

class UnionFind {
  private parent: Int32Array;

  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Connected components over a primitive's triangle-adjacency graph (shares an edge = same island). */
function connectedComponents(indices: Uint32Array): Int32Array {
  const triCount = indices.length / 3;
  const uf = new UnionFind(triCount);
  const firstTriangleForEdge = new Map<string, number>();

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];
    for (const key of [edgeKey(i0, i1), edgeKey(i1, i2), edgeKey(i2, i0)]) {
      const other = firstTriangleForEdge.get(key);
      if (other === undefined) firstTriangleForEdge.set(key, t);
      else uf.union(t, other);
    }
  }

  const rootToIsland = new Map<number, number>();
  const islandPerTriangle = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const root = uf.find(t);
    let island = rootToIsland.get(root);
    if (island === undefined) {
      island = rootToIsland.size;
      rootToIsland.set(root, island);
    }
    islandPerTriangle[t] = island;
  }
  return islandPerTriangle;
}

export async function segmentByConnectivity(input: ArrayBuffer): Promise<SegmentationResult> {
  const io = new WebIO();
  const doc = await io.readBinary(new Uint8Array(input));

  const segments: Segment[] = [];
  const perPrimitiveSegmentIds: Int32Array[] = [];
  let nextSegmentId = 0;

  doc.getRoot().listMeshes().forEach((mesh, meshIndex) => {
    mesh.listPrimitives().forEach((prim, primitiveIndex) => {
      const indicesAccessor = prim.getIndices();
      const positionAccessor = prim.getAttribute("POSITION");
      if (!indicesAccessor || !positionAccessor) return;

      const rawIndices = indicesAccessor.getArray();
      if (!rawIndices) return;
      const indices = rawIndices instanceof Uint32Array ? rawIndices : Uint32Array.from(rawIndices);
      const triCount = indices.length / 3;
      if (triCount === 0) return;

      const islandPerTriangle = connectedComponents(indices);
      const materialName = prim.getMaterial()?.getName() ?? null;

      const islandTriCounts = new Map<number, number>();
      for (let t = 0; t < triCount; t++) {
        const island = islandPerTriangle[t];
        islandTriCounts.set(island, (islandTriCounts.get(island) ?? 0) + 1);
      }

      const islandToSegmentId = new Map<number, number>();
      for (const [island, triangleCount] of islandTriCounts) {
        islandToSegmentId.set(island, nextSegmentId);
        segments.push({ id: nextSegmentId, meshIndex, primitiveIndex, materialName, triangleCount, islandIndex: island });
        nextSegmentId++;
      }

      const segmentIds = new Int32Array(triCount);
      for (let t = 0; t < triCount; t++) {
        segmentIds[t] = islandToSegmentId.get(islandPerTriangle[t])!;
      }
      perPrimitiveSegmentIds.push(segmentIds);
    });
  });

  const totalTriangles = perPrimitiveSegmentIds.reduce((sum, arr) => sum + arr.length, 0);
  const trianglePerSegment = new Int32Array(totalTriangles);
  let offset = 0;
  for (const arr of perPrimitiveSegmentIds) {
    trianglePerSegment.set(arr, offset);
    offset += arr.length;
  }

  return { segments, trianglePerSegment };
}
