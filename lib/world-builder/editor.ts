// Ported from ~/threejs-world-builder/src/main.ts. This file exports
// initWorldBuilder(container), called from a useEffect in
// components/tools/WorldBuilderViewer.tsx (see that file for the
// mount/cleanup wiring — the React boundary is deliberately kept out of
// this file so the ported logic stays close to its original shape).
//
// Rapier physics removed for this pass (editor-convenience "playtest"
// feature, not core to authoring — see the plan). Vite's import.meta.env
// doesn't exist under Next.js, so the VITE_* env-driven URL overrides are
// gone too. Phase E: the asset catalog and level load/save are wired to
// lib/assets.ts / lib/world-builder/levels.ts (real per-user Supabase
// storage), replacing the standalone editor's local dev-server fetches.
// The manifest-URL/catalog-URL inputs and the local-storage backup/export
// paths are left in place as a harmless fallback and browser safety net.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Water as ThreeWater } from "three/examples/jsm/objects/Water.js";
import { TextureLoader } from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import JSZip from "jszip";
import {
  AssetDefinition,
  LevelLayout,
  PlacedObjectData,
  RoadShaderSettings,
  SceneNodeData,
  SkyGradientSettings,
  TerrainChunkData,
  TerrainBrushMode,
  TerrainDistrictSettings,
  TerrainShaderSettings,
  TerrainSpline,
  WaterSurfaceSettings,
  chunkIdForCoords,
  defaultSkyGradient,
  defaultTerrainSettings,
  defaultWaterSettings,
  generateTerrainChunks,
  sampleTerrainHeight,
  sampleWaterSurfaceOffset,
  sculptTerrainAt,
  TERRAIN_CHUNK_SIZE,
  TERRAIN_RESOLUTION,
  TERRAIN_SPACING,
  terrainBrushWeight,
} from "./schema";
import { getAsset, listVisibleAssets, signedAssetUrl, type AssetRow } from "@/lib/assets";
import { loadLevel, saveLevel, listVisibleLevels, type WorldLevelRow } from "./levels";

const STORAGE_KEY = "woven-threejs-world-builder-layout";
const SKY_STORAGE_KEY = "woven-threejs-world-builder-sky";
const PANEL_STORAGE_KEY = "woven-threejs-world-builder-panels";
const PANEL_SIZE_STORAGE_KEY = "woven-threejs-world-builder-panel-sizes";
const LIGHTING_STORAGE_KEY = "woven-threejs-world-builder-lighting";
const ASSET_CATALOG_STORAGE_KEY = "woven-threejs-world-builder-asset-catalog";
const ASSET_CATALOG_CACHE_VERSION = 2;
const DEFAULT_CONTENT_BASE = typeof window !== "undefined" ? window.location.origin : "";
const DEFAULT_MANIFEST_URL = "/levels/home.level.json";
const DEFAULT_ASSET_CATALOG_URL = "/api/assets";
const FALLBACK_ASSET_CATALOG: AssetDefinition[] = [
  { category: "Characters", name: "Starfox", url: "/assets/Starfox.glb" },
  { category: "Characters", name: "Lasso", url: "/assets/Lasso.glb" },
  { category: "Buildings", name: "Building mid", url: "/assets/building/building_mid_preset_1.glb" },
  { category: "Buildings", name: "Ramen shop", url: "/assets/building/building_ramen_shop.glb" },
  { category: "Buildings", name: "Metro", url: "/assets/building/metro_50k.glb" },
  { category: "Props", name: "ATM machine", url: "/assets/props/atm_machine.glb" },
  { category: "Props", name: "Dumpster", url: "/assets/props/prop_dumpster.glb" },
  { category: "Props", name: "Vending machine", url: "/assets/props/Vending_machine_cola_1.glb" },
  { category: "Vehicles", name: "Forklift", url: "/assets/vehicles/forklift.glb" },
  { category: "NPC", name: "Businessman", url: "/assets/npc/businessman.glb" },
];
const LIGHT_ASSET_CATALOG: AssetDefinition[] = [
  { category: "Lights", kind: "light", lightType: "omni", name: "Point Light", url: "light://omni" },
  { category: "Lights", kind: "light", lightType: "spot", name: "Spot Light", url: "light://spot" },
  { category: "Lights", kind: "light", lightType: "directional", name: "Directional Light", url: "light://directional" },
];

type RuntimeState = {
  manifestUrl: string;
  assetCatalogUrl: string;
  contentBase: string;
  levelId: string | null;
  layout: LevelLayout;
  assetCatalog: AssetDefinition[];
  selectedAssetUrl: string | null;
  selectedObjectId: string | null;
  activeDragId: string | null;
  skyGradient: SkyGradientSettings;
  timeOfDay: number;
  playing: boolean;
  water: WaterSurfaceSettings;
  lighting: LightingSettings;
  terrainMode: "select" | "sculpt" | "road";
  brushMode: TerrainBrushMode;
  brushRadius: number;
  brushStrength: number;
  brushFalloff: number;
  flattenHeight: number;
  paintLayer: "soil" | "sand" | "grass";
  soilRepeat: number;
  sandRepeat: number;
  roadRepeat: number;
  isSculpting: boolean;
  activeRoadSplineId: string | null;
  selectedRoadPoint: { roadId: string; pointIndex: number } | null;
};

type WorldLoadReport = {
  manifestChunks: number;
  loadedTerrainChunks: number;
  failedTerrainChunks: number;
  loadedObjects: number;
};

type PanelState = {
  assets: boolean;
  inspector: boolean;
  world: boolean;
};

type PanelSizeState = {
  assetsWidth: number;
  inspectorWidth: number;
  inspectorHeight: number;
  worldWidth: number;
  worldHeight: number;
};

type LightingSettings = {
  skyRotation: number;
  sunAzimuth: number;
  moonIntensity: number;
  horizonGlow: number;
  ambientIntensity: number;
};

// Everything below runs once per mount. The rest of this file (after this
// point) is one giant function body, kept in its original shape — the
// hundreds of `function foo() {...}` declarations further down are hoisted,
// so they remain callable from anywhere in this scope regardless of where
// they're textually defined relative to the boot sequence at the bottom.
export function initWorldBuilder(container: HTMLDivElement, userId: string): () => void {
  const appRoot = container;

  const trackedListeners: Array<{ target: Window; type: string; listener: EventListenerOrEventListenerObject }> = [];
  function addWindowListener(type: string, listener: EventListenerOrEventListenerObject) {
    window.addEventListener(type, listener);
    trackedListeners.push({ target: window, type, listener });
  }

  addWindowListener("error", ((event: ErrorEvent) => {
    const message = event.error instanceof Error ? event.error.stack || event.error.message : String(event.message);
    appRoot.innerHTML = `
      <div style="padding:24px;font:14px/1.5 Inter,Arial,sans-serif;color:#f8fafc;background:#050711;min-height:100%;white-space:pre-wrap;">
        <div style="font-weight:700;margin-bottom:12px;">Three.js world builder startup error</div>
        <div style="color:#fca5a5;">${message}</div>
      </div>
    `;
  }) as EventListener);

  const params = new URLSearchParams(window.location.search);

const state: RuntimeState = {
  manifestUrl: DEFAULT_MANIFEST_URL,
  assetCatalogUrl: DEFAULT_ASSET_CATALOG_URL,
  contentBase: params.get("contentBase") || DEFAULT_CONTENT_BASE,
  levelId: null,
  layout: emptyLayout(),
  assetCatalog: loadCachedAssetCatalog(),
  selectedAssetUrl: null,
  selectedObjectId: null,
  activeDragId: null,
  skyGradient: loadSkyGradient(),
  timeOfDay: 12,
  playing: false,
  water: defaultWaterSettings(),
  lighting: loadLightingSettings(),
  terrainMode: "select",
  brushMode: "raise",
  brushRadius: 8,
  brushStrength: 0.15,
  brushFalloff: 0.7,
  flattenHeight: 0,
  paintLayer: "soil",
  soilRepeat: 4.25,
  sandRepeat: 6.5,
  roadRepeat: 0.9,
  isSculpting: false,
  activeRoadSplineId: null,
  selectedRoadPoint: null,
};

const worldLoadReport: WorldLoadReport = {
  manifestChunks: 0,
  loadedTerrainChunks: 0,
  failedTerrainChunks: 0,
  loadedObjects: 0,
};

const panelState = loadPanelState();
const panelSizes = loadPanelSizes();
const ui = buildUi();
appRoot.appendChild(ui.root);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(appRoot.clientWidth || 1, appRoot.clientHeight || 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.style.position = "absolute";
renderer.domElement.style.inset = "0";
renderer.domElement.style.zIndex = "0";
ui.viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a1020, 0.0011);

const camera = new THREE.PerspectiveCamera(55, (appRoot.clientWidth || 1) / (appRoot.clientHeight || 1), 0.1, 4000);
camera.position.set(54, 42, 54);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 8;
controls.maxDistance = 500;

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode("translate");
transformControls.setSize(1.1);
scene.add(transformControls.getHelper());
transformControls.addEventListener("dragging-changed", (event) => {
  controls.enabled = !event.value;
  if (!event.value) {
    syncSelectedObjectOrbitTarget();
  }
});
transformControls.addEventListener("mouseDown", () => {
  pushHistory("transform");
});
transformControls.addEventListener("objectChange", () => {
  syncSelectedObjectFromTransform();
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const worldRoot = new THREE.Group();
const terrainRoot = new THREE.Group();
const roadRoot = new THREE.Group();
const roadGuideGroup = new THREE.Group();
const waterRoot = new THREE.Group();
const objectRoot = new THREE.Group();
const skyRoot = new THREE.Group();
scene.add(worldRoot, terrainRoot, roadRoot, waterRoot, objectRoot, skyRoot);
scene.add(roadGuideGroup);

const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
sunLight.position.set(80, 120, 60);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -160;
sunLight.shadow.camera.right = 160;
sunLight.shadow.camera.top = 160;
sunLight.shadow.camera.bottom = -160;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 420;
sunLight.shadow.bias = -0.00008;
sunLight.shadow.normalBias = 0.045;
scene.add(sunLight);
scene.add(sunLight.target);
const moonLight = new THREE.DirectionalLight(0x9db7ff, 0.18);
moonLight.position.set(-80, 60, -60);
moonLight.castShadow = false;
moonLight.shadow.mapSize.set(1024, 1024);
moonLight.shadow.camera.left = -120;
moonLight.shadow.camera.right = 120;
moonLight.shadow.camera.top = 120;
moonLight.shadow.camera.bottom = -120;
moonLight.shadow.camera.near = 1;
moonLight.shadow.camera.far = 320;
moonLight.shadow.bias = -0.00006;
moonLight.shadow.normalBias = 0.035;
scene.add(moonLight);
scene.add(moonLight.target);
const hemiLight = new THREE.HemisphereLight(0xa8c8ff, 0x3d2d20, 0.95);
scene.add(hemiLight);
const horizonGlow = new THREE.PointLight(0xff8533, 2.8, 110);
horizonGlow.position.set(0, 8, 45);
scene.add(horizonGlow);
const ambientLight = new THREE.AmbientLight(0x8fb0dd, 0.45);
scene.add(ambientLight);

const templates = new Map<string, Promise<THREE.Object3D>>();
// creator_assets id -> row, populated on each asset-catalog refresh so
// loadTemplate() can resolve a placed object's asset id to a storage path
// without a DB round trip when the asset is already in the visible shelf.
const assetRowById = new Map<string, AssetRow>();
const signedUrlByAssetId = new Map<string, Promise<string>>();
const CREATOR_ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const terrainMeshes: THREE.Object3D[] = [];
const waterMeshes: THREE.Mesh[] = [];
let waterSurfaceMesh: ThreeWater | null = null;
const objectMeshes = new Map<string, THREE.Object3D>();
const selectedObjectIds = new Set<string>();
const selectableMeshes: THREE.Object3D[] = [];
const undoStack: string[] = [];
let selectedSkyStopIndex = 0;
let lastAssetDropSignature = "";
let lastAssetDropTime = 0;
const ROAD_WIDTH_SCALE = 0.85;
const roadPointMarkers = new Map<string, THREE.Mesh>();
const textureLoader = new TextureLoader();
const texturePromises = new Map<string, Promise<THREE.Texture>>();
const fallbackTexture = createSolidTexture([255, 255, 255, 255]);
const waterNormalMap = createWaterNormalMap();
const terrainTextureUniforms = {
  soilMap: { value: fallbackTexture as THREE.Texture },
  sandMap: { value: fallbackTexture as THREE.Texture },
  roadMap: { value: fallbackTexture as THREE.Texture },
};

type ObjectShaderMode = NonNullable<PlacedObjectData["shaderMode"]>;
type ToonShaderSettings = {
  steps: number;
  contrast: number;
  outlineEnabled: boolean;
  outlineThickness: number;
  outlineColor: [number, number, number];
};
type OutlineShaderSettings = {
  fillColor: [number, number, number];
  thickness: number;
  color: [number, number, number];
};
type OutlineShellSettings = {
  thickness: number;
  color: [number, number, number];
};
type ObjectShaderSettings = {
  toon: ToonShaderSettings;
  outline: OutlineShaderSettings;
};
type MeshMaterialList = THREE.Material[];
type MeshMaterialUserData = {
  standardMaterials?: MeshMaterialList;
  toonMaterials?: MeshMaterialList;
  outlineFillMaterials?: MeshMaterialList;
  outlineShell?: THREE.Object3D | null;
  toonSignature?: string;
  outlineFillSignature?: string;
  outlineSignature?: string;
  originalCastShadow?: boolean;
  originalReceiveShadow?: boolean;
};

type RoadTextureBundle = {
  albedo: THREE.Texture;
  ao: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  metallic: THREE.Texture;
};

type TerrainTextureBundle = {
  albedo: THREE.Texture;
  ao: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  metallic: THREE.Texture;
};

type TerrainLayerSettings = {
  dirt: TerrainShaderSettings;
  sand: TerrainShaderSettings;
};

const roadTextureLibrary: Partial<Record<"gravel" | "asphalt" | "highway-lanes", RoadTextureBundle>> = {};
const terrainTextureLibrary: Partial<Record<"soil" | "sand-dunes1" | "gravel", TerrainTextureBundle>> = {};
let currentTerrainLayerSettings = normalizeTerrainLayerSettings(defaultTerrainSettings().terrainLayers);
const shaderBallMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.82,
  metalness: 0,
  map: fallbackTexture,
});
let shaderBallRenderer: THREE.WebGLRenderer | null = null;
let shaderBallScene: THREE.Scene | null = null;
let shaderBallCamera: THREE.PerspectiveCamera | null = null;
let shaderBallMesh: THREE.Mesh | null = null;
let waterShaderRenderer: THREE.WebGLRenderer | null = null;
let waterShaderScene: THREE.Scene | null = null;
let waterShaderCamera: THREE.PerspectiveCamera | null = null;
let waterShaderMesh: THREE.Mesh | null = null;
const waterSurfaceMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x2f82ad,
  emissive: 0x112d42,
  emissiveIntensity: 0.38,
  specularColor: new THREE.Color(0xcfeeff),
  roughness: 0.18,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.06,
  transmission: 0.0,
  thickness: 0.9,
  ior: 1.333,
  attenuationColor: new THREE.Color(0x2b7aa4),
  attenuationDistance: 1.8,
  transparent: false,
  opacity: 1,
  depthWrite: true,
  depthTest: true,
  fog: false,
  side: THREE.DoubleSide,
  vertexColors: true,
});
const waterPreviewMaterial = waterSurfaceMaterial.clone();
let saveTimeoutId: number | null = null;

