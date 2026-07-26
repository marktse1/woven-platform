"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Workshop deep-links into Discussions pre-filtered to the existing
// "Weave Forge" thread category (see app/community/page.tsx's `categories`
// array) rather than being its own page — there's no separate workshop
// content/table, just threads about using Weave Forge.
const WORKSHOP_CATEGORY = "Weave Forge";

const links = [
  { label: "Discussions", href: "/community" },
  { label: "Feed",        href: "/community/feed" },
  { label: "Game Hubs",   href: "/community/hubs" },
  { label: "Workshop",    href: `/community?category=${encodeURIComponent(WORKSHOP_CATEGORY)}` },
  { label: "Events",      href: "/community/events" },
  { label: "Guides",      href: "/community/guides" },
];

export default function CommunitySubNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className="flex gap-[22px] px-4 sm:px-6 lg:px-12 py-3 text-[13px] font-semibold text-muted border-b border-line overflow-x-auto scrollbar-none"
      style={{ background: "rgba(0,0,0,.2)" }}>
      {links.map((l) => {
        const [linkPath, linkQuery] = l.href.split("?");
        const isActive = pathname === linkPath && (linkQuery ? new URLSearchParams(linkQuery).get("category") === searchParams.get("category") : !searchParams.get("category"));
        return (
          <Link key={l.href} href={l.href}
            className={["whitespace-nowrap no-underline hover:text-accent transition-colors",
              isActive ? "text-accent" : ""].join(" ")}>
            {l.label}
          </Link>
        );
      })}
    </div>
  );
}
