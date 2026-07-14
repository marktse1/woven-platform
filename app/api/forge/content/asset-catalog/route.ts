import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Public, unauthenticated — the external Forge tool app fetches this
// cross-origin at runtime (VITE_ASSET_CATALOG_URL). No forge_assets table
// query needed for v1: just list what's actually in Storage under assets/.
// Add DB-backed metadata (forge_assets, 0011) later only if the tool needs
// more than filename/path (category, thumbnails, etc.).
export async function GET() {
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data, error } = await admin.storage.from("forge-content").list("assets", { limit: 1000 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/forge-content/assets`;
  const assets = (data ?? [])
    .filter((f) => f.name && !f.name.startsWith("."))
    .map((f) => ({ name: f.name, path: `${base}/${f.name}` }));

  return Response.json({ assets });
}