function createTerrainBlendTexture(chunk: TerrainChunkData) {
  const resolution = chunk.resolution || 33;
  const data = new Uint8Array(resolution * resolution);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.round(clamp(layerBlendValueAt(chunk, "sand", index), 0, 1) * 255);
  }
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RedFormat, THREE.UnsignedByteType);
  texture.needsUpdate = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function createTerrainLayeredMaterial(blendMap: THREE.DataTexture) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    map: terrainTextureLibrary.soil?.albedo ?? fallbackTexture,
  });
  material.vertexColors = true;
  material.transparent = false;
  material.depthWrite = true;
  material.alphaTest = 0;
  material.userData.terrainBlendMap = blendMap;
  material.onBeforeCompile = function (shader) {
    const self = this as THREE.MeshStandardMaterial & { userData: { terrainBlendMap?: THREE.Texture } };
    const terrainBlendMap = self.userData.terrainBlendMap ?? blendMap;
    const soilBundle = terrainTextureLibrary.soil ?? terrainTextureLibrary["sand-dunes1"];
    const sandBundle = terrainTextureLibrary["sand-dunes1"] ?? terrainTextureLibrary.soil ?? soilBundle;

    shader.uniforms.terrainBlendMap = { value: terrainBlendMap };
    shader.uniforms.terrainSoilMap = { value: soilBundle?.albedo ?? fallbackTexture };
    shader.uniforms.terrainSandMap = { value: sandBundle?.albedo ?? fallbackTexture };
    shader.fragmentShader = `
      uniform sampler2D terrainBlendMap;
      uniform sampler2D terrainSoilMap;
      uniform sampler2D terrainSandMap;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <map_fragment>",
        `
          #ifdef USE_MAP
            float terrainBlend = texture2D( terrainBlendMap, vUv ).r;
            vec3 terrainSoilColor = mapTexelToLinear( texture2D( terrainSoilMap, vUv ) ).rgb;
            vec3 terrainSandColor = mapTexelToLinear( texture2D( terrainSandMap, vUv ) ).rgb;
            vec3 terrainColor = mix( terrainSoilColor, terrainSandColor, terrainBlend );
            diffuseColor.rgb *= terrainColor;
          #endif
        `
      );
  };
  material.customProgramCacheKey = () => "terrain-layered-v1";
  return material;
}

const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    sunSideColor: { value: new THREE.Color(1, 0.46, 0.24) },
    oppositeSideColor: { value: new THREE.Color(0.58, 0.42, 0.86) },
    topColor: { value: new THREE.Color(0.28, 0.5, 0.86) },
    midColor: { value: new THREE.Color(0.48, 0.68, 0.96) },
    horizonColor: { value: new THREE.Color(0.9, 0.96, 1) },
    neonColor: { value: new THREE.Color(0.88, 0.9, 1) },
    moonColor: { value: new THREE.Color(0.7, 0.78, 1) },
    sunDirection: { value: new THREE.Vector3(0.18, 0.7, 0.42) },
    moonDirection: { value: new THREE.Vector3(-0.28, 0.36, 0.89) },
    sunColor: { value: new THREE.Color(1, 0.86, 0.48) },
    sunIntensity: { value: 1.1 },
    moonIntensity: { value: 1.0 },
    elapsedTime: { value: 0 },
    fogDensity: { value: 0.022 },
    cloudSpeed: { value: 0.018 },
    cloudOpacity: { value: 0.78 },
    weatherRain: { value: 0 },
    timeOfDay: { value: 12 },
  },
  vertexShader: `
    varying vec3 vDirection;
    void main() {
      vDirection = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vDirection;
    uniform vec3 sunSideColor;
    uniform vec3 oppositeSideColor;
    uniform vec3 topColor;
    uniform vec3 midColor;
    uniform vec3 horizonColor;
    uniform vec3 neonColor;
    uniform vec3 moonColor;
    uniform vec3 sunDirection;
    uniform vec3 moonDirection;
    uniform vec3 sunColor;
    uniform float sunIntensity;
    uniform float moonIntensity;
    uniform float elapsedTime;
    uniform float fogDensity;
    uniform float cloudSpeed;
    uniform float cloudOpacity;
    uniform float weatherRain;
    uniform float timeOfDay;

    float sat(float v) { return clamp(v, 0.0, 1.0); }
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p);
        p *= 2.04;
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec3 direction = normalize(vDirection);
      float height = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
      float horizon = pow(1.0 - height, 3.2);
      float midBand = smoothstep(0.16, 0.62, height) * (1.0 - smoothstep(0.58, 0.92, height));

      vec3 sky = mix(horizonColor, midColor, smoothstep(0.05, 0.48, height));
      sky = mix(sky, topColor, smoothstep(0.52, 1.0, height));
      sky += neonColor * midBand * 0.22;
      sky += horizonColor * horizon * 0.42;

      vec2 cloudUvA = direction.xz * 1.35 + direction.y * vec2(0.38, -0.24);
      vec2 cloudUvB = direction.zx * 1.05 + direction.y * vec2(-0.22, 0.31);
      float lowClouds = fbm(cloudUvA * 2.8 + vec2(elapsedTime * cloudSpeed, elapsedTime * cloudSpeed * 0.25));
      float highClouds = fbm(cloudUvB * 5.4 + vec2(-elapsedTime * cloudSpeed * 0.42, elapsedTime * cloudSpeed * 0.18));
      float cloudMask = smoothstep(0.48, 0.78, lowClouds) * smoothstep(0.02, 0.72, 1.0 - height);
      float highMask = smoothstep(0.58, 0.84, highClouds) * smoothstep(0.28, 0.95, height);
      vec3 cloudColor = mix(vec3(0.18, 0.17, 0.30), vec3(0.72, 0.45, 0.85), midBand);
      sky = mix(sky, sky + cloudColor * 0.28, clamp((cloudMask + highMask * 0.45) * cloudOpacity, 0.0, 1.0));

      float moonDot = max(dot(direction, normalize(moonDirection)), 0.0);
      float moonDisc = smoothstep(0.9985, 0.9998, moonDot);
      float moonBloom = pow(moonDot, 220.0) * 0.035 + pow(moonDot, 68.0) * 0.014;
      sky += moonColor * (moonDisc * moonIntensity * 0.72 + moonBloom * moonIntensity * 0.22);

      float sunDot = max(dot(direction, normalize(sunDirection)), 0.0);
      float sunDisc = smoothstep(0.9978, 0.9999, sunDot);
      float sunBloom = pow(sunDot, 240.0) * 0.35 + pow(sunDot, 54.0) * 0.12;
      sky += sunColor * (sunDisc * sunIntensity * 1.45 + sunBloom * sunIntensity);

      vec2 horizonDirection = normalize(vec2(direction.x, direction.z) + vec2(0.0001, 0.0001));
      vec2 sunHorizonDirection = normalize(vec2(sunDirection.x, sunDirection.z) + vec2(0.0001, 0.0001));
      float sideMix = clamp(dot(horizonDirection, sunHorizonDirection) * 0.5 + 0.5, 0.0, 1.0);
      float sideStrength = smoothstep(0.12, 0.92, 1.0 - height);
      vec3 sideTint = mix(oppositeSideColor, sunSideColor, sideMix);
      vec3 horizonSideTint = mix(oppositeSideColor, sunSideColor, sideMix * sideMix);
      sky = mix(sky, mix(sky, sideTint, 0.42), sideStrength * 0.64);
      sky = mix(sky, mix(sky, horizonSideTint, 0.58), horizon * 0.5);

      vec2 starUv = direction.xz / max(0.08, direction.y + 0.32);
      float starSample = hash(floor(starUv * 185.0));
      float stars = step(0.996, starSample) * smoothstep(0.44, 0.9, height);
      sky += vec3(0.72, 0.82, 1.0) * stars * 0.42;

      float atmosphericDepth = clamp(fogDensity * (1.0 - height) * 14.0, 0.0, 1.0);
      vec3 fogTint = mix(vec3(0.08, 0.12, 0.26), vec3(0.45, 0.25, 0.62), midBand);
      sky = mix(sky, fogTint, atmosphericDepth * 0.42);
      vec3 overcast = mix(vec3(0.12, 0.19, 0.30), vec3(0.26, 0.35, 0.46), height);
      sky = mix(sky, overcast, weatherRain * 0.78);

      gl_FragColor = vec4(sky, 1.0);
    }
  `,
});

const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 32), skyMaterial);
skyRoot.add(skyDome);

const terrainMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 1,
  metalness: 0,
});
terrainMaterial.vertexColors = true;
const sandMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.96,
  metalness: 0,
});
const roadMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.82,
  metalness: 0,
  map: fallbackTexture,
});
roadMaterial.flatShading = false;
roadMaterial.side = THREE.FrontSide;

const brushCursor = new THREE.Mesh(
  new THREE.RingGeometry(0.48, 0.5, 96),
  new THREE.MeshBasicMaterial({ color: 0x56a6e8, transparent: true, opacity: 0.88, side: THREE.DoubleSide })
);
brushCursor.rotation.x = -Math.PI / 2;
brushCursor.visible = false;
scene.add(brushCursor);

const waterMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: true,
  fog: false,
  blending: THREE.NormalBlending,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
  uniforms: {
    time: { value: 0 },
    waterOpacity: { value: state.water.opacity },
    reflectivity: { value: state.water.reflectivity },
    waveAmplitude: { value: state.water.waveAmplitude },
    waveFrequency: { value: state.water.waveFrequency },
    waveSpeed: { value: state.water.waveSpeed },
    windSpeed: { value: state.water.windSpeed },
    choppiness: { value: state.water.choppiness },
    foamIntensity: { value: state.water.foamIntensity },
    foamThreshold: { value: state.water.foamThreshold },
    foamContrast: { value: state.water.foamContrast },
    rainIntensity: { value: 0 },
    waterLevel: { value: 0 },
    cameraPosition: { value: new THREE.Vector3() },
    deepColor: { value: new THREE.Color(0.02, 0.1, 0.2) },
    shallowColor: { value: new THREE.Color(0.12, 0.42, 0.56) },
    skyTint: { value: new THREE.Color(0.34, 0.5, 0.72) },
    foamColor: { value: new THREE.Color(0.86, 0.94, 1.0) },
  },
  vertexShader: `
    attribute vec4 color;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vDepthFactor;
    varying float vWave;
    varying float vFoamSeed;
    uniform float time;
    uniform float waveAmplitude;
    uniform float waveFrequency;
    uniform float waveSpeed;
    uniform float windSpeed;
    uniform float choppiness;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 4; i++) {
        value += amplitude * noise(p);
        p *= 2.03;
        amplitude *= 0.5;
      }
      return value;
    }

    float gerstnerWave(vec2 direction, float amplitude, float frequency, float speed, vec2 position, float t) {
      vec2 dir = normalize(direction);
      return sin(dot(position, dir) * frequency + t * speed) * amplitude;
    }

    void main() {
      vec3 displaced = position;
      vec4 world = modelMatrix * vec4(displaced, 1.0);
      float amplitude = max(waveAmplitude, 0.0001);
      float frequency = max(waveFrequency, 0.0001);
      float wind = max(windSpeed, 0.0);
      float chop = clamp(choppiness, 0.0, 1.5);
      vec2 windDirection = normalize(vec2(0.84, 0.54));
      vec2 windOffset = windDirection * time * wind * 0.08;
      vec2 waveUv = world.xz * frequency + windOffset;
      float largeWave = gerstnerWave(vec2(1.0, 0.35), amplitude * 0.55, 0.55, waveSpeed * (1.2 + wind * 0.12), waveUv, time);
      float midWave = gerstnerWave(vec2(-0.42, 1.0), amplitude * 0.32, 1.15, waveSpeed * (1.85 + wind * 0.18), waveUv, time);
      float chopWave = gerstnerWave(vec2(0.78, -0.62), amplitude * 0.15, 2.8, waveSpeed * (2.5 + wind * 0.24), waveUv, time);
      float swell = fbm(waveUv * 1.45 + vec2(time * waveSpeed * 0.06, -time * waveSpeed * 0.04));
      float detail = fbm(waveUv * (4.2 + chop * 1.2) + vec2(time * waveSpeed * 0.25, time * waveSpeed * 0.12));
      vFoamSeed = fbm(waveUv * (7.4 + chop * 2.0) + vec2(time * waveSpeed * 0.18, -time * waveSpeed * 0.16));
      float baseWave = largeWave + midWave + chopWave;
      float choppyWave = mix(baseWave, sign(baseWave) * pow(abs(baseWave) / amplitude, 1.0 + chop * 1.6) * amplitude, clamp(chop * 0.55, 0.0, 1.0));
      float micro = (swell - 0.5) * amplitude * 0.35 + (detail - 0.5) * amplitude * 0.16;
      float wave = choppyWave + micro;
      world.y += wave;
      vWorldPosition = world.xyz;
      vNormal = normalize(normalMatrix * normal);
      vDepthFactor = clamp(color.a, 0.0, 1.0);
      vWave = wave;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vWorldPosition;
    varying vec3 vNormal;
    varying float vDepthFactor;
    varying float vWave;
    varying float vFoamSeed;
    uniform float time;
    uniform float waterOpacity;
    uniform float reflectivity;
    uniform float foamIntensity;
    uniform float foamThreshold;
    uniform float foamContrast;
    uniform float choppiness;
    uniform float rainIntensity;
    uniform float waterLevel;
    uniform vec3 cameraPosition;
    uniform vec3 deepColor;
    uniform vec3 shallowColor;
    uniform vec3 skyTint;
    uniform vec3 foamColor;

    void main() {
      vec3 normal = normalize(vNormal);
      float depthMix = clamp(vDepthFactor, 0.0, 1.0);
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 4.0);
      float waveBands = clamp(abs(vWave) * 0.65 + vFoamSeed * 0.25, 0.0, 1.0);
      float foamMask = pow(clamp(waveBands * foamThreshold + 0.15, 0.0, 1.0), foamContrast);
      vec3 color = mix(shallowColor, deepColor, depthMix);
      color = mix(color, skyTint, clamp(0.28 + fresnel * reflectivity * 1.4, 0.0, 0.98));
      color += skyTint * fresnel * 0.22;
      color += foamColor * foamMask * foamIntensity * 0.55;
      color += vec3(0.04, 0.08, 0.12) * waveBands;
      gl_FragColor = vec4(color, mix(0.78, 0.96, depthMix));
    }
  `,
});
const loader = new GLTFLoader();
const fbxLoader = new FBXLoader();

const terrainBase = new THREE.Group();
terrainRoot.add(terrainBase);

void loadTerrainTextures();

const topbar = ui.topbar;
const levelPicker = topbar.querySelector<HTMLSelectElement>("#level-picker")!;
const manifestInput = topbar.querySelector<HTMLInputElement>("#manifest-url")!;
const catalogInput = topbar.querySelector<HTMLInputElement>("#catalog-url")!;
const newButton = topbar.querySelector<HTMLButtonElement>("#new-world")!;
const loadButton = topbar.querySelector<HTMLButtonElement>("#load-world")!;
const saveButton = topbar.querySelector<HTMLButtonElement>("#save-world")!;
const exportButton = topbar.querySelector<HTMLButtonElement>("#export-world")!;
const statusEl = topbar.querySelector<HTMLSpanElement>("#status")!;
const diagnosticsEl = topbar.querySelector<HTMLSpanElement>("#diagnostics")!;

const assetList = ui.assetList;
const assetSearch = ui.assetSearch;
const assetCategory = ui.assetCategory;
const waterControls = {
  opacity: ui.waterOpacity,
  reflectivity: ui.waterReflectivity,
  foamThreshold: ui.foamThreshold,
  foamContrast: ui.foamContrast,
  level: ui.waterLevel,
  waveAmplitude: ui.waveAmplitude,
  waveFrequency: ui.waveFrequency,
  waveSpeed: ui.waveSpeed,
  windSpeed: ui.windSpeed,
  choppiness: ui.choppiness,
  underwaterFogDensity: ui.underwaterFogDensity,
  foamIntensity: ui.foamIntensity,
};
const timeControls = {
  slider: ui.timeSlider,
  play: ui.timePlay,
  stop: ui.timeStop,
  speed: ui.timeSpeed,
  transformTranslate: ui.transformTranslate,
  transformRotate: ui.transformRotate,
  transformScale: ui.transformScale,
  skyColors: ui.skyColors,
  skyRotation: ui.skyRotation,
  moonIntensity: ui.moonIntensity,
  horizonGlow: ui.horizonGlow,
  ambientIntensity: ui.ambientIntensity,
};
  const terrainControls = {
  select: ui.terrainSelect,
  sculpt: ui.terrainSculpt,
  road: ui.terrainRoad,
  brushMode: ui.terrainBrushMode,
  brushRadius: ui.terrainBrushRadius,
  brushStrength: ui.terrainBrushStrength,
  brushFalloff: ui.terrainBrushFalloff,
  flattenHeight: ui.terrainFlattenHeight,
  terrainDirtAO: ui.terrainDirtAO,
  terrainDirtNormal: ui.terrainDirtNormal,
  terrainDirtRoughness: ui.terrainDirtRoughness,
  terrainDirtMetalness: ui.terrainDirtMetalness,
  terrainSandAO: ui.terrainSandAO,
  terrainSandNormal: ui.terrainSandNormal,
  terrainSandRoughness: ui.terrainSandRoughness,
  terrainSandMetalness: ui.terrainSandMetalness,
  terrainLayerButtons: ui.terrainLayerButtons,
  roadWidth: ui.terrainRoadWidth,
  roadShoulder: ui.terrainRoadShoulder,
  roadElevation: ui.terrainRoadElevation,
  roadSpline: ui.roadSpline,
  newRoad: ui.newRoad,
  deleteRoad: ui.deleteRoad,
  soilRepeat: ui.soilRepeat,
  sandRepeat: ui.sandRepeat,
  roadRepeat: ui.roadRepeat,
  regenerate: ui.terrainRegenerate,
  clearRoad: ui.terrainClearRoad,
};
const inspector = ui.inspector;
const sceneOutliner = ui.sceneOutliner;

manifestInput.value = state.manifestUrl;
catalogInput.value = state.assetCatalogUrl;

let disposed = false;
let rafId = 0;
void (async () => {
  // Continue-where-you-left-off: auto-pick the most recently updated level
  // (listVisibleLevels orders desc) so a returning user isn't dropped into
  // an empty new map every time they open the tool.
  try {
    const levels = await listVisibleLevels(userId);
    if (disposed) return;
    if (levels.length > 0) state.levelId = levels[0].id;
  } catch (error) {
    console.warn("Failed to load the level list.", error);
  }
  await loadWorldFromInputs();
  if (disposed) return;
  await refreshLevelPicker();
  if (disposed) return;
  bindUi();
  tick();
})();

addWindowListener("resize", onResize);
const containerResizeObserver = new ResizeObserver(() => onResize());
containerResizeObserver.observe(appRoot);
renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer!.dropEffect = "copy";
});
renderer.domElement.addEventListener("drop", (event) => {
  placeDraggedAssetAt(event);
});
ui.viewport.addEventListener("dragover", (event) => {
  event.preventDefault();
});
addWindowListener("dragover", ((event: Event) => {
  event.preventDefault();
}) as EventListener);
addWindowListener("keydown", onKeyDown as EventListener);

function levelNameFromManifest(manifestUrl: string) {
  const fileName = manifestUrl.split("/").at(-1) ?? "home.level.json";
  return fileName.replace(/\.level\.json$/i, "").replace(/\.json$/i, "") || "home";
}

function slugifyLevelName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.level\.json$/i, "")
    .replace(/\.json$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The manifest-url input is a leftover local-storage-backup/export-naming
// concept (see the header comment) — keep it in sync with whichever level
// is actually loaded from Supabase, otherwise mergeSavedLocalLayout() below
// keeps reading the same stale generic backup key for every level.
function syncManifestUrlToLevelName(name: string) {
  const slug = slugifyLevelName(name) || "home";
  state.manifestUrl = `/levels/${slug}.level.json`;
  manifestInput.value = state.manifestUrl;
}

function districtFromManifest(manifestUrl: string) {
  const base = levelNameFromManifest(manifestUrl)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "district_00";
}

function layoutStorageKeyForManifest(manifestUrl: string) {
  return `${STORAGE_KEY}:${manifestUrl}`;
}

function currentLayoutStorageKey() {
  return layoutStorageKeyForManifest(state.manifestUrl);
}

function exportFileNameForManifest(manifestUrl: string) {
  return manifestUrl.split("/").at(-1) ?? "home.level.json";
}

function blankTerrainSettings(): TerrainDistrictSettings {
  const terrain = defaultTerrainSettings();
  return {
    ...terrain,
    waterLevel: -20,
    shoreline: [
      { x: -10000, z: -256 },
      { x: -10000, z: -64 },
      { x: -10000, z: 64 },
      { x: -10000, z: 256 },
    ],
    splines: [],
  };
}

function createFlatTerrainChunks(settings: TerrainDistrictSettings, district = "district_00"): TerrainChunkData[] {
  const chunks: TerrainChunkData[] = [];
  const chunkCount = Math.max(1, settings.extentChunks || 1);
  for (let chunkZ = 0; chunkZ < chunkCount; chunkZ += 1) {
    for (let chunkX = 0; chunkX < chunkCount; chunkX += 1) {
      chunks.push({
        id: `${district}:${chunkX},${chunkZ}`,
        origin: [chunkX * TERRAIN_CHUNK_SIZE, chunkZ * TERRAIN_CHUNK_SIZE],
        resolution: TERRAIN_RESOLUTION,
        spacing: TERRAIN_SPACING,
        heights: Array.from({ length: TERRAIN_RESOLUTION * TERRAIN_RESOLUTION }, () => 0),
        waterMask: Array.from({ length: TERRAIN_RESOLUTION * TERRAIN_RESOLUTION }, () => 0),
        paintMask: {
          grass: Array.from({ length: TERRAIN_RESOLUTION * TERRAIN_RESOLUTION }, () => 0),
          sand: Array.from({ length: TERRAIN_RESOLUTION * TERRAIN_RESOLUTION }, () => 0),
        },
        terrain: { waterLevel: settings.waterLevel },
      });
    }
  }
  return chunks;
}

function emptyLayout(name = "home", district = "district_00"): LevelLayout {
  return {
    name,
    district,
    chunkSize: 64,
    chunks: [],
    groups: [],
    terrain: blankTerrainSettings(),
    terrainChunks: [],
    skyGradient: defaultSkyGradient(),
    objects: [],
  };
}

function loadSkyGradient(): SkyGradientSettings {
  const saved = localStorage.getItem(SKY_STORAGE_KEY);
  if (!saved) return defaultSkyGradient();
  try {
    return normalizeSkyGradient(JSON.parse(saved) as SkyGradientSettings);
  } catch {
    return defaultSkyGradient();
  }
}

function loadPanelState(): PanelState {
  const defaults: PanelState = { assets: false, inspector: false, world: false };
  const saved = localStorage.getItem(PANEL_STORAGE_KEY);
  if (!saved) return defaults;
  try {
    const parsed = JSON.parse(saved) as Partial<PanelState>;
    return {
      assets: Boolean(parsed.assets),
      inspector: Boolean(parsed.inspector),
      world: Boolean(parsed.world),
    };
  } catch {
    return defaults;
  }
}

function loadPanelSizes(): PanelSizeState {
  const defaults: PanelSizeState = {
    assetsWidth: 380,
    inspectorWidth: 320,
    inspectorHeight: 640,
    worldWidth: 320,
    worldHeight: 820,
  };
  const saved = localStorage.getItem(PANEL_SIZE_STORAGE_KEY);
  if (!saved) return defaults;
  try {
    const parsed = JSON.parse(saved) as Partial<PanelSizeState>;
    return {
      assetsWidth: Math.max(260, Number(parsed.assetsWidth) || defaults.assetsWidth),
      inspectorWidth: Math.max(240, Number(parsed.inspectorWidth) || defaults.inspectorWidth),
      inspectorHeight: Math.max(320, Number(parsed.inspectorHeight) || defaults.inspectorHeight),
      worldWidth: Math.max(240, Number(parsed.worldWidth) || defaults.worldWidth),
      worldHeight: Math.max(420, Number(parsed.worldHeight) || defaults.worldHeight),
    };
  } catch {
    return defaults;
  }
}

function loadLightingSettings(): LightingSettings {
  const defaults: LightingSettings = {
    skyRotation: 0,
    sunAzimuth: 0,
    moonIntensity: 1.8,
    horizonGlow: 3.8,
    ambientIntensity: 0.14,
  };
  const saved = localStorage.getItem(LIGHTING_STORAGE_KEY);
  if (!saved) return defaults;
  try {
    const parsed = JSON.parse(saved) as Partial<LightingSettings>;
    return {
      skyRotation: Number(parsed.skyRotation) || defaults.skyRotation,
      sunAzimuth: Number(parsed.sunAzimuth) || defaults.sunAzimuth,
      moonIntensity: Math.max(0, Number(parsed.moonIntensity) || defaults.moonIntensity),
      horizonGlow: Math.max(0, Number(parsed.horizonGlow) || defaults.horizonGlow),
      ambientIntensity: Math.max(0, Number(parsed.ambientIntensity) || defaults.ambientIntensity),
    };
  } catch {
    return defaults;
  }
}

function normalizeAssetCatalog(assets: AssetDefinition[]) {
  const deduped = new Map<string, AssetDefinition>();
  for (const asset of assets) {
    const url = asset.url?.trim();
    const name = asset.name?.trim();
    if (!url || !name) continue;
    deduped.set(url, {
      ...asset,
      url,
      name,
      category: asset.category?.trim() || "Root",
    });
  }
  return [...deduped.values()].sort((a, b) => `${a.category}/${a.name}`.localeCompare(`${b.category}/${b.name}`));
}

function mergeAssetCatalogs(...catalogs: AssetDefinition[][]) {
  const merged = new Map<string, AssetDefinition>();
  for (const catalog of catalogs) {
    for (const asset of catalog) {
      merged.set(asset.url, asset);
    }
  }
  return normalizeAssetCatalog([...merged.values()]);
}

function loadCachedAssetCatalog() {
  const saved = localStorage.getItem(ASSET_CATALOG_STORAGE_KEY);
  if (!saved) return normalizeAssetCatalog([...FALLBACK_ASSET_CATALOG, ...LIGHT_ASSET_CATALOG]);
  try {
    const parsed = JSON.parse(saved) as AssetDefinition[] | { version?: number; source?: string; assets?: AssetDefinition[] };
    const cachedAssets = Array.isArray(parsed) ? parsed : parsed.assets ?? [];
    const normalized = normalizeAssetCatalog(cachedAssets);
    const fallbackCatalog = normalizeAssetCatalog([...FALLBACK_ASSET_CATALOG, ...LIGHT_ASSET_CATALOG]);
    const looksLikeFallback = normalized.length === fallbackCatalog.length && normalized.every((asset, index) => asset.url === fallbackCatalog[index]?.url);
    if (looksLikeFallback) {
      localStorage.removeItem(ASSET_CATALOG_STORAGE_KEY);
      return fallbackCatalog;
    }
    return normalized.length > 0 ? normalized : fallbackCatalog;
  } catch {
    return normalizeAssetCatalog([...FALLBACK_ASSET_CATALOG, ...LIGHT_ASSET_CATALOG]);
  }
}

function saveCachedAssetCatalog() {
  try {
    localStorage.setItem(ASSET_CATALOG_STORAGE_KEY, JSON.stringify({
      version: ASSET_CATALOG_CACHE_VERSION,
      source: "remote",
      assets: state.assetCatalog,
    }));
  } catch {
    // Ignore storage quota or privacy mode failures.
  }
}

function normalizeLightingSettings(value: Partial<LightingSettings> | null | undefined): LightingSettings {
  const defaults: LightingSettings = {
    skyRotation: 0,
    sunAzimuth: 0,
    moonIntensity: 1.8,
    horizonGlow: 3.8,
    ambientIntensity: 0.14,
  };
  if (!value) return defaults;
  return {
    skyRotation: Number(value.skyRotation) || defaults.skyRotation,
    sunAzimuth: Number(value.sunAzimuth) || defaults.sunAzimuth,
    moonIntensity: Math.max(0, Number(value.moonIntensity) || defaults.moonIntensity),
    horizonGlow: Math.max(0, Number(value.horizonGlow) || defaults.horizonGlow),
    ambientIntensity: Math.max(0, Number(value.ambientIntensity) || defaults.ambientIntensity),
  };
}

function normalizeRoadShaderSettings(value: Partial<RoadShaderSettings> | null | undefined): RoadShaderSettings {
  const defaults: RoadShaderSettings = {
    preset: "gravel",
    repeat: 1.4,
    aoStrength: 1,
    normalStrength: 1,
    bumpStrength: 0.05,
    roughness: 0.96,
    metalness: 0,
  };
  if (!value) return defaults;
  return {
    preset: value.preset === "asphalt" || value.preset === "gravel" || value.preset === "highway-lanes" ? value.preset : "highway-lanes",
    repeat: Math.max(0.1, Number(value.repeat) || defaults.repeat),
    aoStrength: Math.max(0, Number(value.aoStrength) || defaults.aoStrength),
    normalStrength: Math.max(0, Number(value.normalStrength) || defaults.normalStrength),
    bumpStrength: Math.max(0, Number(value.bumpStrength) || defaults.bumpStrength),
    roughness: Math.max(0, Number(value.roughness) || defaults.roughness),
    metalness: Math.max(0, Number(value.metalness) || defaults.metalness),
  };
}

function normalizeTerrainShaderSettings(value: Partial<TerrainShaderSettings> | null | undefined): TerrainShaderSettings {
  const defaults: TerrainShaderSettings = {
    preset: "sand-dunes1",
    repeat: 0.85,
    aoStrength: 1,
    normalStrength: 1,
    roughness: 0.92,
    metalness: 0,
  };
  if (!value) return defaults;
  return {
    preset: value.preset === "soil" || value.preset === "sand-dunes1" || value.preset === "gravel" ? value.preset : defaults.preset,
    repeat: Math.max(0.05, Number(value.repeat) || defaults.repeat),
    aoStrength: Math.max(0, Number(value.aoStrength) || defaults.aoStrength),
    normalStrength: Math.max(0, Number(value.normalStrength) || defaults.normalStrength),
    roughness: Math.max(0, Number(value.roughness) || defaults.roughness),
    metalness: Math.max(0, Number(value.metalness) || defaults.metalness),
  };
}

function normalizeTerrainLayerSettings(value: Partial<TerrainLayerSettings> | null | undefined): TerrainLayerSettings {
  const defaults = defaultTerrainSettings().terrainLayers ?? {
    dirt: normalizeTerrainShaderSettings({ preset: "soil", repeat: 4.25 }),
    sand: normalizeTerrainShaderSettings({ preset: "sand-dunes1", repeat: 6.5 }),
  };
  return {
    dirt: normalizeTerrainShaderSettings(value?.dirt ?? defaults.dirt),
    sand: normalizeTerrainShaderSettings(value?.sand ?? defaults.sand),
  };
}

function saveLightingSettings() {
  localStorage.setItem(LIGHTING_STORAGE_KEY, JSON.stringify(state.lighting));
}

function savePanelState() {
  localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(panelState));
}

function savePanelSizes() {
  localStorage.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify(panelSizes));
}

function saveSkyGradient(next: SkyGradientSettings) {
  state.skyGradient = normalizeSkyGradient(next);
  state.layout.skyGradient = state.skyGradient;
  localStorage.setItem(SKY_STORAGE_KEY, JSON.stringify(state.skyGradient));
}

function normalizeSkyGradient(next: SkyGradientSettings): SkyGradientSettings {
  const defaults = defaultSkyGradient();
  return {
    sunSideColor: [...(next.sunSideColor ?? defaults.sunSideColor)] as [number, number, number],
    oppositeSideColor: [...(next.oppositeSideColor ?? defaults.oppositeSideColor)] as [number, number, number],
    stops: (next.stops ?? defaults.stops).map((stop) => ({
      time: clamp(stop.time, 0, 24),
      topColor: [...stop.topColor] as [number, number, number],
      midColor: [...stop.midColor] as [number, number, number],
      horizonColor: [...stop.horizonColor] as [number, number, number],
      neonColor: [...stop.neonColor] as [number, number, number],
      moonColor: [...stop.moonColor] as [number, number, number],
    })),
  };
}

function normalizeWaterSettings(next?: Partial<WaterSurfaceSettings> | null): WaterSurfaceSettings {
  const defaults = defaultWaterSettings();
  const waveAmplitude = next?.waveAmplitude ?? next?.waveHeight ?? defaults.waveAmplitude;
  const waveFrequency = next?.waveFrequency ?? next?.waveScale ?? defaults.waveFrequency;
  const underwaterFogDensity = next?.underwaterFogDensity ?? defaults.underwaterFogDensity;
  return {
    ...defaults,
    ...(next ?? {}),
    waveAmplitude,
    waveFrequency,
    waveHeight: next?.waveHeight ?? waveAmplitude,
    waveScale: next?.waveScale ?? waveFrequency,
    opacity: clamp(next?.opacity ?? defaults.opacity, 0.4, 1.0),
    underwaterFogDensity,
  };
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function createSolidTexture(rgba: [number, number, number, number]) {
  const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function scaleRgb(color: [number, number, number], scale: number): [number, number, number] {
  return [clamp(color[0] * scale, 0, 1), clamp(color[1] * scale, 0, 1), clamp(color[2] * scale, 0, 1)];
}

function configureWaterMaterial(material: THREE.MeshPhysicalMaterial, settings: WaterSurfaceSettings) {
  const palette = skyPaletteForTime(state.timeOfDay);
  const skyWaterBase = mixRgb(palette.midColor, palette.horizonColor, 0.58);
  const shallowSky = mixRgb(palette.horizonColor, palette.topColor, 0.24);
  const deepColor = scaleRgb(skyWaterBase, 0.38);
  const shallowColor = scaleRgb(shallowSky, 0.62);
  const skyTint = mixRgb(palette.topColor, palette.midColor, 0.28);
  const surfaceOpacity = clamp(settings.opacity, 0.4, 1.0);
  material.color.setRGB(...mixRgb(shallowColor, deepColor, 0.46));
  material.emissive.setRGB(...mixRgb(skyTint, [0.06, 0.16, 0.24], 0.34));
  material.emissiveIntensity = 0.36 + settings.foamIntensity * 0.05 + (1 - surfaceOpacity) * 0.12;
  material.specularColor.setRGB(0.82, 0.92, 1.0);
  material.roughness = clamp(0.08 + settings.choppiness * 0.12, 0.08, 0.36);
  material.clearcoat = 1;
  material.clearcoatRoughness = clamp(0.03 + settings.foamContrast * 0.02, 0.03, 0.16);
  material.transmission = 0.0;
  material.thickness = clamp(0.65 + settings.reflectivity * 0.2, 0.65, 1.4);
  material.ior = 1.333;
  material.attenuationColor.setRGB(...deepColor);
  material.attenuationDistance = clamp(1.0 + surfaceOpacity * 2.0, 1.0, 4.0);
  material.opacity = surfaceOpacity;
  material.transparent = surfaceOpacity < 0.995;
  material.depthWrite = surfaceOpacity >= 0.995;
  material.depthTest = true;
  material.fog = false;
  material.side = THREE.DoubleSide;
  material.vertexColors = true;
  material.needsUpdate = true;
}

function configureWaterSurface(mesh: ThreeWater | null, settings: WaterSurfaceSettings) {
  if (!mesh) return;
  const palette = skyPaletteForTime(state.timeOfDay);
  const paletteMid = new THREE.Color().setRGB(...palette.midColor);
  const paletteTop = new THREE.Color().setRGB(...palette.topColor);
  const paletteHorizon = new THREE.Color().setRGB(...palette.horizonColor);
  const sunDirection = sunLight.position.clone().normalize();
  const waterColor = paletteMid.clone().lerp(paletteHorizon, 0.35).multiplyScalar(0.55);
  const sunColor = paletteTop.clone().lerp(new THREE.Color(0xffffff), 0.38);
  const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
  uniforms.alpha.value = clamp(settings.opacity, 0.35, 1.0);
  uniforms.time.value = performance.now() / 1000 * (0.14 + settings.waveSpeed * 0.3);
  uniforms.size.value = Math.max(0.2, settings.waveFrequency * 26);
  uniforms.distortionScale.value = 1.2 + settings.reflectivity * 5.5 + settings.choppiness * 3.5;
  uniforms.sunDirection.value.copy(sunDirection);
  uniforms.sunColor.value.copy(sunColor);
  uniforms.waterColor.value.copy(waterColor);
  uniforms.eye.value.copy(camera.position);
}

function sampleWaterMotion(x: number, z: number, timeSeconds: number, settings: WaterSurfaceSettings) {
  return sampleWaterSurfaceOffset(x, z, timeSeconds, settings);
}

function updateWaterSurfaceGeometry(mesh: THREE.Mesh | null, timeSeconds: number, settings: WaterSurfaceSettings, waterLevel: number) {
  if (!mesh) return;
  const geometry = mesh.geometry as THREE.BufferGeometry & { userData: { basePositions?: Float32Array } };
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const basePositions = geometry.userData.basePositions;
  if (!basePositions || basePositions.length !== position.array.length) return;
  const array = position.array as Float32Array;
  for (let index = 0; index < position.count; index += 1) {
    const baseIndex = index * 3;
    const x = basePositions[baseIndex];
    const z = basePositions[baseIndex + 1];
    array[baseIndex] = x;
    array[baseIndex + 1] = z;
    const worldX = mesh.position.x + x;
    const worldZ = mesh.position.z + z;
    array[baseIndex + 2] = sampleWaterMotion(worldX, worldZ, timeSeconds, settings) * 0.9;
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function rotateDirectionY(x: number, y: number, z: number, radians: number) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return new THREE.Vector3(x * cos - z * sin, y, x * sin + z * cos).normalize();
}

function rgbToHex(color: [number, number, number]) {
  const toByte = (value: number) => Math.round(clamp(value, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${toByte(color[0])}${toByte(color[1])}${toByte(color[2])}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.trim().replace("#", "");
  if (normalized.length !== 6) return [1, 1, 1];
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

function skyPaletteForTime(time: number) {
  const gradient = state.skyGradient;
  const sorted = [...gradient.stops].sort((a, b) => a.time - b.time);
  const normalized = ((time % 24) + 24) % 24;
  let lower = sorted[0];
  let upper = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const next = sorted[(i + 1) % sorted.length];
    if (normalized >= current.time && normalized < next.time) {
      lower = current;
      upper = next;
      break;
    }
    if (i === sorted.length - 1 && normalized >= current.time) {
      lower = current;
      upper = sorted[0];
    }
  }

  const span = upper.time > lower.time ? upper.time - lower.time : upper.time + 24 - lower.time;
  const local = span === 0 ? 0 : ((normalized - lower.time + 24) % 24) / span;
  const topColor = mixRgb(lower.topColor, upper.topColor, local);
  const midColor = mixRgb(lower.midColor, upper.midColor, local);
  const horizonColor = mixRgb(lower.horizonColor, upper.horizonColor, local);
  const neonColor = mixRgb(lower.neonColor, upper.neonColor, local);
  const moonColor = mixRgb(lower.moonColor, upper.moonColor, local);

  return {
    topColor,
    midColor,
    horizonColor,
    neonColor,
    moonColor,
    sunSideColor: gradient.sunSideColor,
    oppositeSideColor: gradient.oppositeSideColor,
  };
}

async function loadWorldFromInputs() {
  state.manifestUrl = manifestInput.value.trim() || DEFAULT_MANIFEST_URL;
  state.assetCatalogUrl = catalogInput.value.trim() || DEFAULT_ASSET_CATALOG_URL;
  manifestInput.value = state.manifestUrl;
  catalogInput.value = state.assetCatalogUrl;
  updateStatus("Loading world...");
  const assetCatalogPromise = loadAssetCatalog(state.assetCatalogUrl)
    .then((loadedRemoteCatalog) => {
      updateAssetList();
      updateSceneOutliner();
      updateDiagnostics();
      updateStatus(
        loadedRemoteCatalog
          ? `Loaded ${state.layout.name} and ${state.assetCatalog.length} assets`
          : `Loaded ${state.layout.name}; using starter asset shelf. Start the Starfox content server on 5173 for the full catalog.`
      );
      return loadedRemoteCatalog;
    })
    .catch((error) => {
      console.warn(error);
      updateStatus(`Loaded ${state.layout.name}; using fallback asset list`);
      return false;
    });

  try {
    if (state.levelId) {
      state.layout = await loadLayoutFromLevel(state.levelId);
      syncManifestUrlToLevelName(state.layout.name);
    } else {
      // No level picked yet (brand-new account, or "New Map") — start from
      // a blank in-memory layout instead of fetching a manifest URL that
      // doesn't exist as a real route in this app.
      state.layout = emptyLayout(state.layout.name, state.layout.district);
      state.layout.terrainChunks = createFlatTerrainChunks(
        state.layout.terrain ?? blankTerrainSettings(),
        state.layout.district || "district_00"
      );
      worldLoadReport.manifestChunks = 0;
      worldLoadReport.loadedTerrainChunks = state.layout.terrainChunks.length;
      worldLoadReport.failedTerrainChunks = 0;
      worldLoadReport.loadedObjects = 0;
    }
    mergeSavedLocalLayout(state.layout);
    state.water = normalizeWaterSettings(state.layout.terrain?.water);
    state.skyGradient = normalizeSkyGradient(state.layout.skyGradient ?? defaultSkyGradient());
    state.lighting = normalizeLightingSettings((state.layout.lighting as LightingSettings | undefined) ?? loadLightingSettings());
    const terrainLayers = normalizeTerrainLayerSettings(state.layout.terrain?.terrainLayers ?? defaultTerrainSettings().terrainLayers);
    state.soilRepeat = terrainLayers.dirt.repeat;
    state.sandRepeat = terrainLayers.sand.repeat;
    state.roadRepeat = normalizeRoadShaderSettings(state.layout.terrain?.roadShader ?? defaultTerrainSettings().roadShader).repeat;
    state.activeRoadSplineId = roadSplines()[0]?.id ?? null;
    await loadTerrainTextures();
    applyTerrainShaderSettings();
    rebuildWorld();
    syncUiFromState();
    updateDiagnostics();
    updateStatus(
      state.levelId
        ? `Loaded "${state.layout.name}" (${worldLoadReport.loadedTerrainChunks} terrain chunks, ${worldLoadReport.loadedObjects} objects)`
        : `New, unsaved level "${state.layout.name}". Start editing to create it.`
    );
    void assetCatalogPromise;
  } catch (error) {
    console.error(error);
    updateStatus(error instanceof Error ? error.message : String(error), true);
  }
}

/** Loads a level + all its chunks from Supabase and converts it back into
 * the in-memory LevelLayout shape the rest of the editor expects. Each
 * chunk row's `terrain` jsonb already holds the full TerrainChunkData
 * (id/origin/resolution/spacing/heights/waterMask/paintMask) minus
 * `objects`, which lives in its own column — see saveLevel() below for the
 * matching write side. */
async function loadLayoutFromLevel(levelId: string): Promise<LevelLayout> {
  const { level, chunks } = await loadLevel(levelId);
  const terrainChunks: TerrainChunkData[] = chunks.map((row) => ({
    ...(row.terrain as TerrainChunkData),
    objects: (row.objects as PlacedObjectData[] | null) ?? [],
  }));
  worldLoadReport.manifestChunks = terrainChunks.length;
  worldLoadReport.loadedTerrainChunks = terrainChunks.length;
  worldLoadReport.failedTerrainChunks = 0;
  const objects = terrainChunks.flatMap((chunk) => chunk.objects ?? []);
  worldLoadReport.loadedObjects = objects.length;
  return {
    name: level.name,
    district: level.district,
    chunkSize: level.chunk_size,
    chunks: [],
    groups: (level.groups as LevelLayout["groups"]) ?? [],
    terrain: (level.terrain as TerrainDistrictSettings) ?? defaultTerrainSettings(),
    terrainChunks,
    skyGradient: Object.keys(level.sky_gradient ?? {}).length
      ? (level.sky_gradient as unknown as SkyGradientSettings)
      : defaultSkyGradient(),
    lighting: Object.keys(level.lighting ?? {}).length ? level.lighting : undefined,
    objects,
  };
}

function mergeSavedLocalLayout(layout: LevelLayout) {
  const saved = localStorage.getItem(currentLayoutStorageKey()) ?? (
    state.manifestUrl === DEFAULT_MANIFEST_URL ? localStorage.getItem(STORAGE_KEY) : null
  );
  if (!saved) return;
  try {
    const backup = JSON.parse(saved) as Partial<LevelLayout>;
    if (backup.skyGradient) {
      layout.skyGradient = normalizeSkyGradient(backup.skyGradient);
    }
    if (backup.lighting) {
      layout.lighting = normalizeLightingSettings(backup.lighting as LightingSettings);
    }
    if (backup.terrain?.roadShader) {
      layout.terrain = layout.terrain ?? defaultTerrainSettings();
      layout.terrain.roadShader = normalizeRoadShaderSettings(backup.terrain.roadShader);
    }
    if (backup.terrain?.terrainLayers) {
      layout.terrain = layout.terrain ?? defaultTerrainSettings();
      layout.terrain.terrainLayers = normalizeTerrainLayerSettings(backup.terrain.terrainLayers as TerrainLayerSettings);
    }
    if (backup.terrain?.water) {
      layout.terrain = layout.terrain ?? defaultTerrainSettings();
      layout.terrain.water = normalizeWaterSettings(backup.terrain.water);
    }
    if (Array.isArray(backup.terrain?.splines)) {
      layout.terrain = layout.terrain ?? defaultTerrainSettings();
      layout.terrain.splines = backup.terrain.splines;
    }
  } catch (error) {
    console.warn("Failed to merge local road shader backup.", error);
  }
}

async function loadAssetCatalog(_url: string) {
  try {
    const rows = await listVisibleAssets(userId);
    const definitions: AssetDefinition[] = rows
      .filter((row) => row.format?.toLowerCase() === "glb")
      .map((row) => {
        assetRowById.set(row.id, row);
        return {
          category: row.clerk_user_id === userId ? "My Assets" : "Shared / Public",
          name: row.name,
          // Real Woven assets are private storage objects, not fetchable
          // paths — the catalog stores the creator_assets id here and
          // loadTemplate() resolves it to a signed URL on demand.
          url: row.id,
          kind: "asset" as const,
          fileName: row.name,
          sizeBytes: row.file_bytes,
          triangleCount: row.poly_count ?? undefined,
        };
      });
    state.assetCatalog = mergeAssetCatalogs(definitions, LIGHT_ASSET_CATALOG);
    saveCachedAssetCatalog();
    return true;
  } catch (error) {
    console.warn("Failed to load the Woven asset library; using cached asset list.", error);
    return false;
  }
}

function requestUrlCandidates(url: string) {
  const candidates = [url];
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      const local = new URL(parsed.pathname + parsed.search + parsed.hash, window.location.origin).toString();
      if (!candidates.includes(local)) candidates.push(local);
    } catch {
      // ignore malformed fallback
    }
  }
  return candidates;
}

async function loadTerrainTextures() {
  try {
    const [soilMap, sandMap, roadMap, sandDunesAlbedo, sandDunesAo, sandDunesHeight, sandDunesMetallic, sandDunesNormal, sandDunesRoughness, gravelAlbedo, gravelAo, gravelHeight, gravelMetallic, gravelNormal, gravelRoughness, asphaltStandard, asphaltCrackedNormal, highwayAlbedo, highwayAo, highwayHeight, highwayMetallic, highwayNormal, highwayRoughness] = await Promise.all([
      loadTexture("soil_standard.png", true),
      loadTexture("sand.png", true),
      loadTexture("asphalt_standard.png", true),
      loadTexture("sand-dunes1_albedo.png", true),
      loadTexture("sand-dunes1_ao.png", false),
      loadTexture("sand-dunes1_height.png", false),
      loadTexture("sand-dunes1_metallic.png", false),
      loadTexture("sand-dunes1_normal-dx.png", false),
      loadTexture("sand-dunes1_roughness.png", false),
      loadTexture("gravel_albedo.png", true),
      loadTexture("gravel_ao.png", false),
      loadTexture("gravel_height.png", false),
      loadTexture("gravel_metallic.png", false),
      loadTexture("gravel_normal-dx.png", false),
      loadTexture("gravel_roughness.png", false),
      loadTexture("asphalt_standard.png", true),
      loadTexture("asphalt_cracked_normal.png", false),
      loadTexture("highway-lanes_albedo.png", true),
      loadTexture("highway-lanes_ao.png", false),
      loadTexture("highway-lanes_height.png", false),
      loadTexture("highway-lanes_metallic.png", false),
      loadTexture("highway-lanes_normal-dx.png", false),
      loadTexture("highway-lanes_roughness.png", false),
    ]);
    terrainTextureUniforms.soilMap.value = soilMap;
    terrainTextureUniforms.sandMap.value = sandMap;
    terrainTextureUniforms.roadMap.value = roadMap;
    terrainMaterial.map = soilMap;
    terrainMaterial.needsUpdate = true;
    terrainTextureLibrary.soil = {
      albedo: soilMap,
      ao: sandDunesAo,
      height: sandDunesHeight,
      metallic: sandDunesMetallic,
      normal: sandDunesNormal,
      roughness: sandDunesRoughness,
    };
    terrainTextureLibrary["sand-dunes1"] = {
      albedo: sandDunesAlbedo,
      ao: sandDunesAo,
      height: sandDunesHeight,
      metallic: sandDunesMetallic,
      normal: sandDunesNormal,
      roughness: sandDunesRoughness,
    };
    roadTextureLibrary.gravel = {
      albedo: gravelAlbedo,
      ao: gravelAo,
      height: gravelHeight,
      metallic: gravelMetallic,
      normal: gravelNormal,
      roughness: gravelRoughness,
    };
    roadTextureLibrary.asphalt = {
      albedo: asphaltStandard,
      ao: gravelAo,
      height: gravelHeight,
      metallic: gravelMetallic,
      normal: asphaltCrackedNormal,
      roughness: gravelRoughness,
    };
    roadTextureLibrary["highway-lanes"] = {
      albedo: highwayAlbedo,
      ao: highwayAo,
      height: highwayHeight,
      metallic: highwayMetallic,
      normal: highwayNormal,
      roughness: highwayRoughness,
    };
    applyTerrainShaderSettings();
    applyRoadShaderSettings();
    applyTextureRepeats();
    roadMaterial.needsUpdate = true;
  } catch (error) {
    console.warn("Failed to load terrain textures.", error);
  }
}

function setTextureRepeat(texture: THREE.Texture | null, repeat: number) {
  if (!texture) return;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.needsUpdate = true;
}

function applyTextureRepeats() {
  const terrainLayers = normalizeTerrainLayerSettings(state.layout.terrain?.terrainLayers ?? defaultTerrainSettings().terrainLayers);
  setTextureRepeat(terrainMaterial.map, terrainLayers.dirt.repeat);
  setTextureRepeat(sandMaterial.map, terrainLayers.sand.repeat);
  setTextureRepeat(roadMaterial.map, state.roadRepeat);
  setTextureRepeat(shaderBallMaterial.map, state.roadRepeat);
}

function disposeMaterialTextureMap(material: THREE.MeshStandardMaterial) {
  const typed = material as THREE.MeshStandardMaterial & {
    map?: THREE.Texture | null;
    aoMap?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
    roughnessMap?: THREE.Texture | null;
    metalnessMap?: THREE.Texture | null;
    bumpMap?: THREE.Texture | null;
    alphaMap?: THREE.Texture | null;
  };
  [typed.map, typed.aoMap, typed.normalMap, typed.roughnessMap, typed.metalnessMap, typed.bumpMap, typed.alphaMap].forEach((texture) => {
    texture?.dispose?.();
  });
}

function cloneConfiguredTexture(texture: THREE.Texture, repeat: number, isColor: boolean) {
  const clone = texture.clone();
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.repeat.set(repeat, repeat);
  clone.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  clone.needsUpdate = true;
  return clone;
}

function applyTerrainShaderSettings() {
  currentTerrainLayerSettings = normalizeTerrainLayerSettings(state.layout.terrain?.terrainLayers ?? defaultTerrainSettings().terrainLayers);
}

function applyRoadShaderSettings() {
  const roadShader = normalizeRoadShaderSettings(state.layout.terrain?.roadShader ?? null);
  const bundle = roadTextureLibrary[roadShader.preset] ?? roadTextureLibrary["highway-lanes"] ?? roadTextureLibrary.gravel;
  if (!bundle) return;

  roadMaterial.map = bundle.albedo;
  roadMaterial.aoMap = bundle.ao;
  roadMaterial.normalMap = bundle.normal;
  roadMaterial.roughnessMap = bundle.roughness;
  roadMaterial.bumpMap = bundle.height;
  roadMaterial.metalnessMap = bundle.metallic;
  roadMaterial.color.set(0xffffff);
  roadMaterial.aoMapIntensity = roadShader.aoStrength;
  roadMaterial.normalScale = new THREE.Vector2(roadShader.normalStrength, roadShader.normalStrength);
  roadMaterial.bumpScale = roadShader.bumpStrength;
  roadMaterial.roughness = roadShader.roughness;
  roadMaterial.metalness = roadShader.metalness;
  roadMaterial.needsUpdate = true;
  shaderBallMaterial.copy(roadMaterial);
  setTextureRepeat(bundle.albedo, 1);
  setTextureRepeat(bundle.ao, 1);
  setTextureRepeat(bundle.normal, 1);
  setTextureRepeat(bundle.roughness, 1);
  setTextureRepeat(bundle.height, 1);
  setTextureRepeat(bundle.metallic, 1);
  setTextureRepeat(shaderBallMaterial.map, 1);
  shaderBallMaterial.aoMap = roadMaterial.aoMap;
  shaderBallMaterial.normalMap = roadMaterial.normalMap;
  shaderBallMaterial.roughnessMap = roadMaterial.roughnessMap;
  shaderBallMaterial.bumpMap = roadMaterial.bumpMap;
  shaderBallMaterial.metalnessMap = roadMaterial.metalnessMap;
  shaderBallMaterial.aoMapIntensity = roadMaterial.aoMapIntensity;
  shaderBallMaterial.normalScale = roadMaterial.normalScale.clone();
  shaderBallMaterial.bumpScale = roadMaterial.bumpScale;
  shaderBallMaterial.roughness = roadMaterial.roughness;
  shaderBallMaterial.metalness = roadMaterial.metalness;
  shaderBallMaterial.needsUpdate = true;
  syncShaderBallPreviewMaterial();
}

async function loadTexture(fileName: string, isColor: boolean) {
  const cached = texturePromises.get(fileName);
  if (cached) return cached;

  const promise = new Promise<THREE.Texture>((resolve, reject) => {
    const urls = Array.from(new Set([
      resolveAssetUrl(`/assets/texture/${fileName}`),
      `/assets/texture/${fileName}`,
    ]));
    const tryLoad = (index: number) => {
      const url = urls[index];
      if (!url) {
        reject(new Error(`Failed to load texture ${fileName}`));
        return;
      }
      textureLoader.load(
        url,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          texture.needsUpdate = true;
          resolve(texture);
        },
        undefined,
        () => tryLoad(index + 1)
      );
    };
    tryLoad(0);
  });

  texturePromises.set(fileName, promise);
  return promise;
}

function rebuildWorld() {
  applyTerrainShaderSettings();
  applyRoadShaderSettings();
  applyTextureRepeats();
  clearGroup(terrainRoot);
  clearGroup(roadRoot);
  clearGroup(waterRoot);
  clearGroup(objectRoot);
  terrainMeshes.length = 0;
  waterMeshes.length = 0;
  waterSurfaceMesh = null;
  objectMeshes.clear();
  selectableMeshes.length = 0;

  const chunks = state.layout.terrainChunks ?? [];
  for (const chunk of chunks) {
    const terrainMesh = createTerrainMesh(chunk);
    terrainRoot.add(terrainMesh);
    terrainMeshes.push(terrainMesh);
  }
  const waterSurface = createWaterSurfaceMesh(chunks);
  if (waterSurface) waterRoot.add(waterSurface);
  rebuildRoadMeshes();

  for (const object of state.layout.objects) {
    spawnObject(object);
  }

  applySkyAndWater();
  focusWorldPivot();
  updateAssetList();
  updateSceneOutliner();
  updateInspector();
  updateDiagnostics();
}

function rebuildTerrainSurfaces() {
  clearGroup(terrainRoot);
  clearGroup(roadRoot);
  clearGroup(waterRoot);
  terrainMeshes.length = 0;
  waterMeshes.length = 0;
  waterSurfaceMesh = null;
  for (const chunk of terrainChunks()) {
    const terrainMesh = createTerrainMesh(chunk);
    terrainRoot.add(terrainMesh);
    terrainMeshes.push(terrainMesh);
  }
  const waterSurface = createWaterSurfaceMesh(terrainChunks());
  if (waterSurface) waterRoot.add(waterSurface);
  rebuildRoadMeshes();
  updateDiagnostics();
}

function terrainChunks() {
  return state.layout.terrainChunks ?? [];
}

function terrainHeightAt(x: number, z: number) {
  return sampleTerrainHeight(terrainChunks(), x, z, 0, state.layout.chunkSize || 64, state.layout.district || "district_00");
}

function roadWidthAt(road: TerrainSpline) {
  return Math.max(1.5, (road.width ?? 6) * ROAD_WIDTH_SCALE);
}

function sampleRoadPath(points: Array<{ x: number; z: number }>) {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => new THREE.Vector3(point.x, 0, point.z)),
    false,
    "centripetal",
    0.45
  );
  const samples = Math.max(points.length * 8, Math.ceil(curve.getLength() / 1.5));
  return curve.getPoints(samples).map((point) => ({ x: point.x, z: point.z }));
}

function buildRoadRibbonGeometry(road: TerrainSpline) {
  const samples = sampleRoadPath(road.points);
  if (samples.length < 2) return null;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const width = roadWidthAt(road);
  let pathDistance = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const previous = samples[Math.max(0, index - 1)];
    const current = samples[index];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    const tangentX = next.x - previous.x;
    const tangentZ = next.z - previous.z;
    const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
    const dirX = tangentX / tangentLength;
    const dirZ = tangentZ / tangentLength;
    const rightX = -dirZ;
    const rightZ = dirX;
    const y = Math.max(road.elevation ?? 0, terrainHeightAt(current.x, current.z)) + 0.08;
    const leftX = current.x - rightX * width * 0.5;
    const leftZ = current.z - rightZ * width * 0.5;
    const rightPosX = current.x + rightX * width * 0.5;
    const rightPosZ = current.z + rightZ * width * 0.5;
    positions.push(
      leftX, y, leftZ,
      rightPosX, y, rightPosZ
    );
    const u = pathDistance * Math.max(0.1, state.roadRepeat ?? 1);
    uvs.push(0, u, 1, u);
    if (index < samples.length - 1) {
      const nextPoint = samples[index + 1];
      pathDistance += Math.hypot(nextPoint.x - current.x, nextPoint.z - current.z);
      const vertexIndex = index * 2;
      indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex + 1, vertexIndex + 3, vertexIndex + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv2", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function rebuildRoadMeshes() {
  clearGroup(roadRoot);
  clearGroup(roadGuideGroup);
  roadPointMarkers.clear();
  const roads = (state.layout.terrain?.splines ?? []).filter((spline) => spline.kind === "road" && spline.points.length >= 2);
  for (const road of roads) {
    const geometry = buildRoadRibbonGeometry(road);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, roadMaterial);
    mesh.receiveShadow = true;
    roadRoot.add(mesh);

    const guideMaterial = new THREE.LineBasicMaterial({ color: 0xa9ddff, transparent: true, opacity: 0.95 });
    const guidePositions: number[] = [];
    const samples = sampleRoadPath(road.points);
    for (let index = 0; index < samples.length; index += 1) {
      const current = samples[index];
      guidePositions.push(current.x, Math.max(road.elevation ?? 0, terrainHeightAt(current.x, current.z)) + 0.22, current.z);
    }
    const guideGeometry = new THREE.BufferGeometry();
    guideGeometry.setAttribute("position", new THREE.Float32BufferAttribute(guidePositions, 3));
    const line = new THREE.Line(guideGeometry, guideMaterial);
    line.visible = state.terrainMode === "road";
    roadGuideGroup.add(line);
    for (let pointIndex = 0; pointIndex < road.points.length; pointIndex += 1) {
      const point = road.points[pointIndex];
      const key = roadPointKey(road.id, pointIndex);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0x56a6e8, transparent: true, opacity: 0.95 })
      );
      marker.position.set(point.x, Math.max(road.elevation ?? 0, terrainHeightAt(point.x, point.z)) + 0.28, point.z);
      marker.visible = state.terrainMode === "road";
      marker.userData.roadPoint = { roadId: road.id, pointIndex };
      roadPointMarkers.set(key, marker);
      roadGuideGroup.add(marker);
    }
  }
  roadGuideGroup.visible = state.terrainMode === "road";
  restoreSelectedRoadPointHandle();
}

function resampleRoadPath(points: Array<{ x: number; z: number }>, spacing: number) {
  const result: Array<{ x: number; z: number }> = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 0; step <= steps; step += 1) {
      if (index > 1 && step === 0) continue;
      const t = step / steps;
      result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return result;
}

function clearGroup(group: THREE.Group) {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  while (group.children.length > 0) {
    const child = group.children.pop();
    if (!child) continue;
    child.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
        disposedGeometries.add(mesh.geometry);
        mesh.geometry.dispose?.();
      }
      const material = mesh.material;
      if (mesh.userData.disposeMaterial) {
        const materials = Array.isArray(material) ? material : [material];
        materials.forEach((item) => {
          if (!item || disposedMaterials.has(item)) return;
          disposedMaterials.add(item);
          item.dispose?.();
        });
      }
    });
  }
}

function createTerrainMesh(chunk: TerrainChunkData): THREE.Object3D {
  const geometry = buildHeightfield(chunk);
  const material = terrainMaterial.clone();
  material.vertexColors = true;
  material.transparent = false;
  material.depthWrite = true;
  material.needsUpdate = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.renderOrder = 0;
  mesh.userData = { kind: "terrain", chunkId: chunk.id, waterMask: chunk.waterMask };
  const group = new THREE.Group();
  group.add(mesh);
  group.userData = { kind: "terrain", chunkId: chunk.id, waterMask: chunk.waterMask };
  return group;
}

function distanceToSegment2d(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq > 0 ? clamp((apx * abx + apz * abz) / lengthSq, 0, 1) : 0;
  const x = ax + abx * t;
  const z = az + abz * t;
  return Math.hypot(px - x, pz - z);
}

function roadBlendAt(x: number, z: number) {
  const roads = (state.layout.terrain?.splines ?? []).filter((spline) => spline.kind === "road");
  let blend = 0;
  for (const road of roads) {
    const path = sampleRoadPath(road.points);
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const halfWidth = roadWidthAt(road) * 0.5;
      const shoulder = Math.max(0.5, road.shoulder ?? 5);
      const distance = distanceToSegment2d(x, z, a.x, a.z, b.x, b.z);
      const local = 1 - smoothstep(halfWidth, halfWidth + shoulder, distance);
      blend = Math.max(blend, local);
    }
  }
  return blend;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function buildHeightfield(chunk: TerrainChunkData) {
  const resolution = chunk.resolution || 33;
  const spacing = chunk.spacing || 2;
  const vertices = resolution * resolution;
  const positions = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const colors = new Float32Array(vertices * 3);
  const indices: number[] = [];
  const heights = chunk.heights ?? [];
  const waterMask = chunk.waterMask ?? [];
  const maxIndex = resolution - 1;
  const originX = chunk.origin?.[0] ?? 0;
  const originZ = chunk.origin?.[1] ?? 0;
  const waterLevel = state.layout.terrain?.waterLevel ?? -1.35;
  const soilColor: [number, number, number] = [0.49, 0.39, 0.26];
  const sandColor: [number, number, number] = [0.78, 0.68, 0.46];
  const grassColor: [number, number, number] = [0.18, 0.34, 0.16];
  const wetTint: [number, number, number] = [0.14, 0.12, 0.1];

  for (let z = 0; z < resolution; z += 1) {
  for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      const posIndex = index * 3;
      const height = heights[index] ?? 0;
      const left = heights[index - 1] ?? height;
      const right = heights[index + 1] ?? height;
      const down = heights[index - resolution] ?? height;
      const up = heights[index + resolution] ?? height;
      const slope = Math.max(Math.abs(height - left), Math.abs(height - right), Math.abs(height - down), Math.abs(height - up)) / Math.max(1, spacing);
      const wetness = smoothstep(waterLevel - 0.18, waterLevel + 0.85, waterLevel - height + 0.48);
      const sandWeight = clamp(layerBlendValueAt(chunk, "sand", index), 0, 1);
      const grassWeight = clamp(layerBlendValueAt(chunk, "grass", index), 0, 1);
      const slopeGrass = clamp(1 - smoothstep(0.08, 0.28, slope), 0, 1);
      let sandMix = clamp(sandWeight, 0, 1);
      let grassMix = clamp(grassWeight * slopeGrass, 0, 1);
      const blendSum = sandMix + grassMix;
      if (blendSum > 1) {
        sandMix /= blendSum;
        grassMix /= blendSum;
      }
      const soilMix = clamp(1 - sandMix - grassMix, 0, 1);
      const landColor = [
        soilColor[0] * soilMix + sandColor[0] * sandMix + grassColor[0] * grassMix,
        soilColor[1] * soilMix + sandColor[1] * sandMix + grassColor[1] * grassMix,
        soilColor[2] * soilMix + sandColor[2] * sandMix + grassColor[2] * grassMix,
      ] as [number, number, number];
      const wetDarken = clamp(wetness * 0.35, 0, 0.35);
      const finalColor = mixRgb(landColor, wetTint, wetDarken);
      positions[posIndex] = originX + x * spacing;
      positions[posIndex + 1] = height;
      positions[posIndex + 2] = originZ + z * spacing;
      uvs[index * 2] = x / maxIndex;
      uvs[index * 2 + 1] = z / maxIndex;
      colors[posIndex] = finalColor[0];
      colors[posIndex + 1] = finalColor[1];
      colors[posIndex + 2] = finalColor[2];
    }
  }

  for (let z = 0; z < maxIndex; z += 1) {
    for (let x = 0; x < maxIndex; x += 1) {
      const i = z * resolution + x;
      indices.push(i, i + resolution, i + 1);
      indices.push(i + 1, i + resolution, i + resolution + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function layerMaskForChunk(chunk: TerrainChunkData) {
  chunk.paintMask ??= {};
  chunk.paintMask.grass ??= new Array(chunk.heights.length).fill(0);
  chunk.paintMask.sand ??= new Array(chunk.heights.length).fill(0);
  return chunk.paintMask;
}

function paintShaderAt(point: THREE.Vector3) {
  updateTerrainToolSettings();
  pushHistory("terrain");
  let touched = false;
  for (const chunk of terrainChunks()) {
    const mask = layerMaskForChunk(chunk);
    const sandMask = mask.sand!;
    const grassMask = mask.grass!;
    for (let z = 0; z < chunk.resolution; z += 1) {
      for (let x = 0; x < chunk.resolution; x += 1) {
        const worldX = chunk.origin[0] + x * chunk.spacing;
        const worldZ = chunk.origin[1] + z * chunk.spacing;
        const distance = Math.hypot(worldX - point.x, worldZ - point.z);
        if (distance > state.brushRadius) continue;
        const weight = terrainBrushWeight(distance, state.brushRadius, state.brushFalloff) * clamp(state.brushStrength, 0.05, 1);
        const index = z * chunk.resolution + x;
        if (state.paintLayer === "soil") {
          sandMask[index] = clamp(sandMask[index] - weight, 0, 1);
          grassMask[index] = clamp(grassMask[index] - weight, 0, 1);
        } else if (state.paintLayer === "sand") {
          sandMask[index] = clamp(sandMask[index] + weight, 0, 1);
          grassMask[index] = clamp(grassMask[index] - weight * 0.65, 0, 1);
        } else if (state.paintLayer === "grass") {
          grassMask[index] = clamp(grassMask[index] + weight, 0, 1);
          sandMask[index] = clamp(sandMask[index] - weight * 0.7, 0, 1);
        }
        touched = true;
      }
    }
  }
  if (!touched) return;
  const terrain = ensureTerrainSettings();
  terrain.revision += 1;
  rebuildTerrainSurfaces();
  saveLocalLayout();
}

function autoSandAt(chunk: TerrainChunkData, index: number) {
  const waterLevel = state.layout.terrain?.waterLevel ?? -1.35;
  const height = chunk.heights[index] ?? waterLevel;
  return smoothstep(-0.35, 1.15, waterLevel - height + 0.45) * 0.8;
}

function autoGrassAt(chunk: TerrainChunkData, index: number) {
  const waterLevel = state.layout.terrain?.waterLevel ?? -1.35;
  const height = chunk.heights[index] ?? waterLevel;
  const resolution = chunk.resolution || 33;
  const spacing = chunk.spacing || 2;
  const left = chunk.heights[index - 1] ?? height;
  const right = chunk.heights[index + 1] ?? height;
  const down = chunk.heights[index - resolution] ?? height;
  const up = chunk.heights[index + resolution] ?? height;
  const slope = Math.max(Math.abs(height - left), Math.abs(height - right), Math.abs(height - down), Math.abs(height - up)) / Math.max(1, spacing);
  const elevation = smoothstep(waterLevel + 0.1, waterLevel + 3.6, height);
  const flatness = 1 - smoothstep(0.08, 0.26, slope);
  return clamp(elevation * flatness, 0, 1);
}

function layerBlendValueAt(chunk: TerrainChunkData, layer: "sand" | "grass", index: number) {
  const mask = layerMaskForChunk(chunk);
  const painted = mask[layer]?.[index] ?? 0;
  if (layer === "sand") return Math.max(painted, autoSandAt(chunk, index));
  if (layer === "grass") return Math.max(painted, autoGrassAt(chunk, index));
  return painted;
}

function createWaterMesh(chunk: TerrainChunkData) {
  const resolution = chunk.resolution || 33;
  const spacing = chunk.spacing || 2;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const heights = chunk.heights ?? [];
  const waterMask = chunk.waterMask ?? [];
  const originX = chunk.origin?.[0] ?? 0;
  const originZ = chunk.origin?.[1] ?? 0;
  const waterLevel = state.layout.terrain?.waterLevel ?? -1.35;

  for (let z = 0; z < resolution - 1; z += 1) {
    for (let x = 0; x < resolution - 1; x += 1) {
      const index = z * resolution + x;
      const left = originX + x * spacing;
      const near = originZ + z * spacing;
      const start = positions.length / 3;
      const h0 = heights[index] ?? waterLevel;
      const h1 = heights[index + 1] ?? h0;
      const h2 = heights[index + resolution] ?? h0;
      const h3 = heights[index + resolution + 1] ?? h0;
      const submerged0 = Math.max(0, waterLevel - h0);
      const submerged1 = Math.max(0, waterLevel - h1);
      const submerged2 = Math.max(0, waterLevel - h2);
      const submerged3 = Math.max(0, waterLevel - h3);
      const mask0 = clamp((waterMask[index] ? 1 : 0) * 0.88 + submerged0 / 4.5, 0, 1);
      const mask1 = clamp((waterMask[index + 1] ? 1 : 0) * 0.88 + submerged1 / 4.5, 0, 1);
      const mask2 = clamp((waterMask[index + resolution] ? 1 : 0) * 0.88 + submerged2 / 4.5, 0, 1);
      const mask3 = clamp((waterMask[index + resolution + 1] ? 1 : 0) * 0.88 + submerged3 / 4.5, 0, 1);

      positions.push(
        left, waterLevel + 0.14, near,
        left + spacing, waterLevel + 0.14, near,
        left, waterLevel + 0.14, near + spacing,
        left + spacing, waterLevel + 0.14, near + spacing
      );
      colors.push(
        1, 1, 1, mask0,
        1, 1, 1, mask1,
        1, 1, 1, mask2,
        1, 1, 1, mask3
      );
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
      indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.basePositions = new Float32Array(positions);

  const mesh = new THREE.Mesh(geometry, waterMaterial);
  mesh.renderOrder = 200;
  mesh.frustumCulled = false;
  mesh.userData = { kind: "water", chunkId: chunk.id };
  return mesh;
}

function createWaterSurfaceMesh(chunks: TerrainChunkData[]) {
  const hasVisibleWater = chunks.some((chunk) => (chunk.waterMask ?? []).some((value) => value > 0));
  if (!hasVisibleWater) return null;
  const terrain = state.layout.terrain ?? defaultTerrainSettings();
  const waterLevel = terrain.waterLevel ?? -1.35;
  const extentChunks = Math.max(1, terrain.extentChunks || 4);
  const chunkSize = state.layout.chunkSize || 64;
  const span = extentChunks * chunkSize;
  const bounds = chunks.length > 0
    ? {
        minX: Math.min(...chunks.map((chunk) => chunk.origin?.[0] ?? 0)),
        maxX: Math.max(...chunks.map((chunk) => (chunk.origin?.[0] ?? 0) + (chunk.resolution ?? 33) * (chunk.spacing ?? 2))),
        minZ: Math.min(...chunks.map((chunk) => chunk.origin?.[1] ?? 0)),
        maxZ: Math.max(...chunks.map((chunk) => (chunk.origin?.[1] ?? 0) + (chunk.resolution ?? 33) * (chunk.spacing ?? 2))),
      }
    : {
        minX: -span * 0.5,
        maxX: span * 0.5,
        minZ: -span * 0.5,
        maxZ: span * 0.5,
      };
  const width = Math.max(64, bounds.maxX - bounds.minX);
  const depth = Math.max(64, bounds.maxZ - bounds.minZ);
  const geometry = new THREE.PlaneGeometry(width, depth, 128, 128);
  configureWaterMaterial(waterSurfaceMaterial, terrain.water ?? defaultWaterSettings());
  configureWaterMaterial(waterPreviewMaterial, terrain.water ?? defaultWaterSettings());
  const mesh = new ThreeWater(geometry, {
    textureWidth: 1024,
    textureHeight: 1024,
    waterNormals: waterNormalMap,
    alpha: clamp((terrain.water ?? defaultWaterSettings()).opacity, 0.35, 1.0),
    sunDirection: sunLight.position.clone().normalize(),
    sunColor: 0xffffff,
    waterColor: 0x2f82ad,
    distortionScale: 3.7,
    fog: false,
    side: THREE.DoubleSide,
  });
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((bounds.minX + bounds.maxX) * 0.5, waterLevel + 0.08, (bounds.minZ + bounds.maxZ) * 0.5);
  mesh.renderOrder = 50;
  mesh.frustumCulled = false;
  mesh.userData = { kind: "water-surface" };
  configureWaterSurface(mesh, terrain.water ?? defaultWaterSettings());
  waterSurfaceMesh = mesh;
  return mesh;
}

function waterPresenceAt(chunks: TerrainChunkData[], x: number, z: number, waterLevel: number) {
  let best = 0;
  for (const chunk of chunks) {
    const resolution = chunk.resolution || 33;
    const spacing = chunk.spacing || 2;
    const originX = chunk.origin?.[0] ?? 0;
    const originZ = chunk.origin?.[1] ?? 0;
    const maxX = originX + (resolution - 1) * spacing;
    const maxZ = originZ + (resolution - 1) * spacing;
    if (x < originX - spacing || x > maxX + spacing || z < originZ - spacing || z > maxZ + spacing) continue;

    const waterMask = chunk.waterMask ?? [];
    const localX = clamp((x - originX) / spacing, 0, resolution - 1);
    const localZ = clamp((z - originZ) / spacing, 0, resolution - 1);
    const x0 = Math.floor(localX);
    const z0 = Math.floor(localZ);
    const x1 = Math.min(x0 + 1, resolution - 1);
    const z1 = Math.min(z0 + 1, resolution - 1);
    const tx = localX - x0;
    const tz = localZ - z0;
    const sample = (
      (waterMask[z0 * resolution + x0] ? 1 : 0) * (1 - tx) * (1 - tz) +
      (waterMask[z0 * resolution + x1] ? 1 : 0) * tx * (1 - tz) +
      (waterMask[z1 * resolution + x0] ? 1 : 0) * (1 - tx) * tz +
      (waterMask[z1 * resolution + x1] ? 1 : 0) * tx * tz
    );
    const submerged = clamp((waterLevel - terrainHeightAt(x, z) + 0.35) / 1.5, 0, 1);
    best = Math.max(best, Math.max(sample * 0.95, submerged));
  }
  return best;
}

function spawnObject(object: PlacedObjectData) {
  if ((object.kind ?? "asset") === "light") {
    spawnLightObject(object);
    return;
  }

  loadTemplate(object.asset)
    .then((template) => {
      if (!state.layout.objects.some((item) => item.id === object.id)) return;
      const instance = cloneTemplate(template);
      instance.position.set(object.position[0], object.position[1], object.position[2]);
      instance.rotation.set(
        THREE.MathUtils.degToRad(object.rotation[0]),
        THREE.MathUtils.degToRad(object.rotation[1]),
        THREE.MathUtils.degToRad(object.rotation[2])
      );
      instance.scale.set(object.scale[0], object.scale[1], object.scale[2]);
      instance.userData.objectId = object.id;
      instance.userData.definition = object;
      instance.traverse((node) => {
        node.userData.objectId = object.id;
        node.userData.definition = object;
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          cloneImportedMeshMaterials(mesh);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          normalizeImportedMeshMaterial(mesh);
          assignStandardMaterials(mesh);
        }
      });
      applyObjectShaderMode(object, instance);
      objectRoot.add(instance);
      objectMeshes.set(object.id, instance);
      selectableMeshes.push(instance);
      if (state.selectedObjectId === object.id) {
        transformControls.attach(instance);
      }
    })
    .catch((error) => {
      console.warn(`Failed to load asset ${object.asset}`, error);
    });
}

function normalizeImportedMeshMaterial(mesh: THREE.Mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => {
    const mat = material as THREE.Material & {
      map?: THREE.Texture | null;
      emissiveMap?: THREE.Texture | null;
      emissive?: THREE.Color;
      aoMap?: THREE.Texture | null;
      roughnessMap?: THREE.Texture | null;
      metalnessMap?: THREE.Texture | null;
      normalMap?: THREE.Texture | null;
      bumpMap?: THREE.Texture | null;
      alphaMap?: THREE.Texture | null;
      normalScale?: THREE.Vector2;
      side?: THREE.Side;
      transparent?: boolean;
      opacity?: number;
      color?: THREE.Color;
    };
    if (!mat || !("isMaterial" in mat)) return;
    if (mat.transparent === undefined && mat.alphaMap) {
      mat.transparent = true;
    }
    if (mat.opacity !== undefined && mat.opacity < 0.2 && !mat.alphaMap) {
      mat.opacity = 1;
    }
    if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    if (mat.alphaMap) mat.alphaMap.colorSpace = THREE.NoColorSpace;
    if (mat.aoMap) mat.aoMap.colorSpace = THREE.NoColorSpace;
    if (mat.roughnessMap) mat.roughnessMap.colorSpace = THREE.NoColorSpace;
    if (mat.metalnessMap) mat.metalnessMap.colorSpace = THREE.NoColorSpace;
    if (mat.normalMap) mat.normalMap.colorSpace = THREE.NoColorSpace;
    if (mat.bumpMap) mat.bumpMap.colorSpace = THREE.NoColorSpace;
    if (mat.normalMap && mat.normalScale) {
      mat.normalScale.multiplyScalar(0.72);
    }
    const hasTexture =
      Boolean(mat.map || mat.emissiveMap || mat.aoMap || mat.roughnessMap || mat.metalnessMap || mat.normalMap || mat.bumpMap || mat.alphaMap);
    if (!hasTexture && mat.color) {
      const brightness = (mat.color.r + mat.color.g + mat.color.b) / 3;
      if (brightness < 0.16) {
        mat.color.lerp(new THREE.Color(0xffffff), 0.28);
      }
    }
    if (mat.emissive && !mat.emissiveMap && !hasTexture) {
      const emissiveBrightness = (mat.emissive.r + mat.emissive.g + mat.emissive.b) / 3;
      if (emissiveBrightness < 0.04) {
        mat.emissive.lerp(new THREE.Color(0x202020), 0.45);
      }
    }
    mat.needsUpdate = true;
  });
}

function cloneImportedMeshMaterials(mesh: THREE.Mesh) {
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((material) => material.clone());
    return;
  }
  mesh.material = mesh.material.clone();
}

function meshMaterialUserData(mesh: THREE.Mesh) {
  return mesh.userData as THREE.Object3D["userData"] & MeshMaterialUserData;
}

function materialListFromMesh(mesh: THREE.Mesh) {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshMaterialList;
}

function assignStandardMaterials(mesh: THREE.Mesh) {
  meshMaterialUserData(mesh).standardMaterials = materialListFromMesh(mesh);
}

function normalizeObjectShaderSettings(settings?: PlacedObjectData["shaderSettings"]): ObjectShaderSettings {
  const legacy = settings as
    | (PlacedObjectData["shaderSettings"] & {
        toonSteps?: number;
        toonContrast?: number;
        outlineEnabled?: boolean;
        outlineThickness?: number;
        outlineColor?: [number, number, number];
      })
    | undefined;
  return {
    toon: {
      steps: Math.round(clamp(settings?.toon?.steps ?? legacy?.toonSteps ?? 4, 2, 8)),
      contrast: clamp(settings?.toon?.contrast ?? legacy?.toonContrast ?? 1, 0.35, 2.5),
      outlineEnabled: settings?.toon?.outlineEnabled ?? legacy?.outlineEnabled ?? false,
      outlineThickness: clamp(settings?.toon?.outlineThickness ?? legacy?.outlineThickness ?? 0.035, 0.002, 0.18),
      outlineColor: [
        clamp(settings?.toon?.outlineColor?.[0] ?? legacy?.outlineColor?.[0] ?? 0.03, 0, 1),
        clamp(settings?.toon?.outlineColor?.[1] ?? legacy?.outlineColor?.[1] ?? 0.03, 0, 1),
        clamp(settings?.toon?.outlineColor?.[2] ?? legacy?.outlineColor?.[2] ?? 0.04, 0, 1),
      ],
    },
    outline: {
      fillColor: [
        clamp(settings?.outline?.fillColor?.[0] ?? 1, 0, 1),
        clamp(settings?.outline?.fillColor?.[1] ?? 1, 0, 1),
        clamp(settings?.outline?.fillColor?.[2] ?? 1, 0, 1),
      ],
      thickness: clamp(settings?.outline?.thickness ?? legacy?.outlineThickness ?? 0.035, 0.002, 0.18),
      color: [
        clamp(settings?.outline?.color?.[0] ?? legacy?.outlineColor?.[0] ?? 0.03, 0, 1),
        clamp(settings?.outline?.color?.[1] ?? legacy?.outlineColor?.[1] ?? 0.03, 0, 1),
        clamp(settings?.outline?.color?.[2] ?? legacy?.outlineColor?.[2] ?? 0.04, 0, 1),
      ],
    },
  };
}

function createToonGradientMap(stepCount = 4, contrast = 1) {
  const count = Math.max(2, Math.round(stepCount));
  const data = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 1 : index / (count - 1);
    data[index] = Math.round(clamp(Math.pow(t, contrast), 0, 1) * 255);
  }
  const steps = data;
  const texture = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createWaterNormalMap() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const nx = Math.sin(x * 0.23) * 0.5 + Math.sin((x + y) * 0.11) * 0.5;
      const ny = Math.cos(y * 0.19) * 0.5 + Math.sin((x - y) * 0.07) * 0.5;
      data[index] = Math.round((nx * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[index + 2] = 255;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function setMeshMaterials(mesh: THREE.Mesh, materials: MeshMaterialList) {
  mesh.material = materials.length === 1 ? materials[0] : materials;
}

function getObjectShaderMode(object: PlacedObjectData): ObjectShaderMode {
  return object.shaderMode === "toon" || object.shaderMode === "outline" ? object.shaderMode : "standard";
}

function createOutlineFillMaterial(material: THREE.Material, settings: OutlineShaderSettings) {
  const source = material as THREE.Material & {
    alphaMap?: THREE.Texture | null;
    alphaTest?: number;
    map?: THREE.Texture | null;
    opacity?: number;
    side?: THREE.Side;
    transparent?: boolean;
    visible?: boolean;
    wireframe?: boolean;
  };
  const fill = new THREE.MeshBasicMaterial({
    alphaMap: source.alphaMap ?? null,
    alphaTest: source.alphaTest ?? 0,
    color: new THREE.Color(...settings.fillColor),
    fog: false,
    map: source.map ?? null,
    opacity: source.opacity ?? 1,
    side: source.side ?? THREE.FrontSide,
    toneMapped: false,
    transparent: source.transparent,
    wireframe: source.wireframe ?? false,
    visible: source.visible,
  });
  fill.needsUpdate = true;
  return fill;
}

function createOutlineShell(mesh: THREE.Mesh, settings: OutlineShellSettings) {
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return null;
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(...settings.color),
    side: THREE.BackSide,
    fog: false,
    toneMapped: false,
  });
  const shell = new THREE.Mesh(mesh.geometry, outlineMaterial);
  shell.userData.isOutlineShell = true;
  shell.renderOrder = (mesh.renderOrder ?? 0) + 1;
  shell.frustumCulled = mesh.frustumCulled;
  shell.matrixAutoUpdate = true;
  shell.castShadow = false;
  shell.receiveShadow = false;
  shell.scale.setScalar(1 + settings.thickness);
  return shell;
}

function syncOutlineShell(mesh: THREE.Mesh, settings: OutlineShellSettings, shouldShow: boolean) {
  const userData = meshMaterialUserData(mesh);
  if (!shouldShow) {
    userData.outlineShell?.removeFromParent();
    userData.outlineShell = null;
    userData.outlineSignature = undefined;
    return;
  }
  const signature = `${settings.thickness}:${settings.color.join(",")}`;
  if (!userData.outlineShell || userData.outlineSignature !== signature) {
    userData.outlineShell?.removeFromParent();
    userData.outlineShell = createOutlineShell(mesh, settings);
    userData.outlineSignature = signature;
    if (userData.outlineShell) {
      mesh.add(userData.outlineShell);
    }
  }
  const shellMesh = userData.outlineShell as THREE.Mesh | null;
  if (!shellMesh) return;
  shellMesh.visible = true;
  shellMesh.scale.setScalar(1 + settings.thickness);
  const shellMaterial = shellMesh.material;
  if (shellMaterial instanceof THREE.MeshBasicMaterial) {
    shellMaterial.color.setRGB(settings.color[0], settings.color[1], settings.color[2]);
    shellMaterial.needsUpdate = true;
  }
}

function createToonMaterial(material: THREE.Material, settings: ToonShaderSettings) {
  if (material instanceof THREE.MeshToonMaterial) {
    const toon = material.clone();
    toon.gradientMap = createToonGradientMap(settings.steps, settings.contrast);
    toon.needsUpdate = true;
    return toon;
  }
  if (
    material instanceof THREE.ShaderMaterial ||
    material instanceof THREE.RawShaderMaterial ||
    material instanceof THREE.SpriteMaterial ||
    material instanceof THREE.PointsMaterial ||
    material instanceof THREE.LineBasicMaterial ||
    material instanceof THREE.LineDashedMaterial ||
    material instanceof THREE.ShadowMaterial
  ) {
    return material.clone();
  }

  const source = material as THREE.Material & {
    alphaMap?: THREE.Texture | null;
    alphaTest?: number;
    aoMap?: THREE.Texture | null;
    bumpMap?: THREE.Texture | null;
    bumpScale?: number;
    color?: THREE.Color;
    depthWrite?: boolean;
    dithering?: boolean;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
    emissiveMap?: THREE.Texture | null;
    fog?: boolean;
    flatShading?: boolean;
    lightMap?: THREE.Texture | null;
    lightMapIntensity?: number;
    map?: THREE.Texture | null;
    name?: string;
    normalMap?: THREE.Texture | null;
    normalScale?: THREE.Vector2;
    opacity?: number;
    side?: THREE.Side;
    skinning?: boolean;
    transparent?: boolean;
    vertexColors?: boolean;
    visible?: boolean;
    wireframe?: boolean;
  };

  const toon = new THREE.MeshToonMaterial({
    alphaMap: source.alphaMap ?? null,
    alphaTest: source.alphaTest ?? 0,
    aoMap: source.aoMap ?? null,
    bumpMap: source.bumpMap ?? null,
    bumpScale: source.bumpScale ?? 1,
    color: source.color?.clone() ?? new THREE.Color(0xffffff),
    depthWrite: source.depthWrite,
    dithering: source.dithering,
    emissive: source.emissive?.clone() ?? new THREE.Color(0x000000),
    emissiveIntensity: Math.min(source.emissiveIntensity ?? 1, 0.35),
    emissiveMap: source.emissiveMap ?? null,
    fog: source.fog,
    gradientMap: createToonGradientMap(settings.steps, settings.contrast),
    lightMap: source.lightMap ?? null,
    lightMapIntensity: source.lightMapIntensity ?? 1,
    map: source.map ?? null,
    name: source.name,
    normalMap: source.normalMap ?? null,
    normalScale: source.normalScale?.clone(),
    opacity: source.opacity ?? 1,
    side: source.side,
    transparent: source.transparent,
    vertexColors: source.vertexColors,
    visible: source.visible,
    wireframe: source.wireframe,
  });
  (toon as THREE.MeshToonMaterial & { flatShading?: boolean }).flatShading = source.flatShading ?? true;
  toon.needsUpdate = true;
  return toon;
}

function applyObjectShaderMode(object: PlacedObjectData, root: THREE.Object3D) {
  const shaderMode = getObjectShaderMode(object);
  const shaderSettings = normalizeObjectShaderSettings(object.shaderSettings);
  object.shaderSettings = shaderSettings;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.isOutlineShell) return;
    const userData = meshMaterialUserData(mesh);
    userData.originalCastShadow ??= mesh.castShadow;
    userData.originalReceiveShadow ??= mesh.receiveShadow;
    const standardMaterials = userData.standardMaterials;
    if (!standardMaterials?.length) return;
    const showOutline = shaderMode === "outline" || (shaderMode === "toon" && shaderSettings.toon.outlineEnabled);
    const outlineSettings =
      shaderMode === "toon"
        ? { thickness: shaderSettings.toon.outlineThickness, color: shaderSettings.toon.outlineColor }
        : shaderSettings.outline;
    syncOutlineShell(mesh, outlineSettings, showOutline);
    if (shaderMode === "toon") {
      const signature = `${shaderSettings.toon.steps}:${shaderSettings.toon.contrast}`;
      if (!userData.toonMaterials || userData.toonSignature !== signature) {
        userData.toonMaterials = standardMaterials.map((material) => createToonMaterial(material, shaderSettings.toon));
        userData.toonSignature = signature;
      }
      mesh.castShadow = userData.originalCastShadow ?? true;
      mesh.receiveShadow = userData.originalReceiveShadow ?? true;
      setMeshMaterials(mesh, userData.toonMaterials);
      return;
    }
    if (shaderMode === "outline") {
      const fillSignature = `${shaderSettings.outline.fillColor.join(",")}`;
      if (!userData.outlineFillMaterials || userData.outlineFillSignature !== fillSignature) {
        userData.outlineFillMaterials = standardMaterials.map((material) => createOutlineFillMaterial(material, shaderSettings.outline));
        userData.outlineFillSignature = fillSignature;
      }
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      setMeshMaterials(mesh, userData.outlineFillMaterials);
      return;
    }
    mesh.castShadow = userData.originalCastShadow ?? true;
    mesh.receiveShadow = userData.originalReceiveShadow ?? true;
    setMeshMaterials(mesh, standardMaterials);
  });
}

function spawnLightObject(object: PlacedObjectData) {
  const group = new THREE.Group();
  group.position.set(object.position[0], object.position[1], object.position[2]);
  group.rotation.set(
    THREE.MathUtils.degToRad(object.rotation[0]),
    THREE.MathUtils.degToRad(object.rotation[1]),
    THREE.MathUtils.degToRad(object.rotation[2])
  );
  group.scale.set(object.scale[0], object.scale[1], object.scale[2]);

  const color = new THREE.Color(...(object.color ?? [1, 0.82, 0.48]));
  const lightType = object.lightType ?? "omni";
  const light =
    lightType === "directional"
      ? new THREE.DirectionalLight(color, object.intensity ?? 1.5)
      : lightType === "spot"
        ? new THREE.SpotLight(color, object.intensity ?? 4, object.range ?? 24, Math.PI / 5, 0.45, object.falloff ?? 2)
        : new THREE.PointLight(color, object.intensity ?? 4, object.range ?? 24);
  light.castShadow = lightType !== "omni";
  group.add(light);
  group.userData.light = light;

  const iconGeometry = lightType === "directional" ? new THREE.BoxGeometry(1.4, 0.22, 1.4) : new THREE.SphereGeometry(0.45, 16, 10);
  const iconMaterial = new THREE.MeshBasicMaterial({ color, wireframe: true });
  const icon = new THREE.Mesh(iconGeometry, iconMaterial);
  icon.userData.objectId = object.id;
  icon.userData.definition = object;
  group.add(icon);

  group.userData.objectId = object.id;
  group.userData.definition = object;
  objectRoot.add(group);
  objectMeshes.set(object.id, group);
  selectableMeshes.push(group);
}

function cloneTemplate(template: THREE.Object3D) {
  if ((template as THREE.SkinnedMesh | THREE.Group).isObject3D) {
    try {
      return cloneSkeleton(template);
    } catch {
      return template.clone(true);
    }
  }
  return template.clone(true);
}

// Placed objects reference a creator_assets id (see PlacedObjectData.asset),
// not a fetchable path — resolve it to a time-limited signed URL, cached per
// asset id for the life of this mount (RLS decides whether the row/storage
// object is even visible to this account, so a "not found" here can also
// mean "not shared with you").
async function resolveAssetSource(assetId: string): Promise<string> {
  const cached = signedUrlByAssetId.get(assetId);
  if (cached) return cached;
  const pending = (async () => {
    const row = assetRowById.get(assetId) ?? (await getAsset(assetId));
    if (!row) throw new Error(`Asset ${assetId} was not found or isn't visible to this account.`);
    assetRowById.set(assetId, row);
    return signedAssetUrl(row.storage_path);
  })();
  signedUrlByAssetId.set(assetId, pending);
  return pending;
}

