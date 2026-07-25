// Hand-authored starter graphs, loaded the same way autoBuild.ts's
// buildPbrGraph() is — straight into the canvas via loadGraph(), no manual
// wiring required. Unlike autoBuild's output (derived from detected texture
// maps), these are fixed, curated recipes for common shading techniques.

import type { Node, Edge } from "@xyflow/react";

// -- Celshade (2-band) ------------------------------------------------------
// World Normal + Light Direction -> Dot -> Step -> Mix(shadow, lit) -> Unlit.
// Deliberately the simplest correct version: no Float ever feeds Dot, and
// there's exactly one threshold to tune (the Step's Float).
export function buildCelshadeGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: "cs_normal", type: "WorldNormal", position: { x: 0, y: 0 }, data: {} },
    { id: "cs_light", type: "LightDirection", position: { x: 0, y: 140 }, data: {} },
    { id: "cs_dot", type: "Dot", position: { x: 260, y: 60 }, data: {} },
    { id: "cs_threshold", type: "Float", position: { x: 260, y: 240 }, data: { value: 0.5 } },
    { id: "cs_step", type: "Step", position: { x: 520, y: 60 }, data: {} },
    { id: "cs_shadow", type: "Color", position: { x: 260, y: 400 }, data: { r: 0.16, g: 0.18, b: 0.32, a: 1 } },
    { id: "cs_lit", type: "Color", position: { x: 260, y: 560 }, data: { r: 1.0, g: 0.92, b: 0.68, a: 1 } },
    { id: "cs_mix", type: "Mix", position: { x: 780, y: 320 }, data: {} },
    { id: "cs_out", type: "OutputUnlit", position: { x: 1040, y: 320 }, data: { outputMode: "unlit" } },
  ];
  const edges: Edge[] = [
    { id: "cs_e1", source: "cs_normal", sourceHandle: "normal", target: "cs_dot", targetHandle: "a" },
    { id: "cs_e2", source: "cs_light", sourceHandle: "dir", target: "cs_dot", targetHandle: "b" },
    { id: "cs_e3", source: "cs_dot", sourceHandle: "result", target: "cs_step", targetHandle: "x" },
    { id: "cs_e4", source: "cs_threshold", sourceHandle: "value", target: "cs_step", targetHandle: "edge" },
    { id: "cs_e5", source: "cs_shadow", sourceHandle: "color", target: "cs_mix", targetHandle: "a" },
    { id: "cs_e6", source: "cs_lit", sourceHandle: "color", target: "cs_mix", targetHandle: "b" },
    { id: "cs_e7", source: "cs_step", sourceHandle: "result", target: "cs_mix", targetHandle: "t" },
    { id: "cs_e8", source: "cs_mix", sourceHandle: "result", target: "cs_out", targetHandle: "color" },
  ];
  return { nodes, edges };
}

