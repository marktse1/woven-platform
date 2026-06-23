"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { getSupabaseClient, getSupabaseEnvStatus } from "@/lib/supabase";

type ToolRow = {
  id: string;
  slug: string;
  name: string;
  engine: string;
  status: string;
  description: string | null;
};

type ToolBuildRow = {
  id: string;
  version: string;
  build_url: string;
  entry_file: string;
  changelog: string | null;
  is_current: boolean;
  pushed_at: string | null;
};

type CreatorProfileRow = {
  status: "pending" | "approved" | "rejected";
  studio_name: string | null;
  handle: string | null;
  engines: string[] | null;
};

const ENGINE_OPTIONS = [
  { label: "PlayCanvas",   slug: "weave-forge",    dot: "#e5732b", desc: "Weave Forge — browser world editor" },
  { label: "Babylon.js",  slug: "babylon-forge",   dot: "#bb464b", desc: "Scene editor" },
  { label: "Three.js",    slug: "three-forge",     dot: "#ffffff", desc: "Scene editor" },
  { label: "Phaser",      slug: "phaser-forge",    dot: "#8e44ad", desc: "2D game editor" },
  { label: "Godot (web)", slug: "godot-forge",     dot: "#478cbf", desc: "Web export tools" },
  { label: "Unity WebGL", slug: "unity-forge",     dot: "#cccccc", desc: "WebGL export tools" },
];

// Native (in-repo) asset-prep tools — run directly on Woven, no iframe handoff.
const DEV_TOOL_OPTIONS = [
  {
    label: "Mesh Loom",
    href: "/tools/retopology",
    dot: "#7bc24a",
    desc: "Drag in a hi-res GLB — decimate, retopologize with edge loops, segment, and bake a clean low-poly in any order.",
    badge: "New",
  },
];

function joinUrl(base: string, entryFile: string) {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return new URL(entryFile, normalizedBase).toString();
}

