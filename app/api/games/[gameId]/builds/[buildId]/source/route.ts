import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import crypto from "node:crypto";

// Direct file-tree browsing + manual save for the in-browser editor UI
// (app/edit/[gameId]/[version]/page.tsx) — separate from the AI chat route
// (Part 9's Tool Runner), which edits the same source/ tree via tools
// instead of direct HTTP calls. Same bucket/prefix convention, same
// staleness-check semantics on write as lib/edit/tools.ts's write_file.
const BUCKET = "game-builds";

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function getSourcePrefix(admin: ReturnType<typeof getSupabaseAdmin>, userId: string, gameId: string, buildId: string) {
  const { data: profile } = await admin!
    .from("creator_profiles")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string }>();
  if (!profile) return { error: "No creator profile", status: 403 } as const;

  const { data: game } = await admin!.from("games").select("creator_id").eq("id", gameId).maybeSingle<{ creator_id: string }>();
  if (!game || game.creator_id !== profile.id) return { error: "Game not found or access denied", status: 404 } as const;

  const { data: build } = await admin!
    .from("game_builds")
    .select("storage_prefix, source_kind")
    .eq("id", buildId)
    .eq("game_id", gameId)
    .maybeSingle<{ storage_prefix: string; source_kind: string }>();
  if (!build) return { error: "Build not found", status: 404 } as const;
  if (build.source_kind !== "buildable") return { error: "This build has no editable source tree", status: 400 } as const;

  return { sourcePrefix: `${build.storage_prefix}/source` } as const;
}

export async function GET(req: Request, { params }: { params: Promise<{ gameId: string; buildId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { gameId, buildId } = await params;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const ctx = await getSourcePrefix(admin, userId, gameId, buildId);
  if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });

  const url = new URL(req.url);
  const path = url.searchParams.get("path");

  if (path) {
    const { data, error } = await admin.storage.from(BUCKET).download(`${ctx.sourcePrefix}/${path}`);
    if (error || !data) return Response.json({ error: "File not found" }, { status: 404 });
    const content = await data.text();
    return Response.json({ path, content, hash: hashContent(content) });
  }

  const { data, error } = await admin.storage.from(BUCKET).list(ctx.sourcePrefix, { limit: 1000 });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ files: (data ?? []).map((f) => f.name).filter(Boolean) });
}

export async function POST(req: Request, { params }: { params: Promise<{ gameId: string; buildId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { gameId, buildId } = await params;
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const ctx = await getSourcePrefix(admin, userId, gameId, buildId);
  if ("error" in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });

  const body = await req.json();
  const { path, content, expectedHash } = body as { path: string; content: string; expectedHash?: string };
  if (!path || content === undefined) return Response.json({ error: "path and content required" }, { status: 400 });

  const fullPath = `${ctx.sourcePrefix}/${path}`;
  const { data: existing } = await admin.storage.from(BUCKET).download(fullPath);
  const existingText = existing ? await existing.text() : null;
  if (existingText !== null && expectedHash && hashContent(existingText) !== expectedHash) {
    return Response.json({ error: "File changed since you last loaded it — reload before saving" }, { status: 409 });
  }

  const { error } = await admin.storage
    .from(BUCKET)
    .upload(fullPath, new Blob([content], { type: "text/plain" }), { upsert: true, contentType: "text/plain" });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, hash: hashContent(content) });
}
