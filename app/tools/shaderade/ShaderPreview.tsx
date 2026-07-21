"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CompileResult } from "@/lib/shader-graph/compiler";

type Props = {
  compiled: CompileResult | null;
  /** 0 (black) to 1 (white) — lets you check the material's contrast against different backdrops. */
  bgLightness?: number;
};

// Distance of the draggable light gizmo from the preview sphere's center —
// outside the unit sphere so it's always visible and easy to grab.
const LIGHT_ORBIT_RADIUS = 1.8;

export default function ShaderPreview({ compiled, bgLightness = 0.05 }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const clockRef = useRef(new THREE.Clock());
  const prevTexturesRef = useRef<THREE.Texture[]>([]);
  // Persists across recompiles so editing an unrelated node doesn't snap a
  // dragged light back to the shader's default direction.
  const lightDirRef = useRef(new THREE.Vector3(0.45, 0.8, 0.4).normalize());

  // One-time scene setup
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color().setScalar(bgLightness);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 2.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    // Drag to orbit, scroll to zoom — no pan, so the material always stays
    // centered. Auto-rotates when idle so the preview isn't static, and
    // OrbitControls itself pauses that the moment you grab and drag.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 6;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

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

    // Draggable light gizmo — a small unlit sphere marking the current
    // light direction. Only shown while the compiled material actually
    // declares a u_lightDir uniform (pbr mode) — dragging it would have no
    // visible effect on an unlit material.
    const lightGeo = new THREE.SphereGeometry(0.09, 20, 16);
    const lightMat = new THREE.MeshBasicMaterial({ color: "#ffe89a" });
    const lightGizmo = new THREE.Mesh(lightGeo, lightMat);
    lightGizmo.position.copy(lightDirRef.current).multiplyScalar(LIGHT_ORBIT_RADIUS);
    lightGizmo.visible = false;
    scene.add(lightGizmo);

    const raycaster = new THREE.Raycaster();
    const dragSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), LIGHT_ORBIT_RADIUS);
    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();
    let draggingLight = false;

    function setNdcFromEvent(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function onPointerDown(e: PointerEvent) {
      if (!lightGizmo.visible) return;
      setNdcFromEvent(e);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(lightGizmo, false);
      if (hits.length === 0) return;
      draggingLight = true;
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (!draggingLight) return;
      setNdcFromEvent(e);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectSphere(dragSphere, hitPoint)) {
        lightDirRef.current.copy(hitPoint).normalize();
        lightGizmo.position.copy(hitPoint);
        if (mat.uniforms.u_lightDir) {
          (mat.uniforms.u_lightDir.value as THREE.Vector3).copy(lightDirRef.current);
        }
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (!draggingLight) return;
      draggingLight = false;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(e.pointerId)) {
        renderer.domElement.releasePointerCapture(e.pointerId);
      }
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

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
      lightGizmo.visible = !!mat.uniforms.u_lightDir;
      controls.update();
      try {
        renderer.render(scene, camera);
      } catch (err) {
        // A bad uniform/texture must never kill the loop permanently — log
        // and keep ticking so the preview can recover on the next compile.
        console.error("Shaderade preview render failed:", err);
      } finally {
        raf = requestAnimationFrame(tick);
      }
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      renderer.dispose();
      geo.dispose();
      mat.dispose();
      lightGeo.dispose();
      lightMat.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  // Live-update the background without tearing down the whole scene.
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color().setScalar(bgLightness);
    }
  }, [bgLightness]);

  // Update material when compiled shader changes
  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;

    if (!compiled || !compiled.ok) return;

    mat.vertexShader = compiled.vertexShader;
    mat.fragmentShader = compiled.fragmentShader;
    mat.transparent = compiled.transparent;

    // Dispose textures from the previous compile to avoid GPU leaks
    for (const tex of prevTexturesRef.current) tex.dispose();
    prevTexturesRef.current = [];

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
        if (spec.value && typeof spec.value === "string") {
          const url = spec.value;
          if (url.startsWith("data:") || url.startsWith("blob:")) {
            // Already same-origin — never CORS-tainted, safe to load directly.
            const tex = new THREE.TextureLoader().load(url);
            tex.flipY = false;
            prevTexturesRef.current.push(tex);
            next[name] = { value: tex };
          } else {
            // Remote (e.g. signed Supabase) URLs: loading these straight into
            // an <img crossOrigin="anonymous"> can leave the image CORS-tainted,
            // which throws a SecurityError deep inside the WebGL texture
            // upload the moment this material is rendered. Fetching the bytes
            // ourselves and loading from a blob: URL sidesteps that entirely —
            // blob URLs are always same-origin.
            const tex = new THREE.Texture();
            tex.flipY = false;
            prevTexturesRef.current.push(tex);
            fetch(url)
              .then((r) => {
                if (!r.ok) throw new Error(`texture fetch failed: ${r.status}`);
                return r.blob();
              })
              .then(
                (blob) =>
                  new Promise<void>((resolve, reject) => {
                    const objectUrl = URL.createObjectURL(blob);
                    const img = new Image();
                    img.onload = () => {
                      tex.image = img;
                      tex.needsUpdate = true;
                      URL.revokeObjectURL(objectUrl);
                      resolve();
                    };
                    img.onerror = () => {
                      URL.revokeObjectURL(objectUrl);
                      reject(new Error("image decode failed"));
                    };
                    img.src = objectUrl;
                  })
              )
              .catch((err) => {
                console.error("Shaderade preview: failed to load texture", url, err);
              });
            next[name] = { value: tex };
          }
        } else {
          next[name] = { value: null };
        }
      }
    }
    // Preserve whatever light direction the user already dragged to,
    // instead of letting a recompile reset it to the shader's default.
    if (next.u_lightDir) {
      next.u_lightDir = { value: lightDirRef.current.clone() };
    }
    mat.uniforms = next;
    mat.needsUpdate = true;
  }, [compiled]);

  return <div ref={mountRef} className="w-full h-full" />;
}
