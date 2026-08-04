// Straight port of ~/threejs-world-builder/packages/woven-world-schema/src/index.ts
// into this repo — the source has zero imports (pure math/types), so this is a
// copy, not a rewrite. Kept as its own module so components/tools/
// WorldBuilderViewer.tsx can import it the same way the standalone editor did.

export type AssetDefinition = {
  category: string;
  name: string;
  url: string;
  kind?: "asset" | "light" | "water";
  physics?: "none" | "fixed" | "dynamic";
  lightType?: "directional" | "omni" | "spot";
  fileName?: string;
  sizeBytes?: number;
  vertexCount?: number;
  triangleCount?: number;
  // Woven addition — populated from the backing creator_assets row's
  // meta.buildingPart, when tagged. See BuildingPartMeta below.
  buildingPart?: BuildingPartMeta;
};

// Building-part tagging convention (Woven addition, not part of the ported
// standalone schema): a creator_assets row's `meta.buildingPart` field,
// used to filter/organize the Building tool's floor-piece palette. Height
// for stacking is measured from each loaded template's own bounding box
// at build time instead of being hand-entered here — one less thing to
// get wrong when tagging a piece.
export type BuildingPartSlot =
  | "ground"
  | "mezzanine"
  | "floor"
  | "top"
  | "roof"
  | "window"
  | "greeble-power"
  | "greeble-antenna"
  | "greeble-ac"
  | "greeble-phone";

export type BuildingPartMeta = {
  slot: BuildingPartSlot;
  style: string;
};

// A building's own record of which piece fills each floor slot — kept on
// the building's PlacedObjectData (kind: "building") so it can be
// re-edited later (swap a floor, add a floor) without losing the recipe.
// Deliberately independent of `style` per-slot: floors can be freely
// mixed across styles even though `style` supplies the default palette
// filter when picking pieces.
export type BuildingFloorSpec = {
  slot: BuildingPartSlot;
  assetId: string;
};

export type BuildingSpec = {
  style: string;
  floors: BuildingFloorSpec[]; // ordered bottom-to-top, ground first
  roofAssetId: string;
};

