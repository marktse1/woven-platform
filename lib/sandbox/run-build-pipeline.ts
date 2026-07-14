import { Sandbox } from "@vercel/sandbox";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateZipEntries, validateExtractedSymlinks } from "./zip-safety";
import { detectEngine, type DetectedEngine } from "./detect-engine";

// Shared extraction/build pipeline used by both "process a fresh upload"
// (app/api/uploads/games/process, app/api/uploads/tools/process) and
// "rebuild after an AI/human edit" (app/api/games/[gameId]/builds/[buildId]/rebuild).
//
// Runs entirely inside an ephemeral Vercel Sandbox microVM, never on the
// calling Vercel Function's own filesystem — the archive is untrusted input.
//
// Auth: relies on Vercel OIDC (VERCEL_OIDC_TOKEN) which is automatic in
// production on Vercel. For local dev, run `vercel link && vercel env pull`
// first so the SDK can find a token.

const MIME_BY_EXT: Record<string, string> = {
  html: "text/html", htm: "text/html", css: "text/css", js: "application/javascript",
  mjs: "application/javascript", json: "application/json", wasm: "application/wasm",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
  mp4: "video/mp4", webm: "video/webm",
  ttf: "font/ttf", woff: "font/woff", woff2: "font/woff2", otf: "font/otf",
  glb: "model/gltf-binary", gltf: "model/gltf+json",
  pck: "application/octet-stream", data: "application/octet-stream",
  txt: "text/plain", xml: "application/xml",
};

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

async function listFiles(sandbox: Sandbox, dir: string): Promise<string[]> {
  const result = await sandbox.runCommand("find", [dir, "-type", "f"]);
  if (result.exitCode !== 0) throw new Error(`find failed: ${await result.stderr()}`);
  const stdout = await result.stdout();
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((p) => p.slice(dir.length + 1)); // relative to dir
}

