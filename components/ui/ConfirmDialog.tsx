"use client";

import { useEffect } from "react";

type Props = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Destructive-action confirmation modal — dismiss via backdrop click, Escape, or Cancel. */
export default function ConfirmDialog({ title, message, confirmLabel = "Delete", cancelLabel = "Cancel", onConfirm, onCancel }: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="bg-panel border border-line rounded-[14px] w-full max-w-[420px] shadow-[0_24px_60px_rgba(0,0,0,.7)]">
        <div className="px-6 py-5">
          <h2 className="text-[17px] font-bold tracking-[-0.01em] mb-2">{title}</h2>
          <p className="text-[13.5px] text-dim leading-relaxed">{message}</p>
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-line">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-[9px] border border-line bg-panel2 text-[13px] font-semibold"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-[9px] font-bold text-[13px]"
            style={{ background: "linear-gradient(180deg,#e35c5c,#a83a3a)", color: "#1a0606" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
