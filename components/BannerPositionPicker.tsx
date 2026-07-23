"use client";
import { useRef, useState } from "react";

/** Drag-to-reposition control for a banner image — lets a creator choose
 * which part of a wide/tall source image shows through the short, wide
 * banner frame. Position is tracked as background-position percentages
 * (0-100 per axis), the same mechanism cover-photo repositioning uses
 * elsewhere (Twitter/Facebook): CSS `background-size: cover` already
 * handles the crop math, this just moves the anchor point. */
export default function BannerPositionPicker({
  imageUrl,
  x,
  y,
  heightClassName = "h-[140px] sm:h-[180px]",
  onCommit,
}: {
  imageUrl: string;
  x: number;
  y: number;
  heightClassName?: string;
  onCommit: (x: number, y: number) => void;
}) {
  const [pos, setPos] = useState({ x, y });
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const latestPos = useRef({ x, y });

  // Keep local state in sync if the parent swaps in a freshly-loaded value
  // (e.g. after the game/profile finishes loading).
  if (!dragging && (pos.x !== x || pos.y !== y) && dragState.current === null) {
    latestPos.current = { x, y };
    setPos({ x, y });
  }

  function clamp(v: number) {
    return Math.max(0, Math.min(100, v));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const frame = frameRef.current;
    if (!frame) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y };
    setDragging(true);

    const rect = frame.getBoundingClientRect();

    function onMove(moveEvent: PointerEvent) {
      const state = dragState.current;
      if (!state) return;
      const dx = moveEvent.clientX - state.startX;
      const dy = moveEvent.clientY - state.startY;
      // Dragging the photo itself: moving right should reveal more of its
      // left side, i.e. the position anchor moves the opposite way.
      const nextX = clamp(state.startPosX - (dx / rect.width) * 100);
      const nextY = clamp(state.startPosY - (dy / rect.height) * 100);
      latestPos.current = { x: nextX, y: nextY };
      setPos({ x: nextX, y: nextY });
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setDragging(false);
      dragState.current = null;
      onCommit(latestPos.current.x, latestPos.current.y);
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function reset() {
    latestPos.current = { x: 50, y: 50 };
    setPos({ x: 50, y: 50 });
    onCommit(50, 50);
  }

  return (
    <div>
      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        className={`relative w-full rounded-lg border border-line overflow-hidden select-none ${heightClassName} ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ backgroundImage: `url(${imageUrl})`, backgroundSize: "cover", backgroundPosition: `${pos.x}% ${pos.y}%` }}
      >
        <div className="absolute bottom-2 left-2 text-[11px] font-semibold px-2 py-1 rounded-full bg-black/55 text-white pointer-events-none">
          Drag to reposition
        </div>
      </div>
      <button
        type="button"
        onClick={reset}
        className="text-[11.5px] text-dim hover:text-accent mt-1.5 cursor-pointer"
      >
        Reset to center
      </button>
    </div>
  );
}
