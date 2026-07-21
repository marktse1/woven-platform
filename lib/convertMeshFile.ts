import * as THREE from "three";

// Mesh Loom and Substance Painter's viewers (ModelViewer/PaintViewer) only
// ever take raw GLB bytes as a prop — unlike Mesh Sculptor's SculptViewer,
// they have no live editable scene to load other formats into. So instead of
// loading-then-re-exporting through a viewer, this converts a dropped
// .drc/.obj straight to a GLB File up front, using the same loaders/pattern
// as Mesh Sculptor's handleLocalFile (app/tools/mesh-sculptor/MeshSculptClient.tsx).
export async function toGlbFile(file: File): Promise<File> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "glb") return file;

  let geometry: THREE.BufferGeometry;

  if (ext === "drc") {
    const { DRACOLoader } = await import("three/examples/jsm/loaders/DRACOLoader.js");
    const buf = await file.arrayBuffer();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("/libs/draco/");
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const blobUrl = URL.createObjectURL(blob);
    try {
      geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
        dracoLoader.load(blobUrl, resolve, undefined, reject);
      });
    } finally {
      URL.revokeObjectURL(blobUrl);
      dracoLoader.dispose();
    }
  } else if (ext === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    const BGU = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
    const text = await file.text();
    const group = new OBJLoader().parse(text);
    const geos: THREE.BufferGeometry[] = [];
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) geos.push(m.geometry);
    });
    if (geos.length === 0) throw new Error("OBJ contains no mesh geometry.");
    geometry = geos.length === 1 ? geos[0] : BGU.mergeGeometries(geos, false);
  } else {
    throw new Error(`Unsupported format: .${ext}. Drop a .glb, .drc, or .obj file.`);
  }

  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      mesh,
      (result) => resolve(result as ArrayBuffer),
      (error) => reject(error),
      { binary: true },
    );
  });

  const glbName = file.name.replace(/\.(drc|obj)$/i, ".glb");
  return new File([glbBuffer], glbName, { type: "model/gltf-binary" });
}
