import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(140deg, #3a7fc4, #7d4bd0)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: -2 }}>Woven</div>
        <div style={{ fontSize: 32, marginTop: 16, color: "rgba(255,255,255,.85)" }}>
          Browse and play browser-native games. Publish your worlds.
        </div>
      </div>
    ),
    size,
  );
}
