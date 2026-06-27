"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { CompileResult } from "@/lib/shader-graph/compiler";

type Props = {
  compiled: CompileResult | null;
};

export default function ShaderPreview({ compiled }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const clockRef = useRef(new THREE.Clock());

  // One-time scene setup
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0e0b08");

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 2.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const mat = new THREE.ShaderMaterial({
      vertexShader: [
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
      ].join("\n"),
      fragmentShader: [
        "precision mediump float;",
        "varying vec2 vUv;",
        "varying vec3 vNormal;",
        "varying vec3 vWorldPos;",
        "varying vec3 vViewDir;",
        "void main() {",
        "  gl_FragColor = vec4(vNormal * 0.5 + 0.5, 1.0);",
        "}",
      ].join("\n"),
    });
    materialRef.current = mat;

    const geo = new THREE.SphereGeometry(1, 64, 48);
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const tick = () => {
      // Animate time uniform
      if (mat.uniforms.u_time) {
        mat.uniforms.u_time.value = clockRef.current.getElapsedTime();
      }
      mesh.rotation.y += 0.003;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      geo.dispose();
      mat.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  // Update material when compiled shader changes
  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;

    if (!compiled || !compiled.ok) return;

    mat.vertexShader = compiled.vertexShader;
    mat.fragmentShader = compiled.fragmentShader;

    // Rebuild uniforms
    const next: Record<string, THREE.IUniform> = {};
    for (const [name, spec] of Object.entries(compiled.uniforms)) {
      if (spec.type === "float") {
        next[name] = { value: spec.value ?? 0 };
      } else if (spec.type === "vec2") {
        const v = spec.value as number[] ?? [0, 0];
        next[name] = { value: new THREE.Vector2(v[0], v[1]) };
      } else if (spec.type === "vec3") {
        const v = spec.value as number[] ?? [0, 0, 0];
        next[name] = { value: new THREE.Vector3(v[0], v[1], v[2]) };
      } else if (spec.type === "vec4") {
        const v = spec.value as number[] ?? [0, 0, 0, 1];
        next[name] = { value: new THREE.Vector4(v[0], v[1], v[2], v[3]) };
      } else if (spec.type === "sampler2D") {
        next[name] = { value: null };
      }
    }
    mat.uniforms = next;
    mat.needsUpdate = true;
  }, [compiled]);

  return <div ref={mountRef} className="w-full h-full" />;
}
