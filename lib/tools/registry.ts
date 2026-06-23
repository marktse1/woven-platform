import type { ToolDef } from "./types";

// ---------------------------------------------------------------------------
// Native (first-party) tools — add a tool by appending one entry here.
// Each native tool owns a route under /tools/<slug>.
// ---------------------------------------------------------------------------
export const NATIVE_TOOLS: ToolDef[] = [
  {
    slug: "retopology",
    name: "Mesh Loom",
    summary:
      "Upload a high-res GLB and generate a game-ready low-poly model — adaptive density, edgeloops for characters, and hi→lo map baking.",
    icon: "🔻",
    category: "modeling",
    kind: "native",
    access: "creators",
    href: "/tools/retopology",
    accent: "#56a6e8",
    badge: "New",
  },
];

// ---------------------------------------------------------------------------
// Hosted tools approved through the submission flow live in the
// `tool_submissions` table (status = 'approved'). They are merged in at
// runtime by mergeHostedTools().
// ---------------------------------------------------------------------------
export type ApprovedHostedTool = {
  slug: string;
  name: string;
  summary: string | null;
  icon: string | null;
  category: ToolDef["category"];
  build_url: string | null;
  entry_file: string | null;
  engine: string | null;
};

export function mergeHostedTools(approved: ApprovedHostedTool[]): ToolDef[] {
  const hosted: ToolDef[] = approved
    .filter((row) => !!row.build_url)
    .map((row) => ({
      slug: row.slug,
      name: row.name,
      summary: row.summary ?? "Community tool",
      icon: row.icon ?? "🧩",
      category: row.category ?? "utility",
      kind: "hosted",
      access: "creators",
      buildUrl: row.build_url ?? undefined,
      entryFile: row.entry_file ?? "index.html",
      engine: row.engine ?? undefined,
      accent: "#7bc24a",
    }));

  // Native tools take precedence over a same-slug hosted submission.
  const nativeSlugs = new Set(NATIVE_TOOLS.map((t) => t.slug));
  return [...NATIVE_TOOLS, ...hosted.filter((t) => !nativeSlugs.has(t.slug))];
}

export function getNativeTool(slug: string): ToolDef | undefined {
  return NATIVE_TOOLS.find((t) => t.slug === slug);
}
