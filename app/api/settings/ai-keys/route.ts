import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { encryptSecret, hintFor } from "@/lib/keys/encryption";

const VALID_PROVIDERS = ["anthropic", "openai", "google"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data, error } = await admin
    .from("creator_api_keys")
    .select("provider, key_hint, model, updated_at")
    .eq("clerk_user_id", userId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ keys: data ?? [] });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { provider, apiKey, model } = body as { provider: Provider; apiKey: string; model?: string };
  if (!VALID_PROVIDERS.includes(provider)) return Response.json({ error: "Invalid provider" }, { status: 400 });
  if (!apiKey || apiKey.trim().length < 10) return Response.json({ error: "That doesn't look like a valid API key" }, { status: 400 });

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { error } = await admin.from("creator_api_keys").upsert(
    {
      clerk_user_id: userId,
      provider,
      encrypted_key: encryptSecret(apiKey.trim()),
      key_hint: hintFor(apiKey.trim()),
      model: model?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clerk_user_id,provider" },
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { provider } = body as { provider: Provider };
  if (!VALID_PROVIDERS.includes(provider)) return Response.json({ error: "Invalid provider" }, { status: 400 });

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { error } = await admin.from("creator_api_keys").delete().eq("clerk_user_id", userId).eq("provider", provider);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
