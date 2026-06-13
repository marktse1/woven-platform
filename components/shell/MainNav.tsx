"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCreatorStatus } from "@/lib/useCreatorStatus";

const tabs = [
  { label: "Store", href: "/" },
  { label: "Library", href: "/library" },
  { label: "Weave Forge", href: "/forge" },
  { label: "Community", href: "/community" },
];

function LogoMark() {
  return (
    <div
      className="w-[27px] h-[27px] rounded-[7px] border border-accent2 shrink-0"
      style={{
        background: `repeating-linear-gradient(45deg, #56a6e8 0 3px, transparent 3px 7px),
                     repeating-linear-gradient(-45deg, #2c6aa0 0 3px, transparent 3px 7px),
                     #0b0f14`,
      }}
    />
  );
}

export default function MainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const creatorStatus = useCreatorStatus();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setQuery(new URLSearchParams(window.location.search).get("q") ?? "");
  }, [pathname]);

  const activeSection =
    pathname.startsWith("/creator") || pathname.startsWith("/upload") ||
    pathname.startsWith("/engines-sdk") || pathname.startsWith("/multiplayer")
      ? "/creator"
      : pathname.startsWith("/forge")
      ? "/forge"
      : pathname.startsWith("/library")
      ? "/library"
      : pathname.startsWith("/community")
      ? "/community"
      : pathname === "/" ? "/" : pathname;

  return (
    <nav
      className="flex items-center gap-6 px-12 py-[13px] border-b border-line"
      style={{ background: "linear-gradient(180deg, rgba(255,255,255,.03), transparent)" }}
    >
      <Link href="/" className="flex items-center gap-2.5 font-extrabold text-xl tracking-[-0.01em] mr-1 text-ink no-underline">
        <LogoMark />
        Woven
      </Link>

      <div className="flex gap-1.5">
        {tabs.map((t) => {
          const active = t.href === "/" ? activeSection === "/" : activeSection.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={[
                "px-3.5 py-2.5 rounded-[7px] font-bold text-[12.5px] tracking-[.04em] uppercase whitespace-nowrap no-underline transition-colors",
                active ? "text-[#06121d]" : "text-muted hover:text-ink hover:bg-white/[.04]",
              ].join(" ")}
              style={active ? { background: "linear-gradient(180deg, #56a6e8, #2c6aa0)" } : {}}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <div className="flex-1" />

      {activeSection === "/" || activeSection === "/library" || activeSection === "/community" ? (
        <>
          <form
            className="flex items-center gap-2 bg-[#0a0e13] border border-line rounded-lg px-3 py-2 w-[260px] text-dim text-[13px]"
            onSubmit={(event) => {
              event.preventDefault();
              const q = query.trim();
              router.push(q ? `/?q=${encodeURIComponent(q)}` : "/");
            }}
          >
            <span aria-hidden className="text-dim text-[13px]">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="search the store"
              className="w-full bg-transparent outline-none text-ink placeholder:text-dim"
            />
          </form>
          <div className="bg-white/[.06] border border-line px-3.5 py-2 rounded-lg font-semibold text-[13px] cursor-pointer">
            Woven Pass
          </div>
        </>
      ) : creatorStatus !== "approved" ? (
        <Link
          href="/creator"
          className="px-4 py-2 rounded-[9px] font-bold text-[14px] text-[#06121d] no-underline"
          style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)" }}
        >
          For Developers
        </Link>
      ) : null}
    </nav>
  );
}
