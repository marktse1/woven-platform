import { ImageResponse } from "next/og";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type GradPair = [string, string];
const pal: GradPair[] = [
  ["#3a7fc4", "#7d4bd0"], ["#2aa6c4", "#15527a"], ["#5cb85c", "#1e7a4a"],
  ["#e8794b", "#b8431a"], ["#4b7fd0", "#2a3f7a"], ["#c44b9a", "#6a2a7a"],
];

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const admin = getSupabaseAdmin();
  const { data: creator } = admin
    ? await admin
        .from("creator_profiles")
        .select("studio_name, handle, about")
        .eq("handle", decodeURIComponent(handle))
        .eq("status", "approved")
        .maybeSingle<{ studio_name: string | null; handle: string | null; about: string | null }>()
    : { data: null };

  const name = creator?.studio_name ?? creator?.handle ?? "Woven";
  const pair = pal[name.length % pal.length];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "70px",
          background: `linear-gradient(140deg, ${pair[0]}, ${pair[1]})`,
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 22, opacity: 0.85, marginBottom: 12 }}>Woven Studio</div>
        <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05 }}>{name}</div>
        {creator?.about && (
          <div style={{ fontSize: 28, marginTop: 20, opacity: 0.9, maxWidth: 900 }}>{creator.about}</div>
        )}
      </div>
    ),
    size,
  );
}
