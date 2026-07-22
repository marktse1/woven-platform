"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCreatorStatus } from "@/lib/useCreatorStatus";
import { useStaffRole } from "@/lib/useStaffRole";

const publicLinks = [
  { label: "Become a Creator", href: "/creator" },
  { label: "Upload a Game",    href: "/upload" },
  { label: "Weave Forge",      href: "/forge" },
  { label: "Engines & SDK",    href: "/engines-sdk" },
  { label: "Multiplayer",      href: "/multiplayer" },
  { label: "Docs",             href: "/docs" },
];

const creatorLinks = [
  { label: "Dashboard",         href: "/dashboard" },
  { label: "Studio Profile",    href: "/dashboard/studio/edit" },
  { label: "Upload a Game",     href: "/upload" },
  { label: "Asset Marketplace", href: "/marketplace" },
  { label: "Weave Forge",       href: "/forge" },
  { label: "Submit a Tool",     href: "/tools/submit" },
  { label: "Engines & SDK",     href: "/engines-sdk" },
  { label: "Multiplayer",       href: "/multiplayer" },
  { label: "Docs",              href: "/docs" },
];

const reviewLink = { label: "Review Applications", href: "/admin" };

export default function CreatorSubNav() {
  const pathname = usePathname();
  const status = useCreatorStatus();
  const { role } = useStaffRole();
  const base = status === "approved" ? creatorLinks : publicLinks;
  const links = role ? [...base, reviewLink] : base;

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
