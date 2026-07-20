// Nearest-neighbor mirror-pair finding across the X=0 symmetry plane, for
// ZBrush-style mirror/symmetry sculpting on bipeds. Real sculpted meshes are
// never pixel-exact symmetric, so — unlike buildSeamData's exact-position-key
// co-location grouping — this needs an actual nearest-neighbor search, not
// an exact match. A uniform spatial grid keeps that search fast: bucket
// every vertex by its own position, then for each vertex's REFLECTED
// position, only check the grid cells right around it. Centerline vertices
// naturally self-map (their reflection lands on/near themselves) without
// needing a special case.

export type MirrorData = Map<number, number>; // vertex index -> its mirror vertex index

function cellKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

/**
 * `cellSize` should be roughly the mesh's average edge length (baseEdgeLen)
 * — small enough to keep buckets from getting crowded, large enough that a
 * vertex's true mirror partner (however lightly asymmetric the sculpt) is
 * almost always within a cell or two of its reflected position. Vertices
 * with no match within `2 * cellSize` are left out of the returned map
 * entirely (a genuinely one-sided/asymmetric region of the mesh) — callers
 * should treat a missing entry as "don't mirror this vertex," not an error.
 */
export function buildMirrorData(positions: Float32Array, cellSize: number): MirrorData {
  const n = positions.length / 3;
  const size = Math.max(cellSize, 1e-6);
  const grid = new Map<string, number[]>();

  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const cx = Math.floor(x / size), cy = Math.floor(y / size), cz = Math.floor(z / size);
    const key = cellKey(cx, cy, cz);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i); else grid.set(key, [i]);
  }

  const maxDist = size * 2;
  const maxDistSq = maxDist * maxDist;
  const mirror: MirrorData = new Map();

  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const rx = -x, ry = y, rz = z;
    const cx = Math.floor(rx / size), cy = Math.floor(ry / size), cz = Math.floor(rz / size);

    let bestIdx = -1;
    let bestDistSq = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            const jx = positions[j * 3], jy = positions[j * 3 + 1], jz = positions[j * 3 + 2];
            const ddx = jx - rx, ddy = jy - ry, ddz = jz - rz;
            const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
            if (distSq < bestDistSq) { bestDistSq = distSq; bestIdx = j; }
          }
        }
      }
    }

    if (bestIdx !== -1 && bestDistSq <= maxDistSq) {
      mirror.set(i, bestIdx);
    }
  }

  return mirror;
}
