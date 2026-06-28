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

function toolTheme(path: string) {
  if (path.startsWith("/tools/mesh-sculptor"))
    return { accent: "#c47be8", headerBg: "rgba(24,16,30,0.96)", border: "#2d2035", logoBorder: "rgba(196,123,232,.4)", logoA: "#c47be8", logoB: "#8b3db0", logoBg: "#1b1520", activeText: "#f5ecff" };
  if (path.startsWith("/tools/substance-weaver"))
    return { accent: "#56a6e8", headerBg: "rgba(10,14,20,0.96)", border: "#263040", logoBorder: "rgba(86,166,232,.4)", logoA: "#56a6e8", logoB: "#2c6aa0", logoBg: "#0b0f14", activeText: "#cfe6fb" };
  return { accent: "#d65b36", headerBg: "rgba(24,20,14,0.96)", border: "#2a2420", logoBorder: "rgba(214,91,54,.4)", logoA: "#d65b36", logoB: "#a03018", logoBg: "#1b1815", activeText: "#fff3ec" };
}

function LogoMark({ warm, theme }: { warm?: boolean; theme?: ReturnType<typeof toolTheme> }) {
  return (
    <div
      className="w-[27px] h-[27px] rounded-[7px] shrink-0"
      style={{
        border: warm && theme ? `1px solid ${theme.logoBorder}` : "1px solid var(--color-accent2)",
        background: warm && theme
          ? `repeating-linear-gradient(45deg, ${theme.logoA} 0 3px, transparent 3px 7px),
             repeating-linear-gradient(-45deg, ${theme.logoB} 0 3px, transparent 3px 7px),
             ${theme.logoBg}`
          : `repeating-linear-gradient(45deg, #56a6e8 0 3px, transparent 3px 7px),
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
      : pathname.startsWith("/forge") || pathname.startsWith("/tools/")
      ? "/forge"
      : pathname.startsWith("/library")
      ? "/library"
      : pathname.startsWith("/community")
      ? "/community"
      : pathname === "/" ? "/" : pathname;

  const isForge = activeSection === "/forge";
  const theme = isForge ? toolTheme(pathname) : null;

  return (
    <nav
      className="flex items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:gap-6 lg:px-12 py-[13px] border-b"
      style={{
        borderBottomColor: isForge ? (theme?.border ?? "#2a2420") : "var(--color-line)",
        background: isForge
          ? (theme?.headerBg ?? "rgba(24,20,14,0.96)")
          : "linear-gradient(180deg, rgba(255,255,255,.03), transparent)",
      }}
    >
      <Link href="/" className="flex items-center gap-2.5 font-extrabold text-xl tracking-[-0.01em] mr-1 text-ink no-underline">
        <LogoMark warm={isForge} theme={theme ?? undefined} />
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
                active && t.href === "/forge"
                  ? ""
                  : active
                  ? "text-[#06121d]"
                  : isForge
                  ? "hover:bg-[#2c2926]"
                  : "text-muted hover:text-ink hover:bg-white/[.04]",
              ].join(" ")}
              style={
                active && t.href === "/forge"
                  ? { background: theme?.accent ?? "#d65b36", color: theme?.activeText ?? "#fff3ec" }
                  : active
                  ? { background: "linear-gradient(180deg, #56a6e8, #2c6aa0)" }
                  : isForge
                  ? { color: "#9b9082" }
                  : {}
              }
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
            className="flex items-center gap-2 bg-[#0a0e13] border border-line rounded-lg px-3 py-2 w-[160px] sm:w-[220px] lg:w-[260px] text-dim text-[13px]"
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
          className="px-4 py-2 rounded-[9px] font-bold text-[14px] no-underline"
          style={isForge && theme
            ? { background: theme.accent, color: theme.activeText }
            : { background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }
          }
        >
          For Developers
        </Link>
      ) : null}
    </nav>
  );
}
