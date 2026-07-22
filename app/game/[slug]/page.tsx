import type { Metadata } from "next";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getSiteUrl } from "@/lib/siteUrl";
import GameDetailClient from "./GameDetailClient";

type MetaGame = {
  title: string;
  short_description: string | null;
  price_cents: number;
  rating: number | null;
  creator_profiles: { studio_name: string | null } | null;
};

// Separate, minimal, read-only fetch just for metadata — deliberately not
// touching GameDetailClient's own data-fetching logic at all, since that's
// already been worked on and fixed multiple times this session.
async function getMetaGame(slug: string): Promise<MetaGame | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data } = await admin
    .from("games")
    .select("title, short_description, price_cents, rating, creator_profiles(studio_name)")
    .eq("slug", slug)
    .eq("status", "live")
    .maybeSingle<MetaGame>();
  return data ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const game = await getMetaGame(slug);
  if (!game) return { title: "Game not found" };

  const title = game.creator_profiles?.studio_name ? `${game.title} by ${game.creator_profiles.studio_name}` : game.title;
  const description = game.short_description ?? `Play ${game.title} free in your browser on Woven.`;
  const ogImage = `/game/${slug}/opengraph-image`;

  return {
    title,
    description,
    openGraph: { title, description, images: [ogImage], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
  };
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = await getMetaGame(slug);

  return (
    <>
      {game && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "VideoGame",
              name: game.title,
              description: game.short_description ?? undefined,
              url: `${getSiteUrl()}/game/${slug}`,
              ...(game.creator_profiles?.studio_name
                ? { author: { "@type": "Organization", name: game.creator_profiles.studio_name } }
                : {}),
              ...(game.rating ? { aggregateRating: { "@type": "AggregateRating", ratingValue: game.rating, bestRating: 5 } } : {}),
              offers: {
                "@type": "Offer",
                price: (game.price_cents / 100).toFixed(2),
                priceCurrency: "USD",
              },
            }),
          }}
        />
      )}
      <GameDetailClient params={params} />
    </>
  );
}
