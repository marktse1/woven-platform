"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { label: "Discussions", href: "/community" },
  { label: "Game Hubs",   href: "/community/hubs" },
  { label: "Workshop",    href: "/community/workshop" },
  { label: "Events",      href: "/community/events" },
  { label: "Reviews",     href: "/community/reviews" },
  { label: "Guides",      href: "/community/guides" },
];

export default function CommunitySubNav() {
  const pathname = usePathname();
  return (
    <div className="flex gap-[22px] px-12 py-3 text-[13px] font-semibold text-muted border-b border-line"
      style={{ background: "rgba(0,0,0,.2)" }}>
      {links.map((l) => (
        <Link key={l.href} href={l.href}
          className={["whitespace-nowrap no-underline hover:text-accent transition-colors",
            pathname === l.href ? "text-accent" : ""].join(" ")}>
          {l.label}
        </Link>
      ))}
    </div>
  );
}
