// Compresses a gltf-transform Document's PNG/JPEG textures to KTX2 (Basis
// Universal), in place. Wraps @gltf-transform/cli's toktx() transform, which
// shells out to the KTX-Software "ktx" CLI (see ktx2-binary.ts for how that
// binary gets resolved).
//
// Two passes, split by texture slot:
//   - UASTC for normal maps: ETC1S's endpoint/selector quantization visibly
//     breaks tangent-space lighting on normal maps (called out in
//     KHRTextureBasisu's own docs).
//   - ETC1S/BasisLZ for everything else (albedo, AO, roughness/metallic):
//     much smaller, an acceptable loss for those channels.
// toktx() itself skips any texture whose mimeType is already "image/ktx2",
// so running it twice with disjoint `slots` patterns is safe.
//
// `encoder: sharp` is required, not optional — toktx() invokes it whenever a
// texture's width or height isn't a multiple of 4 (a KTX2/Basis requirement),
// which is common for arbitrary user-uploaded textures, not just when an
// explicit `resize` option is requested.

import type { Document } from "@gltf-transform/core";
import { toktx, Mode } from "@gltf-transform/cli";
import sharp from "sharp";
import { ensureKtxOnPath } from "./ktx2-binary";

const NORMAL_SLOTS = /normal/i;
const NON_NORMAL_SLOTS = /^(?!.*normal).*$/i;

export async function compressGlbTextures(doc: Document): Promise<void> {
  await ensureKtxOnPath(doc.getLogger());

  await doc.transform(
    toktx({ mode: Mode.UASTC, encoder: sharp, slots: NORMAL_SLOTS, level: 2 }),
  );
  await doc.transform(
    toktx({ mode: Mode.ETC1S, encoder: sharp, slots: NON_NORMAL_SLOTS, quality: 128 }),
  );
}
