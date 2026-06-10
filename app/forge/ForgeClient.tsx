"use client";

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
};

function joinUrl(base: string, entryFile: string) {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return new URL(entryFile, normalizedBase).toString();
}

export default function ForgeClient() {
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [accessState, setAccessState] = useState<"loading" | "approved" | "pending" | "none" | "error">("loading");
  const [message, setMessage] = useState("Loading Forge...");
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolRow | null>(null);
  const [build, setBuild] = useState<ToolBuildRow | null>(null);

  const handoffParams = useMemo(() => {
    const params = new URLSearchParams();
    for (const key of ["project", "projectUrl", "buildUrl", "engine"]) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    return params;
  }, [searchParams]);

  useEffect(() => {
    let active = true;

    async function loadForge() {
      setLoading(true);
      setAccessState("loading");
      setMessage("Loading Forge...");
      setIframeSrc(null);

      if (!isLoaded) return;
      if (!user?.id) {
        if (active) {
          setAccessState("none");
          setMessage("Sign in to open Forge.");
          setLoading(false);
        }
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        const env = getSupabaseEnvStatus();
        setAccessState("error");
        setMessage(
          env.missing.length
            ? `Missing Supabase env vars: ${env.missing.join(", ")}.`
            : "Supabase client could not initialize. Check the Woven Vercel env vars."
        );
        setLoading(false);
        return;
      }

      const profileResult = await supabase
        .from("creator_profiles")
        .select("status, studio_name, handle")
        .eq("clerk_user_id", user.id)
        .maybeSingle<CreatorProfileRow>();

      if (!active) return;

      if (profileResult.error) {
        setAccessState("error");
        setMessage(profileResult.error.message);
        setLoading(false);
        return;
      }

      if (!profileResult.data || profileResult.data.status !== "approved") {
        setAccessState(profileResult.data ? "pending" : "none");
        setMessage(
          profileResult.data
            ? "Forge is available after creator approval."
            : "No creator profile found for this account."
        );
        setLoading(false);
        return;
      }

      setAccessState("approved");

      const toolResult = await supabase
        .from("platform_tools")
        .select("id, slug, name, engine, status, description")
        .eq("slug", "weave-forge")
        .maybeSingle<ToolRow>();

      if (!active) return;

      if (toolResult.error || !toolResult.data) {
        setAccessState("error");
        setMessage(toolResult.error?.message ?? "Weave Forge tool not found.");
        setLoading(false);
        return;
      }

      setTool(toolResult.data);

      const buildResult = await supabase
        .from("platform_tool_builds")
        .select("id, version, build_url, entry_file, changelog, is_current, pushed_at")
        .eq("tool_id", toolResult.data.id)
        .eq("is_current", true)
        .order("pushed_at", { ascending: false })
        .maybeSingle<ToolBuildRow>();

      if (!active) return;

      if (buildResult.error || !buildResult.data) {
        setAccessState("error");
        setMessage(buildResult.error?.message ?? "No current Forge build has been published.");
        setLoading(false);
        return;
      }

      setBuild(buildResult.data);

      const url = new URL(joinUrl(buildResult.data.build_url, buildResult.data.entry_file));
      handoffParams.forEach((value, key) => url.searchParams.set(key, value));
      url.searchParams.set("engine", toolResult.data.engine || "PlayCanvas");
      setIframeSrc(url.toString());
      setMessage("Forge ready.");
      setLoading(false);
    }

    loadForge().catch((error: unknown) => {
      if (!active) return;
      setAccessState("error");
      setMessage(error instanceof Error ? error.message : "Failed to load Forge.");
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [handoffParams, isLoaded, user?.id]);

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-line bg-panel/80">
        <div>
          <div className="text-[11px] font-bold tracking-[.14em] uppercase text-muted">Weave Forge</div>
          <div className="text-[13px] text-dim mt-1">
            {tool ? `${tool.name} · ${tool.engine}` : "Current Forge build"}
          </div>
        </div>
        <div className="flex-1" />
        <div className="text-[12px] text-dim">{loading ? "Loading..." : message}</div>
        <Link href="/dashboard" className="px-3 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">
          Back to dashboard
        </Link>
      </div>

      <div className="h-[calc(100vh-145px)]">
        {accessState === "approved" && iframeSrc ? (
          <iframe
            key={iframeSrc}
            src={iframeSrc}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            allow="fullscreen; clipboard-read; clipboard-write; gamepad"
            referrerPolicy="no-referrer"
            title="Weave Forge"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6">
            <div className="max-w-[580px] w-full bg-panel border border-line rounded-[10px] p-6">
              <div className="text-[20px] font-extrabold tracking-[-0.02em]">Forge</div>
              <p className="text-[13px] text-dim mt-2 leading-relaxed">{message}</p>
              <div className="flex gap-2 mt-5">
                <Link href="/creator" className="px-4 py-2 rounded-[8px] font-bold text-[13px] no-underline" style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
                  Become a creator
                </Link>
                <Link href="/dashboard" className="px-4 py-2 rounded-[8px] border border-line bg-panel2 text-[13px] font-semibold no-underline">
                  Dashboard
                </Link>
              </div>
              {build ? (
                <div className="mt-5 text-[12px] text-muted">
                  Current build: {build.version}
                  <br />
                  Published: {build.pushed_at ?? "unknown"}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
