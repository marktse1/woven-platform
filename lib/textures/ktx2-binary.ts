// Resolves the "ktx" CLI (KTX-Software's unified CLI, `ktx create`/`ktx
// extract`) onto PATH before any @gltf-transform/cli transform that shells
// out to it runs.
//
// - Linux (Vercel): prepend the vendored .vendor/ktx-software/linux-x64/bin
//   directory (provisioned by scripts/provision-ktx.mjs at install time) to
//   process.env.PATH. Its lib/libktx.so.4 sibling resolves via the binary's
//   own $ORIGIN/../lib rpath — no LD_LIBRARY_PATH needed.
// - Everywhere else (local macOS dev): rely on a one-time manual install of
//   the official signed .pkg from the KTX-Software GitHub releases, which
//   puts `ktx` on the standard system PATH. See AGENTS.md.
//
// child_process.spawn("ktx", ...) inside @gltf-transform/cli resolves the
// binary via PATH only — there's no option to pass an absolute path through
// its API — so this PATH setup is the only lever available.

import { accessSync, constants, existsSync } from "node:fs";
import { join } from "node:path";
import type { ILogger } from "@gltf-transform/core";
import { checkKTXSoftware } from "@gltf-transform/cli";

const VENDORED_BIN_DIR = join(process.cwd(), ".vendor", "ktx-software", "linux-x64", "bin");

let pathPrepared = false;

function prependVendoredPathOnLinux(): void {
  if (pathPrepared || process.platform !== "linux") {
    pathPrepared = true;
    return;
  }

  const vendoredKtx = join(VENDORED_BIN_DIR, "ktx");
  if (!existsSync(vendoredKtx)) {
    // Not provisioned — let checkKTXSoftware's own "not found" error surface below.
    pathPrepared = true;
    return;
  }

  accessSync(vendoredKtx, constants.X_OK); // throws if not executable

  const currentPath = process.env.PATH ?? "";
  if (!currentPath.split(":").includes(VENDORED_BIN_DIR)) {
    process.env.PATH = `${VENDORED_BIN_DIR}:${currentPath}`;
  }
  pathPrepared = true;
}

/**
 * Ensures the `ktx` CLI is resolvable on PATH, throwing a clear, actionable
 * error otherwise. Call this before any toktx()/ktxdecompress() transform.
 */
export async function ensureKtxOnPath(logger: ILogger): Promise<void> {
  prependVendoredPathOnLinux();

  try {
    await checkKTXSoftware(logger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint =
      process.platform === "linux"
        ? `Expected a vendored binary at ${join(VENDORED_BIN_DIR, "ktx")}. ` +
          "Run 'npm install' to provision it (scripts/provision-ktx.mjs)."
        : "Install the KTX-Software 'ktx' CLI locally (one-time manual step) — see AGENTS.md.";
    throw new Error(`${message}\n${hint}`);
  }
}