// -- Celshade + Outline ------------------------------------------------------
// The same 2-band celshade recipe, plus a wired OutputToonOutline node —
// a real second output in the same graph, compiled by compiler.ts into its
// own separate shader pair (a real inverted-hull outline, not a Fresnel
// fake edge). A complete, load-and-go toon-with-outline example.
export function buildCelshadeOutlineGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: "co_normal", type: "WorldNormal", position: { x: 0, y: 0 }, data: {} },
    { id: "co_light", type: "LightDirection", position: { x: 0, y: 140 }, data: {} },
    { id: "co_dot", type: "Dot", position: { x: 260, y: 60 }, data: {} },
    { id: "co_threshold", type: "Float", position: { x: 260, y: 240 }, data: { value: 0.5 } },
    { id: "co_step", type: "Step", position: { x: 520, y: 60 }, data: {} },
    { id: "co_shadow", type: "Color", position: { x: 260, y: 400 }, data: { r: 0.16, g: 0.18, b: 0.32, a: 1 } },
    { id: "co_lit", type: "Color", position: { x: 260, y: 560 }, data: { r: 1.0, g: 0.92, b: 0.68, a: 1 } },
    { id: "co_mix", type: "Mix", position: { x: 780, y: 320 }, data: {} },
    { id: "co_out", type: "OutputUnlit", position: { x: 1040, y: 260 }, data: { outputMode: "unlit" } },
    { id: "co_outlineColor", type: "Color", position: { x: 780, y: 560 }, data: { r: 0.03, g: 0.03, b: 0.05, a: 1 } },
    { id: "co_outline", type: "OutputToonOutline", position: { x: 1040, y: 560 }, data: { outputMode: "outline", thickness: 0.025 } },
  ];
  const edges: Edge[] = [
    { id: "co_e1", source: "co_normal", sourceHandle: "normal", target: "co_dot", targetHandle: "a" },
    { id: "co_e2", source: "co_light", sourceHandle: "dir", target: "co_dot", targetHandle: "b" },
    { id: "co_e3", source: "co_dot", sourceHandle: "result", target: "co_step", targetHandle: "x" },
    { id: "co_e4", source: "co_threshold", sourceHandle: "value", target: "co_step", targetHandle: "edge" },
    { id: "co_e5", source: "co_shadow", sourceHandle: "color", target: "co_mix", targetHandle: "a" },
    { id: "co_e6", source: "co_lit", sourceHandle: "color", target: "co_mix", targetHandle: "b" },
    { id: "co_e7", source: "co_step", sourceHandle: "result", target: "co_mix", targetHandle: "t" },
    { id: "co_e8", source: "co_mix", sourceHandle: "result", target: "co_out", targetHandle: "color" },
    { id: "co_e9", source: "co_outlineColor", sourceHandle: "color", target: "co_outline", targetHandle: "color" },
  ];
  return { nodes, edges };
}

// -- Celshade + Texture ------------------------------------------------------
// Same Dot->Step banding, but instead of swapping between two flat colors,
// multiplies an actual albedo texture by a shadow/lit tint factor — the
// texture supplies the real per-pixel color (skin, clothing, etc.), the
// band just darkens/tints it in shadow. Upload your own image into the
// Texture2D node after loading this — there's no real asset to bake into
// a generated template.
export function buildCelshadeTexturedGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: "ct_uv", type: "UV", position: { x: 0, y: 0 }, data: {} },
    { id: "ct_tex", type: "Texture2D", position: { x: 260, y: 0 }, data: { uniformName: "" } },
    { id: "ct_normal", type: "WorldNormal", position: { x: 0, y: 180 }, data: {} },
    { id: "ct_light", type: "LightDirection", position: { x: 0, y: 320 }, data: {} },
    { id: "ct_dot", type: "Dot", position: { x: 260, y: 240 }, data: {} },
    { id: "ct_threshold", type: "Float", position: { x: 260, y: 420 }, data: { value: 0.5 } },
    { id: "ct_step", type: "Step", position: { x: 520, y: 240 }, data: {} },
    { id: "ct_shadowTint", type: "Color", position: { x: 520, y: 420 }, data: { r: 0.55, g: 0.6, b: 0.75, a: 1 } },
    { id: "ct_litTint", type: "Color", position: { x: 520, y: 560 }, data: { r: 1, g: 1, b: 1, a: 1 } },
    { id: "ct_tintMix", type: "Mix", position: { x: 780, y: 460 }, data: {} },
    { id: "ct_multiply", type: "Multiply", position: { x: 1040, y: 200 }, data: {} },
    { id: "ct_out", type: "OutputUnlit", position: { x: 1300, y: 200 }, data: { outputMode: "unlit" } },
  ];
  const edges: Edge[] = [
    { id: "ct_e1", source: "ct_uv", sourceHandle: "uv", target: "ct_tex", targetHandle: "uv" },
    { id: "ct_e2", source: "ct_normal", sourceHandle: "normal", target: "ct_dot", targetHandle: "a" },
    { id: "ct_e3", source: "ct_light", sourceHandle: "dir", target: "ct_dot", targetHandle: "b" },
    { id: "ct_e4", source: "ct_dot", sourceHandle: "result", target: "ct_step", targetHandle: "x" },
    { id: "ct_e5", source: "ct_threshold", sourceHandle: "value", target: "ct_step", targetHandle: "edge" },
    { id: "ct_e6", source: "ct_shadowTint", sourceHandle: "color", target: "ct_tintMix", targetHandle: "a" },
    { id: "ct_e7", source: "ct_litTint", sourceHandle: "color", target: "ct_tintMix", targetHandle: "b" },
    { id: "ct_e8", source: "ct_step", sourceHandle: "result", target: "ct_tintMix", targetHandle: "t" },
    { id: "ct_e9", source: "ct_tex", sourceHandle: "color", target: "ct_multiply", targetHandle: "a" },
    { id: "ct_e10", source: "ct_tintMix", sourceHandle: "result", target: "ct_multiply", targetHandle: "b" },
    { id: "ct_e11", source: "ct_multiply", sourceHandle: "result", target: "ct_out", targetHandle: "color" },
  ];
  return { nodes, edges };
}

