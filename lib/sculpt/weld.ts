// Welds position-coincident-but-index-duplicate vertices (e.g. the face
// seams every UV-mapped primitive ships with — BoxGeometry alone has 24
// raw vertices for 8 physical corners) into ONE real shared vertex per
// physical point. Distinct from SeamData/buildSeamData (seams.ts), which
// treats duplicates as "the same point" for various downstream
// operations without touching the source buffers — this literally
// rebuilds the geometry so there's nothing left to canonicalize
// (buildSeamData on the result gives only singleton groups).
//
// Intended for procedurally-generated primitives only (see
// buildPrimitiveGeometry in SculptViewer.tsx), not arbitrary imported
// meshes, where preserving authored per-face UV seams may matter.
//
// Trade-off, accepted deliberately: a welded vertex can only carry ONE
// UV value, so a texture can pull/distort right at a former hard-edge
// seam — this tool's masking/sculpting is vertex-color driven, not
// texture-UV driven, so this is expected to be a non-issue in practice.
// Normal/color attributes are dropped entirely; both get rebuilt
// downstream by the existing load pipeline (computeVertexNormals, mask
// painting), so there's nothing meaningful to carry forward for them.

import * as THREE from "three";

export function weldGeometryByPosition(geometry: THREE.BufferGeometry, tolerance = 1e-5): THREE.BufferGeometry {
  const srcPos = geometry.attributes.position as THREE.BufferAttribute;
  const srcUv = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  const srcIndex = geometry.index;
  const inv = 1 / tolerance;

  const keyToNewIndex = new Map<string, number>();
  const remap = new Uint32Array(srcPos.count);
  const positions: number[] = [];
  const uvs: number[] | null = srcUv ? [] : null;
  for (let i = 0; i < srcPos.count; i++) {
    const x = Math.round(srcPos.getX(i) * inv);
    const y = Math.round(srcPos.getY(i) * inv);
    const z = Math.round(srcPos.getZ(i) * inv);
    const key = `${x},${y},${z}`;
    let newIndex = keyToNewIndex.get(key);
    if (newIndex === undefined) {
      newIndex = positions.length / 3;
      keyToNewIndex.set(key, newIndex);
      positions.push(srcPos.getX(i), srcPos.getY(i), srcPos.getZ(i));
      if (uvs) uvs.push(srcUv!.getX(i), srcUv!.getY(i));
    }
    remap[i] = newIndex;
  }

  const srcVertCount = srcIndex ? srcIndex.count : srcPos.count;
  const indices = new Array<number>(srcVertCount);
  for (let i = 0; i < srcVertCount; i++) {
    const raw = srcIndex ? srcIndex.getX(i) : i;
    indices[i] = remap[raw];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (uvs) geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}
