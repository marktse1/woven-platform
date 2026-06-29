# Quad-dominant retopology with edge loops, for articulated classifications
# only (biped/quadruped/creature) - app/tools/retopology's needsRetopoWorker()
# already gates "object" out of this entirely on the client.
#
# bpy.ops.object.quadriflow_remesh is the real, shipping Blender operator for
# automatic quad-dominant remeshing (verified locally against bpy==4.5.9).
# Marking sharp edges first biases its quad flow toward natural loops around
# creases - eyes, mouth corners, joints - without any per-classification
# special-casing beyond that.

import base64
import math

import bpy

from . import io_glb


def _fix_for_quadriflow(obj) -> None:
    """Fix normals and non-manifold issues before QuadriFlow.

    After GLB import + weld-by-distance, every vertex has a single geometric
    position but normals that were baked per-loop by the exporter. QuadriFlow
    requires consistent outward-facing normals and a manifold surface — without
    this fix it prints the 'needs to be manifold' warning and outputs the mesh
    unchanged (no remeshing at all).

    fill_holes(sides=0) closes ALL boundary loops regardless of size (neck
    ~50 edges, wrists ~20 edges) making the surface fully manifold. The
    subsequent quads_convert_to_tris ensures the fill n-gons are triangulated
    so QuadriFlow sees a uniform triangulated input rather than one huge polygon
    per hole, which would draw most of its quads to the fill area.
    """
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.mesh.fill_holes(sides=0)
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.object.mode_set(mode="OBJECT")


def _mark_sharp_edges(obj, angle_deg: float = 45.0) -> None:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.edges_select_sharp(sharpness=math.radians(angle_deg))
    bpy.ops.mesh.mark_sharp()
    bpy.ops.object.mode_set(mode="OBJECT")


def _face_count(obj) -> int:
    return len(obj.data.polygons)


def _pre_decimate(obj, target_faces: int) -> None:
    """Decimate to ~8x target before QuadriFlow for extreme reduction ratios.

    QuadriFlow's manifold check fails on high-poly meshes at extreme ratios
    (e.g. 250:1). Bringing the mesh to ~8x target first lets QuadriFlow work
    reliably at an 8:1 ratio instead.
    """
    current = len(obj.data.polygons)
    if current <= target_faces * 8:
        return
    ratio = min(0.99, (target_faces * 8) / current)
    mod = obj.modifiers.new(name="pre_decimate", type="DECIMATE")
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="pre_decimate")
    print(f"retopo: pre_decimate {current} → {len(obj.data.polygons)} faces")


def _apply_face_sets(obj, face_segment: dict) -> None:
    """Write segment IDs into Blender face sets so QuadriFlow creates edge loops
    at segment boundaries (e.g. hair↔skin, eye↔skin).

    The .sculpt_face_set attribute persists through the DECIMATE modifier
    (surviving faces keep their IDs) so this must be called before _pre_decimate.
    """
    if not face_segment:
        return
    attr = obj.data.attributes.get(".sculpt_face_set")
    if attr is None:
        attr = obj.data.attributes.new(name=".sculpt_face_set", type="INT", domain="FACE")
    for face_idx, seg_id in face_segment.items():
        if face_idx < len(attr.data):
            attr.data[face_idx].value = seg_id  # already 1-indexed from decode


def _quadriflow(obj, target_faces: int, use_face_sets: bool = False) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.quadriflow_remesh(
            target_faces=max(4, int(target_faces)),
            use_preserve_sharp=True,
            use_preserve_boundary=False,
            use_preserve_face_sets=use_face_sets,
        )
    except TypeError:
        # use_preserve_face_sets not available in this Blender build; run without it
        print("retopo: use_preserve_face_sets unsupported, running without face-set guidance")
        bpy.ops.object.quadriflow_remesh(
            target_faces=max(4, int(target_faces)),
            use_preserve_sharp=True,
            use_preserve_boundary=False,
        )


def _ensure_target(obj, target_faces: int) -> None:
    """Fallback decimate if QuadriFlow overshot or missed the target by >30%."""
    current = len(obj.data.polygons)
    if current <= int(target_faces * 1.3):
        return
    ratio = min(0.99, target_faces / current)
    mod = obj.modifiers.new(name="ensure_target", type="DECIMATE")
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="ensure_target")
    print(f"retopo: fallback decimate {current} → {len(obj.data.polygons)} (QuadriFlow missed target)")


