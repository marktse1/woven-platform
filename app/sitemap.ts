import type { MetadataRoute } from "next";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSiteUrl } from "@/lib/siteUrl";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/community`, changeFrequency: "daily", priority: 0.6 },
    { url: `${siteUrl}/creator`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/marketplace`, changeFrequency: "weekly", priority: 0.5 },
  ];

  const admin = getSupabaseAdmin();
  if (!admin) return staticRoutes;

  const [{ data: games }, { data: creators }] = await Promise.all([
    admin.from("games").select("slug, created_at").eq("status", "live"),
    admin.from("creator_profiles").select("handle, created_at").eq("status", "approved").not("handle", "is", null),
  ]);

  const gameRoutes: MetadataRoute.Sitemap = (games ?? []).map((g: { slug: string; created_at: string }) => ({
    url: `${siteUrl}/game/${g.slug}`,
    lastModified: new Date(g.created_at),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const studioRoutes: MetadataRoute.Sitemap = (creators ?? []).map((c: { handle: string; created_at: string }) => ({
    url: `${siteUrl}/studio/${c.handle}`,
    lastModified: new Date(c.created_at),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...gameRoutes, ...studioRoutes];
}