async function loadTemplate(assetUrl: string) {
  const cached = templates.get(assetUrl);
  if (cached) return cached;
  const promise = (async () => {
    const isCreatorAsset = CREATOR_ASSET_ID_RE.test(assetUrl);
    const source = isCreatorAsset ? await resolveAssetSource(assetUrl) : assetUrl;
    const absolute = resolveAssetUrl(source);
    const candidates = requestUrlCandidates(absolute);
    // Signed URLs carry a `token=<jwt>` query string full of dots, so
    // extension-sniffing off the resolved URL would grab a JWT fragment
    // instead of the real extension — every creator_assets row is a .glb
    // (see uploadAsset in lib/assets.ts), so skip sniffing for those.
    const ext = isCreatorAsset ? "glb" : (absolute.split(".").pop()?.toLowerCase() ?? "");
    const loadWith = async (candidate: string) => {
      if (ext === "fbx") {
        return await new Promise<THREE.Object3D>((resolve, reject) => {
          fbxLoader.load(candidate, (object) => resolve(object), undefined, reject);
        });
      }
      return await new Promise<THREE.Object3D>((resolve, reject) => {
        loader.load(candidate, (gltf) => resolve(gltf.scene), undefined, reject);
      });
    };
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        return await loadWith(candidate);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Failed to load template ${assetUrl}`);
  })();
  templates.set(assetUrl, promise);
  return promise;
}

function resolveAssetUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) {
    if (/^https?:\/\//i.test(state.contentBase)) return new URL(url, state.contentBase).toString();
    return `${state.contentBase.replace(/\/$/, "")}${url}`;
  }
  return url;
}

function applySkyAndWater() {
  const palette = skyPaletteForTime(state.timeOfDay);
  const daylight = clamp(Math.sin(((state.timeOfDay - 6) / 12) * Math.PI), 0, 1);
  const twilight = Math.max(
    Math.max(0, 1 - Math.abs(state.timeOfDay - 6) / 2.5),
    Math.max(0, 1 - Math.abs(state.timeOfDay - 18) / 2.5)
  );
  const night = 1 - Math.max(daylight, twilight * 0.55);
  const sunHeight = Math.sin(((state.timeOfDay - 6) / 12) * Math.PI);
  const skyRotation = THREE.MathUtils.degToRad(state.lighting.skyRotation);
  const sunAngle = ((state.timeOfDay - 6) / 12) * Math.PI;
  const sunForward = Math.cos(sunAngle);
  const sunDirection = rotateDirectionY(0.18, sunHeight, sunForward, skyRotation);
  const moonDirection = rotateDirectionY(-0.28, -sunHeight, -sunForward, skyRotation);
  const waterSettings = state.water;

  skyMaterial.uniforms.sunSideColor.value.setRGB(...palette.sunSideColor);
  skyMaterial.uniforms.oppositeSideColor.value.setRGB(...palette.oppositeSideColor);
  skyMaterial.uniforms.topColor.value.setRGB(...palette.topColor);
  skyMaterial.uniforms.midColor.value.setRGB(...palette.midColor);
  skyMaterial.uniforms.horizonColor.value.setRGB(...palette.horizonColor);
  skyMaterial.uniforms.neonColor.value.setRGB(...palette.neonColor);
  skyMaterial.uniforms.moonColor.value.setRGB(...palette.moonColor);
  skyMaterial.uniforms.sunDirection.value.copy(sunDirection);
  skyMaterial.uniforms.moonDirection.value.copy(moonDirection);
  skyMaterial.uniforms.sunIntensity.value = (daylight * 1.65 + twilight * 0.85) * clamp(1 + sunHeight * 12, 0, 1);
  skyMaterial.uniforms.moonIntensity.value = (1.4 * night + twilight * 0.18) * clamp(1 - sunHeight * 12, 0, 1);
  skyMaterial.uniforms.elapsedTime.value = performance.now() / 1000;
  skyMaterial.uniforms.timeOfDay.value = state.timeOfDay;

  const sunStrength = daylight * 4.4 + twilight * 2.2 + 0.05;
  const moonStrength = state.lighting.moonIntensity * night * clamp(1 - sunHeight * 12, 0, 1);
  sunLight.intensity = sunStrength;
  sunLight.position.copy(sunDirection).multiplyScalar(180);
  sunLight.target.position.set(0, 0, 0);
  moonLight.intensity = moonStrength;
  moonLight.position.copy(moonDirection).multiplyScalar(180);
  moonLight.target.position.set(0, 0, 0);
  sunLight.castShadow = sunStrength >= moonStrength * 1.05;
  moonLight.castShadow = moonStrength > sunStrength * 0.85;
  hemiLight.intensity = 0.3 + state.lighting.ambientIntensity * (0.85 + daylight * 0.75);
  hemiLight.color.setRGB(...mixRgb(palette.topColor, [0.82, 0.9, 1.0], 0.42));
  hemiLight.groundColor.setRGB(...mixRgb([0.18, 0.16, 0.12], palette.horizonColor, 0.12));
  horizonGlow.intensity = state.lighting.horizonGlow * (twilight + night * 0.18);
  horizonGlow.position.set(80 * Math.cos(skyRotation + state.timeOfDay / 24 * Math.PI * 2), 8, 80 * Math.sin(skyRotation + state.timeOfDay / 24 * Math.PI * 2));
  ambientLight.intensity = state.lighting.ambientIntensity * (1.7 * (0.035 + daylight * 0.965) + daylight * 0.42 + twilight * 0.12);
  scene.fog!.color.setRGB(palette.midColor[0] * 0.5, palette.midColor[1] * 0.55, palette.midColor[2] * 0.6);
  configureWaterSurface(waterSurfaceMesh, waterSettings);

  const waterLevel = state.layout.terrain?.waterLevel ?? -1.35;
  const underwater = camera.position.y < waterLevel - 0.08;
  const shallowColor = mixRgb(palette.horizonColor, palette.topColor, 0.24);
  if (!scene.fog) {
    scene.fog = new THREE.FogExp2(0x0a1020, 0.0011);
  }
  const fog = scene.fog as THREE.FogExp2;
  if (underwater) {
    fog.color.setRGB(
      clamp(shallowColor[0] * 0.22 + 0.02, 0, 1),
      clamp(shallowColor[1] * 0.38 + 0.1, 0, 1),
      clamp(shallowColor[2] * 0.48 + 0.18, 0, 1)
    );
    fog.density = waterSettings.underwaterFogDensity;
  } else {
    fog.color.setRGB(palette.midColor[0] * 0.5, palette.midColor[1] * 0.55, palette.midColor[2] * 0.6);
    fog.density = 0.0011;
  }
  if (!ui.waterShaderModal.classList.contains("is-hidden")) {
    syncWaterShaderPreviewMaterial();
  }
}

function updateAssetList() {
  const query = assetSearch.value.trim().toLowerCase();
  const categories = [...new Set(state.assetCatalog.map((asset) => asset.category || "Root"))].sort((a, b) => a.localeCompare(b));
  const previousCategory = assetCategory.value;
  assetCategory.innerHTML = `<option value="">All categories</option>${categories
    .map((category) => `<option value="${category}">${category}</option>`)
    .join("")}`;
  assetCategory.value = categories.includes(previousCategory) ? previousCategory : "";
  const selectedCategory = assetCategory.value;
  assetList.innerHTML = "";
  const assets = state.assetCatalog.filter((asset) => {
    if (selectedCategory && asset.category !== selectedCategory) return false;
    if (!query) return true;
    return `${asset.category}/${asset.name}/${asset.url}`.toLowerCase().includes(query);
  });

  let lastCategory = "";
  for (const asset of assets) {
    if (!selectedCategory && asset.category !== lastCategory) {
      lastCategory = asset.category;
      const heading = document.createElement("div");
      heading.className = "asset-folder-heading";
      heading.textContent = lastCategory || "Root";
      assetList.appendChild(heading);
    }
    const button = document.createElement("button");
    button.className = "asset-card" + (state.selectedAssetUrl === asset.url ? " is-active" : "");
    button.draggable = true;
    button.innerHTML = `<strong>${asset.name}</strong><span>${asset.category}</span><span>${asset.url}</span>`;
    button.addEventListener("click", () => {
      state.selectedAssetUrl = asset.url;
      updateAssetList();
      updateStatus(`Selected ${asset.name}. Drag onto the world to place it.`);
    });
    button.addEventListener("dragstart", (event) => {
      state.selectedAssetUrl = asset.url;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", asset.url);
      }
      updateStatus(`Dragging ${asset.name}. Drop onto terrain to place it.`);
    });
    assetList.appendChild(button);
  }

  if (assets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "status";
    empty.textContent = state.assetCatalog.length === 0 ? "No assets loaded." : "No assets match this search.";
    assetList.appendChild(empty);
  }

}

function updateSceneOutliner() {
  sceneOutliner.innerHTML = "";
  const nodes: SceneNodeData[] = [...(state.layout.groups ?? []), ...state.layout.objects];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const children = new Map<string, SceneNodeData[]>();

  nodes.forEach((node) => {
    const parentId = node.parentId && nodeIds.has(node.parentId) ? node.parentId : "root";
    const nested = children.get(parentId) ?? [];
    nested.push(node);
    children.set(parentId, nested);
  });

  children.forEach((nested) => nested.sort((a, b) => nodeDisplayName(a).localeCompare(nodeDisplayName(b))));

  const renderNode = (node: SceneNodeData, depth: number) => {
    const row = document.createElement("button");
    const nested = children.get(node.id) ?? [];
    const isGroup = node.kind === "group";
    row.type = "button";
    row.className = "outliner-row";
    row.classList.toggle("is-active", selectedObjectIds.has(node.id));
    row.classList.toggle("is-group", isGroup);
    row.style.setProperty("--depth", String(depth));
    const detail = isGroup ? `GROUP | ${nested.length}` : `${objectKindLabel(node)} | ${objectRuntimeLabel(node)}`;
    row.title = isGroup ? nodeDisplayName(node) : `${nodeDisplayName(node)}\n${detail}`;
    row.innerHTML = `<span>${nested.length > 0 ? "- " : ""}${nodeDisplayName(node)}</span><span>${detail}</span>`;
    row.addEventListener("click", (event) => {
      if (isGroup) {
        selectObject(null);
        updateStatus(`Selected group: ${nodeDisplayName(node)}`);
        return;
      }
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        toggleObjectSelection(node.id);
        return;
      }
      selectObject(node.id);
    });
    row.addEventListener("dblclick", () => focusObjects([node.id]));
    sceneOutliner.appendChild(row);
    nested.forEach((child) => renderNode(child, depth + 1));
  };

  const roots = children.get("root") ?? [];
  if (roots.length === 0) {
    const empty = document.createElement("div");
    empty.className = "status";
    empty.textContent = "No placed objects yet.";
    sceneOutliner.appendChild(empty);
    return;
  }
  roots.forEach((node) => renderNode(node, 0));
}

function nodeDisplayName(node: SceneNodeData) {
  if (node.kind === "group") return node.name;
  const asset = state.assetCatalog.find((item) => item.url === node.asset);
  return asset?.name ?? node.asset.split("/").at(-1) ?? node.id;
}

function objectKindLabel(node: SceneNodeData) {
  if (node.kind === "group") return "GROUP";
  if ((node.kind ?? "asset") === "light") return `LIGHT ${node.lightType ?? "omni"}`;
  const asset = state.assetCatalog.find((item) => item.url === node.asset);
  return asset?.category ?? "ASSET";
}

function objectRuntimeLabel(node: SceneNodeData) {
  if (node.kind === "group") return "";
  const runtime = objectMeshes.get(node.id);
  const [x, y, z] = node.position;
  const coordinates = `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
  return runtime ? coordinates : `UNLOADED | ${coordinates}`;
}

function updateInspector() {
  if (selectedObjectIds.size > 1) {
    inspector.innerHTML = `
      <div class="stack">
        <h2>Selection</h2>
        <div class="status">${selectedObjectIds.size} objects selected</div>
        <div class="btn-row">
          <button id="focus-selection" type="button">Focus</button>
          <button id="delete-selection" type="button">Delete</button>
          <button id="clear-selection" type="button">Clear</button>
        </div>
        <div class="status">Shift/Ctrl-click in the outliner or viewport to add and remove objects from the selection.</div>
      </div>
    `;
    inspector.querySelector<HTMLButtonElement>("#focus-selection")?.addEventListener("click", () => focusSelectedObjects());
    inspector.querySelector<HTMLButtonElement>("#delete-selection")?.addEventListener("click", () => deleteSelectedObjects());
    inspector.querySelector<HTMLButtonElement>("#clear-selection")?.addEventListener("click", () => selectObject(null));
    return;
  }

  const object = state.selectedObjectId ? state.layout.objects.find((item) => item.id === state.selectedObjectId) : null;
  if (!object) {
    inspector.innerHTML = `<div class="status">Select an object to edit it. Click an asset to place it, then click the terrain.</div>`;
    return;
  }

  const asset = state.assetCatalog.find((item) => item.url === object.asset);
  const isLight = (object.kind ?? asset?.kind) === "light";
  const lightColor = rgbToHex(object.color ?? [1, 0.82, 0.48]);
  const shaderMode = getObjectShaderMode(object);
  const shaderSettings = normalizeObjectShaderSettings(object.shaderSettings);
  inspector.innerHTML = `
    <div class="stack">
      <h2>Selection</h2>
      <div class="status">${asset?.name ?? object.asset}</div>
      <div class="btn-row">
        <button id="transform-translate-inspector" type="button">Move</button>
        <button id="transform-rotate-inspector" type="button">Rotate</button>
        <button id="transform-scale-inspector" type="button">Scale</button>
      </div>
      <div class="split">
        <label><span>Position X</span><input id="px" type="number" step="0.1" value="${object.position[0]}" /></label>
        <label><span>Position Y</span><input id="py" type="number" step="0.1" value="${object.position[1]}" /></label>
        <label><span>Position Z</span><input id="pz" type="number" step="0.1" value="${object.position[2]}" /></label>
        <label><span>Rotate X</span><input id="rx" type="number" step="1" value="${object.rotation[0]}" /></label>
        <label><span>Rotate Y</span><input id="ry" type="number" step="1" value="${object.rotation[1]}" /></label>
        <label><span>Rotate Z</span><input id="rz" type="number" step="1" value="${object.rotation[2]}" /></label>
        <label><span>Scale X</span><input id="sx" type="number" step="0.05" value="${object.scale[0]}" /></label>
        <label><span>Scale Y</span><input id="sy" type="number" step="0.05" value="${object.scale[1]}" /></label>
        <label><span>Scale Z</span><input id="sz" type="number" step="0.05" value="${object.scale[2]}" /></label>
      </div>
      ${isLight ? "" : `
        <div class="panel-subhead">Material</div>
        <div class="split">
          <label>
            <span>Shader</span>
            <select id="shader-mode">
              <option value="standard" ${shaderMode === "standard" ? "selected" : ""}>Current</option>
              <option value="toon" ${shaderMode === "toon" ? "selected" : ""}>Toon</option>
              <option value="outline" ${shaderMode === "outline" ? "selected" : ""}>Outline Only</option>
            </select>
          </label>
        </div>
        ${shaderMode === "toon" ? `
          <div class="split">
            <label><span>Ramp Steps</span><input id="toon-steps" type="range" min="2" max="8" step="1" value="${shaderSettings.toon.steps}" /></label>
            <label><span>Ramp Contrast</span><input id="toon-contrast" type="range" min="0.35" max="2.5" step="0.05" value="${shaderSettings.toon.contrast}" /></label>
          </div>
          <div class="split">
            <label><span>Toon Outline</span><input id="toon-outline-enabled" type="checkbox" ${shaderSettings.toon.outlineEnabled ? "checked" : ""} /></label>
            <label><span>Toon Outline Width</span><input id="toon-outline-thickness" type="range" min="0.002" max="0.18" step="0.002" value="${shaderSettings.toon.outlineThickness}" /></label>
            <label><span>Toon Outline Color</span><input id="toon-outline-color" type="color" value="${rgbToHex(shaderSettings.toon.outlineColor)}" /></label>
          </div>
        ` : ""}
        ${shaderMode === "outline" ? `
          <div class="split">
            <label><span>Fill Color</span><input id="outline-fill-color" type="color" value="${rgbToHex(shaderSettings.outline.fillColor)}" /></label>
            <label><span>Outline Width</span><input id="outline-thickness" type="range" min="0.002" max="0.18" step="0.002" value="${shaderSettings.outline.thickness}" /></label>
            <label><span>Outline Color</span><input id="outline-color" type="color" value="${rgbToHex(shaderSettings.outline.color)}" /></label>
          </div>
        ` : ""}
      `}
      ${isLight ? `
        <div class="panel-subhead">Light</div>
        <div class="split">
          <label><span>Type</span><select id="light-type"><option value="omni" ${object.lightType !== "spot" && object.lightType !== "directional" ? "selected" : ""}>Point</option><option value="spot" ${object.lightType === "spot" ? "selected" : ""}>Spot</option><option value="directional" ${object.lightType === "directional" ? "selected" : ""}>Directional</option></select></label>
          <label><span>Color</span><input id="light-color" type="color" value="${lightColor}" /></label>
          <label><span>Intensity</span><input id="light-intensity" type="range" min="0" max="20" step="0.05" value="${object.intensity ?? 4}" /></label>
          ${object.lightType === "directional" ? "" : `<label><span>Range</span><input id="light-range" type="number" step="0.5" value="${object.range ?? 24}" /></label>`}
          ${object.lightType === "directional" ? "" : `<label><span>Falloff</span><input id="light-falloff" type="range" min="0.1" max="4" step="0.05" value="${object.falloff ?? 2}" /></label>`}
        </div>
      ` : ""}
      <div class="btn-row">
        <button id="focus-selection" type="button">Focus</button>
        <button id="duplicate-object" type="button">Duplicate</button>
        <button id="delete-object" type="button">Delete</button>
      </div>
    </div>
  `;

  inspector.querySelector<HTMLButtonElement>("#transform-translate-inspector")?.addEventListener("click", () => setTransformMode("translate"));
  inspector.querySelector<HTMLButtonElement>("#transform-rotate-inspector")?.addEventListener("click", () => setTransformMode("rotate"));
  inspector.querySelector<HTMLButtonElement>("#transform-scale-inspector")?.addEventListener("click", () => setTransformMode("scale"));
  inspector.querySelector<HTMLButtonElement>("#focus-selection")?.addEventListener("click", () => focusSelectedObjects());
  inspector.querySelector<HTMLButtonElement>("#duplicate-object")?.addEventListener("click", () => duplicateObject(object));
  inspector.querySelector<HTMLButtonElement>("#delete-object")?.addEventListener("click", () => deleteObject(object.id));
  bindInspectorInputs(object);
}

function bindInspectorInputs(object: PlacedObjectData) {
  const px = inspector.querySelector<HTMLInputElement>("#px");
  const py = inspector.querySelector<HTMLInputElement>("#py");
  const pz = inspector.querySelector<HTMLInputElement>("#pz");
  const rx = inspector.querySelector<HTMLInputElement>("#rx");
  const ry = inspector.querySelector<HTMLInputElement>("#ry");
  const rz = inspector.querySelector<HTMLInputElement>("#rz");
  const sx = inspector.querySelector<HTMLInputElement>("#sx");
  const sy = inspector.querySelector<HTMLInputElement>("#sy");
  const sz = inspector.querySelector<HTMLInputElement>("#sz");
  const shaderMode = inspector.querySelector<HTMLSelectElement>("#shader-mode");
  const toonSteps = inspector.querySelector<HTMLInputElement>("#toon-steps");
  const toonContrast = inspector.querySelector<HTMLInputElement>("#toon-contrast");
  const toonOutlineEnabled = inspector.querySelector<HTMLInputElement>("#toon-outline-enabled");
  const toonOutlineThickness = inspector.querySelector<HTMLInputElement>("#toon-outline-thickness");
  const toonOutlineColor = inspector.querySelector<HTMLInputElement>("#toon-outline-color");
  const outlineFillColor = inspector.querySelector<HTMLInputElement>("#outline-fill-color");
  const outlineThickness = inspector.querySelector<HTMLInputElement>("#outline-thickness");
  const outlineColor = inspector.querySelector<HTMLInputElement>("#outline-color");
  const lightColor = inspector.querySelector<HTMLInputElement>("#light-color");
  const lightType = inspector.querySelector<HTMLSelectElement>("#light-type");
  const lightIntensity = inspector.querySelector<HTMLInputElement>("#light-intensity");
  const lightRange = inspector.querySelector<HTMLInputElement>("#light-range");
  const lightFalloff = inspector.querySelector<HTMLInputElement>("#light-falloff");
  const beforeEditSnapshot = JSON.stringify(serializeLayout());
  let pushedEditHistory = false;
  let previousLightType = object.lightType ?? "omni";
  let previousShaderMode = getObjectShaderMode(object);
  const readNumber = (input: HTMLInputElement | null, fallback: number) => {
    if (!input) return fallback;
    const value = Number(input.value);
    return Number.isFinite(value) ? value : fallback;
  };

  const apply = () => {
    if (!pushedEditHistory) {
      pushHistorySnapshot(beforeEditSnapshot);
      pushedEditHistory = true;
    }
    object.position[0] = readNumber(px, object.position[0]);
    object.position[1] = readNumber(py, object.position[1]);
    object.position[2] = readNumber(pz, object.position[2]);
    object.rotation[0] = readNumber(rx, object.rotation[0]);
    object.rotation[1] = readNumber(ry, object.rotation[1]);
    object.rotation[2] = readNumber(rz, object.rotation[2]);
    object.scale[0] = Math.max(0.01, readNumber(sx, object.scale[0]));
    object.scale[1] = Math.max(0.01, readNumber(sy, object.scale[1]));
    object.scale[2] = Math.max(0.01, readNumber(sz, object.scale[2]));
    if (shaderMode) {
      object.shaderMode =
        shaderMode.value === "toon" || shaderMode.value === "outline" ? (shaderMode.value as ObjectShaderMode) : "standard";
    }
    const nextShaderMode = getObjectShaderMode(object);
    object.shaderSettings = normalizeObjectShaderSettings({
      toon: {
        steps: toonSteps ? Number(toonSteps.value) : undefined,
        contrast: toonContrast ? Number(toonContrast.value) : undefined,
        outlineEnabled: toonOutlineEnabled?.checked,
        outlineThickness: toonOutlineThickness ? Number(toonOutlineThickness.value) : undefined,
        outlineColor: toonOutlineColor ? hexToRgb(toonOutlineColor.value) : undefined,
      },
      outline: {
        fillColor: outlineFillColor ? hexToRgb(outlineFillColor.value) : undefined,
        thickness: outlineThickness ? Number(outlineThickness.value) : undefined,
        color: outlineColor ? hexToRgb(outlineColor.value) : undefined,
      },
    });
    if (previousShaderMode !== nextShaderMode) {
      previousShaderMode = nextShaderMode;
      const mesh = objectMeshes.get(object.id);
      if (mesh) applyObjectShaderMode(object, mesh);
      saveLocalLayout();
      updateInspector();
      return;
    }
    syncObjectTransform(object);
    if ((object.kind ?? "asset") !== "light") {
      const mesh = objectMeshes.get(object.id);
      if (mesh) applyObjectShaderMode(object, mesh);
    }
    if ((object.kind ?? "") === "light") {
      if (lightType) object.lightType = (lightType.value as PlacedObjectData["lightType"]) ?? "omni";
      if (lightColor) object.color = hexToRgb(lightColor.value);
      if (lightIntensity) object.intensity = Math.max(0, Number(lightIntensity.value) || object.intensity || 0);
      if (lightRange && object.lightType !== "directional") object.range = Math.max(0, Number(lightRange.value) || object.range || 0);
      if (lightFalloff && object.lightType !== "directional") object.falloff = Math.max(0.1, Number(lightFalloff.value) || object.falloff || 2);
      if (previousLightType !== (object.lightType ?? "omni")) {
        previousLightType = object.lightType ?? "omni";
        replaceLightObject(object);
        return;
      }
      syncLightObject(object);
    }
    saveLocalLayout();
  };

  [
    px,
    py,
    pz,
    rx,
    ry,
    rz,
    sx,
    sy,
    sz,
    shaderMode,
    toonSteps,
    toonContrast,
    toonOutlineEnabled,
    toonOutlineThickness,
    toonOutlineColor,
    outlineFillColor,
    outlineThickness,
    outlineColor,
    lightType,
    lightColor,
    lightIntensity,
    lightRange,
    lightFalloff,
  ].forEach((input) => {
    input?.addEventListener("input", apply);
    input?.addEventListener("change", apply);
  });
}

function syncObjectTransform(object: PlacedObjectData) {
  const mesh = objectMeshes.get(object.id);
  if (!mesh) return;
  mesh.position.set(object.position[0], object.position[1], object.position[2]);
  mesh.rotation.set(
    THREE.MathUtils.degToRad(object.rotation[0]),
    THREE.MathUtils.degToRad(object.rotation[1]),
    THREE.MathUtils.degToRad(object.rotation[2])
  );
  mesh.scale.set(object.scale[0], object.scale[1], object.scale[2]);
  if (state.selectedObjectId === object.id) {
    transformControls.attach(mesh);
  }
}

function removeObjectMesh(id: string) {
  const mesh = objectMeshes.get(id);
  if (!mesh) return;
  objectRoot.remove(mesh);
  mesh.traverse((node) => {
    const meshNode = node as THREE.Mesh;
    meshNode.geometry?.dispose?.();
    const material = meshNode.material as THREE.Material | THREE.Material[] | undefined;
    const userData = meshNode.userData as THREE.Object3D["userData"] & MeshMaterialUserData;
    const materialSet = new Set<THREE.Material>();
    if (Array.isArray(material)) {
      material.forEach((item) => materialSet.add(item));
    } else if (material) {
      materialSet.add(material);
    }
    userData.standardMaterials?.forEach((item) => materialSet.add(item));
    userData.toonMaterials?.forEach((item) => materialSet.add(item));
    materialSet.forEach((item) => item.dispose?.());
  });
  objectMeshes.delete(id);
  const selectableIndex = selectableMeshes.findIndex((node) => node.userData.objectId === id);
  if (selectableIndex >= 0) selectableMeshes.splice(selectableIndex, 1);
}

function replaceLightObject(object: PlacedObjectData) {
  const wasSelected = state.selectedObjectId === object.id;
  transformControls.detach();
  removeObjectMesh(object.id);
  spawnLightObject(object);
  if (wasSelected) {
    selectObject(object.id);
  } else {
    updateSceneOutliner();
    updateInspector();
  }
  saveLocalLayout();
}

function syncLightObject(object: PlacedObjectData) {
  const mesh = objectMeshes.get(object.id);
  if (!mesh) return;
  const light = mesh.userData.light as THREE.Light | undefined;
  if (!light) return;
  const color = new THREE.Color(...(object.color ?? [1, 0.82, 0.48]));
  light.color = color;
  if (typeof object.intensity === "number") {
    light.intensity = object.intensity;
  }
  if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) {
    if (typeof object.range === "number") {
      light.distance = object.range;
    }
    light.decay = object.falloff ?? 2;
  }
}

function duplicateObject(object: PlacedObjectData) {
  pushHistory("duplicate");
  const duplicate: PlacedObjectData = {
    ...object,
    id: `object-${Date.now()}`,
    position: [object.position[0] + 2, object.position[1], object.position[2] + 2],
  };
  state.layout.objects.push(duplicate);
  spawnObject(duplicate);
  selectObject(duplicate.id);
  saveLocalLayout();
  updateInspector();
}

function deleteObject(id: string) {
  deleteObjects([id]);
}

function deleteSelectedObjects() {
  if (selectedObjectIds.size === 0) {
    if (state.selectedObjectId) {
      deleteObjects([state.selectedObjectId]);
    }
    return;
  }
  deleteObjects(selectedObjectIds);
}

function deleteObjects(ids: Iterable<string>) {
  const uniqueIds = [...new Set(ids)].filter((id) => state.layout.objects.some((object) => object.id === id));
  if (uniqueIds.length === 0) return;
  pushHistory("delete");
  const idSet = new Set(uniqueIds);
  state.layout.objects = state.layout.objects.filter((object) => !idSet.has(object.id));
  uniqueIds.forEach((id) => removeObjectMesh(id));
  transformControls.detach();
  state.selectedObjectId = null;
  selectedObjectIds.clear();
  saveLocalLayout();
  updateSceneOutliner();
  updateInspector();
}

function pushHistory(_label: string) {
  undoStack.push(JSON.stringify(serializeLayout()));
  if (undoStack.length > 50) undoStack.shift();
}

function pushHistorySnapshot(snapshot: string) {
  undoStack.push(snapshot);
  if (undoStack.length > 50) undoStack.shift();
}

function undoLastChange() {
  const snapshot = undoStack.pop();
  if (!snapshot) {
    updateStatus("Nothing to undo");
    return;
  }
  try {
    const layout = JSON.parse(snapshot) as LevelLayout;
    state.layout = layout;
    state.water = normalizeWaterSettings(layout.terrain?.water);
    state.skyGradient = normalizeSkyGradient(layout.skyGradient ?? defaultSkyGradient());
    state.selectedObjectId = null;
    selectedObjectIds.clear();
    state.activeDragId = null;
    transformControls.detach();
    rebuildWorld();
    syncUiFromState();
    saveLocalLayout();
    updateStatus("Undid last change");
  } catch (error) {
    console.error(error);
    updateStatus("Undo failed", true);
  }
}

function saveLocalLayout() {
  const layout = serializeLayout();
  localStorage.setItem(currentLayoutStorageKey(), JSON.stringify(layout, null, 2));
  if (state.manifestUrl === DEFAULT_MANIFEST_URL) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout, null, 2));
  }
  updateStatus("Saved to browser backup");
  queueRemoteSave();
}

