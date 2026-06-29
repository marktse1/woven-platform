"""
Blender QuadriFlow remesh script for the Forge worker.

Usage:
  blender --background --python scripts/blender_quadremesh.py -- \
    <input.glb> <output.glb> <target_faces>

QuadriFlow produces a quad-dominant mesh with edge loops that follow surface
curvature — suitable for animation rigs. UVs are stripped; run a Bake step
after retopology to transfer textures from the original hi-res source.

Requires Blender 3.5+ (QuadriFlow remesh bundled as a built-in operator).
"""

import bpy
import sys
import os

# ---- parse args passed after "--" ------------------------------------------------
argv = sys.argv
try:
    sep = argv.index("--")
    args = argv[sep + 1:]
except ValueError:
    print("ERROR: pass args after '--'", file=sys.stderr)
    sys.exit(1)

if len(args) < 3:
    print("ERROR: expected <input.glb> <output.glb> <target_faces>", file=sys.stderr)
    sys.exit(1)

input_path   = args[0]
output_path  = args[1]
target_faces = int(args[2])

if not os.path.exists(input_path):
    print(f"ERROR: input not found: {input_path}", file=sys.stderr)
    sys.exit(1)

# ---- clear default scene (delete all existing objects without resetting Python) ---
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.meshes):
    bpy.data.meshes.remove(block)

print(f"DEBUG: importing GLB: {input_path}")
sys.stdout.flush()

# ---- import GLB ------------------------------------------------------------------
bpy.ops.import_scene.gltf(filepath=input_path)

mesh_objects = [o for o in bpy.data.objects if o.type == "MESH"]
print(f"DEBUG: found {len(mesh_objects)} mesh objects after import")
sys.stdout.flush()

if not mesh_objects:
    print("ERROR: no mesh objects found in GLB", file=sys.stderr)
    sys.exit(1)

# ---- deselect all, then select only mesh objects ---------------------------------
bpy.ops.object.select_all(action="DESELECT")
for obj in mesh_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_objects[0]

# ---- join all meshes into one object (QuadriFlow works on a single mesh) ---------
if len(mesh_objects) > 1:
    bpy.ops.object.join()

obj = bpy.context.view_layer.objects.active
obj.select_set(True)
print(f"DEBUG: active object: {obj.name}, verts: {len(obj.data.vertices)}")
sys.stdout.flush()

# ---- apply all modifiers before remesh ------------------------------------------
for mod in list(obj.modifiers):
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception as e:
        print(f"WARNING: could not apply modifier {mod.name}: {e}")

# ---- QuadriFlow remesh -----------------------------------------------------------
print(f"DEBUG: running QuadriFlow remesh, target_faces={target_faces}")
sys.stdout.flush()
result = bpy.ops.object.quadriflow_remesh(
    use_paint_symmetry=False,
    use_preserve_sharp=True,
    use_preserve_boundary=True,
    mode="FACES",
    target_faces=target_faces,
    seed=0,
)
print(f"DEBUG: quadriflow result={result}, faces after={len(obj.data.polygons)}")
sys.stdout.flush()

if "FINISHED" not in result:
    print(f"ERROR: quadriflow_remesh returned {result}", file=sys.stderr)
    sys.exit(1)

# ---- export result ---------------------------------------------------------------
# Use use_selection=False to export all objects (avoids silent failure when
# selection state is lost after remesh operator).
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
result_faces = len(obj.data.polygons)
print(f"DEBUG: exporting {result_faces} faces to {output_path}")
sys.stdout.flush()

bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format="GLB",
    export_apply=True,
    use_selection=False,
    export_materials="NONE",  # no materials — bake step will add them
)

import os as _os
if not _os.path.exists(output_path):
    print("ERROR: export produced no file", file=sys.stderr)
    sys.exit(1)

print(f"quadremesh_done input={input_path} output={output_path} faces={result_faces}")
sys.stdout.flush()
