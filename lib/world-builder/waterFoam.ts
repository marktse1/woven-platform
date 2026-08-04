// Shoreline-aware foam for World Builder's placed/terrain-wide water —
// pure data-baking logic, no Three.js scene/material wiring (that lives in
// editor.ts, which imports buildShoreWetnessTexture and injects the result
// into THREE.Water's own shader via onBeforeCompile).
//
// The wetness formula here is intentionally identical to editor.ts's own
// waterPresenceAt(chunks, x, z, waterLevel) — bilinear-sampled
// chunk.waterMask blended with a submersion-depth falloff — reused
// directly rather than reimplemented a second, possibly-diverging way.
// Placed water objects aren't terrain-grid-aligned (arbitrary flat planes
// the user drags/scales into place), so this bakes ONE shared texture
// covering the whole terrain's world extent, sampled per-pixel in the
// water fragment shader by world-space position, rather than trying to
// bake per-vertex like the older (dead) createWaterMesh path did.

import * as THREE from "three";
import type { TerrainChunkData } from "./schema";

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** Same formula as editor.ts's waterPresenceAt — see file header — with
 * one deliberate difference: height is bilinear-sampled directly from
 * the chunk this loop already located via the range check below, rather
 * than going through sampleTerrainHeight's chunk-ID lookup (which needs
 * a chunkSize/district match this pure function has no reliable way to
 * know outside the live editor's own state — confirmed by a standalone
 * test that silently fell back to a wrong default height without this). */
function wetnessAt(chunks: TerrainChunkData[], x: number, z: number, waterLevel: number): number {
  let best = 0;
  for (const chunk of chunks) {
    const resolution = chunk.resolution || 33;
    const spacing = chunk.spacing || 2;
    const originX = chunk.origin?.[0] ?? 0;
    const originZ = chunk.origin?.[1] ?? 0;
    const maxX = originX + (resolution - 1) * spacing;
    const maxZ = originZ + (resolution - 1) * spacing;
    if (x < originX - spacing || x > maxX + spacing || z < originZ - spacing || z > maxZ + spacing) continue;

    const waterMask = chunk.waterMask ?? [];
    const localX = clamp((x - originX) / spacing, 0, resolution - 1);
    const localZ = clamp((z - originZ) / spacing, 0, resolution - 1);
    const x0 = Math.floor(localX);
    const z0 = Math.floor(localZ);
    const x1 = Math.min(x0 + 1, resolution - 1);
    const z1 = Math.min(z0 + 1, resolution - 1);
    const tx = localX - x0;
    const tz = localZ - z0;
    const maskSample = (
      (waterMask[z0 * resolution + x0] ? 1 : 0) * (1 - tx) * (1 - tz) +
      (waterMask[z0 * resolution + x1] ? 1 : 0) * tx * (1 - tz) +
      (waterMask[z1 * resolution + x0] ? 1 : 0) * (1 - tx) * tz +
      (waterMask[z1 * resolution + x1] ? 1 : 0) * tx * tz
    );
    // chunk.heights?.[...] — a shell chunk (an object placed outside every
    // generated terrain chunk's bounds gets a `terrain: {}` row on save,
    // see terrainMesh.ts's note above layerMaskForChunk) has heights
    // genuinely undefined; resolution/origin above already fall back to
    // defaults, which is exactly what lets a shell chunk reach this far.
    const heightAt = (sx: number, sz: number) => chunk.heights?.[sz * resolution + sx] ?? waterLevel;
    const height = (
      heightAt(x0, z0) * (1 - tx) * (1 - tz) +
      heightAt(x1, z0) * tx * (1 - tz) +
      heightAt(x0, z1) * (1 - tx) * tz +
      heightAt(x1, z1) * tx * tz
    );
    const submerged = clamp((waterLevel - height + 0.35) / 1.5, 0, 1);
    best = Math.max(best, Math.max(maskSample * 0.95, submerged));
  }
  return best;
}

export type ShoreWetnessBake = {
  texture: THREE.DataTexture;
  /** World-space XZ of the texture's (0,0) UV corner. */
  origin: [number, number];
  /** World-space size the texture spans, so (worldXZ - origin) / worldSize gives UV. */
  worldSize: [number, number];
};

/**
 * Bakes one shared grayscale texture over the terrain's full world-space
 * extent — each texel is exactly the same 0..1 wetness value
 * waterPresenceAt already computes per-point: bright near/under water,
 * dark on dry land, smoothly graded in between. Returns null if there's
 * no terrain to bake from (nothing to be near a shore of).
 */
export function buildShoreWetnessTexture(chunks: TerrainChunkData[], waterLevel: number, size = 512): ShoreWetnessBake | null {
  if (chunks.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const chunk of chunks) {
    const resolution = chunk.resolution || 33;
    const spacing = chunk.spacing || 2;
    const originX = chunk.origin?.[0] ?? 0;
    const originZ = chunk.origin?.[1] ?? 0;
    minX = Math.min(minX, originX);
    minZ = Math.min(minZ, originZ);
    maxX = Math.max(maxX, originX + (resolution - 1) * spacing);
    maxZ = Math.max(maxZ, originZ + (resolution - 1) * spacing);
  }
  const worldSizeX = Math.max(1, maxX - minX);
  const worldSizeZ = Math.max(1, maxZ - minZ);

  // Row 0 = minZ, matching DataTexture's default flipY=false (UV v=0 is
  // the first row of `data`) — so (worldZ - originZ)/worldSizeZ in the
  // shader lines up with this loop without needing a V-flip.
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    const z = minZ + (row / (size - 1)) * worldSizeZ;
    for (let col = 0; col < size; col++) {
      const x = minX + (col / (size - 1)) * worldSizeX;
      const wetness = wetnessAt(chunks, x, z, waterLevel);
      const v = Math.round(clamp(wetness, 0, 1) * 255);
      const i = (row * size + col) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return { texture, origin: [minX, minZ], worldSize: [worldSizeX, worldSizeZ] };
}