async function uploadTree(
  admin: SupabaseClient,
  bucket: string,
  sandbox: Sandbox,
  localDir: string,
  storagePrefix: string,
  concurrency = 8,
): Promise<{ fileCount: number; totalBytes: number }> {
  const relPaths = await listFiles(sandbox, localDir);
  let totalBytes = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < relPaths.length) {
      const idx = cursor++;
      const relPath = relPaths[idx];
      const buf = await sandbox.readFileToBuffer({ path: `${localDir}/${relPath}` });
      if (!buf) continue;
      totalBytes += buf.byteLength;
      const { error } = await admin.storage
        .from(bucket)
        .upload(`${storagePrefix}/${relPath}`, buf, { contentType: mimeFor(relPath), upsert: true });
      if (error) throw new Error(`Upload failed for ${relPath}: ${error.message}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, relPaths.length) }, worker));
  return { fileCount: relPaths.length, totalBytes };
}

export type BuildPipelineInput = {
  admin: SupabaseClient;
  bucket: string; // e.g. "game-builds"
  zipStoragePath: string; // path inside `bucket` to the uploaded zip (upload mode only)
  storagePrefix: string; // e.g. "{gameId}/{version}" — dist/ and source/ land under this
  mode: "upload" | "rebuild";
  /** Required for rebuild mode: the source/ tree from the previous build, already containing edits. */
  sourceStoragePrefix?: string;
  /** Required for rebuild mode: the build command recorded at original upload time. */
  buildCommand?: string;
  onProgress?: (stage: string, progress: number) => void;
};

export type BuildPipelineResult =
  | {
      ok: true;
      engine: DetectedEngine;
      entryFile: string;
      fileCount: number;
      totalBytes: number;
      sourceKind: "static" | "buildable";
      buildCommand: string | null;
      warnings: string[];
    }
  | { ok: false; error: string; warnings: string[] };

export async function runBuildPipeline(input: BuildPipelineInput): Promise<BuildPipelineResult> {
  const { admin, bucket, storagePrefix, mode, onProgress } = input;
  const warnings: string[] = [];
  const progress = (stage: string, p: number) => onProgress?.(stage, p);

  progress("starting", 0.02);
  const sandbox = await Sandbox.create({
    runtime: "node24",
    timeout: 10 * 60 * 1000, // 10 minutes — npm install + a real build can take a while
    networkPolicy: "allow-all", // npm install needs registry access; tightened per-project later if needed
  });

  try {
    const extractDir = "/vercel/sandbox/extracted";
    await sandbox.mkDir(extractDir);

    if (mode === "upload") {
      progress("downloading", 0.1);
      const { data: signed, error: signErr } = await admin.storage
        .from(bucket)
        .createSignedUrl(input.zipStoragePath, 600);
      if (signErr || !signed) return { ok: false, error: "Could not sign the uploaded archive for download", warnings };

      const dl = await sandbox.runCommand("curl", ["-fsSL", "-o", "/vercel/sandbox/incoming.zip", signed.signedUrl]);
      if (dl.exitCode !== 0) return { ok: false, error: `Failed to download archive: ${await dl.stderr()}`, warnings };

      progress("validating", 0.25);
      // Layer 1: validate every entry path before extracting anything.
      const listResult = await sandbox.runCommand("unzip", ["-Z1", "/vercel/sandbox/incoming.zip"]);
      if (listResult.exitCode !== 0) {
        return { ok: false, error: "Uploaded file is not a valid zip archive", warnings };
      }
      const entryCheck = validateZipEntries(await listResult.stdout());
      if (!entryCheck.ok) {
        return {
          ok: false,
          error: `Archive contains unsafe paths: ${entryCheck.violations.map((v) => `${v.entry} (${v.reason})`).join(", ")}`,
          warnings,
        };
      }
      if (entryCheck.entryCount === 0) {
        return { ok: false, error: "Archive is empty", warnings };
      }

      progress("extracting", 0.35);
      const extract = await sandbox.runCommand("unzip", ["-q", "/vercel/sandbox/incoming.zip", "-d", extractDir]);
      if (extract.exitCode !== 0) return { ok: false, error: `Extraction failed: ${await extract.stderr()}`, warnings };

      // Layer 2: post-extraction symlink check — catches zip-slip vectors
      // entry-name validation alone can't (a symlink entry pointing outside
      // the tree once resolved on disk, even with an innocent-looking name).
      const findLinks = await sandbox.runCommand("find", [extractDir, "-type", "l"]);
      const symlinkCheck = validateExtractedSymlinks(await findLinks.stdout());
      if (!symlinkCheck.ok) {
        return { ok: false, error: `Archive contains symlinks, which are not allowed: ${symlinkCheck.symlinks.join(", ")}`, warnings };
      }
    } else {
      // Rebuild mode: pull the existing source/ tree (already containing edits) instead of a fresh zip.
      if (!input.sourceStoragePrefix) return { ok: false, error: "sourceStoragePrefix required for rebuild", warnings };
      const { data: files } = await admin.storage.from(bucket).list(input.sourceStoragePrefix, { limit: 10000 });
      for (const f of files ?? []) {
        const { data: blob } = await admin.storage.from(bucket).download(`${input.sourceStoragePrefix}/${f.name}`);
        if (!blob) continue;
        const buf = Buffer.from(await blob.arrayBuffer());
        await sandbox.writeFiles([{ path: `${extractDir}/${f.name}`, content: buf }]);
      }
    }

    progress("detecting-engine", 0.5);
    const files = await listFiles(sandbox, extractDir);
    if (files.length === 0) return { ok: false, error: "Archive extracted to zero files", warnings };

    const readTextFile = async (relPath: string): Promise<string | null> => {
      try {
        const buf = await sandbox.readFileToBuffer({ path: `${extractDir}/${relPath}` });
        if (!buf || buf.byteLength > 200_000) return null;
        return buf.toString("utf8");
      } catch {
        return null;
      }
    };

    let sourceKind: "static" | "buildable" = "static";
    let buildCommand: string | null = null;
    let publishDir = extractDir;

    const hasPackageJson = files.includes("package.json");
    if (hasPackageJson) {
      const pkgText = await readTextFile("package.json");
      let hasBuildScript = false;
      try {
        const pkg = pkgText ? JSON.parse(pkgText) : null;
        hasBuildScript = !!pkg?.scripts?.build;
      } catch {
        hasBuildScript = false;
      }
      if (hasBuildScript || mode === "rebuild") {
        sourceKind = "buildable";
        buildCommand = mode === "rebuild" ? (input.buildCommand ?? "npm run build") : "npm run build";

        const hasLockfile = files.includes("package-lock.json");
        const install = await sandbox.runCommand({ cmd: "npm", args: hasLockfile ? ["ci"] : ["install"], cwd: extractDir });
        if (install.exitCode !== 0) {
          return { ok: false, error: `npm install failed: ${await install.stderr()}`, warnings };
        }

        const build = await sandbox.runCommand({ cmd: "npm", args: ["run", "build"], cwd: extractDir });
        if (build.exitCode !== 0) {
          return { ok: false, error: `Build command failed: ${await build.stderr()}`, warnings };
        }

        const candidates = ["dist", "build", "out"];
        let found: string | null = null;
        for (const c of candidates) {
          const exists = await sandbox.fs.exists(`${extractDir}/${c}`);
          if (exists) {
            found = `${extractDir}/${c}`;
            break;
          }
        }
        if (!found) {
          return { ok: false, error: "Build succeeded but no output directory (dist/build/out) was found", warnings };
        }
        publishDir = found;
      }
    }

    progress("uploading", 0.75);
    // For buildable projects, also persist the pristine (pre-build) source
    // tree under source/ — this is what the AI editor (Part 9) reads/writes.
    if (sourceKind === "buildable") {
      const sourceUpload = await uploadTree(admin, bucket, sandbox, extractDir, `${storagePrefix}/source`);
      if (sourceUpload.fileCount === 0) warnings.push("Source tree upload produced zero files");
    }

    const dist = await uploadTree(admin, bucket, sandbox, publishDir, `${storagePrefix}/dist`);

    const publishFiles = await listFiles(sandbox, publishDir);
    const detection = await detectEngine(publishFiles, async (relPath) => {
      try {
        const buf = await sandbox.readFileToBuffer({ path: `${publishDir}/${relPath}` });
        if (!buf || buf.byteLength > 200_000) return null;
        return buf.toString("utf8");
      } catch {
        return null;
      }
    });
    warnings.push(...detection.warnings);

    if (!detection.entryFile) {
      return { ok: false, error: "No index.html found — an entry file must be selected manually", warnings };
    }

    progress("finalizing", 0.9);
    return {
      ok: true,
      engine: detection.engine,
      entryFile: detection.entryFile,
      fileCount: dist.fileCount,
      totalBytes: dist.totalBytes,
      sourceKind,
      buildCommand,
      warnings,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), warnings };
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
