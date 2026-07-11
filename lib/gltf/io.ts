// Shared gltf-transform WebIO construction. Every read/write path in this repo
// uses WebIO (even the Node-side ones, e.g. lib/retopo/bake.ts) — it's plain
// binary I/O with no filesystem access, so it works the same in the browser
// and on the server.
//
// Registering KHRTextureBasisu here (rather than at each call site) means any
// document round-tripped through gltf-transform correctly reads/writes
// KTX2-textured GLBs: on read, it moves a texture's KHR_texture_basisu source
// back onto the core texture.source field; on write, it moves an image/ktx2
// texture's source into the extension block. Without it, a KTX2 GLB written
// or read elsewhere in this repo would round-trip as invalid glTF.

import { WebIO } from "@gltf-transform/core";
import { KHRTextureBasisu } from "@gltf-transform/extensions";

export function createWebIO(): WebIO {
  return new WebIO().registerExtensions([KHRTextureBasisu]);
}
