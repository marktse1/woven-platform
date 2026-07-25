// Engine-specific wrapper generators for compiled GLSL shaders.

import type { UniformSpec } from "./compiler";

type Compiled = {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, UniformSpec>;
  transparent: boolean;
  skinned: boolean;
  outline?: { vertexShader: string; fragmentShader: string; uniforms: Record<string, UniformSpec> };
};

// u_backfaceDepth only means something once something renders the mesh's
// own back faces to a depth texture first — Shaderade's own live preview
// does this automatically, but nothing in an exported engine snippet can
// set that up on its own, so each generator below prefixes this uniform
// with concrete instructions instead of the usual generic sampler2D
// fallback comment.
const BACKFACE_DEPTH_NOTE_THREE = `  // Thickness-aware glass: bind this to a depth texture from a back-face
  // pass. Before your main render call each frame — render this same mesh
  // with { side: THREE.BackSide } into a THREE.WebGLRenderTarget that has
  // a THREE.DepthTexture attached, then set this uniform's value to that
  // depthTexture. Also update u_resolution/u_camNear/u_camFar (below) from
  // your real camera/renderer every frame.
`;
const BACKFACE_DEPTH_NOTE_BABYLON = `// Thickness-aware glass: "u_backfaceDepth" needs a depth texture from a
// back-face pass. Before your main render call each frame — render this
// same mesh with backFaceCulling reversed into a BABYLON.RenderTargetTexture
// (depth-only), then setTexture("u_backfaceDepth", ...) with it. Also
// update u_resolution/u_camNear/u_camFar from your real camera/engine size
// every frame.
`;
const BACKFACE_DEPTH_NOTE_PLAYCANVAS = `// Thickness-aware glass: "u_backfaceDepth" needs a depth texture from a
// back-face pass. Before your main render call each frame — render this
// same mesh (front-face culled) into a pc.RenderTarget with a depth
// buffer/texture attached, then setParameter("u_backfaceDepth", ...) with
// it. Also update u_resolution/u_camNear/u_camFar from your real
// camera/device every frame.
`;
const BACKFACE_DEPTH_NOTE_GLSL = ` *
 *   u_backfaceDepth needs a depth texture from a back-face pass: render
 *   this same mesh's back faces (cull front faces) into a depth texture
 *   before your main draw call, then bind it here. Also update
 *   u_resolution/u_camNear/u_camFar from your real camera/viewport every
 *   frame.`;

// u_lightDir is frozen at whatever direction was set in Shaderade's
// preview (default or wherever the light gizmo was dragged) — it's just a
// uniform value like any other, nothing keeps it in sync with a real
// scene light automatically. Toon/banded lighting in particular will look
// static/wrong the moment your actual light moves unless you update this
// yourself, same as u_time already needs.
const LIGHT_DIR_NOTE_THREE = `  // Update every frame to match your real scene light, e.g.:
  // material.uniforms.u_lightDir.value.copy(sunDirection);
`;
const LIGHT_DIR_NOTE_BABYLON = `// Update every frame to match your real scene light, e.g.:
// shaderMaterial.setVector3("u_lightDir", sunDirection);
`;
const LIGHT_DIR_NOTE_PLAYCANVAS = `// Update every frame to match your real scene light, e.g.:
// material.setParameter("u_lightDir", [sun.x, sun.y, sun.z]);
`;
const LIGHT_DIR_NOTE_GLSL = ` *
 *   u_lightDir won't track a moving light on its own — update it every
 *   frame from your real scene light direction, the same way you'd
 *   already need to update u_time.`;

