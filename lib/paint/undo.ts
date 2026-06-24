// Tile-based undo/redo for Substance Weaver. Snapshotting the whole canvas
// (or whole height field) per stroke would be wasteful for a typical small
// brush dab on a large texture - instead, lazily snapshot only the ~128x128px
// tiles a stroke actually touches, the first time each tile is touched
// during that stroke. Works generically over a small PaintSurface interface
// so the same stack handles both the real-canvas albedo layer and the
// plain-buffer height field.

import type { DirtyRect, HeightField } from "./brush";
import { unionRect } from "./brush";

const TILE_SIZE = 128;

export type CanvasId = "albedo" | "height";

/** A tile snapshot is opaque to the stack - each surface type decides its own representation. Dimensions are passed alongside since a bare buffer can't self-describe its own width. */
export interface PaintSurface {
  getTile(x: number, y: number, w: number, h: number): unknown;
  putTile(x: number, y: number, w: number, h: number, tile: unknown): void;
}

export function canvasSurface(ctx: CanvasRenderingContext2D): PaintSurface {
  return {
    getTile: (x, y, w, h) => ctx.getImageData(x, y, w, h),
    putTile: (x, y, _w, _h, tile) => ctx.putImageData(tile as ImageData, x, y),
  };
}

export function heightFieldSurface(field: HeightField): PaintSurface {
  return {
    getTile: (x, y, w, h) => {
      const out = new Uint8ClampedArray(w * h);
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          out[row * w + col] = field.data[(y + row) * field.width + (x + col)];
        }
      }
      return out;
    },
    putTile: (x, y, w, h, tile) => {
      const data = tile as Uint8ClampedArray;
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          field.data[(y + row) * field.width + (x + col)] = data[row * w + col];
        }
      }
    },
  };
}

type TileSnapshot = {
  tileX: number;
  tileY: number;
  width: number;
  height: number;
  before: unknown;
  after: unknown | null;
};

type StrokeRecord = {
  canvas: CanvasId;
  tiles: TileSnapshot[];
};

export class PaintUndoStack {
  private undoStack: StrokeRecord[] = [];
  private redoStack: StrokeRecord[] = [];
  private activeTiles: Map<string, TileSnapshot> | null = null;
  private activeCanvasId: CanvasId | null = null;

  beginStroke(canvasId: CanvasId): void {
    this.activeTiles = new Map();
    this.activeCanvasId = canvasId;
  }

  /** Call BEFORE stamping a dab - snapshots any tiles `rect` overlaps that this stroke hasn't touched yet. */
  trackDirty(surface: PaintSurface, rect: DirtyRect, fieldWidth: number, fieldHeight: number): void {
    if (!this.activeTiles) return;
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(fieldWidth, rect.x + rect.width);
    const y1 = Math.min(fieldHeight, rect.y + rect.height);
    if (x1 <= x0 || y1 <= y0) return;

    const tx0 = Math.floor(x0 / TILE_SIZE);
    const ty0 = Math.floor(y0 / TILE_SIZE);
    const tx1 = Math.floor((x1 - 1) / TILE_SIZE);
    const ty1 = Math.floor((y1 - 1) / TILE_SIZE);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = `${tx}_${ty}`;
        if (this.activeTiles.has(key)) continue;
        const sx = tx * TILE_SIZE;
        const sy = ty * TILE_SIZE;
        const sw = Math.min(TILE_SIZE, fieldWidth - sx);
        const sh = Math.min(TILE_SIZE, fieldHeight - sy);
        if (sw <= 0 || sh <= 0) continue;
        const before = surface.getTile(sx, sy, sw, sh);
        this.activeTiles.set(key, { tileX: tx, tileY: ty, width: sw, height: sh, before, after: null });
      }
    }
  }

  /** Call at stroke end (pointerup) - captures post-stroke tile state and pushes the record. No-op if nothing was touched. */
  endStroke(surface: PaintSurface): void {
    if (!this.activeTiles || !this.activeCanvasId) return;
    const tiles: TileSnapshot[] = [];
    for (const snap of this.activeTiles.values()) {
      const sx = snap.tileX * TILE_SIZE;
      const sy = snap.tileY * TILE_SIZE;
      const after = surface.getTile(sx, sy, snap.width, snap.height);
      tiles.push({ ...snap, after });
    }
    if (tiles.length) {
      this.undoStack.push({ canvas: this.activeCanvasId, tiles });
      this.redoStack = [];
    }
    this.activeTiles = null;
    this.activeCanvasId = null;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private applyTiles(record: StrokeRecord, surface: PaintSurface, which: "before" | "after"): DirtyRect | null {
    let rect: DirtyRect | null = null;
    for (const tile of record.tiles) {
      const value = which === "before" ? tile.before : tile.after;
      if (value === null) continue;
      const sx = tile.tileX * TILE_SIZE;
      const sy = tile.tileY * TILE_SIZE;
      surface.putTile(sx, sy, tile.width, tile.height, value);
      const tileRect = { x: sx, y: sy, width: tile.width, height: tile.height };
      rect = rect ? unionRect(rect, tileRect) : tileRect;
    }
    return rect;
  }

  undo(getSurface: (canvas: CanvasId) => PaintSurface): { canvas: CanvasId; rect: DirtyRect } | null {
    const record = this.undoStack.pop();
    if (!record) return null;
    const rect = this.applyTiles(record, getSurface(record.canvas), "before");
    this.redoStack.push(record);
    return rect ? { canvas: record.canvas, rect } : null;
  }

  redo(getSurface: (canvas: CanvasId) => PaintSurface): { canvas: CanvasId; rect: DirtyRect } | null {
    const record = this.redoStack.pop();
    if (!record) return null;
    const rect = this.applyTiles(record, getSurface(record.canvas), "after");
    this.undoStack.push(record);
    return rect ? { canvas: record.canvas, rect } : null;
  }
}
