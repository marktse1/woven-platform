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
import { segmentByConnectivity } from "@/lib/retopo/segment";
import type { SegmentationOverlay, TextureChannel } from "@/components/tools/ModelViewer";
import StepCard from "./StepCard";
import FinalizeStep from "./FinalizeStep";

const ModelViewer = dynamic(() => import("@/components/tools/ModelViewer"), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-dim text-[12px]">Loading viewer…</div>,
});

const ACCENT = "#56a6e8";

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString();
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
    processing: { bg: "rgba(86,166,232,.16)", c: "#8fc6f0", label: "processing" },
    done: { bg: "rgba(123,194,74,.16)", c: "#a6e06a", label: "done" },
    failed: { bg: "rgba(227,92,92,.16)", c: "#e88", label: "failed" },
  };
  const s = map[status];
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase" style={{ background: s.bg, color: s.c }}>{s.label}</span>;
}

type Props = {
  asset: AssetRow;
  userId: string;
  onBack: () => void;
};

export default function PipelineStudio({ asset, userId, onBack }: Props) {
  const [session, setSession] = useState<PipelineSessionRow | null>(null);
  const [steps, setSteps] = useState<PipelineStepRow[]>([]);
  const [classification, setClassification] = useState<Classification>("auto");

  const [sourceBuf, setSourceBuf] = useState<ArrayBuffer | null>(null);
  const [sourcePolys, setSourcePolys] = useState(0);
  const [workingBuf, setWorkingBuf] = useState<ArrayBuffer | null>(null);
  const [workingPolys, setWorkingPolys] = useState(0);

  const [targetPolys, setTargetPolys] = useState(20000);
  const [decimateMode, setDecimateMode] = useState<"uniform" | "adaptive">("adaptive");
  const [bakeMaps, setBakeMaps] = useState<string[]>(["normal", "ao", "albedo"]);
  const [dilationPx, setDilationPx] = useState(16);

  const [segmentation, setSegmentation] = useState<SegmentationOverlay | null>(null);
  const [textureChannel, setTextureChannel] = useState<TextureChannel | null>(null);
  const [wireframe, setWireframe] = useState(true);
  const [compareToSource, setCompareToSource] = useState(false);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pendingTier2, setPendingTier2] = useState<{ step: PipelineStepRow; jobId: string }[]>([]);

  const hasSteps = steps.length > 0;
  const isCharacter = needsRetopoWorker(classification);

  // ---- initial load: source bytes + existing session/steps, if any --------
  useEffect(() => {
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
          setSession(null);
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
  }, [asset.id, asset.storage_path]);

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
            setStatus(`${updatedStep.op === "finalize" ? "Finalize" : "Retopology"} complete.`);
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

  const currentAssetId = session?.current_asset_id ?? asset.id;

  const startPipeline = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const created = await openOrGetSession(userId, asset.id, classification);
      setSession(created);
      setSteps([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the pipeline.");
    } finally {
      setBusy(false);
    }
  }, [userId, asset.id, classification]);

  const applyDecimate = useCallback(async () => {
    if (!session || !workingBuf) return;
    setBusy(true);
    setError("");
    setStatus("Optimizing geometry…");
    try {
      const ratio = Math.min(0.99, Math.max(0.01, targetPolys / (workingPolys || sourcePolys || 1)));
      const res =
        decimateMode === "adaptive"
          ? await optimizeGlbAdaptive(workingBuf, { ratio })
          : await optimizeGlb(workingBuf, { ratio, adaptive: false });
      const outBytes = res.output.slice().buffer;

      const step = await appendTier1Step({
        sessionId: session.id,
        userId,
        op: decimateMode === "adaptive" ? "adaptive_density" : "decimate",
        inputAssetId: currentAssetId,
        outputName: `${asset.name.replace(/\.(glb|gltf)$/i, "")}-step${steps.length + 1}.glb`,
        outputBytes: outBytes,
        outputPolyCount: res.resultPolys,
        params: { targetPolys, mode: decimateMode },
        stats: { sourcePolys: res.sourcePolys, resultPolys: res.resultPolys, reduction: res.reduction },
      });

      setSteps((prev) => [...prev, step]);
      setSession((prev) => (prev ? { ...prev, current_asset_id: step.output_asset_id, current_step_id: step.id } : prev));
      setWorkingBuf(outBytes);
      setWorkingPolys(res.resultPolys);
      setSegmentation(null);
      setStatus(`Reduced to ${res.resultPolys.toLocaleString()} tris (${Math.round(res.reduction * 100)}% lighter).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decimate failed.");
    } finally {
      setBusy(false);
    }
  }, [session, workingBuf, targetPolys, workingPolys, sourcePolys, decimateMode, userId, asset.name, steps.length, currentAssetId]);

  const applySegment = useCallback(async () => {
    if (!session || !workingBuf) return;
    setBusy(true);
    setError("");
    setStatus("Segmenting…");
    try {
      const result = await segmentByConnectivity(workingBuf);
      setSegmentation({ trianglePerSegment: result.trianglePerSegment });

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Segmentation failed.");
    } finally {
      setBusy(false);
    }
  }, [session, workingBuf, userId, currentAssetId]);

  const applyRetopo = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const { step, job } = await queueTier2Step({
        sessionId: session.id,
        userId,
        op: "retopo",
        inputAssetId: currentAssetId,
        classification,
        targetPolys,
        mode: "retopo",
        adaptive: decimateMode === "adaptive",
      });
      setSteps((prev) => [...prev, step]);
      setPendingTier2((prev) => [...prev, { step, jobId: job.id }]);
      setStatus(`Queued ${classification} retopology + edge loops on the Forge worker.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue retopology.");
    } finally {
      setBusy(false);
    }
  }, [session, userId, currentAssetId, classification, targetPolys, decimateMode]);

  const applyFinalize = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const { step, job } = await queueTier2Step({
        sessionId: session.id,
        userId,
        op: "finalize",
        inputAssetId: currentAssetId,
        classification,
        targetPolys: workingPolys || targetPolys,
        bakeMaps,
        params: { dilationPx },
      });
      setSteps((prev) => [...prev, step]);
      setPendingTier2((prev) => [...prev, { step, jobId: job.id }]);
      setStatus("Finalizing — UV unwrap + texture bake queued on the Forge worker.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue finalize.");
    } finally {
      setBusy(false);
    }
  }, [session, userId, currentAssetId, classification, workingPolys, targetPolys, bakeMaps, dilationPx]);

  const pendingRetopo = pendingTier2.find((p) => p.step.op === "retopo")?.step.status ?? null;
  const pendingFinalize = pendingTier2.find((p) => p.step.op === "finalize")?.step.status ?? null;

  const reduction = useMemo(
    () => (sourcePolys && workingPolys ? Math.round((1 - workingPolys / sourcePolys) * 100) : 0),
    [sourcePolys, workingPolys],
  );

  const viewerBuf = compareToSource ? sourceBuf : workingBuf;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-[12px] text-dim hover:text-ink">← Library</button>
        <span className="text-dim">/</span>
        <div className="text-[13px] font-bold truncate max-w-[28ch]">{asset.name}</div>
        <div className="flex-1" />
        {status && <div className="text-[12px] text-dim truncate max-w-[34ch]">{status}</div>}
      </div>

      {error && (
        <div className="p-3 rounded-[9px] border text-[13px]" style={{ borderColor: "rgba(227,92,92,.4)", background: "rgba(227,92,92,.08)", color: "#f0a6a6" }}>
          {error}
        </div>
      )}

      {!session ? (
        <div className="bg-panel border border-line rounded-[12px] p-5">
          <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">What is it?</p>
          <p className="text-[12px] text-dim mb-3">
            This decides whether the pipeline runs true quad retopology with edge loops, or just decimates — set once per asset.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
            {CLASSIFICATIONS.map((c) => {
              const on = classification === c.value;
              return (
                <button
                  key={c.value}
                  onClick={() => setClassification(c.value)}
                  className="text-left rounded-[10px] border p-3"
                  style={{ borderColor: on ? ACCENT : "#26384a", background: on ? "rgba(86,166,232,.10)" : "#0d141c" }}
                >
                  <div className="flex items-center gap-2">
                    <span>{c.icon}</span>
                    <span className="font-bold text-[13px]">{c.label}</span>
                  </div>
                  <div className="text-[11.5px] text-dim mt-1">{c.blurb}</div>
                </button>
              );
            })}
          </div>
          <button
            onClick={startPipeline}
            disabled={busy}
            className="w-full py-3 rounded-[10px] font-bold text-[13.5px] disabled:opacity-50"
            style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}
          >
            Start pipeline
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
          {/* ---- left: step rail ---- */}
          <div className="flex flex-col gap-5">
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
                    style={{ borderColor: decimateMode === m ? ACCENT : "#26384a", background: decimateMode === m ? "rgba(86,166,232,.14)" : "#0d141c", color: decimateMode === m ? "#cfe6fb" : "#8aa0b4" }}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[12.5px] text-muted">Target triangles</span>
                <input
                  type="number"
                  min={200}
                  step={100}
                  value={targetPolys}
                  onChange={(e) => setTargetPolys(Math.max(200, Math.round(Number(e.target.value) || 0)))}
                  className="w-[110px] bg-[#0a0e13] border border-line rounded-md px-2 py-1 text-right text-[14px] font-bold outline-none focus:border-accent"
                  style={{ color: ACCENT }}
                />
              </div>
              <input
                type="range"
                min={200}
                max={Math.max(1000, workingPolys || sourcePolys || 100000)}
                step={100}
                value={Math.min(targetPolys, Math.max(1000, workingPolys || sourcePolys || 100000))}
                onChange={(e) => setTargetPolys(Number(e.target.value))}
                className="w-full accent-[#56a6e8]"
              />
              <button
                onClick={applyDecimate}
                disabled={busy || !workingBuf}
                className="w-full mt-3 py-2.5 rounded-[9px] font-bold text-[13px] disabled:opacity-50"
                style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}
              >
                Apply
              </button>
            </StepCard>

            <StepCard title="2 · Segment objects" description="Splits the mesh into parts by existing material/connectivity boundaries — deterministic, works in any order.">
              <button
                onClick={applySegment}
                disabled={busy || !workingBuf}
                className="w-full py-2.5 rounded-[9px] font-bold text-[13px] disabled:opacity-50"
                style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}
              >
                Apply
              </button>
              {segmentation && (
                <p className="text-[11.5px] text-dim mt-2">Overlay is showing in the viewer — toggle off with the wireframe controls.</p>
              )}
            </StepCard>

            {isCharacter && (
              <StepCard
                title="3 · Retopology + edge loops"
                description={`Quad-dominant remesh with proper edge loops for ${classification} animation, on the Forge worker.`}
              >
                <button
                  onClick={applyRetopo}
                  disabled={busy || pendingRetopo === "queued" || pendingRetopo === "processing"}
                  className="w-full py-2.5 rounded-[9px] font-bold text-[13px] disabled:opacity-50"
                  style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}
                >
                  {pendingRetopo === "queued" || pendingRetopo === "processing" ? "Queued on Forge worker…" : "Apply"}
                </button>
              </StepCard>
            )}

            <FinalizeStep
              stepNumber={isCharacter ? 4 : 3}
              bakeMaps={bakeMaps}
              onToggleBakeMap={(m) => setBakeMaps((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))}
              dilationPx={dilationPx}
              onDilationChange={setDilationPx}
              onFinalize={applyFinalize}
              busy={busy}
              disabled={!hasSteps}
              pendingStatus={pendingFinalize}
              error={null}
            />
          </div>

          {/* ---- right: viewer + history ---- */}
          <div className="flex flex-col gap-5">
            <div className="bg-panel border border-line rounded-[12px] overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-line flex-wrap">
                <button
                  onClick={() => setCompareToSource((v) => !v)}
                  disabled={!sourceBuf}
                  className="px-3 py-1.5 rounded-lg border text-[12.5px] font-semibold disabled:opacity-40"
                  style={{ borderColor: compareToSource ? ACCENT : "#26384a", background: compareToSource ? "rgba(86,166,232,.14)" : "transparent", color: compareToSource ? "#cfe6fb" : "#8aa0b4" }}
                >
                  {compareToSource ? "Viewing source" : "Viewing current"}
                </button>
                <button
                  onClick={() => setWireframe((v) => !v)}
                  className="px-3 py-1.5 rounded-lg border text-[12.5px] font-semibold"
                  style={{ borderColor: wireframe ? ACCENT : "#26384a", background: wireframe ? "rgba(86,166,232,.14)" : "transparent", color: wireframe ? "#cfe6fb" : "#8aa0b4" }}
                >
                  Wireframe {wireframe ? "on" : "off"}
                </button>
                {segmentation && (
                  <button
                    onClick={() => setSegmentation(null)}
                    className="px-3 py-1.5 rounded-lg border text-[12.5px] font-semibold"
                    style={{ borderColor: "#26384a", color: "#8aa0b4" }}
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
                      borderColor: textureChannel === c ? ACCENT : "#26384a",
                      background: textureChannel === c ? "rgba(86,166,232,.14)" : "transparent",
                      color: textureChannel === c ? "#cfe6fb" : "#8aa0b4",
                    }}
                  >
                    {c ?? "Shaded"}
                  </button>
                ))}
                <div className="flex-1" />
                <div className="text-[12px] text-dim">
                  {compareToSource ? fmt(sourcePolys) : fmt(workingPolys)} tris{!compareToSource && reduction > 0 ? ` · ${reduction}% lighter` : ""}
                </div>
              </div>
              <div className="h-[min(62vh,560px)] min-h-[320px]">
                {!viewerBuf ? (
                  <div className="w-full h-full flex items-center justify-center text-dim text-[13px]">Loading…</div>
                ) : (
                  <ModelViewer
                    key={compareToSource ? `source-${asset.id}` : `current-${currentAssetId}`}
                    data={viewerBuf}
                    wireframe={wireframe}
                    accent={ACCENT}
                    segmentation={compareToSource ? null : segmentation}
                    textureChannel={compareToSource ? null : textureChannel}
                    onLoadError={setError}
                  />
                )}
              </div>
            </div>

            <div className="bg-panel border border-line rounded-[12px] p-5">
              <p className="text-[11px] font-bold tracking-[.12em] uppercase text-muted mb-3">Pipeline history</p>
              {steps.length === 0 ? (
                <div className="text-[12.5px] text-dim">Applied steps will appear here, in the order you run them.</div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto">
                  {steps.map((s) => (
                    <div key={s.id} className="flex items-center gap-2.5 p-2.5 rounded-[9px] border border-line bg-[#0a0e13]">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[13px] capitalize">{s.seq} · {s.op.replace("_", " ")}</div>
                        <div className="text-[11.5px] text-dim">{s.tier} {s.error ? `· ${s.error}` : ""}</div>
                      </div>
                      <StepBadge status={s.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
