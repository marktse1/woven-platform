// Joins a game/tool build's base URL with its entry file, the same way
// app/forge/ForgeClient.tsx already does for launching platform tools —
// game_builds and platform_tool_builds share the same
// {base}/{entryFile} convention (see 0015_game_builds_bucket_policy.sql).
export function joinBuildUrl(base: string, entryFile: string): string {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return new URL(entryFile, normalizedBase).toString();
}