function queueRemoteSave() {
  if (saveTimeoutId !== null) {
    window.clearTimeout(saveTimeoutId);
  }
  saveTimeoutId = window.setTimeout(() => {
    saveTimeoutId = null;
    void saveRemoteLayout();
  }, 900);
}

async function saveRemoteLayout() {
  const layout = serializeLayout();
  try {
    // layout.objects (not terrainChunks[].objects, which isn't kept in sync
    // during placement/move edits) is the up-to-date source of truth for
    // where each object currently sits — regroup it back into per-chunk
    // buckets for the chunks table.
    const chunkSize = layout.chunkSize || TERRAIN_CHUNK_SIZE;
    const objectsByChunkKey = new Map<string, PlacedObjectData[]>();
    for (const object of layout.objects) {
      const chunkX = Math.floor(object.position[0] / chunkSize);
      const chunkZ = Math.floor(object.position[2] / chunkSize);
      const key = `${chunkX}:${chunkZ}`;
      const bucket = objectsByChunkKey.get(key);
      if (bucket) bucket.push(object);
      else objectsByChunkKey.set(key, [object]);
    }

    const chunkRows = (layout.terrainChunks ?? []).map((chunk) => {
      const chunkX = Math.round(chunk.origin[0] / TERRAIN_CHUNK_SIZE);
      const chunkZ = Math.round(chunk.origin[1] / TERRAIN_CHUNK_SIZE);
      const key = `${chunkX}:${chunkZ}`;
      const objects = objectsByChunkKey.get(key) ?? [];
      objectsByChunkKey.delete(key);
      const { objects: _omit, ...terrainOnly } = chunk;
      return { chunkX, chunkZ, objects, terrain: terrainOnly as unknown as Record<string, unknown> };
    });
    // Objects that fall outside every generated terrain chunk (e.g. placed
    // past the district's generated edge) still need a row of their own so
    // a save never silently drops them.
    for (const [key, objects] of objectsByChunkKey) {
      const [chunkX, chunkZ] = key.split(":").map(Number);
      chunkRows.push({ chunkX, chunkZ, objects, terrain: {} });
    }

    const wasNewLevel = !state.levelId;
    const saved = await saveLevel({
      id: state.levelId ?? undefined,
      userId,
      name: layout.name,
      district: layout.district,
      chunkSize: layout.chunkSize,
      groups: layout.groups as unknown[],
      terrain: layout.terrain as unknown as Record<string, unknown>,
      skyGradient: layout.skyGradient as unknown as Record<string, unknown>,
      lighting: layout.lighting as Record<string, unknown> | undefined,
      chunks: chunkRows,
    });
    state.levelId = saved.id;
    if (wasNewLevel) await refreshLevelPicker();
    updateStatus(`Saved "${saved.name}" with ${layout.objects.length} objects across ${chunkRows.length} chunks`);
  } catch (error) {
    console.warn("Remote level save failed; browser backup remains current.", error);
    updateStatus("Saved browser backup only. Remote save failed.", true);
  }
}

