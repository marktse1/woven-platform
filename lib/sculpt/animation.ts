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
  /** Seconds. Derived from the latest key across all channels — see
   * recomputeDuration. */
  duration: number;
  channels: BoneChannel[];
};

export type IKChain = {
  id: string;
  name: string;
  /** Bone the target handle actually drags (the chain's tip). */
  effectorBone: string;
  /** Root-to-tip chain of bone names between (and including) the base
   * and the effector's parent — the links CCDIKSolver rotates. */
  links: string[];
  targetPosition: [number, number, number];
};

export type PoseAnimationState = {
  clips: AnimationClipData[];
  activeClipId: string | null;
  ikChains: IKChain[];
};

export function createPoseAnimationState(): PoseAnimationState {
  return { clips: [], activeClipId: null, ikChains: [] };
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
    duration: 0,
    channels: [],
  };
  state.clips.push(clip);
  if (state.activeClipId === null) state.activeClipId = clip.id;
  return clip;
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

function recomputeDuration(clip: AnimationClipData): void {
  let max = 0;
  for (const ch of clip.channels) {
    for (const k of ch.keys) if (k.time > max) max = k.time;
  }
  clip.duration = max;
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
 * insert. Flat (0) tangents on new keys until the curve editor reshapes
 * them. */
export function insertWholePoseKeyframe(
  clip: AnimationClipData,
  time: number,
  bones: Array<{ boneName: string; position: [number, number, number]; quaternion: [number, number, number, number] }>,
): void {
  for (const b of bones) {
    const values: Array<[BoneProperty, number]> = [
      ["position.x", b.position[0]], ["position.y", b.position[1]], ["position.z", b.position[2]],
      ["quaternion.x", b.quaternion[0]], ["quaternion.y", b.quaternion[1]],
      ["quaternion.z", b.quaternion[2]], ["quaternion.w", b.quaternion[3]],
    ];
    for (const [property, value] of values) {
      const channel = findOrCreateChannel(clip, b.boneName, property);
      insertKey(channel, { time, value, inTangent: 0, outTangent: 0 });
    }
  }
  recomputeDuration(clip);
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
  recomputeDuration(clip);
}
