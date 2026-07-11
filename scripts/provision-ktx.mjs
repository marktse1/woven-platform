// Downloads and vendors the KTX-Software "ktx" CLI for Linux x86_64 (Vercel's
// Node.js Functions run on Amazon Linux, x86_64) so lib/textures/ktx2.ts and
// lib/textures/ktx2-decode.ts can shell out to it via PATH.
//
// No-ops on every other platform/arch (i.e. every local dev machine) — for
// macOS, install the official signed .pkg from the KTX-Software GitHub
// releases page once and it'll be found on the system PATH automatically.
// See AGENTS.md for the manual install step.
//
// Safe to run repeatedly: skips the download if already provisioned.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, chmodSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const KTX_VERSION = "4.4.2";
const ASSET_NAME = `KTX-Software-${KTX_VERSION}-Linux-x86_64.tar.bz2`;
const DOWNLOAD_URL = `https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}/${ASSET_NAME}`;
// Computed once against the real published asset — see the plan/PR that added
// this script for provenance. Update deliberately when bumping KTX_VERSION.
const EXPECTED_SHA256 = "a8781bad05f9624edbf910b7f258cd0a4ba7d3e63b49ecc0a0ab440bf6a0a245";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const vendorDir = join(repoRoot, ".vendor", "ktx-software", "linux-x64");
const binPath = join(vendorDir, "bin", "ktx");

async function main() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    console.log(
      `[provision-ktx] skipping vendor download on ${process.platform}/${process.arch}. ` +
      "Install the KTX-Software 'ktx' CLI manually for local dev — see AGENTS.md.",
    );
    return;
  }

  if (existsSync(binPath)) {
    console.log(`[provision-ktx] already provisioned at ${binPath}, skipping.`);
    return;
  }

  console.log(`[provision-ktx] downloading ${ASSET_NAME}…`);
  const res = await fetch(DOWNLOAD_URL);
  if (!res.ok) {
    throw new Error(`[provision-ktx] download failed: HTTP ${res.status} ${res.statusText}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());

  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== EXPECTED_SHA256) {
    throw new Error(
      `[provision-ktx] checksum mismatch for ${ASSET_NAME}.\n` +
      `  expected: ${EXPECTED_SHA256}\n` +
      `  actual:   ${actualSha256}\n` +
      "Refusing to install a binary that doesn't match the pinned checksum.",
    );
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "provision-ktx-"));
  try {
    const tarballPath = join(tmpDir, ASSET_NAME);
    writeFileSync(tarballPath, bytes);

    console.log("[provision-ktx] extracting…");
    execFileSync("tar", ["-xjf", tarballPath, "-C", tmpDir]);

    const extractedRoot = join(tmpDir, `KTX-Software-${KTX_VERSION}-Linux-x86_64`);
    const srcBin = join(extractedRoot, "bin", "ktx");
    const srcLib = join(extractedRoot, "lib", `libktx.so.${KTX_VERSION}`);
    if (!existsSync(srcBin) || !existsSync(srcLib)) {
      throw new Error(
        `[provision-ktx] expected files not found after extraction (srcBin=${srcBin} exists=${existsSync(srcBin)}, ` +
        `srcLib=${srcLib} exists=${existsSync(srcLib)}) — the release layout may have changed.`,
      );
    }

    mkdirSync(join(vendorDir, "bin"), { recursive: true });
    mkdirSync(join(vendorDir, "lib"), { recursive: true });

    copyFileSync(srcBin, binPath);
    chmodSync(binPath, 0o755);

    // ktx's rpath is $ORIGIN/../lib — vendor both the real file and the
    // .so.4 name the dynamic linker actually looks up (SONAME), so it
    // resolves regardless of which name ldopen uses.
    const dstLibReal = join(vendorDir, "lib", `libktx.so.${KTX_VERSION}`);
    const dstLibSoname = join(vendorDir, "lib", "libktx.so.4");
    copyFileSync(srcLib, dstLibReal);
    copyFileSync(srcLib, dstLibSoname);

    console.log(`[provision-ktx] provisioned ${binPath}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
