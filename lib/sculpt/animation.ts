// Pose mode's keyframeable animation data — pure data/math logic, no
// Three.js scene wiring, matching this codebase's existing lib/sculpt/* =
// math, SculptViewer.tsx = orchestration split (same role as rig.ts).
//
// Curves are stored as raw per-component tracks (position.x/y/z,
// quaternion.x/y/z/w) using glTF/three.js's own CUBICSPLINE Hermite
// tangent representation (time, value, inTangent, outTangent) directly —
// not a friendlier-looking but lossy Euler-angle conversion layer. See
// the "Curve editing" plan this was built from for the full reasoning.

export type BoneProperty =
  | "position.x" | "position.y" | "position.z"
  | "quaternion.x" | "quaternion.y" | "quaternion.z" | "quaternion.w";

export type BoneCurveKey = {
  time: number;
  value: number;
  /** Hermite tangent slopes (value-per-second). Flat (0) until a curve
   * editor pass explicitly reshapes them. */
  inTangent: number;
  outTangent: number;
};

export type BoneChannel = {
  boneName: string;
  property: BoneProperty;
  /** Always kept sorted by time — see insertKey. */
  keys: BoneCurveKey[];
};

export type AnimationClipData = {
  id: string;
  name: string;
  /** Seconds — the canonical stored unit (matches glTF/three.js
   * KeyframeTrack). Explicitly user-set via setClipLength, NOT derived
   * from the latest keyframe — the timeline has a fixed, author-chosen
   * length you place keyframes within, the standard DCC-tool model
   * (Maya's Time Slider, etc.), not one that grows to fit whatever you
   * happened to key. */
  duration: number;
  /** Frames-per-second used only to convert `duration`/key times to/from
   * the frame numbers the timeline UI displays — user-selectable among
   * 24/30/60. Purely a display/authoring convenience; every stored time
   * value stays in seconds regardless of this setting. */
  frameRate: number;
  channels: BoneChannel[];
};

export const DEFAULT_FRAME_RATE = 30;
export const DEFAULT_FRAME_COUNT = 48;

export function frameToTime(frame: number, frameRate: number): number {
  return frame / frameRate;
}

export function timeToFrame(time: number, frameRate: number): number {
  return Math.round(time * frameRate);
}

export type IKChain = {
  id: string;
  name: string;
  /** Bone the target handle actually drags (the chain's tip). */
  effectorBone: string;
  /** TIP-TO-ROOT order: links[0] is the effector's direct parent,
   * links[1] is links[0]'s parent, etc. — confirmed by reading
   * CCDIKSolver's own _valid() check (three/examples/jsm/animation/
   * CCDIKSolver.js), which walks the chain exactly this direction and
   * warns if `link0.parent !== link1` doesn't hold. Backwards from
   * what you'd naturally write (root-to-tip) — worth the explicit note
   * since getting this backwards doesn't throw, it just silently
   * solves wrong. */
  links: string[];
  targetPosition: [number, number, number];
};

export type PoseAnimationState = {
  clips: AnimationClipData[];
  activeClipId: string | null;
  ikChains: IKChain[];
  /** The detected root/pelvis bone, if any — a plain FK handle (COG/hip
   * control), NOT an IKChain: it's not solved, just a direct control on
   * that one bone, standard in every biped rig. Null if detection found
   * nothing that looks like a hip/pelvis/root bone. */
  hipBoneName: string | null;
};

export function createPoseAnimationState(): PoseAnimationState {
  return { clips: [], activeClipId: null, ikChains: [], hipBoneName: null };
}

// ── biped control auto-detection ──────────────────────────────────────────
// Recognizes the two skeleton naming conventions actually present in this
// project's asset library — UE-Mannequin-style (thigh_l, upperarm_l, ...)
// and Mixamo-style (UpLeg.L_02, Arm.L_014, ...) — not a universal bone-name
// parser. A skeleton matching neither just gets no detected controls; that's
// fine, manual bone selection/posing still works regardless.

function norm(name: string): string {
  return name.toLowerCase();
}

/** True if `name` carries a left/right side marker for `side` — covers
 * both conventions' suffix styles (`_l`, `.L_02`, `.L`). */
function hasSide(name: string, side: "l" | "r"): boolean {
  const n = norm(name);
  return n.includes(`.${side}_`) || n.includes(`.${side}`) || n.includes(`_${side}_`) || n.endsWith(`_${side}`);
}

