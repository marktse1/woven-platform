"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { AssetRow } from "@/lib/assets";

// Lets the global "My Assets" panel (mounted once in app/layout.tsx, outside
// any tool's own component tree) act as the universal asset loader instead
// of every tool keeping its own embedded "browse my assets" list. Whichever
// tool is currently mounted registers a loader; the panel calls it when a
// row is clicked and uses `accepts` to gray out rows that tool can't use
// (e.g. Mesh Sculptor only wants .glb meshes).
export type AssetLoader = {
  onLoad: (asset: AssetRow) => void;
  accepts?: (asset: AssetRow) => boolean;
};

type ActiveLoaderContextValue = {
  activeLoader: AssetLoader | null;
  register: (loader: AssetLoader) => () => void;
  assetsVersion: number;
  notifyAssetsChanged: () => void;
};

const ActiveLoaderContext = createContext<ActiveLoaderContextValue | null>(null);

export function ActiveLoaderProvider({ children }: { children: ReactNode }) {
  const [activeLoader, setActiveLoader] = useState<AssetLoader | null>(null);
  const [assetsVersion, setAssetsVersion] = useState(0);
  // Registration order matters when two tools could theoretically mount at
  // once (they can't today, but this avoids a later tool's unmount silently
  // clearing an still-mounted earlier tool's loader).
  const tokenRef = useRef(0);

  const register = useCallback((loader: AssetLoader) => {
    const token = ++tokenRef.current;
    setActiveLoader(loader);
    return () => {
      if (tokenRef.current === token) setActiveLoader(null);
    };
  }, []);

  const notifyAssetsChanged = useCallback(() => {
    setAssetsVersion((v) => v + 1);
  }, []);

  return (
    <ActiveLoaderContext.Provider value={{ activeLoader, register, assetsVersion, notifyAssetsChanged }}>
      {children}
    </ActiveLoaderContext.Provider>
  );
}

/** For a tool page: registers its loader on mount, unregisters on unmount. */
export function useActiveLoader() {
  const ctx = useContext(ActiveLoaderContext);
  if (!ctx) throw new Error("useActiveLoader must be used within ActiveLoaderProvider");
  return ctx;
}

/** For the global panel: reads whichever loader is currently registered. */
export function useRegisteredLoader() {
  const ctx = useContext(ActiveLoaderContext);
  return ctx; // null outside the provider — callers treat that as "no loader"
}
