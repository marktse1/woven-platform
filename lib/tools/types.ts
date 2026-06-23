// Shared types for the modular Forge tool system.
//
// A "tool" is either a first-party native module that lives in this repo
// (e.g. the Retopology studio) or a community-submitted hosted build that runs
// in a sandboxed iframe. Both are surfaced through the same registry so the
// tools hub and Forge picker read from one place.

export type ToolCategory =
  | "modeling"
  | "texturing"
  | "audio"
  | "utility"
  | "other";

export type ToolKind = "native" | "hosted";

export type ToolAccess = "everyone" | "creators" | "admin";

export type ToolDef = {
  slug: string;
  name: string;
  summary: string;
  icon: string;
  category: ToolCategory;
  kind: ToolKind;
  /** Who may open the tool. Defaults to "creators". */
  access?: ToolAccess;
  /** Native tools: in-app route to open. */
  href?: string;
  /** Hosted tools: iframe build location. */
  buildUrl?: string;
  entryFile?: string;
  engine?: string;
  /** Short accent color (hex) used for the card chrome. */
  accent?: string;
  /** Marks brand-new tools in the hub. */
  badge?: string;
};
