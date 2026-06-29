/**
 * RLE-encodes a trianglePerSegment mapping for transmission to the retopo worker.
 *
 * Consecutive triangles in the same segment (which is the common case — each
 * GLTF primitive is one material/island, so all its triangles share a segment ID)
 * compress to just 2 bytes per run: [segId+1, count]. A typical 50-segment
 * character goes from 1.5 MB down to ~100 bytes.
 *
 * Segment IDs are stored 1-indexed so that 0 = "unset" in Blender face sets.
 * IDs above 253 are clamped to 254 (≤253 real segments is plenty for any mesh).
 * Run lengths are capped at 255; long runs emit multiple pairs.
 */
export function encodeSegmentRle(trianglePerSegment: Int32Array): string {
  const pairs: number[] = [];
  let i = 0;
  while (i < trianglePerSegment.length) {
    const val = trianglePerSegment[i];
    const encoded = Math.min(254, Math.max(1, val + 1)); // 1-indexed, clamped to [1, 254]
    let count = 1;
    while (
      i + count < trianglePerSegment.length &&
      trianglePerSegment[i + count] === val &&
      count < 255
    ) {
      count++;
    }
    pairs.push(encoded, count);
    i += count;
  }

  const bytes = new Uint8Array(pairs);
  // Chunked String.fromCharCode to avoid stack overflow on large arrays
  let binary = "";
  const chunkSize = 0x8000;
  for (let j = 0; j < bytes.length; j += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(j, j + chunkSize)));
  }
  return btoa(binary);
}
