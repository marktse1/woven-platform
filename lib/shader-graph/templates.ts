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

// -- Celshade + Texture + Outline -------------------------------------------
// The textured celshade recipe (buildCelshadeTexturedGraph) with a wired
// OutputToonOutline added — the outline is a second, independent output in
// the same graph (compiler.ts compiles it as its own separate shader pass),
// so it just needs its own color node, no changes to the texture chain.
export function buildCelshadeTexturedOutlineGraph(): { nodes: Node[]; edges: Edge[] } {
  const { nodes: textured, edges: texturedEdges } = buildCelshadeTexturedGraph();
  const nodes: Node[] = [
    ...textured,
    { id: "cto_outlineColor", type: "Color", position: { x: 1300, y: 420 }, data: { r: 0.03, g: 0.03, b: 0.05, a: 1 } },
    { id: "cto_outline", type: "OutputToonOutline", position: { x: 1560, y: 420 }, data: { outputMode: "outline", thickness: 0.025 } },
  ];
  const edges: Edge[] = [
    ...texturedEdges,
    { id: "cto_e1", source: "cto_outlineColor", sourceHandle: "color", target: "cto_outline", targetHandle: "color" },
  ];
  return { nodes, edges };
}

// -- Water helpers -----------------------------------------------------------
// A single directional sum-of-sines wave term — World Position dotted with a
// (mostly-horizontal) direction, scaled by frequency, plus Time*speed, run
// through Sin and scaled by amplitude. Ported from World Builder's raw
// hand-written water shader (lib/world-builder/editor.ts's gerstnerWave(),
// despite the name really just sum-of-sines) into node-graph form. Both
// water templates below call this 2-3 times at different
// direction/frequency/speed/amplitude and Add the results together, feeding
// the sum into a VertexDisplacement node — real moving geometry, not a
// fragment-only fake.
//
// `wp` is the shared WorldPosition node's id (created once per template,
// reused by every term — WorldPosition means the raw pre-transform position
// specifically inside a VertexDisplacement subgraph; see compiler.ts's
// compileVertexDisplacement()). `time` is likewise a single shared Time node.
function buildWaveTerm(
  prefix: string,
  y: number,
  wp: string,
  time: string,
  dir: [number, number],
  freq: number,
  speed: number,
  amp: number,
): { nodes: Node[]; edges: Edge[]; waveOutput: string } {
  const nodes: Node[] = [
    { id: `${prefix}_dir`, type: "Combine", position: { x: 260, y }, data: { x: dir[0], y: 0, z: dir[1], w: 0 } },
    { id: `${prefix}_dot`, type: "Dot", position: { x: 520, y }, data: {} },
    { id: `${prefix}_freq`, type: "Float", position: { x: 260, y: y + 90 }, data: { value: freq } },
    { id: `${prefix}_freqScale`, type: "Multiply", position: { x: 780, y }, data: {} },
    { id: `${prefix}_speed`, type: "Float", position: { x: 0, y: y + 180 }, data: { value: speed } },
    { id: `${prefix}_timeScale`, type: "Multiply", position: { x: 260, y: y + 180 }, data: {} },
    { id: `${prefix}_phase`, type: "Add", position: { x: 1040, y }, data: {} },
    { id: `${prefix}_sin`, type: "Sin", position: { x: 1300, y }, data: {} },
    { id: `${prefix}_amp`, type: "Float", position: { x: 1300, y: y + 90 }, data: { value: amp } },
    { id: `${prefix}_wave`, type: "Multiply", position: { x: 1560, y }, data: {} },
  ];
  const edges: Edge[] = [
    { id: `${prefix}_e1`, source: wp, sourceHandle: "pos", target: `${prefix}_dot`, targetHandle: "a" },
    { id: `${prefix}_e2`, source: `${prefix}_dir`, sourceHandle: "result", target: `${prefix}_dot`, targetHandle: "b" },
    { id: `${prefix}_e3`, source: `${prefix}_dot`, sourceHandle: "result", target: `${prefix}_freqScale`, targetHandle: "a" },
    { id: `${prefix}_e4`, source: `${prefix}_freq`, sourceHandle: "value", target: `${prefix}_freqScale`, targetHandle: "b" },
    { id: `${prefix}_e5`, source: time, sourceHandle: "time", target: `${prefix}_timeScale`, targetHandle: "a" },
    { id: `${prefix}_e6`, source: `${prefix}_speed`, sourceHandle: "value", target: `${prefix}_timeScale`, targetHandle: "b" },
    { id: `${prefix}_e7`, source: `${prefix}_freqScale`, sourceHandle: "result", target: `${prefix}_phase`, targetHandle: "a" },
    { id: `${prefix}_e8`, source: `${prefix}_timeScale`, sourceHandle: "result", target: `${prefix}_phase`, targetHandle: "b" },
    { id: `${prefix}_e9`, source: `${prefix}_phase`, sourceHandle: "result", target: `${prefix}_sin`, targetHandle: "x" },
    { id: `${prefix}_e10`, source: `${prefix}_sin`, sourceHandle: "result", target: `${prefix}_wave`, targetHandle: "a" },
    { id: `${prefix}_e11`, source: `${prefix}_amp`, sourceHandle: "value", target: `${prefix}_wave`, targetHandle: "b" },
  ];
  return { nodes, edges, waveOutput: `${prefix}_wave` };
}

