// Undo/redo for topology-mutating poly-edit operations (extrude). Coexists
// with — doesn't replace — SculptUndoStack: brush strokes and the poly-edit
// transform gizmo never change vertex/triangle count, so they keep using the
// cheap position-only stack. Extrude does change counts, so it needs a full
// geometry snapshot (position, index, uv, and quadIndices — restoring a prior
// quad pairing is as important as restoring the vertices, since a later
// subdivide/loop-extrude would otherwise silently operate on wrong topology).
//
// Structurally parallel to SculptUndoStack (push before mutating; undo/redo
// capture the current state into the opposite stack before returning the
// snapshot to restore), but ~4x the memory per entry, hence a much smaller
// cap — justified since poly-edit edits are discrete clicks, not continuous
// per-move strokes like a brush stroke.

import * as THREE from "three";

export type TopoUndoEntry = { mesh: THREE.Mesh; quadIndices: Uint32Array };

export type TopoMeshSnapshot = {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  quadIndices: Uint32Array;
};

const MAX_UNDO_TOPO = 8;

function snapshotOf({ mesh, quadIndices }: TopoUndoEntry): TopoMeshSnapshot {
  return { mesh, geometry: mesh.geometry.clone(), quadIndices: quadIndices.slice() };
}

function disposeAll(stack: TopoMeshSnapshot[][]): void {
  for (const snap of stack) for (const s of snap) s.geometry.dispose();
}

export class TopoUndoStack {
  private past: TopoMeshSnapshot[][] = [];
  private future: TopoMeshSnapshot[][] = [];

  /** Call before committing a topology-mutating op (e.g. extrude). */
  push(entries: TopoUndoEntry[]): void {
    this.past.push(entries.map(snapshotOf));
    if (this.past.length > MAX_UNDO_TOPO) {
      const dropped = this.past.shift()!;
      for (const s of dropped) s.geometry.dispose();
    }
    disposeAll(this.future);
    this.future = [];
  }

  /** `entries` must reflect the mesh/quadIndices as they are RIGHT NOW (before restoring). */
  undo(entries: TopoUndoEntry[]): TopoMeshSnapshot[] | null {
    const snap = this.past.pop();
    if (!snap) return null;
    this.future.push(entries.map(snapshotOf));
    return snap;
  }

  redo(entries: TopoUndoEntry[]): TopoMeshSnapshot[] | null {
    const snap = this.future.pop();
    if (!snap) return null;
    this.past.push(entries.map(snapshotOf));
    return snap;
  }

  clear(): void {
    disposeAll(this.past);
    disposeAll(this.future);
    this.past = [];
    this.future = [];
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