export default function ForgeClient() {
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();

  const [phase, setPhase] = useState<"loading" | "picker" | "launching" | "running" | "error" | "no-access">("loading");
  const [message, setMessage] = useState("");
  const [creatorEngines, setCreatorEngines] = useState<string[]>([]);
  const [availableTools, setAvailableTools] = useState<Record<string, { tool: ToolRow; build: ToolBuildRow }>>({});
  const [activeTool, setActiveTool] = useState<ToolRow | null>(null);
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);

  const handoffParams = useMemo(() => {
    const params = new URLSearchParams();
    for (const key of ["project", "projectUrl", "buildUrl", "engine"]) {
      const v = searchParams.get(key);
      if (v) params.set(key, v);
    }
    return params;
  }, [searchParams]);

  useEffect(() => {
    let active = true;

    async function init() {
      if (!isLoaded) return;

      if (!user?.id) {
        if (active) { setPhase("no-access"); setMessage("Sign in to open Forge."); }
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        const env = getSupabaseEnvStatus();
        if (active) {
          setPhase("error");
          setMessage(env.missing.length
            ? `Missing Supabase env vars: ${env.missing.join(", ")}.`
            : "Supabase client could not initialize.");
        }
        return;
      }

      const { data: profile, error: profileErr } = await supabase
        .from("creator_profiles")
        .select("status, studio_name, handle, engines")
        .eq("clerk_user_id", user.id)
        .maybeSingle<CreatorProfileRow>();

      if (!active) return;
      if (profileErr) { setPhase("error"); setMessage(profileErr.message); return; }
      if (!profile || profile.status !== "approved") {
        setPhase("no-access");
        setMessage(profile ? "Forge is available after creator approval." : "No creator profile found.");
        return;
      }

      setCreatorEngines(profile.engines ?? []);

      const { data: toolsData } = await supabase
        .from("platform_tools")
        .select("id, slug, name, engine, status, description")
        .eq("status", "active");

      if (!active) return;

      const tools: ToolRow[] = toolsData ?? [];
      const toolMap: Record<string, { tool: ToolRow; build: ToolBuildRow }> = {};

      await Promise.all(tools.map(async (tool) => {
        const { data: build } = await supabase
          .from("platform_tool_builds")
          .select("id, version, build_url, entry_file, changelog, is_current, pushed_at")
          .eq("tool_id", tool.id)
          .eq("is_current", true)
          .order("pushed_at", { ascending: false })
          .maybeSingle<ToolBuildRow>();
        if (build) toolMap[tool.slug] = { tool, build };
      }));

      if (!active) return;
      setAvailableTools(toolMap);
      setPhase("picker");
    }

    init().catch((err: unknown) => {
      if (!active) return;
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Failed to load Forge.");
    });

    return () => { active = false; };
  }, [isLoaded, user?.id]);

  function launchEngine(slug: string) {
    const entry = availableTools[slug];
    if (!entry) return;
    const { tool, build } = entry;
    const url = new URL(joinUrl(build.build_url, build.entry_file));
    handoffParams.forEach((value, key) => url.searchParams.set(key, value));
    url.searchParams.set("engine", tool.engine || slug);
    setActiveTool(tool);
    setIframeSrc(url.toString());
    setPhase("running");
  }

  if (phase === "running" && iframeSrc) {
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink flex flex-col">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-line bg-panel/80 shrink-0">
          <button
            onClick={() => { setPhase("picker"); setIframeSrc(null); setActiveTool(null); }}
            className="px-3 py-1.5 rounded-[7px] border border-line bg-panel2 text-[12px] font-semibold cursor-pointer"
          >
            ← Engines
          </button>
          <div className="text-[13px] font-bold">{activeTool?.name ?? "Weave Forge"}</div>
          <div className="text-[12px] text-dim">{activeTool?.engine}</div>
          <div className="flex-1" />
          <Link href="/dashboard" className="px-3 py-1.5 rounded-[7px] border border-line bg-panel2 text-[13px] font-semibold no-underline">
            Dashboard
          </Link>
        </div>
        <div className="flex-1">
          <iframe
            key={iframeSrc}
            src={iframeSrc}
            className="w-full h-full border-0"
            style={{ height: "calc(100vh - 121px)" }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            allow="fullscreen; clipboard-read; clipboard-write; gamepad"
            referrerPolicy="no-referrer"
            title="Weave Forge"
          />
        </div>
      </main>
    );
  }

  if (phase === "loading") {
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink flex items-center justify-center">
        <div className="text-[13px] text-dim">Loading Forge...</div>
      </main>
    );
  }

  if (phase === "no-access" || phase === "error") {
    return (
      <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink flex items-center justify-center px-6">
        <div className="max-w-[520px] w-full bg-panel border border-line rounded-[10px] p-6">
          <div className="text-[20px] font-extrabold tracking-[-0.02em] mb-2">Weave Forge</div>
          <p className="text-[13px] text-dim leading-relaxed">{message}</p>
          <div className="flex gap-2 mt-5">
            <Link href="/creator" className="px-4 py-2 rounded-[8px] font-bold text-[13px] no-underline"
              style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}>
              Become a creator
            </Link>
            <Link href="/dashboard" className="px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">
              Dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Picker screen
  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink">
      <div className="max-w-[960px] mx-auto px-8 pt-10 pb-16">
        <p className="text-[11px] font-bold tracking-[.14em] uppercase text-accent mb-2">Weave Forge</p>
        <h1 className="text-[34px] font-extrabold tracking-[-0.02em] mb-1">Choose your dev kit</h1>
        <p className="text-[14px] text-muted mb-8">
          Select the engine you want to build with. Kits marked as available have a live build — others are coming soon.
        </p>

        <div className="grid grid-cols-3 gap-4">
          {ENGINE_OPTIONS.map((eng) => {
            const available = !!availableTools[eng.slug];
            const preferred = creatorEngines.includes(eng.label);
            return (
              <button
                key={eng.slug}
                onClick={() => available && launchEngine(eng.slug)}
                disabled={!available}
                className="text-left rounded-[12px] border p-5 transition-all cursor-pointer disabled:cursor-default group"
                style={{
                  background: available
                    ? preferred ? "rgba(86,166,232,.10)" : "#111820"
                    : "#0c1117",
                  borderColor: available
                    ? preferred ? "#56a6e8" : "#26384a"
                    : "#1a2530",
                }}
              >
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: eng.dot }} />
                  <span className="font-bold text-[15px]" style={{ color: available ? "#e7eef4" : "#3a5060" }}>
                    {eng.label}
                  </span>
                  {preferred && available && (
                    <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-[.06em]"
                      style={{ background: "rgba(86,166,232,.16)", color: "#8fc6f0" }}>
                      Your pick
                    </span>
                  )}
                </div>
                <p className="text-[12.5px]" style={{ color: available ? "#b9cdd9" : "#3a4f5e" }}>
                  {eng.desc}
                </p>
                <div className="mt-4 flex items-center gap-1.5">
                  {available ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#7bc24a]" />
                      <span className="text-[11px] font-semibold text-[#7bc24a]">
                        {availableTools[eng.slug].build.version} · available
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#2a3a46]" />
                      <span className="text-[11px] font-semibold text-[#2a3a46]">coming soon</span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-12">
          <p className="text-[11px] font-bold tracking-[.14em] uppercase text-accent mb-2">3D Dev Tools</p>
          <h2 className="text-[22px] font-extrabold tracking-[-0.02em] mb-1">Optimize & prep your assets</h2>
          <p className="text-[14px] text-muted mb-6">
            In-house pipeline tools for getting models game-ready — native to Woven, no iframe handoff.
          </p>

          <div className="grid grid-cols-3 gap-4">
            {DEV_TOOL_OPTIONS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="text-left rounded-[12px] border p-5 transition-all block no-underline group"
                style={{ background: "#111820", borderColor: "#26384a" }}
              >
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.dot }} />
                  <span className="font-bold text-[15px]" style={{ color: "#e7eef4" }}>{t.label}</span>
                  {t.badge && (
                    <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-[.06em]" style={{ background: "rgba(123,194,74,.16)", color: "#a6e06a" }}>
                      {t.badge}
                    </span>
                  )}
                </div>
                <p className="text-[12.5px]" style={{ color: "#b9cdd9" }}>{t.desc}</p>
                <div className="mt-4 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7bc24a]" />
                  <span className="text-[11px] font-semibold text-[#7bc24a]">native · available</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-8 text-[12.5px] text-dim">
          Want to add more engines to your profile?{" "}
          <Link href="/creator" className="text-accent font-semibold no-underline">Update your creator profile →</Link>
        </div>
      </div>
    </main>
  );
}