function uniformsToThree(uniforms: Record<string, UniformSpec>): string {
  const entries = Object.entries(uniforms).map(([name, spec]) => {
    let value = "null";
    let prefix = "";
    if (spec.type === "float") value = `{ value: ${spec.value ?? 0} }`;
    else if (spec.type === "vec2") value = `{ value: new THREE.Vector2(${(spec.value as number[] ?? [0, 0]).join(", ")}) }`;
    else if (spec.type === "vec3") {
      value = `{ value: new THREE.Vector3(${(spec.value as number[] ?? [0, 0, 0]).join(", ")}) }`;
      if (name === "u_lightDir") prefix = LIGHT_DIR_NOTE_THREE;
    }
    else if (spec.type === "vec4") value = `{ value: new THREE.Vector4(${(spec.value as number[] ?? [0, 0, 0, 1]).join(", ")}) }`;
    else if (spec.type === "sampler2D") {
      const url = typeof spec.value === "string" ? spec.value : null;
      value = url ? `{ value: new THREE.TextureLoader().load(${JSON.stringify(url)}) }` : `{ value: null }`;
      // A trailing `//` comment on the same line as the value would eat the
      // entry's own trailing comma (everything after `//` is a comment,
      // comma included), silently breaking the object literal for whatever
      // uniform comes next — so any explanatory note goes on its own
      // preceding line instead, never appended after a real value.
      if (name === "u_backfaceDepth") prefix = BACKFACE_DEPTH_NOTE_THREE;
      else if (!url) prefix = `  // "${name}": no texture wired — assign a THREE.Texture\n`;
    }
    return `${prefix}  ${name}: ${value},`;
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
  transparent: ${compiled.transparent},
});
${compiled.skinned ? `
// This material expects a THREE.SkinnedMesh (skinIndex/skinWeight
// attributes + a real skeleton) — skinning=true is what makes Three.js
// actually bind bindMatrix/bindMatrixInverse/boneTexture for it each frame.
material.skinning = true;
` : ''}
// Apply to a mesh:
// mesh.material = material;

// Animate (inside your render loop):
// material.uniforms.u_time.value = clock.getElapsedTime();
${compiled.outline ? `
// Toon outline — a second, slightly-extruded, back-face-only copy of the
// SAME mesh rendered behind the main one, so only its silhouette peeks
// out as a rim.
const outlineMaterial = new THREE.ShaderMaterial({
  vertexShader: \`
${compiled.outline.vertexShader}
\`,
  fragmentShader: \`
${compiled.outline.fragmentShader}
\`,
  side: THREE.BackSide,
});

// Apply alongside the main material, reusing the same mesh's geometry
// (replace \`mesh\` with whatever you assigned \`material\` to above):
// const outlineMesh = new THREE.Mesh(mesh.geometry, outlineMaterial);
// mesh.add(outlineMesh); // rides along with the main mesh's own transform
` : ''}`;
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
      if (name === "u_lightDir") lines.push(LIGHT_DIR_NOTE_BABYLON.trimEnd());
      lines.push(`shaderMaterial.setVector3("${name}", new BABYLON.Vector3(${v.join(", ")}));`);
    } else if (spec.type === "vec4") {
      const v = spec.value as number[] ?? [0, 0, 0, 1];
      lines.push(`shaderMaterial.setVector4("${name}", new BABYLON.Vector4(${v.join(", ")}));`);
    } else if (spec.type === "sampler2D") {
      const url = typeof spec.value === "string" ? spec.value : null;
      if (name === "u_backfaceDepth") {
        lines.push(`${BACKFACE_DEPTH_NOTE_BABYLON}// shaderMaterial.setTexture("u_backfaceDepth", yourBackfaceDepthTexture);`);
      } else {
        lines.push(
          url
            ? `shaderMaterial.setTexture("${name}", new BABYLON.Texture(${JSON.stringify(url)}, scene));`
            : `// "${name}": no texture wired — shaderMaterial.setTexture("${name}", yourTexture);`,
        );
      }
    }
  }
  return lines.join("\n");
}

