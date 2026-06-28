import { getSupabaseAdmin } from "@/lib/supabase-admin";

// POST — Forge worker uploads a processed GLB here.
// Authenticated with x-worker-secret header (same as the jobs route).
// Accepts multipart form: fields `userId` + `name`, file field `glb`.
// Returns { assetId } on success.

function authorized(request: Request): boolean {
  const secret = process.env.RETOPO_WORKER_SECRET;
  if (!secret) return false;
  return request.headers.get("x-worker-secret") === secret;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }

  const form = await request.formData();
  const userId = form.get("userId") as string | null;
  const name = (form.get("name") as string | null) ?? "retopo-output.glb";
  const glbFile = form.get("glb") as File | null;

  if (!userId || !glbFile) {
    return Response.json({ error: "userId and glb are required" }, { status: 400 });
  }

  const bytes = new Uint8Array(await glbFile.arrayBuffer());
  const id = crypto.randomUUID();
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/${id}-${safeName}`;

  const { error: upErr } = await admin.storage
    .from("creator-assets")
    .upload(path, bytes, { contentType: "model/gltf-binary", upsert: false });
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  const { data, error } = await admin
    .from("creator_assets")
    .insert({
      id,
      clerk_user_id: userId,
      name,
      kind: "model",
      format: "glb",
      visibility: "private",
      storage_path: path,
      file_bytes: bytes.byteLength,
      meta: { source: "forge-worker" },
    })
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ assetId: data.id });
}
