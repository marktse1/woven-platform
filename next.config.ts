import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // sharp uses native bindings — exclude it from bundling so the prebuilt binary works
  serverExternalPackages: ["sharp"],
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
