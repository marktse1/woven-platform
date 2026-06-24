// Sobel-style height -> normal derivation for Substance Weaver's relief
// brush, plus the additive blend that lets painted relief sit on top of an
// asset's existing normal map without replacing it.

import { clampRectToCanvas, type DirtyRect, type HeightField } from "./brush";

function heightAt(field: HeightField, x: number, y: number): number {
  const cx = Math.max(0, Math.min(field.width - 1, x)); // clamp-to-edge: UV islands aren't seamless/tileable
  const cy = Math.max(0, Math.min(field.height - 1, y));
  return field.data[cy * field.width + cx];
}

function expandRect(rect: DirtyRect, margin: number, width: number, height: number): DirtyRect {
  const x = Math.max(0, Math.floor(rect.x) - margin);
  const y = Math.max(0, Math.floor(rect.y) - margin);
  const right = Math.min(width, Math.ceil(rect.x + rect.width) + margin);
  const bottom = Math.min(height, Math.ceil(rect.y + rect.height) + margin);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/**
 * Derives a normal map from a height field, writing into `normalOut` only
 * over `rect` (expanded by 1px - the kernel reads x/y +-1). Cheap enough to
 * call on every pointermove tick: the height field is a plain buffer
 * (direct indexing, no canvas copy), and the write is bounded to the brush's
 * dirty region, not the full texture. Returns the actual (expanded, clamped)
 * region written.
 */
export function deriveNormalRegion(
  heightField: HeightField,
  normalOut: ImageData,
  rect: DirtyRect,
  strength: number,
): DirtyRect {
  const { width, height } = heightField;
  const n = normalOut.data;
  const region = expandRect(rect, 1, width, height);

  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const left = heightAt(heightField, x - 1, y);
      const right = heightAt(heightField, x + 1, y);
      const up = heightAt(heightField, x, y - 1);
      const down = heightAt(heightField, x, y + 1);

      const dx = ((right - left) / 255) * strength;
      const dy = ((down - up) / 255) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);

      const i = (y * width + x) * 4;
      n[i] = Math.round((-dx / len) * 0.5 * 255 + 127.5);
      n[i + 1] = Math.round((-dy / len) * 0.5 * 255 + 127.5);
      n[i + 2] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      n[i + 3] = 255;
    }
  }

  return region;
}

/** Full-field pass - run once on save to eliminate any seams between separately-dirtied regions. */
export function deriveNormalFull(heightField: HeightField, strength: number): ImageData {
  const { width, height } = heightField;
  const out = new ImageData(width, height);
  deriveNormalRegion(heightField, out, { x: 0, y: 0, width, height }, strength);
  return out;
}

function decodeNormalXY(data: Uint8ClampedArray, i: number): [number, number] {
  return [(data[i] / 255) * 2 - 1, (data[i + 1] / 255) * 2 - 1];
}

/**
 * Blends a static base normal map with a height-derived relief normal map by
 * adding their XY tilt components and reconstructing Z - "additive, never
 * replace" so painted relief sits on top of any existing baked detail
 * instead of erasing it. Restricted to `rect` if given (else whole image).
 */
export function blendNormalsAdditive(baseNormal: ImageData, derivedNormal: ImageData, rect?: DirtyRect): ImageData {
  const { width, height } = baseNormal;
  const out = new ImageData(width, height);
  out.data.set(baseNormal.data);

  const region = rect ? clampRectToCanvas(rect, width, height) : { x: 0, y: 0, width, height };

  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const i = (y * width + x) * 4;
      const [bx, by] = decodeNormalXY(baseNormal.data, i);
      const [dx, dy] = decodeNormalXY(derivedNormal.data, i);

      let nx = bx + dx;
      let ny = by + dy;
      const nz = Math.sqrt(Math.max(0, 1 - Math.min(0.999999, nx * nx + ny * ny)));
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len;
      ny /= len;
      const nzNorm = nz / len;

      out.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out.data[i + 2] = Math.round((nzNorm * 0.5 + 0.5) * 255);
      out.data[i + 3] = 255;
    }
  }

  return out;
}
