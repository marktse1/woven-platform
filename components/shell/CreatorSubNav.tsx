"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { label: "Become a Creator", href: "/creator" },
  { label: "Upload a Game",    href: "/upload" },
  { label: "Weave Forge",      href: "/forge" },
  { label: "Engines & SDK",    href: "/engines-sdk" },
  { label: "Multiplayer",      href: "/multiplayer" },
  { label: "Docs",             href: "/docs" },
  { label: "Dashboard",        href: "/dashboard" },
];

export default function CreatorSubNav() {
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
