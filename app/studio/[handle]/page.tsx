import type { Metadata } from "next";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import StudioClient from "./StudioClient";

type MetaCreator = { studio_name: string | null; handle: string | null; about: string | null };

async function getMetaCreator(handle: string): Promise<MetaCreator | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data } = await admin
    .from("creator_profiles")
    .select("studio_name, handle, about")
    .eq("handle", decodeURIComponent(handle))
    .eq("status", "approved")
    .maybeSingle<MetaCreator>();
  return data ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const creator = await getMetaCreator(handle);
  if (!creator) return { title: "Studio not found" };

  const title = `${creator.studio_name ?? creator.handle} — Woven`;
  const description = creator.about ?? `Games by ${creator.studio_name ?? creator.handle} on Woven.`;
  const ogImage = `/studio/${handle}/opengraph-image`;

  return {
    title,
    description,
    openGraph: { title, description, images: [ogImage], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
  };
}

export default function StudioPage({ params }: { params: Promise<{ handle: string }> }) {
  return <StudioClient params={params} />;
}
