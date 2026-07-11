// Decompresses a gltf-transform Document's KTX2 textures back to PNG, in
// place. Thin wrapper around @gltf-transform/cli's own ktxdecompress()
// transform (which already handles the temp-file round-trip through `ktx
// extract` and disposes the KHR_texture_basisu extension once no texture
// still uses it) — needed because browsers can't createImageBitmap() a KTX2
// blob, so Mesh Painter's "load textures onto an editable canvas" workflow
// has to decode server-side before handing pixels to the client.

import type { Document } from "@gltf-transform/core";
import { ktxdecompress } from "@gltf-transform/cli";
import { ensureKtxOnPath } from "./ktx2-binary";

export async function decompressGlbTextures(doc: Document): Promise<void> {
  await ensureKtxOnPath(doc.getLogger());
  await doc.transform(ktxdecompress());
}
