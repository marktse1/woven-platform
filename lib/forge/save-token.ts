import crypto from "node:crypto";

// Short-lived signed token so the external Forge tool app (running
// cross-origin inside ForgeClient.tsx's sandboxed iframe, with no access to
// Woven's session cookie) can call app/api/forge/levels/save authenticated
// as the creator who launched it. Minted server-side right before launch
// (see ForgeClient.tsx's launchEngine()) and passed as a URL query param,
// following the same handoff-params pattern already used for project/
// projectUrl/buildUrl/engine.
//
// HMAC, not a full JWT library — this is a single-claim, single-purpose
// token (who + expiry), not worth a dependency for.

const SECRET = process.env.FORGE_SAVE_TOKEN_SECRET;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

export function mintSaveToken(clerkUserId: string, ttlMs = DEFAULT_TTL_MS): string {
  if (!SECRET) throw new Error("FORGE_SAVE_TOKEN_SECRET is not configured");
  const payload = { sub: clerkUserId, exp: Date.now() + ttlMs };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

export function verifySaveToken(token: string): { clerkUserId: string } | null {
  if (!SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expected = crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown };
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;
    return { clerkUserId: payload.sub };
  } catch {
    return null;
  }
}
