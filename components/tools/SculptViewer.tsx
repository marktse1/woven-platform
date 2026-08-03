"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { CCDIKSolver } from "three/examples/jsm/animation/CCDIKSolver.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import "three-mesh-bvh"; // pulls in BufferGeometry.boundsTree augmentation
import { buildSeamData, type SeamData } from "@/lib/sculpt/seams";
import { applyBrush, applyMaskDab, applyMaskBox, gatherVertices, gatherVerticesInRegion, pointInPolygon, expandSeams, type BrushMode, type BrushHit } from "@/lib/sculpt/brushes";
import { extractMaskedRegion, detachMaskedRegion } from "@/lib/sculpt/extract";
import { weldGeometryByPosition } from "@/lib/sculpt/weld";
import { SculptUndoStack } from "@/lib/sculpt/undo";
import { TopoUndoStack, type TopoMeshSnapshot } from "@/lib/sculpt/topoUndo";
import { computeAvgEdgeLen, dynTopoRefine } from "@/lib/sculpt/dyntopo";
import { detectQuads, catmullClarkSubdivide } from "@/lib/sculpt/catmullclark";
import { buildTopology, walkEdgeLoop, type MeshTopology, type EdgeLoop } from "@/lib/sculpt/topology";
import { extrudeFaces as extrudeFacesLib, extrudeEdgeLoop as extrudeEdgeLoopLib, findGeometryIssues, type ExtrudeFace } from "@/lib/sculpt/extrude";
import { buildMirrorData, type MirrorData } from "@/lib/sculpt/mirror";
import { createBone, nextBoneName, renameBone as renameRigBone, deleteBone as deleteRigBone, type RigBone, type RigSkeleton } from "@/lib/sculpt/rig";
import { conformToReference as conformMeshToReference } from "@/lib/sculpt/conform";
import { createPoseAnimationState, createClip, findClip, renameClip as renameClipData, duplicateClip as duplicateClipData, deleteClip as deleteClipData, insertWholePoseKeyframe, removeKeyframeAtTime, sampleChannelLinear, getKeyframeTimes as getKeyframeTimesData, setClipLength as setClipLengthData, detectBipedControls, DEFAULT_FRAME_RATE, type PoseAnimationState, type AnimationClipData } from "@/lib/sculpt/animation";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Patch Three.js raycaster to use BVH acceleration
(THREE.Mesh.prototype as THREE.Mesh & { raycast: typeof acceleratedRaycast }).raycast = acceleratedRaycast;

type SubdivGeomSnapshot = {
  geometry: THREE.BufferGeometry;
  quadIndices: Uint32Array;
};

type SculptMeshEntry = {
  /** Stable identity for the Submeshes list UI — independent of array position, which shifts as entries are added/deleted. */
  id: string;
  /** Shown in the Submeshes list — "Original" for the initially loaded mesh, "Extract N"/"Detach N" for extracted/detached submeshes. */
  name: string;
  mesh: THREE.Mesh;
  seams: SeamData;
  paintCanvas?: HTMLCanvasElement;
  paintTexture?: THREE.CanvasTexture;
  paintMat?: THREE.MeshBasicMaterial;
  hasPaint?: boolean;
  baseEdgeLen?: number;
  /** Quad face index buffer for Catmull-Clark subdivision (4 indices per quad, CCW). Empty = Loop fallback. */
  quadIndices?: Uint32Array;
  /** Geometry snapshots taken before each subdivide — allows stepping back down levels. Max 8 levels. */
  subdivStack?: SubdivGeomSnapshot[];
  /** Poly-edit adjacency — built lazily on first poly-edit use, thrown away (not patched) on any topology change. */
  topology?: MeshTopology;
  /** X-axis mirror pairs for symmetric sculpting — built lazily the first
   * time mirror mode is turned on, thrown away (not patched) on any
   * topology change, same as topology above. */
  mirror?: MirrorData;
  /** ZBrush-style extraction mask (0..1 per vertex) — lazily created on first mask-brush stroke. Never read/written outside mask paint + Extract. */
  mask?: Float32Array;
  /** Vertex-color visualization of `mask` (lazily created alongside it) and the dedicated material that displays it — swapped in only while brush mode is "mask", swapped back out (via applyViewToGroup) otherwise, so the tint never leaks into any other view mode or export. */
  maskMat?: THREE.MeshStandardMaterial;
  /** Present only if `mesh` is a real THREE.SkinnedMesh loaded from an
   * externally-rigged GLB (e.g. AccuRIG) — confirmed directly (round-trip
   * tested via GLTFExporter/GLTFLoader) that this codebase's existing
   * import loop does NOT strip skinIndex/skinWeight/skeleton, so this is
   * just a convenience reference to `(mesh as THREE.SkinnedMesh).skeleton`
   * for the Pose-mode UI, not a new copy of anything. Undefined for plain
   * (non-skinned) entries — sculpting/masking/etc. are entirely unaffected
   * either way. */
  skeleton?: THREE.Skeleton;
  /** Snapshot of every bone's imported bind-pose local transform, keyed by
   * bone.uuid (stable per-bone identity; names aren't guaranteed unique).
   * Captured once at load time, before any posing edits — lets Reset Pose
   * restore the original pose exactly rather than accumulating drift. */
  bindPose?: Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>;
  /** Manually-placed joint markers for Rig mode (lib/sculpt/rig.ts) —
   * deliberately NOT the same thing as `skeleton` above: no skin weights,
   * no scene-graph objects, just position markers used as pivots for
   * mask-weighted region transforms. Lazily created on first joint
   * placement, same "absent until used" convention as mask/topology/mirror. */
  rig?: RigSkeleton;
  /** Pose-mode keyframeable animation clips + IK chains (lib/sculpt/
   * animation.ts) — only meaningful alongside `skeleton` above. Lazily
   * created on first keyframe insert, same "absent until used"
   * convention as mask/topology/mirror/rig. */
  poseAnimation?: PoseAnimationState;
  /** Runtime playback objects for the active clip — rebuilt (not
   * patched) via rebuildPoseMixer whenever the active clip, its
   * keyframes, or the active-clip selection changes. Absent until
   * the first clip exists, same convention as the fields above. */
  poseMixer?: THREE.AnimationMixer;
  poseAction?: THREE.AnimationAction;
  poseTime?: number;
  posePlaying?: boolean;
  /** One real CCDIKSolver per entry, built once at import from every
   * detected chain in poseAnimation.ikChains — undefined if the
   * skeleton had no detected chains. CCDIKSolver requires its `target`
   * to be a real bone INDEX in skeleton.bones (confirmed by reading
   * its source, not assumed), so each chain also gets a synthetic,
   * unskinned target THREE.Bone appended to the skeleton — see
   * ikTargetBones below. */
  ikSolver?: CCDIKSolver;
  /** chain.id -> its synthetic drag target bone (see ikSolver above).
   * Not part of the actual bone hierarchy, not skinned to any vertex —
   * just a free-floating position CCDIKSolver reads as the chain's
   * target, added directly to the scene so its matrixWorld updates
   * normally every frame. */
  ikTargetBones?: Map<string, THREE.Bone>;
  /** chain.id -> its synthetic pole-vector bone, for every 2-link chain
   * (every leg/arm chain this project's convention produces). Same
   * free-floating-bone technique as ikTargetBones, but these chains are
   * NOT solved by ikSolver/CCDIKSolver at all — CCD has no pole-vector
   * concept, so 2-link chains are excluded from the CCDIKSolver `iks`
   * array at import time and solved analytically instead (solveTwoBoneIK)
   * using this bone's live position as the bend-direction reference. */
  ikPoleBones?: Map<string, THREE.Bone>;
};

// ── ZBrush-style extraction mask painting/visualization ──────────────────────
// Module-level (not nested in any one effect) since neither function
// depends on component-local refs — only on the entry passed in — so both
// the "brush mode changed" material-swap effect and the pointer-stroke
// handling effect below can call them without duplicating this logic.
const MASK_TINT = new THREE.Color(0x404040);
const _maskWhite = new THREE.Color(1, 1, 1);
const _maskColorTmp = new THREE.Color();

/** Keeps an entry's mask array sized to its CURRENT geometry. Several ops
 * (subdivide, subdivideDown, remesh, extrude, poly-edit — anywhere
 * `entry.topology`/`entry.mirror` get invalidated) replace `entry.mesh.
 * geometry` wholesale with a different vertex count, but never touch
 * `entry.mask` directly — so without this, a mask painted before one of
 * those ops silently goes stale (too short), causing brush strokes on the
 * new vertices to read past the array end (NaN mask-color lerps) and
 * Extract/Detach to fail their `mask.length < position.count` guard.
 * Deliberately a read-side guard rather than patched into every mutation
 * site: cheap, idempotent, and covers ops we haven't hunted down too.
 * Vertex 0..oldLength-1 keep their painted values; anything beyond that
 * (new geometry created by the op) starts unpainted. */
function resizeMaskToGeometry(entry: SculptMeshEntry) {
  if (!entry.mask) return;
  const vCount = entry.mesh.geometry.attributes.position.count;
  if (entry.mask.length === vCount) return;
  const next = new Float32Array(vCount);
  next.set(entry.mask.subarray(0, Math.min(entry.mask.length, vCount)));
  entry.mask = next;
}

/** Lazily creates the mask array, its vertex-color visualization attribute,
 * and its dedicated display material for an entry the first time it's ever
 * mask-painted — everything stays absent (zero cost, zero visual change)
 * for entries that never use this brush. */
function ensureMaskState(entry: SculptMeshEntry) {
  const vCount = entry.mesh.geometry.attributes.position.count;
  if (!entry.mask) entry.mask = new Float32Array(vCount);
  else resizeMaskToGeometry(entry);
  const colorWasMissing = !entry.mesh.geometry.attributes.color;
  if (colorWasMissing) {
    const colors = new Float32Array(vCount * 3).fill(1);
    entry.mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  if (!entry.maskMat) {
    entry.maskMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  }
  // The color attribute is recreated blank above whenever it was missing —
  // true both the first time an entry is ever painted (correctly blank/
  // white) AND after an op like subdivide rebuilds geometry without
  // carrying color forward (NOT correctly blank — the mask itself may
  // already have real painted values that need to show immediately,
  // rather than only after the next brush dab touches them).
  if (colorWasMissing && entry.mask.some((v) => v !== 0)) {
    const all: number[] = new Array(vCount);
    for (let i = 0; i < vCount; i++) all[i] = i;
    updateMaskColors(entry, all);
  }
}

/** Repaints just the given (already seam-expanded) vertex indices' colors
 * from the current mask values — proportional to brush size, not a full
 * mesh rescan, same cost class as everything else per-dab in this file. */
function updateMaskColors(entry: SculptMeshEntry, touched: number[]) {
  const colorAttr = entry.mesh.geometry.attributes.color as THREE.BufferAttribute | undefined;
  if (!colorAttr || !entry.mask) return;
  for (const idx of touched) {
    _maskColorTmp.copy(_maskWhite).lerp(MASK_TINT, entry.mask[idx]);
    colorAttr.setXYZ(idx, _maskColorTmp.r, _maskColorTmp.g, _maskColorTmp.b);
  }
  colorAttr.needsUpdate = true;
}

/** Result of a poly-edit pick — keeps the exact hit triangle's identity (see getElementHitFromEvent). */
type PolyEditHit = {
  entry: SculptMeshEntry;
  triIndex: number;
  /** Nearest of the hit triangle's 3 corners to the pointer, in screen space. */
  vertex: number;
  /** Nearest of the hit triangle's 3 edges to the pointer, in screen space. */
  edge: { v0: number; v1: number };
  /** The hit triangle's logical face — its paired quad if entry.topology has one, else the raw triangle. */
  face: { kind: "quad"; quadIndex: number; verts: number[] } | { kind: "tri"; triIndex: number; verts: number[] };
  worldPoint: THREE.Vector3;
};

export type EditMode = "sculpt" | "poly_edit" | "pose" | "rig";
export type SelectMode = "vertex" | "edge" | "face";
export type TransformMode = "translate" | "rotate" | "scale";
/** Poly-edit selection input: click one element at a time, or drag a
 * region (rectangle or freeform loop) to select many at once. */
export type PolyEditSelectTool = "click" | "box" | "lasso";
/** Brush-radius vertex highlight density — "all" gets visually noisy on
 * dense/subdivided meshes. */
export type HighlightMode = "center" | "all" | "none";

/** Resolves a poly-edit selection (vertex/edge/face keys) to the concrete vertex
 * indices it covers — shared by selection highlighting and the transform gizmo,
 * so both always agree on exactly which vertices "the current selection" means. */
function selectionVertexIndices(
  entry: SculptMeshEntry,
  selection: Set<string>,
  mode: SelectMode,
  includeMirror = false,
): number[] {
  const verts = new Set<number>();
  for (const key of selection) {
    if (mode === "vertex") {
      verts.add(Number(key.slice(1)));
    } else if (mode === "edge") {
      const [a, b] = key.split("_").map(Number);
      verts.add(a); verts.add(b);
    } else if (key.startsWith("q")) {
      const qi = Number(key.slice(1));
      entry.topology?.quadCorners[qi]?.forEach((v) => verts.add(v));
    } else {
      const ti = Number(key.slice(1));
      const idx = entry.mesh.geometry.index;
      if (idx) { verts.add(idx.getX(ti * 3)); verts.add(idx.getX(ti * 3 + 1)); verts.add(idx.getX(ti * 3 + 2)); }
    }
  }
  // Expand through UV-seam co-location groups so every coincident copy of a
  // vertex (three.js primitives split vertices at every hard edge, purely
  // for per-face UVs — a box has 24 verts, not 8) highlights and moves
  // together. Without this, dragging one corner of a box with the gizmo
  // leaves its duplicate copies behind, tearing the mesh open at the seam —
  // sculpt brushes already avoid this via the same expandSeams() mechanism
  // (brushes.ts); poly-edit needs the same treatment.
  const expanded = new Set<number>();
  for (const v of verts) {
    const group = entry.seams.groups[entry.seams.vertToGroup[v]];
    for (const g of group) expanded.add(g);
  }
  // Mirror mode: also show/select each vertex's X-axis mirror partner —
  // "1 vert on each side" per ZBrush's own symmetry visualization. Only
  // for highlighting/selection display — the transform gizmo deliberately
  // does NOT fold mirror vertices into this same set (see beginGizmoDrag),
  // since a uniformly-applied transform would be wrong for the mirror side
  // (a +X translate must become -X on the other side, not repeat as +X).
  if (includeMirror && entry.mirror) {
    for (const v of [...expanded]) {
      const mv = entry.mirror.get(v);
      if (mv === undefined) continue;
      const group = entry.seams.groups[entry.seams.vertToGroup[mv]];
      for (const g of group) expanded.add(g);
    }
  }
  return [...expanded];
}

/** Canonical selection key for a poly-edit hit, given the active select mode. */
function keyForHit(hit: PolyEditHit, mode: SelectMode): string {
  if (mode === "vertex") return `v${hit.vertex}`;
  if (mode === "edge") return `${Math.min(hit.edge.v0, hit.edge.v1)}_${Math.max(hit.edge.v0, hit.edge.v1)}`;
  return hit.face.kind === "quad" ? `q${hit.face.quadIndex}` : `t${hit.face.triIndex}`;
}

/** Resolves the current face-mode selection into extrudeFaces() inputs. */
function resolveSelectedFaces(entry: SculptMeshEntry, selection: Set<string>): ExtrudeFace[] {
  const topo = entry.topology;
  let quadToTris: Map<number, number[]> | null = null;
  if (topo) {
    quadToTris = new Map();
    for (const [t, q] of topo.triToQuad) {
      const list = quadToTris.get(q);
      if (list) list.push(t); else quadToTris.set(q, [t]);
    }
  }
  const faces: ExtrudeFace[] = [];
  for (const key of selection) {
    if (key.startsWith("q") && topo && quadToTris) {
      const qi = Number(key.slice(1));
      const ring = topo.quadCorners[qi];
      const triIndices = quadToTris.get(qi);
      if (ring && triIndices) faces.push({ ring, triIndices, quadIndex: qi });
    } else if (key.startsWith("t")) {
      const ti = Number(key.slice(1));
      const idx = entry.mesh.geometry.index;
      if (idx) faces.push({ ring: [idx.getX(ti * 3), idx.getX(ti * 3 + 1), idx.getX(ti * 3 + 2)], triIndices: [ti] });
    }
  }
  return faces;
}

/** Walks the boundary loop starting from the first selected edge — the seed
 * for edge-loop extrude. Returns null if nothing's selected or topology
 * hasn't been built for this entry yet. */
function resolveSeedLoop(entry: SculptMeshEntry, selection: Set<string>): EdgeLoop | null {
  const topo = entry.topology;
  if (!topo) return null;
  const first = selection.values().next().value;
  if (!first) return null;
  const [v0, v1] = first.split("_").map(Number);
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return null;
  return walkEdgeLoop(topo, v0, v1);
}

/** Lazily builds (and caches on the entry) this mesh's X-axis mirror-pair
 * data — same invalidation lifetime as entry.topology (thrown away, not
 * patched, on any topology change). */
function ensureMirror(entry: SculptMeshEntry): MirrorData {
  if (!entry.mirror) {
    const cellSize = entry.baseEdgeLen && entry.baseEdgeLen > 1e-6 ? entry.baseEdgeLen : 0.05;
    entry.mirror = buildMirrorData(entry.mesh.geometry.attributes.position.array as Float32Array, cellSize);
  }
  return entry.mirror;
}

/**
 * Builds a wireframe overlay whose position buffer is the SAME BufferAttribute
 * object as the source geometry's — not a copy. THREE.WireframeGeometry bakes
 * a brand-new, independent position array at construction time, so it never
 * reflects later position edits (brush strokes, the poly-edit transform
 * gizmo) unless explicitly rebuilt; sharing the attribute means those edits
 * (positions.needsUpdate = true) show up on the wire for free, every frame,
 * with zero rebuild cost. Only the edge INDEX needs rebuilding, and only when
 * topology actually changes — the same sites that already call this.
 */
function buildWireOverlay(geometry: THREE.BufferGeometry, material: THREE.LineBasicMaterial): THREE.LineSegments {
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute("position", geometry.attributes.position);
  const index = geometry.index;
  if (index) {
    const seen = new Set<number>();
    const edgeIdx: number[] = [];
    const triCount = index.count / 3;
    for (let t = 0; t < triCount; t++) {
      const a = index.getX(t * 3), b = index.getX(t * 3 + 1), c = index.getX(t * 3 + 2);
      for (const [x, y] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        const key = x < y ? x * 4_194_304 + y : y * 4_194_304 + x; // 2^22 — safe well beyond this tool's 1M-vertex cap
        if (seen.has(key)) continue;
        seen.add(key);
        edgeIdx.push(x, y);
      }
    }
    wireGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(edgeIdx), 1));
  }
  const wire = new THREE.LineSegments(wireGeo, material);
  wire.name = "__wire";
  wire.renderOrder = 999;
  return wire;
}

// Clay's default light, near-uniform color needs a dark line to read clearly
// (a light/white line all but disappears on it); every other view (Combined/
// Albedo/AO) has busier, more varied underlying color where the original
// neutral white reads fine. High opacity plus depthTest:false keeps the wire
// visible on top of the surface either way. linewidth is set for correctness
// but WebGL ignores it on nearly every browser/GPU combo (a long-standing
// spec limitation, not a bug here) — true adjustable thickness needs
// three.js's fat-line renderer (Line2/LineMaterial), a heavier swap not made
// here.
const WIRE_COLOR_CLAY = 0x453c34;
const WIRE_COLOR_DEFAULT = 0xffffff;
const WIRE_OPACITY = 0.85;

function wireColorFor(vm: ViewMode): number {
  return vm === "clay" ? WIRE_COLOR_CLAY : WIRE_COLOR_DEFAULT;
}

/** True for the synthetic, unskinned drag-aid bones injected into a
 * skeleton at import time (__ikTarget_<chainId>, __ikPole_<chainId>) —
 * they're authoring handles, not part of the actual performance, so every
 * bone list/keyframe capture shown to the user or written into a clip
 * excludes them. */
function isSyntheticIKBone(name: string): boolean {
  return name.startsWith("__ikTarget_") || name.startsWith("__ikPole_");
}

/**
 * Analytic two-bone IK with pole-vector bend control — the standard
 * closed-form technique for exactly this case (root→mid→effector, 2
 * links), the same one Unity's TwoBoneIKConstraint / Unreal's Two Bone IK
 * node use. Used instead of CCDIKSolver for every 2-link chain, since CCD
 * has no pole-vector concept at all. Bone lengths are read fresh from the
 * bones' CURRENT world positions every call (rotating a bone never
 * changes its child's distance from it, so this is always self-
 * consistent — no separate bind-length bookkeeping needed).
 *
 * Sets root.quaternion and mid.quaternion (both LOCAL, relative to their
 * respective current parent orientation) directly; does not touch
 * effector's own rotation, matching how CCDIKSolver also only rotates the
 * link bones — effector's world position simply follows via normal FK
 * once root/mid are updated.
 */
function solveTwoBoneIK(
  root: THREE.Bone,
  mid: THREE.Bone,
  effector: THREE.Bone,
  targetWorldPos: THREE.Vector3,
  poleWorldPos: THREE.Vector3,
): void {
  root.updateWorldMatrix(true, true);

  const rootPos = new THREE.Vector3();
  root.getWorldPosition(rootPos);
  const midPos = new THREE.Vector3();
  mid.getWorldPosition(midPos);
  const effectorPos = new THREE.Vector3();
  effector.getWorldPosition(effectorPos);

  const len1 = rootPos.distanceTo(midPos);
  const len2 = midPos.distanceTo(effectorPos);
  if (len1 < 1e-6 || len2 < 1e-6) return; // degenerate rig proportions

  // Reach: clamp the target distance to what the chain can actually
  // achieve so it stretches/compresses gracefully at its limits instead
  // of producing an invalid (NaN) triangle.
  const toTargetVec = targetWorldPos.clone().sub(rootPos);
  const targetDist = toTargetVec.length();
  const minReach = Math.abs(len1 - len2) + 1e-4;
  const maxReach = len1 + len2 - 1e-4;
  const d = THREE.MathUtils.clamp(targetDist, minReach, maxReach);
  const ta = targetDist > 1e-6 ? toTargetVec.normalize() : new THREE.Vector3(0, 0, 1);

  // Law of cosines: `a` = how far along the root→target axis the mid
  // joint sits, `h` = its perpendicular offset from that axis.
  const a = (len1 * len1 - len2 * len2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, len1 * len1 - a * a));

  // The perpendicular DIRECTION (which way `h` points) is the actual
  // pole-vector contribution — project the pole onto the plane
  // perpendicular to the root→target axis.
  const toPoleVec = poleWorldPos.clone().sub(rootPos);
  const perp = toPoleVec.clone().sub(ta.clone().multiplyScalar(toPoleVec.dot(ta)));
  if (perp.lengthSq() < 1e-8) {
    // Pole colinear with the root→target axis — bend direction is
    // mathematically undefined from the pole alone. Fall back to the
    // CURRENT mid-joint's own perpendicular component so dragging the
    // pole through this alignment holds the last valid bend direction
    // instead of popping/flipping.
    const curToMid = midPos.clone().sub(rootPos);
    perp.copy(curToMid).sub(ta.clone().multiplyScalar(curToMid.dot(ta)));
    if (perp.lengthSq() < 1e-8) {
      perp.crossVectors(ta, new THREE.Vector3(0, 1, 0));
      if (perp.lengthSq() < 1e-8) perp.crossVectors(ta, new THREE.Vector3(0, 0, 1));
    }
  }
  perp.normalize();

  const newMidPos = rootPos.clone().addScaledVector(ta, a).addScaledVector(perp, h);
  const newEffectorPos = rootPos.clone().addScaledVector(ta, d);

  // Step 1: aim root's world direction (root→mid) at the solved mid
  // position, via a world-space delta rotation converted back to root's
  // local space (relative to ITS current parent orientation).
  const curRootDir = midPos.clone().sub(rootPos).normalize();
  const newRootDir = newMidPos.clone().sub(rootPos).normalize();
  const rootDelta = new THREE.Quaternion().setFromUnitVectors(curRootDir, newRootDir);
  const rootWorldQuat = new THREE.Quaternion();
  root.getWorldQuaternion(rootWorldQuat);
  const newRootWorldQuat = rootDelta.multiply(rootWorldQuat);
  const rootParentWorldQuat = new THREE.Quaternion();
  if (root.parent) root.parent.getWorldQuaternion(rootParentWorldQuat);
  root.quaternion.copy(rootParentWorldQuat.clone().invert().multiply(newRootWorldQuat));
  root.updateMatrixWorld(true);

  // Step 2: same technique for mid's world direction (mid→effector) —
  // re-read effector's world position now that root's update has already
  // moved mid (and, via mid's still-unchanged local rotation, effector)
  // into their new positions under the new root orientation.
  const curEffectorPos = new THREE.Vector3();
  effector.getWorldPosition(curEffectorPos);
  const curMidDir = curEffectorPos.clone().sub(newMidPos).normalize();
  const newMidDir = newEffectorPos.clone().sub(newMidPos).normalize();
  const midDelta = new THREE.Quaternion().setFromUnitVectors(curMidDir, newMidDir);
  const midWorldQuat = new THREE.Quaternion();
  mid.getWorldQuaternion(midWorldQuat);
  const newMidWorldQuat = midDelta.multiply(midWorldQuat);
  const midParentWorldQuat = new THREE.Quaternion();
  if (mid.parent) mid.parent.getWorldQuaternion(midParentWorldQuat);
  mid.quaternion.copy(midParentWorldQuat.clone().invert().multiply(newMidWorldQuat));
  mid.updateMatrixWorld(true);
}

type SculptCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

