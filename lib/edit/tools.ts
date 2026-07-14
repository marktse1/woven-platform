import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// Provider-agnostic tool specs for the in-browser AI code editor (Part 9).
// Each of the three provider adapters (lib/edit/providers/*.ts) wraps these
// into its own native tool-calling shape (Anthropic's betaTool, OpenAI's
// runTools function, Gemini's FunctionDeclaration) — the JSON Schema here
// is deliberately plain so it works unmodified across all three.
//
// write_file is the one tool that needs real gating: a content-hash
// staleness check, so a turn can't silently overwrite a file it never
// actually read. True pre-write human approval isn't practical inside one
// stateless request, so writes apply immediately and report a full
// before/after diff via onEdit(), which the calling route streams to the
// browser; the editor UI shows the diff and offers an undo.

const BUCKET = "game-builds";

export type EditEvent = { path: string; before: string | null; after: string };

export type EditToolSpec = {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  execute: (args: Record<string, unknown>) => Promise<string>;
};

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function createEditToolSpecs(
  admin: SupabaseClient,
  storagePrefix: string,
  onEdit?: (event: EditEvent) => void,
): EditToolSpec[] {
  const sourcePrefix = `${storagePrefix}/source`;

  const read_file: EditToolSpec = {
    name: "read_file",
    description:
      "Read a text file from the project's source tree. The result includes a content hash — pass it as expectedHash when calling write_file on the same path, so writes fail loudly if the file changed since you read it.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the project root, e.g. 'src/main.js'" } },
      required: ["path"],
      additionalProperties: false,
    },
    execute: async ({ path }) => {
      const { data, error } = await admin.storage.from(BUCKET).download(`${sourcePrefix}/${path}`);
      if (error || !data) return `Error: file not found at ${path}`;
      const text = await data.text();
      return `<hash>${hashContent(text)}</hash>\n<content>\n${text}\n</content>`;
    },
  };

  const list_files: EditToolSpec = {
    name: "list_files",
    description: "List files under a path prefix in the project's source tree.",
    parameters: {
      type: "object",
      properties: { prefix: { type: "string", description: "Path prefix, empty string for the project root" } },
      additionalProperties: false,
    },
    execute: async ({ prefix }) => {
      const { data, error } = await admin.storage.from(BUCKET).list(`${sourcePrefix}/${prefix ?? ""}`, { limit: 1000 });
      if (error) return `Error: ${error.message}`;
      return (data ?? []).map((f) => f.name).join("\n") || "(empty)";
    },
  };

  const search_files: EditToolSpec = {
    name: "search_files",
    description: "Search for a literal substring across every text file in the project's source tree.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    execute: async ({ query }) => {
      const { data } = await admin.storage.from(BUCKET).list(sourcePrefix, { limit: 1000 });
      const matches: string[] = [];
      for (const f of data ?? []) {
        if (!f.name) continue;
        const { data: blob } = await admin.storage.from(BUCKET).download(`${sourcePrefix}/${f.name}`);
        if (!blob) continue;
        const text = await blob.text().catch(() => null);
        if (text?.includes(query as string)) matches.push(f.name);
      }
      return matches.join("\n") || "No matches";
    },
  };

  const write_file: EditToolSpec = {
    name: "write_file",
    description:
      "Write a text file in the project's source tree, creating it if it doesn't exist. If the file already exists, pass expectedHash (from a prior read_file call) — the write is rejected if the file changed since then.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        expectedHash: { type: "string", description: "Content hash from the last read_file call on this path" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    execute: async ({ path, content, expectedHash }) => {
      const fullPath = `${sourcePrefix}/${path}`;
      const { data: existing } = await admin.storage.from(BUCKET).download(fullPath);
      const existingText = existing ? await existing.text() : null;
      if (existingText !== null) {
        const actualHash = hashContent(existingText);
        if (expectedHash && expectedHash !== actualHash) {
          return `Error: ${path} has changed since you last read it. Call read_file again before writing.`;
        }
      }
      const { error } = await admin.storage
        .from(BUCKET)
        .upload(fullPath, new Blob([content as string], { type: "text/plain" }), { upsert: true, contentType: "text/plain" });
      if (error) return `Error: ${error.message}`;
      onEdit?.({ path: path as string, before: existingText, after: content as string });
      return `Wrote ${path} (${(content as string).length} bytes)`;
    },
  };

  return [read_file, list_files, search_files, write_file];
}
