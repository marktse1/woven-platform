// Hand-authored UV-sphere generator for the GLB export route — no
// from-scratch-mesh precedent exists elsewhere in this repo (every other
// gltf-transform usage modifies an already-loaded GLB's existing geometry),
// and the export runs server-side where three.js's own SphereGeometry isn't
// available. Follows the same standard theta/phi sphere algorithm three.js
// uses internally, so the UVs/winding match what the live preview sphere
// (`new THREE.SphereGeometry(1, 64, 48)` in ShaderPreview.tsx) shows.

export type SphereGeometryData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
};

export function buildUvSphere(widthSegments = 32, heightSegments = 16, radius = 0.5): SphereGeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const grid: number[][] = [];

  for (let iy = 0; iy <= heightSegments; iy++) {
    const rowIndices: number[] = [];
    const v = iy / heightSegments;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let ix = 0; ix <= widthSegments; ix++) {
      const u = ix / widthSegments;
      const phi = u * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const x = -radius * cosPhi * sinTheta;
      const y = radius * cosTheta;
      const z = radius * sinPhi * sinTheta;

      positions.push(x, y, z);

      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      normals.push(x / len, y / len, z / len);

      uvs.push(u, 1 - v);

      rowIndices.push(positions.length / 3 - 1);
    }
    grid.push(rowIndices);
  }

  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = grid[iy][ix + 1];
      const b = grid[iy][ix];
      const c = grid[iy + 1][ix];
      const d = grid[iy + 1][ix + 1];

      // Degenerate triangles collapse to nothing at the poles — skip them
      // rather than emitting zero-area triangles.
      if (iy !== 0) indices.push(a, b, d);
      if (iy !== heightSegments - 1) indices.push(b, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}
