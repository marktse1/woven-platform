// Zip-slip / path-traversal guard for untrusted uploaded archives.
//
// Two layers, both mandatory:
//  1. validateZipEntries() — checks the archive's entry list (from `unzip -Z1`,
//     one path per line) BEFORE anything is extracted. Rejects any entry that
//     is absolute, contains a ".." path segment, or is otherwise suspicious.
//     Pure string logic, unit-testable without a sandbox.
//  2. validateExtractedSymlinks() — checks the output of `find <dir> -type l`
//     AFTER extraction. A zip can carry a symlink entry whose own path looks
//     innocent (no ".." in the entry name itself) but that points outside the
//     extraction root once resolved on disk — entry-name validation alone
//     can't catch that, so any symlink found post-extraction is treated as a
//     hard reject, not resolved/followed.
//
// Never weaken either check to a warning. A failure here means the whole
// upload is rejected.

export type ZipEntryViolation = {
  entry: string;
  reason: "absolute-path" | "parent-traversal" | "empty-entry";
};

export function validateZipEntries(entryListOutput: string): {
  ok: boolean;
  violations: ZipEntryViolation[];
  entryCount: number;
} {
  const lines = entryListOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const violations: ZipEntryViolation[] = [];

  for (const entry of lines) {
    if (entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry)) {
      violations.push({ entry, reason: "absolute-path" });
      continue;
    }
    const segments = entry.split(/[\\/]/);
    if (segments.some((seg) => seg === "..")) {
      violations.push({ entry, reason: "parent-traversal" });
      continue;
    }
    if (segments.some((seg) => seg.length === 0 && segments.length > 1)) {
      // Defends against oddities like "a//../b" collapsing unexpectedly in
      // some extractors — treat any empty path segment as suspicious.
      violations.push({ entry, reason: "empty-entry" });
    }
  }

  return { ok: violations.length === 0, violations, entryCount: lines.length };
}

export function validateExtractedSymlinks(findOutput: string): {
  ok: boolean;
  symlinks: string[];
} {
  const symlinks = findOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { ok: symlinks.length === 0, symlinks };
}