// -- Toon Water ---------------------------------------------------------------
// Real vertex-displaced waves (2-term sum-of-sines — deliberately simpler
// than realistic water's 3-term-plus-noise recipe, matching toon's "few
// clean shapes" look) driving both actual geometry motion and (for free,
// via vNormal) the toon banding below, so the light/shadow bands visibly
// shift with the wave shape instead of just the surface moving under static
// bands. Foam and rim highlight are hard-edged Steps rather than
// Smoothstep, matching the flat-band toon aesthetic throughout. Outline is
// baked directly into this template (not a separate variant like
// celshade/celshade-outline) since stylized water almost always wants one.
export function buildToonWaterGraph(): { nodes: Node[]; edges: Edge[] } {
  const wp: Node = { id: "tw_wp", type: "WorldPosition", position: { x: 0, y: 0 }, data: {} };
  const time: Node = { id: "tw_time", type: "Time", position: { x: 0, y: 900 }, data: {} };

  const term1 = buildWaveTerm("tw_t1", 0, wp.id, time.id, [1, 0.4], 0.18, 0.6, 0.35);
  const term2 = buildWaveTerm("tw_t2", 320, wp.id, time.id, [-0.6, 1], 0.32, 1.0, 0.15);

  const waveSum: Node = { id: "tw_waveSum", type: "Add", position: { x: 1820, y: 160 }, data: {} };
  const disp: Node = { id: "tw_disp", type: "VertexDisplacement", position: { x: 2080, y: 160 }, data: {} };

  const normal: Node = { id: "tw_normal", type: "WorldNormal", position: { x: 0, y: 1200 }, data: {} };
  const light: Node = { id: "tw_light", type: "LightDirection", position: { x: 0, y: 1340 }, data: {} };
  const ndotl: Node = { id: "tw_ndotl", type: "Dot", position: { x: 260, y: 1260 }, data: {} };
  const bandThreshold: Node = { id: "tw_bandThreshold", type: "Float", position: { x: 260, y: 1400 }, data: { value: 0.3 } };
  const band: Node = { id: "tw_band", type: "Step", position: { x: 520, y: 1260 }, data: {} };
  const shadowColor: Node = { id: "tw_shadowColor", type: "Color", position: { x: 260, y: 1540 }, data: { r: 0.04, g: 0.22, b: 0.4, a: 1 } };
  const litColor: Node = { id: "tw_litColor", type: "Color", position: { x: 260, y: 1680 }, data: { r: 0.22, g: 0.62, b: 0.82, a: 1 } };
  const bandMix: Node = { id: "tw_bandMix", type: "Mix", position: { x: 780, y: 1600 }, data: {} };

  const uv: Node = { id: "tw_uv", type: "UV", position: { x: 0, y: 1840 }, data: {} };
  const foamNoise: Node = { id: "tw_foamNoise", type: "Noise", position: { x: 260, y: 1840 }, data: { scale: 9, octaves: 2 } };
  const foamThreshold: Node = { id: "tw_foamThreshold", type: "Float", position: { x: 260, y: 1980 }, data: { value: 0.62 } };
  const foamStep: Node = { id: "tw_foamStep", type: "Step", position: { x: 520, y: 1840 }, data: {} };
  const foamColor: Node = { id: "tw_foamColor", type: "Color", position: { x: 520, y: 1980 }, data: { r: 0.92, g: 0.97, b: 1, a: 1 } };
  const withFoam: Node = { id: "tw_withFoam", type: "Mix", position: { x: 1040, y: 1780 }, data: {} };

  const fresnel: Node = { id: "tw_fresnel", type: "Fresnel", position: { x: 0, y: 2120 }, data: { power: 3 } };
  const rimThreshold: Node = { id: "tw_rimThreshold", type: "Float", position: { x: 260, y: 2260 }, data: { value: 0.55 } };
  const rimStep: Node = { id: "tw_rimStep", type: "Step", position: { x: 520, y: 2120 }, data: {} };
  const rimColor: Node = { id: "tw_rimColor", type: "Color", position: { x: 520, y: 2260 }, data: { r: 0.85, g: 0.97, b: 1, a: 1 } };
  const final: Node = { id: "tw_final", type: "Mix", position: { x: 1300, y: 1980 }, data: {} };

  const out: Node = { id: "tw_out", type: "OutputUnlit", position: { x: 1560, y: 1980 }, data: { outputMode: "unlit" } };
  const outlineColor: Node = { id: "tw_outlineColor", type: "Color", position: { x: 1560, y: 2220 }, data: { r: 0.02, g: 0.08, b: 0.12, a: 1 } };
  const outline: Node = { id: "tw_outline", type: "OutputToonOutline", position: { x: 1820, y: 2220 }, data: { outputMode: "outline", thickness: 0.02 } };

  const nodes: Node[] = [
    wp, time, ...term1.nodes, ...term2.nodes, waveSum, disp,
    normal, light, ndotl, bandThreshold, band, shadowColor, litColor, bandMix,
    uv, foamNoise, foamThreshold, foamStep, foamColor, withFoam,
    fresnel, rimThreshold, rimStep, rimColor, final,
    out, outlineColor, outline,
  ];
  const edges: Edge[] = [
    ...term1.edges, ...term2.edges,
    { id: "tw_sum1", source: term1.waveOutput, sourceHandle: "result", target: waveSum.id, targetHandle: "a" },
    { id: "tw_sum2", source: term2.waveOutput, sourceHandle: "result", target: waveSum.id, targetHandle: "b" },
    { id: "tw_sum3", source: waveSum.id, sourceHandle: "result", target: disp.id, targetHandle: "height" },

    { id: "tw_e1", source: normal.id, sourceHandle: "normal", target: ndotl.id, targetHandle: "a" },
    { id: "tw_e2", source: light.id, sourceHandle: "dir", target: ndotl.id, targetHandle: "b" },
    { id: "tw_e3", source: ndotl.id, sourceHandle: "result", target: band.id, targetHandle: "x" },
    { id: "tw_e4", source: bandThreshold.id, sourceHandle: "value", target: band.id, targetHandle: "edge" },
    { id: "tw_e5", source: shadowColor.id, sourceHandle: "color", target: bandMix.id, targetHandle: "a" },
    { id: "tw_e6", source: litColor.id, sourceHandle: "color", target: bandMix.id, targetHandle: "b" },
    { id: "tw_e7", source: band.id, sourceHandle: "result", target: bandMix.id, targetHandle: "t" },

    { id: "tw_e8", source: uv.id, sourceHandle: "uv", target: foamNoise.id, targetHandle: "uv" },
    { id: "tw_e9", source: foamNoise.id, sourceHandle: "value", target: foamStep.id, targetHandle: "x" },
    { id: "tw_e10", source: foamThreshold.id, sourceHandle: "value", target: foamStep.id, targetHandle: "edge" },
    { id: "tw_e11", source: bandMix.id, sourceHandle: "result", target: withFoam.id, targetHandle: "a" },
    { id: "tw_e12", source: foamColor.id, sourceHandle: "color", target: withFoam.id, targetHandle: "b" },
    { id: "tw_e13", source: foamStep.id, sourceHandle: "result", target: withFoam.id, targetHandle: "t" },

    { id: "tw_e14", source: normal.id, sourceHandle: "normal", target: fresnel.id, targetHandle: "normal" },
    { id: "tw_e15", source: fresnel.id, sourceHandle: "fresnel", target: rimStep.id, targetHandle: "x" },
    { id: "tw_e16", source: rimThreshold.id, sourceHandle: "value", target: rimStep.id, targetHandle: "edge" },
    { id: "tw_e17", source: withFoam.id, sourceHandle: "result", target: final.id, targetHandle: "a" },
    { id: "tw_e18", source: rimColor.id, sourceHandle: "color", target: final.id, targetHandle: "b" },
    { id: "tw_e19", source: rimStep.id, sourceHandle: "result", target: final.id, targetHandle: "t" },

    { id: "tw_e20", source: final.id, sourceHandle: "result", target: out.id, targetHandle: "color" },
    { id: "tw_e21", source: outlineColor.id, sourceHandle: "color", target: outline.id, targetHandle: "color" },
  ];
  return { nodes, edges };
}

