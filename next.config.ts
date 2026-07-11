import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // sharp uses native bindings — exclude it from bundling so the prebuilt binary works.
  //
  // @gltf-transform/cli pulls in @donmccurdy/caporal, whose package.json Turbopack's
  // server bundler can't resolve ("server relative imports are not implemented yet"),
  // so it must be externalized (loaded via native require() at runtime instead of
  // bundled). But @gltf-transform/core keeps a module-level WeakMap
  // (Document._GRAPH_DOCUMENTS) used by Document.fromGraph() to look up which
  // Document a given Graph belongs to — a singleton scoped to one evaluation of the
  // module. Externalizing only @gltf-transform/cli meant its internal
  // require("@gltf-transform/core") resolved to a *second*, separately-evaluated
  // copy of the module from the one Turbopack bundled for our own `import { WebIO }
  // from "@gltf-transform/core"` calls — so a Document built via our bundled copy was
  // never registered in the CLI's copy of the WeakMap, and any @gltf-transform/functions
  // helper that calls Document.fromGraph() on it (e.g. listTextureSlots(), used by
  // toktx()) got `null` back and crashed. Externalizing the whole @gltf-transform
  // family together guarantees every import path resolves to the same physical
  // module instance, so the WeakMap is actually shared.
  serverExternalPackages: [
    "sharp",
    "@gltf-transform/core",
    "@gltf-transform/extensions",
    "@gltf-transform/functions",
    "@gltf-transform/cli",
  ],
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
