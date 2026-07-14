import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createEditToolSpecs, type EditEvent } from "@/lib/edit/tools";
import { runProviderChat, DEFAULT_MODEL, type Provider, type ChatTurn } from "@/lib/edit/providers";
import { decryptSecret } from "@/lib/keys/encryption";

// In-browser AI code editor's chat endpoint. Uses the creator's own BYOK
// key (creator_api_keys, 0016) if they've configured one — checked in
// provider priority anthropic > openai > google, since that's also the
// build order these adapters were verified in — falling back to the
// platform's own ANTHROPIC_API_KEY so the feature still works out of the
// box for creators who haven't set up a key. This is the cost lever: every
// BYOK session bills to the creator's own account, not Woven's.
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ gameId: string; version: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { gameId, version } = await params;
  const body = await req.json();
  const { messages } = body as { messages: ChatTurn[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: profile } = await admin
    .from("creator_profiles")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string }>();
  if (!profile) return Response.json({ error: "No creator profile" }, { status: 403 });

  const { data: game } = await admin.from("games").select("creator_id").eq("id", gameId).maybeSingle<{ creator_id: string }>();
  if (!game || game.creator_id !== profile.id) {
    return Response.json({ error: "Game not found or access denied" }, { status: 404 });
  }

  const { data: build } = await admin
    .from("game_builds")
    .select("id, storage_prefix, source_kind")
    .eq("game_id", gameId)
    .eq("version", version)
    .maybeSingle<{ id: string; storage_prefix: string; source_kind: string }>();
  if (!build) return Response.json({ error: "Build not found" }, { status: 404 });
  if (build.source_kind !== "buildable") {
    return Response.json({ error: "This build has no editable source tree" }, { status: 400 });
  }

  // Resolve provider + key: creator's own BYOK key first (any configured
  // provider, priority anthropic > openai > google), else the platform key.
  const { data: byokKeys } = await admin
    .from("creator_api_keys")
    .select("provider, encrypted_key, model")
    .eq("clerk_user_id", userId);
  const byPriority = (["anthropic", "openai", "google"] as Provider[])
    .map((p) => byokKeys?.find((k) => k.provider === p))
    .find(Boolean);

  let provider: Provider;
  let apiKey: string;
  let model: string;
  if (byPriority) {
    provider = byPriority.provider as Provider;
    apiKey = decryptSecret(byPriority.encrypted_key);
    model = byPriority.model || DEFAULT_MODEL[provider];
  } else {
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: "No AI key configured — add your own key in Settings, or ask the site owner to configure one." }, { status: 503 });
    }
    provider = "anthropic";
    apiKey = process.env.ANTHROPIC_API_KEY;
    model = DEFAULT_MODEL.anthropic;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        const tools = createEditToolSpecs(admin, build.storage_prefix, (edit: EditEvent) => send({ type: "edit", ...edit }));

        await runProviderChat(provider, {
          apiKey,
          model,
          systemPrompt:
            "You are an in-browser coding assistant editing a web game's source tree. Use list_files/search_files to explore, read_file before write_file on any existing file, and keep edits minimal and scoped to what the user asked for.",
          history: messages,
          tools,
          onEvent: (event) => {
            if (event.type === "error") send({ type: "error", error: event.error });
            else send(event);
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[edit/chat] error:", msg, e);
        send({ type: "error", error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "X-Content-Type-Options": "nosniff" } });
}
