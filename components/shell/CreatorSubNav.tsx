"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const publicLinks = [
  { label: "Become a Creator", href: "/creator" },
  { label: "Upload a Game",    href: "/upload" },
  { label: "Weave Forge",      href: "/forge" },
  { label: "Engines & SDK",    href: "/engines-sdk" },
  { label: "Multiplayer",      href: "/multiplayer" },
  { label: "Docs",             href: "/docs" },
];

const creatorLinks = [
  { label: "Dashboard",     href: "/dashboard" },
  { label: "Upload a Game", href: "/upload" },
  { label: "Engines & SDK", href: "/engines-sdk" },
  { label: "Multiplayer",   href: "/multiplayer" },
  { label: "Docs",          href: "/docs" },
];

export default function CreatorSubNav() {
  const pathname = usePathname();
  const { user } = useUser();
  const [isApproved, setIsApproved] = useState(false);

  useEffect(() => {
    if (!user) { setIsApproved(false); return; }
    supabase
      .from("creator_profiles")
      .select("status")
      .eq("clerk_user_id", user.id)
      .single()
      .then(({ data }) => setIsApproved(data?.status === "approved"));
  }, [user?.id]);

  const links = isApproved ? creatorLinks : publicLinks;

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
