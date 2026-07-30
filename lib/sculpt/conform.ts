// Wraps a mesh's current geometry onto the surface of a reference mesh —
// "Conform to Reference," the practical stand-in for a literal ZBrush-style
// per-subdivision-level Import. A real Import requires the imported OBJ to
// have the exact same vertex count and order as the level it's replacing,
// which ZBrush can guarantee internally but this codebase has no way to
// reproduce (undocumented, engine-specific subdivision vertex ordering — see
// the "Conform to Reference" plan this was built from for the full
// reasoning). Conform sidesteps that entirely: it doesn't care about the
// reference's vertex count or order at all, just its surface, so it works
// with an unmodified ZBrush export regardless of how differently the two
// engines subdivided.

import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { SeamData } from "./seams";

const _point = new THREE.Vector3();

/**
 * For every seam group (not raw vertex — seam-duplicate copies of the same
 * physical point move together, so a reference mesh with slightly different
 * geometry at that exact spot can't reopen the seam by snapping each copy
 * to a different nearby point) in `seams`, finds the closest point on
 * `referenceGeometry`'s surface and moves every vertex in that group there.
 * Mutates `mesh.geometry`'s position attribute in place and recomputes
 * normals once at the end, matching every other geometry-mutating operation
 * in this codebase (see e.g. applyBrush in brushes.ts).
 */
export function conformToReference(
  mesh: THREE.Mesh,
  seams: SeamData,
  referenceGeometry: THREE.BufferGeometry,
): void {
  mesh.updateMatrixWorld(true);
  const referenceBVH = new MeshBVH(referenceGeometry);
  const positions = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const matWorld = mesh.matrixWorld;
  const invMatWorld = new THREE.Matrix4().copy(matWorld).invert();

  for (const group of seams.groups) {
    if (group.length === 0) continue;
    const first = group[0];
    _point.fromBufferAttribute(positions, first).applyMatrix4(matWorld);
    const hit = referenceBVH.closestPointToPoint(_point);
    if (!hit) continue; // leave this group untouched rather than crash or zero it out
    const local = hit.point.clone().applyMatrix4(invMatWorld);
    for (const idx of group) {
      positions.setXYZ(idx, local.x, local.y, local.z);
    }
  }

  positions.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}