// -- Non-RT Glass ---------------------------------------------------------
// A tuned Output (PBR) glass setup: subtle tint (not pure white — that's
// what read as flat/plastic before), low roughness, real IOR/transmission,
// and thickness-aware absorption for real center-vs-edge falloff now that
// the u_resolution bug behind the oversaturated-blue look is fixed.
// Environment Map is deliberately left unwired — there's no real image
// asset to embed into a generated template — so this renders against the
// procedural sky by default; dropping in a real equirect/HDRI via the
// Environment Map node is the next lever to pull for more realism.
export function buildGlassGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: "gl_albedo", type: "Color", position: { x: 0, y: 0 }, data: { r: 0.88, g: 0.95, b: 1.0, a: 1 } },
    { id: "gl_roughness", type: "Float", position: { x: 0, y: 180 }, data: { value: 0.04 } },
    { id: "gl_metallic", type: "Float", position: { x: 0, y: 320 }, data: { value: 0 } },
    { id: "gl_ao", type: "Float", position: { x: 0, y: 460 }, data: { value: 1 } },
    {
      id: "gl_out",
      type: "OutputPBR",
      position: { x: 400, y: 200 },
      data: {
        outputMode: "pbr",
        normalStrength: 1,
        aoStrength: 1,
        roughnessStrength: 1,
        emissiveStrength: 1,
        ior: 1.5,
        transmission: 0.92,
        thicknessAware: true,
        absorptionDensity: 1.1,
      },
    },
  ];
  const edges: Edge[] = [
    { id: "gl_e1", source: "gl_albedo", sourceHandle: "color", target: "gl_out", targetHandle: "albedo" },
    { id: "gl_e2", source: "gl_roughness", sourceHandle: "value", target: "gl_out", targetHandle: "roughness" },
    { id: "gl_e3", source: "gl_metallic", sourceHandle: "value", target: "gl_out", targetHandle: "metallic" },
    { id: "gl_e4", source: "gl_ao", sourceHandle: "value", target: "gl_out", targetHandle: "ao" },
  ];
  return { nodes, edges };
}

export type TemplateKey = "celshade" | "celshade-texture" | "celshade-outline" | "glass";

export const TEMPLATES: { key: TemplateKey; label: string; build: () => { nodes: Node[]; edges: Edge[] } }[] = [
  { key: "celshade", label: "Celshade (2-Band)", build: buildCelshadeGraph },
  { key: "celshade-texture", label: "Celshade + Texture", build: buildCelshadeTexturedGraph },
  { key: "celshade-outline", label: "Celshade + Outline", build: buildCelshadeOutlineGraph },
  { key: "glass", label: "Non-RT Glass", build: buildGlassGraph },
];
