// Simple per-mesh position snapshot stack for sculpt undo/redo.
// Snapshot on pointerdown (before any displacement), restore on Ctrl+Z.

import type * as THREE from "three";

export type SculptMeshSnapshot = {
  mesh: THREE.Mesh;
  positions: Float32Array;
};

const MAX_UNDO = 32;

export class SculptUndoStack {
  private past: SculptMeshSnapshot[][] = [];
  private future: SculptMeshSnapshot[][] = [];

  /** Call at the start of each brush stroke (pointerdown). */
  push(meshes: THREE.Mesh[]): void {
    const snap = meshes.map((mesh) => ({
      mesh,
      positions: Float32Array.from(
        mesh.geometry.attributes.position.array as Float32Array,
      ),
    }));
    this.past.push(snap);
    if (this.past.length > MAX_UNDO) this.past.shift();
    this.future = [];
  }

  undo(): SculptMeshSnapshot[] | null {
    const snap = this.past.pop();
    if (!snap) return null;
    // Capture current state as redo entry before restoring.
    this.future.push(
      snap.map(({ mesh }) => ({
        mesh,
        positions: Float32Array.from(
          mesh.geometry.attributes.position.array as Float32Array,
        ),
      })),
    );
    return snap;
  }

  redo(): SculptMeshSnapshot[] | null {
    const snap = this.future.pop();
    if (!snap) return null;
    this.past.push(
      snap.map(({ mesh }) => ({
        mesh,
        positions: Float32Array.from(
          mesh.geometry.attributes.position.array as Float32Array,
        ),
      })),
    );
    return snap;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
