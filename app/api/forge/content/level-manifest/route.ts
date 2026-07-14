import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifySaveToken } from "@/lib/forge/save-token";

// Public by default (returns only is_public levels). If a valid saveToken
// is passed as a query param, also includes that creator's own private
// levels — reuses the same short-lived token minted for the save route
// rather than inventing a second auth mechanism for one more read.
export async function GET(req: Request) {
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const url = new URL(req.url);
  const token = url.searchParams.get("saveToken");
  const verified = token ? verifySaveToken(token) : null;

  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/forge-content`;

  const query = admin.from("forge_levels").select("id, name, slug, storage_path, is_public, updated_at");
  const { data, error } = verified
    ? await query.or(`is_public.eq.true,clerk_user_id.eq.${verified.clerkUserId}`)
    : await query.eq("is_public", true);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const levels = (data ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    slug: l.slug,
    path: `${base}/${l.storage_path}`,
    updatedAt: l.updated_at,
  }));

  return Response.json({ levels });
}
