// Compiles a shader graph (nodes + edges) into a GLSL fragment shader string.
// Steps: topological sort → emit declarations → emit main body → assemble.

import type { Node, Edge } from "@xyflow/react";
import { getNodeDef, type GlslType } from "./nodes";
import { SPLASH_SLOT_COUNT } from "./splash";

export type ShaderGraph = {
  nodes: Node[];
  edges: Edge[];
};

export type CompileResult =
  | {
      ok: true;
      fragmentShader: string;
      vertexShader: string;
      uniforms: Record<string, UniformSpec>;
      transparent: boolean;
      skinned: boolean;
      // Present only when the graph also has an OutputToonOutline node —
      // a separate small shader pair for the inverted-hull outline pass,
      // rendered as a second mesh alongside the main material.
      outline?: { vertexShader: string; fragmentShader: string; uniforms: Record<string, UniformSpec> };
    }
  | { ok: false; error: string };

export type UniformSpec = {
  type: "float" | "vec2" | "vec3" | "vec4" | "sampler2D";
  value: number | number[] | string | null;
};

// Flat values used for any PBR channel with nothing wired to it — shared
// with anything that needs to reproduce the live preview's exact appearance
// outside the compiler itself (e.g. the GLB export route baking a material
// from the same graph), so they can't silently drift apart.
export const PBR_DEFAULTS = {
  albedo: [0.5, 0.5, 0.5] as const,
  roughness: 0.5,
  metallic: 0.0,
  ao: 1.0,
  emissive: [0, 0, 0] as const,
};

// Widen float → vec to satisfy a connection
function widenExpr(expr: string, from: GlslType, to: GlslType): string {
  if (from === to) return expr;
  if (from === "float") {
    if (to === "vec2") return `vec2(${expr})`;
    if (to === "vec3") return `vec3(${expr})`;
    // `vec4(${expr}, 1.0)` (2 of the required 4 components) is invalid GLSL
    // — vec4's constructor needs either exactly 4 scalars or a single
    // scalar to broadcast, never 2. Broadcast to RGB (consistent with the
    // vec2/vec3 cases above) then pad alpha, matching how vec3→vec4 below
    // pads alpha onto an already-3-component value.
    if (to === "vec4") return `vec4(vec3(${expr}), 1.0)`;
  }
  if (from === "vec2" && to === "vec3") return `vec3(${expr}, 0.0)`;
  if (from === "vec2" && to === "vec4") return `vec4(${expr}, 0.0, 1.0)`;
  if (from === "vec3" && to === "vec4") return `vec4(${expr}, 1.0)`;
  if (from === "vec4" && to === "vec3") return `(${expr}).rgb`;
  if (from === "vec4" && to === "vec2") return `(${expr}).xy`;
  if (from === "vec3" && to === "vec2") return `(${expr}).xy`;
  if (from === "vec4" && to === "float") return `(${expr}).r`;
  if (from === "vec3" && to === "float") return `(${expr}).r`;
  if (from === "vec2" && to === "float") return `(${expr}).r`;
  return expr;
}

function glslTypeDefault(t: GlslType): string {
  switch (t) {
    case "float": return "0.0";
    case "vec2": return "vec2(0.0)";
    case "vec3": return "vec3(0.0)";
    case "vec4": return "vec4(0.0, 0.0, 0.0, 1.0)";
    case "sampler2D": return "sampler2D";
  }
}

function formatFloat(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

// A slot with no incoming edge still has a real value if the node's own
// data carries one (e.g. Fresnel.power edited via the inspector panel) —
// previously this always fell through to glslTypeDefault() (a hardcoded
// 0.0), silently ignoring any data value, connected or not.
function literalForData(value: unknown, type: GlslType): string {
  if (typeof value === "number") {
    const f = formatFloat(value);
    if (type === "float") return f;
    if (type === "vec2") return `vec2(${f})`;
    if (type === "vec3") return `vec3(${f})`;
    if (type === "vec4") return `vec4(${f}, ${f}, ${f}, 1.0)`;
  }
  if (typeof value === "boolean") return literalForData(value ? 1 : 0, type);
  if (Array.isArray(value)) {
    const n = value.map((v) => formatFloat(Number(v) || 0));
    if (type === "vec2" && n.length >= 2) return `vec2(${n[0]}, ${n[1]})`;
    if (type === "vec3" && n.length >= 3) return `vec3(${n[0]}, ${n[1]}, ${n[2]})`;
    if (type === "vec4" && n.length >= 4) return `vec4(${n.join(", ")})`;
  }
  return glslTypeDefault(type);
}

function varName(nodeId: string, slotId: string): string {
  return `n_${nodeId.replace(/[^a-zA-Z0-9]/g, "_")}_${slotId}`;
}

// Kahn's algorithm topological sort — returns null on cycle.
function topoSort(nodes: Node[], edges: Edge[]): Node[] | null {
  const inDeg = new Map<string, number>();
  const adjOut = new Map<string, string[]>();

  for (const n of nodes) { inDeg.set(n.id, 0); adjOut.set(n.id, []); }
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    adjOut.get(e.source)!.push(e.target);
  }

  const queue = nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0);
  const result: Node[] = [];
  const seen = new Set<string>();

  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    result.push(n);
    for (const next of adjOut.get(n.id) ?? []) {
      const d = (inDeg.get(next) ?? 1) - 1;
      inDeg.set(next, d);
      if (d === 0) queue.push(nodes.find((x) => x.id === next)!);
    }
  }

  return result.length === nodes.length ? result : null;
}

// Node types allowed to feed a VertexDisplacement node's `height` input.
// Deliberately narrow: fragment-only nodes (Texture2D, EnvironmentMap,
// Fresnel — needs vViewDir, WorldNormal/LightDirection — fragment varyings)
// either don't make sense before the mesh is transformed or aren't available
// yet at this point in the vertex shader, so they're compile errors here
// rather than silently wrong GLSL. Notably no UV node: it would resolve to
// the fixed per-vertex `vUv`, which doesn't vary with the `pos` argument the
// way WorldPosition does below — the finite-difference normal derivation in
// compile() calls shaderadeVertexHeight() at neighboring positions
// specifically to measure how height changes with position, so a height
// function that ignores its `pos` argument would silently produce a flat
// (wrong) normal. Keeping UV out avoids that footgun entirely for v1.
const VERTEX_DISPLACEMENT_ALLOWED_TYPES = new Set([
  "Time", "Float", "Noise", "WorldPosition",
  "Split", "Combine", "Add", "Subtract", "Multiply", "Mix",
  "Sin", "Fract", "Power", "Clamp", "Smoothstep", "Step", "OneMinus", "Dot",
]);

