import { auth } from "@clerk/nextjs/server";
import { mintSaveToken } from "@/lib/forge/save-token";

// Mints the short-lived saveToken ForgeClient.tsx passes to the external
// Forge tool app via the iframe URL. Minting requires FORGE_SAVE_TOKEN_SECRET,
// which is server-only, so the client can't do this itself.
export async function POST() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const token = mintSaveToken(userId);
    return Response.json({ token });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not mint token" }, { status: 500 });
  }
}