function serializeLayout(): LevelLayout {
  const terrain = state.layout.terrain ?? defaultTerrainSettings();
  terrain.water = normalizeWaterSettings(terrain.water);
  terrain.roadShader = normalizeRoadShaderSettings(terrain.roadShader ?? defaultTerrainSettings().roadShader);
  const layout: LevelLayout = {
    name: state.layout.name,
    district: state.layout.district,
    chunkSize: state.layout.chunkSize,
    chunks: state.layout.chunks,
    groups: state.layout.groups,
    terrain,
    terrainChunks: state.layout.terrainChunks,
    skyGradient: state.skyGradient,
    lighting: state.lighting,
    objects: state.layout.objects.map((object) => {
      const chunkSize = state.layout.chunkSize || 64;
      const chunkX = Math.floor(object.position[0] / chunkSize);
      const chunkZ = Math.floor(object.position[2] / chunkSize);
      const district = state.layout.district || "district_00";
      return {
        ...object,
        chunk: object.chunk || `${district}/chunk_${chunkX}_${chunkZ}`,
      };
    }),
  };
  return layout;
}

/**
 * Bundles the current level into a self-contained, portable zip: a
 * manifest, one JSON file per terrain chunk, and every referenced .glb —
 * fetched fresh via signed URLs and re-embedded as real files, since a
 * creator_assets id (what PlacedObjectData.asset holds inside Woven) means
 * nothing outside this database. Matches dog-city-game's own
 * levels/ + models/ drop-in layout so an export is importable elsewhere.
 */
