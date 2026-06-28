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
  {
    slug: "substance-weaver",
    name: "Mesh Painter",
    summary: "Paint albedo and relief detail directly onto a model's UVs, in real time, on the actual 3D mesh.",
    icon: "🎨",
    category: "texturing",
    kind: "native",
    access: "creators",
    href: "/tools/substance-weaver",
    accent: "#56a6e8",
    badge: "New",
  },
  {
    slug: "shaderade",
    name: "Shaderade",
    summary: "Visual node graph shader editor. Wire together inputs, math, and textures — export ready-to-paste GLSL for Three.js, Babylon.js, or PlayCanvas.",
    icon: "🌈",
    category: "utility",
    kind: "native",
    access: "creators",
    href: "/tools/shaderade",
    accent: "#e8875a",
    badge: "New",
  },
  {
    slug: "mesh-sculptor",
    name: "Mesh Sculptor",
    summary: "Sculpt and refine mesh geometry with brush-based vertex displacement. Push, pull, smooth, and flatten directly on your 3D model.",
    icon: "🫧",
    category: "modeling",
    kind: "native",
    access: "creators",
    href: "/tools/mesh-sculptor",
    accent: "#c47be8",
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
