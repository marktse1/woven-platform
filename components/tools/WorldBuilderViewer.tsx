"use client";

import { useEffect, useRef } from "react";
import { initWorldBuilder } from "@/lib/world-builder/editor";
import "@/lib/world-builder/editor.css";

export default function WorldBuilderViewer({ userId }: { userId: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const cleanup = initWorldBuilder(mount, userId);
    return cleanup;
  }, [userId]);

  return <div ref={mountRef} className="wb-root" style={{ width: "100%", height: "100%" }} />;
}
