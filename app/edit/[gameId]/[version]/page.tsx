"use client";

import { useEffect, useRef, useState, use as usePromise } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { streamNdjson } from "@/lib/uploads";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type Build = { id: string; version: string; entry_file: string | null; status: string };
type ChatMessage = { role: "user" | "assistant"; content: string };
type EditLogEntry = { path: string; before: string | null; after: string; at: number };

function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    js: "javascript", mjs: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript",
    json: "json", html: "html", css: "css", md: "markdown", py: "python",
  };
  return map[ext ?? ""] ?? "plaintext";
}

export default function EditPage({ params }: { params: Promise<{ gameId: string; version: string }> }) {
  const { gameId, version } = usePromise(params);

  const [build, setBuild] = useState<Build | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loadedHash, setLoadedHash] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [editLog, setEditLog] = useState<EditLogEntry[]>([]);

  const [rebuildStatus, setRebuildStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [rebuildStage, setRebuildStage] = useState("");

  const streamingReplyRef = useRef("");
  const [streamingReply, setStreamingReply] = useState("");

  useEffect(() => {
    fetch(`/api/games/${gameId}/builds`)
      .then((r) => r.json())
      .then((body: { builds?: Build[] }) => {
        const match = body.builds?.find((b) => b.version === version);
        if (match) setBuild(match);
        else setError("Build not found");
      })
      .catch(() => setError("Could not load build"));
  }, [gameId, version]);

  useEffect(() => {
    if (!build) return;
    fetch(`/api/games/${gameId}/builds/${build.id}/source`)
      .then((r) => r.json())
      .then((body: { files?: string[]; error?: string }) => {
        if (body.error) { setError(body.error); return; }
        setFiles(body.files ?? []);
        const entry = build.entry_file && body.files?.includes(build.entry_file) ? build.entry_file : body.files?.[0];
        if (entry) openFile(entry);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, gameId]);

  async function openFile(path: string) {
    if (!build) return;
    const res = await fetch(`/api/games/${gameId}/builds/${build.id}/source?path=${encodeURIComponent(path)}`);
    const body = await res.json();
    if (body.error) { setError(body.error); return; }
    setSelectedPath(path);
    setContent(body.content);
    setLoadedHash(body.hash);
    setDirty(false);
  }

  async function save() {
    if (!build || !selectedPath) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/games/${gameId}/builds/${build.id}/source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath, content, expectedHash: loadedHash }),
      });
      const resBody = await res.json();
      if (!res.ok) throw new Error(resBody.error ?? "Save failed");
      setLoadedHash(resBody.hash);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function sendChat() {
    if (!chatInput.trim() || chatBusy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: chatInput }];
    setMessages(next);
    setChatInput("");
    setChatBusy(true);
    streamingReplyRef.current = "";
    setStreamingReply("");

    try {
      await streamNdjson(`/api/edit/${gameId}/${version}/chat`, { messages: next }, (evt) => {
        if (evt.type === "text" && typeof evt.text === "string") {
          streamingReplyRef.current += evt.text;
          setStreamingReply(streamingReplyRef.current);
        } else if (evt.type === "edit") {
          setEditLog((prev) => [...prev, { path: evt.path as string, before: evt.before as string | null, after: evt.after as string, at: Date.now() }]);
          if (evt.path === selectedPath) {
            setContent(evt.after as string);
          }
        } else if (evt.type === "error") {
          setError(evt.error as string);
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
    } finally {
      setMessages((prev) => [...prev, { role: "assistant", content: streamingReplyRef.current }]);
      setStreamingReply("");
      setChatBusy(false);
      if (build) {
        fetch(`/api/games/${gameId}/builds/${build.id}/source`)
          .then((r) => r.json())
          .then((body: { files?: string[] }) => setFiles(body.files ?? []));
      }
    }
  }

  async function undoEdit(entry: EditLogEntry) {
    if (!build || entry.before === null) return;
    await fetch(`/api/games/${gameId}/builds/${build.id}/source`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: entry.path, content: entry.before }),
    });
    if (entry.path === selectedPath) openFile(entry.path);
  }

  async function rebuild() {
    if (!build) return;
    setRebuildStatus("running");
    setError("");
    try {
      await streamNdjson(`/api/games/${gameId}/builds/${build.id}/rebuild`, {}, (evt) => {
        if (typeof evt.stage === "string") setRebuildStage(evt.stage);
        if (evt.done) setRebuildStatus(evt.error ? "error" : "done");
        if (evt.error) setError(evt.error as string);
      });
    } catch (e) {
      setRebuildStatus("error");
      setError(e instanceof Error ? e.message : "Rebuild failed");
    }
  }

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#070b11] text-ink flex flex-col">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-line bg-panel/80 shrink-0">
        <Link href="/dashboard" className="text-[13px] text-dim hover:text-ink">← Dashboard</Link>
        <div className="text-[13px] font-semibold">Editing build {version}</div>
        <div className="flex-1" />
        <button
          onClick={rebuild}
          disabled={rebuildStatus === "running"}
          className="px-3 py-1.5 rounded-[8px] text-[12.5px] font-bold disabled:opacity-50"
          style={{ background: "linear-gradient(180deg,#56a6e8,#2c6aa0)", color: "#06121d" }}
        >
          {rebuildStatus === "running" ? `Rebuilding… ${rebuildStage}` : "Rebuild & submit for review"}
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-3 p-2.5 rounded-[8px] text-[12.5px]" style={{ background: "rgba(227,92,92,.08)", border: "1px solid rgba(227,92,92,.4)", color: "#f0a6a6" }}>
          {error}
        </div>
      )}
      {rebuildStatus === "done" && (
        <div className="mx-6 mt-3 p-2.5 rounded-[8px] text-[12.5px] text-green" style={{ background: "rgba(123,194,74,.08)", border: "1px solid rgba(123,194,74,.4)" }}>
          Rebuild complete — a new build version was created and submitted for review.
        </div>
      )}

      <div className="flex-1 grid" style={{ gridTemplateColumns: "220px 1fr 340px" }}>
        <div className="border-r border-line overflow-y-auto p-2">
          {files.map((f) => (
            <button
              key={f}
              onClick={() => openFile(f)}
              className="w-full text-left px-2.5 py-1.5 rounded-[6px] text-[12.5px] font-mono truncate hover:bg-white/[.04]"
              style={{ background: f === selectedPath ? "rgba(86,166,232,.14)" : undefined, color: f === selectedPath ? "#cfe6fb" : "#c7d0d8" }}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
            <span className="text-[12.5px] font-mono text-dim truncate">{selectedPath ?? "No file selected"}</span>
            <div className="flex-1" />
            <button
              onClick={save}
              disabled={!selectedPath || !dirty || saving}
              className="px-3 py-1 rounded-[7px] text-[12px] font-semibold border border-line bg-panel2 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          <div className="flex-1 min-h-0">
            {selectedPath && (
              <MonacoEditor
                height="100%"
                theme="vs-dark"
                language={languageFor(selectedPath)}
                value={content}
                onChange={(v) => { setContent(v ?? ""); setDirty(true); }}
                options={{ minimap: { enabled: false }, fontSize: 13 }}
              />
            )}
          </div>
        </div>

        <div className="border-l border-line flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {messages.map((m, i) => (
              <div key={i} className="text-[12.5px] p-2 rounded-[8px]" style={{ background: m.role === "user" ? "rgba(86,166,232,.1)" : "#0a0e13" }}>
                <div className="text-[10px] uppercase font-bold text-dim mb-1">{m.role}</div>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}
            {streamingReply && (
              <div className="text-[12.5px] p-2 rounded-[8px] bg-[#0a0e13]">
                <div className="text-[10px] uppercase font-bold text-dim mb-1">assistant</div>
                <div className="whitespace-pre-wrap">{streamingReply}</div>
              </div>
            )}
            {editLog.map((e, i) => (
              <div key={i} className="text-[11.5px] p-2 rounded-[8px] border border-line flex items-center gap-2">
                <span className="font-mono truncate flex-1">Edited {e.path}</span>
                {e.before !== null && (
                  <button onClick={() => undoEdit(e)} className="text-dim hover:text-ink underline shrink-0">undo</button>
                )}
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-line flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
              placeholder="Ask the AI to make a change…"
              disabled={chatBusy}
              className="flex-1 bg-[#0a0e13] border border-line rounded-lg px-3 py-2 text-[12.5px] outline-none"
            />
            <button onClick={sendChat} disabled={chatBusy || !chatInput.trim()} className="px-3 py-2 rounded-[8px] border border-line bg-panel2 text-[12px] font-semibold disabled:opacity-50">
              Send
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