async function exportLayoutAsZip() {
  updateStatus("Preparing export...");
  try {
    const layout = serializeLayout();
    const chunkSize = layout.chunkSize || TERRAIN_CHUNK_SIZE;
    const district = layout.district || "district_00";

    // Mirrors saveRemoteLayout()'s chunk-bucketing so the export matches
    // what's actually saved, not stale terrainChunks[].objects.
    const objectsByChunkKey = new Map<string, PlacedObjectData[]>();
    for (const object of layout.objects) {
      const chunkX = Math.floor(object.position[0] / chunkSize);
      const chunkZ = Math.floor(object.position[2] / chunkSize);
      const key = `${chunkX}:${chunkZ}`;
      const bucket = objectsByChunkKey.get(key);
      if (bucket) bucket.push(object);
      else objectsByChunkKey.set(key, [object]);
    }

    const assetIds = new Set(layout.objects.map((o) => o.asset).filter((id) => CREATOR_ASSET_ID_RE.test(id)));
    const zip = new JSZip();
    const modelsFolder = zip.folder("models/level-assets")!;
    const localPathByAssetId = new Map<string, string>();
    const usedFileNames = new Set<string>();
    let resolved = 0;
    for (const assetId of assetIds) {
      updateStatus(`Bundling assets... (${++resolved}/${assetIds.size})`);
      const row = assetRowById.get(assetId) ?? (await getAsset(assetId));
      if (!row) {
        console.warn(`Export: asset ${assetId} not found or not visible to this account; skipping.`);
        continue;
      }
      assetRowById.set(assetId, row);
      try {
        const signedUrl = await resolveAssetSource(assetId);
        const response = await fetch(signedUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        let fileName = `${slugifyLevelName(row.name) || "asset"}.glb`;
        let suffix = 2;
        while (usedFileNames.has(fileName)) {
          fileName = `${slugifyLevelName(row.name) || "asset"}-${suffix++}.glb`;
        }
        usedFileNames.add(fileName);
        modelsFolder.file(fileName, bytes);
        localPathByAssetId.set(assetId, `models/level-assets/${fileName}`);
      } catch (error) {
        console.warn(`Export: failed to download asset "${row.name}".`, error);
      }
    }

    const rewriteAsset = (object: PlacedObjectData): PlacedObjectData => {
      const localPath = localPathByAssetId.get(object.asset);
      return localPath ? { ...object, asset: localPath } : object;
    };

    const levelsFolder = zip.folder(`levels/${district}`)!;
    const chunkIndex: LevelLayout["chunks"] = [];
    for (const chunk of layout.terrainChunks ?? []) {
      const chunkX = Math.round(chunk.origin[0] / TERRAIN_CHUNK_SIZE);
      const chunkZ = Math.round(chunk.origin[1] / TERRAIN_CHUNK_SIZE);
      const key = `${chunkX}:${chunkZ}`;
      const objects = (objectsByChunkKey.get(key) ?? []).map(rewriteAsset);
      objectsByChunkKey.delete(key);
      const fileName = `chunk_${chunkX}_${chunkZ}.json`;
      const chunkPayload: TerrainChunkData = { ...chunk, objects };
      levelsFolder.file(fileName, `${JSON.stringify(chunkPayload, null, 2)}\n`);
      chunkIndex.push({ id: chunk.id, url: `levels/${district}/${fileName}`, objectCount: objects.length });
    }
    // Objects placed outside every generated terrain chunk still need
    // somewhere to live so the export never silently drops them.
    for (const [key, objects] of objectsByChunkKey) {
      const [chunkX, chunkZ] = key.split(":").map(Number);
      const rewritten = objects.map(rewriteAsset);
      const fileName = `chunk_${chunkX}_${chunkZ}.json`;
      const chunkPayload: TerrainChunkData = {
        id: chunkIdForCoords(chunkX, chunkZ, district),
        origin: [chunkX * TERRAIN_CHUNK_SIZE, chunkZ * TERRAIN_CHUNK_SIZE],
        resolution: TERRAIN_RESOLUTION,
        spacing: TERRAIN_SPACING,
        heights: [],
        waterMask: [],
        objects: rewritten,
      };
      levelsFolder.file(fileName, `${JSON.stringify(chunkPayload, null, 2)}\n`);
      chunkIndex.push({ id: chunkPayload.id, url: `levels/${district}/${fileName}`, objectCount: rewritten.length });
    }

    const manifest = {
      name: layout.name,
      district,
      chunkSize,
      chunks: chunkIndex,
      groups: layout.groups,
      terrain: layout.terrain,
      skyGradient: layout.skyGradient,
      lighting: layout.lighting,
    };
    const levelSlug = slugifyLevelName(layout.name) || "level";
    zip.file(`levels/${levelSlug}.level.json`, `${JSON.stringify(manifest, null, 2)}\n`);

    updateStatus("Compressing...");
    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${levelSlug}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
    updateStatus(`Exported "${layout.name}" with ${localPathByAssetId.size}/${assetIds.size} assets bundled.`);
  } catch (error) {
    console.error(error);
    updateStatus(error instanceof Error ? error.message : "Export failed.", true);
  }
}

function syncUiFromState() {
  manifestInput.value = state.manifestUrl;
  catalogInput.value = state.assetCatalogUrl;
  state.water = normalizeWaterSettings(state.layout.terrain?.water);
  state.skyGradient = normalizeSkyGradient(state.layout.skyGradient ?? defaultSkyGradient());
  state.lighting = normalizeLightingSettings((state.layout.lighting as LightingSettings | undefined) ?? state.lighting);
  const terrainLayers = normalizeTerrainLayerSettings(state.layout.terrain?.terrainLayers ?? defaultTerrainSettings().terrainLayers);
  state.soilRepeat = terrainLayers.dirt.repeat;
  state.sandRepeat = terrainLayers.sand.repeat;
  const roadShader = normalizeRoadShaderSettings(state.layout.terrain?.roadShader ?? defaultTerrainSettings().roadShader);
  state.roadRepeat = roadShader.repeat;
  waterControls.opacity.value = String(state.water.opacity);
  waterControls.reflectivity.value = String(state.water.reflectivity);
  waterControls.foamThreshold.value = String(state.water.foamThreshold);
  waterControls.foamContrast.value = String(state.water.foamContrast);
  waterControls.level.value = String(state.layout.terrain?.waterLevel ?? -1.35);
  waterControls.waveAmplitude.value = String(state.water.waveAmplitude);
  waterControls.waveFrequency.value = String(state.water.waveFrequency);
  waterControls.waveSpeed.value = String(state.water.waveSpeed);
  waterControls.windSpeed.value = String(state.water.windSpeed);
  waterControls.choppiness.value = String(state.water.choppiness);
  waterControls.underwaterFogDensity.value = String(state.water.underwaterFogDensity);
  waterControls.foamIntensity.value = String(state.water.foamIntensity);
  timeControls.slider.value = String(state.timeOfDay);
  timeControls.skyRotation.value = String(state.lighting.skyRotation);
  timeControls.moonIntensity.value = String(state.lighting.moonIntensity);
  timeControls.horizonGlow.value = String(state.lighting.horizonGlow);
  timeControls.ambientIntensity.value = String(state.lighting.ambientIntensity);
  terrainControls.brushMode.value = state.brushMode;
  terrainControls.brushRadius.value = String(state.brushRadius);
  terrainControls.brushStrength.value = String(state.brushStrength);
  terrainControls.brushFalloff.value = String(state.brushFalloff);
  terrainControls.flattenHeight.value = String(state.flattenHeight);
  updateTerrainLayerButtons();
  const road = activeRoadSpline(false);
  terrainControls.roadWidth.value = String(road?.width ?? 6);
  terrainControls.roadShoulder.value = String(road?.shoulder ?? 1.5);
  terrainControls.roadElevation.value = String(road?.elevation ?? 0.12);
  terrainControls.soilRepeat.value = String(state.soilRepeat);
  terrainControls.sandRepeat.value = String(state.sandRepeat);
  terrainControls.roadRepeat.value = String(state.roadRepeat);
  updateRoadSplineOptions();
  updateAssetList();
  updateSceneOutliner();
  updateInspector();
  syncTerrainShaderUi();
  syncRoadShaderUi();
}

function createNewWorld() {
  const fileNameInput = window.prompt("New map file name", `${levelNameFromManifest(state.manifestUrl)}-copy`);
  if (!fileNameInput) return;
  const slug = slugifyLevelName(fileNameInput);
  if (!slug) {
    updateStatus("New map cancelled: file name was empty", true);
    return;
  }
  const manifestUrl = `/levels/${slug}.level.json`;
  state.manifestUrl = manifestUrl;
  manifestInput.value = manifestUrl;
  state.levelId = null;
  levelPicker.value = "";
  state.layout = emptyLayout(slug, districtFromManifest(manifestUrl));
  state.layout.terrainChunks = createFlatTerrainChunks(state.layout.terrain ?? blankTerrainSettings(), state.layout.district || "district_00");
  state.water = normalizeWaterSettings(state.layout.terrain?.water);
  state.skyGradient = normalizeSkyGradient(state.layout.skyGradient ?? defaultSkyGradient());
  state.activeRoadSplineId = null;
  state.selectedObjectId = null;
  selectedObjectIds.clear();
  state.activeDragId = null;
  state.selectedRoadPoint = null;
  transformControls.detach();
  rebuildWorld();
  syncUiFromState();
  saveLocalLayout();
  updateStatus(`Created new map ${exportFileNameForManifest(manifestUrl)}. Click Save to write it to disk.`);
}

/** Repopulates the level picker from Supabase. Preserves the current
 * selection where possible; otherwise falls back to state.levelId. */
async function refreshLevelPicker() {
  try {
    const levels = await listVisibleLevels(userId);
    const options = [`<option value="">New, unsaved level</option>`]
      .concat(
        levels.map((level: WorldLevelRow) => {
          const label = level.clerk_user_id === userId ? level.name : `${level.name} (shared)`;
          return `<option value="${level.id}">${label}</option>`;
        })
      )
      .join("");
    levelPicker.innerHTML = options;
    levelPicker.value = state.levelId ?? "";
  } catch (error) {
    console.warn("Failed to load the level list.", error);
  }
}

function updateStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#fca5a5" : "#94a3b8";
}

function updateDiagnostics() {
  const terrainCount = state.layout.terrainChunks?.length ?? 0;
  const objectCount = state.layout.objects?.length ?? 0;
  const assetCount = state.assetCatalog?.length ?? 0;
  const terrainMeshCount = terrainMeshes.length;
  const waterMeshCount = waterMeshes.length;
  diagnosticsEl.textContent = `manifest=${state.manifestUrl} chunks=${worldLoadReport.manifestChunks} terrain=${terrainCount} objects=${objectCount} assets=${assetCount} meshes=${terrainMeshCount} water=${waterMeshCount} failed=${worldLoadReport.failedTerrainChunks}`;
}

function bindUi() {
  assetSearch.addEventListener("input", updateAssetList);
  assetCategory.addEventListener("change", updateAssetList);

  document.querySelectorAll<HTMLButtonElement>("[data-toggle-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.dataset.togglePanel as keyof PanelState | undefined;
      if (!panel) return;
      panelState[panel] = !panelState[panel];
      savePanelState();
      syncPanelVisibility();
    });
  });

  newButton.addEventListener("click", () => createNewWorld());
  loadButton.addEventListener("click", () => void loadWorldFromInputs());
  saveButton.addEventListener("click", () => {
    saveLocalLayout();
    void saveRemoteLayout();
  });
  exportButton.addEventListener("click", () => void exportLayoutAsZip());
  levelPicker.addEventListener("change", () => {
    state.levelId = levelPicker.value || null;
    void loadWorldFromInputs();
  });

  waterControls.opacity.addEventListener("input", () => updateWaterControls());
  waterControls.reflectivity.addEventListener("input", () => updateWaterControls());
  waterControls.foamThreshold.addEventListener("input", () => updateWaterControls());
  waterControls.foamContrast.addEventListener("input", () => updateWaterControls());
  waterControls.level.addEventListener("change", () => updateWaterControls(true));
  waterControls.waveAmplitude.addEventListener("input", () => updateWaterControls());
  waterControls.waveFrequency.addEventListener("input", () => updateWaterControls());
  waterControls.waveSpeed.addEventListener("input", () => updateWaterControls());
  waterControls.windSpeed.addEventListener("input", () => updateWaterControls());
  waterControls.choppiness.addEventListener("input", () => updateWaterControls());
  waterControls.underwaterFogDensity.addEventListener("input", () => updateWaterControls());
  waterControls.foamIntensity.addEventListener("input", () => updateWaterControls());

  timeControls.slider.addEventListener("input", () => {
    state.timeOfDay = Number(timeControls.slider.value);
    applySkyAndWater();
  });
  timeControls.play.addEventListener("click", () => {
    state.playing = true;
    updateStatus("Time playback on");
  });
  timeControls.stop.addEventListener("click", () => {
    state.playing = false;
    updateStatus("Time playback off");
  });
  timeControls.speed.addEventListener("change", () => {});
  timeControls.transformTranslate.addEventListener("click", () => setTransformMode("translate"));
  timeControls.transformRotate.addEventListener("click", () => setTransformMode("rotate"));
  timeControls.transformScale.addEventListener("click", () => setTransformMode("scale"));
  terrainControls.select.addEventListener("click", () => setTerrainMode("select"));
  terrainControls.sculpt.addEventListener("click", () => setTerrainMode("sculpt"));
  terrainControls.road.addEventListener("click", () => setTerrainMode("road"));
  terrainControls.brushMode.addEventListener("change", () => updateTerrainToolSettings());
  terrainControls.brushRadius.addEventListener("change", () => updateTerrainToolSettings());
  terrainControls.brushStrength.addEventListener("change", () => updateTerrainToolSettings());
  terrainControls.brushFalloff.addEventListener("input", () => updateTerrainToolSettings());
  terrainControls.flattenHeight.addEventListener("change", () => updateTerrainToolSettings());
  terrainControls.terrainLayerButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const layer = button.dataset.terrainLayer as RuntimeState["paintLayer"] | undefined;
      if (!layer) return;
      state.paintLayer = layer;
      updateTerrainLayerButtons();
      updateStatus(`Paint target: ${layer === "soil" ? "Soil" : layer === "sand" ? "Sand" : "Grass"}`);
    });
  });
  terrainControls.terrainDirtAO.addEventListener("input", () => updateTerrainShaderFromInputs());
  terrainControls.terrainDirtNormal.addEventListener("input", () => updateTerrainShaderFromInputs());
  terrainControls.terrainDirtRoughness.addEventListener("input", () => updateTerrainShaderFromInputs());
  terrainControls.terrainDirtMetalness.addEventListener("input", () => updateTerrainShaderFromInputs());
  terrainControls.terrainSandAO.addEventListener("input", () => updateTerrainShaderFromInputs());
  terrainControls.terrainSandNormal.addEventListener("input", () => updateTerrainShaderFromInputs());
  terrainControls.terrainSandRoughness.addEventListener("input", () => updateTerrainShaderFromInputs());
  terrainControls.terrainSandMetalness.addEventListener("input", () => updateTerrainShaderFromInputs());
  terrainControls.roadWidth.addEventListener("change", () => updateRoadSettingsFromControls());
  terrainControls.roadShoulder.addEventListener("change", () => updateRoadSettingsFromControls());
  terrainControls.roadElevation.addEventListener("change", () => updateRoadSettingsFromControls());
  terrainControls.roadSpline.addEventListener("change", () => {
    state.activeRoadSplineId = terrainControls.roadSpline.value || null;
    updateRoadSplineOptions();
  });
  terrainControls.newRoad.addEventListener("click", () => createNewRoadSpline());
  terrainControls.deleteRoad.addEventListener("click", () => deleteActiveRoadSpline());
  terrainControls.soilRepeat.addEventListener("change", () => updateTextureRepeatControls());
  terrainControls.sandRepeat.addEventListener("change", () => updateTextureRepeatControls());
  terrainControls.roadRepeat.addEventListener("change", () => updateTextureRepeatControls());
  terrainControls.regenerate.addEventListener("click", () => regenerateTerrainFromSettings());
  terrainControls.clearRoad.addEventListener("click", () => clearRoadSpline());
  timeControls.skyColors.addEventListener("click", () => openSkyEditor());
  timeControls.skyRotation.addEventListener("input", () => updateLightingControls());
  timeControls.moonIntensity.addEventListener("input", () => updateLightingControls());
  timeControls.horizonGlow.addEventListener("input", () => updateLightingControls());
  timeControls.ambientIntensity.addEventListener("input", () => updateLightingControls());
  ui.roadShaderOpen.addEventListener("click", () => openRoadShaderEditor());
  ui.roadShaderClose.addEventListener("click", () => closeRoadShaderEditor());
  ui.roadShaderReset.addEventListener("click", () => {
    if (!state.layout.terrain) ensureTerrainSettings();
    if (state.layout.terrain) {
      const defaultRoadShader = normalizeRoadShaderSettings(defaultTerrainSettings().roadShader);
      state.layout.terrain.roadShader = defaultRoadShader;
      state.roadRepeat = defaultRoadShader.repeat;
      syncRoadShaderUi();
      saveLocalLayout();
    }
  });
  ui.roadShaderModal.addEventListener("click", (event) => {
    if (event.target === ui.roadShaderModal) closeRoadShaderEditor();
  });
  ui.waterShaderOpen.addEventListener("click", () => {
    if (ui.waterShaderModal.classList.contains("is-hidden")) {
      openWaterShaderEditor();
    } else {
      closeWaterShaderEditor();
    }
  });
  ui.waterShaderClose.addEventListener("click", () => closeWaterShaderEditor());
  ui.waterShaderReset.addEventListener("click", () => {
    const defaults = normalizeWaterSettings(defaultWaterSettings());
    state.water = defaults;
    if (state.layout.terrain) {
      state.layout.terrain.water = { ...defaults };
      state.layout.terrain.waterLevel = state.layout.terrain.waterLevel ?? -1.35;
    }
    syncWaterShaderPreviewMaterial();
    renderWaterShaderStack();
    applySkyAndWater();
    saveLocalLayout();
  });
  ui.shaderBallOpen.addEventListener("click", () => openShaderBallViewer());
  ui.shaderBallClose.addEventListener("click", () => closeShaderBallViewer());
  ui.shaderBallModal.addEventListener("click", (event) => {
    if (event.target === ui.shaderBallModal) closeShaderBallViewer();
  });
  [ui.roadShaderPreset, ui.roadShaderRepeat, ui.roadShaderAO, ui.roadShaderNormal, ui.roadShaderBump, ui.roadShaderRoughness, ui.roadShaderMetalness].forEach((input) => {
    input.addEventListener("input", () => updateRoadShaderFromInputs());
  });
  [
    waterControls.opacity,
    waterControls.reflectivity,
    waterControls.foamThreshold,
    waterControls.foamContrast,
    waterControls.level,
    waterControls.waveAmplitude,
    waterControls.waveFrequency,
    waterControls.waveSpeed,
    waterControls.windSpeed,
    waterControls.choppiness,
    waterControls.underwaterFogDensity,
    waterControls.foamIntensity,
  ].forEach((input) => input.addEventListener("input", () => updateWaterControls(false)));
  ui.skyClose.addEventListener("click", () => closeSkyEditor());
  ui.skyReset.addEventListener("click", () => {
    saveSkyGradient(defaultSkyGradient());
    state.layout.skyGradient = state.skyGradient;
    selectedSkyStopIndex = 0;
    saveLocalLayout();
    renderSkyEditor();
  });
  ui.skyModal.addEventListener("click", (event) => {
    if (event.target === ui.skyModal) closeSkyEditor();
  });
  [
    ui.skyStopTime,
    ui.skySunSide,
    ui.skyOppositeSide,
    ui.skyTop,
    ui.skyMid,
    ui.skyHorizon,
    ui.skyNeon,
  ui.skyMoon,
  ].forEach((input) => input.addEventListener("input", () => updateSkyEditorFromInputs()));
  document.querySelectorAll<HTMLElement>("[data-resize-panel]").forEach((handle) => {
    const panel = handle.dataset.resizePanel as keyof PanelState | undefined;
    const axis = handle.dataset.resizeAxis as "x" | "both" | undefined;
    if (!panel || !axis) return;
    handle.addEventListener("pointerdown", (event) => beginPanelResize(event, panel, axis));
  });
  applyPanelSizes();
  setTransformMode("translate");
  setTerrainMode("select");
  syncPanelVisibility();
}

function syncPanelVisibility() {
  const panels: Array<[keyof PanelState, HTMLElement | null]> = [
    ["assets", document.querySelector<HTMLElement>("[data-panel='assets']")],
    ["inspector", document.querySelector<HTMLElement>("[data-panel='inspector']")],
    ["world", document.querySelector<HTMLElement>("[data-panel='world']")],
  ];

  panels.forEach(([name, panel]) => {
    if (!panel) return;
    panel.classList.toggle("is-collapsed", panelState[name]);
    const button = panel.querySelector<HTMLButtonElement>("[data-toggle-panel]");
    if (button) button.textContent = panelState[name] ? "Expand" : "Collapse";
  });

  applyPanelSizes();
}

function applyPanelSizes() {
  const assetsPanel = document.querySelector<HTMLElement>("[data-panel='assets']");
  const inspectorPanel = document.querySelector<HTMLElement>("[data-panel='inspector']");
  const worldPanel = document.querySelector<HTMLElement>("[data-panel='world']");
  if (assetsPanel) {
    const collapsed = assetsPanel.classList.contains("is-collapsed");
    assetsPanel.style.width = collapsed ? "132px" : `${panelSizes.assetsWidth}px`;
    assetsPanel.style.height = `calc(100vh - 124px)`;
  }
  if (inspectorPanel) {
    const collapsed = inspectorPanel.classList.contains("is-collapsed");
    inspectorPanel.style.width = collapsed ? "132px" : `${panelSizes.inspectorWidth}px`;
    inspectorPanel.style.height = collapsed ? "auto" : `${panelSizes.inspectorHeight}px`;
  }
  if (worldPanel) {
    const collapsed = worldPanel.classList.contains("is-collapsed");
    worldPanel.style.width = collapsed ? "132px" : `${panelSizes.worldWidth}px`;
    worldPanel.style.height = collapsed ? "auto" : `${panelSizes.worldHeight}px`;
  }
}

function beginPanelResize(event: PointerEvent, panelName: keyof PanelState, axis: "x" | "both") {
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const startSizes = { ...panelSizes };
  const panel = document.querySelector<HTMLElement>(`[data-panel='${panelName}']`);
  if (!panel) return;

  const onMove = (moveEvent: PointerEvent) => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (panelName === "assets") {
      panelSizes.assetsWidth = Math.max(260, startSizes.assetsWidth + dx);
    } else if (panelName === "inspector") {
      panelSizes.inspectorWidth = Math.max(240, startSizes.inspectorWidth + dx);
      panelSizes.inspectorHeight = Math.max(260, startSizes.inspectorHeight + dy);
    } else if (panelName === "world") {
      panelSizes.worldWidth = Math.max(240, startSizes.worldWidth + dx);
      panelSizes.worldHeight = Math.max(320, startSizes.worldHeight + dy);
    }
    applyPanelSizes();
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.style.userSelect = "";
    savePanelSizes();
  };

  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function setTransformMode(mode: "translate" | "rotate" | "scale") {
  transformControls.setMode(mode);
  timeControls.transformTranslate.classList.toggle("is-active", mode === "translate");
  timeControls.transformRotate.classList.toggle("is-active", mode === "rotate");
  timeControls.transformScale.classList.toggle("is-active", mode === "scale");
  updateStatus(`Transform mode: ${mode === "translate" ? "move" : mode}`);
}

function setTerrainMode(mode: RuntimeState["terrainMode"]) {
  state.terrainMode = mode;
  state.isSculpting = false;
  brushCursor.visible = false;
  if (mode === "road") {
    activeRoadSpline(true);
    updateRoadSplineOptions();
  }
  if (mode !== "select" && panelState.world) {
    panelState.world = false;
    savePanelState();
    syncPanelVisibility();
  }
  terrainControls.select.classList.toggle("is-active", mode === "select");
  terrainControls.sculpt.classList.toggle("is-active", mode === "sculpt");
  terrainControls.road.classList.toggle("is-active", mode === "road");
  updateStatus(mode === "select" ? "Terrain tools off" : mode === "sculpt" ? "Sculpt mode: drag terrain or paint colors" : "Road mode: click terrain to add road points");
}

function updateTerrainToolSettings() {
  state.brushMode = terrainControls.brushMode.value as TerrainBrushMode;
  state.brushRadius = clamp(Number(terrainControls.brushRadius.value) || state.brushRadius, 1, 40);
  state.brushStrength = clamp(Number(terrainControls.brushStrength.value) || state.brushStrength, 0.05, 8);
  state.brushFalloff = clamp(Number(terrainControls.brushFalloff.value), 0, 1);
  state.flattenHeight = Number(terrainControls.flattenHeight.value) || 0;
}

function updateTerrainLayerButtons() {
  terrainControls.terrainLayerButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.terrainLayer === state.paintLayer);
  });
}

function updateTextureRepeatControls() {
  state.soilRepeat = clamp(Number(terrainControls.soilRepeat.value) || state.soilRepeat, 0.005, 16);
  state.sandRepeat = clamp(Number(terrainControls.sandRepeat.value) || state.sandRepeat, 0.005, 16);
  state.roadRepeat = clamp(Number(terrainControls.roadRepeat.value) || state.roadRepeat, 0.005, 16);
  applyTextureRepeats();
  rebuildTerrainSurfaces();
  if (state.layout.terrain) {
    const currentLayers = normalizeTerrainLayerSettings(state.layout.terrain.terrainLayers ?? defaultTerrainSettings().terrainLayers);
    state.layout.terrain.terrainLayers = {
      dirt: { ...currentLayers.dirt, repeat: state.soilRepeat },
      sand: { ...currentLayers.sand, repeat: state.sandRepeat },
    };
    applyTerrainShaderSettings();
    state.layout.terrain.roadShader = {
      ...normalizeRoadShaderSettings(state.layout.terrain.roadShader ?? defaultTerrainSettings().roadShader),
      repeat: state.roadRepeat,
    };
    applyRoadShaderSettings();
  }
}

function ensureTerrainSettings() {
  const fallback = blankTerrainSettings();
  state.layout.terrain = {
    ...fallback,
    ...(state.layout.terrain ?? {}),
    water: normalizeWaterSettings(state.layout.terrain?.water),
    splines: state.layout.terrain?.splines ?? [],
    shoreline: state.layout.terrain?.shoreline ?? fallback.shoreline,
    terrainLayers: normalizeTerrainLayerSettings(state.layout.terrain?.terrainLayers ?? fallback.terrainLayers),
    roadShader: normalizeRoadShaderSettings(state.layout.terrain?.roadShader ?? fallback.roadShader),
  };
  return state.layout.terrain;
}

function roadSplines() {
  return (state.layout.terrain?.splines ?? []).filter((spline): spline is TerrainSpline => spline.kind === "road");
}

function activeRoadSpline(createIfMissing = true): TerrainSpline | null {
  const terrain = ensureTerrainSettings();
  let road = terrain.splines.find((spline) => spline.kind === "road" && spline.id === state.activeRoadSplineId);
  if (!road && createIfMissing) {
    road = { id: `road-${Date.now()}`, kind: "road", width: 5.1, shoulder: 1.5, elevation: 0.12, points: [] };
    terrain.splines.push(road);
    state.activeRoadSplineId = road.id;
    updateRoadSplineOptions();
  }
  return road ?? null;
}

function updateRoadSplineOptions() {
  const roads = roadSplines();
  const currentId = roads.some((road) => road.id === state.activeRoadSplineId)
    ? state.activeRoadSplineId
    : roads[0]?.id ?? null;
  state.activeRoadSplineId = currentId;
  terrainControls.roadSpline.innerHTML = roads
    .map((road, index) => `<option value="${road.id}">Road ${index + 1} (${road.points.length} pts)</option>`)
    .join("");
  if (currentId) {
    terrainControls.roadSpline.value = currentId;
  }
  terrainControls.deleteRoad.disabled = roads.length === 0;
}

function createNewRoadSpline() {
  const terrain = ensureTerrainSettings();
  pushHistory("road");
  const road: TerrainSpline = { id: `road-${Date.now()}`, kind: "road", width: 5.1, shoulder: 1.5, elevation: 0.12, points: [] };
  terrain.splines.push(road);
  state.activeRoadSplineId = road.id;
  updateRoadSplineOptions();
  regenerateTerrainFromSettings(false);
  updateStatus("Started a new road spline");
}

function deleteActiveRoadSpline() {
  const terrain = ensureTerrainSettings();
  const roads = roadSplines();
  const activeId = state.activeRoadSplineId ?? roads[0]?.id ?? null;
  if (!activeId) return;
  pushHistory("road");
  terrain.splines = terrain.splines.filter((spline) => spline.id !== activeId);
  state.activeRoadSplineId = terrain.splines.find((spline) => spline.kind === "road")?.id ?? null;
  updateRoadSplineOptions();
  regenerateTerrainFromSettings(false);
  updateStatus("Deleted active road spline");
}

function updateRoadSettingsFromControls() {
  const road = activeRoadSpline();
  if (!road) return;
  road.width = Math.max(2, Number(terrainControls.roadWidth.value) || road.width);
  road.shoulder = Math.max(0, Number(terrainControls.roadShoulder.value) || road.shoulder || 0);
  road.elevation = Number(terrainControls.roadElevation.value) || road.elevation || 0;
  regenerateTerrainFromSettings();
}

function regenerateTerrainFromSettings(recordHistory = true) {
  if (recordHistory) pushHistory("terrain");
  const terrain = ensureTerrainSettings();
  terrain.revision += 1;
  state.layout.terrainChunks = generateTerrainChunks(terrain, state.layout.district || "district_00");
  state.water = normalizeWaterSettings(terrain.water);
  rebuildWorld();
  syncUiFromState();
  saveLocalLayout();
  updateStatus("Regenerated terrain");
}

function clearRoadSpline() {
  pushHistory("road");
  const road = activeRoadSpline(false);
  if (!road) return;
  road.points = [];
  regenerateTerrainFromSettings(false);
  updateStatus("Cleared road points");
}

function addRoadPoint(point: THREE.Vector3) {
  pushHistory("road");
  const road = activeRoadSpline();
  if (!road) return;
  updateRoadSettingsFromControlsWithoutRebuild(road);
  road.points.push({ x: Number(point.x.toFixed(2)), z: Number(point.z.toFixed(2)) });
  regenerateTerrainFromSettings(false);
  updateStatus(`Added road point ${road.points.length}`);
}

function updateRoadSettingsFromControlsWithoutRebuild(road: TerrainSpline) {
  road.width = Math.max(2, Number(terrainControls.roadWidth.value) || road.width);
  road.shoulder = Math.max(0, Number(terrainControls.roadShoulder.value) || road.shoulder || 0);
  road.elevation = Number(terrainControls.roadElevation.value) || road.elevation || 0;
}

function sculptAt(point: THREE.Vector3, mode = state.brushMode) {
  updateTerrainToolSettings();
  const terrain = ensureTerrainSettings();
  const chunks = terrainChunks();
  if (chunks.length === 0) return;
  if (mode === "blend") {
    paintShaderAt(point);
    return;
  }
  const touched = sculptTerrainAt(
    chunks,
    point,
    {
      mode: mode as TerrainBrushMode,
      radius: state.brushRadius,
      strength: state.brushStrength,
      falloff: state.brushFalloff,
      flattenHeight: state.flattenHeight,
    },
    terrain.waterLevel,
    0,
    state.layout.chunkSize || 64,
    state.layout.district || "district_00"
  );
  if (touched.size === 0) return;
  terrain.revision += 1;
  rebuildTerrainSurfaces();
  saveLocalLayout();
}

function applyTerrainBrush(point: THREE.Vector3, event: PointerEvent) {
  if (state.brushMode === "blend") {
    paintShaderAt(point);
    return;
  }
  const mode =
    event.shiftKey && state.brushMode === "raise"
      ? "lower"
      : event.shiftKey && state.brushMode === "lower"
        ? "raise"
        : state.brushMode;
  sculptAt(point, mode as TerrainBrushMode);
}

function updateLightingControls() {
  state.lighting.skyRotation = Number(timeControls.skyRotation.value) || 0;
  state.lighting.moonIntensity = Math.max(0, Number(timeControls.moonIntensity.value) || 0);
  state.lighting.horizonGlow = Math.max(0, Number(timeControls.horizonGlow.value) || 0);
  state.lighting.ambientIntensity = Math.max(0, Number(timeControls.ambientIntensity.value) || 0);
  state.layout.lighting = { ...state.lighting };
  saveLightingSettings();
  applySkyAndWater();
  saveLocalLayout();
}

