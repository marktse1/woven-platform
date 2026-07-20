"use client";

import { useEffect, useRef } from "react";

// Every tool page sizes itself against the header's real height via the
// --header-h CSS var (see .tool-h/.tool-min-h in globals.css) instead of a
// hardcoded guess — the header's actual height varies slightly with auth
// state/nav theme, and a stale guess left content (e.g. Mesh Sculptor's
// Save footer) clipped below the fold.
export default function HeaderShell({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const setVar = () => {
      document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    };
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(el);
    window.addEventListener("resize", setVar);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", setVar);
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