const SKINNING_NOTE_BABYLON = `// NOTE: this shader's skinning code (skinIndex/skinWeight attributes,
// bindMatrix/boneTexture uniforms) is written in Three.js's convention —
// Babylon.js skins meshes completely differently (matricesIndices/
// matricesWeights attributes, its own bone uniform buffer via
// BABYLON.Skeleton). The vertex shader below will need real adaptation to
// Babylon's skinning API, not just a rename.
`;

export function exportBabylon(compiled: Compiled): string {
  const uniformNames = Object.keys(compiled.uniforms);
  const samplers = uniformNames.filter((n) => compiled.uniforms[n].type === "sampler2D");
  const scalars = uniformNames.filter((n) => compiled.uniforms[n].type !== "sampler2D");

  return `// Babylon.js — paste into your scene setup
${compiled.skinned ? SKINNING_NOTE_BABYLON : ''}const shaderMaterial = new BABYLON.ShaderMaterial("shaderade", scene, {
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
${compiled.transparent ? '\nshaderMaterial.needAlphaBlending = () => true;\n' : ''}
// Uniform/texture values, as currently wired in Shaderade:
${babylonSetterCalls(compiled.uniforms)}

// Apply to a mesh:
// mesh.material = shaderMaterial;
${compiled.outline ? `
// Toon outline — a second, slightly-extruded copy of the same mesh so
// only its silhouette peeks out as a rim behind the main material. The
// shader itself is simple/portable GLSL; wiring the second draw call is
// Babylon-specific:
//
// const outlineMaterial = new BABYLON.ShaderMaterial("outline", scene, {
//   vertexSource: \`${compiled.outline.vertexShader}\`,
//   fragmentSource: \`${compiled.outline.fragmentShader}\`,
// }, { attributes: ["position", "normal"], uniforms: [] });
// const outlineMesh = mesh.clone("outline");
// outlineMesh.material = outlineMaterial;
//
// This needs Babylon's equivalent of THREE.BackSide — i.e. render only
// this shell's back faces, not both/front — which Babylon controls via
// sideOrientation/cull-mode, not a simple boolean. Check Babylon's current
// docs for the right call in your version rather than guessing here;
// getting this wrong shows the outline over the whole surface instead of
// just as a rim.
` : ''}`;
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
      if (name === "u_lightDir") lines.push(LIGHT_DIR_NOTE_PLAYCANVAS.trimEnd());
      lines.push(`material.setParameter("${name}", [${v.join(", ")}]);`);
    } else if (spec.type === "vec4") {
      const v = spec.value as number[] ?? [0, 0, 0, 1];
      lines.push(`material.setParameter("${name}", [${v.join(", ")}]);`);
    } else if (spec.type === "sampler2D") {
      const url = typeof spec.value === "string" ? spec.value : null;
      if (name === "u_backfaceDepth") {
        lines.push(`${BACKFACE_DEPTH_NOTE_PLAYCANVAS}// material.setParameter("u_backfaceDepth", yourBackfaceDepthTexture);`);
      } else {
        lines.push(
          url
            ? `app.assets.loadFromUrl(${JSON.stringify(url)}, "texture", (err, asset) => {\n  if (!err) material.setParameter("${name}", asset.resource);\n});`
            : `// "${name}": no texture wired — load a pc.Texture and material.setParameter("${name}", texture);`,
        );
      }
    }
  }
  return lines.join("\n");
}

const SKINNING_NOTE_PLAYCANVAS = `// NOTE: this shader's skinning code (skinIndex/skinWeight attributes,
// bindMatrix/boneTexture uniforms) is written in Three.js's convention —
// PlayCanvas skins meshes completely differently (its own pc.Skin /
// bone-matrix-palette attribute and uniform conventions). The vertex
// shader below will need real adaptation to PlayCanvas's skinning API,
// not just a rename.
`;