function openSkyEditor() {
  selectedSkyStopIndex = clamp(selectedSkyStopIndex, 0, Math.max(0, state.skyGradient.stops.length - 1));
  ui.skyModal.classList.remove("is-hidden");
  renderSkyEditor();
}

function closeSkyEditor() {
  ui.skyModal.classList.add("is-hidden");
}

function renderSkyEditor() {
  const gradient = normalizeSkyGradient(state.skyGradient);
  state.skyGradient = gradient;
  const stop = gradient.stops[selectedSkyStopIndex] ?? gradient.stops[0];
  ui.skyStopList.innerHTML = "";
  gradient.stops.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sky-stop" + (index === selectedSkyStopIndex ? " is-active" : "");
    button.innerHTML = `<span>${item.time.toFixed(2)}h</span><i style="background:${rgbToHex(item.horizonColor)}"></i>`;
    button.addEventListener("click", () => {
      selectedSkyStopIndex = index;
      renderSkyEditor();
    });
    ui.skyStopList.appendChild(button);
  });

  ui.skyStopTime.value = String(stop.time);
  ui.skySunSide.value = rgbToHex(gradient.sunSideColor);
  ui.skyOppositeSide.value = rgbToHex(gradient.oppositeSideColor);
  ui.skyTop.value = rgbToHex(stop.topColor);
  ui.skyMid.value = rgbToHex(stop.midColor);
  ui.skyHorizon.value = rgbToHex(stop.horizonColor);
  ui.skyNeon.value = rgbToHex(stop.neonColor);
  ui.skyMoon.value = rgbToHex(stop.moonColor);
  drawSkyPreview();
  applySkyAndWater();
}

function openRoadShaderEditor() {
  syncRoadShaderUi();
  ui.roadShaderModal.classList.remove("is-hidden");
}

function closeRoadShaderEditor() {
  ui.roadShaderModal.classList.add("is-hidden");
}

function openWaterShaderEditor() {
  initWaterShaderViewer();
  syncWaterShaderPreviewMaterial();
  renderWaterShaderStack();
  ui.waterShaderModal.classList.remove("is-hidden");
  resizeWaterShaderViewer();
  ui.waterShaderOpen.textContent = "Hide Water Shader";
}

function closeWaterShaderEditor() {
  ui.waterShaderModal.classList.add("is-hidden");
  ui.waterShaderOpen.textContent = "Water Shader";
}

function openShaderBallViewer() {
  initShaderBallViewer();
  syncShaderBallPreviewMaterial();
  ui.shaderBallModal.classList.remove("is-hidden");
  resizeShaderBallViewer();
}

function closeShaderBallViewer() {
  ui.shaderBallModal.classList.add("is-hidden");
}

function renderWaterShaderStack() {
  if (!ui.waterShaderStack) return;
  const w = normalizeWaterSettings(state.water);
  ui.waterShaderStack.innerHTML = `
    <div class="shader-node"><strong>Surface</strong><span>Visible water material</span></div>
    <div class="shader-node"><strong>Opacity</strong><span>${w.opacity.toFixed(2)} affects surface blend</span></div>
    <div class="shader-node"><strong>Reflection</strong><span>${w.reflectivity.toFixed(2)} sky response</span></div>
    <div class="shader-node"><strong>Motion</strong><span>Amplitude ${w.waveAmplitude.toFixed(2)} | frequency ${w.waveFrequency.toFixed(2)} | speed ${w.waveSpeed.toFixed(2)}</span></div>
    <div class="shader-node"><strong>Wind / Chop</strong><span>Wind ${w.windSpeed.toFixed(2)} | choppiness ${w.choppiness.toFixed(2)}</span></div>
    <div class="shader-node"><strong>Foam</strong><span>Intensity ${w.foamIntensity.toFixed(2)} | threshold ${w.foamThreshold.toFixed(2)} | contrast ${w.foamContrast.toFixed(2)}</span></div>
    <div class="shader-node"><strong>Underwater</strong><span>Fog density ${w.underwaterFogDensity.toFixed(3)}</span></div>
  `;
}

function initWaterShaderViewer() {
  if (waterShaderRenderer && waterShaderScene && waterShaderCamera && waterShaderMesh) return;
  const canvas = ui.waterShaderPreview;
  waterShaderRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  waterShaderRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  waterShaderRenderer.setClearColor(0x07111e, 1);
  waterShaderScene = new THREE.Scene();
  waterShaderCamera = new THREE.PerspectiveCamera(35, 900 / 360, 0.1, 100);
  waterShaderCamera.position.set(0, 4.8, 5.8);
  waterShaderCamera.lookAt(0, 0, 0);
  const ambient = new THREE.HemisphereLight(0xb7dbff, 0x1d2d3d, 1.3);
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(-2.8, 4.2, 3.4);
  const rim = new THREE.DirectionalLight(0x6bb3ff, 0.7);
  rim.position.set(3.2, 2.2, -2.8);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0x0e2036, side: THREE.BackSide })
  );
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 6.2, 96, 96), waterPreviewMaterial);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0;
  waterShaderScene.add(ambient, key, rim, sky, plane);
  waterShaderMesh = plane;
  resizeWaterShaderViewer();
}

function resizeWaterShaderViewer() {
  if (!waterShaderRenderer || !waterShaderCamera) return;
  const canvas = ui.waterShaderPreview;
  const width = Math.max(1, canvas.clientWidth || canvas.width || 900);
  const height = Math.max(1, canvas.clientHeight || canvas.height || 360);
  waterShaderRenderer.setSize(width, height, false);
  waterShaderCamera.aspect = width / height;
  waterShaderCamera.updateProjectionMatrix();
}

function syncWaterShaderPreviewMaterial() {
  const waterSettings = normalizeWaterSettings(state.water);
  configureWaterMaterial(waterPreviewMaterial, waterSettings);
}

function updateWaterShaderFromInputs() {
  const terrain = ensureTerrainSettings();
  const next = normalizeWaterSettings(state.water);
  const stack = ui.waterShaderStack;
  const read = (suffix: string) => stack?.querySelector<HTMLInputElement>(`#water-shader-${suffix}`)?.value;
  next.opacity = Math.max(0.4, Number(read("opacity")) || next.opacity);
  next.reflectivity = Math.max(0, Number(read("reflectivity")) || next.reflectivity);
  next.waveAmplitude = Math.max(0, Number(read("amplitude")) || next.waveAmplitude);
  next.waveFrequency = Math.max(0.01, Number(read("frequency")) || next.waveFrequency);
  next.waveSpeed = Math.max(0, Number(read("speed")) || next.waveSpeed);
  next.windSpeed = Math.max(0, Number(read("wind")) || next.windSpeed);
  next.choppiness = Math.max(0, Number(read("chop")) || next.choppiness);
  next.foamIntensity = Math.max(0, Number(read("foam")) || next.foamIntensity);
  next.foamThreshold = clamp(Number(read("foam-threshold")) || next.foamThreshold, 0, 1);
  next.foamContrast = Math.max(0.4, Number(read("foam-contrast")) || next.foamContrast);
  next.underwaterFogDensity = Math.max(0, Number(read("fog")) || next.underwaterFogDensity);
  state.water = next;
  terrain.water = { ...next };
  state.layout.terrain = terrain;
  state.layout.skyGradient = state.skyGradient;
  saveLocalLayout();
  syncWaterShaderPreviewMaterial();
  applySkyAndWater();
  if (!ui.waterShaderModal.classList.contains("is-hidden")) {
    renderWaterShaderStack();
    resizeWaterShaderViewer();
  }
}

function renderWaterShaderViewer(timeSeconds: number) {
  if (!waterShaderRenderer || !waterShaderScene || !waterShaderCamera || !waterShaderMesh) return;
  if (ui.waterShaderModal.classList.contains("is-hidden")) return;
  syncWaterShaderPreviewMaterial();
  updateWaterSurfaceGeometry(waterShaderMesh, timeSeconds, normalizeWaterSettings(state.water), state.layout.terrain?.waterLevel ?? -1.35);
  waterShaderCamera.lookAt(0, 0, 0);
  waterShaderRenderer.render(waterShaderScene, waterShaderCamera);
}

function syncRoadShaderUi() {
  const roadShader = normalizeRoadShaderSettings(state.layout.terrain?.roadShader ?? defaultTerrainSettings().roadShader);
  if (ui.roadShaderPreset) ui.roadShaderPreset.value = roadShader.preset;
  if (ui.roadShaderRepeat) ui.roadShaderRepeat.value = String(roadShader.repeat);
  if (ui.roadShaderAO) ui.roadShaderAO.value = String(roadShader.aoStrength);
  if (ui.roadShaderNormal) ui.roadShaderNormal.value = String(roadShader.normalStrength);
  if (ui.roadShaderBump) ui.roadShaderBump.value = String(roadShader.bumpStrength);
  if (ui.roadShaderRoughness) ui.roadShaderRoughness.value = String(roadShader.roughness);
  if (ui.roadShaderMetalness) ui.roadShaderMetalness.value = String(roadShader.metalness);
  drawRoadShaderPreview();
  renderRoadShaderStack();
  applyRoadShaderSettings();
}

function syncTerrainShaderUi() {
  const terrainLayers = normalizeTerrainLayerSettings(state.layout.terrain?.terrainLayers ?? defaultTerrainSettings().terrainLayers);
  if (ui.terrainDirtAO) ui.terrainDirtAO.value = String(terrainLayers.dirt.aoStrength);
  if (ui.terrainDirtNormal) ui.terrainDirtNormal.value = String(terrainLayers.dirt.normalStrength);
  if (ui.terrainDirtRoughness) ui.terrainDirtRoughness.value = String(terrainLayers.dirt.roughness);
  if (ui.terrainDirtMetalness) ui.terrainDirtMetalness.value = String(terrainLayers.dirt.metalness);
  if (ui.terrainSandAO) ui.terrainSandAO.value = String(terrainLayers.sand.aoStrength);
  if (ui.terrainSandNormal) ui.terrainSandNormal.value = String(terrainLayers.sand.normalStrength);
  if (ui.terrainSandRoughness) ui.terrainSandRoughness.value = String(terrainLayers.sand.roughness);
  if (ui.terrainSandMetalness) ui.terrainSandMetalness.value = String(terrainLayers.sand.metalness);
  if (ui.soilRepeat) ui.soilRepeat.value = String(terrainLayers.dirt.repeat);
  if (ui.sandRepeat) ui.sandRepeat.value = String(terrainLayers.sand.repeat);
  applyTerrainShaderSettings();
}

function renderRoadShaderStack() {
  const roadShader = normalizeRoadShaderSettings(state.layout.terrain?.roadShader ?? defaultTerrainSettings().roadShader);
  const bundle = roadTextureLibrary[roadShader.preset] ?? roadTextureLibrary.gravel;
  if (!ui.roadShaderStack) return;
  ui.roadShaderStack.innerHTML = `
    <div class="shader-node"><strong>Base Color</strong><span>${bundle ? nodeTextureName(bundle.albedo) : "loading"}</span></div>
    <div class="shader-node"><strong>Ambient Occlusion</strong><span>${bundle ? nodeTextureName(bundle.ao) : "loading"}</span></div>
    <div class="shader-node"><strong>Normal</strong><span>${bundle ? nodeTextureName(bundle.normal) : "loading"}</span></div>
    <div class="shader-node"><strong>Bump</strong><span>${bundle ? nodeTextureName(bundle.height) : "loading"}</span></div>
    <div class="shader-node"><strong>Roughness</strong><span>${bundle ? nodeTextureName(bundle.roughness) : "loading"}</span></div>
    <div class="shader-node"><strong>Metalness</strong><span>${bundle ? nodeTextureName(bundle.metallic) : "loading"}</span></div>
  `;
}

function nodeTextureName(texture: THREE.Texture) {
  const image = texture.image as HTMLImageElement | HTMLCanvasElement | undefined;
  const src = image && "src" in image ? image.src : "";
  const name = src.split("/").at(-1) ?? "";
  return name || "texture";
}

function drawRoadShaderPreview() {
  const canvas = ui.roadShaderPreview;
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  const roadShader = normalizeRoadShaderSettings(state.layout.terrain?.roadShader ?? defaultTerrainSettings().roadShader);
  const bundle = roadTextureLibrary[roadShader.preset] ?? roadTextureLibrary.gravel;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0b1220";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#dbe6f4";
  context.font = "bold 18px Arial";
  context.fillText(`${roadShader.preset.toUpperCase()} ROAD`, 16, 28);
  context.font = "12px Arial";
  context.fillText(`repeat ${roadShader.repeat.toFixed(2)} | AO ${roadShader.aoStrength.toFixed(2)} | normal ${roadShader.normalStrength.toFixed(2)}`, 16, 48);

  if (bundle) {
    const image = bundle.albedo.image as HTMLImageElement | HTMLCanvasElement | undefined;
    if (image) {
      const tileSize = 72 / Math.max(0.1, roadShader.repeat);
      for (let y = 64; y < canvas.height; y += tileSize) {
        for (let x = 0; x < canvas.width; x += tileSize) {
          context.drawImage(image, x, y, tileSize, tileSize);
        }
      }
    }
  }

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "rgba(12,18,30,0.18)");
  gradient.addColorStop(1, "rgba(8,10,16,0.68)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function updateRoadShaderFromInputs() {
  const terrain = ensureTerrainSettings();
  const current = normalizeRoadShaderSettings(terrain.roadShader ?? defaultTerrainSettings().roadShader);
  terrain.roadShader = {
    preset: (ui.roadShaderPreset.value as RoadShaderSettings["preset"]) || current.preset,
    repeat: Math.max(0.1, Number(ui.roadShaderRepeat.value) || current.repeat),
    aoStrength: Math.max(0, Number(ui.roadShaderAO.value) || current.aoStrength),
    normalStrength: Math.max(0, Number(ui.roadShaderNormal.value) || current.normalStrength),
    bumpStrength: Math.max(0, Number(ui.roadShaderBump.value) || current.bumpStrength),
    roughness: Math.max(0, Number(ui.roadShaderRoughness.value) || current.roughness),
    metalness: Math.max(0, Number(ui.roadShaderMetalness.value) || current.metalness),
  };
  state.roadRepeat = terrain.roadShader.repeat;
  terrainControls.roadRepeat.value = String(state.roadRepeat);
  applyRoadShaderSettings();
  applyTextureRepeats();
  renderRoadShaderStack();
  drawRoadShaderPreview();
  saveLocalLayout();
}

function updateTerrainShaderFromInputs() {
  const terrain = ensureTerrainSettings();
  const current = normalizeTerrainLayerSettings(terrain.terrainLayers ?? defaultTerrainSettings().terrainLayers);
  const nextLayers: TerrainLayerSettings = {
    dirt: {
      ...current.dirt,
      aoStrength: Math.max(0, Number(ui.terrainDirtAO?.value) || current.dirt.aoStrength),
      normalStrength: Math.max(0, Number(ui.terrainDirtNormal?.value) || current.dirt.normalStrength),
      roughness: Math.max(0, Number(ui.terrainDirtRoughness?.value) || current.dirt.roughness),
      metalness: Math.max(0, Number(ui.terrainDirtMetalness?.value) || current.dirt.metalness),
      repeat: Math.max(0.05, Number(terrainControls.soilRepeat.value) || current.dirt.repeat),
    },
    sand: {
      ...current.sand,
      aoStrength: Math.max(0, Number(ui.terrainSandAO?.value) || current.sand.aoStrength),
      normalStrength: Math.max(0, Number(ui.terrainSandNormal?.value) || current.sand.normalStrength),
      roughness: Math.max(0, Number(ui.terrainSandRoughness?.value) || current.sand.roughness),
      metalness: Math.max(0, Number(ui.terrainSandMetalness?.value) || current.sand.metalness),
      repeat: Math.max(0.05, Number(terrainControls.sandRepeat.value) || current.sand.repeat),
    },
  };
  terrain.terrainLayers = nextLayers;
  state.soilRepeat = nextLayers.dirt.repeat;
  state.sandRepeat = nextLayers.sand.repeat;
  terrainControls.soilRepeat.value = String(state.soilRepeat);
  terrainControls.sandRepeat.value = String(state.sandRepeat);
  applyTerrainShaderSettings();
  applyTextureRepeats();
  rebuildTerrainSurfaces();
  saveLocalLayout();
}

function drawSkyPreview() {
  const context = ui.skyPreview.getContext("2d");
  if (!context) return;
  const { width, height } = ui.skyPreview;
  for (let x = 0; x < width; x += 1) {
    const hour = (x / Math.max(1, width - 1)) * 24;
    const palette = skyPaletteForTime(hour);
    const top = rgbToHex(palette.topColor);
    const mid = rgbToHex(palette.midColor);
    const horizon = rgbToHex(palette.horizonColor);
    const column = context.createLinearGradient(0, 0, 0, height);
    column.addColorStop(0, top);
    column.addColorStop(0.55, mid);
    column.addColorStop(1, horizon);
    context.fillStyle = column;
    context.fillRect(x, 0, 1, height);
  }
}

function updateSkyEditorFromInputs() {
  const next = normalizeSkyGradient(state.skyGradient);
  const stop = next.stops[selectedSkyStopIndex];
  if (!stop) return;
  next.sunSideColor = hexToRgb(ui.skySunSide.value);
  next.oppositeSideColor = hexToRgb(ui.skyOppositeSide.value);
  stop.time = clamp(Number(ui.skyStopTime.value) || 0, 0, 24);
  stop.topColor = hexToRgb(ui.skyTop.value);
  stop.midColor = hexToRgb(ui.skyMid.value);
  stop.horizonColor = hexToRgb(ui.skyHorizon.value);
  stop.neonColor = hexToRgb(ui.skyNeon.value);
  stop.moonColor = hexToRgb(ui.skyMoon.value);
  next.stops.sort((a, b) => a.time - b.time);
  selectedSkyStopIndex = next.stops.indexOf(stop);
  saveSkyGradient(next);
  state.layout.skyGradient = state.skyGradient;
  saveLocalLayout();
  renderSkyEditor();
}

function updateWaterControls(rebuild = false) {
  state.water.opacity = clamp(Number(waterControls.opacity.value) || state.water.opacity, 0.4, 1.0);
  state.water.reflectivity = Math.max(0, Number(waterControls.reflectivity.value) || state.water.reflectivity);
  state.water.foamThreshold = clamp(Number(waterControls.foamThreshold.value) || state.water.foamThreshold, 0, 1);
  state.water.foamContrast = Math.max(0.4, Number(waterControls.foamContrast.value) || state.water.foamContrast);
  state.water.waveAmplitude = Math.max(0, Number(waterControls.waveAmplitude.value) || state.water.waveAmplitude);
  state.water.waveHeight = state.water.waveAmplitude;
  state.water.waveFrequency = Math.max(0.01, Number(waterControls.waveFrequency.value) || state.water.waveFrequency);
  state.water.waveScale = state.water.waveFrequency;
  state.water.waveSpeed = Math.max(0, Number(waterControls.waveSpeed.value) || state.water.waveSpeed);
  state.water.windSpeed = Math.max(0, Number(waterControls.windSpeed.value) || state.water.windSpeed);
  state.water.choppiness = Math.max(0, Number(waterControls.choppiness.value) || state.water.choppiness);
  state.water.underwaterFogDensity = Math.max(0, Number(waterControls.underwaterFogDensity.value) || state.water.underwaterFogDensity);
  state.water.foamIntensity = Math.max(0, Number(waterControls.foamIntensity.value) || state.water.foamIntensity);
  if (state.layout.terrain) {
    state.layout.terrain.waterLevel = Number(waterControls.level.value) || state.layout.terrain.waterLevel;
    state.layout.terrain.water = { ...state.water };
    if (rebuild) {
      rebuildWorld();
    } else {
      applySkyAndWater();
    }
    saveLocalLayout();
  }
}

function onResize() {
  const width = appRoot.clientWidth || 1;
  const height = appRoot.clientHeight || 1;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  resizeShaderBallViewer();
  resizeWaterShaderViewer();
}

function initShaderBallViewer() {
  if (shaderBallRenderer && shaderBallScene && shaderBallCamera && shaderBallMesh) return;
  const canvas = ui.shaderBallPreview;
  shaderBallRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  shaderBallRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  shaderBallRenderer.setClearColor(0x000000, 0);
  shaderBallScene = new THREE.Scene();
  shaderBallCamera = new THREE.PerspectiveCamera(35, 900 / 360, 0.1, 100);
  shaderBallCamera.position.set(0, 0.8, 4.2);
  const ambient = new THREE.HemisphereLight(0xffffff, 0x2c1d1a, 1.1);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(2.8, 3.8, 3.6);
  const rim = new THREE.DirectionalLight(0x9cc4ff, 0.85);
  rim.position.set(-3.2, 1.5, -2.6);
  const fill = new THREE.PointLight(0xff8844, 0.8, 12);
  fill.position.set(0, 1.8, 4);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.1, 96, 64), shaderBallMaterial);
  sphere.castShadow = false;
  sphere.receiveShadow = false;
  shaderBallScene.add(ambient, key, rim, fill, sphere);
  shaderBallMesh = sphere;
  resizeShaderBallViewer();
}

function resizeShaderBallViewer() {
  if (!shaderBallRenderer || !shaderBallCamera) return;
  const canvas = ui.shaderBallPreview;
  const width = Math.max(1, canvas.clientWidth || canvas.width || 900);
  const height = Math.max(1, canvas.clientHeight || canvas.height || 360);
  shaderBallRenderer.setSize(width, height, false);
  shaderBallCamera.aspect = width / height;
  shaderBallCamera.updateProjectionMatrix();
}

function renderShaderBallViewer(timeSeconds: number) {
  if (!shaderBallRenderer || !shaderBallScene || !shaderBallCamera || !shaderBallMesh) return;
  if (ui.shaderBallModal.classList.contains("is-hidden")) return;
  shaderBallMesh.rotation.y = timeSeconds * 0.35;
  shaderBallMesh.rotation.x = Math.sin(timeSeconds * 0.35) * 0.12;
  shaderBallRenderer.render(shaderBallScene, shaderBallCamera);
}

function syncShaderBallPreviewMaterial() {
  if (!shaderBallMesh) return;
  shaderBallMaterial.copy(roadMaterial);
  shaderBallMaterial.needsUpdate = true;
  resizeShaderBallViewer();
}

function objectIdFromHit(node: THREE.Object3D | null) {
  let current: THREE.Object3D | null = node;
  while (current) {
    const objectId = current.userData.objectId as string | undefined;
    if (objectId) return objectId;
    current = current.parent;
  }
  return null;
}

// Plain selection deliberately never moves the camera's orbit pivot — only
// an explicit focus gesture does (F / "Focus Selection" / double-click in
// the outliner, see focusSelectedObjects()). It used to re-center on every
// click (onto the object when selecting, onto the world center when
// deselecting), which made the pivot jump around on every click instead of
// persisting where the user left it.
function selectObject(id: string | null) {
  state.selectedObjectId = id;
  selectedObjectIds.clear();
  if (id) selectedObjectIds.add(id);
  const mesh = id ? objectMeshes.get(id) : null;
  if (mesh) {
    state.selectedRoadPoint = null;
    transformControls.attach(mesh);
  } else {
    transformControls.detach();
  }
  updateSceneOutliner();
  updateInspector();
}

function toggleObjectSelection(id: string) {
  if (selectedObjectIds.has(id)) {
    selectedObjectIds.delete(id);
  } else {
    selectedObjectIds.add(id);
  }
  state.selectedObjectId = selectedObjectIds.size > 0 ? [...selectedObjectIds].at(-1) ?? null : null;
  const mesh = state.selectedObjectId ? objectMeshes.get(state.selectedObjectId) : null;
  if (mesh && selectedObjectIds.size === 1) {
    state.selectedRoadPoint = null;
    transformControls.attach(mesh);
  } else {
    transformControls.detach();
  }
  updateSceneOutliner();
  updateInspector();
}

function selectionBounds(ids: Iterable<string>) {
  const box = new THREE.Box3();
  const fallbackPoints: THREE.Vector3[] = [];
  for (const id of ids) {
    const mesh = objectMeshes.get(id);
    if (mesh) {
      box.expandByObject(mesh);
      continue;
    }
    const object = state.layout.objects.find((item) => item.id === id);
    if (object) {
      fallbackPoints.push(new THREE.Vector3(object.position[0], object.position[1], object.position[2]));
    }
  }
  if (!box.isEmpty()) return box;
  if (fallbackPoints.length === 0) return null;
  return new THREE.Box3().setFromPoints(fallbackPoints);
}

function focusObjects(ids: Iterable<string>) {
  const box = selectionBounds(ids);
  if (!box) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 2);
  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() < 0.0001) {
    direction.set(1, 0.65, 1);
  }
  direction.normalize();
  const distance = Math.max(radius * 2.6, controls.minDistance + radius * 0.4);
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center.clone().add(direction.multiplyScalar(distance)));
  camera.near = Math.max(0.1, distance / 200);
  camera.far = Math.max(camera.far, distance * 20);
  camera.updateProjectionMatrix();
  controls.update();
}

function focusSelectedObjects() {
  if (selectedObjectIds.size === 0 && state.selectedObjectId) {
    focusObjects([state.selectedObjectId]);
    return;
  }
  focusObjects(selectedObjectIds);
}

function syncSelectedObjectFromTransform() {
  if (!state.selectedObjectId) return;
  if (state.selectedRoadPoint) {
    syncSelectedRoadPointFromTransform();
    return;
  }
  const object = state.layout.objects.find((item) => item.id === state.selectedObjectId);
  const mesh = objectMeshes.get(state.selectedObjectId);
  if (!object || !mesh) return;
  object.position = [mesh.position.x, mesh.position.y, mesh.position.z];
  object.rotation = [
    THREE.MathUtils.radToDeg(mesh.rotation.x),
    THREE.MathUtils.radToDeg(mesh.rotation.y),
    THREE.MathUtils.radToDeg(mesh.rotation.z),
  ];
  object.scale = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
  updateInspector();
  saveLocalLayout();
}

function syncSelectedObjectOrbitTarget() {
  if (!state.selectedObjectId) return;
  if (state.selectedRoadPoint) return;
  const mesh = objectMeshes.get(state.selectedObjectId);
  if (!mesh) return;
  controls.target.copy(mesh.position);
  controls.update();
}

function roadPointKey(roadId: string, pointIndex: number) {
  return `${roadId}:${pointIndex}`;
}

function selectRoadPoint(roadId: string, pointIndex: number) {
  const marker = roadPointMarkers.get(roadPointKey(roadId, pointIndex));
  if (!marker) return;
  state.selectedObjectId = null;
  selectedObjectIds.clear();
  state.selectedRoadPoint = { roadId, pointIndex };
  transformControls.attach(marker);
  controls.target.copy(marker.position);
  controls.update();
  updateInspector();
}

function restoreSelectedRoadPointHandle() {
  if (!state.selectedRoadPoint) return;
  const marker = roadPointMarkers.get(roadPointKey(state.selectedRoadPoint.roadId, state.selectedRoadPoint.pointIndex));
  if (!marker) {
    state.selectedRoadPoint = null;
    return;
  }
  transformControls.attach(marker);
}

function syncSelectedRoadPointFromTransform() {
  if (!state.selectedRoadPoint) return;
  const road = state.layout.terrain?.splines.find((spline) => spline.kind === "road" && spline.id === state.selectedRoadPoint?.roadId);
  const marker = roadPointMarkers.get(roadPointKey(state.selectedRoadPoint.roadId, state.selectedRoadPoint.pointIndex));
  if (!road || !marker) return;
  const point = road.points[state.selectedRoadPoint.pointIndex];
  if (!point) return;
  point.x = marker.position.x;
  point.z = marker.position.z;
  point.x = Number(point.x.toFixed(2));
  point.z = Number(point.z.toFixed(2));
  updateRoadSplineOptions();
  rebuildRoadMeshes();
  saveLocalLayout();
}

function updatePointerFromEvent(event: PointerEvent) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  if (transformControls.dragging) return;
  updatePointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  if (state.terrainMode === "road") {
    const roadHits = raycaster.intersectObjects(roadGuideGroup.children, true);
    const roadHit = roadHits.find((hit) => hit.object.userData.roadPoint);
    if (roadHit) {
      const roadPoint = roadHit.object.userData.roadPoint as { roadId: string; pointIndex: number };
      selectRoadPoint(roadPoint.roadId, roadPoint.pointIndex);
      return;
    }
  }

  const terrainHits = raycaster.intersectObjects(terrainMeshes, true);
  if (terrainHits.length > 0 && state.terrainMode === "sculpt") {
    event.preventDefault();
    pushHistory("sculpt");
    state.isSculpting = true;
    applyTerrainBrush(terrainHits[0].point, event);
    return;
  }
  if (terrainHits.length > 0 && state.terrainMode === "road") {
    event.preventDefault();
    addRoadPoint(terrainHits[0].point);
    return;
  }

  const hits = raycaster.intersectObjects(selectableMeshes, true);
  if (hits.length > 0) {
    const objectId = objectIdFromHit(hits[0].object);
    if (objectId) {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        toggleObjectSelection(objectId);
        return;
      }
      selectObject(objectId);
      return;
    }
  }

  selectObject(null);
}

