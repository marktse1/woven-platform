import { dedup, prune } from "@gltf-transform/functions";
import { createWebIO } from "@/lib/gltf/io";

/**
 * Remove triangles belonging to `excludeIds` from the GLB.
 * Iterates meshes/primitives in the same order as `segmentByConnectivity` so
 * the `trianglePerSegment` index lines up correctly.
 */
export async function stripSegments(
  input: ArrayBuffer,
  trianglePerSegment: Int32Array,
  excludeIds: Set<number>,
): Promise<ArrayBuffer> {
  if (excludeIds.size === 0) return input;

  const io = createWebIO();
  const doc = await io.readBinary(new Uint8Array(input));

  let globalTriOffset = 0;

  for (const mesh of doc.getRoot().listMeshes()) {
    // Collect first to avoid mutating during iteration
    const prims = mesh.listPrimitives();
    const toRemove: (typeof prims)[number][] = [];

    for (const prim of prims) {
      const indicesAccessor = prim.getIndices();
      const positionAccessor = prim.getAttribute("POSITION");
      // Mirror the guard in segmentByConnectivity exactly
      if (!indicesAccessor || !positionAccessor) continue;

      const rawIndices = indicesAccessor.getArray();
      if (!rawIndices) continue;

      const srcIndices =
        rawIndices instanceof Uint32Array ? rawIndices : Uint32Array.from(rawIndices);
      const triCount = Math.floor(srcIndices.length / 3);

      const kept: number[] = [];
      for (let t = 0; t < triCount; t++) {
        const segId = trianglePerSegment[globalTriOffset + t];
        if (!excludeIds.has(segId)) {
          kept.push(srcIndices[t * 3], srcIndices[t * 3 + 1], srcIndices[t * 3 + 2]);
        }
      }
      globalTriOffset += triCount;

      if (kept.length === 0) {
        toRemove.push(prim);
      } else {
        indicesAccessor.setArray(new Uint32Array(kept));
      }
    }

    for (const prim of toRemove) {
      mesh.removePrimitive(prim);
      prim.dispose();
    }
  }

  await doc.transform(dedup(), prune());
  const bytes = await io.writeBinary(doc);
  // writeBinary may return a view into a larger buffer — slice to own copy
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
