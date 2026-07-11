import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // sharp uses native bindings — exclude it from bundling so the prebuilt binary works.
  // @gltf-transform/cli pulls in @donmccurdy/caporal, whose package.json Turbopack's
  // server bundler can't resolve ("server relative imports are not implemented yet") —
  // externalizing sidesteps bundling it entirely, resolved via node_modules at runtime.
  serverExternalPackages: ["sharp", "@gltf-transform/cli"],
  // The vendored "ktx" CLI (scripts/provision-ktx.mjs) is invoked via
  // child_process.spawn("ktx", ...) — a dynamic string Next's file tracer
  // can't follow via static import analysis, so routes that shell out to it
  // need the vendored directory bundled in explicitly.
  outputFileTracingIncludes: {
    "app/api/glb/compress-ktx2/route": ["./.vendor/ktx-software/**"],
    "app/api/glb/decompress-ktx2/route": ["./.vendor/ktx-software/**"],
    "app/api/tools/retopology/bake/route": ["./.vendor/ktx-software/**"],
  },
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
