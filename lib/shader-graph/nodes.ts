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

export type NodeTypeDef = {
  type: string;
  label: string;
  category: NodeCategory;
  inputs: SlotSpec[];
  outputs: SlotSpec[];
  /** Initial data values for the node */
  defaultData?: Record<string, unknown>;
};

export const NODE_TYPES: NodeTypeDef[] = [
  // ── Inputs ────────────────────────────────────────────────────────────────
  {
    type: "UV",
    label: "UV",
    category: "input",
    inputs: [],
    outputs: [{ id: "uv", label: "UV", type: "vec2" }],
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
  },
  {
    type: "Color",
    label: "Color",
    category: "input",
    inputs: [],
    outputs: [{ id: "color", label: "Color", type: "vec4" }],
    defaultData: { r: 1, g: 1, b: 1, a: 1 },
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
    defaultData: { uniformName: "" },
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
    defaultData: { outputMode: "unlit" },
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
      { id: "emissive", label: "Emissive", type: "vec3" },
    ],
    outputs: [],
    defaultData: { outputMode: "pbr" },
  },
];

export const NODE_TYPE_MAP: Map<string, NodeTypeDef> = new Map(
  NODE_TYPES.map((n) => [n.type, n]),
);

export function getNodeDef(type: string): NodeTypeDef | undefined {
  return NODE_TYPE_MAP.get(type);
}