// Compiles the subgraph feeding a VertexDisplacement node's `height` input
// into a standalone GLSL function, `float shaderadeVertexHeight(vec3 pos)`,
// which compile() below calls three times (at the vertex's own position and
// two small offsets) to both displace the geometry and derive a correct
// rippled normal via finite differences — the standard shader-graph-tool
// technique for "displacement with automatically-correct normals" without
// needing symbolic differentiation of an arbitrary graph.
//
// Deliberately a separate, small function rather than a mode threaded
// through the big fragment-codegen switch in compile() below: a graph
// without a VertexDisplacement node never calls this at all, so a mistake
// here can only affect graphs that actually use the new node, never any
// existing shader.
function compileVertexDisplacement(
  nodes: Node[],
  targetToSource: Map<string, { source: string; sourceHandle: string }>,
  displacementNode: Node,
  uniforms: Record<string, UniformSpec>,
): { ok: true; declarations: string[] } | { ok: false; error: string } {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const rootLink = targetToSource.get(`${displacementNode.id}::height`);
  if (!rootLink) {
    return { ok: false, error: "Vertex Displacement's Height input isn't connected." };
  }

  // Backward DFS from the root, post-order so dependencies are emitted
  // before whatever reads them — the same idea as compile()'s Kahn's
  // algorithm topo sort above, just scoped to this smaller subgraph.
  const visited = new Set<string>();
  const order: Node[] = [];
  let problem: string | null = null;
  const visit = (nodeId: string) => {
    if (problem || visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node) { problem = "Vertex Displacement graph references a missing node."; return; }
    const def = getNodeDef(node.type as string);
    if (!def) { problem = `Unknown node type "${node.type}" in Vertex Displacement graph.`; return; }
    if (!VERTEX_DISPLACEMENT_ALLOWED_TYPES.has(node.type as string)) {
      problem = `"${def.label}" can't feed Vertex Displacement — only Time, Float, Noise, World Position, and basic math/utility nodes can run before the mesh is transformed. Remove it from the Height chain.`;
      return;
    }
    for (const input of def.inputs) {
      const link = targetToSource.get(`${nodeId}::${input.id}`);
      if (link) visit(link.source);
      if (problem) return;
    }
    order.push(node);
  };
  visit(rootLink.source);
  if (problem) return { ok: false, error: problem };

  const sourceExprMap = new Map<string, { expr: string; type: GlslType }>();
  const lines: string[] = [];
  let noiseHelpersEmitted = false;
  const helperDecls: string[] = [];

  const inputExprFor = (node: Node, slotId: string, expectedType: GlslType): string => {
    const link = targetToSource.get(`${node.id}::${slotId}`);
    const conn = link ? sourceExprMap.get(`${link.source}::${link.sourceHandle}`) : undefined;
    if (conn) return widenExpr(conn.expr, conn.type, expectedType);
    const data = (node.data ?? {}) as Record<string, unknown>;
    const dataVal = data[slotId];
    if (dataVal !== undefined) return literalForData(dataVal, expectedType);
    return glslTypeDefault(expectedType);
  };

  for (const node of order) {
    const data = (node.data ?? {}) as Record<string, unknown>;
    switch (node.type) {
      case "WorldPosition":
        // Special-cased ONLY here: the function parameter (raw, pre-
        // transform position), not vWorldPos — this function is evaluated
        // at slightly offset positions to derive a normal via finite
        // differences, so it must be a true function of `pos`. Elsewhere
        // (fragment shading) WorldPosition still means vWorldPos exactly
        // as before; this special case is local to this function only.
        sourceExprMap.set(`${node.id}::pos`, { expr: "pos", type: "vec3" });
        break;

      case "Time":
        uniforms["u_time"] = uniforms["u_time"] ?? { type: "float", value: 0 };
        sourceExprMap.set(`${node.id}::time`, { expr: "u_time", type: "float" });
        break;

      case "Float": {
        const val = (data.value as number) ?? 0;
        const uName = `u_float_${node.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
        uniforms[uName] = { type: "float", value: val };
        sourceExprMap.set(`${node.id}::value`, { expr: uName, type: "float" });
        break;
      }

      case "Noise": {
        if (!noiseHelpersEmitted) {
          noiseHelpersEmitted = true;
          helperDecls.push(
            "float shaderadeVertexHash(vec2 p) {",
            "  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);",
            "}",
            "float shaderadeVertexValueNoise(vec2 p) {",
            "  vec2 i = floor(p); vec2 f = fract(p);",
            "  float a = shaderadeVertexHash(i);",
            "  float b = shaderadeVertexHash(i + vec2(1.0, 0.0));",
            "  float c = shaderadeVertexHash(i + vec2(0.0, 1.0));",
            "  float d = shaderadeVertexHash(i + vec2(1.0, 1.0));",
            "  vec2 u = f * f * (3.0 - 2.0 * f);",
            "  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;",
            "}",
          );
        }
        const uvExpr = inputExprFor(node, "uv", "vec2");
        const scale = (data.scale as number) ?? 4.0;
        const octaves = Math.max(1, Math.min(6, Math.round((data.octaves as number) ?? 1)));
        const vn = varName(node.id, "value");
        lines.push(`vec2 ${vn}_uv = (${uvExpr}) * ${formatFloat(scale)};`);
        lines.push(`float ${vn} = 0.0;`);
        lines.push(`{ float amp = 0.5; float freq = 1.0;`);
        for (let o = 0; o < octaves; o++) {
          lines.push(`  ${vn} += amp * shaderadeVertexValueNoise(${vn}_uv * freq); amp *= 0.5; freq *= 2.0;`);
        }
        lines.push(`}`);
        sourceExprMap.set(`${node.id}::value`, { expr: vn, type: "float" });
        break;
      }

      case "Add": {
        const a = inputExprFor(node, "a", "vec4"), b = inputExprFor(node, "b", "vec4");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = ${a} + ${b};`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }
      case "Subtract": {
        const a = inputExprFor(node, "a", "vec4"), b = inputExprFor(node, "b", "vec4");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = ${a} - ${b};`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }
      case "Multiply": {
        const a = inputExprFor(node, "a", "vec4"), b = inputExprFor(node, "b", "vec4");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = ${a} * ${b};`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }
      case "Mix": {
        const a = inputExprFor(node, "a", "vec4"), b = inputExprFor(node, "b", "vec4"), t = inputExprFor(node, "t", "float");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = mix(${a}, ${b}, ${t});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }
      case "Power": {
        const base = inputExprFor(node, "base", "float"), exp = inputExprFor(node, "exp", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = pow(${base}, ${exp});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }
      case "Clamp": {
        const val = inputExprFor(node, "value", "float"), mn = inputExprFor(node, "min", "float"), mx = inputExprFor(node, "max", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = clamp(${val}, ${mn}, ${mx});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }
      case "Step": {
        const edge = inputExprFor(node, "edge", "float"), x = inputExprFor(node, "x", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = step(${edge}, ${x});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }
      case "Smoothstep": {
        const e0 = inputExprFor(node, "edge0", "float"), e1 = inputExprFor(node, "edge1", "float"), x = inputExprFor(node, "x", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = smoothstep(${e0}, ${e1}, ${x});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }
      case "Sin": {
        const x = inputExprFor(node, "x", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = sin(${x});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }
      case "Fract": {
        const x = inputExprFor(node, "x", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = fract(${x});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }
      case "Dot": {
        const a = inputExprFor(node, "a", "vec3"), b = inputExprFor(node, "b", "vec3");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = dot(${a}, ${b});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }
      case "Split": {
        const val = inputExprFor(node, "value", "vec4");
        const vn = varName(node.id, "v");
        lines.push(`vec4 ${vn} = ${val};`);
        sourceExprMap.set(`${node.id}::x`, { expr: `${vn}.x`, type: "float" });
        sourceExprMap.set(`${node.id}::y`, { expr: `${vn}.y`, type: "float" });
        sourceExprMap.set(`${node.id}::z`, { expr: `${vn}.z`, type: "float" });
        sourceExprMap.set(`${node.id}::w`, { expr: `${vn}.w`, type: "float" });
        break;
      }
      case "Combine": {
        const x = inputExprFor(node, "x", "float"), y = inputExprFor(node, "y", "float");
        const z = inputExprFor(node, "z", "float"), w = inputExprFor(node, "w", "float");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = vec4(${x}, ${y}, ${z}, ${w});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }
      case "OneMinus": {
        const val = inputExprFor(node, "value", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = 1.0 - ${val};`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }
    }
  }

  const heightConn = sourceExprMap.get(`${rootLink.source}::${rootLink.sourceHandle}`);
  const heightExpr = heightConn ? widenExpr(heightConn.expr, heightConn.type, "float") : "0.0";

  const declarations = [
    ...helperDecls,
    "float shaderadeVertexHeight(vec3 pos) {",
    ...lines.map((l) => `  ${l}`),
    `  return ${heightExpr};`,
    "}",
  ];
  return { ok: true, declarations };
}

export function compile(graph: ShaderGraph): CompileResult {
  const { nodes, edges } = graph;
  if (nodes.length === 0) {
    return { ok: false, error: "Graph is empty." };
  }

  const sorted = topoSort(nodes, edges);
  if (!sorted) {
    return { ok: false, error: "Cycle detected in shader graph." };
  }

  // target node+slot → the edge feeding it (topology only — no expression
  // guessing here; see targetExpr below for why).
  const targetToSource = new Map<string, { source: string; sourceHandle: string }>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    targetToSource.set(`${e.target}::${e.targetHandle}`, { source: e.source, sourceHandle: e.sourceHandle ?? "" });
  }

  // source node+slot → the actual expression/type that node emitted for
  // that output, populated as each node is processed below (in topo order,
  // so every source is populated before anything downstream reads it).
  const sourceExprMap = new Map<string, { expr: string; type: GlslType }>();

  const uniforms: Record<string, UniformSpec> = {};
  const lines: string[] = [];
  let outputNode: Node | null = null;
  // A graph can have a main output (Unlit/PBR) AND an outline output at
  // the same time — they compile into two separate shader programs (a
  // single fragment shader can't draw an outline around itself), so this
  // is tracked separately rather than letting a second output node
  // silently overwrite the first the way it used to.
  let outlineNode: Node | null = null;
  // A third, independent optional root — see compileVertexDisplacement()
  // above and its use further down, near vertexShader's assembly.
  let displacementNode: Node | null = null;

  // Noise's hash/value-noise helper is emitted at most once regardless of
  // how many Noise nodes are in the graph.
  let noiseHelpersEmitted = false;
  const helperDecls: string[] = [];

  for (const node of sorted) {
    const def = getNodeDef(node.type as string);
    if (!def) continue;
    const data = (node.data ?? {}) as Record<string, unknown>;

    if (def.category === "output") {
      if (node.type === "OutputToonOutline") outlineNode = node;
      else if (node.type === "VertexDisplacement") displacementNode = node;
      else outputNode = node;
      continue;
    }

    // Helper: get expression for an input slot (connected or default).
    // Resolves via the edge's SOURCE-side registration, not by guessing a
    // variable name from the source node id + slot id — multi-output nodes
    // (Texture2D's rgb/r/g/b/a, Split's x/y/z/w) declare one variable and
    // expose the rest as swizzle expressions on it, so `n_<id>_<slot>`
    // is only ever a real declared identifier for single-output nodes.
    const inputExpr = (slotId: string, expectedType: GlslType): string => {
      const link = targetToSource.get(`${node.id}::${slotId}`);
      const conn = link ? sourceExprMap.get(`${link.source}::${link.sourceHandle}`) : undefined;
      if (conn) return widenExpr(conn.expr, conn.type, expectedType);
      const dataVal = data[slotId];
      if (dataVal !== undefined) return literalForData(dataVal, expectedType);
      return glslTypeDefault(expectedType);
    };

    switch (node.type) {
      case "UV": {
        const scale = (data.scale as [number, number]) ?? [1, 1];
        const offset = (data.offset as [number, number]) ?? [0, 0];
        const identity = scale[0] === 1 && scale[1] === 1 && offset[0] === 0 && offset[1] === 0;
        const uvExpr = identity
          ? "vUv"
          : `(vUv * vec2(${formatFloat(scale[0])}, ${formatFloat(scale[1])}) + vec2(${formatFloat(offset[0])}, ${formatFloat(offset[1])}))`;
        lines.push(`vec2 ${varName(node.id, "uv")} = ${uvExpr};`);
        sourceExprMap.set(`${node.id}::uv`, { expr: varName(node.id, "uv"), type: "vec2" });
        break;
      }

      case "WorldPosition":
        lines.push(`vec3 ${varName(node.id, "pos")} = vWorldPos;`);
        sourceExprMap.set(`${node.id}::pos`, { expr: varName(node.id, "pos"), type: "vec3" });
        break;

      case "WorldNormal":
        lines.push(`vec3 ${varName(node.id, "normal")} = vNormal;`);
        sourceExprMap.set(`${node.id}::normal`, { expr: varName(node.id, "normal"), type: "vec3" });
        break;

      case "LightDirection": {
        // Registered here too (not just inside OutputPBR's own codegen)
        // since a pure Unlit-mode graph using this node never runs that
        // branch — Record writes are idempotent, so no conflict if a graph
        // somehow has both.
        uniforms["u_lightDir"] = { type: "vec3", value: [0.45, 0.8, 0.4] };
        const vn = varName(node.id, "dir");
        lines.push(`vec3 ${vn} = normalize(u_lightDir);`);
        sourceExprMap.set(`${node.id}::dir`, { expr: vn, type: "vec3" });
        break;
      }

      case "Time": {
        const uName = `u_time`;
        uniforms[uName] = { type: "float", value: 0 };
        lines.push(`float ${varName(node.id, "time")} = ${uName};`);
        sourceExprMap.set(`${node.id}::time`, { expr: varName(node.id, "time"), type: "float" });
        break;
      }

      case "Float": {
        const val = (data.value as number) ?? 0;
        const uName = `u_float_${node.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
        uniforms[uName] = { type: "float", value: val };
        lines.push(`float ${varName(node.id, "value")} = ${uName};`);
        sourceExprMap.set(`${node.id}::value`, { expr: varName(node.id, "value"), type: "float" });
        break;
      }

      case "Color": {
        const r = (data.r as number) ?? 1, g = (data.g as number) ?? 1;
        const b = (data.b as number) ?? 1, a = (data.a as number) ?? 1;
        const uName = `u_color_${node.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
        uniforms[uName] = { type: "vec4", value: [r, g, b, a] };
        lines.push(`vec4 ${varName(node.id, "color")} = ${uName};`);
        sourceExprMap.set(`${node.id}::color`, { expr: varName(node.id, "color"), type: "vec4" });
        break;
      }

      case "Texture2D": {
        const uName = (data.uniformName as string) || `u_tex_${node.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
        uniforms[uName] = { type: "sampler2D", value: (data.imageUrl as string) ?? null };
        const uvExpr = inputExpr("uv", "vec2");
        const vn = varName(node.id, "color");
        lines.push(`vec4 ${vn} = texture2D(${uName}, ${uvExpr});`);
        sourceExprMap.set(`${node.id}::color`, { expr: vn, type: "vec4" });
        sourceExprMap.set(`${node.id}::rgb`, { expr: `${vn}.rgb`, type: "vec3" });
        sourceExprMap.set(`${node.id}::r`, { expr: `${vn}.r`, type: "float" });
        sourceExprMap.set(`${node.id}::g`, { expr: `${vn}.g`, type: "float" });
        sourceExprMap.set(`${node.id}::b`, { expr: `${vn}.b`, type: "float" });
        sourceExprMap.set(`${node.id}::a`, { expr: `${vn}.a`, type: "float" });
        break;
      }

      case "EnvironmentMap": {
        // No sampling here — this just registers the uniform and hands the
        // raw sampler name downstream. OutputPBR's glass branch samples it
        // multiple times at reflection/refraction-direction-derived UVs, so
        // there's no single fixed expression to resolve to like other nodes.
        const uName = `u_envmap_${node.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
        uniforms[uName] = { type: "sampler2D", value: (data.imageUrl as string) ?? null };
        sourceExprMap.set(`${node.id}::map`, { expr: uName, type: "sampler2D" });
        break;
      }

      case "Fresnel": {
        const normalExpr = inputExpr("normal", "vec3");
        const powerExpr = inputExpr("power", "float");
        const vn = varName(node.id, "fresnel");
        lines.push(`float ${vn} = pow(1.0 - clamp(dot(normalize(${normalExpr}), normalize(vViewDir)), 0.0, 1.0), ${powerExpr});`);
        sourceExprMap.set(`${node.id}::fresnel`, { expr: vn, type: "float" });
        break;
      }

      case "Noise": {
        if (!noiseHelpersEmitted) {
          noiseHelpersEmitted = true;
          helperDecls.push(
            "float shaderadeHash(vec2 p) {",
            "  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);",
            "}",
            "float shaderadeValueNoise(vec2 p) {",
            "  vec2 i = floor(p); vec2 f = fract(p);",
            "  float a = shaderadeHash(i);",
            "  float b = shaderadeHash(i + vec2(1.0, 0.0));",
            "  float c = shaderadeHash(i + vec2(0.0, 1.0));",
            "  float d = shaderadeHash(i + vec2(1.0, 1.0));",
            "  vec2 u = f * f * (3.0 - 2.0 * f);",
            "  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;",
            "}",
          );
        }
        const uvExpr = inputExpr("uv", "vec2");
        const scale = (data.scale as number) ?? 4.0;
        // Octave count is compile-time node data (not a runtime uniform),
        // so the fbm sum is unrolled here in JS rather than as a GLSL loop.
        const octaves = Math.max(1, Math.min(6, Math.round((data.octaves as number) ?? 1)));
        const vn = varName(node.id, "value");
        lines.push(`vec2 ${vn}_uv = (${uvExpr}) * ${formatFloat(scale)};`);
        lines.push(`float ${vn} = 0.0;`);
        lines.push(`{ float amp = 0.5; float freq = 1.0;`);
        for (let o = 0; o < octaves; o++) {
          lines.push(`  ${vn} += amp * shaderadeValueNoise(${vn}_uv * freq); amp *= 0.5; freq *= 2.0;`);
        }
        lines.push(`}`);
        sourceExprMap.set(`${node.id}::value`, { expr: vn, type: "float" });
        break;
      }

      case "SplashTrigger": {
        uniforms["u_time"] = uniforms["u_time"] ?? { type: "float", value: 0 };
        const posExpr = inputExpr("pos", "vec3");
        const speed = (data.speed as number) ?? 1.2;
        const lifetime = Math.max(0.001, (data.lifetime as number) ?? 1.0);
        const width = (data.width as number) ?? 0.06;
        const vn = varName(node.id, "ring");
        lines.push(`float ${vn} = 0.0;`);
        for (let i = 0; i < SPLASH_SLOT_COUNT; i++) {
          const posName = `u_splash${i}Pos`, timeName = `u_splash${i}Time`;
          // Default far in the past — age is always huge, so this slot
          // renders as inactive until triggerSplashAt() (splash.ts) actually
          // writes a real position/time into it.
          uniforms[posName] = uniforms[posName] ?? { type: "vec3", value: [0, 0, 0] };
          uniforms[timeName] = uniforms[timeName] ?? { type: "float", value: -1000 };
          const p = `shaderadeSplash${i}_${node.id}`;
          lines.push(
            `vec3 ${p}Delta = (${posExpr}) - ${posName};`,
            `float ${p}Dist = pow(dot(${p}Delta, ${p}Delta), 0.5);`,
            `float ${p}Age = u_time - ${timeName};`,
            `float ${p}Radius = ${p}Age * ${formatFloat(speed)};`,
            `float ${p}Fade = clamp(1.0 - ${p}Age / ${formatFloat(lifetime)}, 0.0, 1.0);`,
            `float ${p}Inner = smoothstep(${p}Radius - ${formatFloat(width)}, ${p}Radius, ${p}Dist);`,
            `float ${p}Outer = smoothstep(${p}Radius, ${p}Radius + ${formatFloat(width)}, ${p}Dist);`,
            `${vn} += (${p}Inner - ${p}Outer) * ${p}Fade;`,
          );
        }
        sourceExprMap.set(`${node.id}::ring`, { expr: vn, type: "float" });
        break;
      }

      case "Add": {
        const a = inputExpr("a", "vec4"), b = inputExpr("b", "vec4");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = ${a} + ${b};`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }

      case "Subtract": {
        const a = inputExpr("a", "vec4"), b = inputExpr("b", "vec4");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = ${a} - ${b};`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }

      case "Multiply": {
        const a = inputExpr("a", "vec4"), b = inputExpr("b", "vec4");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = ${a} * ${b};`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }

      case "Mix": {
        const a = inputExpr("a", "vec4"), b = inputExpr("b", "vec4"), t = inputExpr("t", "float");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = mix(${a}, ${b}, ${t});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }

      case "Power": {
        const base = inputExpr("base", "float"), exp = inputExpr("exp", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = pow(${base}, ${exp});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Clamp": {
        const val = inputExpr("value", "float"), mn = inputExpr("min", "float"), mx = inputExpr("max", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = clamp(${val}, ${mn}, ${mx});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Step": {
        const edge = inputExpr("edge", "float"), x = inputExpr("x", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = step(${edge}, ${x});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Smoothstep": {
        const e0 = inputExpr("edge0", "float"), e1 = inputExpr("edge1", "float"), x = inputExpr("x", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = smoothstep(${e0}, ${e1}, ${x});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Sin": {
        const x = inputExpr("x", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = sin(${x});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Fract": {
        const x = inputExpr("x", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = fract(${x});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Dot": {
        const a = inputExpr("a", "vec3"), b = inputExpr("b", "vec3");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = dot(${a}, ${b});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Split": {
        const val = inputExpr("value", "vec4");
        const vn = varName(node.id, "v");
        lines.push(`vec4 ${vn} = ${val};`);
        sourceExprMap.set(`${node.id}::x`, { expr: `${vn}.x`, type: "float" });
        sourceExprMap.set(`${node.id}::y`, { expr: `${vn}.y`, type: "float" });
        sourceExprMap.set(`${node.id}::z`, { expr: `${vn}.z`, type: "float" });
        sourceExprMap.set(`${node.id}::w`, { expr: `${vn}.w`, type: "float" });
        break;
      }

      case "Combine": {
        const x = inputExpr("x", "float"), y = inputExpr("y", "float");
        const z = inputExpr("z", "float"), w = inputExpr("w", "float");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = vec4(${x}, ${y}, ${z}, ${w});`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }

      case "OneMinus": {
        const val = inputExpr("value", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = 1.0 - ${val};`);
        sourceExprMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }
    }
  }

  if (!outputNode) {
    return { ok: false, error: "No output node found. Add an Output node." };
  }

  // Compiled early (before uniformDecls below, which reads the `uniforms`
  // record this may add Time/Float entries to) but otherwise independent
  // of the color-output logic that follows.
  let displacementDecls: string[] = [];
  if (displacementNode) {
    const result = compileVertexDisplacement(nodes, targetToSource, displacementNode, uniforms);
    if (!result.ok) return { ok: false, error: result.error };
    displacementDecls = result.declarations;
  }

  const outputData = (outputNode.data ?? {}) as Record<string, unknown>;
  const outputMode = (outputData.outputMode as string) ?? "unlit";
  const getId = (slot: string) => {
    const link = targetToSource.get(`${outputNode!.id}::${slot}`);
    return link ? sourceExprMap.get(`${link.source}::${link.sourceHandle}`) : undefined;
  };

  // Extra top-level GLSL (helper functions, lighting constants) spliced in
  // before main() — only populated for the "pbr" branch below, so unlit
  // shaders stay exactly as lean as before.
  const extraDecls: string[] = [];

  let outputGlsl = "";
  let transparent = false;
  if (outputMode === "unlit") {
    const colorConn = getId("color");
    const colorExpr = colorConn
      ? widenExpr(colorConn.expr, colorConn.type, "vec4")
      : "vec4(0.5, 0.5, 0.5, 1.0)";
    outputGlsl = `gl_FragColor = ${colorExpr};`;
  } else {
    // Simplified lit PBR — not a full Cook-Torrance microfacet model, but
    // roughness/metallic-aware enough that the wired maps visibly matter
    // (bump from the normal map, non-metallic dielectric brick response,
    // etc) rather than the previous flat albedo-only passthrough. Normal
    // mapping uses the screen-space-derivative technique (no precomputed
    // tangents needed, so no vertex-shader/geometry changes required).
    // Light direction is a real uniform (not a const) so the preview can
    // drag a light gizmo around and see the material respond live; default
    // value here is also what a real consumer of the exported shader gets
    // if they never set it themselves.
    // Registering in `uniforms` already makes uniformDecls emit this
    // declaration below — do not also push it into extraDecls, or the
    // duplicate declaration fails GLSL linking (silently: three.js just
    // skips drawing the mesh, no throw, no visible material at all).
    uniforms["u_lightDir"] = { type: "vec3", value: [0.45, 0.8, 0.4] };
    extraDecls.push(
      "const vec3 pbrLightColor = vec3(1.05, 1.02, 0.98);",
      "const vec3 pbrAmbientColor = vec3(0.22, 0.22, 0.25);",
      "vec3 perturbNormal(vec3 N, vec3 worldPos, vec3 mapN, vec2 uv) {",
      "  vec3 q0 = dFdx(worldPos);",
      "  vec3 q1 = dFdy(worldPos);",
      "  vec2 st0 = dFdx(uv);",
      "  vec2 st1 = dFdy(uv);",
      "  vec3 q1perp = cross(q1, N);",
      "  vec3 q0perp = cross(N, q0);",
      "  vec3 T = q1perp * st0.x + q0perp * st1.x;",
      "  vec3 B = q1perp * st0.y + q0perp * st1.y;",
      "  float det = max(dot(T, T), dot(B, B));",
      "  float scale = det == 0.0 ? 0.0 : inversesqrt(det);",
      "  return normalize(T * (mapN.x * scale) + B * (mapN.y * scale) + N * mapN.z);",
      "}",
      // Procedural environment for real-time glass: reflection + refraction
      // sample directions without needing a cubemap asset or raytracing.
      // Matches the preview scene's sky/ground so exported GLSL still looks
      // like glass outside Shaderade.
      "vec3 shaderadeEnv(vec3 dir) {",
      "  vec3 d = normalize(dir);",
      "  float h = d.y;",
      "  vec3 zenith = vec3(0.35, 0.55, 0.95);",
      "  vec3 horizon = vec3(0.78, 0.86, 0.95);",
      "  vec3 groundNear = vec3(0.32, 0.30, 0.28);",
      "  vec3 groundFar = vec3(0.18, 0.20, 0.16);",
      "  vec3 sky = mix(horizon, zenith, smoothstep(0.0, 1.0, h));",
      // Soft sun disc so specular-ish env highlights show up on glass edges.
      "  vec3 sunDir = normalize(vec3(0.45, 0.75, 0.35));",
      "  float sun = pow(max(dot(d, sunDir), 0.0), 64.0);",
      "  sky += vec3(1.0, 0.95, 0.85) * sun * 1.4;",
      // Ground: gentle checker so refraction visibly warps something.
      "  float checker = step(0.0, sin(d.x * 18.0) * sin(d.z * 18.0));",
      "  vec3 ground = mix(groundNear, groundFar, checker * 0.35 + 0.15);",
      "  return mix(ground, sky, smoothstep(-0.08, 0.06, h));",
      "}",
    );

    const albedo = getId("albedo");
    const albedoExpr = albedo ? widenExpr(albedo.expr, albedo.type, "vec3") : `vec3(${PBR_DEFAULTS.albedo.join(", ")})`;
    const normalConn = getId("normal");
    const roughnessConn = getId("roughness");
    const metallicConn = getId("metallic");
    const aoConn = getId("ao");
    const emissiveConn = getId("emissive");
    // Raw uniform name (not a value expression) — see the EnvironmentMap
    // case above for why this doesn't go through widenExpr like the others.
    const envMapConn = getId("envMap");
    const envMapUniform = envMapConn && envMapConn.type === "sampler2D" ? envMapConn.expr : null;
    // shaderadeEnvSample() is the single call-site glass actually uses:
    // delegates to the real equirect texture when one's wired, otherwise
    // falls back to the procedural sky above — existing graphs with nothing
    // wired here compile byte-identical to before this feature existed.
    extraDecls.push(
      envMapUniform
        ? [
            "vec2 shaderadeEquirectUv(vec3 d) {",
            "  return vec2(atan(d.z, d.x) / 6.28318530718 + 0.5, acos(clamp(d.y, -1.0, 1.0)) / 3.14159265359);",
            "}",
            `vec3 shaderadeEnvSample(vec3 dir) { return texture2D(${envMapUniform}, shaderadeEquirectUv(normalize(dir))).rgb; }`,
          ].join("\n")
        : "vec3 shaderadeEnvSample(vec3 dir) { return shaderadeEnv(dir); }"
    );
    const roughnessExpr = roughnessConn ? widenExpr(roughnessConn.expr, roughnessConn.type, "float") : formatFloat(PBR_DEFAULTS.roughness);
    const metallicExpr = metallicConn ? widenExpr(metallicConn.expr, metallicConn.type, "float") : formatFloat(PBR_DEFAULTS.metallic);
    const aoExpr = aoConn ? widenExpr(aoConn.expr, aoConn.type, "float") : formatFloat(PBR_DEFAULTS.ao);
    const emissiveExpr = emissiveConn ? widenExpr(emissiveConn.expr, emissiveConn.type, "vec3") : `vec3(${PBR_DEFAULTS.emissive.join(", ")})`;
    const normalYFlip = (outputData.normalYFlip as boolean) === true;
    // Multipliers on top of whatever the connected map (or default) already
    // produces — not connectable input slots, just tunable knobs edited via
    // the node inspector panel, so they're read straight off outputData.
    const normalStrength = (outputData.normalStrength as number) ?? 1;
    const aoStrength = (outputData.aoStrength as number) ?? 1;
    const roughnessStrength = (outputData.roughnessStrength as number) ?? 1;
    const emissiveStrength = (outputData.emissiveStrength as number) ?? 1;
    // ior defaults to 1.5 (glass), which yields the exact same 0.04 F0
    // dielectric reflectance this shader already hardcoded — so existing
    // graphs (which never set ior) render pixel-identical to before.
    // transmission defaults to 0, which zeroes out every new term below,
    // for the same reason.
    const ior = (outputData.ior as number) ?? 1.5;
    const transmission = (outputData.transmission as number) ?? 0;
    transparent = transmission > 0;
    // Off by default so existing graphs — and every export target, none of
    // which can run the required back-face depth pass without extra
    // integration work on the consumer's end — keep today's exact flat-tint
    // look unless a creator explicitly opts in.
    const thicknessAware = transmission > 0 && (outputData.thicknessAware as boolean) === true;
    const absorptionDensity = (outputData.absorptionDensity as number) ?? 1.2;
    if (thicknessAware) {
      uniforms["u_backfaceDepth"] = { type: "sampler2D", value: null };
      uniforms["u_resolution"] = { type: "vec2", value: [1, 1] };
      uniforms["u_camNear"] = { type: "float", value: 0.1 };
      uniforms["u_camFar"] = { type: "float", value: 100 };
    }

    lines.push(`vec3 pbrN = normalize(vNormal);`);
    if (normalConn) {
      const rawExpr = widenExpr(normalConn.expr, normalConn.type, "vec3");
      lines.push(`vec3 pbrMapN = ${rawExpr} * 2.0 - 1.0;`);
      if (normalYFlip) lines.push(`pbrMapN.y = -pbrMapN.y;`);
      // Scaling the tangent-space XY before renormalizing is the standard
      // "normal strength" technique — 0 flattens the bump entirely, 1 is
      // the map's authored intensity, >1 exaggerates it.
      lines.push(`pbrMapN.xy *= ${formatFloat(normalStrength)};`);
      lines.push(`pbrN = perturbNormal(pbrN, vWorldPos, pbrMapN, vUv);`);
    }
    lines.push(
      `vec3 pbrLightDir = normalize(u_lightDir);`,
      `vec3 pbrV = normalize(vViewDir);`,
      `vec3 pbrH = normalize(pbrLightDir + pbrV);`,
      `float pbrRough = clamp((${roughnessExpr}) * ${formatFloat(roughnessStrength)}, 0.04, 1.0);`,
      `float pbrMetal = clamp(${metallicExpr}, 0.0, 1.0);`,
      `float pbrAo = mix(1.0, clamp(${aoExpr}, 0.0, 1.0), ${formatFloat(aoStrength)});`,
      `vec3 pbrAlbedo = ${albedoExpr};`,
      `vec3 pbrEmissive = (${emissiveExpr}) * ${formatFloat(emissiveStrength)};`,
      `float pbrNdotL = max(dot(pbrN, pbrLightDir), 0.0);`,
      `float pbrShininess = mix(128.0, 4.0, pbrRough);`,
      // F0 (normal-incidence reflectance) derived from IOR via Schlick's
      // approximation — ior=1.5 (default) gives F0=0.04.
      `float pbrF0 = pow((${formatFloat(ior)} - 1.0) / (${formatFloat(ior)} + 1.0), 2.0);`,
      `float pbrFresnel = pbrF0 + (1.0 - pbrF0) * pow(1.0 - max(dot(pbrN, pbrV), 0.0), 5.0);`,
      `vec3 pbrSpecColor = mix(vec3(pbrF0), pbrAlbedo, pbrMetal);`,
      `float pbrSpec = pow(max(dot(pbrN, pbrH), 0.0), pbrShininess) * (1.0 - pbrRough);`,
      `vec3 pbrDiffuse = pbrAlbedo * (1.0 - pbrMetal) * pbrNdotL * pbrLightColor;`,
      `vec3 pbrAmbient = pbrAlbedo * pbrAmbientColor;`,
      `vec3 pbrOpaque = (pbrAmbient + pbrDiffuse) * pbrAo + pbrSpecColor * pbrSpec * pbrLightColor + pbrEmissive;`,
    );

    if (transmission > 0) {
      // Real-time glass: IOR drives Snell's-law refraction (GLSL refract)
      // and Schlick Fresnel reflection. Not raytracing — we sample a
      // procedural environment along reflect/refract dirs — but this is
      // what makes glass *look* like glass (bent sky/ground, bright rims).
      // Chromatic split on the refract eta sells the "prism" look a bit.
      //
      // Incident vector for reflect/refract is toward the surface (−V).
      // eta = n_air / n_material for viewing from outside.
      lines.push(
        `float pbrTrans = ${formatFloat(transmission)};`,
        `float pbrEta = 1.0 / max(${formatFloat(ior)}, 1.001);`,
        `vec3 pbrI = -pbrV;`,
        `vec3 pbrReflDir = reflect(pbrI, pbrN);`,
        // Roughness blurs env lookup by jittering the sample direction
        // with a cheap hash of screen position — not a true mip blur,
        // but frosted glass reads when roughness is high.
        `vec2 pbrJitter = fract(sin(gl_FragCoord.xy * vec2(12.9898, 78.233)) * 43758.5453);`,
        `vec3 pbrRoughOff = (vec3(pbrJitter.x, pbrJitter.y, pbrJitter.x - pbrJitter.y) * 2.0 - 1.0) * pbrRough * 0.35;`,
        `vec3 pbrReflected = shaderadeEnvSample(normalize(pbrReflDir + pbrRoughOff));`,
        // RGB chromatic aberration via slightly different IOR per channel.
        `vec3 pbrRefrR = refract(pbrI, pbrN, pbrEta * 0.97);`,
        `vec3 pbrRefrG = refract(pbrI, pbrN, pbrEta);`,
        `vec3 pbrRefrB = refract(pbrI, pbrN, pbrEta * 1.03);`,
        // Total internal reflection → refract() returns 0; fall back to reflection.
        `vec3 pbrRefracted;`,
        `if (dot(pbrRefrG, pbrRefrG) < 1e-6) {`,
        `  pbrRefracted = pbrReflected;`,
        `} else {`,
        `  pbrRefracted = vec3(`,
        `    shaderadeEnvSample(normalize(pbrRefrR + pbrRoughOff)).r,`,
        `    shaderadeEnvSample(normalize(pbrRefrG + pbrRoughOff)).g,`,
        `    shaderadeEnvSample(normalize(pbrRefrB + pbrRoughOff)).b`,
        `  );`,
        `}`,
        // Albedo tints the transmitted light (stained glass); reflection
        // stays mostly white/env-colored for dielectrics. Real thickness
        // (below) replaces this flat blend with actual Beer-Lambert falloff
        // when a back-face depth pass is available; otherwise this flat
        // approximation is all there is to go on.
        ...(thicknessAware
          ? [
              // Reconstruct linear-space depth from both the current
              // (front) fragment and the back-face depth texture, via the
              // standard perspective un-projection formula, then the
              // difference is how much glass this ray actually passed
              // through — real Beer-Lambert absorption instead of a flat
              // blend. Tinted glass absorbs its complementary colors more
              // over distance, so it reads darker/more saturated where
              // it's thicker rather than a uniform tint everywhere.
              `vec2 pbrScreenUv = gl_FragCoord.xy / u_resolution;`,
              `float pbrBackDepth = texture2D(u_backfaceDepth, pbrScreenUv).r;`,
              `float pbrFrontLinear = (2.0 * u_camNear * u_camFar) / (u_camFar + u_camNear - (gl_FragCoord.z * 2.0 - 1.0) * (u_camFar - u_camNear));`,
              `float pbrBackLinear = (2.0 * u_camNear * u_camFar) / (u_camFar + u_camNear - (pbrBackDepth * 2.0 - 1.0) * (u_camFar - u_camNear));`,
              `float pbrThickness = max(0.0, pbrBackLinear - pbrFrontLinear);`,
              `vec3 pbrAbsorb = exp(-(vec3(1.0) - pbrAlbedo) * pbrThickness * ${formatFloat(absorptionDensity)});`,
              `pbrRefracted *= pbrAbsorb;`,
            ]
          : [`pbrRefracted *= mix(vec3(1.0), pbrAlbedo, 0.85);`]),
        `vec3 pbrGlass = mix(pbrRefracted, pbrReflected, pbrFresnel);`,
        // Keep a sharp specular lobe from the scene light so the gizmo
        // still lights the glass.
        `pbrGlass += pbrSpecColor * pbrSpec * pbrLightColor * (0.35 + 0.65 * pbrFresnel);`,
        `pbrGlass += pbrEmissive;`,
        `vec3 pbrLit = mix(pbrOpaque, pbrGlass, pbrTrans);`,
        // With env-based refraction the "see-through" is already in RGB,
        // so keep alpha high. Slight Fresnel edge opacity helps over
        // busy backgrounds when transmission is partial.
        `float pbrAlpha = mix(1.0, mix(0.92, 1.0, pbrFresnel), pbrTrans);`,
      );
    } else {
      lines.push(
        `vec3 pbrLit = pbrOpaque;`,
        `float pbrAlpha = 1.0;`,
      );
    }
    outputGlsl = `gl_FragColor = vec4(pbrLit, pbrAlpha);`;
  }

  // Uniform declarations
  const uniformDecls = Object.entries(uniforms)
    .map(([name, spec]) => `uniform ${spec.type} ${name};`)
    .join("\n");

  const varyingDecls = [
    "varying vec2 vUv;",
    "varying vec3 vNormal;",
    "varying vec3 vWorldPos;",
    "varying vec3 vViewDir;",
  ].join("\n");

  const fragmentShader = [
    // perturbNormal() uses dFdx/dFdy — core built-ins in GLSL ES 3.00.
    // three.js's ShaderMaterial always upgrades to #version 300 es and
    // injects its own declarations before this array's user content, so a
    // manual "#extension GL_OES_standard_derivatives" pragma here is NOT a
    // harmless no-op — it lands after those injected declarations, which is
    // invalid pragma placement, and the WebGL1 extension name is meaningless
    // under ES 3.00 regardless. Previously present here; removed because it
    // made every PBR-mode shader fail to link (silently — three.js logs a
    // console error and just skips the draw call, no visible material at all).
    "precision mediump float;",
    varyingDecls,
    uniformDecls,
    ...helperDecls,
    ...extraDecls,
    "void main() {",
    ...lines.map((l) => `  ${l}`),
    `  ${outputGlsl}`,
    "}",
  ].join("\n");

  // Off by default (unskinned graphs get byte-identical vertex shaders to
  // before this existed). On: real skinning math using Three.js's own
  // bone-texture convention (matching what MeshStandardMaterial actually
  // does), not hand-rolled bone math — for materials meant to go on an
  // animated THREE.SkinnedMesh rather than a static mesh. Requires the
  // consuming material to also set `material.skinning = true` (a Three.js
  // material flag, not shader code) so the renderer actually binds
  // bindMatrix/bindMatrixInverse/boneTexture — noted in the Three.js
  // export wrapper.
  const skinned = (outputData.skinned as boolean) === true;

  const skinningDecls = skinned ? [
    "attribute vec4 skinIndex;",
    "attribute vec4 skinWeight;",
    "uniform mat4 bindMatrix;",
    "uniform mat4 bindMatrixInverse;",
    "uniform highp sampler2D boneTexture;",
    "mat4 getBoneMatrix(const in float i) {",
    "  int size = textureSize(boneTexture, 0).x;",
    "  int j = int(i) * 4;",
    "  int x = j % size;",
    "  int y = j / size;",
    "  vec4 v1 = texelFetch(boneTexture, ivec2(x, y), 0);",
    "  vec4 v2 = texelFetch(boneTexture, ivec2(x + 1, y), 0);",
    "  vec4 v3 = texelFetch(boneTexture, ivec2(x + 2, y), 0);",
    "  vec4 v4 = texelFetch(boneTexture, ivec2(x + 3, y), 0);",
    "  return mat4(v1, v2, v3, v4);",
    "}",
  ] : [];

  const skinningApply = skinned ? [
    "mat4 boneMatX = getBoneMatrix(skinIndex.x);",
    "mat4 boneMatY = getBoneMatrix(skinIndex.y);",
    "mat4 boneMatZ = getBoneMatrix(skinIndex.z);",
    "mat4 boneMatW = getBoneMatrix(skinIndex.w);",
    "vec4 skinVertex = bindMatrix * vec4(transformed, 1.0);",
    "vec4 skinnedPos = vec4(0.0);",
    "skinnedPos += boneMatX * skinVertex * skinWeight.x;",
    "skinnedPos += boneMatY * skinVertex * skinWeight.y;",
    "skinnedPos += boneMatZ * skinVertex * skinWeight.z;",
    "skinnedPos += boneMatW * skinVertex * skinWeight.w;",
    "transformed = (bindMatrixInverse * skinnedPos).xyz;",
    "mat4 skinMatrix = mat4(0.0);",
    "skinMatrix += skinWeight.x * boneMatX;",
    "skinMatrix += skinWeight.y * boneMatY;",
    "skinMatrix += skinWeight.z * boneMatZ;",
    "skinMatrix += skinWeight.w * boneMatW;",
    "skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;",
    "objectNormal = (skinMatrix * vec4(objectNormal, 0.0)).xyz;",
  ] : [];

  // Only emitted when a VertexDisplacement node is present — an unaffected
  // graph's vertex shader text is byte-identical to before this feature
  // existed. Runs after skinning (so a displaced+skinned combination
  // displaces the already-skinned position, the more physically sensible
  // order) and derives a real rippled normal via finite differences rather
  // than just moving vertices with stale flat normals.
  const displacementApply = displacementNode ? [
    "float shaderadeDispEps = 0.1;",
    "float shaderadeH0 = shaderadeVertexHeight(transformed);",
    "float shaderadeHX = shaderadeVertexHeight(transformed + vec3(shaderadeDispEps, 0.0, 0.0));",
    "float shaderadeHZ = shaderadeVertexHeight(transformed + vec3(0.0, 0.0, shaderadeDispEps));",
    "vec3 shaderadeTanX = vec3(shaderadeDispEps, shaderadeHX - shaderadeH0, 0.0);",
    "vec3 shaderadeTanZ = vec3(0.0, shaderadeHZ - shaderadeH0, shaderadeDispEps);",
    "vec3 shaderadeRippleNormal = normalize(cross(shaderadeTanZ, shaderadeTanX));",
    "transformed += objectNormal * shaderadeH0;",
    "objectNormal = shaderadeRippleNormal;",
  ] : [];

  const vertexShader = [
    ...skinningDecls,
    "varying vec2 vUv;",
    "varying vec3 vNormal;",
    "varying vec3 vWorldPos;",
    "varying vec3 vViewDir;",
    // Only needed once uniforms can appear in the vertex shader (i.e. once
    // displacement exists), gated the same as uniformDecls below rather
    // than added unconditionally — keeps every graph without displacement
    // byte-identical to before this feature existed. GLSL requires a
    // uniform's precision to match across every stage that declares it, and
    // the fragment shader always declares its own "precision mediump
    // float;" — omitting this here (the vertex shader's implicit default is
    // highp) caused exactly that link error the one time this was tried
    // without it.
    ...(displacementNode ? ["precision mediump float;"] : []),
    // Only declared when needed (displacement's Time/Float/etc. nodes) —
    // an unused-but-declared uniform is harmless GLSL, but there's no
    // reason to add the noise otherwise. Must come before displacementDecls
    // below: GLSL requires globals declared before whatever references them,
    // and shaderadeVertexHeight() (in displacementDecls) reads these.
    ...(displacementNode ? [uniformDecls] : []),
    ...displacementDecls,
    "void main() {",
    "  vUv = uv;",
    "  vec3 transformed = position;",
    "  vec3 objectNormal = normal;",
    ...skinningApply.map((l) => `  ${l}`),
    ...displacementApply.map((l) => `  ${l}`),
    // True world-space normal (assumes uniform scale — modelMatrix's
    // upper-left 3x3 is not inverse-transposed here, which would matter
    // for non-uniform scale). Previously used `normalMatrix`, which is
    // view-space in a raw ShaderMaterial — mismatched with vWorldPos/
    // vViewDir (both world-space), which the WorldNormal node and Fresnel
    // node were silently relying on despite the name promising "world".
    "  vNormal = normalize(mat3(modelMatrix) * objectNormal);",
    "  vec4 worldPos = modelMatrix * vec4(transformed, 1.0);",
    "  vWorldPos = worldPos.xyz;",
    "  vViewDir = normalize(cameraPosition - worldPos.xyz);",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);",
    "}",
  ].join("\n");

  // Real inverted-hull toon outline, compiled as its own tiny separate
  // shader pair (not folded into the main one — a single fragment shader
  // can't draw an outline around itself). Only a directly-wired Color
  // node is read for the fill color; anything else (a computed
  // expression) falls back to a default near-black outline — the outline
  // is meant to be a simple flat color, not a full shading graph.
  let outline: { vertexShader: string; fragmentShader: string; uniforms: Record<string, UniformSpec> } | undefined;
  if (outlineNode) {
    const outlineData = (outlineNode.data ?? {}) as Record<string, unknown>;
    const thickness = (outlineData.thickness as number) ?? 0.02;

    const link = targetToSource.get(`${outlineNode.id}::color`);
    const srcNode = link ? nodes.find((n) => n.id === link.source) : undefined;
    const srcData = (srcNode?.data ?? {}) as Record<string, unknown>;
    const [cr, cg, cb] = srcNode?.type === "Color"
      ? [(srcData.r as number) ?? 0, (srcData.g as number) ?? 0, (srcData.b as number) ?? 0]
      : [0.05, 0.05, 0.05];

    const outlineVertexShader = [
      "void main() {",
      // Extruding in local (pre-modelMatrix) space along the vertex
      // normal, then rendered with side: THREE.BackSide — front-facing
      // parts of this shell hide behind the main mesh's own surface, only
      // the silhouette edges poke out, the standard inverted-hull outline.
      `  vec3 extruded = position + normalize(normal) * ${formatFloat(thickness)};`,
      "  gl_Position = projectionMatrix * modelViewMatrix * vec4(extruded, 1.0);",
      "}",
    ].join("\n");

    const outlineFragmentShader = [
      "precision mediump float;",
      `void main() { gl_FragColor = vec4(${formatFloat(cr)}, ${formatFloat(cg)}, ${formatFloat(cb)}, 1.0); }`,
    ].join("\n");

    outline = { vertexShader: outlineVertexShader, fragmentShader: outlineFragmentShader, uniforms: {} };
  }

  return { ok: true, fragmentShader, vertexShader, uniforms, transparent, skinned, outline };
}
