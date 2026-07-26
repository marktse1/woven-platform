"use client";

import { useEffect, useRef } from "react";
import { initWorldBuilder } from "@/lib/world-builder/editor";
import { useActiveLoader } from "@/components/assets/ActiveLoaderContext";
import "@/lib/world-builder/editor.css";

export default function WorldBuilderViewer({ userId }: { userId: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const { register } = useActiveLoader();

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const handle = initWorldBuilder(mount, userId);
    // Registers World Builder with the global "My Assets" drawer, same
    // pattern every other tool uses — clicking a .glb row there now places
    // it into the world instead of only being reachable via the (removed)
    // internal asset shelf.
    const unregister = register({
      onLoad: (asset) => handle.placeAssetById(asset.id),
      accepts: (asset) => asset.format.toLowerCase() === "glb",
    });
    return () => {
      unregister();
      handle.dispose();
    };
  }, [userId, register]);

  return <div ref={mountRef} className="wb-root" style={{ width: "100%", height: "100%" }} />;
}
