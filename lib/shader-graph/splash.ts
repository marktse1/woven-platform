// A real, live splash-trigger mechanism for the SplashTrigger shader-graph
// node (see nodes.ts/compiler.ts) — deliberately tiny and engine-agnostic
// (no THREE.js import), matching compiler.ts's own dependency-light design.
// Nothing in this repo calls triggerSplashAt() automatically yet (there's no
// character controller or interaction system to call it from) — this is the
// hook itself, real and callable today, not a promise of a future one.

// Single source of truth for how many concurrent splash slots the compiled
// shader declares (u_splash0Pos/u_splash0Time .. u_splash{N-1}Pos/Time) —
// compiler.ts imports this too, so the two can never drift apart.
export const SPLASH_SLOT_COUNT = 4;

type UniformLike = { value: unknown };

// Duck-types the position uniform's current value: a live THREE.js material
// built from this shader will have a real THREE.Vector3 there (mutating in
// place via .set() is what THREE.js's own uniform-binding expects), while a
// raw CompileResult.uniforms record (never turned into a real material) just
// has a plain number[] — reassigning is the only option there.
function setVec3(uniform: UniformLike | undefined, x: number, y: number, z: number) {
  if (!uniform) return;
  const v = uniform.value as { set?: (x: number, y: number, z: number) => void } | null;
  if (v && typeof v.set === "function") v.set(x, y, z);
  else uniform.value = [x, y, z];
}

/**
 * Writes a real splash trigger into one of the shader's fixed slots — the
 * next frame this material renders, that slot's ring will pop into
 * existence at (x, y, z) and play out its expand-and-fade lifetime for
 * real, not from a canned loop.
 *
 * `slot` is 0..SPLASH_SLOT_COUNT-1 — callers own their own round-robin
 * counter (kept out of this function so it stays pure; a single shared
 * counter wouldn't make sense across multiple independent materials anyway).
 * `time` should be read from whatever clock is already driving this
 * material's own u_time uniform, so `age = u_time - triggeredTime` measures
 * real elapsed seconds.
 */
export function triggerSplashAt(
  uniforms: Record<string, UniformLike | undefined>,
  slot: number,
  x: number,
  y: number,
  z: number,
  time: number,
): void {
  if (slot < 0 || slot >= SPLASH_SLOT_COUNT) return;
  setVec3(uniforms[`u_splash${slot}Pos`], x, y, z);
  const timeUniform = uniforms[`u_splash${slot}Time`];
  if (timeUniform) timeUniform.value = time;
}