// Frames the camera on `object`'s current world-space bounding box —
// shared by every load path (primitive spawn, GLB import, arbitrary
// geometry load) and the Recenter View button, replacing what used to be
// 3 separately hand-rolled copies of this math (2 of which pinned
// controls.target to a hardcoded (0,0,0) without recentering the object
// first, silently drifting off-target for anything not already centered
// at its own local origin — e.g. loadGeometry's arbitrary/extracted
// meshes). With `recenterObject`, also shifts `object.position` so its
// bbox center lands at the world origin first — used only by the load
// paths, since nudging an in-progress edit's position would be a
// surprising side effect of the Recenter View button, which should just
// look at wherever the object already is.
function frameCameraOnObject(
  object: THREE.Object3D,
  camera: SculptCamera,
  controls: OrbitControls,
  options?: { recenterObject?: boolean }
) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  if (options?.recenterObject) {
    object.position.sub(box.getCenter(new THREE.Vector3()));
    box.setFromObject(object);
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 2.2;
  camera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist);
  camera.near = maxDim / 100;
  camera.far = maxDim * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

const PAINT_TEX_SIZE = 1024;
export type SculptViewerHandle = {
  exportGlb: () => Promise<Uint8Array>;
  exportAtLevel: (level: number) => Promise<Uint8Array>;
  undo: () => void;
  redo: () => void;
  subdivide: () => void;
  subdivideDown: () => boolean;
  subdivLevel: () => number;
  loadPrimitive: (type: PrimitiveType) => void;
  remesh: () => void;
  loadGeometry: (geo: THREE.BufferGeometry, name?: string) => void;
  clearScene: () => void;
  /** Extrudes the current poly-edit selection — face-mode extrudes every
   * selected face independently; edge-mode walks the loop from the first
   * selected edge and extrudes it (boundary loops only). */
  extrudeSelection: (distance: number) => { ok: boolean; reason?: string };
  /** Live "N edges in loop" preview for the current edge-mode selection, or
   * null when not applicable (not in edge mode, nothing selected, etc). */
  getLoopPreview: () => { edgeCount: number; boundary: boolean; closed: boolean } | null;
  /** A reasonable default extrude distance, scaled to the loaded mesh's density. */
  getRecommendedExtrudeDistance: () => number;
  /** ZBrush-style extraction: for every entry with a painted mask, builds a
   * new thickened+closed shell submesh from the masked region and adds
   * it to the scene. Never mutates the source mesh. Returns how many new
   * submeshes were created (0 if nothing is masked above the threshold
   * anywhere). */
  extractMask: (threshold: number, thickness: number) => number;
  /** For every entry with a painted mask, moves the masked triangles (with
   * their original position/normal/uv/color, no synthetic shell) out of the
   * source entry's own geometry and into a new independent submesh — e.g.
   * detaching a vehicle door or wheel that already has real geometry, while
   * keeping the shared UV map. Unlike extractMask, this DOES mutate the
   * source entry. Returns how many new submeshes were created. */
  detachMask: (threshold: number) => number;
  /** Resets every entry's mask to fully unmasked and clears its visualization. */
  clearMask: () => void;
  /** Current scene contents for the Submeshes list UI. */
  getMeshEntries: () => Array<{ id: string; name: string; visible: boolean; vertexCount: number }>;
  setEntryVisible: (id: string, visible: boolean) => void;
  /** Removes an entry from the scene and disposes its GPU resources. Refuses to delete the last remaining entry. */
  deleteEntry: (id: string) => { ok: boolean; reason?: string };
  /** Exports just one entry as its own .glb — hides every other entry for the duration of the export, then restores visibility. */
  exportEntryGlb: (id: string) => Promise<Uint8Array>;
  /** Bones for a given entry's skeleton (empty if it has none — most
   * entries won't, this is only populated for a real imported rig, e.g.
   * an AccuRIG-exported GLB), depth-indented for the Pose-mode Bones list. */
  getBones: (entryId: string) => Array<{ id: string; name: string; depth: number }>;
  /** Attaches the pose gizmo to a bone by id (its THREE.Object3D uuid), or
   * detaches it if boneId is null. */
  selectBone: (entryId: string, boneId: string | null) => void;
  /** Restores every bone in an entry's skeleton to its originally-imported
   * bind pose (a no-op if the entry has no skeleton). */
  resetPose: (entryId: string) => void;
  /** Restores just ONE bone to its bind pose, leaving every other bone's
   * current pose untouched — for zeroing a single joint. */
  resetBone: (entryId: string, boneId: string) => void;
  /** Pose-mode animation clips for an entry (empty until the first
   * keyframe/explicit New Clip — see lib/sculpt/animation.ts). */
  getClips: (entryId: string) => Array<{ id: string; name: string; duration: number }>;
  /** Auto-detected leg/arm IK chains for an entry (empty if its skeleton
   * matched neither known biped naming convention). effectorBoneId is a
   * THREE.Bone uuid (matching getBones/selectBone), already resolved
   * from the chain's stored bone name. */
  getIKChains: (entryId: string) => Array<{ id: string; name: string; effectorBoneId: string }>;
  /** The auto-detected hip/pelvis/root bone's id (THREE.Bone uuid), for
   * a one-click "select the hip control" shortcut — null if none found. */
  getHipBoneId: (entryId: string) => string | null;
  /** Attaches the IK drag gizmo to a chain's target bone (deselecting
   * any manually-selected pose bone/rig joint), or detaches it if
   * chainId is null. Dragging the gizmo solves the whole chain live via
   * CCDIKSolver — a no-op if the entry/chain has no detected IK. */
  selectIKChain: (entryId: string, chainId: string | null) => void;
  getActiveClipId: (entryId: string) => string | null;
  setActiveClip: (entryId: string, clipId: string | null) => void;
  /** Creates a new empty clip (lazily creating the entry's PoseAnimationState
   * too, if this is its first clip) and makes it active. Returns its id, or
   * null if the entry has no skeleton to animate. */
  createAnimationClip: (entryId: string) => string | null;
  renameAnimationClip: (entryId: string, clipId: string, name: string) => void;
  /** Deep-copies a clip's channels/keys under a new id, same pattern as
   * duplicateClip in lib/sculpt/animation.ts. Returns the new clip's id. */
  duplicateAnimationClip: (entryId: string, clipId: string) => string | null;
  deleteAnimationClip: (entryId: string, clipId: string) => void;
  /** Whole-pose snapshot: reads every bone's CURRENT transform (however it
   * got there — manual drag or IK) and keys all of it into the active clip
   * at `time` in one call, creating the clip lazily if none is active. */
  insertKeyframe: (entryId: string, time: number) => void;
  /** Removes every channel's key at `time` from the active clip. */
  removeKeyframe: (entryId: string, time: number) => void;
  /** Every distinct time (seconds) that has a keyframe in the active
   * clip — for rendering marker ticks on the frame-based timeline. */
  getKeyframeTimes: (entryId: string) => number[];
  /** Explicitly sets the active clip's total length/frame rate — the
   * timeline's length is author-chosen, not derived from keyframes. */
  setClipLength: (entryId: string, frameCount: number, frameRate: number) => void;
  /** Scrubs the active clip to `time` (clamped to [0, duration]) without
   * starting playback — the timeline slider's drag handler. */
  setPoseTime: (entryId: string, time: number) => void;
  /** Starts/stops playback of the active clip from its current time. */
  setPosePlaying: (entryId: string, playing: boolean) => void;
  /** Re-frames the camera on the currently-selected mesh/submesh, or the
   * whole scene if nothing's selected. */
  recenterView: () => void;
  /** Wraps the selected entry (or every entry, if none selected) onto the
   * surface of `referenceGeometry` — see lib/sculpt/conform.ts. */
  conformToReference: (referenceGeometry: THREE.BufferGeometry) => void;
  /** Switches between Perspective and Orthographic camera projection,
   * matching apparent size at the moment of the switch. */
  toggleProjection: () => void;
  /** Manually-placed Rig-mode joints for a given entry (empty until the
   * user places one — most entries won't have any), depth-indented for
   * the Rig-mode Bones list. Distinct from getBones above — these are
   * plain pivot markers, not an imported skeleton. */
  getJoints: (entryId: string) => Array<{ id: string; name: string; depth: number }>;
  /** Attaches the rig gizmo to a joint by id, or detaches it if jointId is null. */
  selectJoint: (entryId: string, jointId: string | null) => void;
  renameJoint: (entryId: string, jointId: string, name: string) => void;
  /** Removes a joint; its own children reparent to its parent (never
   * deleted or orphaned) — mirrors lib/sculpt/rig.ts's deleteBone. */
  deleteJoint: (entryId: string, jointId: string) => void;
};

export type ViewMode = "combined" | "clay" | "wireframe" | "albedo" | "ao";
export type PrimitiveType = "sphere" | "box" | "cylinder" | "cone" | "torus" | "capsule" | "plane" | "human";
// "off": hidden. "on": depth-tested — the mesh occludes bones normally
// (pair with xrayEnabled to see through). "onTop": always visible,
// ignores mesh depth — matches the existing Pose/Rig edit-mode look.
export type BoneViewerMode = "off" | "on" | "onTop";

// ── MatCap clay texture generator (CPU / canvas) ──────────────────────────────
// Generates a 256×256 sphere image on a canvas using view-space lighting.
// Canvas approach avoids WebGL render-target color-space issues entirely.
// ── Primitive geometry helpers ────────────────────────────────────────────────
function buildHumanBase(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  function add(geo: THREE.BufferGeometry, x: number, y: number, z: number) {
    geo.translate(x, y, z); parts.push(geo);
  }
  add(new THREE.SphereGeometry(0.13, 10, 8),           0,     1.65, 0);      // head
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.10, 8), 0,     1.52, 0);     // neck
  add(new THREE.BoxGeometry(0.42, 0.52, 0.22),          0,     1.10, 0);     // torso
  add(new THREE.BoxGeometry(0.40, 0.22, 0.22),          0,     0.75, 0);     // hips
  add(new THREE.SphereGeometry(0.08, 8, 6),            -0.24,  1.32, 0);     // L shoulder
  add(new THREE.SphereGeometry(0.08, 8, 6),             0.24,  1.32, 0);     // R shoulder
  add(new THREE.CylinderGeometry(0.065, 0.06, 0.28, 8),-0.30, 1.10, 0);     // L upper arm
  add(new THREE.CylinderGeometry(0.065, 0.06, 0.28, 8), 0.30, 1.10, 0);     // R upper arm
  add(new THREE.SphereGeometry(0.065, 8, 6),           -0.30,  0.94, 0);     // L elbow
  add(new THREE.SphereGeometry(0.065, 8, 6),            0.30,  0.94, 0);     // R elbow
  add(new THREE.CylinderGeometry(0.055, 0.05, 0.26, 8),-0.30, 0.82, 0);     // L forearm
  add(new THREE.CylinderGeometry(0.055, 0.05, 0.26, 8), 0.30, 0.82, 0);     // R forearm
  add(new THREE.BoxGeometry(0.10, 0.14, 0.05),         -0.30,  0.66, 0);     // L hand
  add(new THREE.BoxGeometry(0.10, 0.14, 0.05),          0.30,  0.66, 0);     // R hand
  add(new THREE.CylinderGeometry(0.105, 0.095, 0.38, 10),-0.12,0.47, 0);    // L thigh
  add(new THREE.CylinderGeometry(0.105, 0.095, 0.38, 10), 0.12,0.47, 0);    // R thigh
  add(new THREE.SphereGeometry(0.09, 8, 6),            -0.12,  0.27, 0);     // L knee
  add(new THREE.SphereGeometry(0.09, 8, 6),             0.12,  0.27, 0);     // R knee
  add(new THREE.CylinderGeometry(0.08, 0.065, 0.36, 10),-0.12, 0.08, 0);    // L shin
  add(new THREE.CylinderGeometry(0.08, 0.065, 0.36, 10), 0.12, 0.08, 0);    // R shin
  add(new THREE.SphereGeometry(0.07, 8, 6),            -0.12, -0.11, 0);     // L ankle
  add(new THREE.SphereGeometry(0.07, 8, 6),             0.12, -0.11, 0);     // R ankle
  add(new THREE.BoxGeometry(0.12, 0.07, 0.22),         -0.12, -0.155,0.04);  // L foot
  add(new THREE.BoxGeometry(0.12, 0.07, 0.22),          0.12, -0.155,0.04);  // R foot
  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  merged.translate(0, -0.795, 0); // center vertically
  return merged;
}

