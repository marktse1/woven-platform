"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import CommunitySubNav from "@/components/shell/CommunitySubNav";
import { supabase } from "@/lib/supabase";

const hubs = ["Hollow Tide", "Mossglow", "Weave Forge", "Tin Can Kingdom", "Foxfire Relay", "Help & Support", "Off-topic", "Multiplayer"];
const threadCategories = ["Help & Support", "Builds & Showcase", "Bug Reports", "Off-topic", "Multiplayer", "Weave Forge"];

function NewThreadModal({ onClose, onPost, authorName }: { onClose: () => void; onPost: (t: Thread) => void; authorName: string }) {
  const [title, setTitle]     = useState("");
  const [body, setBody]       = useState("");
  const [hub, setHub]         = useState(hubs[0]);
  const [category, setCategory] = useState(threadCategories[0]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSubmit = () => {
    if (!title.trim() || !body.trim()) return;
    onPost({
      tags: [],
      title: title.trim(),
      excerpt: body.trim(),
      author: authorName,
      hub,
      category,
      hubColors: ["#56a6e8", "#2c6aa0"],
      votes: 0,
      replies: 0,
      time: "just now",
      pinned: false,
    });
    onClose();
  };

  const inputCls = "bg-[#0a0e13] border border-line rounded-lg px-3.5 py-3 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-panel border border-line rounded-[14px] w-full max-w-[640px] shadow-[0_24px_60px_rgba(0,0,0,.7)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-[18px] font-bold tracking-[-0.01em]">New thread</h2>
          <button onClick={onClose} className="text-dim hover:text-ink text-[20px] leading-none cursor-pointer bg-transparent border-none">×</button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-muted">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="A clear, specific title gets more replies"
              className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-muted">Hub</label>
              <select value={hub} onChange={e => setHub(e.target.value)} className={inputCls + " cursor-pointer"}>
                {hubs.map(h => <option key={h}>{h}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-muted">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className={inputCls + " cursor-pointer"}>
                {threadCategories.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-muted">Body</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
              placeholder="Share context, steps to reproduce, screenshots, links…"
              className={inputCls + " resize-none"} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-line">
          <p className="text-[12px] text-dim">Be kind · use the right hub · mark spoilers</p>
          <div className="flex gap-2.5">
            <button onClick={onClose} className="px-5 py-2.5 rounded-[9px] font-bold text-[14px] cursor-pointer bg-panel2 border border-line text-ink">Cancel</button>
            <button onClick={handleSubmit}
              disabled={!title.trim() || !body.trim()}
              className="px-5 py-2.5 rounded-[9px] font-bold text-[14px] cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
              Post thread
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type Tag = "pin" | "dev" | "solved" | "help" | "showcase";

type Thread = {
  id?: string;
  tags: Tag[];
  title: string;
  excerpt: string;
  author: string;
  hub: string;
  category: string;
  hubColors: [string, string];
  votes: number;
  replies: number;
  time: string;
  pinned: boolean;
};

const hubColorMap: Record<string, [string, string]> = {
  "Hollow Tide":    ["#2a6aa0", "#7d4bd0"],
  "Mossglow":       ["#3a8f5a", "#216b7a"],
  "Weave Forge":    ["#56a6e8", "#2c6aa0"],
  "Tin Can Kingdom":["#b8923a", "#7a4a2a"],
  "Foxfire Relay":  ["#d0552a", "#9a2a4a"],
  "Help & Support": ["#56a6e8", "#2c6aa0"],
  "Off-topic":      ["#6a4bd0", "#b03a8a"],
  "Multiplayer":    ["#1f9d8a", "#2c5fb0"],
};

function relativeTime(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToThread(row: any): Thread {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    author: row.author,
    hub: row.hub,
    category: row.category ?? "Off-topic",
    hubColors: hubColorMap[row.hub] ?? ["#56a6e8", "#2c6aa0"],
    tags: row.tags ?? [],
    votes: row.votes,
    replies: row.replies,
    pinned: row.pinned,
    time: relativeTime(row.created_at),
  };
}

const tagBadge: Record<Tag, { cls: string; label: string }> = {
  pin:      { cls: "bg-[rgba(232,169,58,.16)] text-[#f0c66a]",         label: "📌 Pinned"   },
  dev:      { cls: "bg-[rgba(86,166,232,.14)] text-[#8fc6f0] border border-accent2", label: "◆ Dev" },
  solved:   { cls: "bg-[rgba(123,194,74,.16)] text-[#a6e06a]",         label: "✓ Solved"   },
  help:     { cls: "bg-[rgba(232,169,58,.16)] text-[#f0c66a]",         label: "Help"        },
  showcase: { cls: "bg-[rgba(86,166,232,.14)] text-[#8fc6f0]",         label: "Showcase"    },
};

const categories = ["All", "Help & Support", "Builds & Showcase", "Multiplayer", "Weave Forge", "Bug Reports", "Off-topic"];
const sortTabs   = ["🔥 Hot", "✦ New", "▲ Top", "◇ Unanswered"];

const trendingHubs = [
  { name: "Hollow Tide",    sub: "24.1k members · 312 online", a: "#2a6aa0", b: "#7d4bd0" },
  { name: "Mossglow",       sub: "11.8k members · 140 online", a: "#3a8f5a", b: "#216b7a" },
  { name: "Weave Forge",    sub: "18.6k members · 503 online", a: "#56a6e8", b: "#2c6aa0" },
  { name: "Tin Can Kingdom",sub: "9.2k members · 88 online",   a: "#b8923a", b: "#7a4a2a" },
  { name: "Foxfire Relay",  sub: "7.4k members · 61 online",   a: "#d0552a", b: "#9a2a4a" },
];

const onlineCreators = [
  { name: "lanternfew",  role: "Hollow Tide · Creator",   a: "#2a6aa0", b: "#7d4bd0" },
  { name: "fernlight",   role: "Mossglow · Creator",      a: "#3a8f5a", b: "#216b7a" },
  { name: "brassworks",  role: "Tin Can Kingdom",          a: "#b8923a", b: "#7a4a2a" },
  { name: "maya_b",      role: "Weave Forge team",        a: "#56a6e8", b: "#2c6aa0" },
];

function GradAvatar({ a, b, className = "" }: { a: string; b: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden shrink-0 ${className}`}
      style={{ background: `linear-gradient(140deg, ${a}, ${b})` }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 26% 16%, rgba(255,255,255,.26), transparent 60%)" }} />
    </div>
  );
}

function ThreadVotes({ initial }: { initial: number }) {
  const [state, setState] = useState(0);
  return (
    <div className="flex flex-col items-center gap-0.5 w-[46px] shrink-0 pt-0.5">
      <button onClick={e => { e.stopPropagation(); setState(s => s === 1 ? 0 : 1); }}
        className="w-[30px] h-6 rounded-md flex items-center justify-center text-[12px] cursor-pointer border transition-all"
        style={{ borderColor: state === 1 ? "transparent" : "transparent", background: state === 1 ? "rgba(123,194,74,.12)" : "transparent", color: state === 1 ? "#7bc24a" : "#5d738a" }}>
        ▲
      </button>
      <span className="font-extrabold text-[15px]">{initial + state}</span>
      <button onClick={e => { e.stopPropagation(); setState(s => s === -1 ? 0 : -1); }}
        className="w-[30px] h-6 rounded-md flex items-center justify-center text-[12px] cursor-pointer border transition-all"
        style={{ borderColor: "transparent", background: state === -1 ? "rgba(227,92,92,.12)" : "transparent", color: state === -1 ? "#e35c5c" : "#5d738a" }}>
        ▼
      </button>
    </div>
  );
}

export default function CommunityPage() {
  const { user } = useUser();
  const authorName = user?.username ?? user?.firstName ?? "anon";

  const [activeCategory, setActiveCategory] = useState("All");
  const [activeSort, setActiveSort] = useState("🔥 Hot");
  const [showModal, setShowModal] = useState(false);
  const [threadList, setThreadList] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    supabase
      .from("threads")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setThreadList(data.map(rowToThread));
        setLoading(false);
      });
  }, []);

  const handlePost = async (t: Thread) => {
    const { data } = await supabase
      .from("threads")
      .insert({
        title: t.title,
        excerpt: t.excerpt,
        author: t.author,
        hub: t.hub,
        category: t.category,
        tags: t.tags,
        votes: 0,
        replies: 0,
        pinned: false,
      })
      .select()
      .single();
    if (data) setThreadList(prev => [rowToThread(data), ...prev]);
  };

  const q = query.trim().toLowerCase();
  const visibleThreads = [...threadList]
    .filter(t => {
      if (q && !(
        t.title.toLowerCase().includes(q) ||
        t.excerpt.toLowerCase().includes(q) ||
        t.author.toLowerCase().includes(q) ||
        t.hub.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      )) return false;
      if (activeCategory !== "All" && t.category !== activeCategory) return false;
      return true;
    })
    .sort((a, b) => {
      if (activeSort === "▲ Top")          return b.votes - a.votes;
      if (activeSort === "◇ Unanswered")   return a.replies - b.replies;
      return 0; // "🔥 Hot" and "✦ New" use DB order (created_at desc)
    });

  return (
    <>
      {showModal && <NewThreadModal onClose={() => setShowModal(false)} onPost={handlePost} authorName={authorName} />}
      <CommunitySubNav />
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-12 pt-6 pb-16">
        <h1 className="text-[30px] font-extrabold tracking-[-0.02em]">Community</h1>
        <p className="text-muted text-[15px] mt-2 mb-4 max-w-[620px]">
          Threads, build logs and help across every game on Woven. Jump into a hub or just browse what&apos;s hot.
        </p>

        <div className="grid gap-6 items-start grid-cols-1 lg:grid-cols-[1fr_332px]">
          {/* Main column */}
          <div>
            {/* Search */}
            <div className="relative mb-3.5 max-w-[420px]">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dim text-[14px]">⌕</span>
              <input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search discussions, hubs, players…"
                className="bg-[#0a0e13] border border-line rounded-lg pl-9 pr-3 py-2.5 text-ink text-[14px] w-full outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(86,166,232,.14)] transition-all font-[inherit]" />
            </div>

            {/* Category chips */}
            <div className="flex flex-wrap gap-2 mb-3.5">
              {categories.map(c => {
                const on = activeCategory === c;
                return (
                  <button key={c} onClick={() => setActiveCategory(c)}
                    className="inline-flex items-center text-[13px] px-3 py-2 rounded-full border cursor-pointer transition-all"
                    style={{ background: on ? "rgba(86,166,232,.14)" : "#1b2836", borderColor: on ? "#56a6e8" : "#26384a", color: on ? "#cfe6fb" : "#e7eef4" }}>
                    {c}
                  </button>
                );
              })}
            </div>

            {/* Sort tabs */}
            <div className="flex items-center gap-1 p-1 rounded-[10px] border border-line w-max mb-3.5" style={{ background: "#16202c" }}>
              {sortTabs.map(s => (
                <button key={s} onClick={() => setActiveSort(s)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-[7px] text-[13px] font-bold cursor-pointer transition-colors"
                  style={{ background: activeSort === s ? "#223345" : "transparent", color: activeSort === s ? "#e7eef4" : "#8aa0b4" }}>
                  {s}
                </button>
              ))}
            </div>

            {/* Thread list */}
            <div className="bg-panel border border-line rounded-[10px] overflow-hidden">
              {loading && (
                <div className="px-5 py-8 text-center text-muted text-[14px]">Loading threads…</div>
              )}
              {!loading && visibleThreads.length === 0 && (
                <div className="px-5 py-8 text-center text-muted text-[14px]">
                  {q ? `No threads matching "${query}"` : "No threads yet. Be the first to post!"}
                </div>
              )}
              {visibleThreads.map((t) => (
                <div key={t.id ?? t.title}
                  className={`flex gap-4 px-5 py-4.5 border-b border-line last:border-none cursor-pointer transition-colors hover:bg-white/[.025] ${t.pinned ? "bg-[rgba(86,166,232,.05)]" : ""}`}>
                  <ThreadVotes initial={t.votes} />
                  <div className="flex-1 min-w-0">
                    {/* Tags */}
                    {t.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {t.tags.map(tag => (
                          <span key={tag} className={`text-[11px] font-bold px-2 py-0.5 rounded-md tracking-[.02em] ${tagBadge[tag].cls}`}>
                            {tagBadge[tag].label}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-[16.5px] font-bold tracking-[-0.01em] leading-snug hover:text-[#cfe6fb] transition-colors">
                      {t.title}
                    </div>
                    <p className="text-[13px] text-muted mt-1.5 leading-relaxed line-clamp-2">{t.excerpt}</p>
                    <div className="flex items-center gap-2 text-[12px] text-dim mt-2.5 flex-wrap">
                      <GradAvatar a={t.hubColors[0]} b={t.hubColors[1]} className="w-5 h-5 rounded-full" />
                      <a className="text-muted font-semibold cursor-pointer">@{t.author}</a>
                      <span className="w-[3px] h-[3px] rounded-full bg-line2" />
                      <span>in</span>
                      <a className="text-accent font-bold cursor-pointer">{t.hub}</a>
                      <span className="w-[3px] h-[3px] rounded-full bg-line2" />
                      <span>{t.time}</span>
                      <span className="ml-auto font-semibold text-muted">💬 {t.replies} replies</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-center mt-4">
              <button className="px-5 py-2.5 rounded-[9px] font-bold text-[14px] cursor-pointer bg-panel2 border border-line text-ink">
                Load more discussions
              </button>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="sticky top-4 flex flex-col gap-4">
            {/* New thread */}
            <div className="bg-panel border border-line rounded-[10px] p-4.5">
              <div className="font-extrabold text-[16px] tracking-[-0.01em]">Start a discussion</div>
              <p className="text-[12.5px] text-muted mt-1.5 mb-3.5">Ask for help, share a build, or post about any game in your library.</p>
              <button onClick={() => setShowModal(true)}
                className="w-full py-3 rounded-[9px] font-bold text-[14px] cursor-pointer border-none"
                style={{ background: "linear-gradient(180deg, #56a6e8, #2c6aa0)", color: "#06121d" }}>
                ＋ New thread
              </button>
              <div className="flex gap-4.5 mt-3.5">
                {[["38.4k", "Members"], ["1,204", "Online now"], ["512", "Game hubs"]].map(([n, l]) => (
                  <div key={l}>
                    <div className="text-[18px] font-extrabold">{n}</div>
                    <div className="text-[11px] text-dim">{l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Trending hubs */}
            <div className="bg-panel border border-line rounded-[10px]">
              <div className="px-6 py-4 border-b border-line font-bold text-[15px]">Trending hubs</div>
              <div className="px-6 pt-1.5 pb-3">
                {trendingHubs.map(h => (
                  <div key={h.name} className="flex items-center gap-2.5 py-2.5 border-b border-line last:border-none cursor-pointer">
                    <GradAvatar a={h.a} b={h.b} className="w-[38px] h-[38px] rounded-[9px] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[13.5px]">{h.name}</div>
                      <div className="text-[11.5px] text-dim">{h.sub}</div>
                    </div>
                    <span className="text-[11px] text-accent font-bold ml-auto">Join</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Online creators */}
            <div className="bg-panel border border-line rounded-[10px]">
              <div className="px-6 py-4 border-b border-line font-bold text-[15px]">Online creators</div>
              <div className="px-6 pt-2 pb-3">
                {onlineCreators.map(o => (
                  <div key={o.name} className="flex items-center gap-2.5 py-1.5">
                    <div className="relative shrink-0">
                      <GradAvatar a={o.a} b={o.b} className="w-[28px] h-[28px] rounded-full" />
                      <span className="absolute -right-0.5 -bottom-0.5 w-[9px] h-[9px] rounded-full bg-green border-2 border-panel" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[13px]">@{o.name}</div>
                      <div className="text-[11px] text-dim">{o.role}</div>
                    </div>
                    <button className="px-3 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer bg-panel2 border border-line text-ink">
                      Follow
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Guidelines */}
            <div className="bg-panel border border-line rounded-[10px] p-4.5">
              <p className="text-[12.5px] font-bold tracking-[.12em] uppercase text-muted mb-1.5">Community guidelines</p>
              <ul className="list-disc ml-4 space-y-1.5">
                <li className="text-[12.5px] text-muted leading-snug">Be kind. Critique builds, not people.</li>
                <li className="text-[12.5px] text-muted leading-snug">Use the right hub & tag your post.</li>
                <li className="text-[12.5px] text-muted leading-snug">Mark spoilers; no piracy or leaks.</li>
              </ul>
              <a className="text-accent text-[12.5px] font-semibold mt-3 block cursor-pointer">Read the full guidelines →</a>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