function findSideBone(names: string[], side: "l" | "r", include: string, exclude?: string): string | undefined {
  return names.find((n) => {
    const ln = norm(n);
    if (!hasSide(n, side)) return false;
    if (!ln.includes(include)) return false;
    if (exclude && ln.includes(exclude)) return false;
    return true;
  });
}

/** Auto-detects leg/arm IK chains and a hip/COG control from a skeleton's
 * bone names, run once at GLB import time. */
export function detectBipedControls(boneNames: string[]): { ikChains: IKChain[]; hipBoneName: string | null } {
  const hipBoneName =
    boneNames.find((n) => norm(n).includes("pelvis")) ??
    boneNames.find((n) => norm(n).includes("hip")) ??
    boneNames.find((n) => norm(n) === "root") ??
    null;

  const ikChains: IKChain[] = [];
  for (const side of ["l", "r"] as const) {
    const sideLabel = side === "l" ? "Left" : "Right";

    const thigh = findSideBone(boneNames, side, "thigh") ?? findSideBone(boneNames, side, "upleg");
    const calf = findSideBone(boneNames, side, "calf") ?? findSideBone(boneNames, side, "leg", "upleg");
    const foot = findSideBone(boneNames, side, "foot");
    if (thigh && calf && foot) {
      ikChains.push({ id: crypto.randomUUID(), name: `${sideLabel} Leg IK`, effectorBone: foot, links: [calf, thigh], targetPosition: [0, 0, 0] });
    }

    const upperArm = findSideBone(boneNames, side, "upperarm") ?? findSideBone(boneNames, side, "arm", "forearm");
    const lowerArm = findSideBone(boneNames, side, "lowerarm") ?? findSideBone(boneNames, side, "forearm");
    const hand = findSideBone(boneNames, side, "hand");
    if (upperArm && lowerArm && hand) {
      ikChains.push({ id: crypto.randomUUID(), name: `${sideLabel} Arm IK`, effectorBone: hand, links: [lowerArm, upperArm], targetPosition: [0, 0, 0] });
    }
  }

  return { ikChains, hipBoneName };
}

/** A reasonable default name for the next clip — "Clip", "Clip.002",
 * "Clip.003", ... (never reuses a name already in use), same convention
 * as rig.ts's nextBoneName. */
export function nextClipName(state: PoseAnimationState): string {
  let n = state.clips.length + 1;
  const used = new Set(state.clips.map((c) => c.name));
  let name = "Clip";
  while (used.has(name)) { n++; name = `Clip.${String(n).padStart(3, "0")}`; }
  return name;
}

export function createClip(state: PoseAnimationState, name?: string): AnimationClipData {
  const clip: AnimationClipData = {
    id: crypto.randomUUID(),
    name: name ?? nextClipName(state),
    duration: frameToTime(DEFAULT_FRAME_COUNT, DEFAULT_FRAME_RATE),
    frameRate: DEFAULT_FRAME_RATE,
    channels: [],
  };
  state.clips.push(clip);
  if (state.activeClipId === null) state.activeClipId = clip.id;
  return clip;
}

/** Explicitly sets a clip's total length and frame rate — the timeline's
 * length is author-chosen, not implicitly derived from keyframes (see
 * AnimationClipData.duration). Doesn't delete any keys that fall outside
 * the new (possibly shorter) range — they're just not reachable via the
 * shortened timeline until the length is extended again. */
export function setClipLength(clip: AnimationClipData, frameCount: number, frameRate: number): void {
  clip.frameRate = frameRate;
  clip.duration = frameToTime(frameCount, frameRate);
}

/** Sorted, de-duplicated union of every channel's key times — a
 * whole-pose insert keys every channel at the same time, so this is
 * exactly "the frames that have a keyframe marker" for the timeline UI. */
export function getKeyframeTimes(clip: AnimationClipData): number[] {
  const EPS = 1 / 120;
  const times = Array.from(new Set(clip.channels.flatMap((ch) => ch.keys.map((k) => k.time)))).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of times) {
    if (out.length === 0 || t - out[out.length - 1] >= EPS) out.push(t);
  }
  return out;
}

export function findClip(state: PoseAnimationState, id: string): AnimationClipData | undefined {
  return state.clips.find((c) => c.id === id);
}

export function renameClip(state: PoseAnimationState, id: string, name: string): void {
  const clip = findClip(state, id);
  if (clip) clip.name = name;
}

