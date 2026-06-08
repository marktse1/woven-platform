"use client";
import { useState } from "react";

export default function SegmentedControl({ options, defaultIndex = 0 }: { options: string[]; defaultIndex?: number }) {
  const [active, setActive] = useState(defaultIndex);
  return (
    <div className="flex border border-line rounded-lg overflow-hidden">
      {options.map((opt, i) => (
        <button key={opt} onClick={() => setActive(i)}
          className="px-3 py-[7px] text-[12.5px] font-semibold cursor-pointer transition-colors"
          style={{
            background: i === active ? "#56a6e8" : "transparent",
            color: i === active ? "#06121d" : "#8aa0b4",
          }}>
          {opt}
        </button>
      ))}
    </div>
  );
}
