"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// Experimental WebGPU tech demo — genuinely different from every other
// material in Shaderade. It's NOT a node-graph-compiled recipe: WebGPU ray
// marching needs compute/WGSL-style shader code (authored here via
// Three.js's TSL node system), not the GLSL string-concatenation
// lib/shader-graph/compiler.ts produces. Not exportable to the four code
// tabs, not editable via the node graph — a fixed showcase of what real
// screen-space ray-marched reflection/refraction against the actual scene
// (not a procedural sky) looks like, vs. the rasterized approximation in
// the Non-RT Glass template.
//
// Every TSL/WebGPURenderer API used below (Fn, Loop, pass(), sample(),
// getScreenPosition, perspectiveDepthToViewZ, toVar/addAssign, etc.) was
// checked against this project's actual installed @types/three (matched
// to the installed three@0.184.0) before writing this, so the API surface
// is real — but this specific rendering path could not be executed in
// this environment (this sandbox's headless browser has no WebGPU device
// at all), unlike everything else built this session, which was verified
// end-to-end. Please treat this one as needing your own real-browser
// verification.

type Status = "loading" | "ready" | "unsupported" | "error";

export default function RTGlassPreview() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    async function setup() {
      // TS can't carry the outer null-check's narrowing into a closure that
      // might run at an arbitrary later time (this one's async) — re-assert
      // here rather than non-null-asserting every later use of `mount`.
      if (!mount) return;

      if (!("gpu" in navigator)) {
        setStatus("unsupported");
        return;
      }

      try {
        // Dynamic imports: these pull in Three.js's WebGPU backend + TSL
        // node system, which is a meaningfully large chunk of code not
        // needed by the rest of Shaderade's (WebGL-only) preview.
        const { WebGPURenderer, MeshBasicNodeMaterial } = await import("three/webgpu");
        const {
          Fn, Loop, If, Break, reflect, refract, normalize, mix, dot, float, vec3,
          positionView, normalView, cameraNear, cameraFar, cameraProjectionMatrix,
          getScreenPosition, perspectiveDepthToViewZ, pass,
        } = await import("three/tsl");

        const renderer = new WebGPURenderer({ antialias: true });
        await renderer.init();
        if (disposed) { renderer.dispose(); return; }

        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        mount.appendChild(renderer.domElement);

        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.set(0, 0.35, 2.8);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.minDistance = 1.6;
        controls.maxDistance = 6;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.6;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;

        // Two scenes sharing the same dressing (ground + colored props),
        // built from separate mesh/light instances (Three.js objects can
        // only belong to one scene) — mainScene is what's actually shown
        // and contains the glass sphere; envScene is the same dressing
        // WITHOUT the glass sphere, captured each frame as the color+depth
        // buffer the glass ray-marches against, so it can't see itself.
        function buildDressing(target: THREE.Scene) {
          target.background = new THREE.Color(0x8caedd);
          const groundGeo = new THREE.PlaneGeometry(12, 12);
          const groundMat = new THREE.MeshStandardMaterial({ color: 0x24211c, roughness: 0.9 });
          const ground = new THREE.Mesh(groundGeo, groundMat);
          ground.rotation.x = -Math.PI / 2;
          ground.position.y = -1.05;
          target.add(ground);

          const propColors = [0xe8875a, 0x56a6e8, 0x7bc96f];
          propColors.forEach((color, i) => {
            const p = new THREE.Mesh(
              new THREE.BoxGeometry(0.28, 0.28, 0.28),
              new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1 }),
            );
            const angle = (i / propColors.length) * Math.PI * 2 + 0.4;
            p.position.set(Math.cos(angle) * 1.55, -0.9, Math.sin(angle) * 1.55);
            target.add(p);
          });

          target.add(new THREE.AmbientLight(0xffffff, 0.55));
          const key = new THREE.DirectionalLight(0xfff2dd, 0.9);
          key.position.set(2, 4, 1);
          target.add(key);
        }

        const mainScene = new THREE.Scene();
        const envScene = new THREE.Scene();
        buildDressing(mainScene);
        buildDressing(envScene);

        // Captures envScene's color + depth each frame — the real thing
        // the glass ray-marches against, instead of a procedural sky.
        const envPass = pass(envScene, camera);
        const envColor = envPass.getTextureNode();
        const envDepth = envPass.getTextureNode("depth");

        const IOR = 1.5;
        const MAX_STEPS = 32;
        const STEP_SIZE = 0.08;

        // Screen-space ray march through the captured depth buffer: step
        // along the reflect/refract direction in view space, and at each
        // step check whether the march has gone "behind" the real scene
        // geometry at that screen position (comparing linearized depths) —
        // the standard technique real-time SSR uses, applied here to both
        // reflection and refraction instead of just reflection.
        const marchNode = Fn(([dir]: [typeof normalView]) => {
          const pos = positionView.toVar();
          const hitColor = vec3(0, 0, 0).toVar();
          const hit = float(0).toVar();

          Loop({ start: 0, end: MAX_STEPS }, () => {
            pos.addAssign(dir.mul(STEP_SIZE));
            const screenPos = getScreenPosition(pos, cameraProjectionMatrix);
            If(screenPos.x.lessThan(0).or(screenPos.x.greaterThan(1)).or(screenPos.y.lessThan(0)).or(screenPos.y.greaterThan(1)), () => {
              Break();
            });
            const sampledDepth = envDepth.sample(screenPos).r;
            const sceneViewZ = perspectiveDepthToViewZ(sampledDepth, cameraNear, cameraFar);
            If(pos.z.lessThanEqual(sceneViewZ), () => {
              hitColor.assign(envColor.sample(screenPos).rgb);
              hit.assign(float(1));
              Break();
            });
          });

          // No hit within the march distance — fall back to the captured
          // color at the fragment's own screen position rather than black.
          const fallback = envColor.sample(getScreenPosition(positionView, cameraProjectionMatrix)).rgb;
          return mix(fallback, hitColor, hit);
        });

        const glassMaterial = new MeshBasicNodeMaterial();
        glassMaterial.colorNode = Fn(() => {
          const N = normalize(normalView);
          const V = normalize(positionView);
          const incident = V;
          const reflectDir = normalize(reflect(incident, N));
          const refractDir = normalize(refract(incident, N, float(1 / IOR)));
          const fresnel = dot(N.negate(), V).oneMinus().pow(3).clamp(0, 1);

          const reflected = marchNode(reflectDir);
          const refracted = marchNode(refractDir);
          return mix(refracted, reflected, fresnel);
        })();

        const glassGeo = new THREE.SphereGeometry(1, 64, 48);
        const glassMesh = new THREE.Mesh(glassGeo, glassMaterial);
        mainScene.add(glassMesh);

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

        setStatus("ready");

        renderer.setAnimationLoop(() => {
          controls.update();
          renderer.render(mainScene, camera);
        });

        cleanup = () => {
          ro.disconnect();
          controls.dispose();
          renderer.setAnimationLoop(null);
          renderer.dispose();
          glassGeo.dispose();
          if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
        };
      } catch (err) {
        console.error("RT Glass (WebGPU) failed to initialize:", err);
        if (!disposed) {
          setErrorMessage(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }
    }

    setup();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full" />
      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0e0b08] text-center px-6">
          {status === "loading" && <p className="text-[12px] text-dim">Loading WebGPU…</p>}
          {status === "unsupported" && (
            <p className="text-[12px] text-dim max-w-xs">
              This browser doesn&apos;t support WebGPU, so this experimental demo can&apos;t run here. Try a recent
              Chrome/Edge on desktop.
            </p>
          )}
          {status === "error" && (
            <p className="text-[12px] text-dim max-w-xs">
              RT Glass failed to start: {errorMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
