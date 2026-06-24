// Pure brush-stamping logic for Substance Weaver — no React/three.js here.
// The albedo brush stamps onto a real CanvasRenderingContext2D (alpha-blended
// color). The relief/height brush stamps onto a plain Uint8ClampedArray
// buffer (a "HeightField") rather than a real canvas, deliberately: deriving
// normals needs random-access neighbor reads on every pointermove tick, and
// going through canvas getImageData/putImageData for that on every tick
// would mean repeatedly copying the whole texture's pixels just to read a
// few neighbors — a buffer already in memory is direct, cheap indexing.

export type Point = { x: number; y: number };
export type Rgb = { r: number; g: number; b: number };
export type DirtyRect = { x: number; y: number; width: number; height: number };
export type HeightField = { data: Uint8ClampedArray; width: number; height: number };

export function createHeightField(width: number, height: number, initial = 128): HeightField {
  return { data: new Uint8ClampedArray(width * height).fill(initial), width, height };
}

export type StampOptions = {
  /** Brush radius in canvas pixels. */
  radius: number;
  /** 0 (fully soft falloff from center) .. 1 (hard edge). */
  hardness: number;
  /** 0..1 per-stamp strength. */
  opacity: number;
  color: Rgb;
  compositeOperation?: GlobalCompositeOperation;
};

function rgba(c: Rgb, a: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

/** Draws one soft round color stamp centered at `point` onto a real canvas. Returns the dirty rect it touched. */
export function stampDab(ctx: CanvasRenderingContext2D, point: Point, opts: StampOptions): DirtyRect {
  const { radius, hardness, opacity, color, compositeOperation = "source-over" } = opts;
  const innerStop = Math.min(0.99, Math.max(0, hardness));

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = compositeOperation;
  const gradient = ctx.createRadialGradient(point.x, point.y, radius * innerStop, point.x, point.y, radius);
  gradient.addColorStop(0, rgba(color, 1));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  return { x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2 };
}

/**
 * Restores pixels toward a pristine reference image within the brush radius —
 * the albedo eraser blends back toward the originally-seeded texture rather
 * than punching transparency (which isn't meaningful on an opaque base map).
 */
export function stampRestoreDab(
  ctx: CanvasRenderingContext2D,
  pristine: ImageData,
  point: Point,
  opts: { radius: number; hardness: number; opacity: number },
): DirtyRect {
  const { radius, hardness, opacity } = opts;
  const canvas = ctx.canvas;
  const x0 = Math.max(0, Math.floor(point.x - radius));
  const y0 = Math.max(0, Math.floor(point.y - radius));
  const x1 = Math.min(canvas.width, Math.ceil(point.x + radius));
  const y1 = Math.min(canvas.height, Math.ceil(point.y + radius));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return { x: x0, y: y0, width: 0, height: 0 };

  const current = ctx.getImageData(x0, y0, w, h);
  const innerR = radius * Math.min(0.99, Math.max(0, hardness));
  const falloffRange = Math.max(1, radius - innerR);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dist = Math.hypot(x0 + x - point.x, y0 + y - point.y);
      if (dist > radius) continue;
      const falloff = (dist > innerR ? 1 - (dist - innerR) / falloffRange : 1) * opacity;
      const ci = (y * w + x) * 4;
      const pi = ((y0 + y) * pristine.width + (x0 + x)) * 4;
      for (let c = 0; c < 4; c++) {
        current.data[ci + c] = current.data[ci + c] + (pristine.data[pi + c] - current.data[ci + c]) * falloff;
      }
    }
  }
  ctx.putImageData(current, x0, y0);
  return { x: x0, y: y0, width: w, height: h };
}

/** Height-channel stamp: signed brightness delta (raise/lower), direct buffer read-modify-write, no canvas involved. */
export function stampHeightDab(
  field: HeightField,
  point: Point,
  opts: { radius: number; hardness: number; delta: number },
): DirtyRect {
  const { radius, hardness, delta } = opts;
  const x0 = Math.max(0, Math.floor(point.x - radius));
  const y0 = Math.max(0, Math.floor(point.y - radius));
  const x1 = Math.min(field.width, Math.ceil(point.x + radius));
  const y1 = Math.min(field.height, Math.ceil(point.y + radius));
  if (x1 <= x0 || y1 <= y0) return { x: x0, y: y0, width: 0, height: 0 };

  const innerR = radius * Math.min(0.99, Math.max(0, hardness));
  const falloffRange = Math.max(1, radius - innerR);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dist = Math.hypot(x - point.x, y - point.y);
      if (dist > radius) continue;
      const falloff = dist > innerR ? 1 - (dist - innerR) / falloffRange : 1;
      const i = y * field.width + x;
      field.data[i] = field.data[i] + delta * falloff;
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Points along the segment from->to, spaced so fast drags don't leave gaps between stamps. */
export function interpolatedStampPoints(from: Point, to: Point, radius: number): Point[] {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const spacing = Math.max(1, radius * 0.5);
  const steps = Math.max(1, Math.ceil(dist / spacing));
  const points: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return points;
}

export function unionRect(a: DirtyRect, b: DirtyRect): DirtyRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

export function clampRectToCanvas(rect: DirtyRect, width: number, height: number): DirtyRect {
  const x = Math.max(0, Math.min(rect.x, width));
  const y = Math.max(0, Math.min(rect.y, height));
  const right = Math.max(0, Math.min(rect.x + rect.width, width));
  const bottom = Math.max(0, Math.min(rect.y + rect.height, height));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/**
 * Tracks one in-progress pointer-drag stroke: computes the interpolated
 * points to stamp for a move event (filling gaps on fast drags) and
 * accumulates the touched dirty rect. Callers do the actual stamping per
 * point — this class only handles point interpolation + dirty-rect bookkeeping,
 * so it works the same way for both the canvas-backed albedo brush and the
 * buffer-backed height brush.
 */
export class StrokeTracker {
  private lastPoint: Point | null = null;
  dirtyRect: DirtyRect | null = null;

  reset(): void {
    this.lastPoint = null;
    this.dirtyRect = null;
  }

  addDirty(rect: DirtyRect): void {
    if (rect.width <= 0 || rect.height <= 0) return;
    this.dirtyRect = this.dirtyRect ? unionRect(this.dirtyRect, rect) : rect;
  }

  /** Points to stamp for this move event, given the brush radius. Updates internal stroke state. */
  pointsTo(point: Point, radius: number): Point[] {
    const points = this.lastPoint ? interpolatedStampPoints(this.lastPoint, point, radius) : [point];
    this.lastPoint = point;
    return points;
  }
}
