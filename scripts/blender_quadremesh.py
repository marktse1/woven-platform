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

# ---- clear default scene ---------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---- import GLB ------------------------------------------------------------------
bpy.ops.import_scene.gltf(filepath=input_path)

mesh_objects = [o for o in bpy.data.objects if o.type == "MESH"]
if not mesh_objects:
    print("ERROR: no mesh objects found in GLB", file=sys.stderr)
    sys.exit(1)

# ---- join all meshes into one object (QuadriFlow works on a single mesh) ---------
for obj in mesh_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_objects[0]

if len(mesh_objects) > 1:
    bpy.ops.object.join()

obj = bpy.context.view_layer.objects.active
obj.select_set(True)

# ---- apply all modifiers before remesh ------------------------------------------
for mod in obj.modifiers:
    bpy.ops.object.modifier_apply(modifier=mod.name)

# ---- QuadriFlow remesh -----------------------------------------------------------
# use_preserve_sharp: keep sharp creases (helps with hard-surface details)
# use_preserve_boundary: keep open boundary edges (important for characters with
#   separate eye/mouth openings that should stay as clean loops)
bpy.ops.object.quadriflow_remesh(
    use_paint_symmetry=False,
    use_preserve_sharp=True,
    use_preserve_boundary=True,
    mode="FACES",
    target_faces=target_faces,
    seed=0,
)

# ---- export result ---------------------------------------------------------------
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format="GLB",
    export_apply=True,
    use_selection=True,
    export_materials="NONE",  # no materials — bake step will add them
)

result_tris = len(obj.data.polygons)
print(f"quadremesh_done input={input_path} output={output_path} faces={result_tris}")
