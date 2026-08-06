// Control rings for Mesh Sculptor's Pose mode — pure data/graph logic,
// no Three.js scene wiring, same lib/sculpt/* = math, SculptViewer.tsx =
// orchestration split as rig.ts/mirror.ts/topology.ts.
//
// A ControlCurve is a Maya-style rig control: a ring attached to a real,
// live, posable Pose-mode object — a skeleton bone (FK rotate control) or
// an IK chain's target/pole bone (IK position control). It is deliberately
// a SKIN over the existing selection/gizmo/keyframe system, not a separate
// transform: clicking the ring selects the attached bone/IK-target exactly
// like clicking its own tiny handle would, so posing and keyframing it
// needs no new machinery. SculptViewer.tsx renders it as real geometry
// (a torus) positioned/oriented every frame from the live attachment, and
// hit-tests it with the normal three.js raycaster — no per-point shape to
// track here.

export type ControlAttachment =
  | { kind: "bone"; boneUuid: string }
  | { kind: "ikTarget"; chainId: string }
  | { kind: "ikPole"; chainId: string };

export type ControlCurve = {
  id: string;
  name: string;
  attachment: ControlAttachment;
};

export function createControlCurve(name: string, attachment: ControlAttachment): ControlCurve {
  return { id: crypto.randomUUID(), name, attachment };
}

/** A reasonable default name for the next control — "Control", "Control.002", ... */
export function nextControlName(curves: ControlCurve[]): string {
  let n = curves.length + 1;
  const used = new Set(curves.map((c) => c.name));
  let name = "Control";
  while (used.has(name)) { n++; name = `Control.${String(n).padStart(3, "0")}`; }
  return name;
}

function attachmentsEqual(a: ControlAttachment, b: ControlAttachment): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "bone" && b.kind === "bone") return a.boneUuid === b.boneUuid;
  if (a.kind !== "bone" && b.kind !== "bone") return a.chainId === b.chainId;
  return false;
}

export function findControlForAttachment(curves: ControlCurve[], attachment: ControlAttachment): ControlCurve | undefined {
  return curves.find((c) => attachmentsEqual(c.attachment, attachment));
}

export function findControl(curves: ControlCurve[], id: string): ControlCurve | undefined {
  return curves.find((c) => c.id === id);
}

export function deleteControl(curves: ControlCurve[], id: string): ControlCurve[] {
  return curves.filter((c) => c.id !== id);
}

/** Removes every control attached to a given bone/IK-target — called when
 * that bone/chain itself is deleted, so nothing dangles unresolvable. */
export function deleteControlsForAttachment(curves: ControlCurve[], attachment: ControlAttachment): ControlCurve[] {
  return curves.filter((c) => !attachmentsEqual(c.attachment, attachment));
}
