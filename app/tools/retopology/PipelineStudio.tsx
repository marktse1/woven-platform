"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  type AssetRow,
  type PipelineSessionRow,
  type PipelineStepRow,
  findSessionByAsset,
  openOrGetSession,
  listSteps,
  appendTier1Step,
  queueTier2Step,
  syncStepFromJob,
  deletePipelineStep,
  cancelPipelineStep,
  getJob,
  getJobForStep,
  getAsset,
  signedAssetUrl,
} from "@/lib/assets";
import {
  optimizeGlb,
  optimizeGlbAdaptive,
  countGlbTriangles,
  CLASSIFICATIONS,
  needsRetopoWorker,
  type Classification,
} from "@/lib/retopo/optimize";
import { segmentByConnectivity, type Segment } from "@/lib/retopo/segment";
import { stripSegments } from "@/lib/retopo/strip";
import { encodeSegmentRle } from "@/lib/retopo/encode-segments";
import type { SegmentationOverlay, TextureChannel } from "@/components/tools/ModelViewer";
import { BAKE_OPTIONS } from "@/lib/retopo/optimize";
import StepCard from "./StepCard";
import { AnimatePresence, motion } from "framer-motion";

const ModelViewer = dynamic(() => import("@/components/tools/ModelViewer"), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-[12px]" style={{ color: "#9b9082" }}>Loading viewer…</div>,
});

const ACCENT = "#d65b36";

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString();
}

/** Matches the golden-angle hue palette used in ModelViewer. */
function segmentColor(id: number) {
  return `hsl(${(id * 137.508) % 360}deg, 65%, 55%)`;
}

async function fetchAssetBytes(assetId: string): Promise<ArrayBuffer> {
  const row = await getAsset(assetId);
  if (!row) throw new Error("Asset not found.");
  const url = await signedAssetUrl(row.storage_path);
  const res = await fetch(url);
  return await res.arrayBuffer();
}

function StepBadge({ status }: { status: PipelineStepRow["status"] }) {
  const map: Record<PipelineStepRow["status"], { bg: string; c: string; label: string }> = {
    queued: { bg: "rgba(232,169,58,.16)", c: "#f0c66a", label: "queued" },
    processing: { bg: "rgba(214,91,54,.16)", c: "#ffb09a", label: "processing" },
    done: { bg: "rgba(123,194,74,.16)", c: "#a6e06a", label: "done" },
    failed: { bg: "rgba(227,92,92,.16)", c: "#e88", label: "failed" },
  };
  const s = map[status];
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase" style={{ background: s.bg, color: s.c }}>{s.label}</span>;
}

type Props = {
  asset: AssetRow | null;
  userId: string;
  onBack: () => void;
  onAssetCreated?: () => void;
};

