# Quad-dominant retopology with edge loops, for articulated classifications
# only (biped/quadruped/creature) - app/tools/retopology's needsRetopoWorker()
# already gates "object" out of this entirely on the client.
#
# bpy.ops.object.quadriflow_remesh is the real, shipping Blender operator for
# automatic quad-dominant remeshing (verified locally against bpy==4.5.9).
# Marking sharp edges first biases its quad flow toward natural loops around
# creases - eyes, mouth corners, joints - without any per-classification
# special-casing beyond that.

import math

import bpy

from . import io_glb


def _mark_sharp_edges(obj, angle_deg: float = 45.0) -> None:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.edges_select_sharp(sharpness=math.radians(angle_deg))
    bpy.ops.mesh.mark_sharp()
    bpy.ops.object.mode_set(mode="OBJECT")


def _face_count(obj) -> int:
    return len(obj.data.polygons)


def _quadriflow(obj, target_faces: int) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.quadriflow_remesh(
        target_faces=max(4, int(target_faces)),
        use_preserve_sharp=True,
        use_preserve_boundary=False,
    )


def _cleanup(obj) -> None:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.mesh.dissolve_degenerate()
    bpy.ops.object.mode_set(mode="OBJECT")


def run(input_path: str, output_path: str, classification: str, target_polys: int) -> dict:
    io_glb.import_glb(input_path)
    objs = io_glb.mesh_objects()
    if not objs:
        raise ValueError("No mesh found in the source GLB.")

    source_tris = io_glb.triangle_count()
    # QuadriFlow's target is faces (mostly quads), not triangles - ~2 tris/quad.
    target_faces_total = max(4, target_polys // 2)

    # Allocate the face budget proportionally by each object's current polygon count
    # so large objects aren't starved when the GLB has multiple meshes.
    obj_face_counts = [_face_count(obj) for obj in objs]
    total_faces = max(1, sum(obj_face_counts))

    for obj, obj_faces in zip(objs, obj_face_counts):
        frac = obj_faces / total_faces
        target_for_obj = max(4, int(target_faces_total * frac))
        _mark_sharp_edges(obj)
        _quadriflow(obj, target_for_obj)
        _cleanup(obj)

    result_tris = io_glb.triangle_count()
    io_glb.export_glb(output_path)

    return {
        "sourcePolys": source_tris,
        "resultPolys": result_tris,
        "classification": classification,
        "reduction": (1 - result_tris / source_tris) if source_tris else 0,
    }
