"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  onFile: (file: File) => void;
  accept?: string;
  hint?: string;
  /** Smaller padding/icon for use in tight spaces (e.g. a sidebar card) instead of a large centered landing zone. */
  compact?: boolean;
  accentColor?: string;
  baseBg?: string;
  inactiveBorder?: string;
};

export default function DropZone({
  onFile,
  accept = ".glb",
  hint = "Drag & drop a .glb model, or click to browse",
  compact = false,
  accentColor = "#56a6e8",
  baseBg = "#0a0e13",
  inactiveBorder = "#324a61",
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      const ok = file.name.toLowerCase().endsWith(".glb") || file.name.toLowerCase().endsWith(".gltf");
      if (!ok) return;
      onFile(file);
    },
    [onFile],
  );

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`rounded-[12px] border-2 border-dashed flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${compact ? "px-3 py-5" : "px-6 py-12"}`}
      style={{
        borderColor: over ? accentColor : inactiveBorder,
        background: over ? `${accentColor}0d` : baseBg,
      }}
    >
      <div className={compact ? "text-[20px] mb-1" : "text-[34px] mb-2"}>🔻</div>
      <div className={compact ? "text-[12.5px] font-bold" : "text-[15px] font-bold"}>{hint}</div>
      {!compact && (
        <div className="text-[12.5px] mt-1.5" style={{ color: "#9b9082" }}>
          High-res GLB / glTF · stays private in your library until you share it
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