export function exportPlayCanvas(compiled: Compiled): string {
  return `// PlayCanvas — paste into a Script component
${compiled.skinned ? SKINNING_NOTE_PLAYCANVAS : ''}const device = app.graphicsDevice;

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
${compiled.transparent ? 'material.blendType = pc.BLEND_NORMAL;\n' : ''}// entity.model.meshInstances[0].material = material;

// Uniform/texture values, as currently wired in Shaderade:
${playcanvasParamCalls(compiled.uniforms)}
${compiled.outline ? `
// Toon outline — a second, slightly-extruded copy of the same mesh so
// only its silhouette peeks out as a rim behind the main material.
const outlineShader = new pc.Shader(device, {
  attributes: { aPosition: pc.SEMANTIC_POSITION, aNormal: pc.SEMANTIC_NORMAL },
  vshader: \`
${compiled.outline.vertexShader}
\`,
  fshader: \`
${compiled.outline.fragmentShader}
\`,
});
const outlineMaterial = new pc.Material();
outlineMaterial.shader = outlineShader;
outlineMaterial.cull = pc.CULLFACE_FRONT; // render only back faces — the
  // outline shell's front faces should hide behind the main mesh's surface
// Apply outlineMaterial to a second mesh instance sharing the same
// geometry (a cloned/duplicated entity), same pattern as the main
// material above.
` : ''}`;
}

// Raw GLSL has no uniform-binding syntax of its own to hang real values
// off of — list them as a comment block instead, so the texture URLs
// aren't lost entirely when copying just the shader source.
function glslUniformComment(uniforms: Record<string, UniformSpec>): string {
  const entries = Object.entries(uniforms);
  if (entries.length === 0) return "";
  const lines = entries.map(([name, spec]) => {
    if (spec.type === "sampler2D") {
      if (name === "u_backfaceDepth") {
        return ` *   ${name}: (no texture wired)\n${BACKFACE_DEPTH_NOTE_GLSL}`;
      }
      const url = typeof spec.value === "string" ? spec.value : null;
      return ` *   ${name}: ${url ?? "(no texture wired)"}`;
    }
    if (spec.type === "vec3" && name === "u_lightDir") {
      return ` *   ${name}: ${JSON.stringify(spec.value)}\n${LIGHT_DIR_NOTE_GLSL}`;
    }
    return ` *   ${name}: ${JSON.stringify(spec.value)}`;
  });
  return `/* Uniform values, as currently wired in Shaderade:\n${lines.join("\n")}\n */\n\n`;
}

const SKINNING_NOTE_GLSL = `/* NOTE: this shader's skinning code (skinIndex/skinWeight attributes,
   bindMatrix/boneTexture uniforms) is written in Three.js's convention.
   Other engines skin meshes differently — adapt the attribute/uniform
   names and bone-matrix lookup to whatever actually consumes this. */

`;

export function exportGlsl(compiled: Compiled): string {
  const transparencyNote = compiled.transparent
    ? "/* This fragment shader writes a non-1.0 alpha (transmission > 0) — enable\n   alpha blending on whatever material/pipeline you attach it to. */\n\n"
    : "";
  const skinningNote = compiled.skinned ? SKINNING_NOTE_GLSL : "";
  const outlineBlock = compiled.outline
    ? `\n/* ── outline (toon rim) ──
 *   A second, slightly-extruded copy of the same mesh rendered BEHIND the
 *   main material so only its silhouette peeks out as a rim. Needs its own
 *   draw call with back-face-only culling (THREE.BackSide or your engine's
 *   equivalent) — rendering both sides shows it over the whole surface
 *   instead of just as a rim.
 */
/* ── outline.vertex.glsl ── */
${compiled.outline.vertexShader}

/* ── outline.fragment.glsl ── */
${compiled.outline.fragmentShader}
`
    : "";
  return `${transparencyNote}${skinningNote}${glslUniformComment(compiled.uniforms)}/* ── vertex.glsl ── */
${compiled.vertexShader}

/* ── fragment.glsl ── */
${compiled.fragmentShader}
${outlineBlock}`;
}
