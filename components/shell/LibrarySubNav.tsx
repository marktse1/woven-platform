"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { label: "Home",            href: "/library" },
  { label: "Games",           href: "/library/games" },
  { label: "Recently Played", href: "/library/recent" },
  { label: "Collections",     href: "/library/collections" },
  { label: "Cloud Saves",     href: "/library/cloud-saves" },
  { label: "Wishlist",        href: "/library/wishlist" },
];

export default function LibrarySubNav() {
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
