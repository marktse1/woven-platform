// Detects YouTube, Vimeo, or Rumble from a pasted URL and renders the
// matching iframe embed. Rumble is the one exception worth knowing about:
// unlike YouTube/Vimeo, a normal Rumble watch-page URL has no direct,
// parseable mapping to its embed id — creators need to paste Rumble's own
// "Share → Embed" URL (rumble.com/embed/...) rather than the video page
// link. YouTube/Vimeo work from either the normal watch URL or an
// already-embed URL.
function toEmbedSrc(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const yt = trimmed.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;

  const vimeo = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;

  const rumbleEmbed = trimmed.match(/rumble\.com\/embed\/[\w-]+/i);
  if (rumbleEmbed) return trimmed;

  return null;
}

export default function VideoEmbed({ url, className = "" }: { url: string | null | undefined; className?: string }) {
  if (!url) return null;
  const src = toEmbedSrc(url);
  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-panel2 border border-line rounded-[10px] text-[12.5px] text-dim ${className}`}>
        Couldn&apos;t recognize this video link — for Rumble, use the Share → Embed URL, not the video page link.
      </div>
    );
  }
  return (
    <iframe
      src={src}
      className={`w-full border-0 rounded-[10px] ${className}`}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      referrerPolicy="no-referrer"
      title="Gameplay video"
    />
  );
}
