import crypto from "node:crypto";

// Encrypts creator-supplied third-party API keys (Anthropic/OpenAI/Google)
// before they're stored (0016_creator_api_keys.sql). AES-256-GCM with a key
// derived from API_KEY_ENCRYPTION_SECRET (a server-only env var, generate
// with `openssl rand -hex 32` same as FORGE_SAVE_TOKEN_SECRET). Never log
// or return a decrypted value to the client — decrypt only right before
// calling the provider's API, server-side.

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) throw new Error("API_KEY_ENCRYPTION_SECRET is not configured");
  return crypto.createHash("sha256").update(secret).digest(); // 32 bytes, matches aes-256
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted value");
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

export function hintFor(key: string): string {
  return key.length > 4 ? `…${key.slice(-4)}` : "…";
}
