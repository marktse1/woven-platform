"use client";
import { useState } from "react";

export default function Toggle({ defaultOn = false, onChange }: { defaultOn?: boolean; onChange?: (v: boolean) => void }) {
  const [on, setOn] = useState(defaultOn);
  const toggle = () => { const next = !on; setOn(next); onChange?.(next); };
  return (
    <button onClick={toggle} aria-pressed={on}
      className="relative w-[42px] h-6 rounded-full border shrink-0 cursor-pointer transition-colors"
      style={{
        background: on ? "#56a6e8" : "#223345",
        borderColor: on ? "#56a6e8" : "#324a61",
      }}>
      <span className="absolute top-[3px] w-[18px] h-[18px] rounded-full transition-[left] duration-150"
        style={{ left: on ? "21px" : "3px", background: on ? "#06121d" : "#cfd8e0" }} />
    </button>
  );
}
