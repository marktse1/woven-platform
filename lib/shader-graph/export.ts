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
    else if (spec.type === "sampler2D") {
      const url = typeof spec.value === "string" ? spec.value : null;
      value = url
        ? `{ value: new THREE.TextureLoader().load(${JSON.stringify(url)}) }`
        : `{ value: null } // no texture wired — assign a THREE.Texture`;
    }
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

// Babylon's ShaderMaterial doesn't take uniform values inline — you declare
// which names are uniforms/samplers at construction, then set their actual
// values via setter calls afterward. Emit real setter calls (with the real
// wired texture URLs/scalar values) rather than leaving that step to the
// reader — previously this only listed the uniform *names*.
function babylonSetterCalls(uniforms: Record<string, UniformSpec>): string {
  const lines: string[] = [];
  for (const [name, spec] of Object.entries(uniforms)) {
    if (spec.type === "float") {
      lines.push(`shaderMaterial.setFloat("${name}", ${spec.value ?? 0});`);
    } else if (spec.type === "vec2") {
      const v = spec.value as number[] ?? [0, 0];
      lines.push(`shaderMaterial.setVector2("${name}", new BABYLON.Vector2(${v.join(", ")}));`);
    } else if (spec.type === "vec3") {
      const v = spec.value as number[] ?? [0, 0, 0];
      lines.push(`shaderMaterial.setVector3("${name}", new BABYLON.Vector3(${v.join(", ")}));`);
    } else if (spec.type === "vec4") {
      const v = spec.value as number[] ?? [0, 0, 0, 1];
      lines.push(`shaderMaterial.setVector4("${name}", new BABYLON.Vector4(${v.join(", ")}));`);
    } else if (spec.type === "sampler2D") {
      const url = typeof spec.value === "string" ? spec.value : null;
      lines.push(
        url
          ? `shaderMaterial.setTexture("${name}", new BABYLON.Texture(${JSON.stringify(url)}, scene));`
          : `// "${name}": no texture wired — shaderMaterial.setTexture("${name}", yourTexture);`,
      );
    }
  }
  return lines.join("\n");
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

// Uniform/texture values, as currently wired in Shaderade:
${babylonSetterCalls(compiled.uniforms)}

// Apply to a mesh:
// mesh.material = shaderMaterial;
`;
}

// PlayCanvas custom-shader materials take uniform values via
// material.setParameter(name, value) — textures specifically need an actual
// pc.Texture, not a bare URL, so a real texture goes through the asset
// loader first. Emit the real wired URLs (as loader calls for textures,
// direct setParameter calls for scalars) instead of leaving every uniform
// unset.
function playcanvasParamCalls(uniforms: Record<string, UniformSpec>): string {
  const lines: string[] = [];
  for (const [name, spec] of Object.entries(uniforms)) {
    if (spec.type === "float") {
      lines.push(`material.setParameter("${name}", ${spec.value ?? 0});`);
    } else if (spec.type === "vec2") {
      const v = spec.value as number[] ?? [0, 0];
      lines.push(`material.setParameter("${name}", [${v.join(", ")}]);`);
    } else if (spec.type === "vec3") {
      const v = spec.value as number[] ?? [0, 0, 0];
      lines.push(`material.setParameter("${name}", [${v.join(", ")}]);`);
    } else if (spec.type === "vec4") {
      const v = spec.value as number[] ?? [0, 0, 0, 1];
      lines.push(`material.setParameter("${name}", [${v.join(", ")}]);`);
    } else if (spec.type === "sampler2D") {
      const url = typeof spec.value === "string" ? spec.value : null;
      lines.push(
        url
          ? `app.assets.loadFromUrl(${JSON.stringify(url)}, "texture", (err, asset) => {\n  if (!err) material.setParameter("${name}", asset.resource);\n});`
          : `// "${name}": no texture wired — load a pc.Texture and material.setParameter("${name}", texture);`,
      );
    }
  }
  return lines.join("\n");
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

// Uniform/texture values, as currently wired in Shaderade:
${playcanvasParamCalls(compiled.uniforms)}
`;
}

// Raw GLSL has no uniform-binding syntax of its own to hang real values
// off of — list them as a comment block instead, so the texture URLs
// aren't lost entirely when copying just the shader source.
function glslUniformComment(uniforms: Record<string, UniformSpec>): string {
  const entries = Object.entries(uniforms);
  if (entries.length === 0) return "";
  const lines = entries.map(([name, spec]) => {
    if (spec.type === "sampler2D") {
      const url = typeof spec.value === "string" ? spec.value : null;
      return ` *   ${name}: ${url ?? "(no texture wired)"}`;
    }
    return ` *   ${name}: ${JSON.stringify(spec.value)}`;
  });
  return `/* Uniform values, as currently wired in Shaderade:\n${lines.join("\n")}\n */\n\n`;
}

export function exportGlsl(compiled: Compiled): string {
  return `${glslUniformComment(compiled.uniforms)}/* ── vertex.glsl ── */
${compiled.vertexShader}

/* ── fragment.glsl ── */
${compiled.fragmentShader}
`;
}
