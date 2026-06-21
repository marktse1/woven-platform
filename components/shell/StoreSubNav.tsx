"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { label: "Your Store",           href: "/" },
  { label: "New & Trending",       href: "/new" },
  { label: "Top Sellers",          href: "/top" },
  { label: "Specials",             href: "/specials" },
  { label: "Made in Weave Forge",  href: "/weave-forge" },
  { label: "Browse ▾",            href: "/browse" },
];

export default function StoreSubNav() {
  const pathname = usePathname();
  return (
    <div className="flex gap-[22px] px-4 sm:px-6 lg:px-12 py-3 text-[13px] font-semibold text-muted border-b border-line overflow-x-auto scrollbar-none"
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
