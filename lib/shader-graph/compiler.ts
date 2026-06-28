// Compiles a shader graph (nodes + edges) into a GLSL fragment shader string.
// Steps: topological sort → emit declarations → emit main body → assemble.

import type { Node, Edge } from "@xyflow/react";
import { getNodeDef, type GlslType } from "./nodes";

export type ShaderGraph = {
  nodes: Node[];
  edges: Edge[];
};

export type CompileResult =
  | { ok: true; fragmentShader: string; vertexShader: string; uniforms: Record<string, UniformSpec> }
  | { ok: false; error: string };

export type UniformSpec = {
  type: "float" | "vec2" | "vec3" | "vec4" | "sampler2D";
  value: number | number[] | string | null;
};

// Widen float → vec to satisfy a connection
function widenExpr(expr: string, from: GlslType, to: GlslType): string {
  if (from === to) return expr;
  if (from === "float") {
    if (to === "vec2") return `vec2(${expr})`;
    if (to === "vec3") return `vec3(${expr})`;
    if (to === "vec4") return `vec4(${expr}, 1.0)`;
  }
  if (from === "vec3" && to === "vec4") return `vec4(${expr}, 1.0)`;
  if (from === "vec4" && to === "vec3") return `(${expr}).rgb`;
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

  // Build edge lookup: target node+slot → source expr and type
  const edgeMap = new Map<string, { expr: string; type: GlslType }>();
  for (const e of edges) {
    const key = `${e.target}::${e.targetHandle}`;
    edgeMap.set(key, { expr: varName(e.source, e.sourceHandle ?? ""), type: "float" });
  }

  const uniforms: Record<string, UniformSpec> = {};
  const lines: string[] = [];
  let outputNode: Node | null = null;

  for (const node of sorted) {
    const def = getNodeDef(node.type as string);
    if (!def) continue;
    const data = (node.data ?? {}) as Record<string, unknown>;

    if (def.category === "output") {
      outputNode = node;
      continue;
    }

    // Helper: get expression for an input slot (connected or default)
    const inputExpr = (slotId: string, expectedType: GlslType): string => {
      const key = `${node.id}::${slotId}`;
      const conn = edgeMap.get(key);
      if (conn) return widenExpr(conn.expr, conn.type, expectedType);
      return glslTypeDefault(expectedType);
    };

    switch (node.type) {
      case "UV":
        lines.push(`vec2 ${varName(node.id, "uv")} = vUv;`);
        edgeMap.set(`${node.id}::uv`, { expr: varName(node.id, "uv"), type: "vec2" });
        break;

      case "WorldPosition":
        lines.push(`vec3 ${varName(node.id, "pos")} = vWorldPos;`);
        edgeMap.set(`${node.id}::pos`, { expr: varName(node.id, "pos"), type: "vec3" });
        break;

      case "WorldNormal":
        lines.push(`vec3 ${varName(node.id, "normal")} = vNormal;`);
        edgeMap.set(`${node.id}::normal`, { expr: varName(node.id, "normal"), type: "vec3" });
        break;

      case "Time": {
        const uName = `u_time`;
        uniforms[uName] = { type: "float", value: 0 };
        lines.push(`float ${varName(node.id, "time")} = ${uName};`);
        edgeMap.set(`${node.id}::time`, { expr: varName(node.id, "time"), type: "float" });
        break;
      }

      case "Float": {
        const val = (data.value as number) ?? 0;
        const uName = `u_float_${node.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
        uniforms[uName] = { type: "float", value: val };
        lines.push(`float ${varName(node.id, "value")} = ${uName};`);
        edgeMap.set(`${node.id}::value`, { expr: varName(node.id, "value"), type: "float" });
        break;
      }

      case "Color": {
        const r = (data.r as number) ?? 1, g = (data.g as number) ?? 1;
        const b = (data.b as number) ?? 1, a = (data.a as number) ?? 1;
        const uName = `u_color_${node.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
        uniforms[uName] = { type: "vec4", value: [r, g, b, a] };
        lines.push(`vec4 ${varName(node.id, "color")} = ${uName};`);
        edgeMap.set(`${node.id}::color`, { expr: varName(node.id, "color"), type: "vec4" });
        break;
      }

      case "Texture2D": {
        const uName = (data.uniformName as string) || `u_tex_${node.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
        uniforms[uName] = { type: "sampler2D", value: (data.imageUrl as string) ?? null };
        const uvExpr = inputExpr("uv", "vec2");
        const vn = varName(node.id, "color");
        lines.push(`vec4 ${vn} = texture2D(${uName}, ${uvExpr});`);
        edgeMap.set(`${node.id}::color`, { expr: vn, type: "vec4" });
        edgeMap.set(`${node.id}::rgb`, { expr: `${vn}.rgb`, type: "vec3" });
        edgeMap.set(`${node.id}::r`, { expr: `${vn}.r`, type: "float" });
        edgeMap.set(`${node.id}::g`, { expr: `${vn}.g`, type: "float" });
        edgeMap.set(`${node.id}::b`, { expr: `${vn}.b`, type: "float" });
        edgeMap.set(`${node.id}::a`, { expr: `${vn}.a`, type: "float" });
        break;
      }

      case "Fresnel": {
        const normalExpr = inputExpr("normal", "vec3");
        const powerExpr = inputExpr("power", "float");
        const vn = varName(node.id, "fresnel");
        lines.push(`float ${vn} = pow(1.0 - clamp(dot(normalize(${normalExpr}), normalize(vViewDir)), 0.0, 1.0), ${powerExpr});`);
        edgeMap.set(`${node.id}::fresnel`, { expr: vn, type: "float" });
        break;
      }

      case "Add": {
        const a = inputExpr("a", "vec4"), b = inputExpr("b", "vec4");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = ${a} + ${b};`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }

      case "Subtract": {
        const a = inputExpr("a", "vec4"), b = inputExpr("b", "vec4");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = ${a} - ${b};`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }

      case "Multiply": {
        const a = inputExpr("a", "vec4"), b = inputExpr("b", "vec4");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = ${a} * ${b};`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }

      case "Mix": {
        const a = inputExpr("a", "vec4"), b = inputExpr("b", "vec4"), t = inputExpr("t", "float");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = mix(${a}, ${b}, ${t});`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }

      case "Power": {
        const base = inputExpr("base", "float"), exp = inputExpr("exp", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = pow(${base}, ${exp});`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Clamp": {
        const val = inputExpr("value", "float"), mn = inputExpr("min", "float"), mx = inputExpr("max", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = clamp(${val}, ${mn}, ${mx});`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Step": {
        const edge = inputExpr("edge", "float"), x = inputExpr("x", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = step(${edge}, ${x});`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Smoothstep": {
        const e0 = inputExpr("edge0", "float"), e1 = inputExpr("edge1", "float"), x = inputExpr("x", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = smoothstep(${e0}, ${e1}, ${x});`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Sin": {
        const x = inputExpr("x", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = sin(${x});`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Dot": {
        const a = inputExpr("a", "vec3"), b = inputExpr("b", "vec3");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = dot(${a}, ${b});`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }

      case "Split": {
        const val = inputExpr("value", "vec4");
        const vn = varName(node.id, "v");
        lines.push(`vec4 ${vn} = ${val};`);
        edgeMap.set(`${node.id}::x`, { expr: `${vn}.x`, type: "float" });
        edgeMap.set(`${node.id}::y`, { expr: `${vn}.y`, type: "float" });
        edgeMap.set(`${node.id}::z`, { expr: `${vn}.z`, type: "float" });
        edgeMap.set(`${node.id}::w`, { expr: `${vn}.w`, type: "float" });
        break;
      }

      case "Combine": {
        const x = inputExpr("x", "float"), y = inputExpr("y", "float");
        const z = inputExpr("z", "float"), w = inputExpr("w", "float");
        const vn = varName(node.id, "result");
        lines.push(`vec4 ${vn} = vec4(${x}, ${y}, ${z}, ${w});`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "vec4" });
        break;
      }

      case "OneMinus": {
        const val = inputExpr("value", "float");
        const vn = varName(node.id, "result");
        lines.push(`float ${vn} = 1.0 - ${val};`);
        edgeMap.set(`${node.id}::result`, { expr: vn, type: "float" });
        break;
      }
    }
  }

  if (!outputNode) {
    return { ok: false, error: "No output node found. Add an Output node." };
  }

  const outputData = (outputNode.data ?? {}) as Record<string, unknown>;
  const outputMode = (outputData.outputMode as string) ?? "unlit";
  const getId = (slot: string) => edgeMap.get(`${outputNode!.id}::${slot}`);

  let outputGlsl = "";
  if (outputMode === "unlit") {
    const colorConn = getId("color");
    const colorExpr = colorConn
      ? widenExpr(colorConn.expr, colorConn.type, "vec4")
      : "vec4(0.5, 0.5, 0.5, 1.0)";
    outputGlsl = `gl_FragColor = ${colorExpr};`;
  } else {
    const albedo = getId("albedo");
    const albedoExpr = albedo ? widenExpr(albedo.expr, albedo.type, "vec3") : "vec3(0.5)";
    outputGlsl = `gl_FragColor = vec4(${albedoExpr}, 1.0);`;
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
    "precision mediump float;",
    varyingDecls,
    uniformDecls,
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
    "  vNormal = normalize(normalMatrix * normal);",
    "  vec4 worldPos = modelMatrix * vec4(position, 1.0);",
    "  vWorldPos = worldPos.xyz;",
    "  vViewDir = normalize(cameraPosition - worldPos.xyz);",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}",
  ].join("\n");

  return { ok: true, fragmentShader, vertexShader, uniforms };
}
