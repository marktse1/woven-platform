import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifySaveToken } from "@/lib/forge/save-token";

// Authenticated via the short-lived saveToken minted by ForgeClient.tsx
// (lib/forge/save-token.ts), not Clerk cookies — the external Forge tool
// app runs cross-origin inside the iframe and has no access to Woven's
// session. This is the ONLY route that accepts saveToken as a credential.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { saveToken, levelId, name, slug, isPublic, data } = body as {
    saveToken?: string;
    levelId?: string;
    name?: string;
    slug?: string;
    isPublic?: boolean;
    data?: unknown;
  };

  if (!saveToken) return Response.json({ error: "saveToken required" }, { status: 401 });
  const verified = verifySaveToken(saveToken);
  if (!verified) return Response.json({ error: "Invalid or expired saveToken" }, { status: 401 });

  if (!name || data === undefined) {
    return Response.json({ error: "name and data are required" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  let id = levelId ?? null;
  if (id) {
    const { data: existing } = await admin
      .from("forge_levels")
      .select("clerk_user_id")
      .eq("id", id)
      .maybeSingle<{ clerk_user_id: string }>();
    if (existing && existing.clerk_user_id !== verified.clerkUserId) {
      return Response.json({ error: "You don't own this level" }, { status: 403 });
    }
  }
  if (!id) id = crypto.randomUUID();

  const storagePath = `levels/${id}.json`;
  const { error: upErr } = await admin.storage
    .from("forge-content")
    .upload(storagePath, new Blob([JSON.stringify(data)], { type: "application/json" }), {
      contentType: "application/json",
      upsert: true,
    });
  if (upErr) return Response.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  const { error: dbErr } = await admin.from("forge_levels").upsert({
    id,
    clerk_user_id: verified.clerkUserId,
    name,
    slug: slug ?? null,
    storage_path: storagePath,
    is_public: !!isPublic,
    updated_at: new Date().toISOString(),
  });
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 });

  return Response.json({ ok: true, levelId: id });
}
