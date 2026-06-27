// Builds a co-location map so that vertices sharing the same 3D position
// (UV-seam duplicates) are always displaced together during sculpting.
// Without this, seam edges tear open when one side is moved and the other isn't.

export type SeamData = {
  /** vertex index → seam group index */
  vertToGroup: Uint32Array;
  /** seam group index → all vertex indices at that position */
  groups: number[][];
};

export function buildSeamData(positions: Float32Array): SeamData {
  const n = positions.length / 3;
  const keyToGroup = new Map<string, number>();
  const groups: number[][] = [];
  const vertToGroup = new Uint32Array(n);

  for (let i = 0; i < n; i++) {
    // Quantise to 5 decimal places — precise enough for any realistic model scale.
    const x = Math.round(positions[i * 3]     * 1e5);
    const y = Math.round(positions[i * 3 + 1] * 1e5);
    const z = Math.round(positions[i * 3 + 2] * 1e5);
    const key = `${x},${y},${z}`;

    let g = keyToGroup.get(key);
    if (g === undefined) {
      g = groups.length;
      keyToGroup.set(key, g);
      groups.push([]);
    }
    groups[g].push(i);
    vertToGroup[i] = g;
  }

  return { vertToGroup, groups };
}
