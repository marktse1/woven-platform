import * as THREE from "three";

/** Mean edge length across all triangles — used as DynTopo targetEdgeLen baseline. */
export function computeAvgEdgeLen(geometry: THREE.BufferGeometry): number {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  if (!pos || !idx) return 0.05;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let total = 0;
  let count = 0;

  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    total += a.distanceTo(b) + b.distanceTo(c) + c.distanceTo(a);
    count += 3;
  }

  return count > 0 ? total / count : 0.05;
}

/**
 * Edge-split DynTopo refinement. Mutates geometry in-place.
 *
 * For each triangle whose longest edge exceeds targetEdgeLen × 1.5, inserts a
 * midpoint vertex and splits the triangle into two. Runs up to `passes` times
 * so that cascading splits converge. Returns true if any splits occurred.
 */
export function dynTopoRefine(
  geometry: THREE.BufferGeometry,
  targetEdgeLen: number,
  opts: { maxNewVerts?: number; passes?: number } = {},
): boolean {
  const { maxNewVerts = 2000, passes = 3 } = opts;
  const threshold = targetEdgeLen * 1.5;
  let anyChanged = false;

  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();

  for (let pass = 0; pass < passes; pass++) {
    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const idxAttr = geometry.index!;
    const uvAttr = geometry.attributes.uv as THREE.BufferAttribute | undefined;

    const oldIdxCount = idxAttr.count;
    const oldPosCount = posAttr.count;

    // Phase 1: find longest edge per triangle; register midpoint vertex for each unique
    // edge that exceeds the threshold.  "a_b" key is canonical (a < b).
    const edgeMid = new Map<string, number>();
    const newPosData: number[] = [];
    const newUVData: number[] = [];
    let newVertCount = 0;

    for (let i = 0; i < oldIdxCount; i += 3) {
      const i0 = idxAttr.getX(i);
      const i1 = idxAttr.getX(i + 1);
      const i2 = idxAttr.getX(i + 2);
      const verts = [i0, i1, i2] as const;

      // Find longest edge of this triangle
      let longestE = 0, longestLen = 0;
      for (let e = 0; e < 3; e++) {
        pa.fromBufferAttribute(posAttr, verts[e]);
        pb.fromBufferAttribute(posAttr, verts[(e + 1) % 3]);
        const len = pa.distanceTo(pb);
        if (len > longestLen) { longestLen = len; longestE = e; }
      }
      if (longestLen <= threshold) continue;

      const va = verts[longestE], vb = verts[(longestE + 1) % 3];
      const key = va < vb ? `${va}_${vb}` : `${vb}_${va}`;

      if (!edgeMid.has(key) && newVertCount < maxNewVerts) {
        edgeMid.set(key, oldPosCount + newVertCount++);
        pa.fromBufferAttribute(posAttr, va);
        pb.fromBufferAttribute(posAttr, vb);
        newPosData.push((pa.x + pb.x) * 0.5, (pa.y + pb.y) * 0.5, (pa.z + pb.z) * 0.5);
        if (uvAttr) newUVData.push(
          (uvAttr.getX(va) + uvAttr.getX(vb)) * 0.5,
          (uvAttr.getY(va) + uvAttr.getY(vb)) * 0.5,
        );
      }
    }

    if (newVertCount === 0) break;
    anyChanged = true;

    // Phase 2: grow position (and UV) buffers
    const oldPosArr = posAttr.array as Float32Array;
    const newPosArr = new Float32Array(oldPosArr.length + newPosData.length);
    newPosArr.set(oldPosArr);
    for (let i = 0; i < newPosData.length; i++) newPosArr[oldPosArr.length + i] = newPosData[i];

    let newUVArr: Float32Array | null = null;
    if (uvAttr && newUVData.length) {
      const oldUVArr = uvAttr.array as Float32Array;
      newUVArr = new Float32Array(oldUVArr.length + newUVData.length);
      newUVArr.set(oldUVArr);
      for (let i = 0; i < newUVData.length; i++) newUVArr[oldUVArr.length + i] = newUVData[i];
    }

    // Phase 3: rebuild index buffer.  For each triangle, at most one edge is split
    // (the longest).  Triangles with 2+ edges in edgeMid get only the first
    // matching edge split here; subsequent passes handle the rest.
    //
    // Winding-order convention for split triangle (va, vb, vc) split at midpoint M
    // on edge va→vb:  new triangles are (va, M, vc) and (M, vb, vc) — same CCW
    // winding as the original.  Using cyclic-rotation equivalents where needed.
    const newIndices: number[] = [];

    for (let i = 0; i < oldIdxCount; i += 3) {
      const i0 = idxAttr.getX(i);
      const i1 = idxAttr.getX(i + 1);
      const i2 = idxAttr.getX(i + 2);

      const k01 = i0 < i1 ? `${i0}_${i1}` : `${i1}_${i0}`;
      const k12 = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
      const k20 = i2 < i0 ? `${i2}_${i0}` : `${i0}_${i2}`;

      const m01 = edgeMid.get(k01);
      const m12 = edgeMid.get(k12);
      const m20 = edgeMid.get(k20);

      if (m01 !== undefined) {
        // Split i0→i1 at m01; opposite vertex i2
        newIndices.push(i0, m01, i2, m01, i1, i2);
      } else if (m12 !== undefined) {
        // Split i1→i2 at m12; opposite vertex i0
        newIndices.push(i1, m12, i0, m12, i2, i0);
      } else if (m20 !== undefined) {
        // Split i2→i0 at m20; opposite vertex i1
        newIndices.push(i2, m20, i1, m20, i0, i1);
      } else {
        newIndices.push(i0, i1, i2);
      }
    }

    // Phase 4: commit new buffers to the geometry
    geometry.setAttribute("position", new THREE.BufferAttribute(newPosArr, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
    if (newUVArr && uvAttr) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(newUVArr, 2));
    }
  }

  if (anyChanged) geometry.computeVertexNormals();
  return anyChanged;
}
