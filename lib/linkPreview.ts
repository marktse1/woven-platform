// Server-only: unfurls the first link found in a studio post's body into a
// { url, title, description, image } card, called once at publish time
// from app/api/creator/posts (never from a client component — this reaches
// out to arbitrary user-supplied URLs, which is only safe to do from a
// server that can apply SSRF guards). No HTML-parser dependency (cheerio/
// jsdom aren't in package.json) — same lightweight-regex approach
// components/VideoEmbed.tsx already uses for parsing video URLs.

export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
};

const URL_RE = /https?:\/\/[^\s<>"')]+/i;

export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(URL_RE);
  return match ? match[0] : null;
}

const BLOCKED_HOSTNAME_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|\[?::1\]?|.*\.local)$/i;

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOSTNAME_RE.test(hostname);
}

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 200 * 1024;

function extractMeta(html: string, ...names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`,
      "i",
    );
    const match = html.match(re);
    const value = match?.[1] ?? match?.[2];
    if (value) return value.trim();
  }
  return null;
}

/** Best-effort — any failure (unreachable, blocked host, timeout, no metadata) returns null rather than throwing. */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isBlockedHost(url.hostname)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WovenBot/1.0; +https://wovengame.app)" },
    });
    if (!res.ok || !res.body) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let bytesRead = 0;
    while (bytesRead < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});

    const title = extractMeta(html, "og:title", "twitter:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
    const description = extractMeta(html, "og:description", "twitter:description", "description");
    let image = extractMeta(html, "og:image", "twitter:image");
    if (image && !image.startsWith("http")) {
      try { image = new URL(image, url).toString(); } catch { image = null; }
    }

    if (!title && !description && !image) return null;
    return { url: url.toString(), title, description, image };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
