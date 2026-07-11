// gltf-transform read/write helpers for Substance Weaver — extracting a GLB's
// existing albedo/normal/AO textures to seed the paint canvases, and writing
// edited canvases back before re-export. Same WebIO pattern as
// lib/retopo/optimize.ts.

import { type Document, type Material, type Texture } from "@gltf-transform/core";
import { createWebIO } from "@/lib/gltf/io";

export type EncodedImage = { bytes: Uint8Array; mimeType: string };

export type LoadedForPainting = {
  document: Document;
  material: Material | null;
  albedo: EncodedImage | null;
  normal: EncodedImage | null;
  occlusion: EncodedImage | null;
  metallicRoughness: EncodedImage | null;
  /** glTF default is 1 (fully rough) when no material/factor is present. */
  roughnessFactor: number;
  /** glTF default is 1 (fully metallic) when no material/factor is present. */
  metallicFactor: number;
};

function extract(texture: Texture | null): EncodedImage | null {
  if (!texture) return null;
  const bytes = texture.getImage();
  if (!bytes) return null;
  return { bytes, mimeType: texture.getMimeType() || "image/png" };
}

/** Reads a GLB into a gltf-transform Document and pulls out its existing PBR images (first material only). */
export async function loadGlbForPainting(input: ArrayBuffer): Promise<LoadedForPainting> {
  const io = createWebIO();
  const document = await io.readBinary(new Uint8Array(input));
  const material = document.getRoot().listMaterials()[0] ?? null;

  return {
    document,
    material,
    albedo: material ? extract(material.getBaseColorTexture()) : null,
    normal: material ? extract(material.getNormalTexture()) : null,
    occlusion: material ? extract(material.getOcclusionTexture()) : null,
    metallicRoughness: material ? extract(material.getMetallicRoughnessTexture()) : null,
    roughnessFactor: material ? material.getRoughnessFactor() : 1,
    metallicFactor: material ? material.getMetallicFactor() : 1,
  };
}

/** Decodes an encoded (PNG/JPEG) image into a drawable bitmap for seeding a canvas. */
export async function decodeImage(image: EncodedImage | null): Promise<ImageBitmap | null> {
  if (!image) return null;
  const blob = new Blob([Uint8Array.from(image.bytes)], { type: image.mimeType });
  return await createImageBitmap(blob);
}

/** Encodes a canvas's current pixels to PNG bytes. */
export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas PNG encode failed."))), "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Encodes raw ImageData (not backed by a visible canvas) to PNG bytes, via a throwaway offscreen canvas. */
export async function imageDataToPng(imageData: ImageData): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext("2d")!.putImageData(imageData, 0, 0);
  return canvasToPng(canvas);
}

/** Writes edited albedo/normal PNGs back into the material, creating textures if none existed. AO is never written - view-only passthrough. */
export function writePaintedTextures(
  document: Document,
  material: Material,
  params: { albedoPng?: Uint8Array; normalPng?: Uint8Array },
): void {
  if (params.albedoPng) {
    let tex = material.getBaseColorTexture();
    if (!tex) {
      tex = document.createTexture("albedo");
      material.setBaseColorTexture(tex);
    }
    tex.setImage(params.albedoPng).setMimeType("image/png");
  }
  if (params.normalPng) {
    let tex = material.getNormalTexture();
    if (!tex) {
      tex = document.createTexture("normal");
      material.setNormalTexture(tex);
    }
    tex.setImage(params.normalPng).setMimeType("image/png");
  }
}

export async function exportPaintedGlb(document: Document): Promise<Uint8Array> {
  const io = createWebIO();
  return await io.writeBinary(document);
}
