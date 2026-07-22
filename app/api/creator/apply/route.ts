import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// Server-mediated replacement for app/creator/page.tsx's previous direct
// supabase.from("creator_profiles").upsert(...) call — that table has no
// RLS write policy at all now (0026_creator_profiles_rls.sql), so every
// write goes through routes like this one instead. Explicit field
// whitelist below — status is only ever 'pending' or 'approved' (when the
// platform's auto-approve setting is on), never settable to anything else
// from here, and stripe_account_id/stripe_charges_enabled are never
// touched by this route at all (only app/api/stripe/connect/onboard and
// the account.updated webhook set those).
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { studio_name, handle, country, team_size, about, links, engines } = body as {
    studio_name?: string;
    handle?: string;
    country?: string;
    team_size?: string;
    about?: string;
    links?: string;
    engines?: string[];
  };

  if (!studio_name?.trim() || !handle?.trim() || !about?.trim()) {
    return Response.json({ error: "Studio name, public handle, and studio description are required." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ error: "Storage not configured" }, { status: 503 });

  const { data: setting } = await admin
    .from("platform_settings")
    .select("value")
    .eq("key", "auto_approve_creators")
    .maybeSingle<{ value: unknown }>();
  const autoApprove = setting?.value === true;

  const { error } = await admin.from("creator_profiles").upsert(
    {
      clerk_user_id: userId,
      studio_name: studio_name.trim(),
      handle: handle.trim(),
      status: autoApprove ? "approved" : "pending",
      country: country?.trim() ?? "",
      team_size: team_size?.trim() ?? "",
      about: about.trim(),
      links: links?.trim() ?? "",
      engines: engines ?? [],
    },
    { onConflict: "clerk_user_id" },
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, autoApprove });
}