function buildPrimitiveGeometry(type: PrimitiveType): THREE.BufferGeometry {
  const geo = (() => {
    switch (type) {
      case "sphere":   return new THREE.SphereGeometry(1, 16, 12);
      case "box":      return new THREE.BoxGeometry(1.8, 1.8, 1.8);
      case "cylinder": return new THREE.CylinderGeometry(0.8, 0.8, 2, 16);
      case "cone":     return new THREE.ConeGeometry(1, 2, 16);
      case "torus":    return new THREE.TorusGeometry(0.8, 0.35, 12, 24);
      case "capsule":  return new THREE.CapsuleGeometry(0.7, 1.4, 8, 16);
      case "plane":    return new THREE.PlaneGeometry(2, 2, 4, 4);
      case "human":    return buildHumanBase();
      default:         return new THREE.SphereGeometry(1, 16, 12);
    }
  })();
  // Every one of these ships with duplicate vertices at its own face/UV
  // seams (a box alone has 24 raw verts for 8 physical corners) — weld
  // them into one real shared vertex per point so Subdivide/Extract
  // (and everything downstream) start from genuinely sealed topology
  // instead of relying on treating duplicates as "the same point"
  // throughout. See lib/sculpt/weld.ts for the accepted UV/shading
  // trade-offs. Import paths (loadGeometry) deliberately do NOT go
  // through this — external meshes may have authored seams worth
  // preserving.
  return weldGeometryByPosition(geo);
}
// ─────────────────────────────────────────────────────────────────────────────
function generateClayMatcap(color: THREE.Color, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const d = img.data;

  // View-space light directions (normalized)
  const l1 = new THREE.Vector3(0.2, 0.7, 0.6).normalize();
  const l2 = new THREE.Vector3(-0.35, 0.15, 0.8).normalize();
  const l3 = new THREE.Vector3(0.0, -0.5, 0.6).normalize();
  const v  = new THREE.Vector3(0, 0, 1);
  const h1 = new THREE.Vector3().addVectors(l1, v).normalize();
  const cr = color.r, cg = color.g, cb = color.b;

  const n = new THREE.Vector3();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 2.0 - 1.0;
      const ny = 1.0 - (y + 0.5) / size * 2.0; // canvas Y flipped vs sphere up
      const r2 = nx * nx + ny * ny;
      const i = (y * size + x) * 4;
      if (r2 >= 1.0) { d[i] = d[i+1] = d[i+2] = d[i+3] = 0; continue; }
      n.set(nx, ny, Math.sqrt(1.0 - r2)).normalize();

      const d1 = (n.dot(l1) * 0.5 + 0.5) ** 2 * 0.75;
      const d2 = Math.max(0, n.dot(l2)) * 0.25;
      const d3 = Math.max(0, n.dot(l3)) * 0.18;
      const spec = Math.max(0, n.dot(h1)) ** 12 * 0.12;
      const fres = (1.0 - n.z) ** 3.5 * 0.18;

      let r = cr * (d1 + d2) + cr * d3 * 1.05 + spec + fres * 0.50;
      let g = cg * (d1 + d2) + cg * d3 * 0.95 + spec + fres * 0.62;
      let b = cb * (d1 + d2) + cb * d3 * 0.85 + spec + fres * 0.90;

      // linear → sRGB gamma encode for canvas storage
      d[i]   = Math.round(Math.min(1, r) ** (1 / 2.2) * 255);
      d[i+1] = Math.round(Math.min(1, g) ** (1 / 2.2) * 255);
      d[i+2] = Math.round(Math.min(1, b) ** (1 / 2.2) * 255);
      d[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

type Props = {
  glbData: ArrayBuffer | null;
  brushMode: BrushMode;
  brushRadius: number;
  brushInnerRadius: number;
  brushStrength: number;
  viewMode?: ViewMode;
  clayColor?: string;
  paintColor?: string;
  dynTopo?: boolean;
  /** Smooth (Catmull-Clark) vs. simple/flat subdivision for the NEXT "Up" press. */
  smoothSubdivide?: boolean;
  /** Independent of viewMode — shows the wireframe overlay on top of
   * whichever view is active (combined/clay/albedo/ao), not just the
   * dedicated "wireframe" view mode. */
  wireframeOverlay?: boolean;
  /** Makes every mesh material translucent, independent of view mode —
   * pairs with boneViewerMode to see bones through the mesh. */
  xrayEnabled?: boolean;
  /** Shows the loaded skeleton/rig joints outside of Pose/Rig edit mode.
   * "off": hidden. "on": occluded normally by the mesh (pair with
   * xrayEnabled). "onTop": always visible, ignoring mesh depth. */
  boneViewerMode?: BoneViewerMode;
  /** Ground reference grid. Defaults to visible (existing behavior). */
  showGrid?: boolean;
  /** Brush-radius vertex highlight density. Defaults to "all" (existing behavior). */
  highlightMode?: HighlightMode;
  /** ZBrush-style X-axis symmetry — mirrors sculpt strokes and poly-edit
   * selection/transforms across the X=0 plane. */
  mirrorMode?: boolean;
  editMode?: EditMode;
  selectMode?: SelectMode;
  polyEditSelectTool?: PolyEditSelectTool;
  transformMode?: TransformMode;
  onModelLoaded?: (vertexCount: number) => void;
  onLoadError?: (msg: string) => void;
  onSelectionChange?: (count: number) => void;
  /** Fired alongside onSelectionChange whenever edge-mode selection changes
   * — lets the UI show a live "N edges in loop" readout without polling a
   * ref during render (reading ref.current at render time isn't allowed
   * under this project's stricter React Compiler lint rules). */
  onLoopPreview?: (info: { edgeCount: number; boundary: boolean; closed: boolean } | null) => void;
  /** Fired whenever pose-mode's selected bone changes (viewport click, or
   * cleared on mode exit) — same "event, not polled ref" reasoning as
   * onSelectionChange, so the Bones list panel can highlight the active row. */
  onBoneSelect?: (boneId: string | null) => void;
  /** Same as onBoneSelect, for Rig mode's manually-placed joints. */
  onJointSelect?: (jointId: string | null) => void;
  /** Fired whenever the Perspective/Ortho projection toggle switches, so
   * the toggle button can show which mode is currently active. */
  onProjectionChange?: (isOrthographic: boolean) => void;
  /** Fired every frame while a pose clip is playing, and once whenever
   * the scrub time or play/pause state changes some other way (e.g.
   * insertKeyframe) — same "event, not polled ref" reasoning as
   * onBoneSelect, so the timeline UI can show a live playhead/duration
   * without polling a ref during render. */
  onPoseTimeChange?: (entryId: string, time: number, duration: number, playing: boolean, frameRate: number) => void;
  handleRef?: React.RefObject<SculptViewerHandle | null>;
};

export default function SculptViewer({
  glbData,
  brushMode,
  brushRadius,
  brushInnerRadius,
  brushStrength,
  viewMode = "combined",
  clayColor = "#ebe7e1",
  paintColor = "#e8925a",
  dynTopo = false,
  smoothSubdivide = true,
  wireframeOverlay = false,
  xrayEnabled = false,
  boneViewerMode = "off",
  showGrid = true,
  highlightMode = "all",
  mirrorMode = false,
  editMode = "sculpt",
  selectMode = "vertex",
  polyEditSelectTool = "click",
  transformMode = "translate",
  onModelLoaded,
  onLoadError,
  onSelectionChange,
  onLoopPreview,
  onBoneSelect,
  onJointSelect,
  onProjectionChange,
  onPoseTimeChange,
  handleRef,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<SculptCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const ktx2LoaderRef = useRef<KTX2Loader | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const meshEntriesRef = useRef<SculptMeshEntry[]>([]);
  const undoRef = useRef(new SculptUndoStack());
  // Only extrude operations push here — brush strokes and the poly-edit
  // transform gizmo keep using undoRef (position-only) since they never
  // change vertex/triangle count.
  const topoUndoRef = useRef(new TopoUndoStack());
  const brushIndicatorRef = useRef<THREE.Mesh | null>(null);
  const brushInnerIndicatorRef = useRef<THREE.Mesh | null>(null);
  /** Shows where a mirrored stroke would land, while mirror mode is on. */
  const mirrorIndicatorRef = useRef<THREE.Mesh | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  // Shared with poly-edit selection highlighting (added later) — repointed
  // by whichever call site is active; the two never render at once since
  // sculpt brushing and poly-edit selection are mutually exclusive modes.
  const highlightPointsRef = useRef<THREE.Points | null>(null);
  /** Edge-mode selection: a real line segment per selected edge, instead of
   * just the two disconnected corner dots highlightPointsRef would show. */
  const edgeHighlightRef = useRef<THREE.LineSegments | null>(null);
  /** Face-mode selection: a translucent fill over each selected face. */
  const faceHighlightRef = useRef<THREE.Mesh | null>(null);
  const strokeActiveRef = useRef(false);
  const lastHitRef = useRef<BrushHit | null>(null);
  const lastUVRef = useRef<{ uv: THREE.Vector2; mesh: THREE.Mesh } | null>(null);
  const altDownRef = useRef(false);
  const shiftDownRef = useRef(false);
  /** Ctrl+drag-on-mesh in Mask mode: rectangle mask select instead of a freehand stroke. */
  const boxSelectActiveRef = useRef(false);
  const boxSelectStartRef = useRef<{ x: number; y: number } | null>(null);
  const boxSelectOverlayRef = useRef<HTMLDivElement | null>(null);
  /** Ctrl+drag in poly_edit mode, when the Box/Lasso selection tool is
   * active: region-select instead of the default click-to-select. */
  const polyEditRegionActiveRef = useRef(false);
  const polyEditRegionStartRef = useRef<{ x: number; y: number } | null>(null);
  const polyEditRegionPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const lassoOverlayRef = useRef<SVGSVGElement | null>(null);
  /** Plain (no-modifier) drag starting in empty space (raycast miss):
   * OrbitControls handles it as a normal orbit rotate on its own. */
  const orbitDragActiveRef = useRef(false);
  /** Shift+drag starting in empty space: OrbitControls hardcodes any
   * ROTATE-mapped button as PAN the instant Shift (or Ctrl/Cmd) is held,
   * with no way to override that through mouseButtons — so this drag is
   * driven manually instead (disable OrbitControls, rotate by hand using
   * its own spherical-math formula), then snaps to the nearest
   * orthographic view on release. */
  const shiftRotateActiveRef = useRef(false);
  const shiftRotateLastRef = useRef<{ x: number; y: number } | null>(null);
  const dynTopoRef = useRef(false);
  useEffect(() => { dynTopoRef.current = dynTopo; }, [dynTopo]);
  const smoothSubdivideRef = useRef(true);
  useEffect(() => { smoothSubdivideRef.current = smoothSubdivide; }, [smoothSubdivide]);

  const wireframeOverlayRef = useRef(false);
  useEffect(() => {
    wireframeOverlayRef.current = wireframeOverlay;
    // Toggle immediately, independent of viewMode — no need to also touch
    // material state via applyViewToGroup for a pure visibility flip.
    const group = modelRef.current;
    if (!group) return;
    group.traverse((o) => {
      if (o.name === "__wire") o.visible = viewModeRef.current === "wireframe" || wireframeOverlay;
    });
  }, [wireframeOverlay]);

  const boneViewerModeRef = useRef<BoneViewerMode>("off");

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  const highlightModeRef = useRef<HighlightMode>(highlightMode);
  useEffect(() => { highlightModeRef.current = highlightMode; }, [highlightMode]);
  const mirrorModeRef = useRef(false);
  useEffect(() => {
    mirrorModeRef.current = mirrorMode;
    // Build (or reuse the cached) mirror data for every currently-loaded
    // entry the moment mirror mode turns on, so it's ready for both brush
    // strokes and poly-edit selection/gizmo use without a first-use hitch.
    if (mirrorMode) {
      for (const entry of meshEntriesRef.current) ensureMirror(entry);
    }
  }, [mirrorMode]);

  // Keep latest brush params accessible from pointer handlers without stale closures
  const brushModeRef = useRef(brushMode);
  const brushRadiusRef = useRef(brushRadius);
  const brushInnerRadiusRef = useRef(brushInnerRadius);
  const brushStrengthRef = useRef(brushStrength);
  useEffect(() => { brushModeRef.current = brushMode; }, [brushMode]);
  useEffect(() => { brushRadiusRef.current = brushRadius; }, [brushRadius]);
  useEffect(() => { brushInnerRadiusRef.current = brushInnerRadius; }, [brushInnerRadius]);
  useEffect(() => { brushStrengthRef.current = brushStrength; }, [brushStrength]);

  const onModelLoadedRef = useRef(onModelLoaded);
  const onLoadErrorRef = useRef(onLoadError);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onLoopPreviewRef = useRef(onLoopPreview);
  const onBoneSelectRef = useRef(onBoneSelect);
  const onJointSelectRef = useRef(onJointSelect);
  const onProjectionChangeRef = useRef(onProjectionChange);
  const onPoseTimeChangeRef = useRef(onPoseTimeChange);
  useEffect(() => { onModelLoadedRef.current = onModelLoaded; }, [onModelLoaded]);
  useEffect(() => { onLoadErrorRef.current = onLoadError; }, [onLoadError]);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
  useEffect(() => { onLoopPreviewRef.current = onLoopPreview; }, [onLoopPreview]);
  useEffect(() => { onBoneSelectRef.current = onBoneSelect; }, [onBoneSelect]);
  useEffect(() => { onJointSelectRef.current = onJointSelect; }, [onJointSelect]);
  useEffect(() => { onProjectionChangeRef.current = onProjectionChange; }, [onProjectionChange]);
  useEffect(() => { onPoseTimeChangeRef.current = onPoseTimeChange; }, [onPoseTimeChange]);

  // ── poly-edit mode: selection state + transform gizmo ─────────────────────
  const editModeRef = useRef<EditMode>(editMode);
  const selectModeRef = useRef<SelectMode>(selectMode);
  const polyEditSelectToolRef = useRef<PolyEditSelectTool>(polyEditSelectTool);
  const transformModeRef = useRef<TransformMode>(transformMode);
  // Selection is scoped to a single mesh entry at a time (documented
  // simplification vs. sculpt brushes, which already apply across all
  // entries) — keyed "v{i}" / "{minIdx}_{maxIdx}" / "q{i}" or "t{i}"
  // depending on selectModeRef.
  const selectedEntryRef = useRef<SculptMeshEntry | null>(null);
  const selectionRef = useRef<Set<string>>(new Set());
  const gizmoPivotRef = useRef<THREE.Object3D | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  // TransformControls itself isn't an Object3D in this three.js version —
  // its visual representation (added to the scene) is a separate helper,
  // and .visible lives there, not on the controls instance.
  const transformHelperRef = useRef<THREE.Object3D | null>(null);
  // Assigned inside the pointer-events effect (where hit-testing and the
  // highlight overlay already live) so the mode-change effects below and the
  // gizmo-drag handlers (set up in the scene-init effect) can reach them
  // without duplicating selection-resolution logic in three places.
  const clearPolyEditSelectionRef = useRef<() => void>(() => {});
  const updateSelectionHighlightPointsRef = useRef<() => void>(() => {});
  const repositionGizmoToSelectionRef = useRef<() => void>(() => {});
  // Directly sets the selection to a specific key set (e.g. the new cap
  // face(s) after an extrude) rather than resolving it from a pointer hit.
  const setPolyEditSelectionRef = useRef<(entry: SculptMeshEntry, keys: string[]) => void>(() => {});

  // ── pose mode: bone selection + rotate/translate gizmo ────────────────────
  // A second, independent TransformControls instance — unlike poly-edit's
  // gizmo (which needs a synthetic pivot since raw vertex indices aren't
  // Object3Ds), this attaches DIRECTLY to the selected THREE.Bone, since a
  // Bone already is a real Object3D in the scene graph. Dragging it mutates
  // bone.position/quaternion via TransformControls' own standard attach()
  // behavior — Three's renderer already calls skeleton.update() for any
  // visible SkinnedMesh every frame (confirmed directly in
  // WebGLObjects.js), so the mesh deforms live with no extra code here.
  const poseTransformControlsRef = useRef<TransformControls | null>(null);
  const poseTransformHelperRef = useRef<THREE.Object3D | null>(null);
  const boneHandlesRef = useRef<THREE.Points | null>(null);
  const boneLinksRef = useRef<THREE.LineSegments | null>(null);
  const selectedBoneRef = useRef<THREE.Bone | null>(null);
  const toggleProjectionRef = useRef<() => void>(() => {});
  const selectedBoneEntryRef = useRef<SculptMeshEntry | null>(null);
  const updateBoneHandlesRef = useRef<() => void>(() => {});
  const selectBoneRef = useRef<(entry: SculptMeshEntry | null, bone: THREE.Bone | null) => void>(() => {});
  const resetPoseRef = useRef<(entry: SculptMeshEntry) => void>(() => {});
  /** Restores just one bone from bindPose — distinct from resetPose's
   * whole-skeleton restore, for zeroing a single joint without disturbing
   * the rest of the pose. */
  const resetBoneRef = useRef<(entry: SculptMeshEntry, bone: THREE.Bone) => void>(() => {});
  // Assigned in the scene-init effect (where boneHandleIndex lives) so the
  // separate pointer-events effect below can resolve a click without a
  // real raycast (bone handles are small points, not intersectable geometry).
  const getBoneHitFromEventRef = useRef<(e: PointerEvent) => { entry: SculptMeshEntry; bone: THREE.Bone } | null>(() => null);

  // Pose-mode animation playback — rebuilds a THREE.AnimationMixer/Action
  // from the entry's active clip whenever it changes (clip switch, keyframe
  // insert/remove), and scrubs/plays it. See lib/sculpt/animation.ts for
  // the underlying data; these refs just expose the scene-graph side to
  // the outer component's imperative handle methods, same indirection
  // pattern as updateBoneHandlesRef above.
  const rebuildPoseMixerRef = useRef<(entry: SculptMeshEntry) => void>(() => {});
  /** Exposed so exportGlb (a separate useCallback, outside this effect)
   * can reuse the exact same clip-assembly logic playback uses — the
   * exported file's animation is guaranteed to match what was actually
   * previewed, not a second, potentially-diverging implementation. */
  const buildThreeClipRef = useRef<(clip: AnimationClipData) => THREE.AnimationClip>(() => new THREE.AnimationClip("empty", 0, []));
  const setPoseTimeRef = useRef<(entry: SculptMeshEntry, time: number) => void>(() => {});
  const setPosePlayingRef = useRef<(entry: SculptMeshEntry, playing: boolean) => void>(() => {});

  // ── rig mode: manual joint placement + mask-weighted pivot transform ──────
  // Unlike Pose mode's gizmo (attaches directly to a real THREE.Bone), a
  // RigBone is plain data, not a scene-graph object — this reuses
  // poly-edit's OWN pattern instead (synthetic pivot Object3D + manual
  // per-vertex copy), not Pose mode's. Its own TransformControls instance
  // (not literally shared with poly-edit's) since poly-edit's
  // beginGizmoDrag/applyGizmoDrag already carry real complexity
  // (mirror-mode handling) that mask-weighted-blend logic shouldn't be
  // mode-branched into.
  const rigGizmoPivotRef = useRef<THREE.Object3D | null>(null);
  const rigTransformControlsRef = useRef<TransformControls | null>(null);
  const rigTransformHelperRef = useRef<THREE.Object3D | null>(null);
  const jointHandlesRef = useRef<THREE.Points | null>(null);
  const jointLinksRef = useRef<THREE.LineSegments | null>(null);
  const selectedJointRef = useRef<RigBone | null>(null);
  const selectedJointEntryRef = useRef<SculptMeshEntry | null>(null);
  const updateJointHandlesRef = useRef<() => void>(() => {});
  const selectJointRef = useRef<(entry: SculptMeshEntry | null, bone: RigBone | null) => void>(() => {});
  const createJointAtRef = useRef<(entry: SculptMeshEntry, worldPos: THREE.Vector3) => void>(() => {});
  const getJointHitFromEventRef = useRef<(e: PointerEvent) => { entry: SculptMeshEntry; bone: RigBone } | null>(() => null);

  // ── IK target dragging ─────────────────────────────────────────────────
  // A dedicated TransformControls, same pattern as poseTransformControls/
  // rigTransformControls, just attached to a chain's synthetic target
  // bone (SculptMeshEntry.ikTargetBones) instead of a real pose bone or
  // a Rig-mode pivot. Dragging it calls entry.ikSolver.update(), which
  // mutates the actual chain bones' quaternions — the exact same
  // mechanism manual bone dragging uses, so keyframing/undo need no
  // IK-specific handling at all.
  const ikTransformControlsRef = useRef<TransformControls | null>(null);
  const ikTransformHelperRef = useRef<THREE.Object3D | null>(null);
  // Second gizmo for the pole-vector bend-direction handle — shown
  // alongside the target gizmo (not instead of it) whenever the selected
  // chain has a pole bone, so both are draggable at once, same as
  // Maya/Unity show target + pole together rather than making the user
  // switch between them.
  const ikPoleTransformControlsRef = useRef<TransformControls | null>(null);
  const ikPoleTransformHelperRef = useRef<THREE.Object3D | null>(null);
  const selectedIKChainIdRef = useRef<string | null>(null);
  const selectedIKEntryRef = useRef<SculptMeshEntry | null>(null);
  const selectIKChainRef = useRef<(entry: SculptMeshEntry | null, chainId: string | null) => void>(() => {});

  useEffect(() => {
    boneViewerModeRef.current = boneViewerMode;
    updateBoneHandlesRef.current();
    updateJointHandlesRef.current();
  }, [boneViewerMode]);

  useEffect(() => {
    editModeRef.current = editMode;
    if (editMode === "poly_edit") {
      // Lazily build adjacency the first time poly-edit is entered for each
      // mesh — sculpt-only sessions never pay for it.
      for (const entry of meshEntriesRef.current) {
        if (!entry.topology) entry.topology = buildTopology(entry.mesh.geometry, entry.quadIndices);
      }
    } else {
      clearPolyEditSelectionRef.current();
    }
    if (editMode === "pose") {
      updateBoneHandlesRef.current();
    } else {
      selectBoneRef.current(null, null);
      selectIKChainRef.current(null, null);
      if (boneHandlesRef.current) boneHandlesRef.current.visible = false;
      if (boneLinksRef.current) boneLinksRef.current.visible = false;
    }
    if (editMode === "rig") {
      updateJointHandlesRef.current();
    } else {
      selectJointRef.current(null, null);
      if (jointHandlesRef.current) jointHandlesRef.current.visible = false;
      if (jointLinksRef.current) jointLinksRef.current.visible = false;
    }
  }, [editMode]);
  useEffect(() => {
    selectModeRef.current = selectMode;
    // Selection keys are mode-specific (a "v3" key is meaningless once
    // selectMode flips to edge/face) — clear rather than try to translate.
    clearPolyEditSelectionRef.current();
  }, [selectMode]);
  useEffect(() => { polyEditSelectToolRef.current = polyEditSelectTool; }, [polyEditSelectTool]);
  useEffect(() => {
    transformModeRef.current = transformMode;
    transformControlsRef.current?.setMode(transformMode);
    // Pose mode reuses the same translate/rotate/scale toggle poly-edit
    // already exposes, rather than adding a parallel UI control — rotate
    // is the primary posing gesture, translate/scale still available.
    poseTransformControlsRef.current?.setMode(transformMode);
    // Rig mode's pivot transform reuses it too — scale is the primary
    // gesture there (per the reported use case), translate/rotate also
    // available without a third parallel toggle.
    rigTransformControlsRef.current?.setMode(transformMode);
  }, [transformMode]);

  // Material / view-mode refs
  const clayMatRef = useRef<THREE.MeshMatcapMaterial | null>(null);
  const clayMatcapTexRef = useRef<THREE.CanvasTexture | null>(null);
  const lastClayColorRef = useRef<string>("");
  const channelMatsRef = useRef<THREE.MeshBasicMaterial[]>([]);
  const wireMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const originalMaterialsRef = useRef<Map<string, THREE.Material | THREE.Material[]>>(new Map());
  const viewModeRef = useRef<ViewMode>(viewMode);
  const clayColorRef = useRef(clayColor);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { clayColorRef.current = clayColor; }, [clayColor]);
  // X-Ray: per-material captured baseline (transparent/opacity/depthWrite),
  // keyed by material object identity so it survives clay's persistent
  // singleton material and correctly no-ops for albedo/ao's fresh-every-call
  // instances (their captured baseline is just the trivial default).
  const xrayBaselineRef = useRef(new WeakMap<THREE.Material, { transparent: boolean; opacity: number; depthWrite: boolean }>());
  const xrayEnabledRef = useRef(false);
  const paintColorRef = useRef(paintColor);
  useEffect(() => { paintColorRef.current = paintColor; }, [paintColor]);

  function getClayMat(color: string): THREE.MeshMatcapMaterial {
    if (!clayMatRef.current || lastClayColorRef.current !== color) {
      clayMatcapTexRef.current?.dispose();
      const tex = generateClayMatcap(new THREE.Color(color).convertSRGBToLinear());
      clayMatcapTexRef.current = tex;
      if (!clayMatRef.current) {
        clayMatRef.current = new THREE.MeshMatcapMaterial({ matcap: tex });
      } else {
        clayMatRef.current.matcap = tex;
        clayMatRef.current.needsUpdate = true;
      }
      lastClayColorRef.current = color;
    }
    return clayMatRef.current!;
  }

  const XRAY_OPACITY = 0.3;

  /** Makes every mesh material in `group` translucent (or restores it),
   * independent of which view-mode material is currently assigned — called
   * both on its own (toggle) and from the tail of applyViewToGroup so it
   * survives view-mode switches and entry rebuilds without needing a
   * separate call at each of those sites. */
  function applyXrayToGroup(group: THREE.Group, enabled: boolean) {
    const baselines = xrayBaselineRef.current;
    group.traverse((o) => {
      if (o.name === "__wire") return;
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (enabled) {
          if (!baselines.has(mat)) {
            baselines.set(mat, { transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite });
          }
          mat.transparent = true;
          mat.opacity = XRAY_OPACITY;
          mat.depthWrite = false;
        } else {
          const base = baselines.get(mat);
          if (base) {
            mat.transparent = base.transparent;
            mat.opacity = base.opacity;
            mat.depthWrite = base.depthWrite;
          }
        }
        mat.needsUpdate = true;
      }
    });
  }

  useEffect(() => {
    xrayEnabledRef.current = xrayEnabled;
    const group = modelRef.current;
    if (group) applyXrayToGroup(group, xrayEnabled);
  }, [xrayEnabled]);

  function applyViewToGroup(group: THREE.Group, scene: THREE.Scene, vm: ViewMode, cc: string) {
    channelMatsRef.current.forEach(m => m.dispose());
    channelMatsRef.current = [];
    group.traverse((o) => {
      // Handle wire overlays first — LineSegments are not isMesh
      if (o.name === "__wire") {
        o.visible = vm === "wireframe" || wireframeOverlayRef.current;
        if (wireMatRef.current) wireMatRef.current.color.setHex(wireColorFor(vm));
        return;
      }
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const orig = originalMaterialsRef.current.get(m.uuid);
      if (orig !== undefined) m.material = orig;
    });
    if (vm === "clay") {
      scene.background = new THREE.Color("#1c1c1c");
      const mat = getClayMat(cc);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.name === "__wire") return;
        m.material = mat;
      });
    } else if (vm === "albedo" || vm === "ao") {
      scene.background = new THREE.Color("#1a1614");
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.name === "__wire") return;
        const orig = originalMaterialsRef.current.get(m.uuid);
        const src = (Array.isArray(orig) ? orig[0] : orig) as THREE.MeshStandardMaterial | undefined;
        if (!src) return;
        const tex = vm === "albedo" ? (src.map ?? null) : (src.aoMap ?? null);
        if (tex) tex.colorSpace = vm === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        const cm = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x888888 });
        channelMatsRef.current.push(cm);
        m.material = cm;
      });
    } else {
      scene.background = new THREE.Color("#1a1614");
    }
    applyXrayToGroup(group, xrayEnabledRef.current);
  }

  // ── view mode / clay color change ─────────────────────────────────────────
  useEffect(() => {
    viewModeRef.current = viewMode;
    const group = modelRef.current;
    const scene = sceneRef.current;
    if (!group || !scene) return;
    applyViewToGroup(group, scene, viewMode, clayColor);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, clayColor]);

  // ── paint brush mode: swap mesh materials ──────────────────────────────────
  useEffect(() => {
    const group = modelRef.current;
    const scene = sceneRef.current;
    if (!group || !scene) return;
    if (brushMode === "paint") {
      meshEntriesRef.current.forEach((entry) => {
        if (entry.paintMat) entry.mesh.material = entry.paintMat;
      });
    } else if (brushMode === "mask") {
      meshEntriesRef.current.forEach((entry) => {
        ensureMaskState(entry);
        entry.mesh.material = entry.maskMat!;
      });
    } else {
      applyViewToGroup(group, scene, viewModeRef.current, clayColorRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushMode]);


  // ── one-time scene setup ──────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1a1614");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    camera.position.set(2.4, 1.8, 3.2);
    cameraRef.current = camera;

    // Second camera for the Perspective/Ortho toggle — a real
    // OrthographicCamera, not a narrow-FOV perspective hack, so proportions
    // read as true parallel projection. Frustum (left/right/top/bottom) is
    // kept in sync with the viewport aspect ratio in resize() below; only
    // .zoom changes at toggle time to match apparent size.
    const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 5000);
    orthoCamera.position.copy(camera.position);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath("/basis/");
    ktx2Loader.detectSupport(renderer);
    ktx2LoaderRef.current = ktx2Loader;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    // RIGHT drags pan (matches this file's earlier convention of leaving
    // Ctrl free for box/mask-select, ZBrush-style, rather than overloading
    // it onto camera navigation). Note OrbitControls itself (see its own
    // pointerdown handler) hardcodes "any button configured as ROTATE
    // becomes PAN the instant Ctrl/Cmd/Shift is held" — independent of
    // this config and NOT overridable through it — which is why Shift-
    // triggered ortho-snap can't just be "a rotate with a modifier key"
    // and is instead driven manually below (see the shiftRotateActiveRef
    // block in onPointerDown/onPointerMove/onPointerUp).
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x1a2230, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fc6f0, 1.0);
    rim.position.set(-5, 2, -4);
    scene.add(rim);

    const grid = new THREE.GridHelper(10, 20, 0x6b5d52, 0x3d3530);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.4;
    grid.visible = showGrid;
    scene.add(grid);
    gridRef.current = grid;

    // Brush indicator rings: outer = full radius, inner = focal zone
    const ringGeo = new THREE.TorusGeometry(1, 0.008, 6, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.7 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.visible = false;
    ring.renderOrder = 999;
    scene.add(ring);
    brushIndicatorRef.current = ring;

    const innerRingGeo = new THREE.TorusGeometry(1, 0.006, 6, 48);
    const innerRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.35 });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.visible = false;
    innerRing.renderOrder = 999;
    scene.add(innerRing);
    brushInnerIndicatorRef.current = innerRing;

    // Mirror-point indicator — a small solid dot at the mirrored hit
    // location while mirror mode is on, so the mirrored stroke's target is
    // visibly shown (not just implicitly mirrored).
    const mirrorGeo = new THREE.SphereGeometry(1, 12, 8);
    const mirrorMat = new THREE.MeshBasicMaterial({ color: 0x5ad1ff, depthTest: false, transparent: true, opacity: 0.8 });
    const mirrorDot = new THREE.Mesh(mirrorGeo, mirrorMat);
    mirrorDot.visible = false;
    mirrorDot.renderOrder = 999;
    scene.add(mirrorDot);
    mirrorIndicatorRef.current = mirrorDot;

    // Highlights whichever vertices the brush would currently affect (or,
    // once poly-edit mode exists, whichever are selected) — an empty
    // BufferGeometry to start; updateHighlightPoints() rebuilds its
    // position attribute on every hover/selection change.
    const highlightGeo = new THREE.BufferGeometry();
    highlightGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const highlightMat = new THREE.PointsMaterial({
      color: 0xffe08a, size: 6, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.9,
    });
    const highlightPoints = new THREE.Points(highlightGeo, highlightMat);
    highlightPoints.visible = false;
    highlightPoints.renderOrder = 999;
    scene.add(highlightPoints);
    highlightPointsRef.current = highlightPoints;

    // Poly-edit edge/face selection shape overlays — real geometry instead
    // of just corner dots, so a selected edge/face is visually distinct
    // from a scattering of individually-selected vertices. Empty to start;
    // rebuilt by updateSelectionHighlightPoints() below.
    const edgeHighlightGeo = new THREE.BufferGeometry();
    edgeHighlightGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const edgeHighlightMat = new THREE.LineBasicMaterial({
      color: 0xc47be8, depthTest: false, transparent: true, opacity: 0.9,
    });
    const edgeHighlight = new THREE.LineSegments(edgeHighlightGeo, edgeHighlightMat);
    edgeHighlight.visible = false;
    edgeHighlight.renderOrder = 999;
    scene.add(edgeHighlight);
    edgeHighlightRef.current = edgeHighlight;

    const faceHighlightGeo = new THREE.BufferGeometry();
    faceHighlightGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const faceHighlightMat = new THREE.MeshBasicMaterial({
      color: 0xc47be8, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthTest: false,
    });
    const faceHighlight = new THREE.Mesh(faceHighlightGeo, faceHighlightMat);
    faceHighlight.visible = false;
    faceHighlight.renderOrder = 999;
    scene.add(faceHighlight);
    faceHighlightRef.current = faceHighlight;

    // Poly-edit transform gizmo — attaches to a hidden pivot (not to
    // individual vertices; TransformControls only ever attaches to one
    // Object3D) recentered on the selection's centroid whenever the
    // selection changes. Hidden/disabled until a poly-edit selection exists.
    const gizmoPivot = new THREE.Object3D();
    scene.add(gizmoPivot);
    gizmoPivotRef.current = gizmoPivot;

    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode(transformModeRef.current);
    transformControls.enabled = false;
    const transformHelper = transformControls.getHelper();
    transformHelper.visible = false;
    scene.add(transformHelper);
    transformControlsRef.current = transformControls;
    transformHelperRef.current = transformHelper;

    // Pose-mode bone handles (small dots, one per bone across every
    // skinned entry) + parent-child link lines, same visual convention as
    // the poly-edit highlight overlays above (depthTest:false,
    // renderOrder 999, purple accent so it reads as the same tool family).
    const boneHandleGeo = new THREE.BufferGeometry();
    boneHandleGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const boneHandleMat = new THREE.PointsMaterial({
      color: 0xc47be8, size: 8, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.9,
    });
    const boneHandles = new THREE.Points(boneHandleGeo, boneHandleMat);
    boneHandles.visible = false;
    boneHandles.renderOrder = 999;
    scene.add(boneHandles);
    boneHandlesRef.current = boneHandles;

    const boneLinkGeo = new THREE.BufferGeometry();
    boneLinkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const boneLinkMat = new THREE.LineBasicMaterial({ color: 0xc47be8, depthTest: false, transparent: true, opacity: 0.6 });
    const boneLinks = new THREE.LineSegments(boneLinkGeo, boneLinkMat);
    boneLinks.visible = false;
    boneLinks.renderOrder = 998;
    scene.add(boneLinks);
    boneLinksRef.current = boneLinks;

    // Pose gizmo — attaches directly to the selected THREE.Bone (a real
    // Object3D), unlike the poly-edit gizmo above which needs a synthetic
    // pivot since raw vertex indices aren't objects. No manual per-vertex
    // copying needed here: TransformControls' own attach() already writes
    // straight to bone.position/quaternion.
    const poseTransformControls = new TransformControls(camera, renderer.domElement);
    poseTransformControls.setMode(transformModeRef.current);
    poseTransformControls.enabled = false;
    const poseTransformHelper = poseTransformControls.getHelper();
    poseTransformHelper.visible = false;
    scene.add(poseTransformHelper);
    poseTransformControlsRef.current = poseTransformControls;
    poseTransformHelperRef.current = poseTransformHelper;

    poseTransformControls.addEventListener("dragging-changed", (event) => {
      controls.enabled = !event.value;
      // Snapshot the bone's pre-drag transform for undo — same trigger
      // point (drag start, before any displacement) beginRigDrag/
      // beginGizmoDrag already use for their own snapshot kinds.
      if (event.value && selectedBoneRef.current) {
        undoRef.current.pushPose([selectedBoneRef.current]);
      }
    });
    poseTransformControls.addEventListener("objectChange", () => {
      // Keep the handle dots/links following the bone live as it's dragged
      // — cheap (bone counts are small), simplest way to keep the overlay
      // from visibly lagging the actual pose.
      updateBoneHandlesRef.current();
    });

    // World position of every bone across every skinned entry, in the same
    // order as boneHandles' position buffer — lets pointer picking below
    // map a clicked screen point back to (entry, bone) without a raycast
    // (bone handles are tiny points, not real geometry to intersect).
    let boneHandleIndex: { entry: SculptMeshEntry; bone: THREE.Bone }[] = [];

    function updateBoneHandles() {
      const handles = boneHandlesRef.current;
      const links = boneLinksRef.current;
      if (!handles || !links) return;
      const inPoseMode = editModeRef.current === "pose";
      // Bone/joint click-selection (getBoneHitFromEvent below) picks via a
      // screen-space nearest-point search over boneHandleIndex, which stays
      // populated regardless of this .visible flag — so the Bone Viewer
      // toggle can genuinely hide the dots/lines even while posing, without
      // breaking the ability to click-select or drag a bone. The
      // TransformControls gizmo on the currently-selected bone is a
      // separate object with its own visible flag (selectBone), unaffected
      // by this toggle either way.
      const depthTest = !inPoseMode && boneViewerModeRef.current === "on";
      boneHandleMat.depthTest = depthTest;
      boneLinkMat.depthTest = depthTest;
      boneHandleIndex = [];
      const positions: number[] = [];
      const linkPositions: number[] = [];
      const wp = new THREE.Vector3();
      const parentWp = new THREE.Vector3();
      for (const entry of meshEntriesRef.current) {
        if (!entry.skeleton) continue;
        for (const bone of entry.skeleton.bones) {
          bone.getWorldPosition(wp);
          boneHandleIndex.push({ entry, bone });
          positions.push(wp.x, wp.y, wp.z);
          const parent = bone.parent as THREE.Bone | null;
          if (parent?.isBone) {
            parent.getWorldPosition(parentWp);
            linkPositions.push(parentWp.x, parentWp.y, parentWp.z, wp.x, wp.y, wp.z);
          }
        }
      }
      handles.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      handles.geometry.attributes.position.needsUpdate = true;
      handles.geometry.computeBoundingSphere();
      handles.visible = boneViewerModeRef.current !== "off" && positions.length > 0;

      links.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linkPositions), 3));
      links.geometry.attributes.position.needsUpdate = true;
      links.geometry.computeBoundingSphere();
      links.visible = boneViewerModeRef.current !== "off" && linkPositions.length > 0;
    }
    updateBoneHandlesRef.current = updateBoneHandles;

    function selectBone(entry: SculptMeshEntry | null, bone: THREE.Bone | null) {
      // Only clear IK selection when actually selecting a bone (not on
      // a plain deselect call) — selectIKChain calls this the same way
      // to clear pose selection, and both guard on their own non-null
      // param to avoid the two calling each other forever.
      if (bone) selectIKChainRef.current(null, null);
      selectedBoneEntryRef.current = entry;
      selectedBoneRef.current = bone;
      const tc = poseTransformControlsRef.current;
      const helper = poseTransformHelperRef.current;
      if (!tc) return;
      if (!entry || !bone) {
        tc.enabled = false;
        if (helper) helper.visible = false;
        tc.detach();
      } else {
        tc.attach(bone);
        tc.enabled = true;
        if (helper) helper.visible = true;
      }
      onBoneSelectRef.current?.(bone?.uuid ?? null);
    }
    selectBoneRef.current = selectBone;

    function resetPose(entry: SculptMeshEntry) {
      if (!entry.skeleton || !entry.bindPose) return;
      for (const bone of entry.skeleton.bones) {
        const orig = entry.bindPose.get(bone.uuid);
        if (!orig) continue;
        bone.position.copy(orig.position);
        bone.quaternion.copy(orig.quaternion);
      }
      updateBoneHandles();
    }
    resetPoseRef.current = resetPose;

    function resetBone(entry: SculptMeshEntry, bone: THREE.Bone) {
      const orig = entry.bindPose?.get(bone.uuid);
      if (!orig) return;
      undoRef.current.pushPose([bone]);
      bone.position.copy(orig.position);
      bone.quaternion.copy(orig.quaternion);
      updateBoneHandles();
    }
    resetBoneRef.current = resetBone;

    // Assembles one bone's worth of per-component channels back into the
    // single vector/quaternion KeyframeTracks three.js actually expects.
    // Linear interpolation only for now — CUBICSPLINE (real tangents) is a
    // later pass once the curve editor exists to author them.
    function buildThreeClip(clip: AnimationClipData): THREE.AnimationClip {
      const boneNames = Array.from(new Set(clip.channels.map((c) => c.boneName)));
      const tracks: THREE.KeyframeTrack[] = [];
      for (const boneName of boneNames) {
        const chans = clip.channels.filter((c) => c.boneName === boneName);
        // Per-bone time union, not global-across-clip — different bones'
        // channels can (in principle, once the curve editor allows
        // independent edits) have different keyframe times.
        const times = Array.from(new Set(chans.flatMap((c) => c.keys.map((k) => k.time)))).sort((a, b) => a - b);
        if (times.length === 0) continue;
        const posX = chans.find((c) => c.property === "position.x");
        const posY = chans.find((c) => c.property === "position.y");
        const posZ = chans.find((c) => c.property === "position.z");
        if (posX && posY && posZ) {
          const values: number[] = [];
          for (const t of times) values.push(sampleChannelLinear(posX, t), sampleChannelLinear(posY, t), sampleChannelLinear(posZ, t));
          tracks.push(new THREE.VectorKeyframeTrack(`${boneName}.position`, times, values, THREE.InterpolateLinear));
        }
        const qx = chans.find((c) => c.property === "quaternion.x");
        const qy = chans.find((c) => c.property === "quaternion.y");
        const qz = chans.find((c) => c.property === "quaternion.z");
        const qw = chans.find((c) => c.property === "quaternion.w");
        if (qx && qy && qz && qw) {
          const values: number[] = [];
          for (const t of times) values.push(sampleChannelLinear(qx, t), sampleChannelLinear(qy, t), sampleChannelLinear(qz, t), sampleChannelLinear(qw, t));
          tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values, THREE.InterpolateLinear));
        }
      }
      return new THREE.AnimationClip(clip.name, clip.duration, tracks);
    }
    buildThreeClipRef.current = buildThreeClip;

    function activeClipForMixer(entry: SculptMeshEntry): AnimationClipData | undefined {
      if (!entry.poseAnimation?.activeClipId) return undefined;
      return findClip(entry.poseAnimation, entry.poseAnimation.activeClipId);
    }

    // Called whenever the active clip's shape changes (clip switch,
    // keyframe insert/remove) — mixer/action are cheap, just rebuilt
    // rather than patched in place.
    function rebuildPoseMixer(entry: SculptMeshEntry) {
      entry.poseMixer?.stopAllAction();
      entry.poseMixer = undefined;
      entry.poseAction = undefined;
      const clip = activeClipForMixer(entry);
      if (!clip || clip.channels.length === 0) {
        // No channels yet (no keyframes inserted) doesn't mean no length —
        // report the clip's actual authored duration so the Length field
        // reflects what setClipLength() just set instead of snapping back
        // to a 1-frame timeline before the first keyframe exists.
        const time = Math.min(entry.poseTime ?? 0, clip?.duration ?? 0);
        entry.poseTime = time;
        onPoseTimeChangeRef.current?.(entry.id, time, clip?.duration ?? 0, false, clip?.frameRate ?? DEFAULT_FRAME_RATE);
        return;
      }
      const threeClip = buildThreeClip(clip);
      const mixer = new THREE.AnimationMixer(entry.mesh);
      const action = mixer.clipAction(threeClip);
      action.play();
      action.paused = true;
      const time = Math.min(entry.poseTime ?? 0, clip.duration);
      action.time = time;
      mixer.update(0);
      entry.poseMixer = mixer;
      entry.poseAction = action;
      entry.poseTime = time;
      updateBoneHandles();
      onPoseTimeChangeRef.current?.(entry.id, time, clip.duration, entry.posePlaying ?? false, clip.frameRate);
    }
    rebuildPoseMixerRef.current = rebuildPoseMixer;

    // Scrubbing: force the mixer to evaluate a specific time without
    // advancing playback — the standard three.js technique (set
    // action.time directly, then update(0)).
    function setPoseTime(entry: SculptMeshEntry, time: number) {
      const clip = activeClipForMixer(entry);
      const clamped = Math.max(0, Math.min(time, clip?.duration ?? time));
      if (!entry.poseAction || !entry.poseMixer) { entry.poseTime = clamped; return; }
      entry.poseAction.time = clamped;
      entry.poseMixer.update(0);
      entry.poseTime = clamped;
      updateBoneHandles();
      onPoseTimeChangeRef.current?.(entry.id, clamped, clip?.duration ?? 0, entry.posePlaying ?? false, clip?.frameRate ?? DEFAULT_FRAME_RATE);
    }
    setPoseTimeRef.current = setPoseTime;

    function setPosePlaying(entry: SculptMeshEntry, playing: boolean) {
      entry.posePlaying = playing;
      if (entry.poseAction) entry.poseAction.paused = !playing;
      const clip = activeClipForMixer(entry);
      onPoseTimeChangeRef.current?.(entry.id, entry.poseTime ?? 0, clip?.duration ?? 0, playing, clip?.frameRate ?? DEFAULT_FRAME_RATE);
    }
    setPosePlayingRef.current = setPosePlaying;

    // Screen-space nearest-handle picking, same technique projectToScreen
    // (below, for mesh vertices) uses, just for a world position directly
    // since a Bone isn't a mesh vertex index.
    function getBoneHitFromEvent(e: PointerEvent): { entry: SculptMeshEntry; bone: THREE.Bone } | null {
      if (boneHandleIndex.length === 0) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      let best: { entry: SculptMeshEntry; bone: THREE.Bone } | null = null;
      let bestDist = 24; // px — generous enough for a small handle dot
      const wp = new THREE.Vector3();
      for (const { entry, bone } of boneHandleIndex) {
        bone.getWorldPosition(wp);
        wp.project(camera);
        const sx = rect.left + (wp.x * 0.5 + 0.5) * rect.width;
        const sy = rect.top + (-wp.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(sx - e.clientX, sy - e.clientY);
        if (d < bestDist) { bestDist = d; best = { entry, bone }; }
      }
      return best;
    }
    getBoneHitFromEventRef.current = getBoneHitFromEvent;

    // Rig-mode joint handles + links — same visual convention as Pose
    // mode's bone handles, just plotting entry.rig?.bones (plain data)
    // instead of entry.skeleton?.bones (real THREE.Bone objects).
    const jointHandleGeo = new THREE.BufferGeometry();
    jointHandleGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const jointHandleMat = new THREE.PointsMaterial({
      color: 0xc47be8, size: 8, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.9,
    });
    const jointHandles = new THREE.Points(jointHandleGeo, jointHandleMat);
    jointHandles.visible = false;
    jointHandles.renderOrder = 999;
    scene.add(jointHandles);
    jointHandlesRef.current = jointHandles;

    const jointLinkGeo = new THREE.BufferGeometry();
    jointLinkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const jointLinkMat = new THREE.LineBasicMaterial({ color: 0xc47be8, depthTest: false, transparent: true, opacity: 0.6 });
    const jointLinks = new THREE.LineSegments(jointLinkGeo, jointLinkMat);
    jointLinks.visible = false;
    jointLinks.renderOrder = 998;
    scene.add(jointLinks);
    jointLinksRef.current = jointLinks;

    // Rig gizmo — synthetic pivot (poly-edit's own pattern; a RigBone is
    // plain data, not a scene-graph object to .attach() to directly the
    // way Pose mode's real THREE.Bone allows).
    const rigGizmoPivot = new THREE.Object3D();
    scene.add(rigGizmoPivot);
    rigGizmoPivotRef.current = rigGizmoPivot;

    const rigTransformControls = new TransformControls(camera, renderer.domElement);
    rigTransformControls.setMode(transformModeRef.current);
    rigTransformControls.enabled = false;
    const rigTransformHelper = rigTransformControls.getHelper();
    rigTransformHelper.visible = false;
    scene.add(rigTransformHelper);
    rigTransformControlsRef.current = rigTransformControls;
    rigTransformHelperRef.current = rigTransformHelper;

    // IK target gizmo — translate-only (a target position is all
    // CCDIKSolver/solveTwoBoneIK read), attaches to a chain's synthetic
    // target bone.
    const ikTransformControls = new TransformControls(camera, renderer.domElement);
    ikTransformControls.setMode("translate");
    ikTransformControls.enabled = false;
    const ikTransformHelper = ikTransformControls.getHelper();
    ikTransformHelper.visible = false;
    scene.add(ikTransformHelper);
    ikTransformControlsRef.current = ikTransformControls;
    ikTransformHelperRef.current = ikTransformHelper;

    // Pole-vector gizmo — same idea, smaller (setSize) so it reads as a
    // secondary handle when both it and the target gizmo are visible on
    // the same chain at once.
    const ikPoleTransformControls = new TransformControls(camera, renderer.domElement);
    ikPoleTransformControls.setMode("translate");
    ikPoleTransformControls.setSize(0.6);
    ikPoleTransformControls.enabled = false;
    const ikPoleTransformHelper = ikPoleTransformControls.getHelper();
    ikPoleTransformHelper.visible = false;
    scene.add(ikPoleTransformHelper);
    ikPoleTransformControlsRef.current = ikPoleTransformControls;
    ikPoleTransformHelperRef.current = ikPoleTransformHelper;

    // Shared by both gizmos' objectChange — resolves the chain's actual
    // root/mid/effector bones and picks the analytic solve (2-link chains
    // with a pole bone) or falls back to the CCD solver otherwise.
    function solveIKChain(entry: SculptMeshEntry, chainId: string) {
      const chain = entry.poseAnimation?.ikChains.find((c) => c.id === chainId);
      const skeleton = entry.skeleton;
      const targetBone = entry.ikTargetBones?.get(chainId);
      const poleBone = entry.ikPoleBones?.get(chainId);
      if (chain && skeleton && targetBone && poleBone && chain.links.length === 2) {
        const midBone = skeleton.bones.find((b) => b.name === chain.links[0]);
        const rootBone = skeleton.bones.find((b) => b.name === chain.links[1]);
        const effectorBone = skeleton.bones.find((b) => b.name === chain.effectorBone);
        if (midBone && rootBone && effectorBone) {
          const targetPos = new THREE.Vector3();
          targetBone.getWorldPosition(targetPos);
          const polePos = new THREE.Vector3();
          poleBone.getWorldPosition(polePos);
          solveTwoBoneIK(rootBone, midBone, effectorBone, targetPos, polePos);
        }
      } else {
        entry.ikSolver?.update();
      }
      updateBoneHandlesRef.current();
    }

    function selectIKChain(entry: SculptMeshEntry | null, chainId: string | null) {
      // Selecting an IK target deselects any manually-selected pose
      // bone/rig joint and vice versa (selectBone does the same) — only
      // one gizmo is ever active at a time. Guarded on chainId (like
      // selectBone guards on bone) so a plain deselect call here
      // doesn't loop back into selectBone's own IK-clearing call.
      if (chainId) {
        selectBoneRef.current(null, null);
        selectJointRef.current(null, null);
      }
      selectedIKEntryRef.current = entry;
      selectedIKChainIdRef.current = chainId;
      const tc = ikTransformControlsRef.current;
      const helper = ikTransformHelperRef.current;
      const poleTc = ikPoleTransformControlsRef.current;
      const poleHelper = ikPoleTransformHelperRef.current;
      if (!tc || !poleTc) return;
      const targetBone = entry && chainId ? entry.ikTargetBones?.get(chainId) : undefined;
      if (!entry || !chainId || !targetBone) {
        tc.enabled = false;
        if (helper) helper.visible = false;
        tc.detach();
      } else {
        tc.attach(targetBone);
        tc.enabled = true;
        if (helper) helper.visible = true;
      }
      // Pole gizmo — shown alongside the target gizmo whenever this chain
      // has a pole bone (every 2-link chain); hidden otherwise, same
      // enable/detach pattern.
      const poleBone = entry && chainId ? entry.ikPoleBones?.get(chainId) : undefined;
      if (!entry || !chainId || !poleBone) {
        poleTc.enabled = false;
        if (poleHelper) poleHelper.visible = false;
        poleTc.detach();
      } else {
        poleTc.attach(poleBone);
        poleTc.enabled = true;
        if (poleHelper) poleHelper.visible = true;
      }
    }
    selectIKChainRef.current = selectIKChain;

    ikTransformControls.addEventListener("dragging-changed", (event) => {
      controls.enabled = !event.value;
    });
    ikTransformControls.addEventListener("objectChange", () => {
      // Solving mutates the actual chain bones' quaternions — the same
      // mechanism manual dragging uses, so the bone-handle overlay and
      // (once a keyframe is inserted) undo/keyframing need no IK-
      // specific handling at all.
      const entry = selectedIKEntryRef.current;
      const chainId = selectedIKChainIdRef.current;
      if (entry && chainId) solveIKChain(entry, chainId);
    });

    ikPoleTransformControls.addEventListener("dragging-changed", (event) => {
      controls.enabled = !event.value;
    });
    ikPoleTransformControls.addEventListener("objectChange", () => {
      const entry = selectedIKEntryRef.current;
      const chainId = selectedIKChainIdRef.current;
      if (entry && chainId) solveIKChain(entry, chainId);
    });

    // World position of every joint across every entry with a `rig`, in
    // the same order as jointHandles' position buffer — same "resolve a
    // click without a real raycast" reasoning as boneHandleIndex above
    // (joint handles are small points, not intersectable geometry).
    let jointHandleIndex: { entry: SculptMeshEntry; bone: RigBone }[] = [];

    function updateJointHandles() {
      const handles = jointHandlesRef.current;
      const links = jointLinksRef.current;
      if (!handles || !links) return;
      const inRigMode = editModeRef.current === "rig";
      const depthTest = !inRigMode && boneViewerModeRef.current === "on";
      jointHandleMat.depthTest = depthTest;
      jointLinkMat.depthTest = depthTest;
      jointHandleIndex = [];
      const positions: number[] = [];
      const linkPositions: number[] = [];
      for (const entry of meshEntriesRef.current) {
        if (!entry.rig) continue;
        for (const bone of entry.rig.bones) {
          jointHandleIndex.push({ entry, bone });
          positions.push(bone.position[0], bone.position[1], bone.position[2]);
          if (bone.parentId) {
            const parent = entry.rig.bones.find((b) => b.id === bone.parentId);
            if (parent) linkPositions.push(parent.position[0], parent.position[1], parent.position[2], bone.position[0], bone.position[1], bone.position[2]);
          }
        }
      }
      handles.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      handles.geometry.attributes.position.needsUpdate = true;
      handles.geometry.computeBoundingSphere();
      // Same reasoning as updateBoneHandles above: joint click-selection
      // (getJointHitFromEvent) picks via screen-space distance over
      // jointHandleIndex, independent of this .visible flag, so the Bone
      // Viewer toggle can hide the dots/lines even while actively rigging.
      handles.visible = boneViewerModeRef.current !== "off" && positions.length > 0;

      links.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(linkPositions), 3));
      links.geometry.attributes.position.needsUpdate = true;
      links.geometry.computeBoundingSphere();
      links.visible = boneViewerModeRef.current !== "off" && linkPositions.length > 0;
    }
    updateJointHandlesRef.current = updateJointHandles;

    function selectJoint(entry: SculptMeshEntry | null, bone: RigBone | null) {
      selectedJointEntryRef.current = entry;
      selectedJointRef.current = bone;
      if (entry?.rig) entry.rig.selectedBoneId = bone?.id ?? null;
      const tc = rigTransformControlsRef.current;
      const pivot = rigGizmoPivotRef.current;
      const helper = rigTransformHelperRef.current;
      if (!tc || !pivot) return;
      if (!entry || !bone) {
        tc.enabled = false;
        if (helper) helper.visible = false;
        tc.detach();
      } else {
        pivot.position.set(bone.position[0], bone.position[1], bone.position[2]);
        pivot.quaternion.identity();
        pivot.scale.set(1, 1, 1);
        pivot.updateMatrixWorld(true);
        tc.attach(pivot);
        tc.enabled = true;
        if (helper) helper.visible = true;
      }
      onJointSelectRef.current?.(bone?.id ?? null);
    }
    selectJointRef.current = selectJoint;

    // Click-to-chain joint placement — no joint selected -> new root at
    // the raycast hit point; a joint selected -> new joint parented to
    // it, which becomes selected, so repeated clicks build a hierarchy
    // in one continuous gesture (same interaction shape as Maya's joint
    // tool / Blender's bone-extrude).
    function createJointAt(entry: SculptMeshEntry, worldPos: THREE.Vector3) {
      if (!entry.rig) entry.rig = { bones: [], selectedBoneId: null };
      const parentId = selectedJointEntryRef.current === entry ? (selectedJointRef.current?.id ?? null) : null;
      const bone = createBone(nextBoneName(entry.rig), parentId, [worldPos.x, worldPos.y, worldPos.z]);
      entry.rig.bones.push(bone);
      updateJointHandles();
      selectJoint(entry, bone);
    }
    createJointAtRef.current = createJointAt;

    function getJointHitFromEvent(e: PointerEvent): { entry: SculptMeshEntry; bone: RigBone } | null {
      if (jointHandleIndex.length === 0) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      let best: { entry: SculptMeshEntry; bone: RigBone } | null = null;
      let bestDist = 24; // px — generous enough for a small handle dot
      const wp = new THREE.Vector3();
      for (const { entry, bone } of jointHandleIndex) {
        wp.set(bone.position[0], bone.position[1], bone.position[2]);
        wp.project(camera);
        const sx = rect.left + (wp.x * 0.5 + 0.5) * rect.width;
        const sy = rect.top + (-wp.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(sx - e.clientX, sy - e.clientY);
        if (d < bestDist) { bestDist = d; best = { entry, bone }; }
      }
      return best;
    }
    getJointHitFromEventRef.current = getJointHitFromEvent;

    // Mask-weighted pivot transform — the actual "isolate + scale" tool.
    // Dragging the rig gizmo does two independent things every frame:
    // (1) keeps the joint's OWN stored position in sync with the pivot
    // (a real move in translate mode; a no-op in rotate/scale, whose
    // pivot position never changes) — a joint marker is meant to be
    // repositionable via its own gizmo, not just at creation time; (2) if
    // the entry has a painted mask, blends each masked vertex between its
    // original world position and the fully-pivot-transformed one by
    // its OWN mask weight (lerp, not a hard threshold) — mask=1 moves
    // fully, mask=0.5 moves halfway, giving a soft ZBrush-Transpose-style
    // falloff at the mask boundary for free, since the mask is already a
    // continuous 0..1 field. Reuses SculptUndoStack (same as poly-edit's
    // own gizmo drag) since this writes real geometry, unlike Pose mode.
    let rigDragEntry: SculptMeshEntry | null = null;
    let rigDragBone: RigBone | null = null;
    let rigDragStartOffsets: Map<number, THREE.Vector3> | null = null;
    let rigDragStartWorld: Map<number, THREE.Vector3> | null = null;
    const _rigWp = new THREE.Vector3();
    const _rigBlend = new THREE.Vector3();

    function beginRigDrag() {
      const entry = selectedJointEntryRef.current;
      const bone = selectedJointRef.current;
      const pivot = rigGizmoPivotRef.current;
      if (!entry || !bone || !pivot) return;
      undoRef.current.push(meshEntriesRef.current.map((e) => e.mesh));
      rigDragEntry = entry;
      rigDragBone = bone;
      rigDragStartOffsets = new Map();
      rigDragStartWorld = new Map();
      resizeMaskToGeometry(entry); // guard against a mask left stale by subdivide/etc since it was painted
      const mask = entry.mask;
      if (mask) {
        const pivotInv = pivot.matrixWorld.clone().invert();
        const positions = entry.mesh.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i++) {
          if (!(mask[i] > 0)) continue;
          _rigWp.fromBufferAttribute(positions, i).applyMatrix4(entry.mesh.matrixWorld);
          rigDragStartWorld.set(i, _rigWp.clone());
          rigDragStartOffsets.set(i, _rigWp.clone().applyMatrix4(pivotInv));
        }
      }
    }

    function applyRigDrag() {
      const pivot = rigGizmoPivotRef.current;
      if (!pivot || !rigDragBone) return;
      rigDragBone.position = [pivot.position.x, pivot.position.y, pivot.position.z];
      updateJointHandles();

      if (!rigDragEntry || !rigDragStartOffsets || !rigDragStartWorld) return;
      const mask = rigDragEntry.mask;
      if (!mask) return;
      const positions = rigDragEntry.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const invMesh = rigDragEntry.mesh.matrixWorld.clone().invert();
      for (const [idx, offset] of rigDragStartOffsets) {
        const original = rigDragStartWorld.get(idx)!;
        _rigWp.copy(offset).applyMatrix4(pivot.matrixWorld);
        _rigBlend.copy(original).lerp(_rigWp, mask[idx]);
        _rigBlend.applyMatrix4(invMesh);
        positions.setXYZ(idx, _rigBlend.x, _rigBlend.y, _rigBlend.z);
      }
      positions.needsUpdate = true;
    }

    function endRigDrag() {
      rigDragEntry?.mesh.geometry.computeVertexNormals();
      rigDragEntry = null;
      rigDragBone = null;
      rigDragStartOffsets = null;
      rigDragStartWorld = null;
    }

    rigTransformControls.addEventListener("dragging-changed", (event) => {
      controls.enabled = !event.value;
      if (event.value) beginRigDrag();
      else endRigDrag();
    });
    rigTransformControls.addEventListener("objectChange", applyRigDrag);

    // Per-vertex offsets (in the pivot's local space at drag start) —
    // recomputed fresh at the start of every drag, so it doesn't matter that
    // the pivot's own rotation/scale keep accumulating across drags (the
    // same way an object's transform accumulates across repeated edits in
    // any DCC tool).
    let dragEntry: SculptMeshEntry | null = null;
    let dragStartOffsets: Map<number, THREE.Vector3> | null = null;
    let dragStartPivotInv: THREE.Matrix4 | null = null;
    // Mirror partners are NOT folded into dragStartOffsets/the pivot-relative
    // group above — a transform uniformly applied to both sides would be
    // wrong (a +X translate must become -X on the mirror side, a rotation
    // must flip handedness, not repeat identically). Instead each mirror
    // vertex keeps its own drag-start WORLD position, and applyGizmoDrag
    // applies a REFLECTED copy of the pivot's own delta transform to it —
    // reflecting a transform across a plane is R * M * R (R = the reflection
    // matrix, its own inverse), a standard construction, verified standalone
    // for translate/rotate/scale before being wired in here.
    let dragStartMirrorOffsets: Map<number, THREE.Vector3> | null = null;
    const _dragWp = new THREE.Vector3();
    const _dragDelta = new THREE.Matrix4();
    const _dragReflected = new THREE.Matrix4();
    const _dragReflectR = new THREE.Matrix4().makeScale(-1, 1, 1);

    function beginGizmoDrag() {
      const entry = selectedEntryRef.current;
      const pivot = gizmoPivotRef.current;
      if (!entry || !pivot) return;
      undoRef.current.push(meshEntriesRef.current.map((e) => e.mesh));
      const idxs = selectionVertexIndices(entry, selectionRef.current, selectModeRef.current);
      const positions = entry.mesh.geometry.attributes.position as THREE.BufferAttribute;
      dragStartPivotInv = pivot.matrixWorld.clone().invert();
      dragStartOffsets = new Map();
      for (const idx of idxs) {
        _dragWp.fromBufferAttribute(positions, idx).applyMatrix4(entry.mesh.matrixWorld).applyMatrix4(dragStartPivotInv);
        dragStartOffsets.set(idx, _dragWp.clone());
      }
      dragEntry = entry;

      dragStartMirrorOffsets = null;
      if (mirrorModeRef.current) {
        const mirrorData = ensureMirror(entry);
        const idxSet = new Set(idxs);
        const map = new Map<number, THREE.Vector3>();
        for (const idx of idxs) {
          const midx = mirrorData.get(idx);
          if (midx === undefined || midx === idx || idxSet.has(midx) || map.has(midx)) continue;
          const wp = new THREE.Vector3().fromBufferAttribute(positions, midx).applyMatrix4(entry.mesh.matrixWorld);
          map.set(midx, wp);
        }
        if (map.size > 0) dragStartMirrorOffsets = map;
      }
    }

    function applyGizmoDrag() {
      const pivot = gizmoPivotRef.current;
      if (!pivot || !dragEntry || !dragStartOffsets) return;
      const positions = dragEntry.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const invMesh = dragEntry.mesh.matrixWorld.clone().invert();
      for (const [idx, offset] of dragStartOffsets) {
        _dragWp.copy(offset).applyMatrix4(pivot.matrixWorld).applyMatrix4(invMesh);
        positions.setXYZ(idx, _dragWp.x, _dragWp.y, _dragWp.z);
      }
      if (dragStartMirrorOffsets && dragStartPivotInv) {
        // World-space delta the pivot has undergone since drag start...
        _dragDelta.multiplyMatrices(pivot.matrixWorld, dragStartPivotInv);
        // ...reflected across X=0 (R * delta * R, R its own inverse) so it's
        // the mirror-consistent version of the same gesture.
        _dragReflected.copy(_dragReflectR).multiply(_dragDelta).multiply(_dragReflectR);
        for (const [midx, startWorld] of dragStartMirrorOffsets) {
          _dragWp.copy(startWorld).applyMatrix4(_dragReflected).applyMatrix4(invMesh);
          positions.setXYZ(midx, _dragWp.x, _dragWp.y, _dragWp.z);
        }
      }
      positions.needsUpdate = true;
      updateSelectionHighlightPointsRef.current();
    }

    function endGizmoDrag() {
      dragEntry?.mesh.geometry.computeVertexNormals();
      dragEntry = null;
      dragStartOffsets = null;
      dragStartPivotInv = null;
      dragStartMirrorOffsets = null;
    }

    transformControls.addEventListener("dragging-changed", (event) => {
      controls.enabled = !event.value;
      if (event.value) beginGizmoDrag();
      else endGizmoDrag();
    });
    transformControls.addEventListener("objectChange", applyGizmoDrag);

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      const aspect = w / h;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      // Kept in sync regardless of which camera is active, so toggling
      // projection never needs its own resize pass.
      orthoCamera.left = -aspect;
      orthoCamera.right = aspect;
      orthoCamera.top = 1;
      orthoCamera.bottom = -1;
      orthoCamera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // Swaps which of camera/orthoCamera is "the" active camera — copies
    // position/orientation across, matches the ortho camera's .zoom to the
    // perspective camera's current apparent size (or vice versa) so the
    // switch doesn't visibly jump, and re-points every control that holds
    // its own camera reference (OrbitControls uses .object; TransformControls
    // — which already has built-in isOrthographicCamera handling for its own
    // gizmo scale — uses .camera).
    function toggleProjection() {
      const active = cameraRef.current!;
      const goingOrtho = active === camera;
      const next: SculptCamera = goingOrtho ? orthoCamera : camera;
      next.position.copy(active.position);
      next.quaternion.copy(active.quaternion);
      const dist = active.position.distanceTo(controls.target);
      if (goingOrtho) {
        const worldHeightAtDist = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
        const orthoHeight = orthoCamera.top - orthoCamera.bottom;
        orthoCamera.zoom = orthoHeight / Math.max(worldHeightAtDist, 1e-6);
      } else {
        camera.zoom = 1;
      }
      next.near = active.near;
      next.far = active.far;
      next.updateProjectionMatrix();
      cameraRef.current = next;
      controls.object = next;
      controls.update();
      transformControls.camera = next;
      poseTransformControls.camera = next;
      rigTransformControls.camera = next;
      onProjectionChangeRef.current?.(goingOrtho);
    }
    toggleProjectionRef.current = toggleProjection;

    let raf = 0;
    let lastTime = performance.now();
    const tick = () => {
      const now = performance.now();
      // Clamp so a backgrounded tab (or a debugger pause) resuming doesn't
      // jump playback forward by however long it was away.
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      let bonesDirty = false;
      for (const entry of meshEntriesRef.current) {
        if (entry.posePlaying && entry.poseMixer && entry.poseAction) {
          entry.poseMixer.update(delta);
          entry.poseTime = entry.poseAction.time;
          bonesDirty = true;
          const clip = entry.poseAnimation?.activeClipId ? findClip(entry.poseAnimation, entry.poseAnimation.activeClipId) : undefined;
          onPoseTimeChangeRef.current?.(entry.id, entry.poseTime, clip?.duration ?? 0, true, clip?.frameRate ?? DEFAULT_FRAME_RATE);
        }
      }
      if (bonesDirty) updateBoneHandlesRef.current();
      controls.update();
      renderer.render(scene, cameraRef.current!);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      transformControls.dispose();
      clayMatcapTexRef.current?.dispose();
      clayMatRef.current?.dispose();
      channelMatsRef.current.forEach(m => m.dispose());
      wireMatRef.current?.dispose();
      edgeHighlightRef.current?.geometry.dispose();
      (edgeHighlightRef.current?.material as THREE.Material | undefined)?.dispose();
      faceHighlightRef.current?.geometry.dispose();
      (faceHighlightRef.current?.material as THREE.Material | undefined)?.dispose();
      ktx2LoaderRef.current?.dispose();
      ktx2LoaderRef.current = null;
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  // ── load / replace model ──────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    if (modelRef.current) {
      scene.remove(modelRef.current);
      modelRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) { m.geometry.boundsTree = undefined; m.geometry.dispose(); }
      });
      modelRef.current = null;
    }
    meshEntriesRef.current = [];
    undoRef.current.clear();
    topoUndoRef.current.clear();
    clearPolyEditSelectionRef.current();
    selectBoneRef.current(null, null);
    selectJointRef.current(null, null);

    if (!glbData) return;

    const loader = new GLTFLoader();
    if (ktx2LoaderRef.current) loader.setKTX2Loader(ktx2LoaderRef.current);
    loader.parse(glbData.slice(0), "", (gltf) => {
      const group = gltf.scene;
      let totalVerts = 0;
      // Multiple SkinnedMesh nodes (e.g. a body + separate modular clothing
      // pieces) commonly share ONE THREE.Skeleton object — confirmed
      // directly against base_female_-_game_ready_-_rigged_-_low_poly.glb
      // (6 skinned parts, 1 shared skeleton). Without this, the per-mesh
      // setup below would run once per PART instead of once per RIG: bind
      // pose snapshotting is merely redundant, but IK/hip detection would
      // create a separate PoseAnimationState (and default clip) per part —
      // duplicating every Bones-list row, Hip/IK Controls button, and
      // bone-handle dot once per part in the UI — and, more seriously,
      // synthetic IK target bones would get pushed into the shared
      // skeleton.bones/boneInverses arrays again on every part, ballooning
      // the one real skeleton by (chain count) extra bones per part. Only
      // the FIRST part encountered for a given skeleton becomes that rig's
      // "owner" (keeps skeleton/bindPose/poseAnimation/ikSolver/
      // ikTargetBones on its entry) — every other part sharing that
      // skeleton is left with none of that on its own entry. This doesn't
      // affect their actual deformation at all: `mesh.skeleton` (three.js's
      // own SkinnedMesh property, set by GLTFLoader) is untouched either
      // way, so posing bones via the owner's entry still visually deforms
      // every sibling part through the normal skinning pipeline.
      const processedSkeletons = new Set<THREE.Skeleton>();

      if (!wireMatRef.current) {
        wireMatRef.current = new THREE.LineBasicMaterial({
          // depthTest:true so wire on the FAR side of the mesh (behind the
          // near surface) is correctly occluded instead of bleeding through
          // — the near-side wire sits at the exact same depth as the solid
          // surface beneath it (same vertices, same camera), so it still
          // passes the default LEQUAL depth test and draws on top normally.
          // depthWrite:false so this decorative overlay doesn't affect what
          // subsequent draws (e.g. the selection-highlight points) see.
          color: wireColorFor(viewModeRef.current), transparent: true, opacity: WIRE_OPACITY, depthTest: true, depthWrite: false, linewidth: 2,
        });
      }

      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;

        // Extract positions via getX/getY/getZ so interleaved buffers (common in
        // GLTFLoader output) are handled correctly. pos.array for an interleaved
        // attribute is the full shared buffer — copying it raw and treating it as
        // itemSize=3 scrambles every vertex after the first.
        const posAttr = mesh.geometry.attributes.position;
        const vCount = posAttr.count;
        const posData = new Float32Array(vCount * 3);
        for (let i = 0; i < vCount; i++) {
          posData[i * 3]     = posAttr.getX(i);
          posData[i * 3 + 1] = posAttr.getY(i);
          posData[i * 3 + 2] = posAttr.getZ(i);
        }
        mesh.geometry.setAttribute("position", new THREE.BufferAttribute(posData, 3));

        // GLBs commonly ship with baked normals — only compute if genuinely
        // absent (e.g. no NORMAL accessor), so authored normals aren't
        // silently overwritten. Missing normals otherwise read as (0,0,0) in
        // Clay mode's unlit matcap material, producing flat, gradient-less shading.
        if (!mesh.geometry.attributes.normal) {
          mesh.geometry.computeVertexNormals();
        }

        // Ensure indexed for BVH (use vertex count, not raw array length)
        if (!mesh.geometry.index) {
          const idx = new Uint32Array(vCount);
          for (let i = 0; i < vCount; i++) idx[i] = i;
          mesh.geometry.setIndex(new THREE.BufferAttribute(idx, 1));
        }

        mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);

        const posArr = mesh.geometry.attributes.position.array as Float32Array;
        const seams = buildSeamData(posArr);
        const baseEdgeLen = computeAvgEdgeLen(mesh.geometry);
        // Build paint canvas — getContext("2d") can return null in some environments.
        // Skip drawImage seeding (CORS taints canvas); always use a flat grey base.
        let paintEntry: Partial<SculptMeshEntry> = {};
        try {
          const pc = document.createElement("canvas"); pc.width = pc.height = PAINT_TEX_SIZE;
          const pCtx = pc.getContext("2d");
          if (pCtx) {
            pCtx.fillStyle = "#888888"; pCtx.fillRect(0, 0, PAINT_TEX_SIZE, PAINT_TEX_SIZE);
            const pt = new THREE.CanvasTexture(pc); pt.colorSpace = THREE.SRGBColorSpace;
            const pm = new THREE.MeshBasicMaterial({ map: pt });
            paintEntry = { paintCanvas: pc, paintTexture: pt, paintMat: pm };
          }
        } catch { /* canvas context unavailable */ }
        const quadIndices = detectQuads(mesh.geometry);
        const entryName = mesh.name || (meshEntriesRef.current.length === 0 ? "Original" : `Mesh ${meshEntriesRef.current.length + 1}`);
        // Rigged import (e.g. AccuRIG): confirmed directly that nothing
        // above strips skinIndex/skinWeight/skeleton — GLTFLoader's own
        // SkinnedMesh survives this loop untouched. Just keep a
        // convenience reference for Pose mode, and snapshot the bind pose
        // (before any posing edits) so Reset Pose has something to
        // restore to.
        let skeletonEntry: Partial<SculptMeshEntry> = {};
        const skinned = mesh as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh && skinned.skeleton && processedSkeletons.has(skinned.skeleton)) {
          // An earlier part already became this exact skeleton's "owner"
          // (see the note above totalVerts) — this part stays a plain
          // geometry entry with no pose-editing surface of its own; it
          // still deforms correctly since mesh.skeleton (three.js's own
          // property) is untouched.
        } else if (skinned.isSkinnedMesh && skinned.skeleton) {
          const bindPose = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
          for (const bone of skinned.skeleton.bones) {
            bindPose.set(bone.uuid, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
          }
          // Auto-detect leg/arm IK chains + a hip/COG control from bone
          // naming — a skeleton matching neither known convention just
          // gets none of these, no crash, manual posing is unaffected.
          const boneNames = skinned.skeleton.bones.map((b) => b.name);
          const { ikChains, hipBoneName } = detectBipedControls(boneNames);
          const poseAnimation = createPoseAnimationState();
          poseAnimation.ikChains = ikChains;
          poseAnimation.hipBoneName = hipBoneName;
          // A timeline with a real range exists the moment a rigged
          // character loads — matching Maya/Blender, where "create a
          // clip" isn't a step the user has to think about before the
          // Length field/scrubber/keyframing become usable. "+ New Clip"
          // in the UI is for adding ADDITIONAL clips beyond this one.
          createClip(poseAnimation);

          // One synthetic, unskinned target bone per detected chain —
          // CCDIKSolver's `target` must be a real bone INDEX in
          // skeleton.bones (confirmed by reading its source), so a
          // free-floating Object3D can't be used directly. Each target
          // starts exactly at its effector's current world position so
          // grabbing it doesn't snap the limb before it's even dragged.
          const ikTargetBones = new Map<string, THREE.Bone>();
          for (const chain of ikChains) {
            const effectorBone = skinned.skeleton.bones.find((b) => b.name === chain.effectorBone);
            if (!effectorBone) continue;
            effectorBone.updateWorldMatrix(true, false);
            const worldPos = new THREE.Vector3();
            effectorBone.getWorldPosition(worldPos);
            const targetBone = new THREE.Bone();
            targetBone.name = `__ikTarget_${chain.id}`;
            targetBone.position.copy(worldPos);
            scene.add(targetBone);
            targetBone.updateMatrixWorld(true);
            skinned.skeleton.bones.push(targetBone);
            skinned.skeleton.boneInverses.push(new THREE.Matrix4());
            ikTargetBones.set(chain.id, targetBone);
          }

          // A second synthetic bone per 2-link chain (every leg/arm chain
          // this project's convention produces) for pole-vector bend
          // control — CCDIKSolver has no pole-vector concept at all, so
          // these chains are solved analytically instead (solveTwoBoneIK,
          // below) and excluded from the CCD `iks` array entirely rather
          // than fighting it. Default position: offset outward from the
          // mid joint (knee/elbow) along whichever way it's ALREADY bent
          // in the bind pose, so the pole starts somewhere sane (roughly
          // in front of a knee / behind an elbow) instead of at the origin.
          const ikPoleBones = new Map<string, THREE.Bone>();
          for (const chain of ikChains) {
            if (chain.links.length !== 2) continue;
            const midBone = skinned.skeleton.bones.find((b) => b.name === chain.links[0]);
            const rootBone = skinned.skeleton.bones.find((b) => b.name === chain.links[1]);
            const effectorBone = skinned.skeleton.bones.find((b) => b.name === chain.effectorBone);
            if (!midBone || !rootBone || !effectorBone) continue;
            midBone.updateWorldMatrix(true, false);
            rootBone.updateWorldMatrix(true, false);
            effectorBone.updateWorldMatrix(true, false);
            const rootPos = new THREE.Vector3();
            rootBone.getWorldPosition(rootPos);
            const midPos = new THREE.Vector3();
            midBone.getWorldPosition(midPos);
            const effectorPos = new THREE.Vector3();
            effectorBone.getWorldPosition(effectorPos);

            const axis = effectorPos.clone().sub(rootPos);
            const len1 = rootPos.distanceTo(midPos);
            if (axis.lengthSq() < 1e-10 || len1 < 1e-6) continue; // degenerate rig proportions — skip this chain's pole
            axis.normalize();
            const toMid = midPos.clone().sub(rootPos);
            const bendDir = toMid.clone().sub(axis.clone().multiplyScalar(toMid.dot(axis)));
            if (bendDir.lengthSq() < 1e-8) {
              // Bind pose is dead-straight (root/mid/effector colinear) —
              // no bend direction to read from geometry, so fall back to a
              // deterministic perpendicular rather than leaving the pole
              // at a NaN/zero-length offset.
              bendDir.crossVectors(axis, new THREE.Vector3(0, 1, 0));
              if (bendDir.lengthSq() < 1e-8) bendDir.crossVectors(axis, new THREE.Vector3(0, 0, 1));
            }
            bendDir.normalize();

            const poleBone = new THREE.Bone();
            poleBone.name = `__ikPole_${chain.id}`;
            poleBone.position.copy(midPos).addScaledVector(bendDir, len1 * 1.5);
            scene.add(poleBone);
            poleBone.updateMatrixWorld(true);
            skinned.skeleton.bones.push(poleBone);
            skinned.skeleton.boneInverses.push(new THREE.Matrix4());
            ikPoleBones.set(chain.id, poleBone);
          }

          const iks = ikChains
            .filter((chain) => chain.links.length !== 2) // 2-link chains are solved analytically (solveTwoBoneIK) instead, so they don't fight CCD
            .map((chain) => {
              const targetBone = ikTargetBones.get(chain.id);
              const targetIndex = targetBone ? skinned.skeleton.bones.indexOf(targetBone) : -1;
              const effectorIndex = skinned.skeleton.bones.findIndex((b) => b.name === chain.effectorBone);
              const links = chain.links.map((name) => ({ index: skinned.skeleton.bones.findIndex((b) => b.name === name) }));
              return { target: targetIndex, effector: effectorIndex, links };
            })
            .filter((ik) => ik.target >= 0 && ik.effector >= 0 && ik.links.every((l) => l.index >= 0));
          const ikSolver = iks.length > 0 ? new CCDIKSolver(skinned, iks) : undefined;

          skeletonEntry = { skeleton: skinned.skeleton, bindPose, poseAnimation, ikSolver, ikTargetBones, ikPoleBones };
          processedSkeletons.add(skinned.skeleton);
        }
        meshEntriesRef.current.push({ id: crypto.randomUUID(), name: entryName, mesh, seams, baseEdgeLen, quadIndices, ...paintEntry, ...skeletonEntry });
        totalVerts += mesh.geometry.attributes.position.count;

        // Wireframe overlay — excluded from GLB export, hidden by default
        const wire = buildWireOverlay(mesh.geometry, wireMatRef.current!);
        wire.visible = false;
        mesh.add(wire);
      });

      // Frame model
      frameCameraOnObject(group, camera, controls, { recenterObject: true });

      scene.add(group);
      modelRef.current = group;
      originalMaterialsRef.current.clear();
      channelMatsRef.current.forEach(m => m.dispose());
      channelMatsRef.current = [];

      // Store all original GLTF materials before any view override
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.name !== "__wire") {
          originalMaterialsRef.current.set(m.uuid, m.material);
        }
      });

      // Apply whichever view mode is currently active
      applyViewToGroup(group, scene, viewModeRef.current, clayColorRef.current);

      // Refresh pose-mode bone handles in case a new GLB loaded while
      // already in pose mode (a no-op, correctly hidden, if it's not).
      updateBoneHandlesRef.current();
      updateJointHandlesRef.current();

      // Build the mixer for each entry's freshly auto-created default
      // clip immediately, so onPoseTimeChange fires with the real
      // length/fps right away — the timeline UI shouldn't show a
      // stale/zeroed duration until the user happens to trigger some
      // other action first.
      for (const entry of meshEntriesRef.current) {
        if (entry.poseAnimation) rebuildPoseMixerRef.current(entry);
      }

      onModelLoadedRef.current?.(totalVerts);
    }, (err) => {
      console.error("[SculptViewer] GLB parse error", err);
      onLoadErrorRef.current?.(err instanceof Error ? err.message : "Could not load model.");
    });
  }, [glbData]);

  // ── pointer events ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current || !rendererRef.current) return;
    const mount: HTMLDivElement = mountRef.current;
    const renderer = rendererRef.current;

    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    const ndc = new THREE.Vector2();

    // Shared by getHitFromEvent (sculpt brushes) and getElementHitFromEvent
    // (poly-edit picking) so there's one raycast-over-all-meshes loop, not
    // two — both just interpret the same three.js Intersection differently.
    function raycastMeshes(e: PointerEvent): THREE.Intersection | null {
      const rect = renderer!.domElement.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, cameraRef.current!);

      let nearest: THREE.Intersection | null = null;
      for (const { mesh } of meshEntriesRef.current) {
        const hits = raycaster.intersectObject(mesh, false);
        if (hits.length && (!nearest || hits[0].distance < nearest.distance)) {
          nearest = hits[0];
        }
      }
      return nearest;
    }

    function getHitFromEvent(e: PointerEvent): BrushHit | null {
      const nearest = raycastMeshes(e);
      if (!nearest || !nearest.face) return null;

      const normal = nearest.face.normal.clone()
        .transformDirection(nearest.object.matrixWorld)
        .normalize();
      lastUVRef.current = nearest.uv ? { uv: nearest.uv.clone(), mesh: nearest.object as THREE.Mesh } : null;
      return { point: nearest.point.clone(), normal };
    }

    // ── Box-select mask overlay (Ctrl+drag on mesh in Mask mode) ─────────────
    // A plain absolutely-positioned DOM rectangle, not a Three.js object —
    // simplest way to draw UI chrome on top of the WebGL canvas, matching
    // this file's existing "imperative DOM, no React re-render" convention.
    function ensureBoxOverlay(): HTMLDivElement {
      let el = boxSelectOverlayRef.current;
      if (!el) {
        // `mount` (the SculptViewer root div) has no explicit `position` of
        // its own (just w-full h-full) — without this, the overlay's
        // `position: absolute` below would resolve against whatever
        // ancestor further up happens to be positioned, not against
        // `mount`'s own bounding rect, which is what updateBoxOverlay's
        // math assumes.
        mount.style.position = "relative";
        el = document.createElement("div");
        el.style.position = "absolute";
        el.style.border = "1px dashed #8aa0b4";
        el.style.background = "rgba(138,160,180,0.15)";
        el.style.pointerEvents = "none";
        el.style.display = "none";
        el.style.zIndex = "5";
        mount.appendChild(el);
        boxSelectOverlayRef.current = el;
      }
      return el;
    }
    function updateBoxOverlay(x0: number, y0: number, x1: number, y1: number) {
      const el = ensureBoxOverlay();
      const rect = mount.getBoundingClientRect();
      const left = Math.min(x0, x1) - rect.left, top = Math.min(y0, y1) - rect.top;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.width = `${Math.abs(x1 - x0)}px`;
      el.style.height = `${Math.abs(y1 - y0)}px`;
      el.style.display = "block";
    }
    function hideBoxOverlay() {
      if (boxSelectOverlayRef.current) boxSelectOverlayRef.current.style.display = "none";
    }
    /** Client-pixel rect (as tracked by the overlay above) -> NDC min/max, using the same rect basis raycastMeshes uses. */
    function clientRectToNdc(x0: number, y0: number, x1: number, y1: number): { min: { x: number; y: number }; max: { x: number; y: number } } {
      const rect = renderer!.domElement.getBoundingClientRect();
      const toNdc = (cx: number, cy: number) => ({
        x: ((cx - rect.left) / rect.width) * 2 - 1,
        y: -((cy - rect.top) / rect.height) * 2 + 1,
      });
      const p0 = toNdc(x0, y0), p1 = toNdc(x1, y1);
      return {
        min: { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y) },
        max: { x: Math.max(p0.x, p1.x), y: Math.max(p0.y, p1.y) },
      };
    }
    /** Single client-pixel point -> NDC, same basis as clientRectToNdc above. */
    function clientPointToNdc(cx: number, cy: number): { x: number; y: number } {
      const rect = renderer!.domElement.getBoundingClientRect();
      return { x: ((cx - rect.left) / rect.width) * 2 - 1, y: -((cy - rect.top) / rect.height) * 2 + 1 };
    }

    // ── Lasso-select overlay (Ctrl+drag in poly_edit, Lasso tool) ─────────────
    // An SVG polygon rather than a plain <div> (updateBoxOverlay's approach)
    // since a freeform loop isn't expressible as a CSS box — same "plain DOM,
    // no Three.js object" convention otherwise.
    function ensureLassoOverlay(): SVGSVGElement {
      let el = lassoOverlayRef.current;
      if (!el) {
        mount.style.position = "relative";
        el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        el.style.position = "absolute";
        el.style.left = "0";
        el.style.top = "0";
        el.style.width = "100%";
        el.style.height = "100%";
        el.style.pointerEvents = "none";
        el.style.display = "none";
        el.style.zIndex = "5";
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("fill", "rgba(138,160,180,0.15)");
        poly.setAttribute("stroke", "#8aa0b4");
        poly.setAttribute("stroke-dasharray", "4 3");
        poly.setAttribute("stroke-width", "1.5");
        el.appendChild(poly);
        mount.appendChild(el);
        lassoOverlayRef.current = el;
      }
      return el;
    }
    function updateLassoOverlay(points: Array<{ x: number; y: number }>) {
      const el = ensureLassoOverlay();
      const rect = mount.getBoundingClientRect();
      const poly = el.firstElementChild as SVGPolygonElement;
      poly.setAttribute("points", points.map((p) => `${p.x - rect.left},${p.y - rect.top}`).join(" "));
      el.style.display = "block";
    }
    function hideLassoOverlay() {
      if (lassoOverlayRef.current) lassoOverlayRef.current.style.display = "none";
    }

    // ── Ortho-view-snap (Ctrl+drag starting in empty space) ──────────────────
    // ZBrush-style: same Ctrl modifier as box-select above, disambiguated by
    // where the drag starts (empty space here, on-mesh for box-select) —
    // independent of brush mode, since this is camera behavior, not a tool.
    function angleDiff(a: number, b: number): number {
      let d = (a - b) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return Math.abs(d);
    }
    const ORTHO_SNAP_THRESHOLD = THREE.MathUtils.degToRad(8);
    function maybeSnapToOrthoView() {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls) return;
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      const HALF_PI = Math.PI / 2;
      const thetaSnap = Math.round(spherical.theta / HALF_PI) * HALF_PI;
      const phiSnap = Math.round(spherical.phi / HALF_PI) * HALF_PI;
      const withinTheta = angleDiff(spherical.theta, thetaSnap) < ORTHO_SNAP_THRESHOLD;
      const withinPhi = angleDiff(spherical.phi, phiSnap) < ORTHO_SNAP_THRESHOLD;
      if (!withinTheta && !withinPhi) return;
      if (withinTheta) spherical.theta = thetaSnap;
      // Clamped away from the poles — phi = 0/PI exactly is a degenerate
      // lookAt (camera directly above/below target, undefined "up" twist).
      if (withinPhi) spherical.phi = THREE.MathUtils.clamp(phiSnap, 0.02, Math.PI - 0.02);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      camera.lookAt(controls.target);
      controls.update();
    }

    // Poly-edit picking. Unlike getHitFromEvent above, this keeps the exact
    // hit triangle's identity (nearest.faceIndex/face.a/b/c) instead of
    // collapsing to just a world point — three.js already computes these
    // for every mesh raycast, getHitFromEvent just never needed them.
    function projectToScreen(mesh: THREE.Mesh, vertexIndex: number, rect: DOMRect): { x: number; y: number } {
      const positions = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const p = new THREE.Vector3().fromBufferAttribute(positions, vertexIndex).applyMatrix4(mesh.matrixWorld);
      p.project(cameraRef.current!);
      return { x: rect.left + (p.x * 0.5 + 0.5) * rect.width, y: rect.top + (-p.y * 0.5 + 0.5) * rect.height };
    }
    function pointToSegmentDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
      const dx = x1 - x0, dy = y1 - y0;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? ((px - x0) * dx + (py - y0) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
    }

    function getElementHitFromEvent(e: PointerEvent): PolyEditHit | null {
      const nearest = raycastMeshes(e);
      if (!nearest || !nearest.face || nearest.faceIndex == null) return null;
      const mesh = nearest.object as THREE.Mesh;
      const entry = meshEntriesRef.current.find((en) => en.mesh === mesh);
      if (!entry) return null;

      const { a, b, c } = nearest.face;
      const rect = renderer!.domElement.getBoundingClientRect();
      const corners = [a, b, c];
      const screenPts = corners.map((v) => projectToScreen(mesh, v, rect));

      let vertex = corners[0], bestVertDist = Infinity;
      for (let i = 0; i < corners.length; i++) {
        const d = Math.hypot(screenPts[i].x - e.clientX, screenPts[i].y - e.clientY);
        if (d < bestVertDist) { bestVertDist = d; vertex = corners[i]; }
      }

      const edgeCandidates: Array<{ v0: number; v1: number; i0: number; i1: number }> = [
        { v0: a, v1: b, i0: 0, i1: 1 }, { v0: b, v1: c, i0: 1, i1: 2 }, { v0: c, v1: a, i0: 2, i1: 0 },
      ];
      let edge = { v0: a, v1: b }, bestEdgeDist = Infinity;
      for (const cand of edgeCandidates) {
        const p0 = screenPts[cand.i0], p1 = screenPts[cand.i1];
        const d = pointToSegmentDist(e.clientX, e.clientY, p0.x, p0.y, p1.x, p1.y);
        if (d < bestEdgeDist) { bestEdgeDist = d; edge = { v0: cand.v0, v1: cand.v1 }; }
      }

      const triIndex = nearest.faceIndex;
      const quadIndex = entry.topology?.triToQuad.get(triIndex);
      const face: PolyEditHit["face"] = quadIndex !== undefined
        ? { kind: "quad", quadIndex, verts: entry.topology!.quadCorners[quadIndex] }
        : { kind: "tri", triIndex, verts: [a, b, c] };

      return { entry, triIndex, vertex, edge, face, worldPoint: nearest.point.clone() };
    }

    function updateIndicator(hit: BrushHit | null) {
      const ring = brushIndicatorRef.current;
      const innerRing = brushInnerIndicatorRef.current;
      if (!ring) return;
      if (!hit) {
        ring.visible = false;
        if (innerRing) innerRing.visible = false;
        return;
      }
      const r = brushRadiusRef.current;
      const ir = brushInnerRadiusRef.current;
      const normal = hit.normal;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

      ring.visible = true;
      ring.scale.setScalar(r);
      ring.position.copy(hit.point);
      ring.quaternion.copy(q);

      if (innerRing) {
        innerRing.visible = ir > 0.01;
        if (ir > 0.01) {
          innerRing.scale.setScalar(r * ir);
          innerRing.position.copy(hit.point);
          innerRing.quaternion.copy(q);
        }
      }

      const mirrorDot = mirrorIndicatorRef.current;
      if (mirrorDot) {
        mirrorDot.visible = mirrorModeRef.current;
        if (mirrorModeRef.current) {
          // Reflects the WORLD-space hit point across X=0 — a simple,
          // cheap approximation for visualization only (meshes in this
          // tool are always loaded centered at the origin, so world and
          // local X=0 coincide in practice). Actual edits use the real
          // per-vertex mirror pairs (lib/sculpt/mirror.ts), not this.
          mirrorDot.position.set(-hit.point.x, hit.point.y, hit.point.z);
          mirrorDot.scale.setScalar(Math.max(r * 0.12, 0.01));
        }
      }
    }

    // Highlights every vertex the active brush would actually touch on the
    // next stroke sample — same gatherVertices()+expandSeams() call the
    // brush itself uses (brushes.ts), so the highlight can't drift from
    // real behavior. Paint mode doesn't displace vertices, so it's skipped.
    function updateHighlightPoints(hit: BrushHit | null) {
      const points = highlightPointsRef.current;
      if (!points) return;
      if (!hit || brushModeRef.current === "paint" || highlightModeRef.current === "none") {
        points.visible = false;
        return;
      }
      const r = brushRadiusRef.current;
      const ir = brushInnerRadiusRef.current;
      const showCenterOnly = highlightModeRef.current === "center";
      const world: number[] = [];
      for (const entry of meshEntriesRef.current) {
        const positions = entry.mesh.geometry.attributes.position as THREE.BufferAttribute;
        const gathered = gatherVertices(positions, entry.mesh, hit.point, r, ir);
        if (gathered.length === 0) continue;
        // "center" mode: only the single closest-to-hit vertex (highest
        // falloff — the exact same falloff applyBrush itself computes, so
        // this can't drift from what a stroke would actually touch most).
        const idxSource = showCenterOnly
          ? [gathered.reduce((best, g) => (g.fo > best.fo ? g : best))]
          : gathered;
        const allIdx = expandSeams(idxSource.map((g) => g.idx), entry.seams);
        const mat = entry.mesh.matrixWorld;
        const wp = new THREE.Vector3();
        for (const idx of allIdx) {
          wp.fromBufferAttribute(positions, idx).applyMatrix4(mat);
          world.push(wp.x, wp.y, wp.z);
        }
      }
      if (world.length === 0) {
        points.visible = false;
        return;
      }
      points.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(world), 3));
      points.geometry.attributes.position.needsUpdate = true;
      points.geometry.computeBoundingSphere();
      points.visible = true;
    }

    // ── poly-edit selection ───────────────────────────────────────────────────
    // Renders the current poly-edit selection onto the same shared overlay
    // updateHighlightPoints() above uses for brush-radius hover — the two
    // never run at once since sculpt and poly-edit are mutually exclusive.
    function updateSelectionHighlightPoints() {
      const points = highlightPointsRef.current;
      const edgeHi = edgeHighlightRef.current;
      const faceHi = faceHighlightRef.current;
      if (!points || !edgeHi || !faceHi) return;
      const entry = selectedEntryRef.current;
      const mode = selectModeRef.current;
      if (!entry || selectionRef.current.size === 0) {
        points.visible = false;
        edgeHi.visible = false;
        faceHi.visible = false;
        return;
      }

      const positions = entry.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const mat = entry.mesh.matrixWorld;
      const wp = new THREE.Vector3();
      const worldOf = (idx: number): [number, number, number] => {
        wp.fromBufferAttribute(positions, idx).applyMatrix4(mat);
        return [wp.x, wp.y, wp.z];
      };

      // Edge/face selections get their own real shape (a line, a fill) —
      // dots would only show disconnected corners with no sense of which
      // ones belong together or what area's actually selected. Vertex mode
      // keeps the dots, the correct visual for isolated points.
      if (mode === "edge") {
        points.visible = false;
        faceHi.visible = false;
        const world: number[] = [];
        for (const key of selectionRef.current) {
          const [a, b] = key.split("_").map(Number);
          world.push(...worldOf(a), ...worldOf(b));
          if (mirrorModeRef.current && entry.mirror) {
            const ma = entry.mirror.get(a), mb = entry.mirror.get(b);
            if (ma !== undefined && mb !== undefined && ma !== a && mb !== b) {
              world.push(...worldOf(ma), ...worldOf(mb));
            }
          }
        }
        edgeHi.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(world), 3));
        edgeHi.geometry.attributes.position.needsUpdate = true;
        edgeHi.geometry.computeBoundingSphere();
        edgeHi.visible = world.length > 0;
      } else if (mode === "face") {
        points.visible = false;
        edgeHi.visible = false;
        const world: number[] = [];
        const pushFan = (ring: number[]) => {
          for (let i = 1; i < ring.length - 1; i++) {
            world.push(...worldOf(ring[0]), ...worldOf(ring[i]), ...worldOf(ring[i + 1]));
          }
        };
        for (const face of resolveSelectedFaces(entry, selectionRef.current)) {
          pushFan(face.ring);
          if (mirrorModeRef.current && entry.mirror) {
            const mirrored = face.ring.map((v) => entry.mirror!.get(v));
            if (mirrored.every((v): v is number => v !== undefined) && !mirrored.every((v, i) => v === face.ring[i])) {
              pushFan(mirrored);
            }
          }
        }
        faceHi.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(world), 3));
        faceHi.geometry.attributes.position.needsUpdate = true;
        faceHi.geometry.computeBoundingSphere();
        faceHi.visible = world.length > 0;
      } else {
        edgeHi.visible = false;
        faceHi.visible = false;
        const idxs = selectionVertexIndices(entry, selectionRef.current, mode, mirrorModeRef.current);
        const world: number[] = [];
        for (const idx of idxs) world.push(...worldOf(idx));
        points.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(world), 3));
        points.geometry.attributes.position.needsUpdate = true;
        points.geometry.computeBoundingSphere();
        points.visible = true;
      }
    }
    updateSelectionHighlightPointsRef.current = updateSelectionHighlightPoints;

    // Recenters the transform gizmo on the selection's centroid, or hides it
    // when the selection is empty. Rotation/scale reset to identity — pivot
    // orientation is always world-aligned, a stated V1 simplification.
    function repositionGizmoToSelection() {
      const pivot = gizmoPivotRef.current;
      const tc = transformControlsRef.current;
      const helper = transformHelperRef.current;
      if (!pivot || !tc) return;
      const entry = selectedEntryRef.current;
      if (!entry || selectionRef.current.size === 0) {
        tc.enabled = false;
        if (helper) helper.visible = false;
        tc.detach();
        return;
      }
      const idxs = selectionVertexIndices(entry, selectionRef.current, selectModeRef.current);
      const positions = entry.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const mat = entry.mesh.matrixWorld;
      const wp = new THREE.Vector3();
      const centroid = new THREE.Vector3();
      for (const idx of idxs) {
        wp.fromBufferAttribute(positions, idx).applyMatrix4(mat);
        centroid.add(wp);
      }
      centroid.divideScalar(idxs.length || 1);
      pivot.position.copy(centroid);
      pivot.quaternion.identity();
      pivot.scale.set(1, 1, 1);
      pivot.updateMatrixWorld(true);
      tc.attach(pivot);
      tc.enabled = true;
      if (helper) helper.visible = true;
    }
    repositionGizmoToSelectionRef.current = repositionGizmoToSelection;

    // Fires both selection-count and (when in edge mode) loop-preview
    // callbacks from the one place selection actually changes — keeps the
    // parent's loop-preview UI event-sourced instead of needing to poll a
    // ref during render (disallowed under this project's lint rules).
    function notifySelectionChange() {
      onSelectionChangeRef.current?.(selectionRef.current.size);
      const entry = selectedEntryRef.current;
      if (selectModeRef.current === "edge" && entry && selectionRef.current.size > 0) {
        const loop = resolveSeedLoop(entry, selectionRef.current);
        onLoopPreviewRef.current?.(loop ? { edgeCount: loop.edges.length, boundary: loop.boundary, closed: loop.closed } : null);
      } else {
        onLoopPreviewRef.current?.(null);
      }
    }

    function clearPolyEditSelection() {
      selectionRef.current.clear();
      selectedEntryRef.current = null;
      updateSelectionHighlightPoints();
      repositionGizmoToSelection();
      notifySelectionChange();
    }
    clearPolyEditSelectionRef.current = clearPolyEditSelection;

    function setPolyEditSelection(entry: SculptMeshEntry, keys: string[]) {
      selectedEntryRef.current = entry;
      selectionRef.current = new Set(keys);
      updateSelectionHighlightPoints();
      repositionGizmoToSelection();
      notifySelectionChange();
    }
    setPolyEditSelectionRef.current = setPolyEditSelection;

    // Click replaces the selection; shift-click toggles a single element in
    // or out. Clicking a different mesh entry starts a fresh selection on it
    // (selection is scoped to one entry at a time — documented limitation).
    function applyPolyEditSelection(hit: PolyEditHit | null, shift: boolean) {
      if (!hit) {
        if (!shift) { selectionRef.current.clear(); selectedEntryRef.current = null; }
      } else {
        const key = keyForHit(hit, selectModeRef.current);
        if (!shift || selectedEntryRef.current !== hit.entry) {
          selectedEntryRef.current = hit.entry;
          selectionRef.current = new Set([key]);
        } else if (selectionRef.current.has(key)) {
          selectionRef.current.delete(key);
        } else {
          selectionRef.current.add(key);
        }
      }
      updateSelectionHighlightPoints();
      repositionGizmoToSelection();
      notifySelectionChange();
    }

    // Resolves every vertex/edge/face key touched by a drag-region
    // (box or lasso) select — same key formats keyForHit produces
    // (v{i}, {min}_{max}, q{i}/t{i}), built from gatherVerticesInRegion's
    // raw (non seam-expanded) vertex list, same as click-select's own
    // keys aren't seam-expanded until selectionVertexIndices resolves
    // them later.
    function resolveRegionSelection(
      entry: SculptMeshEntry,
      camera: THREE.Camera,
      inRegion: (ndcX: number, ndcY: number) => boolean,
      mode: SelectMode,
    ): string[] {
      const gathered = gatherVerticesInRegion(entry.mesh, camera, inRegion);
      if (gathered.length === 0) return [];
      const gatheredSet = new Set(gathered);

      if (mode === "vertex") return gathered.map((i) => `v${i}`);

      const index = entry.mesh.geometry.index;
      if (!index) return [];
      const triCount = index.count / 3;
      const keys = new Set<string>();

      if (mode === "edge") {
        for (let ti = 0; ti < triCount; ti++) {
          const a = index.getX(ti * 3), b = index.getX(ti * 3 + 1), c = index.getX(ti * 3 + 2);
          for (const [v0, v1] of [[a, b], [b, c], [c, a]] as const) {
            if (gatheredSet.has(v0) && gatheredSet.has(v1)) keys.add(`${Math.min(v0, v1)}_${Math.max(v0, v1)}`);
          }
        }
      } else {
        const consideredQuads = new Set<number>();
        for (let ti = 0; ti < triCount; ti++) {
          const quadIdx = entry.topology?.triToQuad.get(ti);
          if (quadIdx !== undefined) {
            if (consideredQuads.has(quadIdx)) continue;
            consideredQuads.add(quadIdx);
            const corners = entry.topology!.quadCorners[quadIdx];
            if (corners.every((v) => gatheredSet.has(v))) keys.add(`q${quadIdx}`);
          } else {
            const a = index.getX(ti * 3), b = index.getX(ti * 3 + 1), c = index.getX(ti * 3 + 2);
            if (gatheredSet.has(a) && gatheredSet.has(b) && gatheredSet.has(c)) keys.add(`t${ti}`);
          }
        }
      }
      return Array.from(keys);
    }

    // Merges a drag-region selection result into the live selection —
    // shift adds, alt subtracts (matches applyMaskBox's own erase
    // convention), neither replaces — then finishes with the same
    // bookkeeping applyPolyEditSelection already does.
    function applyPolyEditRegionSelection(entry: SculptMeshEntry, keys: string[], shift: boolean, subtract: boolean) {
      if (subtract) {
        for (const key of keys) selectionRef.current.delete(key);
      } else {
        if (!shift || selectedEntryRef.current !== entry) selectionRef.current = new Set();
        selectedEntryRef.current = entry;
        for (const key of keys) selectionRef.current.add(key);
      }
      updateSelectionHighlightPoints();
      repositionGizmoToSelection();
      notifySelectionChange();
    }

    // ── UV texture painting ──────────────────────────────────────────────────
    function applyPaintDab() {
      const uvHit = lastUVRef.current;
      if (!uvHit) return;
      const entry = meshEntriesRef.current.find((e) => e.mesh === uvHit.mesh);
      if (!entry?.paintCanvas || !entry.paintTexture) return;
      const canvas = entry.paintCanvas;
      const ctx = canvas.getContext("2d")!;
      const u = uvHit.uv.x;
      const v = 1 - uvHit.uv.y; // flip Y for canvas
      const cx = u * PAINT_TEX_SIZE;
      const cy = v * PAINT_TEX_SIZE;
      const r = Math.max(1, brushRadiusRef.current * 80);
      const innerR = r * brushInnerRadiusRef.current;
      const hex = paintColorRef.current;
      const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, r);
      grad.addColorStop(0, hex);
      grad.addColorStop(1, hex + "00");
      ctx.save();
      ctx.globalAlpha = brushStrengthRef.current;
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      entry.paintTexture.needsUpdate = true;
      entry.hasPaint = true;
    }

    function applyMaskStroke(hit: BrushHit) {
      for (const entry of meshEntriesRef.current) {
        ensureMaskState(entry);
        if (entry.mesh.material !== entry.maskMat) entry.mesh.material = entry.maskMat!;
        const touched = applyMaskDab(
          entry.mask!,
          entry.mesh,
          entry.seams,
          hit.point,
          brushRadiusRef.current,
          brushInnerRadiusRef.current,
          brushStrengthRef.current,
          altDownRef.current,
        );
        updateMaskColors(entry, touched);
      }
    }

    // Poly-edit click-to-select tracks down/up screen distance so an
    // orbit-camera drag (mousedown, drag, mouseup) doesn't also register as
    // a selection click — only a near-stationary down/up counts as a click.
    let polyEditDownPos: { x: number; y: number } | null = null;
    // Same click-vs-drag tracking, for pose-mode bone selection.
    let poseDownPos: { x: number; y: number } | null = null;
    // Same, for rig-mode joint placement/selection.
    let rigDownPos: { x: number; y: number } | null = null;

    function onPointerDown(e: PointerEvent) {
      // Widened for Ctrl+drag on macOS trackpads: "Secondary click -> Click
      // or tap with Control key" remaps a Control-click to button 2 (right)
      // before it ever reaches the browser — without this, a trackpad
      // user's Ctrl+drag would be silently dropped by a plain `!== 0` check.
      // External mice are unaffected (Ctrl+Left-click stays button 0).
      if (e.button !== 0 && !(e.ctrlKey && e.button === 2)) return;
      if (editModeRef.current === "poly_edit") {
        if (transformControlsRef.current?.dragging) return;
        // Ctrl+drag with Box/Lasso active: region-select instead of the
        // default click-to-select — same Ctrl+drag convention Mask mode's
        // box-select already uses, so this isn't a new modifier meaning.
        if (e.ctrlKey && polyEditSelectToolRef.current !== "click") {
          // Must own the drag exclusively, same as the shared sculpt/mask
          // stroke path does — without disabling OrbitControls here, its
          // own separate pointer listener keeps rotating the camera on the
          // very same drag at the same time this reads it as a selection.
          polyEditRegionActiveRef.current = true;
          polyEditRegionStartRef.current = { x: e.clientX, y: e.clientY };
          polyEditRegionPathRef.current = [{ x: e.clientX, y: e.clientY }];
          controlsRef.current!.enabled = false;
          mount.setPointerCapture(e.pointerId);
          if (polyEditSelectToolRef.current === "box") updateBoxOverlay(e.clientX, e.clientY, e.clientX, e.clientY);
          else updateLassoOverlay(polyEditRegionPathRef.current);
          return;
        }
        polyEditDownPos = { x: e.clientX, y: e.clientY };
        return;
      }
      if (editModeRef.current === "pose") {
        if (poseTransformControlsRef.current?.dragging) return;
        poseDownPos = { x: e.clientX, y: e.clientY };
        return;
      }
      if (editModeRef.current === "rig") {
        if (rigTransformControlsRef.current?.dragging) return;
        rigDownPos = { x: e.clientX, y: e.clientY };
        return;
      }
      const hit = getHitFromEvent(e);
      if (!hit) {
        if (e.shiftKey) {
          // See shiftRotateActiveRef's declaration for why this can't just
          // be "a normal OrbitControls rotate with Shift held."
          shiftRotateActiveRef.current = true;
          shiftRotateLastRef.current = { x: e.clientX, y: e.clientY };
          controlsRef.current!.enabled = false;
          mount.setPointerCapture(e.pointerId);
          return;
        }
        // Raycast missed everything — OrbitControls handles this drag as a
        // normal orbit rotate on its own.
        orbitDragActiveRef.current = true;
        return;
      }

      // Take undo snapshot before first displacement
      undoRef.current.push(meshEntriesRef.current.map((e) => e.mesh));

      strokeActiveRef.current = true;
      lastHitRef.current = hit;
      controlsRef.current!.enabled = false;
      mount.setPointerCapture(e.pointerId);


      // Apply on first down
      const isPaint = brushModeRef.current === "paint";
      const isMask = brushModeRef.current === "mask";
      if (isPaint) {
        applyPaintDab();
      } else if (isMask) {
        if (e.ctrlKey) {
          boxSelectActiveRef.current = true;
          boxSelectStartRef.current = { x: e.clientX, y: e.clientY };
          updateBoxOverlay(e.clientX, e.clientY, e.clientX, e.clientY);
        } else {
          applyMaskStroke(hit);
        }
      } else {
        const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 1.0;
        for (const entry of meshEntriesRef.current) {
          applyBrush({
            mode: shiftDownRef.current ? "smooth" : brushModeRef.current,
            radius: brushRadiusRef.current,
            innerRadius: brushInnerRadiusRef.current,
            strength: brushStrengthRef.current * pressure,
            hit,
            mesh: entry.mesh,
            seams: entry.seams,
            invert: altDownRef.current,
            mirror: mirrorModeRef.current ? ensureMirror(entry) : undefined,
          });
        }
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (editModeRef.current === "poly_edit") {
        if (polyEditRegionActiveRef.current) {
          if (polyEditSelectToolRef.current === "box") {
            const start = polyEditRegionStartRef.current;
            if (start) updateBoxOverlay(start.x, start.y, e.clientX, e.clientY);
          } else {
            polyEditRegionPathRef.current.push({ x: e.clientX, y: e.clientY });
            updateLassoOverlay(polyEditRegionPathRef.current);
          }
        }
        return; // no hover preview in poly-edit otherwise
      }
      if (editModeRef.current === "pose") return; // no hover preview in pose mode either
      if (editModeRef.current === "rig") return; // no hover preview in rig mode either

      if (boxSelectActiveRef.current) {
        const start = boxSelectStartRef.current;
        if (start) updateBoxOverlay(start.x, start.y, e.clientX, e.clientY);
        return;
      }

      if (shiftRotateActiveRef.current) {
        const last = shiftRotateLastRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (last && camera && controls) {
          const dx = e.clientX - last.x;
          const dy = e.clientY - last.y;
          const height = renderer!.domElement.clientHeight;
          const offset = camera.position.clone().sub(controls.target);
          const spherical = new THREE.Spherical().setFromVector3(offset);
          const twoPI = Math.PI * 2;
          // Same formula OrbitControls' own _handleMouseMoveRotate uses —
          // "yes, height" for both axes is intentional (its own comment),
          // not a copy-paste slip.
          spherical.theta -= (twoPI * dx / height) * controls.rotateSpeed;
          spherical.phi -= (twoPI * dy / height) * controls.rotateSpeed;
          spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.02, Math.PI - 0.02);
          camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
          camera.lookAt(controls.target);
          shiftRotateLastRef.current = { x: e.clientX, y: e.clientY };
        }
        return;
      }

      const hit = getHitFromEvent(e);
      updateIndicator(hit);
      updateHighlightPoints(hit);

      if (!strokeActiveRef.current || !hit) return;
      const prevHit = lastHitRef.current ?? undefined;


      if (brushModeRef.current === "paint") {
        applyPaintDab();
      } else if (brushModeRef.current === "mask") {
        applyMaskStroke(hit);
      } else {
        const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 1.0;
        for (const entry of meshEntriesRef.current) {
          applyBrush({
            mode: shiftDownRef.current ? "smooth" : brushModeRef.current,
            radius: brushRadiusRef.current,
            innerRadius: brushInnerRadiusRef.current,
            strength: brushStrengthRef.current * pressure,
            hit,
            prevHit,
            mesh: entry.mesh,
            seams: entry.seams,
            invert: altDownRef.current,
            mirror: mirrorModeRef.current ? ensureMirror(entry) : undefined,
          });
        }
      }
      lastHitRef.current = hit;
      lastHitRef.current = hit;
    }

    function onPointerUp(e: PointerEvent) {
      if (editModeRef.current === "poly_edit") {
        if (polyEditRegionActiveRef.current) {
          polyEditRegionActiveRef.current = false;
          const camera = cameraRef.current;
          const entry = selectedEntryRef.current ?? meshEntriesRef.current[0];
          if (camera && entry) {
            let predicate: (x: number, y: number) => boolean;
            if (polyEditSelectToolRef.current === "box") {
              const start = polyEditRegionStartRef.current;
              predicate = start
                ? (() => {
                    const { min, max } = clientRectToNdc(start.x, start.y, e.clientX, e.clientY);
                    return (x: number, y: number) => x >= min.x && x <= max.x && y >= min.y && y <= max.y;
                  })()
                : () => false;
              hideBoxOverlay();
            } else {
              const path = polyEditRegionPathRef.current.map((p) => clientPointToNdc(p.x, p.y));
              predicate = (x, y) => pointInPolygon(x, y, path);
              hideLassoOverlay();
            }
            const keys = resolveRegionSelection(entry, camera, predicate, selectModeRef.current);
            applyPolyEditRegionSelection(entry, keys, e.shiftKey, altDownRef.current);
          }
          polyEditRegionStartRef.current = null;
          polyEditRegionPathRef.current = [];
          controlsRef.current!.enabled = true;
          mount.releasePointerCapture(e.pointerId);
          return;
        }
        const down = polyEditDownPos;
        polyEditDownPos = null;
        if (transformControlsRef.current?.dragging) return;
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
        applyPolyEditSelection(getElementHitFromEvent(e), e.shiftKey);
        return;
      }
      if (editModeRef.current === "pose") {
        const down = poseDownPos;
        poseDownPos = null;
        if (poseTransformControlsRef.current?.dragging) return;
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
        const hit = getBoneHitFromEventRef.current(e);
        selectBoneRef.current(hit?.entry ?? null, hit?.bone ?? null);
        return;
      }
      if (editModeRef.current === "rig") {
        const down = rigDownPos;
        rigDownPos = null;
        if (rigTransformControlsRef.current?.dragging) return;
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
        // Clicking an existing joint handle selects it; otherwise a mesh
        // hit creates a new one there (chained to the selected joint, or
        // a new root if none selected).
        const jointHit = getJointHitFromEventRef.current(e);
        if (jointHit) {
          selectJointRef.current(jointHit.entry, jointHit.bone);
          return;
        }
        const nearest = raycastMeshes(e);
        if (nearest?.object) {
          const entry = meshEntriesRef.current.find((en) => en.mesh === nearest.object);
          if (entry) createJointAtRef.current(entry, nearest.point);
        }
        return;
      }
      if (shiftRotateActiveRef.current) {
        shiftRotateActiveRef.current = false;
        shiftRotateLastRef.current = null;
        controlsRef.current!.enabled = true;
        mount.releasePointerCapture(e.pointerId);
        // Committed to "this is a snap-seeking rotate" the moment the drag
        // started with Shift held — snap regardless of whether Shift is
        // still down at this exact instant.
        maybeSnapToOrthoView();
        return;
      }

      if (orbitDragActiveRef.current) {
        orbitDragActiveRef.current = false;
      }

      const wasBoxSelect = boxSelectActiveRef.current;
      if (wasBoxSelect) {
        boxSelectActiveRef.current = false;
        const start = boxSelectStartRef.current;
        boxSelectStartRef.current = null;
        hideBoxOverlay();
        const camera = cameraRef.current;
        if (start && camera) {
          const { min, max } = clientRectToNdc(start.x, start.y, e.clientX, e.clientY);
          for (const entry of meshEntriesRef.current) {
            ensureMaskState(entry);
            if (entry.mesh.material !== entry.maskMat) entry.mesh.material = entry.maskMat!;
            const touched = applyMaskBox(entry.mask!, entry.mesh, entry.seams, camera, min, max, altDownRef.current);
            updateMaskColors(entry, touched);
          }
        }
      }

      if (!strokeActiveRef.current) return;
      strokeActiveRef.current = false;
      lastHitRef.current = null;
      controlsRef.current!.enabled = true;
      mount.releasePointerCapture(e.pointerId);

      if (!wasBoxSelect && dynTopoRef.current && meshEntriesRef.current.length > 0) {
        let totalVerts = 0;
        let anyChanged = false;
        for (const entry of meshEntriesRef.current) {
          const changed = dynTopoRefine(
            entry.mesh.geometry,
            entry.baseEdgeLen ?? 0.05,
            { maxNewVerts: 2000, passes: 3 },
          );
          if (changed) {
            anyChanged = true;
            entry.mesh.geometry.boundsTree = new MeshBVH(entry.mesh.geometry);
            entry.seams = buildSeamData(entry.mesh.geometry.attributes.position.array as Float32Array);
            entry.topology = undefined;
            entry.mirror = undefined;
            const wire = entry.mesh.children.find((c) => c.name === "__wire");
            if (wire) {
              entry.mesh.remove(wire);
              const newWire = buildWireOverlay(entry.mesh.geometry, (wire as THREE.LineSegments).material as THREE.LineBasicMaterial);
              newWire.visible = (wire as THREE.Object3D).visible;
              entry.mesh.add(newWire);
            }
          }
          totalVerts += entry.mesh.geometry.attributes.position.count;
        }
        // Topology changed — old position snapshots (and any pre-change topo
        // undo snapshots, which would now restore a mismatched vertex count
        // against the current subdivStack/quadIndices state) are invalid
        if (anyChanged) {
          undoRef.current.clear();
          topoUndoRef.current.clear();
          clearPolyEditSelectionRef.current();
          onModelLoadedRef.current?.(totalVerts);
        }
      }
    }

    function onPointerLeave() {
      const ring = brushIndicatorRef.current;
      if (ring) ring.visible = false;
      const innerRing = brushInnerIndicatorRef.current;
      if (innerRing) innerRing.visible = false;
      const mirrorDot = mirrorIndicatorRef.current;
      if (mirrorDot) mirrorDot.visible = false;
      // Poly-edit's selection highlight is persistent state, not a hover
      // preview — don't hide it just because the pointer left the canvas.
      if (editModeRef.current !== "poly_edit") {
        const points = highlightPointsRef.current;
        if (points) points.visible = false;
      }
    }

    // Suppress the native right-click menu over the viewport — the macOS
    // trackpad Ctrl-click remap (see onPointerDown above) synthesizes a
    // secondary-click, which would otherwise pop up a context menu mid-drag.
    // Nothing in this viewport relies on a native context menu.
    function onContextMenu(e: MouseEvent) { e.preventDefault(); }

    const el = mount;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("contextmenu", onContextMenu);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("contextmenu", onContextMenu);
      if (boxSelectOverlayRef.current) {
        boxSelectOverlayRef.current.remove();
        boxSelectOverlayRef.current = null;
      }
      if (lassoOverlayRef.current) {
        lassoOverlayRef.current.remove();
        lassoOverlayRef.current = null;
      }
    };
  }, []);

  // Declared before the keyboard-undo effect below (which now calls these
  // directly) so it's not a forward reference — both only depend on refs
  // declared earlier in the component, so moving them up is safe.
  const undo = useCallback(() => {
    const entry = undoRef.current.undo();
    if (!entry) return;
    if (entry.kind === "mesh") {
      for (const { mesh, positions } of entry.snapshots) {
        (mesh.geometry.attributes.position.array as Float32Array).set(positions);
        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
      // A poly-edit gizmo drag pushes onto this same stack (beginGizmoDrag)
      // — without these, the selection overlay and gizmo stay rendered at
      // the stale, pre-undo shape/position after the mesh reverts.
      updateSelectionHighlightPointsRef.current();
      repositionGizmoToSelectionRef.current();
    } else {
      for (const { bone, position, quaternion } of entry.snapshots) {
        bone.position.copy(position);
        bone.quaternion.copy(quaternion);
      }
      updateBoneHandlesRef.current();
    }
  }, []);

  const redo = useCallback(() => {
    const entry = undoRef.current.redo();
    if (!entry) return;
    if (entry.kind === "mesh") {
      for (const { mesh, positions } of entry.snapshots) {
        (mesh.geometry.attributes.position.array as Float32Array).set(positions);
        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
      updateSelectionHighlightPointsRef.current();
      repositionGizmoToSelectionRef.current();
    } else {
      for (const { bone, position, quaternion } of entry.snapshots) {
        bone.position.copy(position);
        bone.quaternion.copy(quaternion);
      }
      updateBoneHandlesRef.current();
    }
  }, []);

  // ── keyboard undo/redo ────────────────────────────────────────────────────
  useEffect(() => {
    function applyTopoSnapshots(snaps: TopoMeshSnapshot[]) {
      for (const snap of snaps) {
        const entry = meshEntriesRef.current.find((e) => e.mesh === snap.mesh);
        if (!entry) continue;
        entry.mesh.geometry.dispose();
        entry.mesh.geometry = snap.geometry;
        entry.mesh.geometry.boundsTree = new MeshBVH(entry.mesh.geometry);
        entry.quadIndices = snap.quadIndices;
        entry.topology = undefined;
        entry.mirror = undefined;
        entry.seams = buildSeamData(entry.mesh.geometry.attributes.position.array as Float32Array);
        const wire = entry.mesh.children.find((c) => c.name === "__wire");
        if (wire) {
          entry.mesh.remove(wire);
          const newWire = buildWireOverlay(entry.mesh.geometry, (wire as THREE.LineSegments).material as THREE.LineBasicMaterial);
          newWire.visible = (wire as THREE.Object3D).visible;
          entry.mesh.add(newWire);
        }
      }
      clearPolyEditSelectionRef.current();
      undoRef.current.clear(); // vertex count may have changed — position snapshots are now invalid
      onModelLoadedRef.current?.(meshEntriesRef.current.reduce((s, e) => s + e.mesh.geometry.attributes.position.count, 0));
    }

    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      const isRedo = (e.key === "z" && e.shiftKey) || e.key === "y";
      const isUndo = e.key === "z" && !e.shiftKey;
      if (!isUndo && !isRedo) return;
      e.preventDefault();

      // In poly-edit mode, try the topology stack (extrude) first, falling
      // back to the position stack (transform-gizmo drags use that one).
      // Not perfectly chronological across the two stacks if you extrude,
      // then transform, then undo twice — a disclosed V1 simplification —
      // but covers the common case correctly.
      if (editModeRef.current === "poly_edit") {
        const topo = topoUndoRef.current;
        const currentTopoEntries = meshEntriesRef.current.map((e) => ({ mesh: e.mesh, quadIndices: e.quadIndices ?? new Uint32Array(0) }));
        if (isUndo && topo.canUndo) { applyTopoSnapshots(topo.undo(currentTopoEntries)!); return; }
        if (isRedo && topo.canRedo) { applyTopoSnapshots(topo.redo(currentTopoEntries)!); return; }
      }

      // Delegate to the same undo()/redo() the toolbar buttons use, rather
      // than duplicating the position-restore loop here — a prior version
      // of this handler had its own hand-rolled copy that diverged from
      // undo()/redo() (which also refresh the poly-edit selection overlay
      // and transform gizmo afterward) and silently fell out of sync,
      // leaving both stuck at their pre-undo position after a keyboard undo.
      if (isUndo) undo();
      if (isRedo) redo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Modifier key tracking: Shift = smooth override, Alt/Option = invert
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { if (e.key === "Shift") shiftDownRef.current = true; if (e.key === "Alt") altDownRef.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") shiftDownRef.current = false; if (e.key === "Alt") altDownRef.current = false; };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, []);


  // ── expose handle for parent (export, undo buttons) ───────────────────────
  const exportAtLevel = useCallback(async (level: number): Promise<Uint8Array> => {
    // Export a specific subdivision level (0 = base, 1 = first subdivide, etc.)
    if (meshEntriesRef.current.length === 0) return new Uint8Array(0);
    // Swap in the geometry at that level temporarily
    const originalGeos = meshEntriesRef.current.map((e) => e.mesh.geometry);
    const swappedGeos: THREE.BufferGeometry[] = [];
    for (const entry of meshEntriesRef.current) {
      if (!entry.subdivStack || level >= entry.subdivStack.length) {
        // Level doesn't exist in this mesh's stack, use current
        continue;
      }
      const snap = entry.subdivStack[entry.subdivStack.length - 1 - level];
      swappedGeos.push(snap.geometry);
      entry.mesh.geometry = snap.geometry;
    }
    try {
      const bytes = await exportGlb();
      return bytes;
    } finally {
      // Restore original geometries
      for (let i = 0; i < meshEntriesRef.current.length; i++) {
        meshEntriesRef.current[i].mesh.geometry = originalGeos[i];
      }
    }
  }, []);

  const exportGlb = useCallback(async (): Promise<Uint8Array> => {
    if (!modelRef.current) throw new Error("No model loaded.");

    // Temporarily detach wire overlays so they aren't baked into the exported GLB
    const detached: Array<{ parent: THREE.Object3D; obj: THREE.Object3D }> = [];
    modelRef.current.traverse((o) => {
      if (o.name === "__wire" && o.parent) {
        detached.push({ parent: o.parent, obj: o });
      }
    });
    detached.forEach(({ parent, obj }) => parent.remove(obj));

    // If any mesh has been painted, bake the paint canvas into the export material.
    // Prefer cloning the original GLTF MeshStandardMaterial and patching only its
    // albedo slot so roughness/metallic/normals/AO are preserved. Fall back to the
    // plain MeshBasicMaterial for primitives (whose original is a clay matcap).
    //
    // Whatever material is CURRENTLY assigned to a mesh (the shared clay
    // matcap, an albedo/AO channel preview, the mask-paint visualization
    // material) is UI-only — computed per entry here and swapped in
    // regardless of what the viewport happens to be showing right now, so
    // none of those ever leak into an exported file. This also incidentally
    // fixes exporting while in Clay/Albedo/AO view mode on an unpainted
    // mesh, which had the same latent bug before mask painting existed.
    const swapped: Array<{ mesh: THREE.Mesh; prev: THREE.Material | THREE.Material[] }> = [];
    for (const entry of meshEntriesRef.current) {
      let target: THREE.Material | THREE.Material[] | undefined;
      if (entry.hasPaint && entry.paintTexture) {
        const origMat = originalMaterialsRef.current.get(entry.mesh.uuid);
        if (origMat && (origMat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          const baked = (origMat as THREE.MeshStandardMaterial).clone();
          baked.map = entry.paintTexture;
          baked.needsUpdate = true;
          target = baked;
        } else if (entry.paintMat) {
          target = entry.paintMat;
        }
      }
      if (!target) target = originalMaterialsRef.current.get(entry.mesh.uuid);
      if (target && entry.mesh.material !== target) {
        swapped.push({ mesh: entry.mesh, prev: entry.mesh.material });
        entry.mesh.material = target;
      }
    }

    // Every clip on every entry, assembled with the exact same logic
    // that drives Pose mode's own playback/preview (buildThreeClipRef) —
    // the exported file's animation is guaranteed to match what was
    // actually previewed in the viewport, not a second implementation
    // that could quietly diverge from it.
    // Matches GLTFExporter's own default onlyVisible behavior for
    // meshes — exportEntryGlb hides every other entry before calling
    // this, so without this filter a hidden entry's clips would still
    // leak into an export meant to isolate just one entry.
    const animations: THREE.AnimationClip[] = [];
    for (const entry of meshEntriesRef.current) {
      if (!entry.mesh.visible) continue;
      for (const clip of entry.poseAnimation?.clips ?? []) {
        if (clip.channels.length > 0) animations.push(buildThreeClipRef.current(clip));
      }
    }

    const exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
      exporter.parse(
        modelRef.current!,
        (result) => {
          detached.forEach(({ parent, obj }) => parent.add(obj));
          swapped.forEach(({ mesh, prev }) => { mesh.material = prev; });
          resolve(new Uint8Array(result as ArrayBuffer));
        },
        (err) => {
          detached.forEach(({ parent, obj }) => parent.add(obj));
          swapped.forEach(({ mesh, prev }) => { mesh.material = prev; });
          reject(err);
        },
        { binary: true, animations },
      );
    });
  }, []);

  const getRecommendedExtrudeDistance = useCallback((): number => {
    return selectedEntryRef.current?.baseEdgeLen ?? meshEntriesRef.current[0]?.baseEdgeLen ?? 0.1;
  }, []);

  const getLoopPreview = useCallback((): { edgeCount: number; boundary: boolean; closed: boolean } | null => {
    const entry = selectedEntryRef.current;
    if (!entry || selectModeRef.current !== "edge") return null;
    const loop = resolveSeedLoop(entry, selectionRef.current);
    if (!loop) return null;
    return { edgeCount: loop.edges.length, boundary: loop.boundary, closed: loop.closed };
  }, []);

  // Commits a face or edge-loop extrude on the current poly-edit selection.
  // Pushes to the topology-aware undo stack (not the position-only one —
  // vertex/triangle count changes here) before replacing the mesh's
  // geometry, then re-selects the new cap/rim so extrude-chains work the
  // way DCC tools expect.
  const extrudeSelection = useCallback((distance: number): { ok: boolean; reason?: string } => {
    const entry = selectedEntryRef.current;
    if (!entry) return { ok: false, reason: "Nothing selected." };
    if (!Number.isFinite(distance) || distance === 0) return { ok: false, reason: "Extrude distance must be nonzero." };

    const rebuildWireAndBVH = () => {
      entry.mesh.geometry.boundsTree = new MeshBVH(entry.mesh.geometry);
      entry.seams = buildSeamData(entry.mesh.geometry.attributes.position.array as Float32Array);
      const wire = entry.mesh.children.find((c) => c.name === "__wire");
      if (wire) {
        entry.mesh.remove(wire);
        const newWire = buildWireOverlay(entry.mesh.geometry, (wire as THREE.LineSegments).material as THREE.LineBasicMaterial);
        newWire.visible = (wire as THREE.Object3D).visible;
        entry.mesh.add(newWire);
      }
    };
    const finish = (newKeys: string[]) => {
      entry.topology = undefined;
      entry.mirror = undefined;
      rebuildWireAndBVH();
      undoRef.current.clear(); // vertex count changed — position snapshots are now invalid
      setPolyEditSelectionRef.current(entry, newKeys);
      onModelLoadedRef.current?.(meshEntriesRef.current.reduce((s, e) => s + e.mesh.geometry.attributes.position.count, 0));
    };

    if (selectModeRef.current === "face") {
      if (selectionRef.current.size === 0) return { ok: false, reason: "Select at least one face." };
      const faces = resolveSelectedFaces(entry, selectionRef.current);
      if (faces.length === 0) return { ok: false, reason: "Nothing selected." };

      topoUndoRef.current.push(meshEntriesRef.current.map((e) => ({ mesh: e.mesh, quadIndices: e.quadIndices ?? new Uint32Array(0) })));
      const result = extrudeFacesLib(entry.mesh.geometry, entry.quadIndices ?? new Uint32Array(0), faces, distance, entry.baseEdgeLen ?? 0.1);
      const issues = findGeometryIssues(result.geometry);
      if (issues.length > 0) console.warn("[SculptViewer] face extrude produced a suspect mesh:", issues);

      entry.mesh.geometry.dispose();
      entry.mesh.geometry = result.geometry;
      entry.quadIndices = result.quadIndices;
      const newKeys = [...result.newQuadIdx.map((q) => `q${q}`), ...result.newTriIdx.map((t) => `t${t}`)];
      finish(newKeys);
      return { ok: true };
    }

    if (selectModeRef.current === "edge") {
      const loop = resolveSeedLoop(entry, selectionRef.current);
      if (!loop) return { ok: false, reason: "Select an edge to extrude its loop." };
      if (!loop.boundary) {
        return { ok: false, reason: "Interior edge loops can't be extruded yet — only boundary (open-rim) loops are supported." };
      }

      topoUndoRef.current.push(meshEntriesRef.current.map((e) => ({ mesh: e.mesh, quadIndices: e.quadIndices ?? new Uint32Array(0) })));
      const result = extrudeEdgeLoopLib(entry.mesh.geometry, entry.quadIndices ?? new Uint32Array(0), loop, distance, entry.baseEdgeLen ?? 0.1);
      const issues = findGeometryIssues(result.geometry);
      if (issues.length > 0) console.warn("[SculptViewer] loop extrude produced a suspect mesh:", issues);

      entry.mesh.geometry.dispose();
      entry.mesh.geometry = result.geometry;
      entry.quadIndices = result.quadIndices;
      const newKeys = result.newLoop.edges.map((e) => `${Math.min(e.v0, e.v1)}_${Math.max(e.v0, e.v1)}`);
      finish(newKeys);
      return { ok: true };
    }

    return { ok: false, reason: "Switch to Face or Edge select mode to extrude." };
  }, []);

  const subdivide = useCallback(() => {
    if (meshEntriesRef.current.length === 0) return;
    // Vertex cap — Loop subdivision ≈ 4× vertex count; block before hitting WebGL limits
    const currentVerts = meshEntriesRef.current.reduce(
      (s, e) => s + e.mesh.geometry.attributes.position.count, 0,
    );
    if (currentVerts * 4 > 1_000_000) {
      onLoadErrorRef.current?.("Subdivide would exceed 1M vertices — save and reduce the mesh first.");
      return;
    }
    // Subdivision changes topology (new vertex count), so position snapshots from previous
    // sculpt strokes would be invalid after this point. Clear rather than push.
    undoRef.current.clear();
    topoUndoRef.current.clear();
    clearPolyEditSelectionRef.current();
    let totalVerts = 0;
    for (const entry of meshEntriesRef.current) {
      const { mesh } = entry;
      // Snapshot current geometry so we can step back down
      if (!entry.subdivStack) entry.subdivStack = [];
      if (entry.subdivStack.length < 8) {
        const snapGeo = mesh.geometry.clone();
        entry.subdivStack.push({ geometry: snapGeo, quadIndices: entry.quadIndices ? entry.quadIndices.slice() : new Uint32Array(0) });
      }
      const { geometry: subdivided, newQuadIndices } = catmullClarkSubdivide(
        mesh.geometry,
        entry.quadIndices ?? new Uint32Array(0),
        entry.seams,
        smoothSubdivideRef.current,
      );
      mesh.geometry.dispose();
      mesh.geometry = subdivided;
      mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);
      entry.quadIndices = newQuadIndices; // 4× quads for the next level
      entry.topology = undefined;
      entry.mirror = undefined;
      const posArr = mesh.geometry.attributes.position.array as Float32Array;
      entry.seams = buildSeamData(posArr);
      // Rebuild wireframe overlay
      const wire = mesh.children.find((c) => c.name === "__wire");
      if (wire) {
        mesh.remove(wire);
        const newWire = buildWireOverlay(mesh.geometry, (wire as THREE.LineSegments).material as THREE.LineBasicMaterial);
        newWire.visible = (wire as THREE.Object3D).visible;
        mesh.add(newWire);
      }
      totalVerts += mesh.geometry.attributes.position.count;
    }
    onModelLoadedRef.current?.(totalVerts);
  }, []);

  const remesh = useCallback(() => {
    if (meshEntriesRef.current.length === 0) return;
    undoRef.current.clear();
    topoUndoRef.current.clear();
    clearPolyEditSelectionRef.current();
    let totalVerts = 0;
    for (const entry of meshEntriesRef.current) {
      const changed = dynTopoRefine(
        entry.mesh.geometry,
        entry.baseEdgeLen ?? 0.05,
        { maxNewVerts: 10_000, passes: 6 },
      );
      if (changed) {
        entry.mesh.geometry.boundsTree = new MeshBVH(entry.mesh.geometry);
        entry.seams = buildSeamData(entry.mesh.geometry.attributes.position.array as Float32Array);
        entry.topology = undefined;
        entry.mirror = undefined;
        const wire = entry.mesh.children.find((c) => c.name === "__wire");
        if (wire) {
          entry.mesh.remove(wire);
          const newWire = buildWireOverlay(entry.mesh.geometry, (wire as THREE.LineSegments).material as THREE.LineBasicMaterial);
          newWire.visible = (wire as THREE.Object3D).visible;
          entry.mesh.add(newWire);
        }
      }
      totalVerts += entry.mesh.geometry.attributes.position.count;
    }
    onModelLoadedRef.current?.(totalVerts);
  }, []);

  // "Conform to Reference" — the practical stand-in for a literal
  // ZBrush-style per-subdivision-level Import, which needs an exact
  // vertex-count/order match this codebase has no way to guarantee against
  // an externally-authored OBJ (see lib/sculpt/conform.ts's own header for
  // the full reasoning). Applies to the selected entry if one is selected,
  // otherwise every entry — same convention recenterView already uses.
  // Position-only change (topology/vertex count untouched), so this is
  // treated like a giant brush stroke: pushes an undo snapshot rather than
  // clearing it, rebuilds only the BVH (stale after the position change),
  // and deliberately doesn't touch seams (still valid — every vertex in a
  // seam group is moved to the exact same target together, so they still
  // coincide) or the wireframe overlay (topology-driven, unaffected).
  const conformToReference = useCallback((referenceGeometry: THREE.BufferGeometry) => {
    const entries = meshEntriesRef.current;
    if (entries.length === 0) return;
    const targets = selectedEntryRef.current ? [selectedEntryRef.current] : entries;
    undoRef.current.push(entries.map((e) => e.mesh));
    for (const entry of targets) {
      conformMeshToReference(entry.mesh, entry.seams, referenceGeometry);
      entry.mesh.geometry.boundsTree = new MeshBVH(entry.mesh.geometry);
    }
    onModelLoadedRef.current?.(entries.reduce((s, e) => s + e.mesh.geometry.attributes.position.count, 0));
  }, []);

  const loadPrimitive = useCallback((type: PrimitiveType) => {
    const scene   = sceneRef.current;
    const camera  = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    // Clear existing
    if (modelRef.current) {
      scene.remove(modelRef.current);
      modelRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) { m.geometry.boundsTree = undefined; m.geometry.dispose(); }
      });
      modelRef.current = null;
    }
    meshEntriesRef.current = [];
    undoRef.current.clear();
    topoUndoRef.current.clear();
    clearPolyEditSelectionRef.current();
    // Build geometry
    const geo = buildPrimitiveGeometry(type);
    geo.computeVertexNormals();
    if (!geo.index) {
      const vCount = geo.attributes.position.count;
      const idx = new Uint32Array(vCount);
      for (let i = 0; i < vCount; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    geo.boundsTree = new MeshBVH(geo);
    const mat = clayMatRef.current ?? new THREE.MeshMatcapMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    if (!wireMatRef.current) {
      wireMatRef.current = new THREE.LineBasicMaterial({ color: wireColorFor(viewModeRef.current), transparent: true, opacity: WIRE_OPACITY, depthTest: true, depthWrite: false, linewidth: 2 });
    }
    const wire = buildWireOverlay(geo, wireMatRef.current);
    wire.visible = false;
    mesh.add(wire);
    const posArr = geo.attributes.position.array as Float32Array;
    const seams = buildSeamData(posArr);
    const pc2 = document.createElement("canvas"); pc2.width = pc2.height = PAINT_TEX_SIZE;
    const pCtx2 = pc2.getContext("2d")!; pCtx2.fillStyle = "#888888"; pCtx2.fillRect(0, 0, PAINT_TEX_SIZE, PAINT_TEX_SIZE);
    const pt2 = new THREE.CanvasTexture(pc2); pt2.colorSpace = THREE.SRGBColorSpace;
    const pm2 = new THREE.MeshBasicMaterial({ map: pt2 });
    const primQuadIndices = detectQuads(geo);
    meshEntriesRef.current.push({ id: crypto.randomUUID(), name: "Original", mesh, seams, baseEdgeLen: computeAvgEdgeLen(geo), quadIndices: primQuadIndices, paintCanvas: pc2, paintTexture: pt2, paintMat: pm2 });
    const group = new THREE.Group();
    group.add(mesh);
    scene.add(group);
    modelRef.current = group;
    originalMaterialsRef.current.clear();
    originalMaterialsRef.current.set(mesh.uuid, mesh.material);
    channelMatsRef.current.forEach((m) => m.dispose());
    channelMatsRef.current = [];
    // Frame camera
    frameCameraOnObject(group, camera, controls, { recenterObject: true });
    applyViewToGroup(group, scene, viewModeRef.current, clayColorRef.current);
    onModelLoadedRef.current?.(geo.attributes.position.count);
  }, []);


  const loadGeometry = useCallback((geo: THREE.BufferGeometry, _name?: string) => {
    const scene    = sceneRef.current;
    const camera   = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    if (modelRef.current) {
      scene.remove(modelRef.current);
      modelRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) { m.geometry.boundsTree = undefined; m.geometry.dispose(); }
      });
      modelRef.current = null;
    }
    meshEntriesRef.current = [];
    undoRef.current.clear();
    topoUndoRef.current.clear();
    clearPolyEditSelectionRef.current();

    geo.computeVertexNormals();
    if (!geo.index) {
      const vCount = geo.attributes.position.count;
      const idx = new Uint32Array(vCount);
      for (let i = 0; i < vCount; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    geo.boundsTree = new MeshBVH(geo);
    const mat = clayMatRef.current ?? new THREE.MeshMatcapMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    if (!wireMatRef.current) {
      wireMatRef.current = new THREE.LineBasicMaterial({ color: wireColorFor(viewModeRef.current), transparent: true, opacity: WIRE_OPACITY, depthTest: true, depthWrite: false, linewidth: 2 });
    }
    const wire = buildWireOverlay(geo, wireMatRef.current);
    wire.visible = false;
    mesh.add(wire);
    const posArr = geo.attributes.position.array as Float32Array;
    const seams = buildSeamData(posArr);
    const pc = document.createElement("canvas"); pc.width = pc.height = PAINT_TEX_SIZE;
    const pCtx = pc.getContext("2d")!; pCtx.fillStyle = "#888888"; pCtx.fillRect(0, 0, PAINT_TEX_SIZE, PAINT_TEX_SIZE);
    const pt = new THREE.CanvasTexture(pc); pt.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.MeshBasicMaterial({ map: pt });
    meshEntriesRef.current.push({ id: crypto.randomUUID(), name: "Original", mesh, seams, baseEdgeLen: computeAvgEdgeLen(geo), quadIndices: detectQuads(geo), paintCanvas: pc, paintTexture: pt, paintMat: pm });
    const group = new THREE.Group();
    group.add(mesh);
    scene.add(group);
    modelRef.current = group;
    originalMaterialsRef.current.clear();
    originalMaterialsRef.current.set(mesh.uuid, mesh.material);
    channelMatsRef.current.forEach((m) => m.dispose());
    channelMatsRef.current = [];
    frameCameraOnObject(group, camera, controls, { recenterObject: true });
    applyViewToGroup(group, scene, viewModeRef.current, clayColorRef.current);
    onModelLoadedRef.current?.(geo.attributes.position.count);
  }, []);

  const subdivideDown = useCallback((): boolean => {
    // Returns true if a level was restored, false if already at base
    const entries = meshEntriesRef.current;
    if (entries.length === 0) return false;
    if (!entries[0].subdivStack || entries[0].subdivStack.length === 0) return false;
    undoRef.current.clear();
    topoUndoRef.current.clear();
    clearPolyEditSelectionRef.current();
    let totalVerts = 0;
    for (const entry of entries) {
      if (!entry.subdivStack || entry.subdivStack.length === 0) continue;
      const snap = entry.subdivStack.pop()!;
      entry.mesh.geometry.dispose();
      entry.mesh.geometry = snap.geometry;
      entry.mesh.geometry.boundsTree = new MeshBVH(entry.mesh.geometry);
      entry.quadIndices = snap.quadIndices;
      entry.topology = undefined;
      entry.mirror = undefined;
      const posArr = entry.mesh.geometry.attributes.position.array as Float32Array;
      entry.seams = buildSeamData(posArr);
      // Rebuild wireframe overlay
      const wire = entry.mesh.children.find((c) => c.name === "__wire");
      if (wire) {
        entry.mesh.remove(wire);
        const newWire = buildWireOverlay(entry.mesh.geometry, (wire as THREE.LineSegments).material as THREE.LineBasicMaterial);
        newWire.visible = (wire as THREE.Object3D).visible;
        entry.mesh.add(newWire);
      }
      totalVerts += entry.mesh.geometry.attributes.position.count;
    }
    onModelLoadedRef.current?.(totalVerts);
    return true;
  }, []);

  const subdivLevel = useCallback((): number => {
    const entry = meshEntriesRef.current[0];
    return entry?.subdivStack?.length ?? 0;
  }, []);

  const clearScene = useCallback(() => {
    const scene = sceneRef.current;
    if (modelRef.current && scene) {
      scene.remove(modelRef.current);
      modelRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) { m.geometry.boundsTree = undefined; m.geometry.dispose(); }
        if (m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mat) => mat.dispose());
        }
      });
      modelRef.current = null;
    }
    meshEntriesRef.current = [];
    undoRef.current.clear();
    topoUndoRef.current.clear();
    clearPolyEditSelectionRef.current();
    originalMaterialsRef.current.clear();
    channelMatsRef.current.forEach((m) => m.dispose());
    channelMatsRef.current = [];
    onModelLoadedRef.current?.(0);
  }, []);

  // Shared by extractMask and detachMask: wraps a freshly-built geometry
  // (already independent of the source's own buffers) as a brand-new scene
  // entry, following the exact same setup every loaded mesh gets — BVH,
  // seams, paint canvas, wire overlay, material cloned from the source
  // entry's own true material. `namePrefix` produces names like
  // "Extract 1"/"Detach 1", numbered independently per prefix.
  const spawnDerivedEntry = useCallback((group: THREE.Group, geometry: THREE.BufferGeometry, namePrefix: string, sourceEntry: SculptMeshEntry) => {
    geometry.boundsTree = new MeshBVH(geometry);
    const posArr = geometry.attributes.position.array as Float32Array;
    const seams = buildSeamData(posArr);
    const baseEdgeLen = computeAvgEdgeLen(geometry);
    const quadIndices = detectQuads(geometry);

    // Starts from the source's own true material (not whatever debug/
    // view material happens to be showing right now) — applyViewToGroup
    // below immediately re-themes it to match the active view mode
    // anyway, same as every other mesh in the scene.
    const srcMat = originalMaterialsRef.current.get(sourceEntry.mesh.uuid) ?? sourceEntry.mesh.material;
    const mat = (Array.isArray(srcMat) ? srcMat[0] : srcMat).clone();
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = sourceEntry.mesh.castShadow;
    mesh.receiveShadow = sourceEntry.mesh.receiveShadow;
    group.add(mesh);
    originalMaterialsRef.current.set(mesh.uuid, mat);

    // Same paint-canvas setup every other loaded mesh gets — lets a
    // derived submesh be color-painted just like the original.
    let paintEntry: Partial<SculptMeshEntry> = {};
    try {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = PAINT_TEX_SIZE;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#888888"; ctx.fillRect(0, 0, PAINT_TEX_SIZE, PAINT_TEX_SIZE);
        const pt = new THREE.CanvasTexture(canvas); pt.colorSpace = THREE.SRGBColorSpace;
        const pm = new THREE.MeshBasicMaterial({ map: pt });
        paintEntry = { paintCanvas: canvas, paintTexture: pt, paintMat: pm };
      }
    } catch { /* canvas context unavailable */ }

    const num = meshEntriesRef.current.filter((e) => e.name.startsWith(namePrefix)).length + 1;
    meshEntriesRef.current.push({
      id: crypto.randomUUID(),
      name: `${namePrefix} ${num}`,
      mesh, seams, baseEdgeLen, quadIndices,
      ...paintEntry,
    });

    const wire = buildWireOverlay(geometry, wireMatRef.current!);
    wire.visible = viewModeRef.current === "wireframe" || wireframeOverlayRef.current;
    mesh.add(wire);
  }, []);

  // ZBrush-style extraction: for every entry with a painted mask, builds a
  // new thickened+closed shell submesh (lib/sculpt/extract.ts) and adds it
  // to the scene — the source mesh/geometry is never touched. Not
  // integrated with the position-undo stack (it doesn't change any
  // existing mesh's positions) — "undo" for an extraction is just deleting
  // that submesh from the list, which is always safe since nothing else
  // depends on it existing.
  const extractMask = useCallback((threshold: number, thickness: number): number => {
    const group = modelRef.current;
    const scene = sceneRef.current;
    if (!group || !scene) return 0;
    let created = 0;
    // Snapshot first — appending new entries below must not also be
    // considered as extraction sources within this same call.
    const sourceEntries = [...meshEntriesRef.current];
    for (const entry of sourceEntries) {
      if (!entry.mask) continue;
      resizeMaskToGeometry(entry); // self-heal a mask left stale by subdivide/remesh/etc. since it was painted
      const result = extractMaskedRegion(entry.mesh.geometry, { mask: entry.mask, threshold, thickness, seams: entry.seams });
      if (!result.ok) { console.warn(`extractMask: ${result.reason}`); continue; }
      spawnDerivedEntry(group, result.geometry, "Extract", entry);
      created++;
    }
    if (created > 0) {
      applyViewToGroup(group, scene, viewModeRef.current, clayColorRef.current);
      const totalVerts = meshEntriesRef.current.reduce((s, e) => s + e.mesh.geometry.attributes.position.count, 0);
      onModelLoadedRef.current?.(totalVerts);
    }
    return created;
  }, [spawnDerivedEntry]);

  // Detach: for every entry with a painted mask, moves the masked
  // triangles — with their ORIGINAL position/normal/uv/color, no synthetic
  // shell — out of the source entry's own geometry and into a new
  // independent submesh (lib/sculpt/extract.ts's detachMaskedRegion).
  // Unlike extractMask, this DOES mutate the source: the selected
  // triangles are removed from its index buffer and its BVH/seams/
  // quadIndices are rebuilt afterward, following the same "rebuild
  // auxiliary structures wholesale" convention used after every other
  // topology-changing op in this file (DynTopo/subdivide/extrude). Not
  // integrated with either undo stack for v1 — both assume a fixed set of
  // mesh objects, and Detach adds one while editing another.
  const detachMask = useCallback((threshold: number): number => {
    const group = modelRef.current;
    const scene = sceneRef.current;
    if (!group || !scene) return 0;
    let created = 0;
    const sourceEntries = [...meshEntriesRef.current];
    for (const entry of sourceEntries) {
      if (!entry.mask) continue;
      resizeMaskToGeometry(entry); // self-heal a mask left stale by subdivide/remesh/etc. since it was painted
      const result = detachMaskedRegion(entry.mesh.geometry, { mask: entry.mask, threshold });
      if (!result.ok) { console.warn(`detachMask: ${result.reason}`); continue; }

      // Remove exactly the selected triangles from the source's own index
      // buffer — the source's vertex buffer is left untouched, so this
      // can't create a dangling/out-of-range index, only orphaned
      // (unreferenced) vertices, which is harmless.
      const srcGeo = entry.mesh.geometry;
      const srcIndex = srcGeo.index!;
      const selectedKeys = new Set(result.selectedTris.map(([a, b, c]) => `${a}_${b}_${c}`));
      const keptIndices: number[] = [];
      for (let t = 0; t < srcIndex.count / 3; t++) {
        const a = srcIndex.getX(t * 3), b = srcIndex.getX(t * 3 + 1), c = srcIndex.getX(t * 3 + 2);
        if (selectedKeys.has(`${a}_${b}_${c}`)) continue;
        keptIndices.push(a, b, c);
      }
      srcGeo.setIndex(keptIndices);
      srcGeo.boundsTree = new MeshBVH(srcGeo);
      entry.seams = buildSeamData(srcGeo.attributes.position.array as Float32Array);
      entry.topology = undefined;
      entry.mirror = undefined;
      entry.quadIndices = detectQuads(srcGeo);
      const oldWire = entry.mesh.children.find((c) => c.name === "__wire") as THREE.LineSegments | undefined;
      if (oldWire) { entry.mesh.remove(oldWire); oldWire.geometry.dispose(); }
      const newWire = buildWireOverlay(srcGeo, wireMatRef.current!);
      newWire.visible = viewModeRef.current === "wireframe" || wireframeOverlayRef.current;
      entry.mesh.add(newWire);

      spawnDerivedEntry(group, result.geometry, "Detach", entry);
      created++;
    }
    if (created > 0) {
      applyViewToGroup(group, scene, viewModeRef.current, clayColorRef.current);
      const totalVerts = meshEntriesRef.current.reduce((s, e) => s + e.mesh.geometry.attributes.position.count, 0);
      onModelLoadedRef.current?.(totalVerts);
    }
    return created;
  }, [spawnDerivedEntry]);

  const clearMask = useCallback(() => {
    for (const entry of meshEntriesRef.current) {
      if (!entry.mask) continue;
      entry.mask.fill(0);
      const colorAttr = entry.mesh.geometry.attributes.color as THREE.BufferAttribute | undefined;
      if (colorAttr) {
        for (let i = 0; i < colorAttr.count; i++) colorAttr.setXYZ(i, 1, 1, 1);
        colorAttr.needsUpdate = true;
      }
    }
  }, []);

  const getMeshEntries = useCallback((): Array<{ id: string; name: string; visible: boolean; vertexCount: number }> => {
    return meshEntriesRef.current.map((e) => ({
      id: e.id,
      name: e.name,
      visible: e.mesh.visible,
      vertexCount: e.mesh.geometry.attributes.position.count,
    }));
  }, []);

  const setEntryVisible = useCallback((id: string, visible: boolean) => {
    const entry = meshEntriesRef.current.find((e) => e.id === id);
    if (entry) entry.mesh.visible = visible;
  }, []);

  const getBones = useCallback((entryId: string): Array<{ id: string; name: string; depth: number }> => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry?.skeleton) return [];
    // Excludes the synthetic IK target/pole bones (see ikTargetBones/
    // ikPoleBones) — they'd otherwise clutter this list as selectable-
    // looking "bones" that aren't actually part of the character.
    return entry.skeleton.bones.filter((bone) => !isSyntheticIKBone(bone.name)).map((bone) => {
      let depth = 0;
      let p = bone.parent as THREE.Bone | null;
      while (p?.isBone) { depth++; p = p.parent as THREE.Bone | null; }
      return { id: bone.uuid, name: bone.name || "Bone", depth };
    });
  }, []);

  const selectBoneById = useCallback((entryId: string, boneId: string | null) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry?.skeleton || !boneId) { selectBoneRef.current(null, null); return; }
    const bone = entry.skeleton.bones.find((b) => b.uuid === boneId) ?? null;
    selectBoneRef.current(bone ? entry : null, bone);
  }, []);

  const resetPose = useCallback((entryId: string) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (entry) resetPoseRef.current(entry);
  }, []);

  const resetBone = useCallback((entryId: string, boneId: string) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    const bone = entry?.skeleton?.bones.find((b) => b.uuid === boneId);
    if (entry && bone) resetBoneRef.current(entry, bone);
  }, []);

  const setPoseTime = useCallback((entryId: string, time: number) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (entry) setPoseTimeRef.current(entry, time);
  }, []);

  const setPosePlaying = useCallback((entryId: string, playing: boolean) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (entry) setPosePlayingRef.current(entry, playing);
  }, []);

  const getClips = useCallback((entryId: string): Array<{ id: string; name: string; duration: number }> => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    return entry?.poseAnimation?.clips.map((c) => ({ id: c.id, name: c.name, duration: c.duration })) ?? [];
  }, []);

  const getIKChains = useCallback((entryId: string): Array<{ id: string; name: string; effectorBoneId: string }> => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry?.skeleton || !entry.poseAnimation) return [];
    const out: Array<{ id: string; name: string; effectorBoneId: string }> = [];
    for (const chain of entry.poseAnimation.ikChains) {
      const bone = entry.skeleton.bones.find((b) => b.name === chain.effectorBone);
      if (bone) out.push({ id: chain.id, name: chain.name, effectorBoneId: bone.uuid });
    }
    return out;
  }, []);

  const getHipBoneId = useCallback((entryId: string): string | null => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    const hipName = entry?.poseAnimation?.hipBoneName;
    if (!entry?.skeleton || !hipName) return null;
    return entry.skeleton.bones.find((b) => b.name === hipName)?.uuid ?? null;
  }, []);

  const selectIKChain = useCallback((entryId: string, chainId: string | null) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (entry) selectIKChainRef.current(entry, chainId);
  }, []);

  const getActiveClipId = useCallback((entryId: string): string | null => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    return entry?.poseAnimation?.activeClipId ?? null;
  }, []);

  const setActiveClip = useCallback((entryId: string, clipId: string | null) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry?.poseAnimation) return;
    entry.poseAnimation.activeClipId = clipId;
    entry.poseTime = 0;
    rebuildPoseMixerRef.current(entry);
  }, []);

  const createAnimationClip = useCallback((entryId: string): string | null => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry?.skeleton) return null;
    if (!entry.poseAnimation) entry.poseAnimation = createPoseAnimationState();
    const clip = createClip(entry.poseAnimation);
    entry.poseAnimation.activeClipId = clip.id;
    rebuildPoseMixerRef.current(entry);
    return clip.id;
  }, []);

  const renameAnimationClip = useCallback((entryId: string, clipId: string, name: string) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (entry?.poseAnimation) renameClipData(entry.poseAnimation, clipId, name);
  }, []);

  const duplicateAnimationClip = useCallback((entryId: string, clipId: string): string | null => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry?.poseAnimation) return null;
    const copy = duplicateClipData(entry.poseAnimation, clipId);
    if (!copy) return null;
    entry.poseAnimation.activeClipId = copy.id;
    rebuildPoseMixerRef.current(entry);
    return copy.id;
  }, []);

  const deleteAnimationClip = useCallback((entryId: string, clipId: string) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry?.poseAnimation) return;
    deleteClipData(entry.poseAnimation, clipId);
    rebuildPoseMixerRef.current(entry);
  }, []);

  function activeClipFor(entry: SculptMeshEntry): AnimationClipData | undefined {
    if (!entry.poseAnimation) return undefined;
    const id = entry.poseAnimation.activeClipId;
    return id ? findClip(entry.poseAnimation, id) : undefined;
  }

  const insertKeyframe = useCallback((entryId: string, time: number) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry?.skeleton) return;
    if (!entry.poseAnimation) entry.poseAnimation = createPoseAnimationState();
    const clip = activeClipFor(entry) ?? createClip(entry.poseAnimation);
    entry.poseAnimation.activeClipId = clip.id;
    // Excludes the synthetic IK target/pole bones (see ikTargetBones/
    // ikPoleBones) — those are drag aids, not part of the actual
    // performance, so keyframing "wherever you last left the mouse" for
    // them would be pointless (and export bogus, unused tracks).
    const bones = entry.skeleton.bones.filter((bone) => !isSyntheticIKBone(bone.name)).map((bone) => ({
      boneName: bone.name,
      position: [bone.position.x, bone.position.y, bone.position.z] as [number, number, number],
      quaternion: [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w] as [number, number, number, number],
    }));
    insertWholePoseKeyframe(clip, time, bones);
    entry.poseTime = time;
    rebuildPoseMixerRef.current(entry);
  }, []);

  const removeKeyframe = useCallback((entryId: string, time: number) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry) return;
    const clip = activeClipFor(entry);
    if (!clip) return;
    removeKeyframeAtTime(clip, time);
    rebuildPoseMixerRef.current(entry);
  }, []);

  const getKeyframeTimes = useCallback((entryId: string): number[] => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry) return [];
    const clip = activeClipFor(entry);
    return clip ? getKeyframeTimesData(clip) : [];
  }, []);

  const setClipLength = useCallback((entryId: string, frameCount: number, frameRate: number) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry) return;
    const clip = activeClipFor(entry);
    if (!clip) return;
    setClipLengthData(clip, frameCount, frameRate);
    entry.poseTime = Math.min(entry.poseTime ?? 0, clip.duration);
    rebuildPoseMixerRef.current(entry);
  }, []);

  // Frames the currently-selected mesh/submesh (selectedEntryRef, already
  // tracked for poly-edit and other per-entry tools) if one is selected,
  // otherwise the whole scene — so this doubles as "look at my selection"
  // and "look at everything," without needing two separate buttons.
  const recenterView = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const target = selectedEntryRef.current?.mesh ?? modelRef.current;
    if (!target) return;
    frameCameraOnObject(target, camera, controls);
  }, []);

  const toggleProjection = useCallback(() => {
    toggleProjectionRef.current();
  }, []);

  const getJoints = useCallback((entryId: string): Array<{ id: string; name: string; depth: number }> => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry?.rig) return [];
    const rig = entry.rig;
    return rig.bones.map((bone) => {
      let depth = 0;
      let parentId = bone.parentId;
      while (parentId !== null) {
        depth++;
        parentId = rig.bones.find((b) => b.id === parentId)?.parentId ?? null;
      }
      return { id: bone.id, name: bone.name, depth };
    });
  }, []);

  const selectJointById = useCallback((entryId: string, jointId: string | null) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry?.rig || !jointId) { selectJointRef.current(null, null); return; }
    const bone = entry.rig.bones.find((b) => b.id === jointId) ?? null;
    selectJointRef.current(bone ? entry : null, bone);
  }, []);

  const renameJoint = useCallback((entryId: string, jointId: string, name: string) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (entry?.rig) renameRigBone(entry.rig, jointId, name);
  }, []);

  const deleteJoint = useCallback((entryId: string, jointId: string) => {
    const entry = meshEntriesRef.current.find((e) => e.id === entryId);
    if (!entry?.rig) return;
    deleteRigBone(entry.rig, jointId);
    if (selectedJointRef.current?.id === jointId) selectJointRef.current(null, null);
    updateJointHandlesRef.current();
  }, []);

  const deleteEntry = useCallback((id: string): { ok: boolean; reason?: string } => {
    if (meshEntriesRef.current.length <= 1) {
      return { ok: false, reason: "Can't delete the last remaining mesh — use Clear instead." };
    }
    const idx = meshEntriesRef.current.findIndex((e) => e.id === id);
    if (idx === -1) return { ok: false, reason: "Not found." };
    const [entry] = meshEntriesRef.current.splice(idx, 1);
    if (selectedEntryRef.current === entry) selectedEntryRef.current = null;
    if (selectedBoneEntryRef.current === entry) selectBoneRef.current(null, null);
    if (selectedJointEntryRef.current === entry) selectJointRef.current(null, null);

    modelRef.current?.remove(entry.mesh);
    entry.mesh.geometry.boundsTree = undefined;
    entry.mesh.geometry.dispose();
    const mats = Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material];
    mats.forEach((m) => m?.dispose());
    entry.maskMat?.dispose();
    entry.paintTexture?.dispose();
    entry.paintMat?.dispose();
    const wire = entry.mesh.children.find((c) => c.name === "__wire") as THREE.LineSegments | undefined;
    wire?.geometry.dispose();
    originalMaterialsRef.current.delete(entry.mesh.uuid);

    updateBoneHandlesRef.current();
    updateJointHandlesRef.current();
    const totalVerts = meshEntriesRef.current.reduce((s, e) => s + e.mesh.geometry.attributes.position.count, 0);
    onModelLoadedRef.current?.(totalVerts);
    return { ok: true };
  }, []);

  const exportEntryGlb = useCallback(async (id: string): Promise<Uint8Array> => {
    // GLTFExporter's onlyVisible defaults to true, so temporarily hiding
    // every other entry is enough to scope exportGlb() to just this one —
    // no separate export path needed.
    const restore: Array<{ mesh: THREE.Mesh; visible: boolean }> = [];
    for (const entry of meshEntriesRef.current) {
      restore.push({ mesh: entry.mesh, visible: entry.mesh.visible });
      entry.mesh.visible = entry.id === id;
    }
    try {
      return await exportGlb();
    } finally {
      restore.forEach(({ mesh, visible }) => { mesh.visible = visible; });
    }
  }, [exportGlb]);

  useEffect(() => {
    if (handleRef) {
      (handleRef as React.MutableRefObject<SculptViewerHandle | null>).current = {
        exportGlb, exportAtLevel, undo, redo, subdivide, subdivideDown, subdivLevel, loadPrimitive, remesh, loadGeometry, clearScene,
        extrudeSelection, getLoopPreview, getRecommendedExtrudeDistance,
        extractMask, detachMask, clearMask, getMeshEntries, setEntryVisible, deleteEntry, exportEntryGlb,
        getBones, selectBone: selectBoneById, resetPose, resetBone, recenterView, toggleProjection, conformToReference,
        getJoints, selectJoint: selectJointById, renameJoint, deleteJoint,
        getClips, getActiveClipId, setActiveClip, createAnimationClip, renameAnimationClip,
        duplicateAnimationClip, deleteAnimationClip, insertKeyframe, removeKeyframe,
        setPoseTime, setPosePlaying, getKeyframeTimes, setClipLength, getIKChains, getHipBoneId, selectIKChain,
      };
    }
  }, [handleRef, exportGlb, exportAtLevel, undo, redo, subdivide, subdivideDown, subdivLevel, loadPrimitive, remesh, loadGeometry, clearScene, extrudeSelection, getLoopPreview, getRecommendedExtrudeDistance, extractMask, detachMask, clearMask, getMeshEntries, setEntryVisible, deleteEntry, exportEntryGlb, getBones, selectBoneById, resetPose, resetBone, recenterView, toggleProjection, conformToReference, getJoints, selectJointById, renameJoint, deleteJoint, getClips, getActiveClipId, setActiveClip, createAnimationClip, renameAnimationClip, duplicateAnimationClip, deleteAnimationClip, insertKeyframe, removeKeyframe, setPoseTime, setPosePlaying, getKeyframeTimes, setClipLength, getIKChains, getHipBoneId, selectIKChain]);

  return <div ref={mountRef} className="w-full h-full" style={{ touchAction: "none" }} />;
}
