// Detects which PBR map a texture file is from its filename, following the
// suffix conventions used by common texture sources (Poliigon, ambientCG,
// Quixel, Substance exports, etc — e.g. "_albedo", "_normal-dx", "_rough").
// Filenames are split into tokens on "-"/"_"/"." so a token like "ao" only
// matches as a whole word, not as a substring of an unrelated word.

export type MapType = "albedo" | "normal" | "roughness" | "metallic" | "ao" | "height" | "emissive";

const KEYWORDS: Record<MapType, string[]> = {
  albedo: ["albedo", "basecolor", "diffuse", "diff", "color", "col"],
  normal: ["normal", "nrm", "norm"],
  roughness: ["roughness", "rough", "rgh"],
  metallic: ["metallic", "metalness", "metal"],
  ao: ["ao", "occlusion", "occ", "ambientocclusion"],
  height: ["height", "displacement", "disp", "bump"],
  emissive: ["emissive", "emission", "emit"],
};

const SKIP_TOKENS = new Set(["preview", "thumb", "thumbnail"]);
// Anything not explicitly marked DirectX-convention is treated as OpenGL —
// three.js's own convention, and the common default when a set doesn't
// bother distinguishing (only DirectX/Unreal exports usually mark it).
const DIRECTX_TOKENS = new Set(["dx", "directx"]);

function tokenize(filename: string): string[] {
  const stem = filename.replace(/\.[^.]+$/, "");
  return stem.toLowerCase().split(/[-_.\s]+/).filter(Boolean);
}

export function detectMap(filename: string): { mapType: MapType | null; normalConvention?: "directx" | "opengl" } {
  const tokens = tokenize(filename);

  if (tokens.some((t) => SKIP_TOKENS.has(t))) return { mapType: null };

  for (const [mapType, keywords] of Object.entries(KEYWORDS) as [MapType, string[]][]) {
    if (!tokens.some((t) => keywords.includes(t))) continue;
    if (mapType !== "normal") return { mapType };
    const normalConvention: "directx" | "opengl" = tokens.some((t) => DIRECTX_TOKENS.has(t))
      ? "directx"
      : "opengl"; // default when unmarked (e.g. no -dx/-ogl suffix at all)
    return { mapType, normalConvention };
  }

  return { mapType: null };
}
