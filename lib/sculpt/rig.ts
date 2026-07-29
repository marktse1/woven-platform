// Manually-placed joint hierarchy for Mesh Sculptor's Rig mode — pure
// data/graph logic, no Three.js scene wiring, matching this codebase's
// existing lib/sculpt/* = math, SculptViewer.tsx = orchestration split
// (same role as mirror.ts/topology.ts).
//
// Deliberately NOT a real skeleton: no skin weights, no transform
// inheritance through the hierarchy, no THREE.Bone/Skeleton objects.
// These are ZBrush-Transpose-style pivot markers — parent/child is
// purely organizational (for the Bones list UI), not a rig. See
// SculptViewer.tsx's Rig mode for how a joint's position is used as a
// pivot to transform a mask-weighted region of the mesh.

export type RigBone = {
  id: string;
  name: string;
  /** null = root. Children are DERIVED via listChildren, never dual-stored. */
  parentId: string | null;
  /** World-space position (== this entry's mesh-local space, since
   * entries are always centered at the origin) — not parent-relative,
   * since these are independent pivot markers, not a rig with export/
   * transform-inheritance needs. */
  position: [number, number, number];
};

export type RigSkeleton = {
  bones: RigBone[];
  selectedBoneId: string | null;
};

export function createBone(name: string, parentId: string | null, position: [number, number, number]): RigBone {
  return { id: crypto.randomUUID(), name, parentId, position };
}

/** A reasonable default name for the next bone in a skeleton — "Bone",
 * "Bone.002", "Bone.003", ... (never reuses a number already in use). */
export function nextBoneName(skeleton: RigSkeleton): string {
  let n = skeleton.bones.length + 1;
  const used = new Set(skeleton.bones.map((b) => b.name));
  let name = "Bone";
  while (used.has(name)) { n++; name = `Bone.${String(n).padStart(3, "0")}`; }
  return name;
}

export function listChildren(skeleton: RigSkeleton, parentId: string | null): RigBone[] {
  return skeleton.bones.filter((b) => b.parentId === parentId);
}

export function findBone(skeleton: RigSkeleton, id: string): RigBone | undefined {
  return skeleton.bones.find((b) => b.id === id);
}

export function renameBone(skeleton: RigSkeleton, id: string, name: string): void {
  const bone = findBone(skeleton, id);
  if (bone) bone.name = name;
}

/** True if setting `boneId`'s parent to `candidateParentId` would create a
 * cycle (including candidateParentId === boneId itself). */
export function wouldCreateCycle(skeleton: RigSkeleton, boneId: string, candidateParentId: string | null): boolean {
  if (candidateParentId === null) return false;
  let cur: string | null = candidateParentId;
  while (cur !== null) {
    if (cur === boneId) return true;
    cur = findBone(skeleton, cur)?.parentId ?? null;
  }
  return false;
}

export function reparentBone(skeleton: RigSkeleton, boneId: string, newParentId: string | null): { ok: boolean; reason?: string } {
  if (wouldCreateCycle(skeleton, boneId, newParentId)) {
    return { ok: false, reason: "Can't reparent a bone onto its own descendant." };
  }
  const bone = findBone(skeleton, boneId);
  if (!bone) return { ok: false, reason: "Bone not found." };
  bone.parentId = newParentId;
  return { ok: true };
}

/** Removes a bone. Its direct children are reparented to ITS OWN parent
 * (the grandparent) rather than deleted or orphaned — the safer default,
 * since deleting a mid-chain joint (e.g. a shoulder) shouldn't silently
 * vaporize everything below it (e.g. the whole arm). */
export function deleteBone(skeleton: RigSkeleton, id: string): void {
  const bone = findBone(skeleton, id);
  if (!bone) return;
  const grandparentId = bone.parentId;
  for (const child of skeleton.bones) {
    if (child.parentId === id) child.parentId = grandparentId;
  }
  skeleton.bones = skeleton.bones.filter((b) => b.id !== id);
  if (skeleton.selectedBoneId === id) skeleton.selectedBoneId = null;
}
