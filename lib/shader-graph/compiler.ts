// Compiles a shader graph (nodes + edges) into a GLSL fragment shader string.
// Steps: topological sort → emit declarations → emit main body → assemble.

import type { Node, Edge } from "@xyflow/react";
import { getNodeDef, type GlslType } from "./nodes";

export type ShaderGraph = {
  nodes: Node[];
  edges: Edge[];
};

export type CompileResult =
  | { ok: true; fragmentShader: string; vertexShader: string; uniforms: Record<string, UniformSpec>; transparent: boolean }
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
    if (to === "vec4") return `vec4(${expr}, 1.0)`;
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

  // Noise's hash/value-noise helper is emitted at most once regardless of
  // how many Noise nodes are in the graph.
  let noiseHelpersEmitted = false;
  const helperDecls: string[] = [];

  for (const node of sorted) {
    const def = getNodeDef(node.type as string);
    if (!def) continue;
    const data = (node.data ?? {}) as Record<string, unknown>;

    if (def.category === "output") {
      outputNode = node;
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
    );

    const albedo = getId("albedo");
    const albedoExpr = albedo ? widenExpr(albedo.expr, albedo.type, "vec3") : `vec3(${PBR_DEFAULTS.albedo.join(", ")})`;
    const normalConn = getId("normal");
    const roughnessConn = getId("roughness");
    const metallicConn = getId("metallic");
    const aoConn = getId("ao");
    const emissiveConn = getId("emissive");
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
      // approximation — this is the actual physical effect IOR has on
      // appearance. ior=1.5 (the default) gives F0=0.04, matching the
      // dielectric constant this shader always hardcoded, so this is a
      // strict generalization, not a behavior change at the default.
      `float pbrF0 = pow((${formatFloat(ior)} - 1.0) / (${formatFloat(ior)} + 1.0), 2.0);`,
      `float pbrFresnel = pbrF0 + (1.0 - pbrF0) * pow(1.0 - max(dot(pbrN, pbrV), 0.0), 5.0);`,
      `vec3 pbrSpecColor = mix(vec3(pbrF0), pbrAlbedo, pbrMetal);`,
      `float pbrSpec = pow(max(dot(pbrN, pbrH), 0.0), pbrShininess) * (1.0 - pbrRough);`,
      `vec3 pbrDiffuse = pbrAlbedo * (1.0 - pbrMetal) * pbrNdotL * pbrLightColor;`,
      `vec3 pbrAmbient = pbrAlbedo * pbrAmbientColor;`,
      `vec3 pbrLit = (pbrAmbient + pbrDiffuse) * pbrAo + pbrSpecColor * pbrSpec * pbrLightColor + pbrEmissive;`,
      // Grazing-angle Fresnel edge brightening — "glass"-like rim
      // reflectivity — scaled directly by transmission (0 by default, so
      // no contribution unless a creator dials transmission up).
      `pbrLit += pbrFresnel * pbrLightColor * ${formatFloat(transmission)};`,
      `float pbrAlpha = mix(1.0, pbrFresnel, ${formatFloat(transmission)});`,
    );
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

  const vertexShader = [
    "varying vec2 vUv;",
    "varying vec3 vNormal;",
    "varying vec3 vWorldPos;",
    "varying vec3 vViewDir;",
    "void main() {",
    "  vUv = uv;",
    // True world-space normal (assumes uniform scale — modelMatrix's
    // upper-left 3x3 is not inverse-transposed here, which would matter
    // for non-uniform scale). Previously used `normalMatrix`, which is
    // view-space in a raw ShaderMaterial — mismatched with vWorldPos/
    // vViewDir (both world-space), which the WorldNormal node and Fresnel
    // node were silently relying on despite the name promising "world".
    "  vNormal = normalize(mat3(modelMatrix) * normal);",
    "  vec4 worldPos = modelMatrix * vec4(position, 1.0);",
    "  vWorldPos = worldPos.xyz;",
    "  vViewDir = normalize(cameraPosition - worldPos.xyz);",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}",
  ].join("\n");

  return { ok: true, fragmentShader, vertexShader, uniforms, transparent };
}