// -- Realistic Water ------------------------------------------------------
// Real vertex-displaced waves (3-term sum-of-sines at different
// directions/frequencies/speeds, ported from World Builder's fuller wave
// recipe, plus a Noise-driven detail term for fine swell) feeding Output
// (PBR) re-tuned for water instead of glass: ior 1.33 (water's real index,
// vs. glass's 1.5), transmission + thicknessAware absorption (the exact
// same real Beer-Lambert mechanism the "glass" template already proves out,
// just re-tuned), and an extra Fresnel-driven brightening mixed into the
// albedo before lighting (World Builder's own "reflectivity" trick) on top
// of OutputPBR's own built-in fresnel response. The wave-rippled normal
// (derived by the vertex-displacement machinery via finite differences)
// reaches this shading for free through vNormal — no explicit wiring
// needed — so specular highlights and the fresnel term both correctly
// follow the actual wave shape, not a flat plane.
export function buildRealisticWaterGraph(): { nodes: Node[]; edges: Edge[] } {
  const wp: Node = { id: "rw_wp", type: "WorldPosition", position: { x: 0, y: 0 }, data: {} };
  const time: Node = { id: "rw_time", type: "Time", position: { x: 0, y: 1100 }, data: {} };

  const term1 = buildWaveTerm("rw_t1", 0, wp.id, time.id, [1, 0.35], 0.12, 0.5, 0.35);
  const term2 = buildWaveTerm("rw_t2", 320, wp.id, time.id, [-0.42, 1], 0.22, 0.8, 0.18);
  const term3 = buildWaveTerm("rw_t3", 640, wp.id, time.id, [0.78, -0.62], 0.4, 1.3, 0.08);

  // Fine swell detail: Noise sampled at World Position's X/Z (via Split),
  // re-centered around 0 (raw Noise output is ~[0,1]) so it perturbs the
  // sum-of-sines waves rather than just biasing everything upward.
  const split: Node = { id: "rw_split", type: "Split", position: { x: 260, y: 960 }, data: {} };
  const noiseUv: Node = { id: "rw_noiseUv", type: "Combine", position: { x: 520, y: 960 }, data: { z: 0, w: 0 } };
  const noise: Node = { id: "rw_noise", type: "Noise", position: { x: 780, y: 960 }, data: { scale: 1.4, octaves: 2 } };
  const noiseBias: Node = { id: "rw_noiseBias", type: "Subtract", position: { x: 1040, y: 960 }, data: { b: 0.5 } };
  const noiseAmp: Node = { id: "rw_noiseAmp", type: "Float", position: { x: 1040, y: 1100 }, data: { value: 0.06 } };
  const waveDetail: Node = { id: "rw_waveDetail", type: "Multiply", position: { x: 1300, y: 960 }, data: {} };

  const sum12: Node = { id: "rw_sum12", type: "Add", position: { x: 1820, y: 160 }, data: {} };
  const sum123: Node = { id: "rw_sum123", type: "Add", position: { x: 2080, y: 320 }, data: {} };
  const sumAll: Node = { id: "rw_sumAll", type: "Add", position: { x: 2340, y: 640 }, data: {} };
  const disp: Node = { id: "rw_disp", type: "VertexDisplacement", position: { x: 2600, y: 640 }, data: {} };

  const albedo: Node = { id: "rw_albedo", type: "Color", position: { x: 0, y: 1400 }, data: { r: 0.05, g: 0.28, b: 0.32, a: 1 } };
  const roughness: Node = { id: "rw_roughness", type: "Float", position: { x: 0, y: 1540 }, data: { value: 0.08 } };
  const metallic: Node = { id: "rw_metallic", type: "Float", position: { x: 0, y: 1660 }, data: { value: 0 } };
  const ao: Node = { id: "rw_ao", type: "Float", position: { x: 0, y: 1780 }, data: { value: 1 } };
  const worldNormal: Node = { id: "rw_worldNormal", type: "WorldNormal", position: { x: 260, y: 1900 }, data: {} };
  const fresnel: Node = { id: "rw_fresnel", type: "Fresnel", position: { x: 520, y: 1900 }, data: { power: 4 } };
  const skyTint: Node = { id: "rw_skyTint", type: "Color", position: { x: 260, y: 1400 }, data: { r: 0.75, g: 0.9, b: 1.0, a: 1 } };
  const albedoWithSky: Node = { id: "rw_albedoWithSky", type: "Mix", position: { x: 780, y: 1500 }, data: {} };

  const out: Node = {
    id: "rw_out",
    type: "OutputPBR",
    position: { x: 1300, y: 1500 },
    data: {
      outputMode: "pbr",
      normalStrength: 1,
      aoStrength: 1,
      roughnessStrength: 1,
      emissiveStrength: 1,
      // Water's real index of refraction (glass defaults to 1.5).
      ior: 1.33,
      transmission: 0.85,
      // thicknessAware measures a mesh's own front-to-back-face depth via a
      // back-face render pass (see compiler.ts) — a real technique, but one
      // that only means something for a genuinely volumetric mesh (glass's
      // default template is exactly that: a closed shape). A large body of
      // water is overwhelmingly authored as a thin, one-sided plane, which
      // has no real "back face" for that pass to measure — tried this at
      // true during testing and got a visible garbage/undefined-looking
      // result, confirming it in practice. Left off: transmission still
      // gives the see-through tint via the flat Beer-Lambert-ish blend
      // compiler.ts falls back to instead, which is the right fit for a
      // plane.
      thicknessAware: false,
      absorptionDensity: 1.4,
    },
  };

  const nodes: Node[] = [
    wp, time, ...term1.nodes, ...term2.nodes, ...term3.nodes,
    split, noiseUv, noise, noiseBias, noiseAmp, waveDetail,
    sum12, sum123, sumAll, disp,
    albedo, roughness, metallic, ao, worldNormal, fresnel, skyTint, albedoWithSky, out,
  ];
  const edges: Edge[] = [
    ...term1.edges, ...term2.edges, ...term3.edges,

    { id: "rw_ne1", source: wp.id, sourceHandle: "pos", target: split.id, targetHandle: "value" },
    { id: "rw_ne2", source: split.id, sourceHandle: "x", target: noiseUv.id, targetHandle: "x" },
    { id: "rw_ne3", source: split.id, sourceHandle: "z", target: noiseUv.id, targetHandle: "y" },
    { id: "rw_ne4", source: noiseUv.id, sourceHandle: "result", target: noise.id, targetHandle: "uv" },
    { id: "rw_ne5", source: noise.id, sourceHandle: "value", target: noiseBias.id, targetHandle: "a" },
    { id: "rw_ne6", source: noiseBias.id, sourceHandle: "result", target: waveDetail.id, targetHandle: "a" },
    { id: "rw_ne7", source: noiseAmp.id, sourceHandle: "value", target: waveDetail.id, targetHandle: "b" },

    { id: "rw_sum_a", source: term1.waveOutput, sourceHandle: "result", target: sum12.id, targetHandle: "a" },
    { id: "rw_sum_b", source: term2.waveOutput, sourceHandle: "result", target: sum12.id, targetHandle: "b" },
    { id: "rw_sum_c", source: sum12.id, sourceHandle: "result", target: sum123.id, targetHandle: "a" },
    { id: "rw_sum_d", source: term3.waveOutput, sourceHandle: "result", target: sum123.id, targetHandle: "b" },
    { id: "rw_sum_e", source: sum123.id, sourceHandle: "result", target: sumAll.id, targetHandle: "a" },
    { id: "rw_sum_f", source: waveDetail.id, sourceHandle: "result", target: sumAll.id, targetHandle: "b" },
    { id: "rw_sum_g", source: sumAll.id, sourceHandle: "result", target: disp.id, targetHandle: "height" },

    { id: "rw_e1", source: worldNormal.id, sourceHandle: "normal", target: fresnel.id, targetHandle: "normal" },
    { id: "rw_e2", source: albedo.id, sourceHandle: "color", target: albedoWithSky.id, targetHandle: "a" },
    { id: "rw_e3", source: skyTint.id, sourceHandle: "color", target: albedoWithSky.id, targetHandle: "b" },
    { id: "rw_e4", source: fresnel.id, sourceHandle: "fresnel", target: albedoWithSky.id, targetHandle: "t" },
    { id: "rw_e5", source: albedoWithSky.id, sourceHandle: "result", target: out.id, targetHandle: "albedo" },
    { id: "rw_e6", source: roughness.id, sourceHandle: "value", target: out.id, targetHandle: "roughness" },
    { id: "rw_e7", source: metallic.id, sourceHandle: "value", target: out.id, targetHandle: "metallic" },
    { id: "rw_e8", source: ao.id, sourceHandle: "value", target: out.id, targetHandle: "ao" },
  ];
  return { nodes, edges };
}

export type TemplateKey =
  | "celshade" | "celshade-texture" | "celshade-outline" | "celshade-texture-outline" | "glass"
  | "toon-water" | "realistic-water";

export const TEMPLATES: { key: TemplateKey; label: string; build: () => { nodes: Node[]; edges: Edge[] } }[] = [
  { key: "celshade", label: "Celshade (2-Band)", build: buildCelshadeGraph },
  { key: "celshade-texture", label: "Celshade + Texture", build: buildCelshadeTexturedGraph },
  { key: "celshade-outline", label: "Celshade + Outline", build: buildCelshadeOutlineGraph },
  { key: "celshade-texture-outline", label: "Celshade + Texture + Outline", build: buildCelshadeTexturedOutlineGraph },
  { key: "glass", label: "Non-RT Glass", build: buildGlassGraph },
  { key: "toon-water", label: "Toon Water", build: buildToonWaterGraph },
  { key: "realistic-water", label: "Realistic Water", build: buildRealisticWaterGraph },
];
