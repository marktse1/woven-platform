"use client";

import { useEffect } from "react";

type Props = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  theme?: "warm";
};

/** Destructive-action confirmation modal — dismiss via backdrop click, Escape, or Cancel. */
export default function ConfirmDialog({ title, message, confirmLabel = "Delete", cancelLabel = "Cancel", onConfirm, onCancel, theme }: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const warm = theme === "warm";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,.65)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="rounded-[14px] w-full max-w-[420px] shadow-[0_24px_60px_rgba(0,0,0,.7)]"
        style={warm
          ? { background: "#2c2926", border: "1px solid rgba(255,255,255,0.08)" }
          : { background: "var(--color-panel)", border: "1px solid var(--color-line)" }
        }
      >
        <div className="px-6 py-5">
          <h2
            className="text-[17px] font-bold tracking-[-0.01em] mb-2"
            style={warm ? { color: "#e8e1d5" } : undefined}
          >{title}</h2>
          <p
            className="text-[13.5px] leading-relaxed"
            style={{ color: warm ? "#c7bfb2" : "var(--color-dim)" }}
          >{message}</p>
        </div>
        <div
          className="flex gap-2 px-6 py-4 border-t"
          style={{ borderTopColor: warm ? "#2a2420" : "var(--color-line)" }}
        >
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-[9px] border text-[13px] font-semibold"
            style={warm
              ? { background: "#1b1815", borderColor: "rgba(255,255,255,0.08)", color: "#9b9082" }
              : { background: "var(--color-panel2)", borderColor: "var(--color-line)" }
            }
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-[9px] font-bold text-[13px]"
            style={warm
              ? { background: "#e2562a", color: "#fff3ec" }
              : { background: "linear-gradient(180deg,#e35c5c,#a83a3a)", color: "#1a0606" }
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