export type PlacedObjectData = {
  id: string;
  parentId?: string;
  kind?: "asset" | "light" | "building" | "water";
  // For kind "building": set to the ground floor's assetId as a fallback
  // reference (thumbnail/label lookups elsewhere assume every object has
  // a single `.asset`) — the real per-floor recipe lives in `building`.
  asset: string;
  building?: BuildingSpec;
  shaderMode?: "standard" | "toon" | "outline" | "custom";
  // For shaderMode "custom": a creator_assets id of a saved Shaderade
  // shader_graph asset. The graph is recompiled client-side (see
  // compileCustomShader in editor.ts) rather than stored pre-compiled here
  // — a shader_graph asset's saved JSON only has the compiled shader
  // source strings, not the uniforms map a THREE.ShaderMaterial actually
  // needs, so recompiling from the saved nodes/edges is what makes this
  // work correctly rather than approximately.
  customShaderAssetId?: string;
  shaderSettings?: {
    toon?: {
      steps?: number;
      contrast?: number;
      outlineEnabled?: boolean;
      outlineThickness?: number;
      outlineColor?: [number, number, number];
    };
    outline?: {
      fillColor?: [number, number, number];
      thickness?: number;
      color?: [number, number, number];
    };
  };
  chunk?: string;
  lightType?: "directional" | "omni" | "spot";
  intensity?: number;
  range?: number;
  falloff?: number;
  color?: [number, number, number];
  emissiveIntensity?: number;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

export type SceneGroupData = {
  id: string;
  kind: "group";
  name: string;
  parentId?: string;
};

export type SceneNodeData = PlacedObjectData | SceneGroupData;

export type TerrainControlPoint = {
  x: number;
  z: number;
};

export type TerrainSpline = {
  id: string;
  kind: "canal" | "road";
  width: number;
  shoulder?: number;
  depth?: number;
  elevation?: number;
  points: TerrainControlPoint[];
};

export type RoadShaderSettings = {
  preset: "asphalt" | "gravel" | "highway-lanes";
  repeat: number;
  aoStrength: number;
  normalStrength: number;
  bumpStrength: number;
  roughness: number;
  metalness: number;
};

export type TerrainShaderSettings = {
  preset: "soil" | "sand-dunes1" | "gravel";
  repeat: number;
  aoStrength: number;
  normalStrength: number;
  roughness: number;
  metalness: number;
};

export type WaterSurfaceSettings = {
  waveAmplitude: number;
  waveFrequency: number;
  waveSpeed: number;
  windSpeed: number;
  choppiness: number;
  waveHeight: number;
  waveScale: number;
  foamIntensity: number;
  buoyancy: number;
  drift: number;
  opacity: number;
  reflectivity: number;
  foamThreshold: number;
  foamContrast: number;
  underwaterFogDensity: number;
};

// Instanced grass-blade scattering (lib/world-builder/editor.ts's
// rebuildGrassInstances) — deliberately separate from paintMask.grass
// above, which is only a flat terrain vertex-color tint with no
// geometry. densityMultiplier/bladeHeight/windSpeed/windStrength are
// all exposed as sliders in the terrain brush panel.
export type GrassSettings = {
  densityMultiplier: number;
  bladeHeight: number;
  windSpeed: number;
  windStrength: number;
};

export type TerrainDistrictSettings = {
  seed: number;
  revision: number;
  extentChunks: number;
  waterLevel: number;
  water: WaterSurfaceSettings;
  grass: GrassSettings;
  shoreline: TerrainControlPoint[];
  splines: TerrainSpline[];
  terrainLayers?: {
    dirt?: TerrainShaderSettings;
    sand?: TerrainShaderSettings;
  };
  roadShader?: RoadShaderSettings;
};

export type TerrainChunkData = {
  id: string;
  origin: [number, number];
  resolution: number;
  spacing: number;
  heights: number[];
  waterMask: number[];
  paintMask?: {
    grass?: number[];
    sand?: number[];
  };
  /** Painted grass-BLADE density, one float per heightfield vertex —
   * same shape/convention as paintMask above, but drives instanced 3D
   * grass geometry (rebuildGrassInstances), not a color tint. Separate
   * field so "tint the ground green" and "place 3D blades" can't be
   * confused with each other. */
  grassDensity?: number[];
  objects?: PlacedObjectData[];
  terrain?: Partial<TerrainDistrictSettings>;
};

export type TerrainBrushMode = "raise" | "lower" | "smooth" | "flatten" | "blend" | "grass";

export type TerrainBrushSettings = {
  mode: TerrainBrushMode;
  radius: number;
  strength: number;
  falloff: number;
  flattenHeight: number;
};

export type SkyGradientStop = {
  time: number;
  topColor: [number, number, number];
  midColor: [number, number, number];
  horizonColor: [number, number, number];
  neonColor: [number, number, number];
  moonColor: [number, number, number];
};

export type SkyGradientSettings = {
  sunSideColor: [number, number, number];
  oppositeSideColor: [number, number, number];
  stops: SkyGradientStop[];
};

export type LevelLayout = {
  name: string;
  district: string;
  chunkSize: number;
  chunks: Array<{
    id: string;
    url: string;
    objectCount: number;
  }>;
  groups: SceneGroupData[];
  terrain?: TerrainDistrictSettings;
  terrainChunks?: TerrainChunkData[];
  skyGradient?: SkyGradientSettings;
  lighting?: unknown;
  objects: PlacedObjectData[];
};

export function defaultWaterSettings(): WaterSurfaceSettings {
  return {
    waveAmplitude: 0.56,
    waveFrequency: 0.08,
    waveSpeed: 0.68,
    windSpeed: 0.2,
    choppiness: 0.72,
    waveHeight: 0.56,
    waveScale: 0.08,
    foamIntensity: 0.92,
    buoyancy: 0.24,
    drift: 0.12,
    opacity: 1,
    reflectivity: 0.72,
    foamThreshold: 0.45,
    foamContrast: 0.82,
    underwaterFogDensity: 0.018,
  };
}

export function defaultGrassSettings(): GrassSettings {
  return {
    densityMultiplier: 1,
    // blue_reeds.glb's bounds (~26x40x63 units) suggest it was
    // authored in centimeters — 0.01 brings a blade to roughly
    // half-a-meter tall, a reasonable "tall grass" starting point.
    bladeHeight: 0.01,
    windSpeed: 0.6,
    windStrength: 0.35,
  };
}

export function defaultTerrainSettings(): TerrainDistrictSettings {
  return {
    seed: 7319,
    revision: 1,
    extentChunks: 4,
    waterLevel: -1.35,
    water: defaultWaterSettings(),
    grass: defaultGrassSettings(),
    shoreline: [
      { x: -52, z: -96 },
      { x: -48, z: -32 },
      { x: -44, z: 32 },
      { x: -50, z: 96 },
    ],
    splines: [
      {
        id: "canal-main",
        kind: "canal",
        width: 13,
        depth: 3,
        points: [
          { x: -18, z: -96 },
          { x: -12, z: -20 },
          { x: -20, z: 96 },
        ],
      },
      {
        id: "road-main",
        kind: "road",
        width: 11,
        shoulder: 5,
        elevation: 0.15,
        points: [
          { x: -36, z: -64 },
          { x: 6, z: -18 },
          { x: 42, z: 48 },
        ],
      },
    ],
    roadShader: {
      preset: "highway-lanes",
      repeat: 1.4,
      aoStrength: 1,
      normalStrength: 1,
      bumpStrength: 0.05,
      roughness: 0.96,
      metalness: 0,
    },
    terrainLayers: {
      dirt: {
        preset: "soil",
        repeat: 4.25,
        aoStrength: 1,
        normalStrength: 1,
        roughness: 0.96,
        metalness: 0,
      },
      sand: {
        preset: "sand-dunes1",
        repeat: 6.5,
        aoStrength: 1,
        normalStrength: 1,
        roughness: 0.92,
        metalness: 0,
      },
    },
  };
}

export const TERRAIN_CHUNK_SIZE = 64;
export const TERRAIN_RESOLUTION = 33;
export const TERRAIN_SPACING = TERRAIN_CHUNK_SIZE / (TERRAIN_RESOLUTION - 1);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * clamp(t, 0, 1);
}

