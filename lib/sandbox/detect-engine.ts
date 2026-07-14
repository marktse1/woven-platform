// Best-effort engine detection for an uploaded/extracted web game build.
// This is a UX convenience to pre-fill the review UI — never a security
// boundary. Detection failing or being wrong doesn't affect what's allowed
// to happen to the upload; it only affects what label gets suggested.

export type DetectedEngine =
  | "three.js"
  | "playcanvas"
  | "godot-web"
  | "unity-webgl"
  | "phaser"
  | "custom-html5";

export type EngineDetectionResult = {
  engine: DetectedEngine;
  entryFile: string | null;
  confidence: "high" | "low";
  warnings: string[];
};

function findEntryFile(files: string[]): string | null {
  const candidates = files.filter((f) => f.toLowerCase().endsWith("index.html"));
  if (candidates.length === 0) return null;
  // Prefer the shallowest index.html (fewest path segments) — most likely
  // to be the real entry point rather than a nested asset/demo page.
  candidates.sort((a, b) => a.split("/").length - b.split("/").length);
  return candidates[0];
}

/**
 * @param files relative paths of every file in the extracted tree
 * @param readTextFile reads a text file's contents by relative path, or null if unreadable/binary/too large; injected so this stays unit-testable without a real sandbox
 */
export async function detectEngine(
  files: string[],
  readTextFile: (path: string) => Promise<string | null>,
): Promise<EngineDetectionResult> {
  const warnings: string[] = [];
  const entryFile = findEntryFile(files);
  if (!entryFile) {
    warnings.push("No index.html found in the archive — select an entry file manually.");
  }

  const lowerFiles = files.map((f) => f.toLowerCase());
  const entryHtml = entryFile ? await readTextFile(entryFile) : null;
  const haystack = (entryHtml ?? "").toLowerCase();

  const hasPck = lowerFiles.some((f) => f.endsWith(".pck"));
  const hasWasm = lowerFiles.some((f) => f.endsWith(".wasm"));
  const hasUnityLoader =
    lowerFiles.some((f) => /build\/.*\.loader\.js$/.test(f)) ||
    haystack.includes("unityloader") ||
    haystack.includes("createunityinstance");

  if (hasPck && hasWasm) {
    return { engine: "godot-web", entryFile, confidence: "high", warnings };
  }
  if (hasUnityLoader) {
    return { engine: "unity-webgl", entryFile, confidence: "high", warnings };
  }
  if (haystack.includes("playcanvas")) {
    return { engine: "playcanvas", entryFile, confidence: "high", warnings };
  }
  if (haystack.includes("phaser")) {
    return { engine: "phaser", entryFile, confidence: "high", warnings };
  }
  if (haystack.includes("three.module") || haystack.includes("three.min.js") || /\bthree\b/.test(haystack)) {
    return { engine: "three.js", entryFile, confidence: "low", warnings };
  }

  warnings.push("Could not confidently detect the engine from the archive contents — verify before publishing.");
  return { engine: "custom-html5", entryFile, confidence: "low", warnings };
}
