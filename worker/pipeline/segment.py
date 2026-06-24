# Tier-2 animation-part labeling, layered on top of (not replacing) the
# Tier-1 connectivity segmentation from lib/retopo/segment.ts. Still
# deterministic and rule-based - no ML model, no AI - just a principal-axis
# PCA pass that buckets each connected component into a coarse rig-relevant
# band (head/torso/limb/tail). Stored as a custom property that Blender's
# glTF exporter carries through to the output's mesh.extras
# (export_extras=True in io_glb.export_glb).

import json

import bmesh
import bpy
import numpy as np

from . import io_glb


def _connected_components(obj) -> list[list[int]]:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()

    visited = [False] * len(bm.faces)
    components: list[list[int]] = []
    for seed in bm.faces:
        if visited[seed.index]:
            continue
        stack = [seed]
        visited[seed.index] = True
        comp = []
        while stack:
            f = stack.pop()
            comp.append(f.index)
            for e in f.edges:
                for nf in e.link_faces:
                    if not visited[nf.index]:
                        visited[nf.index] = True
                        stack.append(nf)
        components.append(comp)

    bm.free()
    return components


def _principal_axis(obj) -> np.ndarray:
    coords = np.array([v.co for v in obj.data.vertices])
    centered = coords - coords.mean(axis=0)
    cov = np.cov(centered.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    return eigvecs[:, int(np.argmax(eigvals))]


def run(input_path: str, output_path: str, classification: str) -> dict:
    io_glb.import_glb(input_path)
    objs = io_glb.mesh_objects()
    if not objs:
        raise ValueError("No mesh found in the source GLB.")

    part_labels: dict[str, list[int]] = {}

    for obj in objs:
        axis = _principal_axis(obj)
        coords = np.array([v.co for v in obj.data.vertices])
        proj = coords @ axis
        lo, hi = float(proj.min()), float(proj.max())
        span = max(hi - lo, 1e-6)

        components = _connected_components(obj)
        for face_indices in components:
            verts: set[int] = set()
            for fi in face_indices:
                verts.update(obj.data.polygons[fi].vertices)
            if not verts:
                continue

            band = (float(np.mean([proj[v] for v in verts])) - lo) / span
            if band > 0.82:
                label = "head"
            elif band < 0.22 and classification in ("quadruped", "creature"):
                label = "tail"
            elif 0.35 <= band <= 0.78 and len(verts) > 0.15 * len(obj.data.vertices):
                label = "torso"
            else:
                label = "limb"

            part_labels.setdefault(label, []).extend(sorted(verts))

    for mesh in bpy.data.meshes:
        mesh["wovenPartLabels"] = json.dumps(part_labels)

    io_glb.export_glb(output_path)
    return {"partLabels": {k: len(v) for k, v in part_labels.items()}}