function hashTerrain(seed: number, x: number, z: number) {
  const value = Math.sin(x * 12.9898 + z * 78.233 + seed * 0.013) * 43758.5453;
  return value - Math.floor(value);
}

export function chunkIdForCoords(x: number, z: number, district = "district_00") {
  return `${district}/chunk_${x}_${z}`;
}

export function chunkIdForPosition(position: [number, number, number], chunkSize = TERRAIN_CHUNK_SIZE, district = "district_00") {
  const x = Math.floor(position[0] / chunkSize);
  const z = Math.floor(position[2] / chunkSize);
  return chunkIdForCoords(x, z, district);
}

export function distanceToSegment(x: number, z: number, a: TerrainControlPoint, b: TerrainControlPoint) {
  const abX = b.x - a.x;
  const abZ = b.z - a.z;
  const lengthSq = abX * abX + abZ * abZ;
  if (lengthSq === 0) return Math.hypot(x - a.x, z - a.z);
  const t = clamp(((x - a.x) * abX + (z - a.z) * abZ) / lengthSq, 0, 1);
  return Math.hypot(x - (a.x + abX * t), z - (a.z + abZ * t));
}

export function distanceToSpline(x: number, z: number, points: TerrainControlPoint[]) {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(x, z, points[index - 1], points[index]));
  }
  return distance;
}