def _cleanup(obj) -> None:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.mesh.dissolve_degenerate()
    bpy.ops.object.mode_set(mode="OBJECT")


def _decode_segment_rle(b64: str) -> list:
    """Decode RLE-compressed segment data from the client.

    Format: pairs of [seg_id_1indexed, run_length] bytes.
    Returns a list of face-set IDs (1-indexed; 0 = unset) indexed by global
    triangle position across all mesh objects in import order.
    """
    raw = base64.b64decode(b64)
    result: list[int] = []
    for i in range(0, len(raw) - 1, 2):
        seg_id = raw[i]    # already 1-indexed
        count = raw[i + 1]
        result.extend([seg_id] * count)
    return result


def _build_face_segment_maps(objs: list, face_ids: list) -> dict:
    """Map global triangle list back to per-object face→segmentId dicts.

    The global triangle order in the GLTF matches the Blender object/face order
    after import (mesh nodes in GLTF order, primitives appended in order).
    """
    result: dict[str, dict] = {}
    offset = 0
    for obj in objs:
        face_map: dict[int, int] = {}
        face_count = len(obj.data.polygons)
        for local_idx in range(face_count):
            global_idx = offset + local_idx
            if global_idx < len(face_ids):
                seg_id = face_ids[global_idx]
                if seg_id > 0:
                    face_map[local_idx] = seg_id
        result[obj.name] = face_map
        offset += face_count
    return result


def run(
    input_path: str,
    output_path: str,
    classification: str,
    target_polys: int,
    segment_data_b64: str | None = None,
) -> dict:
    io_glb.import_glb(input_path)
    objs = io_glb.mesh_objects()
    if not objs:
        raise ValueError("No mesh found in the source GLB.")

    # Decode per-face segment guidance from the client (if provided).
    # Face indices are valid after weld because remove_doubles never reorders faces.
    face_segments_per_obj: dict[str, dict] = {}
    if segment_data_b64:
        face_ids = _decode_segment_rle(segment_data_b64)
        face_segments_per_obj = _build_face_segment_maps(objs, face_ids)
        print(f"retopo: loaded segment data covering {len(face_ids)} triangles")

    source_tris = io_glb.triangle_count()
    # QuadriFlow's target is faces (mostly quads), not triangles — ~2 tris/quad.
    target_faces_total = max(4, target_polys // 2)

    # Allocate the face budget proportionally by each object's current polygon count
    # so large objects aren't starved when the GLB has multiple meshes.
    obj_face_counts = [_face_count(obj) for obj in objs]
    total_faces = max(1, sum(obj_face_counts))

    for obj, obj_faces in zip(objs, obj_face_counts):
        frac = obj_faces / total_faces
        target_for_obj = max(4, int(target_faces_total * frac))
        face_segment = face_segments_per_obj.get(obj.name, {})
        print(
            f"retopo: obj={obj.name} source_faces={obj_faces} "
            f"target_faces={target_for_obj} guided_segs={len(set(face_segment.values()))}"
        )
        # Apply face sets before pre_decimate — the DECIMATE modifier preserves
        # face attributes on surviving faces, so boundaries carry through.
        _apply_face_sets(obj, face_segment)
        _pre_decimate(obj, target_for_obj)
        _fix_for_quadriflow(obj)
        _mark_sharp_edges(obj)
        # Pass 2.5x the desired target to compensate for QuadriFlow's ~3x
        # systematic undershoot; _ensure_target trims any overshoot back down.
        _quadriflow(obj, int(target_for_obj * 2.5), use_face_sets=bool(face_segment))
        _cleanup(obj)
        _ensure_target(obj, target_for_obj)
        print(f"retopo: obj={obj.name} result_faces={_face_count(obj)}")

    result_tris = io_glb.triangle_count()
    io_glb.export_glb(output_path)

    return {
        "sourcePolys": source_tris,
        "resultPolys": result_tris,
        "classification": classification,
        "reduction": (1 - result_tris / source_tris) if source_tris else 0,
    }