export default function PipelineStudio({ asset, userId, onBack, onAssetCreated }: Props) {
  const [session, setSession] = useState<PipelineSessionRow | null>(null);
  const [steps, setSteps] = useState<PipelineStepRow[]>([]);
  const [classification, setClassification] = useState<Classification>("auto");

  const [sourceBuf, setSourceBuf] = useState<ArrayBuffer | null>(null);
  const [sourcePolys, setSourcePolys] = useState(asset?.poly_count ?? 0);
  const [workingBuf, setWorkingBuf] = useState<ArrayBuffer | null>(null);
  const [workingPolys, setWorkingPolys] = useState(0);

  const [targetPolys, setTargetPolys] = useState(20000);
  const [retopoTargetPolys, setRetopoTargetPolys] = useState(8000);
  const [decimateMode, setDecimateMode] = useState<"uniform" | "adaptive">("adaptive");
  const [curvatureWeight, setCurvatureWeight] = useState(5.0);
  const [lockFraction, setLockFraction] = useState(0.05);
  const [bakeMaps, setBakeMaps] = useState<string[]>(["albedo", "normal", "ao"]);
  const [reAtlas] = useState(true);
  const [dilationPx, setDilationPx] = useState(16);
  const [bakeProgress, setBakeProgress] = useState(0);
  const [bakeStage, setBakeStage] = useState("");

  const [segmentation, setSegmentation] = useState<SegmentationOverlay | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [excludedSegIds, setExcludedSegIds] = useState<Set<number>>(new Set());
  const [hoveredSegId, setHoveredSegId] = useState<number | null>(null);
  const [textureChannel, setTextureChannel] = useState<TextureChannel | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [retopoPreviewBuf, setRetopoPreviewBuf] = useState<ArrayBuffer | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [clayMode, setClayMode] = useState(false);
  // Defaults to the original upload (matching the poly count shown on the library
  // card) rather than silently resuming a previously-decimated "current" version.
  const [compareToSource, setCompareToSource] = useState(true);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pendingTier2, setPendingTier2] = useState<{ step: PipelineStepRow; jobId: string }[]>([]);
  const [aiRetopoPreset, setAiRetopoPreset] = useState<"fast" | "balanced" | "quality">("balanced");

  const hasSteps = steps.length > 0;
  const isCharacter = needsRetopoWorker(classification);

  // ---- initial load: source bytes + existing session/steps, if any --------
  useEffect(() => {
    if (!asset) {
      setSourceBuf(null);
      setWorkingBuf(null);
      setSourcePolys(0);
      setWorkingPolys(0);
      setSession(null);
      setSteps([]);
      setStatus("");
      setError("");
      return;
    }
    let active = true;
    (async () => {
      setBusy(true);
      setError("");
      setStatus("Loading model…");
      try {
        const url = await signedAssetUrl(asset.storage_path);
        const buf = await (await fetch(url)).arrayBuffer();
        if (!active) return;
        setSourceBuf(buf);
        const tris = await countGlbTriangles(buf);
        if (!active) return;
        setSourcePolys(tris);
        setTargetPolys(Math.max(500, Math.round(tris * 0.1)));

        const existing = await findSessionByAsset(asset.id);
        if (!active) return;

        if (existing) {
          setSession(existing);
          setClassification(existing.classification as Classification);
          const existingSteps = await listSteps(existing.id);
          if (!active) return;
          setSteps(existingSteps);

          const currentId = existing.current_asset_id ?? asset.id;
          const curBuf = currentId === asset.id ? buf : await fetchAssetBytes(currentId);
          if (!active) return;
          setWorkingBuf(curBuf);
          setWorkingPolys(await countGlbTriangles(curBuf));

          const unfinished = existingSteps.filter((s) => s.tier === "tier2" && (s.status === "queued" || s.status === "processing"));
          const resumed = await Promise.all(
            unfinished.map(async (s) => {
              const job = await getJobForStep(s.id);
              return job ? { step: s, jobId: job.id } : null;
            }),
          );
          if (!active) return;
          setPendingTier2(resumed.filter((r): r is { step: PipelineStepRow; jobId: string } => !!r));
        } else {
          const newSession = await openOrGetSession(userId, asset.id, "auto");
          if (!active) return;
          setSession(newSession);
          setSteps([]);
          setWorkingBuf(buf);
          setWorkingPolys(tris);
        }
        setStatus("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load model.");
      } finally {
        setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [asset?.id, asset?.storage_path]);

  // ---- poll queued/processing Tier-2 steps ----------------------------------
  useEffect(() => {
    if (!pendingTier2.length) return;
    const interval = setInterval(async () => {
      for (const entry of pendingTier2) {
        try {
          const job = await getJob(entry.jobId);
          if (!job || (job.status !== "done" && job.status !== "failed")) continue;

          const updatedStep = await syncStepFromJob(entry.step, job);
          setSteps((prev) => prev.map((s) => (s.id === updatedStep.id ? updatedStep : s)));
          setPendingTier2((prev) => prev.filter((p) => p.jobId !== entry.jobId));

          if (job.status === "done" && job.output_asset_id) {
            setSession((prev) => (prev ? { ...prev, current_asset_id: job.output_asset_id, current_step_id: updatedStep.id } : prev));
            const bytes = await fetchAssetBytes(job.output_asset_id);
            setWorkingBuf(bytes);
            setWorkingPolys(await countGlbTriangles(bytes));
            setSegmentation(null);
            setCompareToSource(false);
            setRetopoPreviewBuf(null);
            setStatus(`${updatedStep.op === "bake" ? "Texture bake" : "Retopology"} complete.`);
            onAssetCreated?.();
          } else if (job.status === "failed") {
            setError(job.error || `${entry.step.op} job failed.`);
          }
        } catch {
          // transient — retried on the next tick
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [pendingTier2]);

  const currentAssetId = session?.current_asset_id ?? asset?.id ?? "";


  const applyDecimate = useCallback(async () => {
    if (!session || !workingBuf) return;
    setBusy(true);
    setError("");
    setStatus("Optimizing geometry…");
    try {
      const res =
        decimateMode === "adaptive"
          ? await optimizeGlbAdaptive(workingBuf, {
              targetPolys,
              curvatureWeight,
              lockFraction: isCharacter ? Math.max(lockFraction, 0.05) : lockFraction,
            })
          : await optimizeGlb(workingBuf, { targetPolys, adaptive: false });

      const step = await appendTier1Step({
        sessionId: session.id,
        userId,
        op: decimateMode === "adaptive" ? "adaptive_density" : "decimate",
        inputAssetId: currentAssetId,
        outputName: `${(asset?.name ?? "model").replace(/\.(glb|gltf)$/i, "")}-step${steps.length + 1}.glb`,
        outputBytes: res.output.slice().buffer,
        outputPolyCount: res.resultPolys,
        params: { targetPolys, mode: decimateMode, curvatureWeight, lockFraction },
        stats: { sourcePolys: res.sourcePolys, resultPolys: res.resultPolys, reduction: res.reduction },
      });

      // Fetch the stored bytes directly — guarantees the viewer shows exactly
      // what was written to storage rather than an in-memory copy.
      const viewerBytes = await fetchAssetBytes(step.output_asset_id!);

      setSteps((prev) => [...prev, step]);
      setSession((prev) => (prev ? { ...prev, current_asset_id: step.output_asset_id, current_step_id: step.id } : prev));
      setWorkingBuf(viewerBytes);
      setWorkingPolys(res.resultPolys);
      setSegmentation(null);
      setCompareToSource(false);
      setStatus(`Reduced to ${res.resultPolys.toLocaleString()} tris (${Math.round(res.reduction * 100)}% lighter).`);
      onAssetCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decimate failed.");
    } finally {
      setBusy(false);
    }
  }, [session, workingBuf, targetPolys, decimateMode, curvatureWeight, lockFraction, isCharacter, userId, asset?.name, steps.length, currentAssetId]);

  const applySegment = useCallback(async () => {
    if (!session || !workingBuf) return;
    setBusy(true);
    setError("");
    setStatus("Segmenting…");
    try {
      const result = await segmentByConnectivity(workingBuf);
      setSegmentation({ trianglePerSegment: result.trianglePerSegment });
      setSegments(result.segments);
      setExcludedSegIds(new Set());

      const step = await appendTier1Step({
        sessionId: session.id,
        userId,
        op: "segment",
        inputAssetId: currentAssetId,
        reuseInputAsOutput: true,
        stats: { segmentCount: result.segments.length },
      });
      setSteps((prev) => [...prev, step]);
      setStatus(`Found ${result.segments.length} segment${result.segments.length === 1 ? "" : "s"}.`);
      onAssetCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Segmentation failed.");
    } finally {
      setBusy(false);
    }
  }, [session, workingBuf, userId, currentAssetId]);

  const applyMask = useCallback(async () => {
    if (!session || !workingBuf || excludedSegIds.size === 0 || !segmentation) return;
    setBusy(true);
    setError("");
    setStatus("Removing masked segments…");
    try {
      const stripped = await stripSegments(workingBuf, segmentation.trianglePerSegment, excludedSegIds);
      const resultPolys = await countGlbTriangles(stripped);
      const step = await appendTier1Step({
        sessionId: session.id,
        userId,
        op: "mask",
        inputAssetId: currentAssetId,
        outputName: `${(asset?.name ?? "model").replace(/\.(glb|gltf)$/i, "")}-masked${steps.length + 1}.glb`,
        outputBytes: stripped,
        outputPolyCount: resultPolys,
        params: { excludedSegments: Array.from(excludedSegIds) },
        stats: { removedSegments: excludedSegIds.size, resultPolys },
      });
      const viewerBytes = await fetchAssetBytes(step.output_asset_id!);
      setSteps((prev) => [...prev, step]);
      setSession((prev) => (prev ? { ...prev, current_asset_id: step.output_asset_id, current_step_id: step.id } : prev));
      setWorkingBuf(viewerBytes);
      setWorkingPolys(resultPolys);
      setSegmentation(null);
      setSegments([]);
      setExcludedSegIds(new Set());
      setHoveredSegId(null);
      setCompareToSource(false);
      setStatus(`Removed ${excludedSegIds.size} segment${excludedSegIds.size === 1 ? "" : "s"} — ${resultPolys.toLocaleString()} tris remain.`);
      onAssetCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mask failed.");
    } finally {
      setBusy(false);
    }
  }, [session, workingBuf, excludedSegIds, segmentation, userId, asset?.name, steps.length, currentAssetId]);

  const applyRetopo = useCallback(async () => {
    if (!session) return;
    setRetopoPreviewBuf(null);
    setBusy(true);
    setError("");
    try {
      const { step, job } = await queueTier2Step({
        sessionId: session.id,
        userId,
        op: "retopo",
        inputAssetId: currentAssetId,
        classification,
        targetPolys: retopoTargetPolys,
        mode: "retopo",
        adaptive: decimateMode === "adaptive",
        params: segmentation ? { segmentData: encodeSegmentRle(segmentation.trianglePerSegment) } : {},
      });
      setSteps((prev) => [...prev, step]);
      setPendingTier2((prev) => [...prev, { step, jobId: job.id }]);
      setStatus(`Queued ${classification} retopology + edge loops on the Forge worker.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue retopology.");
    } finally {
      setBusy(false);
    }
  }, [session, userId, currentAssetId, classification, retopoTargetPolys, decimateMode]);

  const applyBake = useCallback(async () => {
    if (!session || !workingBuf) return;
    setBusy(true);
    setError("");
    setBakeProgress(0);
    setBakeStage("");
    setStatus("Baking textures — UV unwrap + texture transfer running on the server…");
    try {
      // Always bake from the last geometry step (decimate/retopo), never from a
      // previously-baked output — baked meshes have xatlas UVs that don't correspond
      // to the source texture's UV layout, which scrambles the texture transfer.
      const lastGeomStep = [...steps].reverse().find((s) => s.op !== "bake" && s.output_asset_id);
      const loResAssetId = lastGeomStep?.output_asset_id ?? asset?.id ?? currentAssetId;

      const res = await fetch("/api/tools/retopology/bake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, loResAssetId, bakeMaps, reAtlas, sourceAssetId: asset?.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Bake failed (${res.status})`);
      }

      // Read the streaming NDJSON response
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let outputAssetId = "";
      let lineBuf = "";
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuf += decoder.decode(value, { stream: true });
        const parts = lineBuf.split("\n");
        lineBuf = parts.pop() ?? "";
        for (const line of parts) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as {
            stage?: string;
            progress?: number;
            done?: boolean;
            outputAssetId?: string;
            error?: string;
          };
          if (evt.progress != null) setBakeProgress(evt.progress);
          if (evt.stage)            setBakeStage(evt.stage);
          if (evt.done)             { outputAssetId = evt.outputAssetId ?? ""; break outer; }
          if (evt.error)            throw new Error(evt.error);
        }
      }
      if (!outputAssetId) throw new Error("Bake completed but no asset ID returned.");

      const step = await appendTier1Step({
        sessionId: session.id,
        userId,
        op: "bake",
        inputAssetId: currentAssetId,
        existingOutputAssetId: outputAssetId,
        outputPolyCount: workingPolys,
        stats: { bakeMaps, reAtlas },
      });

      const viewerBytes = await fetchAssetBytes(outputAssetId);
      setSteps((prev) => [...prev, step]);
      setSession((prev) => (prev ? { ...prev, current_asset_id: outputAssetId, current_step_id: step.id } : prev));
      setWorkingBuf(viewerBytes);
      setWorkingPolys(await countGlbTriangles(viewerBytes));
      setCompareToSource(false);
      setStatus("Texture bake complete — new UV atlas and baked maps applied.");
      onAssetCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bake failed.");
    } finally {
      setBusy(false);
      setBakeProgress(0);
      setBakeStage("");
    }
  }, [session, workingBuf, userId, currentAssetId, bakeMaps, reAtlas, asset?.id, asset?.name, steps.length, workingPolys]);

  const pendingRetopoStep = useMemo(() => {
    const retopoSteps = steps.filter((s) => s.op === "retopo");
    const last = retopoSteps[retopoSteps.length - 1];
    if (!last || last.status === "done" || last.status === "failed") return null;
    return last;
  }, [steps]);
  const pendingRetopo = pendingRetopoStep?.status as "queued" | "processing" | null ?? null;

  const cancelRetopo = useCallback(async () => {
    if (!pendingRetopoStep) return;
    try {
      await cancelPipelineStep(pendingRetopoStep.id);
      setSteps((prev) => prev.map((s) => s.id === pendingRetopoStep.id ? { ...s, status: "failed" } : s));
      setPendingTier2((prev) => prev.filter((p) => p.step.id !== pendingRetopoStep.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel job.");
    }
  }, [pendingRetopoStep]);

  const pendingAiRetopoStep = useMemo(() => {
    const aiSteps = steps.filter((s) => s.op === "meshanything");
    const last = aiSteps[aiSteps.length - 1];
    if (!last || last.status === "done" || last.status === "failed") return null;
    return last;
  }, [steps]);
  const pendingAiRetopo = pendingAiRetopoStep?.status as "queued" | "processing" | null ?? null;

  const cancelAiRetopo = useCallback(async () => {
    if (!pendingAiRetopoStep) return;
    try {
      await cancelPipelineStep(pendingAiRetopoStep.id);
      setSteps((prev) => prev.map((s) => s.id === pendingAiRetopoStep.id ? { ...s, status: "failed" } : s));
      setPendingTier2((prev) => prev.filter((p) => p.step.id !== pendingAiRetopoStep.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel AI retopo job.");
    }
  }, [pendingAiRetopoStep]);

  const applyAiRetopo = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError("");
    const faceTargets = { fast: 800, balanced: 2000, quality: 4000 };
    try {
      const { step, job } = await queueTier2Step({
        sessionId: session.id,
        userId,
        op: "meshanything",
        inputAssetId: currentAssetId,
        classification,
        targetPolys: faceTargets[aiRetopoPreset],
        mode: "retopo",
        adaptive: false,
        params: { preset: aiRetopoPreset },
      });
      setSteps((prev) => [...prev, step]);
      setPendingTier2((prev) => [...prev, { step, jobId: job.id }]);
      setStatus(`Queued AI retopology (${aiRetopoPreset}) on Forge worker.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue AI retopology.");
    } finally {
      setBusy(false);
    }
  }, [session, userId, currentAssetId, classification, aiRetopoPreset]);

  // ---- retopo density preview: client-side decimate to target for visual guidance ---
  useEffect(() => {
    if (!workingBuf || !retopoTargetPolys) { setRetopoPreviewBuf(null); return; }
    const id = setTimeout(async () => {
      try {
        const result = await optimizeGlb(workingBuf, { targetPolys: retopoTargetPolys, adaptive: false });
        setRetopoPreviewBuf(result.output.buffer as ArrayBuffer);
      } catch {
        setRetopoPreviewBuf(null);
      }
    }, 600);
    return () => clearTimeout(id);
  }, [retopoTargetPolys, workingBuf]);

  // Show a "worker offline" hint if the job hasn't moved in 45 s.
  const [workerOfflineHint, setWorkerOfflineHint] = useState(false);
  useEffect(() => {
    if (!pendingRetopo) { setWorkerOfflineHint(false); return; }
    const t = setTimeout(() => setWorkerOfflineHint(true), 45_000);
    return () => clearTimeout(t);
  }, [pendingRetopo]);

  const reduction = useMemo(
    () => (sourcePolys && workingPolys ? Math.round((1 - workingPolys / sourcePolys) * 100) : 0),
    [sourcePolys, workingPolys],
  );

  const viewerBuf = compareToSource ? sourceBuf : workingBuf;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <a href="/forge" className="text-[12px] no-underline hover:text-ink" style={{ color: "#c7bfb2" }}>← Weave Forge</a>
        <span style={{ color: "#c7bfb2" }}>/</span>
        <button onClick={onBack} className="text-[13px] font-bold hover:underline" style={{ color: "#e8e1d5" }}>Mesh Loom</button>
        <div className="flex-1" />
        {status && <div className="text-[12px] truncate max-w-[34ch]" style={{ color: "#c7bfb2" }}>{status}</div>}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            key="error-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="p-3 rounded-[9px] border text-[13px]"
            style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
        {/* ---- left: step rail ---- */}
        <div className="flex flex-col gap-5">
          <>
              <StepCard
                title="1 · Decimate"
                description={`Reduce triangle count${decimateMode === "adaptive" ? " — adaptive density keeps detail on sharp/curved regions" : " — uniform reduction across the whole mesh"}.`}
              >
                <div className="flex gap-2 mb-3">
                  {(["adaptive", "uniform"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setDecimateMode(m)}
                      className="flex-1 py-2 rounded-lg border text-[12.5px] font-semibold capitalize"
                      style={{ borderColor: decimateMode === m ? ACCENT : "rgba(255,255,255,0.08)", background: decimateMode === m ? "rgba(214,91,54,.14)" : "#2c2926", color: decimateMode === m ? "#fff3ec" : "#9b9082" }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[12.5px]" style={{ color: "#c7bfb2" }}>Target triangles</span>
                  <input
                    type="number"
                    min={200}
                    step={100}
                    value={targetPolys}
                    onChange={(e) => { const n = Math.round(Number(e.target.value)); if (n > 0) setTargetPolys(n); }}
                    onBlur={() => setTargetPolys((v) => Math.max(200, v))}
                    className="w-[110px] bg-[#26231f] border border-[#3d3530] rounded-md px-2 py-1 text-right text-[14px] font-bold outline-none"
                    style={{ color: "#f3946a" }}
                  />
                </div>
                {(() => {
                  const sMax = Math.max(1000, sourcePolys || asset?.poly_count || 1000);
                  const sVal = Math.min(targetPolys, sMax);
                  const pct = sMax > 200 ? Math.round(((sVal - 200) / (sMax - 200)) * 100) : 0;
                  return (
                    <input
                      type="range"
                      min={200}
                      max={sMax}
                      step={100}
                      value={sVal}
                      onChange={(e) => setTargetPolys(Number(e.target.value))}
                      className="w-full h-[4px] rounded-full cursor-pointer appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[14px] [&::-webkit-slider-thumb]:h-[14px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f2ede3] [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-track]:h-[4px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[#26231f] [&::-moz-range-progress]:h-[4px] [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-[#d65b36]"
                      style={{ background: `linear-gradient(to right, #d65b36 ${pct}%, #26231f ${pct}%)` }}
                    />
                  );
                })()}
                {decimateMode === "adaptive" && (
                  <div className="mt-3 flex flex-col gap-3 pb-1">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px]" style={{ color: "#c7bfb2" }}>Detail weight</span>
                        <span className="text-[12px] font-bold" style={{ color: "#f3946a" }}>{curvatureWeight.toFixed(1)}</span>
                      </div>
                      <input
                        type="range" min={1} max={10} step={0.5}
                        value={curvatureWeight}
                        onChange={(e) => setCurvatureWeight(Number(e.target.value))}
                        className="w-full h-[4px] rounded-full cursor-pointer appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[14px] [&::-webkit-slider-thumb]:h-[14px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f2ede3] [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:cursor-pointer"
                        style={{ background: `linear-gradient(to right, #d65b36 ${((curvatureWeight - 1) / 9) * 100}%, #26231f ${((curvatureWeight - 1) / 9) * 100}%)` }}
                      />
                      <p className="text-[10px] mt-0.5" style={{ color: "#6b6460" }}>Higher = more triangles kept on curved / detailed areas</p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px]" style={{ color: "#c7bfb2" }}>Feature lock</span>
                        <span className="text-[12px] font-bold" style={{ color: "#f3946a" }}>{Math.round(lockFraction * 100)}%</span>
                      </div>
                      <input
                        type="range" min={0} max={0.25} step={0.01}
                        value={lockFraction}
                        onChange={(e) => setLockFraction(Number(e.target.value))}
                        className="w-full h-[4px] rounded-full cursor-pointer appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[14px] [&::-webkit-slider-thumb]:h-[14px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f2ede3] [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:cursor-pointer"
                        style={{ background: `linear-gradient(to right, #d65b36 ${(lockFraction / 0.25) * 100}%, #26231f ${(lockFraction / 0.25) * 100}%)` }}
                      />
                      <p className="text-[10px] mt-0.5" style={{ color: "#6b6460" }}>Top N% of high-curvature vertices are never collapsed</p>
                    </div>
                  </div>
                )}
                <button
                  onClick={applyDecimate}
                  disabled={busy || !workingBuf}
                  className="w-full py-2.5 rounded-[9px] font-bold text-[13px] disabled:opacity-50"
                  style={{ background: "#d65b36", color: "#fff3ec" }}
                >
                  Apply
                </button>
              </StepCard>

              <StepCard title="2 · Segment objects" description="Splits the mesh into parts by existing material/connectivity boundaries — deterministic, works in any order." badge="Optional">
                <button
                  onClick={applySegment}
                  disabled={busy || !workingBuf}
                  className="w-full py-2.5 rounded-[9px] font-bold text-[13px] disabled:opacity-50"
                  style={{ background: "#d65b36", color: "#fff3ec" }}
                >
                  Apply
                </button>
                {segmentation && segments.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[11px] font-medium mb-2" style={{ color: "#c7bfb2" }}>
                      Uncheck segments to remove (accessories, inner geo, props):
                    </p>
                    <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                      {segments.map((seg) => {
                        const excluded = excludedSegIds.has(seg.id);
                        const hovered = hoveredSegId === seg.id;
                        return (
                          <button
                            key={seg.id}
                            onClick={() =>
                              setExcludedSegIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(seg.id)) next.delete(seg.id);
                                else next.add(seg.id);
                                return next;
                              })
                            }
                            onMouseEnter={() => setHoveredSegId(seg.id)}
                            onMouseLeave={() => setHoveredSegId(null)}
                            className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-[7px] border transition-colors"
                            style={{
                              borderColor: excluded ? "rgba(227,92,92,.4)" : hovered ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.06)",
                              background: excluded ? "rgba(227,92,92,.08)" : hovered ? "rgba(255,255,255,.04)" : "#26231f",
                            }}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ background: excluded ? "rgba(227,92,92,.5)" : segmentColor(seg.id) }}
                            />
                            <span
                              className="text-[11.5px] truncate flex-1"
                              style={{ color: excluded ? "#e88" : "#c7bfb2" }}
                            >
                              {seg.materialName ?? `Segment ${seg.id + 1}`}
                            </span>
                            <span className="text-[11px] flex-shrink-0" style={{ color: "#6b6460" }}>
                              {seg.triangleCount.toLocaleString()} tris
                            </span>
                            {excluded && <span className="text-[10px] flex-shrink-0" style={{ color: "#e85c5c" }}>✕</span>}
                          </button>
                        );
                      })}
                    </div>
                    {excludedSegIds.size > 0 && (
                      <button
                        onClick={applyMask}
                        disabled={busy}
                        className="w-full mt-3 py-2 rounded-[9px] font-bold text-[13px] border disabled:opacity-50"
                        style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.1)", color: "#f0a6a6" }}
                      >
                        Remove {excludedSegIds.size} segment{excludedSegIds.size === 1 ? "" : "s"}
                      </button>
                    )}
                  </div>
                )}
              </StepCard>

              <StepCard title="3 · Retopology" description="Quad-dominant remesh with proper edge loops on the Forge worker — best for characters and creatures." badge="Optional">
                <div className="flex gap-1.5 flex-wrap mb-3">
                  {CLASSIFICATIONS.map((c) => {
                    const on = classification === c.value;
                    return (
                      <button
                        key={c.value}
                        title={c.blurb}
                        onClick={() => setClassification(c.value)}
                        className="px-2.5 py-1 rounded-full border text-[12px] font-semibold"
                        style={{ borderColor: on ? ACCENT : "rgba(255,255,255,.08)", background: on ? "rgba(214,91,54,.14)" : "#26231f", color: on ? "#fff3ec" : "#9b9082" }}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[12.5px]" style={{ color: "#c7bfb2" }}>Target triangles</span>
                  <input
                    type="number"
                    min={200}
                    step={100}
                    value={retopoTargetPolys}
                    onChange={(e) => { const n = Math.round(Number(e.target.value)); if (n > 0) setRetopoTargetPolys(n); }}
                    onBlur={() => setRetopoTargetPolys((v) => Math.max(200, v))}
                    className="w-[110px] bg-[#26231f] border border-[#3d3530] rounded-md px-2 py-1 text-right text-[14px] font-bold outline-none"
                    style={{ color: "#f3946a" }}
                  />
                </div>
                {(() => {
                  const rMax = 200000;
                  const rVal = Math.min(retopoTargetPolys, rMax);
                  const pct = rMax > 200 ? Math.round(((rVal - 200) / (rMax - 200)) * 100) : 0;
                  return (
                    <input
                      type="range"
                      min={200}
                      max={rMax}
                      step={500}
                      value={rVal}
                      onChange={(e) => setRetopoTargetPolys(Number(e.target.value))}
                      className="w-full h-[4px] rounded-full cursor-pointer appearance-none mb-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[14px] [&::-webkit-slider-thumb]:h-[14px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f2ede3] [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-track]:h-[4px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[#26231f] [&::-moz-range-progress]:h-[4px] [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-[#d65b36]"
                      style={{ background: `linear-gradient(to right, #d65b36 ${pct}%, #26231f ${pct}%)` }}
                    />
                  );
                })()}
                {pendingRetopo ? (
                  <div className="flex gap-2">
                    <div
                      className="flex-1 py-2.5 rounded-[9px] font-bold text-[13px] text-center opacity-40 cursor-not-allowed select-none"
                      style={{ background: "#d65b36", color: "#fff3ec" }}
                    >
                      {pendingRetopo === "queued" ? "Queued on Forge worker…" : "Processing on Forge worker…"}
                    </div>
                    <button
                      onClick={cancelRetopo}
                      className="px-3 py-2.5 rounded-[9px] font-bold text-[13px] border"
                      style={{ borderColor: "rgba(255,255,255,0.12)", background: "#2c2926", color: "#c7bfb2" }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={applyRetopo}
                    disabled={busy}
                    className="w-full py-2.5 rounded-[9px] font-bold text-[13px] disabled:opacity-50"
                    style={{ background: "#d65b36", color: "#fff3ec" }}
                  >
                    Apply
                  </button>
                )}
              </StepCard>

              <StepCard
                title="3.5 · AI Retopo"
                description="AI-generated topology using MeshAnything V2 — recognises bipedal structure and creates clean edge loops for hands, joints, and fused geometry."
                badge="Beta"
                badgeColor="purple"
              >
                <div className="flex gap-1.5 mb-3">
                  {(["fast", "balanced", "quality"] as const).map((p) => {
                    const labels = { fast: "Fast · 800f", balanced: "Balanced · 2k", quality: "Quality · 4k" };
                    const on = aiRetopoPreset === p;
                    return (
                      <button
                        key={p}
                        onClick={() => setAiRetopoPreset(p)}
                        className="flex-1 py-1.5 rounded-lg border text-[12px] font-semibold"
                        style={{
                          borderColor: on ? "#6c5fa8" : "rgba(255,255,255,.08)",
                          background: on ? "rgba(108,95,168,.2)" : "#26231f",
                          color: on ? "#d4c4ff" : "#9b9082",
                        }}
                      >
                        {labels[p]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] mb-3" style={{ color: "#6b6460" }}>
                  Requires <code className="text-[10px]" style={{ color: "#b4a6e0" }}>REPLICATE_API_KEY</code> in Vercel + Modal env. Output: ~60–90 s.
                </p>
                {pendingAiRetopo ? (
                  <div className="flex gap-2">
                    <div
                      className="relative flex-1 overflow-hidden py-2.5 rounded-[9px] font-bold text-[13px] text-center cursor-not-allowed select-none"
                      style={{ background: "#3d2f6a", color: "#d4c4ff" }}
                    >
                      {pendingAiRetopo === "queued" ? "Queued for AI mesh…" : "AI generating topology…"}
                      <motion.div
                        className="absolute inset-y-0 w-[45%] bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none"
                        animate={{ x: ["-100%", "250%"] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                      />
                    </div>
                    <button
                      onClick={cancelAiRetopo}
                      className="px-3 py-2.5 rounded-[9px] font-bold text-[13px] border"
                      style={{ borderColor: "rgba(255,255,255,0.12)", background: "#2c2926", color: "#c7bfb2" }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={applyAiRetopo}
                    disabled={busy}
                    className="w-full py-2.5 rounded-[9px] font-bold text-[13px] disabled:opacity-50"
                    style={{ background: "#4a3a8a", color: "#e8e0ff" }}
                  >
                    Apply AI Retopo
                  </button>
                )}
              </StepCard>

              <StepCard
                title="4 · Bake Textures"
                description={`Generates a new UV atlas with xatlas and transfers textures from the original source onto the decimated mesh — works regardless of UV changes.${asset ? ` Source: ${asset.name}` : ""}`}
              >
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {BAKE_OPTIONS.map((m) => {
                    const on = bakeMaps.includes(m);
                    return (
                      <button
                        key={m}
                        onClick={() => setBakeMaps((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))}
                        className="text-[12px] px-2.5 py-1 rounded-full border capitalize"
                        style={{ borderColor: on ? ACCENT : "rgba(255,255,255,0.08)", background: on ? "rgba(214,91,54,.14)" : "#2c2926", color: on ? "#fff3ec" : "#9b9082" }}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={applyBake}
                  disabled={busy || !workingBuf}
                  className="w-full py-2.5 rounded-[9px] font-bold text-[13px] disabled:opacity-50"
                  style={{ background: "#d65b36", color: "#fff3ec" }}
                >
                  {busy ? "Baking…" : "Apply"}
                </button>
              </StepCard>
          </>
        </div>

        {/* ---- right: viewer + history ---- */}
        <div className="flex flex-col gap-5">
          <div className="rounded-[12px] overflow-hidden bg-[#241f1b]">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2a2420] flex-wrap">
                <button
                  onClick={() => setCompareToSource((v) => !v)}
                  disabled={!sourceBuf}
                  className="px-3 py-1.5 rounded-lg border text-[12.5px] font-semibold disabled:opacity-40"
                  style={{ borderColor: compareToSource ? ACCENT : "rgba(255,255,255,0.08)", background: compareToSource ? "rgba(214,91,54,.14)" : "transparent", color: compareToSource ? "#fff3ec" : "#9b9082" }}
                >
                  {compareToSource ? "Viewing source" : "Viewing current"}
                </button>
                <button
                  onClick={() => setWireframe((v) => !v)}
                  className="px-3 py-1.5 rounded-lg border text-[12.5px] font-semibold"
                  style={{ borderColor: wireframe ? ACCENT : "rgba(255,255,255,0.08)", background: wireframe ? "rgba(214,91,54,.14)" : "transparent", color: wireframe ? "#fff3ec" : "#9b9082" }}
                >
                  Wireframe {wireframe ? "on" : "off"}
                </button>
                <button
                  onClick={() => setShowGrid((v) => !v)}
                  className="px-3 py-1.5 rounded-lg border text-[12.5px] font-semibold"
                  style={{ borderColor: showGrid ? ACCENT : "rgba(255,255,255,0.08)", background: showGrid ? "rgba(214,91,54,.14)" : "transparent", color: showGrid ? "#fff3ec" : "#9b9082" }}
                >
                  Grid {showGrid ? "on" : "off"}
                </button>
                <button
                  onClick={() => setClayMode((v) => !v)}
                  className="px-3 py-1.5 rounded-lg border text-[12.5px] font-semibold"
                  style={{ borderColor: clayMode ? ACCENT : "rgba(255,255,255,0.08)", background: clayMode ? "rgba(214,91,54,.14)" : "transparent", color: clayMode ? "#fff3ec" : "#9b9082" }}
                >
                  Clay {clayMode ? "on" : "off"}
                </button>
                {segmentation && (
                  <button
                    onClick={() => setSegmentation(null)}
                    className="px-3 py-1.5 rounded-lg border text-[12.5px] font-semibold"
                    style={{ borderColor: "rgba(255,255,255,0.08)", color: "#9b9082" }}
                  >
                    Clear segment overlay
                  </button>
                )}
                <div className="w-px h-5 bg-line mx-1" />
                {([null, "albedo", "normal", "ao", "roughness", "metallic"] as const).map((c) => (
                  <button
                    key={c ?? "shaded"}
                    onClick={() => setTextureChannel(c)}
                    className="px-3 py-1.5 rounded-lg border text-[12.5px] font-semibold capitalize"
                    style={{
                      borderColor: textureChannel === c ? ACCENT : "rgba(255,255,255,0.08)",
                      background: textureChannel === c ? "rgba(214,91,54,.14)" : "transparent",
                      color: textureChannel === c ? "#fff3ec" : "#9b9082",
                    }}
                  >
                    {c ?? "Combined"}
                  </button>
                ))}
                <div className="flex-1" />
                <div className="text-[12px]" style={{ color: "#c7bfb2" }}>
                  {compareToSource ? fmt(sourcePolys) : fmt(workingPolys)} tris{!compareToSource && reduction > 0 ? ` · ${reduction}% lighter` : ""}
                </div>
              </div>
              <div className="h-[clamp(320px,52vh,700px)]">
                {!viewerBuf ? (
                  <div className="w-full h-full flex items-center justify-center text-[13px]" style={{ color: "#9b9082" }}>Loading…</div>
                ) : (
                  <ModelViewer
                    key={compareToSource ? `source-${asset?.id}` : `current-${currentAssetId}`}
                    data={viewerBuf}
                    wireframe={wireframe}
                    showGrid={showGrid}
                    accent={ACCENT}
                    segmentation={compareToSource ? null : segmentation}
                    textureChannel={clayMode ? null : textureChannel}
                    clayMode={clayMode}
                    focusedSegId={compareToSource ? null : hoveredSegId}
                    onLoadError={setError}
                    previewData={compareToSource ? null : retopoPreviewBuf}
                  />
                )}
              </div>
            </div>

            {/* ---- global progress bar ---- */}
            {(busy || pendingRetopo) && (
              <div className="px-1">
                <div className="flex items-center justify-between text-[11px] mb-1.5" style={{ color: "#9b9082" }}>
                  <span className="capitalize">
                    {pendingRetopo
                      ? (pendingRetopo === "queued" ? "Waiting for Forge worker…" : "Processing on Forge worker…")
                      : (bakeStage || "Working…")}
                  </span>
                  {pendingRetopo && (
                    <button
                      onClick={cancelRetopo}
                      className="text-[11px] underline cursor-pointer"
                      style={{ color: "#9b9082" }}
                    >
                      Cancel
                    </button>
                  )}
                  {busy && bakeProgress > 0 && <span>{Math.round(bakeProgress * 100)}%</span>}
                </div>
                <div className="h-[3px] rounded-full overflow-hidden" style={{ background: "#26231f" }}>
                  {busy && bakeProgress > 0 ? (
                    <div
                      className="h-full rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${Math.max(bakeProgress * 100, 2)}%`, background: "#d65b36" }}
                    />
                  ) : (
                    <div className="h-full rounded-full animate-pulse" style={{ width: "55%", background: "#d65b36" }} />
                  )}
                </div>
                {workerOfflineHint && (
                  <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "#f0a6a6" }}>
                    Still waiting — the Forge worker may not be running.
                    Deploy it: <code className="text-[10px]" style={{ color: "#fbbf99" }}>modal deploy worker/modal_app.py</code>
                    {" "}(requires Modal secret <code className="text-[10px]" style={{ color: "#fbbf99" }}>woven-worker-env</code> with <code className="text-[10px]" style={{ color: "#fbbf99" }}>WOVEN_BASE_URL</code> set to your Vercel deployment URL).
                  </p>
                )}
              </div>
            )}

            <div className="rounded-[12px] p-5">
              <p className="text-[11px] font-bold tracking-[.12em] uppercase mb-3" style={{ color: "#e8e1d5" }}>Pipeline history</p>
              {steps.length === 0 ? (
                <div className="text-[12.5px]" style={{ color: "#c7bfb2" }}>Applied steps will appear here, in the order you run them.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  <AnimatePresence mode="popLayout">
                  {steps.map((s) => (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.94 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      className="flex items-center gap-2.5 p-2.5 rounded-[9px] border border-[#2a2420] bg-[#201d1a]">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[13px] capitalize" style={{ color: "#e8e1d5" }}>{s.seq} · {s.op.replace("_", " ")}</div>
                        <div className="text-[11.5px]" style={{ color: "#8e8579" }}>{s.tier} {s.error ? `· ${s.error}` : ""}</div>
                      </div>
                      <StepBadge status={s.status} />
                      <button
                        onClick={async () => {
                          try {
                            await deletePipelineStep(s.id);
                            setSteps((prev) => prev.filter((x) => x.id !== s.id));
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Could not delete step.");
                          }
                        }}
                        className="text-[12px] shrink-0 hover:text-[#f3946a]"
                        style={{ color: "#8e8579" }}
                        title="Delete step"
                      >✕</button>
                    </motion.div>
                  ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
  );
}

