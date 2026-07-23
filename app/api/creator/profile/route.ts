import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Editing an existing creator profile after applying (app/api/creator/apply
// handles the initial application). Split into its own route with its own,
// narrower field whitelist so this path can never touch `status` or either
// Stripe field — those are only ever set by the apply route, the admin
// decide route, and the Stripe account.updated webhook, respectively.
export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: profile } = await admin
    .from("creator_profiles")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle<{ id: string }>();
  if (!profile) return Response.json({ error: "No creator profile" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { studio_name, about, links, country, team_size, engines, banner_pos_x, banner_pos_y } = body as {
    studio_name?: string;
    about?: string;
    links?: string;
    country?: string;
    team_size?: string;
    engines?: string[];
    banner_pos_x?: number;
    banner_pos_y?: number;
  };

  const patch: Record<string, unknown> = {};
  // studio_name is just a display label, safe to self-edit. handle is
  // deliberately NOT editable here — it's the live URL slug (/studio/{handle})
  // other pages and external bookmarks link to; changing it would break those.
  if (typeof studio_name === "string" && studio_name.trim()) patch.studio_name = studio_name.trim();
  if (typeof about === "string") patch.about = about.trim();
  if (typeof links === "string") patch.links = links.trim();
  if (typeof country === "string") patch.country = country.trim();
  if (typeof team_size === "string") patch.team_size = team_size.trim();
  if (Array.isArray(engines)) patch.engines = engines;
  if (typeof banner_pos_x === "number") patch.banner_pos_x = Math.max(0, Math.min(100, banner_pos_x));
  if (typeof banner_pos_y === "number") patch.banner_pos_y = Math.max(0, Math.min(100, banner_pos_y));

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const { error } = await admin.from("creator_profiles").update(patch).eq("id", profile.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
