// Terrain heightfield mesh generation — extracted from lib/world-builder/
// editor.ts (originally all nested inside its single `initWorldBuilder`
// closure, like everything else in that file) so a future standalone
// player runtime can render the same terrain the editor does, without
// pulling in editor.ts's ~2,900 lines of authoring-only UI (panels,
// gizmos, undo, terrain-sculpting tools).
//
// Pure functions only — no THREE.Scene/renderer/editor-state references.
// editor.ts keeps thin wrappers around `createTerrainMesh`/
// `buildHeightfield` that supply `waterLevel`/`terrainMaterial` from its
// own state, so none of its existing call sites needed to change.

import * as THREE from "three";
import type { TerrainChunkData } from "./schema";

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function distanceToSegment2d(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq > 0 ? clamp((apx * abx + apz * abz) / lengthSq, 0, 1) : 0;
  const x = ax + abx * t;
  const z = az + abz * t;
  return Math.hypot(px - x, pz - z);
}

export function layerMaskForChunk(chunk: TerrainChunkData) {
  chunk.paintMask ??= {};
  chunk.paintMask.grass ??= new Array(chunk.heights.length).fill(0);
  chunk.paintMask.sand ??= new Array(chunk.heights.length).fill(0);
  return chunk.paintMask;
}

/** Painted grass-BLADE density array for a chunk — separate from
 * layerMaskForChunk's paintMask.grass (a flat color tint, no geometry).
 * Same lazy-init convention. */
export function grassDensityForChunk(chunk: TerrainChunkData) {
  chunk.grassDensity ??= new Array(chunk.heights.length).fill(0);
  return chunk.grassDensity;
}

function autoSandAt(chunk: TerrainChunkData, index: number, waterLevel: number) {
  const height = chunk.heights[index] ?? waterLevel;
  return smoothstep(-0.35, 1.15, waterLevel - height + 0.45) * 0.8;
}

function autoGrassAt(chunk: TerrainChunkData, index: number, waterLevel: number) {
  const height = chunk.heights[index] ?? waterLevel;
  const resolution = chunk.resolution || 33;
  const spacing = chunk.spacing || 2;
  const left = chunk.heights[index - 1] ?? height;
  const right = chunk.heights[index + 1] ?? height;
  const down = chunk.heights[index - resolution] ?? height;
  const up = chunk.heights[index + resolution] ?? height;
  const slope = Math.max(Math.abs(height - left), Math.abs(height - right), Math.abs(height - down), Math.abs(height - up)) / Math.max(1, spacing);
  const elevation = smoothstep(waterLevel + 0.1, waterLevel + 3.6, height);
  const flatness = 1 - smoothstep(0.08, 0.26, slope);
  return clamp(elevation * flatness, 0, 1);
}

export function layerBlendValueAt(chunk: TerrainChunkData, layer: "sand" | "grass", index: number, waterLevel: number) {
  const mask = layerMaskForChunk(chunk);
  const painted = mask[layer]?.[index] ?? 0;
  if (layer === "sand") return Math.max(painted, autoSandAt(chunk, index, waterLevel));
  if (layer === "grass") return Math.max(painted, autoGrassAt(chunk, index, waterLevel));
  return painted;
}

export function buildHeightfield(chunk: TerrainChunkData, waterLevel: number): THREE.BufferGeometry {
  const resolution = chunk.resolution || 33;
  const spacing = chunk.spacing || 2;
  const vertices = resolution * resolution;
  const positions = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const colors = new Float32Array(vertices * 3);
  const indices: number[] = [];
  const heights = chunk.heights ?? [];
  const maxIndex = resolution - 1;
  const originX = chunk.origin?.[0] ?? 0;
  const originZ = chunk.origin?.[1] ?? 0;
  const soilColor: [number, number, number] = [0.49, 0.39, 0.26];
  const sandColor: [number, number, number] = [0.78, 0.68, 0.46];
  const grassColor: [number, number, number] = [0.18, 0.34, 0.16];
  const wetTint: [number, number, number] = [0.14, 0.12, 0.1];

  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      const posIndex = index * 3;
      const height = heights[index] ?? 0;
      const left = heights[index - 1] ?? height;
      const right = heights[index + 1] ?? height;
      const down = heights[index - resolution] ?? height;
      const up = heights[index + resolution] ?? height;
      const slope = Math.max(Math.abs(height - left), Math.abs(height - right), Math.abs(height - down), Math.abs(height - up)) / Math.max(1, spacing);
      const wetness = smoothstep(waterLevel - 0.18, waterLevel + 0.85, waterLevel - height + 0.48);
      const sandWeight = clamp(layerBlendValueAt(chunk, "sand", index, waterLevel), 0, 1);
      const grassWeight = clamp(layerBlendValueAt(chunk, "grass", index, waterLevel), 0, 1);
      const slopeGrass = clamp(1 - smoothstep(0.08, 0.28, slope), 0, 1);
      let sandMix = clamp(sandWeight, 0, 1);
      let grassMix = clamp(grassWeight * slopeGrass, 0, 1);
      const blendSum = sandMix + grassMix;
      if (blendSum > 1) {
        sandMix /= blendSum;
        grassMix /= blendSum;
      }
      const soilMix = clamp(1 - sandMix - grassMix, 0, 1);
      const landColor = [
        soilColor[0] * soilMix + sandColor[0] * sandMix + grassColor[0] * grassMix,
        soilColor[1] * soilMix + sandColor[1] * sandMix + grassColor[1] * grassMix,
        soilColor[2] * soilMix + sandColor[2] * sandMix + grassColor[2] * grassMix,
      ] as [number, number, number];
      const wetDarken = clamp(wetness * 0.35, 0, 0.35);
      const finalColor = mixRgb(landColor, wetTint, wetDarken);
      positions[posIndex] = originX + x * spacing;
      positions[posIndex + 1] = height;
      positions[posIndex + 2] = originZ + z * spacing;
      uvs[index * 2] = x / maxIndex;
      uvs[index * 2 + 1] = z / maxIndex;
      colors[posIndex] = finalColor[0];
      colors[posIndex + 1] = finalColor[1];
      colors[posIndex + 2] = finalColor[2];
    }
  }

  for (let z = 0; z < maxIndex; z += 1) {
    for (let x = 0; x < maxIndex; x += 1) {
      const i = z * resolution + x;
      indices.push(i, i + resolution, i + 1);
      indices.push(i + 1, i + resolution, i + resolution + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createTerrainMesh(chunk: TerrainChunkData, waterLevel: number, terrainMaterial: THREE.Material): THREE.Object3D {
  const geometry = buildHeightfield(chunk, waterLevel);
  const material = terrainMaterial.clone();
  (material as THREE.MeshStandardMaterial).vertexColors = true;
  material.transparent = false;
  material.depthWrite = true;
  material.needsUpdate = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.renderOrder = 0;
  mesh.userData = { kind: "terrain", chunkId: chunk.id, waterMask: chunk.waterMask };
  const group = new THREE.Group();
  group.add(mesh);
  group.userData = { kind: "terrain", chunkId: chunk.id, waterMask: chunk.waterMask };
  return group;
}
