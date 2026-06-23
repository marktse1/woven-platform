"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  onFile: (file: File) => void;
  accept?: string;
  hint?: string;
};

export default function DropZone({
  onFile,
  accept = ".glb",
  hint = "Drag & drop a .glb model, or click to browse",
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
      className="rounded-[12px] border-2 border-dashed flex flex-col items-center justify-center text-center px-6 py-12 cursor-pointer transition-colors"
      style={{
        borderColor: over ? "#56a6e8" : "#324a61",
        background: over ? "rgba(86,166,232,.08)" : "#0a0e13",
      }}
    >
      <div className="text-[34px] mb-2">🔻</div>
      <div className="text-[15px] font-bold">{hint}</div>
      <div className="text-[12.5px] text-dim mt-1.5">
        High-res GLB / glTF · stays private in your library until you share it
      </div>
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
