// Node type definitions for the Shaderade shader graph.
// Each NodeTypeDef describes a node's display name, input/output slots, and default data.

export type GlslType = "float" | "vec2" | "vec3" | "vec4" | "sampler2D";

export type SlotSpec = {
  id: string;
  label: string;
  type: GlslType;
  defaultValue?: number | number[];
};

export type NodeCategory = "input" | "math" | "utility" | "output";

export type ParamControl = "number" | "boolean" | "vec2";

export type ParamSpec = {
  /** Key into the node's `data` object — also doubles as the input slot id
   *  for slots that are both connectable and directly editable (e.g.
   *  Fresnel's "power"), so the compiler can look up the same value either
   *  way. */
  key: string;
  label: string;
  type: ParamControl;
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean | [number, number];
};

export type NodeTypeDef = {
  type: string;
  label: string;
  category: NodeCategory;
  inputs: SlotSpec[];
  outputs: SlotSpec[];
  /** Initial data values for the node */
  defaultData?: Record<string, unknown>;
  /** Editable parameters shown in the node inspector panel. Generic — the
   *  inspector renders a control per spec with no per-node-type special
   *  casing. */
  params?: ParamSpec[];
};

export const NODE_TYPES: NodeTypeDef[] = [
  // ── Inputs ────────────────────────────────────────────────────────────────
  {
    type: "UV",
    label: "UV",
    category: "input",
    inputs: [],
    outputs: [{ id: "uv", label: "UV", type: "vec2" }],
    defaultData: { scale: [1, 1], offset: [0, 0] },
    params: [
      { key: "scale", label: "Scale", type: "vec2", default: [1, 1] },
      { key: "offset", label: "Offset", type: "vec2", default: [0, 0] },
    ],
  },
  {
    type: "WorldPosition",
    label: "World Position",
    category: "input",
    inputs: [],
    outputs: [{ id: "pos", label: "Position", type: "vec3" }],
  },
  {
    type: "WorldNormal",
    label: "World Normal",
    category: "input",
    inputs: [],
    outputs: [{ id: "normal", label: "Normal", type: "vec3" }],
  },
  {
    // Same u_lightDir the built-in PBR lighting already uses internally
    // (and the live preview's draggable light gizmo already drives) — this
    // just exposes it to the graph, so custom lighting models (celshade
    // ramps/bands, hand-rolled NdotL, etc.) built via Output (Unlit) have
    // something to dot a normal against. PBR mode doesn't need this node;
    // it already wires u_lightDir into its own fixed lighting model.
    type: "LightDirection",
    label: "Light Direction",
    category: "input",
    inputs: [],
    outputs: [{ id: "dir", label: "Direction", type: "vec3" }],
  },
  {
    type: "Time",
    label: "Time",
    category: "input",
    inputs: [],
    outputs: [{ id: "time", label: "Time", type: "float" }],
  },
  {
    type: "Float",
    label: "Float",
    category: "input",
    inputs: [],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    defaultData: { value: 0.5 },
    // Wide practical range since this is a generic constant feeding
    // anything (metallic, math nodes, strengths) — not metallic-specific.
    params: [{ key: "value", label: "Value", type: "number", min: -2, max: 4, step: 0.01, default: 0.5 }],
  },
  {
    type: "Color",
    label: "Color",
    category: "input",
    inputs: [],
    outputs: [{ id: "color", label: "Color", type: "vec4" }],
    defaultData: { r: 1, g: 1, b: 1, a: 1 },
    // max: 4 (not 1) gives headroom for feeding OutputPBR's emissive slot
    // brighter-than-white, since that channel is intentionally unclamped.
    params: [
      { key: "r", label: "R", type: "number", min: 0, max: 4, step: 0.01, default: 1 },
      { key: "g", label: "G", type: "number", min: 0, max: 4, step: 0.01, default: 1 },
      { key: "b", label: "B", type: "number", min: 0, max: 4, step: 0.01, default: 1 },
      { key: "a", label: "A", type: "number", min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  {
    type: "Texture2D",
    label: "Texture 2D",
    category: "input",
    inputs: [{ id: "uv", label: "UV", type: "vec2" }],
    outputs: [
      { id: "color", label: "Color", type: "vec4" },
      { id: "rgb", label: "RGB", type: "vec3" },
      { id: "r", label: "R", type: "float" },
      { id: "g", label: "G", type: "float" },
      { id: "b", label: "B", type: "float" },
      { id: "a", label: "A", type: "float" },
    ],
    // `data.imageUrl` (string) drives the live preview. `data.assetId`
    // (string, optional — only present for library assets, e.g. wired via
    // Import Texture Set) lets a GLB export look the original bytes up
    // server-side by id; textures from the per-node upload widget (raw
    // data: URIs) have no assetId and can't be included in a GLB export.
    defaultData: { uniformName: "" },
  },
  {
    type: "EnvironmentMap",
    label: "Environment Map",
    category: "input",
    inputs: [],
    // No UV input and no pre-sampled outputs (unlike Texture2D) — the
    // compiler needs the raw sampler itself, since real glass samples it
    // multiple times at reflection/refraction-direction-derived UVs, not
    // once at a fixed mesh UV.
    outputs: [{ id: "map", label: "Map", type: "sampler2D" }],
    // Equirectangular image (atan/acos direction->UV), not a cubemap — no
    // CubeTexture plumbing needed, and it round-trips through every export
    // target as a plain sampler2D uniform.
    defaultData: { imageUrl: null },
  },
  {
    type: "Fresnel",
    label: "Fresnel",
    category: "input",
    inputs: [
      { id: "normal", label: "Normal", type: "vec3" },
      { id: "power", label: "Power", type: "float" },
    ],
    outputs: [{ id: "fresnel", label: "Fresnel", type: "float" }],
    defaultData: { power: 5.0 },
    params: [{ key: "power", label: "Power", type: "number", min: 0.1, max: 10, step: 0.1, default: 5.0 }],
  },
  {
    type: "Noise",
    label: "Noise",
    category: "input",
    inputs: [{ id: "uv", label: "UV", type: "vec2" }],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    defaultData: { scale: 4.0, octaves: 1 },
    params: [
      { key: "scale", label: "Scale", type: "number", min: 0.1, max: 50, step: 0.1, default: 4.0 },
      { key: "octaves", label: "Octaves", type: "number", min: 1, max: 6, step: 1, default: 1 },
    ],
  },
  // A real, live-triggerable ripple ring — distinct from anything built out
  // of Noise/Time/math nodes (which can only ever loop forever, not "fire
  // once when something actually happens"). Reads 4 fixed slots of plain
  // uniforms (see compiler.ts) that a real caller updates via
  // lib/shader-graph/splash.ts's triggerSplashAt() — each slot renders as
  // inactive until actually triggered, then draws one real expanding-and-
  // fading ring from wherever it was told to. Fragment-only for now (not
  // usable inside a VertexDisplacement subgraph) — a bright ring reads
  // clearly through shading alone without needing real geometry to bump.
  {
    type: "SplashTrigger",
    label: "Splash Trigger",
    category: "input",
    inputs: [{ id: "pos", label: "Position", type: "vec3" }],
    outputs: [{ id: "ring", label: "Ring", type: "float" }],
    defaultData: { speed: 1.2, lifetime: 1.0, width: 0.06 },
    params: [
      { key: "speed", label: "Expansion Speed", type: "number", min: 0.1, max: 5, step: 0.05, default: 1.2 },
      { key: "lifetime", label: "Lifetime (s)", type: "number", min: 0.2, max: 5, step: 0.1, default: 1.0 },
      { key: "width", label: "Ring Width", type: "number", min: 0.01, max: 0.5, step: 0.01, default: 0.06 },
    ],
  },

  // ── Math ──────────────────────────────────────────────────────────────────
  {
    type: "Add",
    label: "Add",
    category: "math",
    inputs: [
      { id: "a", label: "A", type: "vec4" },
      { id: "b", label: "B", type: "vec4" },
    ],
    outputs: [{ id: "result", label: "Result", type: "vec4" }],
  },
  {
    type: "Subtract",
    label: "Subtract",
    category: "math",
    inputs: [
      { id: "a", label: "A", type: "vec4" },
      { id: "b", label: "B", type: "vec4" },
    ],
    outputs: [{ id: "result", label: "Result", type: "vec4" }],
  },
  {
    type: "Multiply",
    label: "Multiply",
    category: "math",
    inputs: [
      { id: "a", label: "A", type: "vec4" },
      { id: "b", label: "B", type: "vec4" },
    ],
    outputs: [{ id: "result", label: "Result", type: "vec4" }],
  },
  {
    type: "Mix",
    label: "Mix",
    category: "math",
    inputs: [
      { id: "a", label: "A", type: "vec4" },
      { id: "b", label: "B", type: "vec4" },
      { id: "t", label: "T", type: "float" },
    ],
    outputs: [{ id: "result", label: "Result", type: "vec4" }],
  },
  {
    type: "Power",
    label: "Power",
    category: "math",
    inputs: [
      { id: "base", label: "Base", type: "float" },
      { id: "exp", label: "Exp", type: "float" },
    ],
    outputs: [{ id: "result", label: "Result", type: "float" }],
  },
  {
    type: "Clamp",
    label: "Clamp",
    category: "math",
    inputs: [
      { id: "value", label: "Value", type: "float" },
      { id: "min", label: "Min", type: "float" },
      { id: "max", label: "Max", type: "float" },
    ],
    outputs: [{ id: "result", label: "Result", type: "float" }],
    defaultData: { min: 0, max: 1 },
    params: [
      { key: "min", label: "Min", type: "number", min: -10, max: 10, step: 0.01, default: 0 },
      { key: "max", label: "Max", type: "number", min: -10, max: 10, step: 0.01, default: 1 },
    ],
  },
  {
    type: "Step",
    label: "Step",
    category: "math",
    inputs: [
      { id: "edge", label: "Edge", type: "float" },
      { id: "x", label: "X", type: "float" },
    ],
    outputs: [{ id: "result", label: "Result", type: "float" }],
  },
  {
    type: "Smoothstep",
    label: "Smoothstep",
    category: "math",
    inputs: [
      { id: "edge0", label: "Edge0", type: "float" },
      { id: "edge1", label: "Edge1", type: "float" },
      { id: "x", label: "X", type: "float" },
    ],
    outputs: [{ id: "result", label: "Result", type: "float" }],
  },
  {
    type: "Sin",
    label: "Sin",
    category: "math",
    inputs: [{ id: "x", label: "X", type: "float" }],
    outputs: [{ id: "result", label: "Result", type: "float" }],
  },
  // fract(x) — the fractional part, always in [0,1). Feeding an
  // ever-increasing value (e.g. Time*speed) through this gives a clean
  // repeating 0->1 sawtooth (rises, hard-resets to 0, repeats) — useful for
  // anything that should loop forever, like an expanding-ring effect that
  // needs to snap back to 0 rather than smoothly reverse like Sin would.
  {
    type: "Fract",
    label: "Fract",
    category: "math",
    inputs: [{ id: "x", label: "X", type: "float" }],
    outputs: [{ id: "result", label: "Result", type: "float" }],
  },
  {
    type: "Dot",
    label: "Dot",
    category: "math",
    inputs: [
      { id: "a", label: "A", type: "vec3" },
      { id: "b", label: "B", type: "vec3" },
    ],
    outputs: [{ id: "result", label: "Result", type: "float" }],
  },

  // ── Utility ───────────────────────────────────────────────────────────────
  {
    type: "Split",
    label: "Split",
    category: "utility",
    inputs: [{ id: "value", label: "Value", type: "vec4" }],
    outputs: [
      { id: "x", label: "X", type: "float" },
      { id: "y", label: "Y", type: "float" },
      { id: "z", label: "Z", type: "float" },
      { id: "w", label: "W", type: "float" },
    ],
  },
  {
    type: "Combine",
    label: "Combine",
    category: "utility",
    inputs: [
      { id: "x", label: "X", type: "float" },
      { id: "y", label: "Y", type: "float" },
      { id: "z", label: "Z", type: "float" },
      { id: "w", label: "W", type: "float" },
    ],
    outputs: [{ id: "result", label: "XYZW", type: "vec4" }],
  },
  {
    type: "OneMinus",
    label: "One Minus",
    category: "utility",
    inputs: [{ id: "value", label: "Value", type: "float" }],
    outputs: [{ id: "result", label: "Result", type: "float" }],
  },

  // ── Output ────────────────────────────────────────────────────────────────
  {
    type: "OutputUnlit",
    label: "Output (Unlit)",
    category: "output",
    inputs: [{ id: "color", label: "Color", type: "vec4" }],
    outputs: [],
    defaultData: { outputMode: "unlit", skinned: false },
    params: [
      // Off by default — unskinned graphs compile identically to before
      // this existed. On: the vertex shader gains real (Three.js
      // bone-texture-convention) skinning math, for materials applied to
      // an animated THREE.SkinnedMesh instead of a static mesh.
      { key: "skinned", label: "Skinned Mesh", type: "boolean", default: false },
    ],
  },
  {
    type: "OutputPBR",
    label: "Output (PBR)",
    category: "output",
    inputs: [
      { id: "albedo", label: "Albedo", type: "vec3" },
      { id: "normal", label: "Normal", type: "vec3" },
      { id: "roughness", label: "Roughness", type: "float" },
      { id: "metallic", label: "Metallic", type: "float" },
      { id: "ao", label: "AO", type: "float" },
      { id: "emissive", label: "Emissive", type: "vec3" },
      // Wire an EnvironmentMap node here for real reflections/refraction —
      // otherwise glass falls back to the procedural sky (shaderadeEnv).
      { id: "envMap", label: "Environment Map", type: "sampler2D" },
    ],
    outputs: [],
    defaultData: {
      outputMode: "pbr",
      normalStrength: 1,
      aoStrength: 1,
      roughnessStrength: 1,
      emissiveStrength: 1,
      ior: 1.5,
      transmission: 0,
      thicknessAware: false,
      absorptionDensity: 1.2,
      skinned: false,
    },
    params: [
      // Off by default — unskinned graphs compile identically to before
      // this existed. On: the vertex shader gains real (Three.js
      // bone-texture-convention) skinning math, for materials applied to
      // an animated THREE.SkinnedMesh instead of a static mesh.
      { key: "skinned", label: "Skinned Mesh", type: "boolean", default: false },
      { key: "normalStrength", label: "Normal Strength", type: "number", min: 0, max: 2, step: 0.05, default: 1 },
      { key: "aoStrength", label: "AO Strength", type: "number", min: 0, max: 1, step: 0.05, default: 1 },
      { key: "roughnessStrength", label: "Roughness Strength", type: "number", min: 0, max: 2, step: 0.05, default: 1 },
      // Multiplies whatever's wired into the emissive slot — lets a creator
      // push glow brightness beyond that node's own 0-4 range (Color's own
      // params above already allow >1 per channel too; this stacks on top).
      { key: "emissiveStrength", label: "Emissive Strength", type: "number", min: 0, max: 8, step: 0.1, default: 1 },
      // ior + transmission enable real-time glass: Snell's-law refraction
      // (GLSL refract), Schlick Fresnel reflection, and a procedural env
      // sample along those directions. Not path-traced scene refraction —
      // still bends/warps the environment with IOR (glass ~1.5, water
      // ~1.33, diamond ~2.42). Transmission 0 = fully opaque PBR.
      { key: "ior", label: "IOR", type: "number", min: 1.0, max: 2.42, step: 0.01, default: 1.5 },
      { key: "transmission", label: "Transmission", type: "number", min: 0, max: 1, step: 0.01, default: 0 },
      // Real Beer-Lambert absorption instead of the flat tint blend, driven
      // by an actual back-face depth pass. Off by default: existing graphs
      // (and every export target, which can't run that pass without extra
      // integration work) keep today's exact flat-tint look unless a
      // creator explicitly opts in.
      { key: "thicknessAware", label: "Thickness-Aware Absorption", type: "boolean", default: false },
      { key: "absorptionDensity", label: "Absorption Density", type: "number", min: 0, max: 5, step: 0.05, default: 1.2 },
    ],
  },
  // A real inverted-hull toon outline: a second, slightly-extruded,
  // back-face-only copy of the mesh in a flat color, rendered behind the
  // main material so it peeks out as a rim. Can coexist in the same graph
  // as an OutputUnlit/OutputPBR node — compiler.ts compiles this into its
  // own separate small shader pair rather than folding it into the main
  // one (a single fragment shader can't draw an outline around itself).
  {
    type: "OutputToonOutline",
    label: "Output (Toon Outline)",
    category: "output",
    // Only a directly-wired Color node is read for the outline's fill —
    // it's meant to be a simple flat color, not a computed expression;
    // anything else falls back to a default near-black outline. See
    // compiler.ts's resolveOutlineColor().
    inputs: [{ id: "color", label: "Color", type: "vec3" }],
    outputs: [],
    defaultData: { outputMode: "outline", thickness: 0.02 },
    params: [
      { key: "thickness", label: "Thickness", type: "number", min: 0, max: 0.2, step: 0.001, default: 0.02 },
    ],
  },
  // A third, independent root a graph can optionally have alongside a main
  // color output and/or an outline — actually moves geometry (e.g. water
  // waves) instead of just shading it. Only a restricted, vertex-stage-safe
  // subset of node types may feed `height` (see compiler.ts's
  // compileVertexDisplacement); anything else is a clear compile error
  // rather than silently-wrong GLSL. When absent, the compiler's vertex
  // shader output is byte-identical to today's.
  {
    type: "VertexDisplacement",
    label: "Vertex Displacement",
    category: "output",
    inputs: [{ id: "height", label: "Height", type: "float" }],
    outputs: [],
    defaultData: {},
  },
];

export const NODE_TYPE_MAP: Map<string, NodeTypeDef> = new Map(
  NODE_TYPES.map((n) => [n.type, n]),
);

export function getNodeDef(type: string): NodeTypeDef | undefined {
  return NODE_TYPE_MAP.get(type);
}
