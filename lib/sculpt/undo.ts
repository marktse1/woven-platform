// Snapshot stack for sculpt undo/redo — mesh vertex-position edits (brush
// strokes, poly-edit's gizmo, Rig mode's masked-vertex drag), Pose mode's
// bone transforms, and control-ring point edits share one history so
// interleaved edits undo in the order they actually happened, rather than
// separate stacks the user would have to reason about independently.
// Snapshot at drag/stroke start (before any displacement), restore on
// Ctrl+Z.

import type * as THREE from "three";
import type { ControlCurve } from "./curve";

export type SculptMeshSnapshot = {
  mesh: THREE.Mesh;
  positions: Float32Array;
};

export type BonePoseSnapshot = {
  bone: THREE.Bone;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};

export type CurvePointsSnapshot = {
  curve: ControlCurve;
  points: [number, number, number][];
};

export type UndoEntry =
  | { kind: "mesh"; snapshots: SculptMeshSnapshot[] }
  | { kind: "pose"; snapshots: BonePoseSnapshot[] }
  | { kind: "curve"; snapshots: CurvePointsSnapshot[] };

const MAX_UNDO = 32;

function captureMesh(meshes: THREE.Mesh[]): SculptMeshSnapshot[] {
  return meshes.map((mesh) => ({
    mesh,
    positions: Float32Array.from(
      mesh.geometry.attributes.position.array as Float32Array,
    ),
  }));
}

function capturePose(bones: THREE.Bone[]): BonePoseSnapshot[] {
  return bones.map((bone) => ({
    bone,
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }));
}

function captureCurves(curves: ControlCurve[]): CurvePointsSnapshot[] {
  return curves.map((curve) => ({
    curve,
    points: curve.points.map((p) => [p[0], p[1], p[2]] as [number, number, number]),
  }));
}

export class SculptUndoStack {
  private past: UndoEntry[] = [];
  private future: UndoEntry[] = [];

  /** Call at the start of each brush stroke / vertex-displacing drag
   * (pointerdown or dragging-changed). */
  push(meshes: THREE.Mesh[]): void {
    this.pushEntry({ kind: "mesh", snapshots: captureMesh(meshes) });
  }

  /** Call at the start of a Pose-mode bone drag or typed Channel Box edit
   * (dragging-changed value===true, or immediately before applying a typed
   * value) — same trigger point push() uses for gizmo drags. */
  pushPose(bones: THREE.Bone[]): void {
    this.pushEntry({ kind: "pose", snapshots: capturePose(bones) });
  }

  /** Call at the start of a control ring's CV drag (dragging-changed,
   * value === true). */
  pushCurve(curves: ControlCurve[]): void {
    this.pushEntry({ kind: "curve", snapshots: captureCurves(curves) });
  }

  private pushEntry(entry: UndoEntry): void {
    this.past.push(entry);
    if (this.past.length > MAX_UNDO) this.past.shift();
    this.future = [];
  }

  private recapture(entry: UndoEntry): UndoEntry {
    if (entry.kind === "mesh") {
      return { kind: "mesh", snapshots: captureMesh(entry.snapshots.map((s) => s.mesh)) };
    }
    if (entry.kind === "pose") {
      return { kind: "pose", snapshots: capturePose(entry.snapshots.map((s) => s.bone)) };
    }
    return { kind: "curve", snapshots: captureCurves(entry.snapshots.map((s) => s.curve)) };
  }

  undo(): UndoEntry | null {
    const entry = this.past.pop();
    if (!entry) return null;
    // Capture current state as the redo entry before the caller restores.
    this.future.push(this.recapture(entry));
    return entry;
  }

  redo(): UndoEntry | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push(this.recapture(entry));
    return entry;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
