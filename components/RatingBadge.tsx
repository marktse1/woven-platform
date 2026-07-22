import { scoreOutOf100, scoreColor } from "@/lib/games";

/** A Metacritic-style 0-100 score badge, derived from games.rating (the
 * 1-5 star average). Renders nothing when there are no reviews yet. */
export default function RatingBadge({ rating, className = "" }: { rating: number | null; className?: string }) {
  const score = scoreOutOf100(rating);
  if (score == null) return null;
  const color = scoreColor(score);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[6px] font-bold text-[12px] px-2 py-0.5 ${className}`}
      style={{ background: `${color}29`, color, border: `1px solid ${color}66` }}
      title={`${score} / 100`}
    >
      {score}
    </span>
  );
}
