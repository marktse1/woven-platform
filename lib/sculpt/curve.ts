// Control circles for Mesh Sculptor's Rig mode — pure data/graph logic, no
// Three.js scene wiring, same lib/sculpt/* = math, SculptViewer.tsx =
// orchestration split as rig.ts/mirror.ts/topology.ts.
//
// A ControlCurve is a Maya-style rig control: a closed ring of points
// attached to a joint, standing in for a NURBS circle (three.js has no
// NURBS authoring path) — clicking the ring selects/poses the joint it
// belongs to, and its own points stay individually draggable to
// reshape/resize the ring. Points are stored as LOCAL offsets from the
// joint's position, not world coordinates, so the ring automatically
// follows the joint wherever it moves — see SculptViewer.tsx for the
// world-space lookup (joint.position + offset) and the camera-facing
// circle generator.

export type ControlCurve = {
  id: string;
  name: string;
  /** The RigBone this control circle belongs to and follows. */
  jointId: string;
  /** Local-space offsets from the joint's position — always treated as a
   * closed loop (last point connects back to the first). */
  points: [number, number, number][];
};

export function createControlCurve(name: string, jointId: string, points: [number, number, number][]): ControlCurve {
  return { id: crypto.randomUUID(), name, jointId, points };
}

/** A reasonable default name for the next curve — "Curve", "Curve.002", ... */
export function nextCurveName(curves: ControlCurve[]): string {
  let n = curves.length + 1;
  const used = new Set(curves.map((c) => c.name));
  let name = "Curve";
  while (used.has(name)) { n++; name = `Curve.${String(n).padStart(3, "0")}`; }
  return name;
}

export function findCurve(curves: ControlCurve[], id: string): ControlCurve | undefined {
  return curves.find((c) => c.id === id);
}

export function findCurveForJoint(curves: ControlCurve[], jointId: string): ControlCurve | undefined {
  return curves.find((c) => c.jointId === jointId);
}

export function renameCurve(curves: ControlCurve[], id: string, name: string): void {
  const curve = findCurve(curves, id);
  if (curve) curve.name = name;
}

/** Removes one control point (CV) by index. A ring needs at least 3 points
 * to read as a shape — callers should treat fewer as effectively empty. */
export function removeCurvePoint(curve: ControlCurve, index: number): void {
  curve.points.splice(index, 1);
}

export function deleteCurve(curves: ControlCurve[], id: string): ControlCurve[] {
  return curves.filter((c) => c.id !== id);
}

/** Removes every control curve attached to a joint — called when the joint
 * itself is deleted, so nothing dangles with an unresolvable jointId. */
export function deleteCurvesForJoint(curves: ControlCurve[], jointId: string): ControlCurve[] {
  return curves.filter((c) => c.jointId !== jointId);
}