function shorelineXAt(z: number, points: TerrainControlPoint[]) {
  const sorted = [...points].sort((a, b) => a.z - b.z);
  if (sorted.length === 0) return -48;
  if (z <= sorted[0].z) return sorted[0].x;
  if (z >= sorted.at(-1)!.z) return sorted.at(-1)!.x;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const next = sorted[index];
    if (z > next.z) continue;
    return lerp(previous.x, next.x, (z - previous.z) / (next.z - previous.z));
  }
  return sorted[0].x;
}

export function generatedTerrainHeight(settings: TerrainDistrictSettings, x: number, z: number) {
  const broadNoise = hashTerrain(settings.seed, Math.floor(x / 16), Math.floor(z / 16)) - 0.5;
  const detailNoise = hashTerrain(settings.seed + 17, Math.floor(x / 4), Math.floor(z / 4)) - 0.5;
  let height = 0.25 + broadNoise * 1.1 + detailNoise * 0.22;
  const shoreDistance = x - shorelineXAt(z, settings.shoreline);
  if (shoreDistance < 0) height = settings.waterLevel - 2.4;
  else if (shoreDistance < 10) height = lerp(settings.waterLevel - 0.2, height, shoreDistance / 10);

  settings.splines.forEach((spline) => {
    const distance = distanceToSpline(x, z, spline.points);
    if (spline.kind === "canal" && distance < spline.width) {
      height = Math.min(height, lerp(settings.waterLevel - (spline.depth ?? 3), height, clamp(distance / spline.width, 0, 1)));
    }
    if (spline.kind === "road" && distance < spline.width) {
      const shoulder = clamp(distance / spline.width, 0, 1);
      height = lerp(spline.elevation ?? 0, height, shoulder * shoulder);
    }
  });
  return Number(height.toFixed(3));
}

export function generateTerrainChunks(settings: TerrainDistrictSettings, district = "district_00") {
  const chunks: TerrainChunkData[] = [];
  const half = Math.floor(settings.extentChunks / 2);
  for (let chunkX = -half; chunkX < settings.extentChunks - half; chunkX += 1) {
    for (let chunkZ = -half; chunkZ < settings.extentChunks - half; chunkZ += 1) {
      const originX = chunkX * TERRAIN_CHUNK_SIZE;
      const originZ = chunkZ * TERRAIN_CHUNK_SIZE;
      const heights: number[] = [];
      const waterMask: number[] = [];
      for (let z = 0; z < TERRAIN_RESOLUTION; z += 1) {
        for (let x = 0; x < TERRAIN_RESOLUTION; x += 1) {
          const height = generatedTerrainHeight(settings, originX + x * TERRAIN_SPACING, originZ + z * TERRAIN_SPACING);
          heights.push(height);
          waterMask.push(height < settings.waterLevel ? 1 : 0);
        }
      }
      chunks.push({
        id: chunkIdForCoords(chunkX, chunkZ, district),
        origin: [originX, originZ],
        resolution: TERRAIN_RESOLUTION,
        spacing: TERRAIN_SPACING,
        heights,
        waterMask,
      });
    }
  }
  return chunks;
}

