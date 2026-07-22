import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Final step of the upload wizard (Part 6): records pricing on the games
// row and flips its most recent game_submissions row to pending_review if
// it isn't already (app/api/uploads/games/process already sets
// pending_review once the Sandbox pipeline succeeds — this route mainly
// exists so the creator can explicitly confirm/re-submit after reviewing
// their own draft, and to attach price/pass_included, which the process
// route doesn't know about).
export async function POST(req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { gameId } = await params;
  const body = await req.json().catch(() => ({}));
  const { priceCents, passIncluded, shortDescription, title, engine, changelog, tags } = body as {
    priceCents?: number;
    passIncluded?: boolean;
    shortDescription?: string;
    title?: string;
    engine?: string;
    changelog?: string;
    tags?: string[];
  };

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: profile } = await admin
    .from("creator_profiles")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string }>();
  if (!profile) return Response.json({ error: "No creator profile" }, { status: 403 });

  const { data: game } = await admin
    .from("games")
    .select("creator_id")
    .eq("id", gameId)
    .maybeSingle<{ creator_id: string }>();
  if (!game || game.creator_id !== profile.id) {
    return Response.json({ error: "Game not found or access denied" }, { status: 404 });
  }

  if (typeof priceCents === "number" || typeof passIncluded === "boolean" || shortDescription || title || Array.isArray(tags)) {
    const patch: Record<string, unknown> = {};
    if (typeof priceCents === "number" && priceCents >= 0) patch.price_cents = priceCents;
    if (typeof passIncluded === "boolean") patch.pass_included = passIncluded;
    if (shortDescription) patch.short_description = shortDescription;
    if (title) patch.title = title;
    if (Array.isArray(tags)) patch.tags = tags;
    await admin.from("games").update(patch).eq("id", gameId);
  }

  const { data: submission } = await admin
    .from("game_submissions")
    .select("id, status")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string }>();

  if (!submission) return Response.json({ error: "No submission found for this game — upload a build first" }, { status: 404 });

  if (engine || changelog) {
    const { data: sub } = await admin.from("game_submissions").select("build_id").eq("id", submission.id).maybeSingle<{ build_id: string | null }>();
    if (sub?.build_id) {
      const buildPatch: Record<string, unknown> = {};
      if (engine) buildPatch.engine = engine;
      if (changelog) buildPatch.changelog = changelog;
      await admin.from("game_builds").update(buildPatch).eq("id", sub.build_id);
    }
    if (engine) await admin.from("game_submissions").update({ engine }).eq("id", submission.id);
  }

  if (submission.status !== "pending_review") {
    if (submission.status !== "ready" && submission.status !== "draft") {
      // Still validating or already decided — nothing to do here.
      return Response.json({ ok: true, status: submission.status });
    }
    await admin.from("game_submissions").update({ status: "pending_review", updated_at: new Date().toISOString() }).eq("id", submission.id);
  }

  return Response.json({ ok: true, status: "pending_review" });
}
