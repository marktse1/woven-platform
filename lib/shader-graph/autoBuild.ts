// Turns a set of detected+uploaded PBR texture maps into a ready-to-tweak
// Shaderade node graph: one Texture2D node per map, wired straight into
// OutputPBR's matching input slot.

import type { Node, Edge } from "@xyflow/react";
import type { MapType } from "./mapDetect";

type WireableMapType = Exclude<MapType, "height">;

// height has no OutputPBR slot (no displacement pipeline exists) — files of
// that type still get uploaded to the library by the caller, just never
// reach this function.
const WIRE_SLOT: Record<WireableMapType, { textureOutput: "rgb" | "r"; pbrInput: string }> = {
  albedo: { textureOutput: "rgb", pbrInput: "albedo" },
  normal: { textureOutput: "rgb", pbrInput: "normal" },
  roughness: { textureOutput: "r", pbrInput: "roughness" },
  metallic: { textureOutput: "r", pbrInput: "metallic" },
  ao: { textureOutput: "r", pbrInput: "ao" },
  emissive: { textureOutput: "rgb", pbrInput: "emissive" },
};

const MAP_ORDER: WireableMapType[] = ["albedo", "normal", "roughness", "metallic", "ao", "emissive"];

export function buildPbrGraph(
  maps: Partial<Record<MapType, string>>,
  mapAssetIds: Partial<Record<MapType, string>>,
  options?: { normalConvention?: "directx" | "opengl" },
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const uvId = "auto_uv";
  nodes.push({ id: uvId, type: "UV", position: { x: 40, y: 260 }, data: {} });

  const outId = "auto_out_pbr";
  nodes.push({
    id: outId,
    type: "OutputPBR",
    position: { x: 620, y: 220 },
    data: { outputMode: "pbr", normalYFlip: options?.normalConvention === "directx" },
  });

  let row = 0;
  for (const mapType of MAP_ORDER) {
    const url = maps[mapType];
    if (!url) continue;
    const slot = WIRE_SLOT[mapType];
    const texId = `auto_tex_${mapType}`;

    nodes.push({
      id: texId,
      type: "Texture2D",
      position: { x: 260, y: 40 + row * 130 },
      // assetId lets a later GLB export look this texture up (and re-download
      // its original bytes) server-side by id, rather than needing to trust/
      // re-fetch a client-supplied URL.
      data: { imageUrl: url, uniformName: `u_tex_${mapType}`, assetId: mapAssetIds[mapType] },
    });
    edges.push({ id: `auto_e_uv_${texId}`, source: uvId, sourceHandle: "uv", target: texId, targetHandle: "uv" });
    edges.push({ id: `auto_e_${texId}_out`, source: texId, sourceHandle: slot.textureOutput, target: outId, targetHandle: slot.pbrInput });
    row++;
  }

  return { nodes, edges };
}
