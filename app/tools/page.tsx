"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase";
import { mergeHostedTools, type ApprovedHostedTool } from "@/lib/tools/registry";
import type { ToolDef } from "@/lib/tools/types";

export default function ToolsHubPage() {
  const [tools, setTools] = useState<ToolDef[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      const supabase = getSupabaseClient();
      let approved: ApprovedHostedTool[] = [];
      if (supabase) {
        const { data } = await supabase
          .from("tool_submissions")
          .select("slug, name, summary, icon, category, build_url, entry_file, engine")
          .eq("status", "approved")
          .eq("kind", "hosted");
        approved = (data as ApprovedHostedTool[]) ?? [];
      }
      if (active) setTools(mergeHostedTools(approved));
    }
    load();
    return () => { active = false; };
  }, []);

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink">
      <div className="max-w-[1100px] mx-auto px-6 lg:px-10 pt-10 pb-16">
        <div className="flex items-end justify-between gap-6 mb-8">
          <div>
            <p className="text-[11px] font-bold tracking-[.14em] uppercase text-accent mb-2">Forge Tools</p>
            <h1 className="text-[34px] font-extrabold tracking-[-0.02em]">Creator toolbox</h1>
            <p className="text-[14px] text-muted mt-1">First-party studios and community-built tools. Have one to share?</p>
          </div>
          <Link href="/tools/submit" className="px-4 py-2.5 rounded-[9px] font-bold text-[13px] no-underline" style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}>
            Submit a tool
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((t) => {
            const inner = (
              <>
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="w-10 h-10 rounded-[10px] flex items-center justify-center text-[20px]" style={{ background: "rgba(86,166,232,.14)" }}>{t.icon}</span>
                  <div className="font-bold text-[15px]">{t.name}</div>
                  {t.badge && <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full uppercase" style={{ background: "rgba(123,194,74,.16)", color: "#a6e06a" }}>{t.badge}</span>}
                </div>
                <p className="text-[12.5px] text-dim leading-relaxed">{t.summary}</p>
                <div className="mt-4 flex items-center gap-2 text-[11px] text-dim">
                  <span className="px-2 py-0.5 rounded-full capitalize" style={{ background: "#1b2836" }}>{t.category}</span>
                  <span className="px-2 py-0.5 rounded-full" style={{ background: "#1b2836" }}>{t.kind}</span>
                </div>
              </>
            );
            const cls = "text-left rounded-[12px] border border-line bg-panel p-5 transition-colors hover:border-[#26384a] no-underline block";
            return t.kind === "native" && t.href ? (
              <Link key={t.slug} href={t.href} className={cls}>{inner}</Link>
            ) : (
              <a key={t.slug} href={t.buildUrl} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
            );
          })}
        </div>
      </div>
    </main>
  );
}