export function sampleTerrainHeight(chunks: TerrainChunkData[], x: number, z: number, fallback = 0, chunkSize = TERRAIN_CHUNK_SIZE, district = "district_00") {
  const chunk = chunks.find((item) => item.id === chunkIdForPosition([x, 0, z], chunkSize, district));
  // A shell chunk (an object placed outside every generated terrain
  // chunk's bounds gets a `terrain: {}` row on save — see
  // terrainMesh.ts's note above layerMaskForChunk) has no heights at
  // all; in practice its `id` also never matches chunkIdForPosition's
  // deterministic id, so `find` above shouldn't return one, but this
  // guard makes that explicit rather than relying on that alone.
  if (!chunk || !chunk.heights) return fallback;
  const localX = clamp((x - chunk.origin[0]) / chunk.spacing, 0, chunk.resolution - 1);
  const localZ = clamp((z - chunk.origin[1]) / chunk.spacing, 0, chunk.resolution - 1);
  const x0 = Math.floor(localX);
  const z0 = Math.floor(localZ);
  const x1 = Math.min(chunk.resolution - 1, x0 + 1);
  const z1 = Math.min(chunk.resolution - 1, z0 + 1);
  const at = (sampleX: number, sampleZ: number) => chunk.heights[sampleZ * chunk.resolution + sampleX] ?? fallback;
  return lerp(lerp(at(x0, z0), at(x1, z0), localX - x0), lerp(at(x0, z1), at(x1, z1), localX - x0), localZ - z0);
}

export function updateTerrainWaterMask(chunk: TerrainChunkData, waterLevel: number) {
  chunk.waterMask = chunk.heights.map((height) => (height < waterLevel ? 1 : 0));
}

export function terrainBrushWeight(distance: number, radius: number, falloff: number) {
  const normalized = clamp(1 - distance / Math.max(0.001, radius), 0, 1);
  return lerp(normalized > 0 ? 1 : 0, normalized * normalized * (3 - 2 * normalized), falloff);
}

export function sculptTerrainAt(
  chunks: TerrainChunkData[],
  point: { x: number; y: number; z: number },
  settings: TerrainBrushSettings,
  waterLevel: number,
  fallbackHeight = 0,
  chunkSize = TERRAIN_CHUNK_SIZE,
  district = "district_00"
) {
  const touchedChunks = new Set<string>();
  const nextHeights = new Map<string, number>();
  const samples: Array<{ chunk: TerrainChunkData; index: number; x: number; z: number; height: number; weight: number }> = [];

  chunks.forEach((chunk) => {
    for (let z = 0; z < chunk.resolution; z += 1) {
      for (let x = 0; x < chunk.resolution; x += 1) {
        const worldX = chunk.origin[0] + x * chunk.spacing;
        const worldZ = chunk.origin[1] + z * chunk.spacing;
        const distance = Math.hypot(worldX - point.x, worldZ - point.z);
        if (distance > settings.radius) continue;
        const index = z * chunk.resolution + x;
        samples.push({ chunk, index, x: worldX, z: worldZ, height: chunk.heights[index], weight: terrainBrushWeight(distance, settings.radius, settings.falloff) });
      }
    }
  });

  const sampleHeight = (x: number, z: number) => nextHeights.get(`${x}:${z}`) ?? sampleTerrainHeight(chunks, x, z, fallbackHeight, chunkSize, district);

  samples.forEach((sample) => {
    let nextHeight = sample.height;
    if (settings.mode === "raise") nextHeight += settings.strength * sample.weight;
    if (settings.mode === "lower") nextHeight -= settings.strength * sample.weight;
    if (settings.mode === "flatten") nextHeight = lerp(sample.height, settings.flattenHeight, clamp(settings.strength * 0.12 * sample.weight, 0, 1));
    if (settings.mode === "smooth") {
      const spacing = sample.chunk.spacing;
      const average = (
        sampleHeight(sample.x - spacing, sample.z) +
        sampleHeight(sample.x + spacing, sample.z) +
        sampleHeight(sample.x, sample.z - spacing) +
        sampleHeight(sample.x, sample.z + spacing) +
        sample.height
      ) / 5;
      nextHeight = lerp(sample.height, average, clamp(settings.strength * 0.15 * sample.weight, 0, 1));
    }
    nextHeights.set(`${sample.x}:${sample.z}`, Number(nextHeight.toFixed(3)));
  });

  chunks.forEach((chunk) => {
    let touched = false;
    for (let z = 0; z < chunk.resolution; z += 1) {
      for (let x = 0; x < chunk.resolution; x += 1) {
        const worldX = chunk.origin[0] + x * chunk.spacing;
        const worldZ = chunk.origin[1] + z * chunk.spacing;
        const nextHeight = nextHeights.get(`${worldX}:${worldZ}`);
        if (nextHeight === undefined) continue;
        chunk.heights[z * chunk.resolution + x] = nextHeight;
        touched = true;
      }
    }
    if (!touched) return;
    updateTerrainWaterMask(chunk, waterLevel);
    touchedChunks.add(chunk.id);
  });

  return touchedChunks;
}