function onPointerMove(event: PointerEvent) {
  if (state.terrainMode === "sculpt" || state.terrainMode === "road") {
    updatePointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    const terrainHits = raycaster.intersectObjects(terrainMeshes, true);
    if (terrainHits.length > 0) {
      const point = terrainHits[0].point;
      brushCursor.visible = true;
      brushCursor.position.set(point.x, point.y + 0.08, point.z);
      const scale = state.terrainMode === "sculpt" ? state.brushRadius : Math.max(2, Number(terrainControls.roadWidth.value) || 11);
      brushCursor.scale.setScalar(scale);
      if (state.isSculpting && state.terrainMode === "sculpt" && event.buttons === 1) {
        applyTerrainBrush(point, event);
      }
    } else {
      brushCursor.visible = false;
    }
    return;
  }
  if (!state.activeDragId) return;
  updatePointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  const terrainHits = raycaster.intersectObjects(terrainMeshes, true);
  if (terrainHits.length > 0) {
    const object = state.layout.objects.find((item) => item.id === state.activeDragId);
    if (!object) return;
    const point = terrainHits[0].point;
    object.position = [point.x, point.y, point.z];
    syncObjectTransform(object);
    updateInspector();
  }
}

function onPointerUp() {
  if (state.isSculpting) {
    state.isSculpting = false;
    saveLocalLayout();
    updateStatus("Sculpt stroke saved");
  }
  if (state.activeDragId) {
    state.activeDragId = null;
    controls.enabled = true;
    saveLocalLayout();
  }
}

function placeObjectAt(point: THREE.Vector3) {
  if (!state.selectedAssetUrl) return;
  const selectedAsset = state.assetCatalog.find((asset) => asset.url === state.selectedAssetUrl);
  pushHistory("place");
  const object: PlacedObjectData = {
    id: `object-${Date.now()}`,
    asset: state.selectedAssetUrl,
    lightType: selectedAsset?.lightType,
    intensity: selectedAsset?.kind === "light" ? 4 : undefined,
    range: selectedAsset?.kind === "light" ? 24 : undefined,
    falloff: selectedAsset?.kind === "light" ? 2 : undefined,
    color: selectedAsset?.kind === "light" ? [1, 0.82, 0.48] : undefined,
    position: [point.x, point.y, point.z],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    kind: selectedAsset?.kind ?? "asset",
  };
  state.layout.objects.push(object);
  spawnObject(object);
  selectObject(object.id);
  updateInspector();
  saveLocalLayout();
}

function placeDraggedAssetAt(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  const assetUrl = event.dataTransfer?.getData("text/plain") || state.selectedAssetUrl || "";
  if (!assetUrl) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  pointer.x = ((event.clientX - rect.left) / width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const terrainHits = raycaster.intersectObjects(terrainMeshes, true);
  if (terrainHits.length > 0) {
    const point = terrainHits[0].point;
    const signature = `${assetUrl}|${point.x.toFixed(3)}|${point.y.toFixed(3)}|${point.z.toFixed(3)}`;
    const now = performance.now();
    if (signature === lastAssetDropSignature && now - lastAssetDropTime < 250) return;
    lastAssetDropSignature = signature;
    lastAssetDropTime = now;
    state.selectedAssetUrl = assetUrl;
    placeObjectAt(point);
  }
}

function focusWorldPivot() {
  const center = worldCenter();
  controls.target.copy(center);
  controls.update();
}

function worldCenter() {
  const chunks = state.layout.terrainChunks ?? [];
  if (chunks.length > 0) {
    let minX = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const chunk of chunks) {
      const spacing = chunk.spacing || 2;
      const resolution = chunk.resolution || 33;
      const originX = chunk.origin?.[0] ?? 0;
      const originZ = chunk.origin?.[1] ?? 0;
      minX = Math.min(minX, originX);
      minZ = Math.min(minZ, originZ);
      maxX = Math.max(maxX, originX + spacing * (resolution - 1));
      maxZ = Math.max(maxZ, originZ + spacing * (resolution - 1));
    }
    return new THREE.Vector3((minX + maxX) * 0.5, 0, (minZ + maxZ) * 0.5);
  }

  if (state.layout.objects.length > 0) {
    const center = new THREE.Vector3();
    for (const object of state.layout.objects) {
      center.x += object.position[0];
      center.y += object.position[1];
      center.z += object.position[2];
    }
    center.multiplyScalar(1 / state.layout.objects.length);
    return center;
  }

  return new THREE.Vector3(0, 0, 0);
}

function onKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undoLastChange();
    return;
  }
  if (!isTyping && (event.key === "Delete" || event.key === "Backspace")) {
    deleteSelectedObjects();
  }
  if (!isTyping && event.key.toLowerCase() === "f") focusSelectedObjects();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveLocalLayout();
  }
  if (!isTyping && event.key.toLowerCase() === "w") setTransformMode("translate");
  if (!isTyping && event.key.toLowerCase() === "e") setTransformMode("rotate");
  if (!isTyping && event.key.toLowerCase() === "r") setTransformMode("scale");
  if (event.key === "Escape") {
    state.activeDragId = null;
    state.isSculpting = false;
    controls.enabled = true;
    selectObject(null);
    setTerrainMode("select");
    updateStatus("Placement mode disabled");
  }
}

function tick() {
  if (disposed) return;
  rafId = requestAnimationFrame(tick);

  if (state.playing) {
    state.timeOfDay = (state.timeOfDay + 0.01 * Number(timeControls.speed.value)) % 24;
    timeControls.slider.value = String(state.timeOfDay);
  }

  applySkyAndWater();
  renderShaderBallViewer(performance.now() / 1000);
  renderWaterShaderViewer(performance.now() / 1000);
  controls.update();
  renderer.render(scene, camera);
}

function buildUi() {
  const root = document.createElement("div");
  root.className = "viewport";

  const topbar = document.createElement("div");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <div>
      <strong>Weave Forge Three.js</strong>
      <div class="status">Shared map, shared assets, separate engine build.</div>
    </div>
    <div class="toolbar">
      <select id="level-picker" title="Your saved levels"><option value="">New, unsaved level</option></select>
      <input id="manifest-url" type="text" placeholder="/levels/home.level.json" style="display:none" />
      <input id="catalog-url" type="text" placeholder="/api/assets" style="display:none" />
      <button id="new-world" type="button">New Map</button>
      <button id="load-world" type="button">Reload</button>
      <button id="save-world" type="button">Save</button>
      <button id="export-world" type="button">Export</button>
      <span id="status" class="status">Ready.</span>
      <span id="diagnostics" class="status"></span>
    </div>
  `;
  root.appendChild(topbar);

  const shell = document.createElement("div");
  shell.className = "shell";
  shell.innerHTML = `
    <section class="panel panel-assets ${panelState.assets ? "is-collapsed" : ""}" data-panel="assets">
      <div class="panel-header">
        <h2>Hierarchy</h2>
        <button class="panel-toggle" type="button" data-toggle-panel="assets">${panelState.assets ? "Expand" : "Collapse"}</button>
      </div>
      <div class="body">
        <div class="panel-subhead">Placed Objects</div>
        <div id="scene-outliner" class="scene-outliner"></div>
        <div class="panel-subhead">Asset Shelf</div>
        <select id="asset-category"></select>
        <input id="asset-search" type="text" placeholder="Search assets folder" />
        <div id="asset-list" class="asset-list"></div>
      </div>
      <div class="panel-resize-handle panel-resize-x" data-resize-panel="assets" data-resize-axis="x"></div>
    </section>
    <section class="panel panel-inspector ${panelState.inspector ? "is-collapsed" : ""}" data-panel="inspector">
      <div class="panel-header">
        <h2>Inspector</h2>
        <button class="panel-toggle" type="button" data-toggle-panel="inspector">${panelState.inspector ? "Expand" : "Collapse"}</button>
      </div>
      <div id="inspector" class="body"></div>
      <div class="panel-resize-handle panel-resize-corner" data-resize-panel="inspector" data-resize-axis="both"></div>
    </section>
    <section class="panel panel-world ${panelState.world ? "is-collapsed" : ""}" data-panel="world">
      <div class="panel-header">
        <h2>World</h2>
        <button class="panel-toggle" type="button" data-toggle-panel="world">${panelState.world ? "Expand" : "Collapse"}</button>
      </div>
      <div class="body">
        <div class="stack">
          <label><span>Time of day</span><input id="time-slider" type="range" min="0" max="24" step="0.01" value="12" /></label>
          <div class="btn-row">
            <button id="time-play" type="button">Play</button>
            <button id="time-stop" type="button">Stop</button>
            <label style="flex:1"><span>Speed</span>
              <select id="time-speed">
                <option value="1">1 hour / sec</option>
                <option value="0.5" selected>1 hour / 2 sec</option>
                <option value="0.25">1 hour / 4 sec</option>
              </select>
            </label>
          </div>
          <div class="btn-row">
            <button id="transform-translate" type="button">Move</button>
            <button id="transform-rotate" type="button">Rotate</button>
            <button id="transform-scale" type="button">Scale</button>
          </div>
          <div class="panel-subhead">Terrain Tools</div>
          <div class="btn-row">
            <button id="terrain-select" type="button">Select</button>
            <button id="terrain-sculpt" type="button">Sculpt</button>
            <button id="terrain-road" type="button">Roads</button>
          </div>
          <label><span>Brush mode</span><select id="terrain-brush-mode"><option value="raise">Raise</option><option value="lower">Lower</option><option value="smooth">Smooth</option><option value="flatten">Flatten</option><option value="blend">Paint Shader</option></select></label>
          <label><span>Brush radius</span><input id="terrain-brush-radius" type="number" min="1" max="40" step="1" value="8" /></label>
          <label><span>Strength</span><input id="terrain-brush-strength" type="number" min="0.05" max="8" step="0.05" value="0.15" /></label>
          <label><span>Falloff</span><input id="terrain-brush-falloff" type="range" min="0" max="1" step="0.05" value="0.7" /></label>
          <label><span>Flatten height</span><input id="terrain-flatten-height" type="number" step="0.1" value="0" /></label>
          <label><span>Road width</span><input id="terrain-road-width" type="number" min="2" step="0.5" value="6" /></label>
          <label><span>Road shoulder</span><input id="terrain-road-shoulder" type="number" min="0" step="0.5" value="1.5" /></label>
          <label><span>Road elevation</span><input id="terrain-road-elevation" type="number" step="0.05" value="0.12" /></label>
          <label><span>Road repeat</span><input id="road-repeat" type="number" min="0.1" max="16" step="0.01" value="${state.roadRepeat}" /></label>
          <label><span>Road spline</span><select id="terrain-road-spline"></select></label>
          <div class="btn-row">
            <button id="terrain-new-road" type="button">New Road</button>
            <button id="terrain-delete-road" type="button">Delete Road</button>
          </div>
          <div class="shader-shelf terrain-shader-shelf">
            <div class="panel-subhead">Terrain Shader</div>
            <div class="btn-row">
              <button type="button" class="terrain-layer-button" data-terrain-layer="soil">Paint Soil</button>
              <button type="button" class="terrain-layer-button" data-terrain-layer="sand">Paint Sand</button>
              <button type="button" class="terrain-layer-button" data-terrain-layer="grass">Paint Grass</button>
            </div>
            <div class="terrain-layer-shelf">
              <div class="terrain-layer-header">Soil</div>
              <label><span>AO</span><input id="terrain-dirt-ao" type="range" min="0" max="2" step="0.01" value="1" /></label>
              <label><span>Normal</span><input id="terrain-dirt-normal" type="range" min="0" max="2" step="0.01" value="1" /></label>
              <label><span>Roughness</span><input id="terrain-dirt-roughness" type="range" min="0" max="1" step="0.01" value="0.96" /></label>
              <label><span>Metalness</span><input id="terrain-dirt-metalness" type="range" min="0" max="1" step="0.01" value="0" /></label>
              <label><span>Repeat</span><input id="soil-repeat" type="number" min="0.1" max="16" step="0.01" value="${state.soilRepeat}" /></label>
            </div>
            <div class="terrain-layer-shelf">
              <div class="terrain-layer-header">Sand Dunes</div>
              <label><span>AO</span><input id="terrain-sand-ao" type="range" min="0" max="2" step="0.01" value="1" /></label>
              <label><span>Normal</span><input id="terrain-sand-normal" type="range" min="0" max="2" step="0.01" value="1" /></label>
              <label><span>Roughness</span><input id="terrain-sand-roughness" type="range" min="0" max="1" step="0.01" value="0.92" /></label>
              <label><span>Metalness</span><input id="terrain-sand-metalness" type="range" min="0" max="1" step="0.01" value="0" /></label>
              <label><span>Repeat</span><input id="sand-repeat" type="number" min="0.1" max="16" step="0.01" value="${state.sandRepeat}" /></label>
            </div>
            <div class="status">Choose Soil or Sand Dunes, then use Paint Shader to place that material on the terrain.</div>
          </div>
          <div class="btn-row">
            <button id="terrain-regenerate" type="button">Regenerate Base</button>
            <button id="terrain-clear-road" type="button">Clear Road</button>
          </div>
          <div class="btn-row">
            <button id="sky-colors" type="button">Sky Colors</button>
          </div>
          <label><span>Skybox rotation</span><input id="sky-rotation" type="range" min="-180" max="180" step="1" value="${state.lighting.skyRotation}" /></label>
          <label><span>Moon light</span><input id="moon-intensity" type="range" min="0" max="5" step="0.05" value="${state.lighting.moonIntensity}" /></label>
          <label><span>Horizon glow</span><input id="horizon-glow" type="range" min="0" max="8" step="0.05" value="${state.lighting.horizonGlow}" /></label>
          <label><span>Ambient light</span><input id="ambient-intensity" type="range" min="0" max="1" step="0.01" value="${state.lighting.ambientIntensity}" /></label>
          <div class="btn-row">
            <button id="road-shader" type="button">Road Shader</button>
            <button id="water-shader" type="button">Water Shader</button>
            <button id="shader-ball" type="button">Shader Ball</button>
          </div>
          <div id="water-shader-shelf" class="shader-shelf is-hidden">
            <div class="sky-dialog-header">
              <div>
                <strong>Water Shader</strong>
                <span>Preview the visible water surface and tune the live shader uniforms.</span>
              </div>
              <div class="btn-row">
                <button id="water-shader-reset" type="button">Reset</button>
                <button id="water-shader-close" type="button">Hide</button>
              </div>
            </div>
            <canvas id="water-shader-preview" class="sky-preview" width="900" height="360"></canvas>
            <div class="panel-subhead">Construction</div>
            <div class="status">Base plane, layered wave displacement, fresnel reflection, shoreline foam, underwater fog.</div>
            <div id="water-shader-stack" class="stack"></div>
            <div class="water-form">
              <label><span>Surface opacity</span><input id="water-opacity" type="range" min="0.4" max="1" step="0.01" value="1" /></label>
              <label><span>Reflectivity</span><input id="water-reflectivity" type="range" min="0" max="1.4" step="0.01" value="0.72" /></label>
              <label><span>Foam threshold</span><input id="water-foam-threshold" type="range" min="0" max="1" step="0.01" value="0.45" /></label>
              <label><span>Foam contrast</span><input id="water-foam-contrast" type="range" min="0.4" max="2" step="0.01" value="0.82" /></label>
              <label><span>Water level</span><input id="water-level" type="number" step="0.05" value="-1.35" /></label>
              <label><span>Wave amplitude</span><input id="wave-amplitude" type="range" min="0" max="1.5" step="0.01" value="0.56" /></label>
              <label><span>Wave frequency</span><input id="wave-frequency" type="range" min="0.01" max="0.2" step="0.01" value="0.08" /></label>
              <label><span>Wave speed</span><input id="wave-speed" type="range" min="0" max="1.8" step="0.01" value="0.68" /></label>
              <label><span>Wind speed</span><input id="wave-wind-speed" type="range" min="0" max="2.5" step="0.01" value="0.2" /></label>
              <label><span>Choppiness</span><input id="wave-choppiness" type="range" min="0" max="1.5" step="0.01" value="0.72" /></label>
              <label><span>Underwater fog</span><input id="water-fog-density" type="range" min="0" max="0.06" step="0.001" value="0.018" /></label>
              <label><span>Foam intensity</span><input id="foam-intensity" type="range" min="0" max="2" step="0.01" value="0.92" /></label>
            </div>
          </div>
        </div>
        <div class="status">Click an asset, then click the terrain to place it. Select an object to edit position/rotation/scale.</div>
      </div>
      <div class="panel-resize-handle panel-resize-corner" data-resize-panel="world" data-resize-axis="both"></div>
    </section>
  `;
  root.appendChild(shell);

  const skyModal = document.createElement("div");
  skyModal.id = "sky-modal";
  skyModal.className = "sky-modal is-hidden";
  skyModal.innerHTML = `
    <div class="sky-dialog">
      <div class="sky-dialog-header">
        <div>
          <strong>Sky Gradient Editor</strong>
          <span>Edit sky colors by time of day.</span>
        </div>
        <div class="btn-row">
          <button id="sky-reset" type="button">Reset</button>
          <button id="sky-close" type="button">Close</button>
        </div>
      </div>
      <canvas id="sky-preview" class="sky-preview" width="900" height="150"></canvas>
      <div id="sky-stop-list" class="sky-stop-list"></div>
      <div class="sky-form">
        <label><span>Time</span><input id="sky-stop-time" type="number" min="0" max="24" step="0.25" /></label>
        <label><span>Sun side</span><input id="sky-sun-side" type="color" /></label>
        <label><span>Opposite side</span><input id="sky-opposite-side" type="color" /></label>
        <label><span>Top</span><input id="sky-top" type="color" /></label>
        <label><span>Mid</span><input id="sky-mid" type="color" /></label>
        <label><span>Horizon</span><input id="sky-horizon" type="color" /></label>
        <label><span>Neon</span><input id="sky-neon" type="color" /></label>
        <label><span>Moon</span><input id="sky-moon" type="color" /></label>
      </div>
    </div>
  `;
  root.appendChild(skyModal);

  const roadShaderModal = document.createElement("div");
  roadShaderModal.id = "road-shader-modal";
  roadShaderModal.className = "sky-modal is-hidden";
  roadShaderModal.innerHTML = `
    <div class="sky-dialog">
      <div class="sky-dialog-header">
        <div>
          <strong>Road Shader Builder</strong>
          <span>Use gravel or asphalt textures, plus AO, normal, bump, and roughness controls.</span>
        </div>
        <div class="btn-row">
          <button id="road-shader-reset" type="button">Reset</button>
          <button id="road-shader-close" type="button">Close</button>
        </div>
      </div>
      <canvas id="road-shader-preview" class="sky-preview" width="900" height="150"></canvas>
      <div id="road-shader-stack" class="shader-stack"></div>
      <div class="sky-form">
        <label><span>Preset</span><select id="road-shader-preset"><option value="highway-lanes">Highway lanes</option><option value="gravel">Gravel</option><option value="asphalt">Asphalt</option></select></label>
        <label><span>Texture repeat</span><input id="road-shader-repeat" type="number" min="0.1" max="6" step="0.05" value="1.4" /></label>
        <label><span>AO strength</span><input id="road-shader-ao" type="range" min="0" max="2" step="0.01" value="1" /></label>
        <label><span>Normal strength</span><input id="road-shader-normal" type="range" min="0" max="3" step="0.01" value="1" /></label>
        <label><span>Bump strength</span><input id="road-shader-bump" type="range" min="0" max="0.2" step="0.001" value="0.05" /></label>
        <label><span>Roughness</span><input id="road-shader-roughness" type="range" min="0" max="1.5" step="0.01" value="0.96" /></label>
        <label><span>Metalness</span><input id="road-shader-metalness" type="range" min="0" max="1" step="0.01" value="0" /></label>
      </div>
    </div>
  `;
  root.appendChild(roadShaderModal);

  const shaderBallModal = document.createElement("div");
  shaderBallModal.id = "shader-ball-modal";
  shaderBallModal.className = "sky-modal is-hidden";
  shaderBallModal.innerHTML = `
    <div class="sky-dialog">
      <div class="sky-dialog-header">
        <div>
          <strong>Shader Ball Viewer</strong>
          <span>Preview the current road shader on a lit sphere.</span>
        </div>
        <div class="btn-row">
          <button id="shader-ball-close" type="button">Close</button>
        </div>
      </div>
      <canvas id="shader-ball-preview" class="sky-preview" width="900" height="360"></canvas>
    </div>
  `;
  root.appendChild(shaderBallModal);

  const hint = document.createElement("div");
  hint.className = "canvas-hint";
  hint.textContent = "Drag an asset card into the world. Delete removes selected.";
  root.appendChild(hint);

  return {
    root,
    viewport: root,
    topbar,
    assetList: shell.querySelector<HTMLDivElement>("#asset-list")!,
    sceneOutliner: shell.querySelector<HTMLDivElement>("#scene-outliner")!,
    assetSearch: shell.querySelector<HTMLInputElement>("#asset-search")!,
    assetCategory: shell.querySelector<HTMLSelectElement>("#asset-category")!,
    inspector: shell.querySelector<HTMLDivElement>("#inspector")!,
    timeSlider: shell.querySelector<HTMLInputElement>("#time-slider")!,
    timePlay: shell.querySelector<HTMLButtonElement>("#time-play")!,
    timeStop: shell.querySelector<HTMLButtonElement>("#time-stop")!,
    timeSpeed: shell.querySelector<HTMLSelectElement>("#time-speed")!,
    transformTranslate: shell.querySelector<HTMLButtonElement>("#transform-translate")!,
    transformRotate: shell.querySelector<HTMLButtonElement>("#transform-rotate")!,
    transformScale: shell.querySelector<HTMLButtonElement>("#transform-scale")!,
    terrainSelect: shell.querySelector<HTMLButtonElement>("#terrain-select")!,
    terrainSculpt: shell.querySelector<HTMLButtonElement>("#terrain-sculpt")!,
    terrainRoad: shell.querySelector<HTMLButtonElement>("#terrain-road")!,
    terrainBrushMode: shell.querySelector<HTMLSelectElement>("#terrain-brush-mode")!,
    terrainBrushRadius: shell.querySelector<HTMLInputElement>("#terrain-brush-radius")!,
    terrainBrushStrength: shell.querySelector<HTMLInputElement>("#terrain-brush-strength")!,
    terrainBrushFalloff: shell.querySelector<HTMLInputElement>("#terrain-brush-falloff")!,
    terrainFlattenHeight: shell.querySelector<HTMLInputElement>("#terrain-flatten-height")!,
    terrainDirtAO: shell.querySelector<HTMLInputElement>("#terrain-dirt-ao")!,
    terrainDirtNormal: shell.querySelector<HTMLInputElement>("#terrain-dirt-normal")!,
    terrainDirtRoughness: shell.querySelector<HTMLInputElement>("#terrain-dirt-roughness")!,
    terrainDirtMetalness: shell.querySelector<HTMLInputElement>("#terrain-dirt-metalness")!,
    terrainSandAO: shell.querySelector<HTMLInputElement>("#terrain-sand-ao")!,
    terrainSandNormal: shell.querySelector<HTMLInputElement>("#terrain-sand-normal")!,
    terrainSandRoughness: shell.querySelector<HTMLInputElement>("#terrain-sand-roughness")!,
    terrainSandMetalness: shell.querySelector<HTMLInputElement>("#terrain-sand-metalness")!,
    terrainLayerButtons: Array.from(shell.querySelectorAll<HTMLButtonElement>("[data-terrain-layer]")),
    terrainRoadWidth: shell.querySelector<HTMLInputElement>("#terrain-road-width")!,
    terrainRoadShoulder: shell.querySelector<HTMLInputElement>("#terrain-road-shoulder")!,
    terrainRoadElevation: shell.querySelector<HTMLInputElement>("#terrain-road-elevation")!,
    roadSpline: shell.querySelector<HTMLSelectElement>("#terrain-road-spline")!,
    newRoad: shell.querySelector<HTMLButtonElement>("#terrain-new-road")!,
    deleteRoad: shell.querySelector<HTMLButtonElement>("#terrain-delete-road")!,
    soilRepeat: shell.querySelector<HTMLInputElement>("#soil-repeat")!,
    sandRepeat: shell.querySelector<HTMLInputElement>("#sand-repeat")!,
    roadRepeat: shell.querySelector<HTMLInputElement>("#road-repeat")!,
    terrainRegenerate: shell.querySelector<HTMLButtonElement>("#terrain-regenerate")!,
    terrainClearRoad: shell.querySelector<HTMLButtonElement>("#terrain-clear-road")!,
    skyColors: shell.querySelector<HTMLButtonElement>("#sky-colors")!,
    skyRotation: shell.querySelector<HTMLInputElement>("#sky-rotation")!,
    moonIntensity: shell.querySelector<HTMLInputElement>("#moon-intensity")!,
    horizonGlow: shell.querySelector<HTMLInputElement>("#horizon-glow")!,
    ambientIntensity: shell.querySelector<HTMLInputElement>("#ambient-intensity")!,
    waterOpacity: shell.querySelector<HTMLInputElement>("#water-opacity")!,
    waterReflectivity: shell.querySelector<HTMLInputElement>("#water-reflectivity")!,
    foamThreshold: shell.querySelector<HTMLInputElement>("#water-foam-threshold")!,
    foamContrast: shell.querySelector<HTMLInputElement>("#water-foam-contrast")!,
    waterLevel: shell.querySelector<HTMLInputElement>("#water-level")!,
    waveAmplitude: shell.querySelector<HTMLInputElement>("#wave-amplitude")!,
    waveFrequency: shell.querySelector<HTMLInputElement>("#wave-frequency")!,
    waveSpeed: shell.querySelector<HTMLInputElement>("#wave-speed")!,
    windSpeed: shell.querySelector<HTMLInputElement>("#wave-wind-speed")!,
    choppiness: shell.querySelector<HTMLInputElement>("#wave-choppiness")!,
    underwaterFogDensity: shell.querySelector<HTMLInputElement>("#water-fog-density")!,
    foamIntensity: shell.querySelector<HTMLInputElement>("#foam-intensity")!,
    skyModal,
    skyPreview: skyModal.querySelector<HTMLCanvasElement>("#sky-preview")!,
    skyStopList: skyModal.querySelector<HTMLDivElement>("#sky-stop-list")!,
    skyStopTime: skyModal.querySelector<HTMLInputElement>("#sky-stop-time")!,
    skySunSide: skyModal.querySelector<HTMLInputElement>("#sky-sun-side")!,
    skyOppositeSide: skyModal.querySelector<HTMLInputElement>("#sky-opposite-side")!,
    skyTop: skyModal.querySelector<HTMLInputElement>("#sky-top")!,
    skyMid: skyModal.querySelector<HTMLInputElement>("#sky-mid")!,
    skyHorizon: skyModal.querySelector<HTMLInputElement>("#sky-horizon")!,
    skyNeon: skyModal.querySelector<HTMLInputElement>("#sky-neon")!,
    skyMoon: skyModal.querySelector<HTMLInputElement>("#sky-moon")!,
    skyReset: skyModal.querySelector<HTMLButtonElement>("#sky-reset")!,
    skyClose: skyModal.querySelector<HTMLButtonElement>("#sky-close")!,
    roadShaderOpen: shell.querySelector<HTMLButtonElement>("#road-shader")!,
    roadShaderModal,
    roadShaderPreview: roadShaderModal.querySelector<HTMLCanvasElement>("#road-shader-preview")!,
    roadShaderStack: roadShaderModal.querySelector<HTMLDivElement>("#road-shader-stack")!,
    roadShaderPreset: roadShaderModal.querySelector<HTMLSelectElement>("#road-shader-preset")!,
    roadShaderRepeat: roadShaderModal.querySelector<HTMLInputElement>("#road-shader-repeat")!,
    roadShaderAO: roadShaderModal.querySelector<HTMLInputElement>("#road-shader-ao")!,
    roadShaderNormal: roadShaderModal.querySelector<HTMLInputElement>("#road-shader-normal")!,
    roadShaderBump: roadShaderModal.querySelector<HTMLInputElement>("#road-shader-bump")!,
    roadShaderRoughness: roadShaderModal.querySelector<HTMLInputElement>("#road-shader-roughness")!,
    roadShaderMetalness: roadShaderModal.querySelector<HTMLInputElement>("#road-shader-metalness")!,
    roadShaderReset: roadShaderModal.querySelector<HTMLButtonElement>("#road-shader-reset")!,
    roadShaderClose: roadShaderModal.querySelector<HTMLButtonElement>("#road-shader-close")!,
    waterShaderOpen: shell.querySelector<HTMLButtonElement>("#water-shader")!,
    waterShaderModal: shell.querySelector<HTMLDivElement>("#water-shader-shelf")!,
    waterShaderPreview: shell.querySelector<HTMLCanvasElement>("#water-shader-preview")!,
    waterShaderStack: shell.querySelector<HTMLDivElement>("#water-shader-stack")!,
    waterShaderReset: shell.querySelector<HTMLButtonElement>("#water-shader-reset")!,
    waterShaderClose: shell.querySelector<HTMLButtonElement>("#water-shader-close")!,
    shaderBallOpen: shell.querySelector<HTMLButtonElement>("#shader-ball")!,
    shaderBallModal,
    shaderBallPreview: shaderBallModal.querySelector<HTMLCanvasElement>("#shader-ball-preview")!,
    shaderBallClose: shaderBallModal.querySelector<HTMLButtonElement>("#shader-ball-close")!,
  };
}

function normalizeSkyGradientInput(next: SkyGradientSettings): SkyGradientSettings {
  return normalizeSkyGradient(next);
}

return function cleanup() {
  disposed = true;
  cancelAnimationFrame(rafId);
  containerResizeObserver.disconnect();
  controls.dispose();
  transformControls.dispose();
  for (const listener of trackedListeners) {
    listener.target.removeEventListener(listener.type, listener.listener);
  }
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else if (material) {
      material.dispose();
    }
  });
  renderer.dispose();
  appRoot.innerHTML = "";
};
}