export function duplicateClip(state: PoseAnimationState, id: string): AnimationClipData | undefined {
  const src = findClip(state, id);
  if (!src) return undefined;
  const copy: AnimationClipData = {
    id: crypto.randomUUID(),
    name: nextClipName(state),
    duration: src.duration,
    frameRate: src.frameRate,
    channels: src.channels.map((ch) => ({ ...ch, keys: ch.keys.map((k) => ({ ...k })) })),
  };
  state.clips.push(copy);
  return copy;
}

/** Removes a clip. If it was the active one, activates whichever clip is
 * now first (or none, if the list is empty) — never leaves activeClipId
 * dangling on a deleted id. */
export function deleteClip(state: PoseAnimationState, id: string): void {
  state.clips = state.clips.filter((c) => c.id !== id);
  if (state.activeClipId === id) {
    state.activeClipId = state.clips[0]?.id ?? null;
  }
}

function findOrCreateChannel(clip: AnimationClipData, boneName: string, property: BoneProperty): BoneChannel {
  let ch = clip.channels.find((c) => c.boneName === boneName && c.property === property);
  if (!ch) {
    ch = { boneName, property, keys: [] };
    clip.channels.push(ch);
  }
  return ch;
}

/** Inserts (or replaces, if one already exists within half a frame at
 * 60fps) a key at `time`, keeping `keys` sorted by time — every reader
 * (playback assembly, curve editor) relies on that ordering rather than
 * re-sorting itself. */
function insertKey(channel: BoneChannel, key: BoneCurveKey): void {
  const EPS = 1 / 120;
  const i = channel.keys.findIndex((k) => Math.abs(k.time - key.time) < EPS);
  if (i >= 0) { channel.keys[i] = key; return; }
  const insertAt = channel.keys.findIndex((k) => k.time > key.time);
  if (insertAt === -1) channel.keys.push(key);
  else channel.keys.splice(insertAt, 0, key);
}

/** One whole-pose snapshot: every posed bone's current transform, keyed
 * into `clip` at `time` in one call — the standard animation-authoring
 * workflow (pose the character, insert a keyframe), not a per-bone
 * insert. `time` is clamped to [0, clip.duration] — the clip's length is
 * fixed/author-chosen (see AnimationClipData.duration), not something a
 * keyframe insert grows. Flat (0) tangents on new keys until the curve
 * editor reshapes them. */
export function insertWholePoseKeyframe(
  clip: AnimationClipData,
  time: number,
  bones: Array<{ boneName: string; position: [number, number, number]; quaternion: [number, number, number, number] }>,
): void {
  const t = Math.max(0, Math.min(time, clip.duration));
  for (const b of bones) {
    const values: Array<[BoneProperty, number]> = [
      ["position.x", b.position[0]], ["position.y", b.position[1]], ["position.z", b.position[2]],
      ["quaternion.x", b.quaternion[0]], ["quaternion.y", b.quaternion[1]],
      ["quaternion.z", b.quaternion[2]], ["quaternion.w", b.quaternion[3]],
    ];
    for (const [property, value] of values) {
      const channel = findOrCreateChannel(clip, b.boneName, property);
      insertKey(channel, { time: t, value, inTangent: 0, outTangent: 0 });
    }
  }
}

/** Linearly samples a channel at `time`, clamping to the first/last key
 * outside its range. Ignores tangents — used for the initial Linear-
 * interpolation playback path; the curve-editor pass (CUBICSPLINE) reads
 * keys directly instead. Pure math, no Three.js dependency, so both
 * SculptViewer.tsx's playback assembly and (later) the curve editor's
 * preview can share it. */
export function sampleChannelLinear(channel: BoneChannel, time: number): number {
  const keys = channel.keys;
  if (keys.length === 0) return 0;
  if (time <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (time >= a.time && time <= b.time) {
      const t = (time - a.time) / (b.time - a.time || 1);
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

/** Removes every channel's key at `time` (the whole-pose counterpart to
 * insertWholePoseKeyframe) — drops any channel left with zero keys. */
export function removeKeyframeAtTime(clip: AnimationClipData, time: number): void {
  const EPS = 1 / 120;
  for (const ch of clip.channels) {
    ch.keys = ch.keys.filter((k) => Math.abs(k.time - time) >= EPS);
  }
  clip.channels = clip.channels.filter((ch) => ch.keys.length > 0);
}