export function sampleWaterSurfaceOffset(x: number, z: number, timeSeconds: number, settings: WaterSurfaceSettings) {
  const amplitude = settings.waveAmplitude ?? settings.waveHeight;
  const frequency = settings.waveFrequency ?? settings.waveScale;
  const speed = settings.waveSpeed;
  const wind = settings.windSpeed;
  const choppiness = settings.choppiness;
  const driftX = Math.cos(0.72) * wind * timeSeconds * 0.08;
  const driftZ = Math.sin(0.72) * wind * timeSeconds * 0.08;
  const waveUvX = x * frequency + timeSeconds * speed * 0.04 + driftX;
  const waveUvZ = z * frequency - timeSeconds * speed * 0.03 + driftZ;
  const swell = (
    Math.sin(waveUvX * 1.4 + timeSeconds * speed * (0.95 + wind * 0.25)) * 0.5 +
    Math.cos(waveUvZ * 1.8 - timeSeconds * speed * (1.15 + wind * 0.15)) * 0.35
  ) * amplitude;
  const ripple = Math.sin((x + z) * (0.032 + frequency * 0.12) + timeSeconds * speed * (1.3 + wind * 0.2)) * amplitude * 0.12;
  const chop = Math.pow(Math.abs(Math.sin(waveUvX * 2.2 + waveUvZ * 1.7 + timeSeconds * speed * (1.7 + wind * 0.3))), 1.0 + choppiness * 3.0);
  return swell + ripple + (chop - 0.5) * amplitude * choppiness * 0.24;
}

export function defaultSkyGradient(): SkyGradientSettings {
  return {
    sunSideColor: [1, 0.46, 0.24],
    oppositeSideColor: [0.58, 0.42, 0.86],
    stops: [
      {
        time: 0,
        topColor: [0.03, 0.04, 0.08],
        midColor: [0.07, 0.08, 0.16],
        horizonColor: [0.16, 0.12, 0.24],
        neonColor: [0.28, 0.18, 0.42],
        moonColor: [0.7, 0.78, 1],
      },
      {
        time: 6,
        topColor: [0.12, 0.13, 0.24],
        midColor: [0.48, 0.26, 0.52],
        horizonColor: [0.95, 0.54, 0.28],
        neonColor: [0.96, 0.36, 0.2],
        moonColor: [0.5, 0.62, 0.92],
      },
      {
        time: 12,
        topColor: [0.28, 0.5, 0.86],
        midColor: [0.48, 0.68, 0.96],
        horizonColor: [0.9, 0.96, 1],
        neonColor: [0.88, 0.9, 1],
        moonColor: [0.34, 0.44, 0.62],
      },
      {
        time: 18,
        topColor: [0.2, 0.14, 0.34],
        midColor: [0.42, 0.18, 0.44],
        horizonColor: [0.96, 0.52, 0.24],
        neonColor: [0.94, 0.32, 0.18],
        moonColor: [0.56, 0.66, 0.96],
      },
      {
        time: 21,
        topColor: [0.22, 0.14, 0.34],
        midColor: [0.34, 0.18, 0.42],
        horizonColor: [0.58, 0.22, 0.32],
        neonColor: [0.48, 0.22, 0.58],
        moonColor: [0.7, 0.78, 1],
      },
    ],
  };
}
