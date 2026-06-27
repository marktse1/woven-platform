// Engine-specific wrapper generators for compiled GLSL shaders.

import type { UniformSpec } from "./compiler";

type Compiled = {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, UniformSpec>;
};

function uniformsToThree(uniforms: Record<string, UniformSpec>): string {
  const entries = Object.entries(uniforms).map(([name, spec]) => {
    let value = "null";
    if (spec.type === "float") value = `{ value: ${spec.value ?? 0} }`;
    else if (spec.type === "vec2") value = `{ value: new THREE.Vector2(${(spec.value as number[] ?? [0, 0]).join(", ")}) }`;
    else if (spec.type === "vec3") value = `{ value: new THREE.Vector3(${(spec.value as number[] ?? [0, 0, 0]).join(", ")}) }`;
    else if (spec.type === "vec4") value = `{ value: new THREE.Vector4(${(spec.value as number[] ?? [0, 0, 0, 1]).join(", ")}) }`;
    else if (spec.type === "sampler2D") value = `{ value: null } // assign a THREE.Texture`;
    return `  ${name}: ${value},`;
  });
  return `{\n${entries.join("\n")}\n}`;
}

export function exportThreeJs(compiled: Compiled): string {
  return `// Three.js — paste into your scene setup
import * as THREE from 'three';

const material = new THREE.ShaderMaterial({
  vertexShader: \`
${compiled.vertexShader}
\`,
  fragmentShader: \`
${compiled.fragmentShader}
\`,
  uniforms: ${uniformsToThree(compiled.uniforms)},
});

// Apply to a mesh:
// mesh.material = material;

// Animate (inside your render loop):
// material.uniforms.u_time.value = clock.getElapsedTime();
`;
}

export function exportBabylon(compiled: Compiled): string {
  const uniformNames = Object.keys(compiled.uniforms);
  const samplers = uniformNames.filter((n) => compiled.uniforms[n].type === "sampler2D");
  const scalars = uniformNames.filter((n) => compiled.uniforms[n].type !== "sampler2D");

  return `// Babylon.js — paste into your scene setup
const shaderMaterial = new BABYLON.ShaderMaterial("shaderade", scene, {
  vertexSource: \`
${compiled.vertexShader}
\`,
  fragmentSource: \`
${compiled.fragmentShader}
\`,
}, {
  attributes: ["position", "normal", "uv"],
  uniforms: ${JSON.stringify(scalars, null, 2)},
  samplers: ${JSON.stringify(samplers, null, 2)},
});

// Apply to a mesh:
// mesh.material = shaderMaterial;
`;
}

export function exportPlayCanvas(compiled: Compiled): string {
  return `// PlayCanvas — paste into a Script component
const device = app.graphicsDevice;

const shader = new pc.Shader(device, {
  attributes: { aPosition: pc.SEMANTIC_POSITION, aNormal: pc.SEMANTIC_NORMAL, aUv0: pc.SEMANTIC_TEXCOORD0 },
  vshader: \`
${compiled.vertexShader}
\`,
  fshader: \`
${compiled.fragmentShader}
\`,
});

const material = new pc.Material();
material.shader = shader;
// entity.model.meshInstances[0].material = material;
`;
}

export function exportGlsl(compiled: Compiled): string {
  return `/* ── vertex.glsl ── */
${compiled.vertexShader}

/* ── fragment.glsl ── */
${compiled.fragmentShader}
`;
}
