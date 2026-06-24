# Deterministic UV unwrap + hi-res -> lo-res texture bake. No generative AI
# anywhere in this file on purpose - UV unwrapping and baking are solved,
# deterministic problems (the same approach Blender/Substance/xNormal use),
# and that's what avoids the bleeding/seam artifacts this pipeline exists to
# prevent.
#
# Known v1 simplification: island packing relies on Smart UV Project's own
# area_weight scaling rather than a full per-island world-area texel-density
# normalization pass. That's a real quality nuance worth revisiting, but the
# two things explicitly called out as required - seam dilation and a
# cage/ray-distance fallback for missed texels - are both implemented below.

import math

import bpy
import numpy as np

from . import io_glb

BAKE_TYPE_FOR_MAP = {
    "albedo": "DIFFUSE",
    "normal": "NORMAL",
    "ao": "AO",
    "roughness": "ROUGHNESS",
}
# "metallic" has no native Cycles bake pass - handled via _bake_metallic_via_emission.


def _bbox_diagonal(obj) -> float:
    if not obj.bound_box:
        return 1.0
    corners = [obj.matrix_world @ __import__("mathutils").Vector(c) for c in obj.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    return math.dist((min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))) or 1.0


def _new_image(name: str, size: int):
    img = bpy.data.images.new(name, width=size, height=size, alpha=True)
    return img


def _miss_fraction(image) -> float:
    arr = np.array(image.pixels[:], dtype=np.float32)
    alpha = arr[3::4]
    if alpha.size == 0:
        return 1.0
    covered = np.count_nonzero(alpha > 0.01)
    return 1.0 - (covered / alpha.size)


def _temp_image_node(material, image):
    nt = material.node_tree
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = image
    nt.nodes.active = node
    return node


def _select_for_bake(low_obj, high_obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    high_obj.select_set(True)
    low_obj.select_set(True)
    bpy.context.view_layer.objects.active = low_obj


def _bake_with_retry(low_obj, high_obj, bake_type: str, image, margin_px: int, samples: int) -> float:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples

    diag = _bbox_diagonal(low_obj)
    last_miss = 1.0
    for cage_extrusion in (0.0, diag * 0.01, diag * 0.03):
        _select_for_bake(low_obj, high_obj)
        bpy.ops.object.bake(
            type=bake_type,
            use_selected_to_active=True,
            cage_extrusion=cage_extrusion,
            max_ray_distance=diag * 0.05,
            margin=margin_px,
            margin_type="EXTEND",
        )
        last_miss = _miss_fraction(image)
        # Most of a well-packed UV layout is legitimately empty padding -
        # only retry with a bigger cage if coverage looks badly wrong.
        if last_miss < 0.85:
            break
    return last_miss


def _bake_standard_map(low_obj, high_obj, map_name: str, size: int, margin_px: int, samples: int):
    bake_type = BAKE_TYPE_FOR_MAP[map_name]
    image = _new_image(f"bake_{map_name}", size)
    temp_nodes = [
        (mat, _temp_image_node(mat, image)) for mat in low_obj.data.materials if mat and mat.use_nodes
    ]

    if bake_type == "DIFFUSE":
        scene = bpy.context.scene
        scene.render.bake.use_pass_direct = False
        scene.render.bake.use_pass_indirect = False
        scene.render.bake.use_pass_color = True

    miss = _bake_with_retry(low_obj, high_obj, bake_type, image, margin_px, samples)

    for mat, node in temp_nodes:
        mat.node_tree.nodes.remove(node)
    return image, miss


def _bake_metallic_via_emission(low_obj, high_obj, size: int, margin_px: int, samples: int):
    """Cycles has no native METALLIC bake pass. Standard workaround: reroute
    Metallic into an Emission shader and bake EMIT - done on a disposable
    duplicate object/materials so the real low_obj is never mutated."""
    dup = low_obj.copy()
    dup.data = low_obj.data.copy()
    bpy.context.collection.objects.link(dup)

    image = _new_image("bake_metallic", size)
    for slot in dup.material_slots:
        if not slot.material or not slot.material.use_nodes:
            continue
        mat = slot.material.copy()
        slot.material = mat
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        output = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if not bsdf or not output:
            continue

        metallic_input = bsdf.inputs.get("Metallic")
        emission = nt.nodes.new("ShaderNodeEmission")
        incoming = next((l for l in nt.links if l.to_socket == metallic_input), None)
        if incoming:
            nt.links.new(incoming.from_socket, emission.inputs["Color"])
        else:
            v = metallic_input.default_value if metallic_input else 0.0
            emission.inputs["Color"].default_value = (v, v, v, 1.0)
        nt.links.new(emission.outputs["Emission"], output.inputs["Surface"])
        _temp_image_node(mat, image)

    miss = _bake_with_retry(dup, high_obj, "EMIT", image, margin_px, samples)

    bpy.data.objects.remove(dup, do_unlink=True)
    return image, miss


def _wire_into_material(low_obj, albedo=None, normal=None, ao=None, roughness=None, metallic=None) -> None:
    for mat in low_obj.data.materials:
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        output = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if not bsdf or not output:
            continue
        nt.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

        if albedo:
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = albedo
            nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])

        if roughness:
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = roughness
            node.image.colorspace_settings.name = "Non-Color"
            nt.links.new(node.outputs["Color"], bsdf.inputs["Roughness"])

        if metallic:
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = metallic
            node.image.colorspace_settings.name = "Non-Color"
            nt.links.new(node.outputs["Color"], bsdf.inputs["Metallic"])

        if normal:
            tex_node = nt.nodes.new("ShaderNodeTexImage")
            tex_node.image = normal
            tex_node.image.colorspace_settings.name = "Non-Color"
            normal_map = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(tex_node.outputs["Color"], normal_map.inputs["Color"])
            nt.links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])

        if ao:
            ao_node = nt.nodes.new("ShaderNodeTexImage")
            ao_node.image = ao
            ao_node.image.colorspace_settings.name = "Non-Color"
            if albedo:
                base_color_input = bsdf.inputs["Base Color"]
                incoming = next((l for l in nt.links if l.to_socket == base_color_input), None)
                mix = nt.nodes.new("ShaderNodeMixRGB")
                mix.blend_type = "MULTIPLY"
                mix.inputs["Fac"].default_value = 1.0
                if incoming:
                    nt.links.new(incoming.from_socket, mix.inputs["Color1"])
                nt.links.new(ao_node.outputs["Color"], mix.inputs["Color2"])
                nt.links.new(mix.outputs["Color"], base_color_input)


def run(
    low_input_path: str,
    high_input_path: str,
    output_path: str,
    bake_maps: list[str],
    dilation_px: int = 16,
    resolution: int = 2048,
) -> dict:
    io_glb.import_glb(low_input_path)
    low_objs = io_glb.mesh_objects()
    if not low_objs:
        raise ValueError("No mesh found in the working GLB.")
    low_obj = low_objs[0]
    if len(low_objs) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for o in low_objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = low_objs[0]
        bpy.ops.object.join()
        low_obj = bpy.context.view_layer.objects.active

    # New UV layout for the low-poly result - deterministic chart-cutting,
    # not carried over from the source's original (often decimation-mangled) UVs.
    bpy.ops.object.select_all(action="DESELECT")
    low_obj.select_set(True)
    bpy.context.view_layer.objects.active = low_obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(66),
        island_margin=0.02,
        area_weight=1.0,
        correct_aspect=True,
        scale_to_bounds=True,
    )
    bpy.ops.object.mode_set(mode="OBJECT")

    bpy.ops.import_scene.gltf(filepath=high_input_path)
    high_objs = [o for o in io_glb.mesh_objects() if o is not low_obj]
    if not high_objs:
        raise ValueError("No high-res source mesh found to bake from.")
    bpy.ops.object.select_all(action="DESELECT")
    for o in high_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = high_objs[0]
    if len(high_objs) > 1:
        bpy.ops.object.join()
    high_obj = bpy.context.view_layer.objects.active

    if not low_obj.data.materials:
        mat = bpy.data.materials.new("woven_bake_target")
        mat.use_nodes = True
        low_obj.data.materials.append(mat)

    images: dict[str, object] = {}
    miss_stats: dict[str, float] = {}
    for map_name in bake_maps:
        if map_name == "metallic":
            img, miss = _bake_metallic_via_emission(low_obj, high_obj, resolution, dilation_px, samples=8)
        elif map_name in BAKE_TYPE_FOR_MAP:
            samples = 32 if map_name in ("albedo", "ao") else 8
            img, miss = _bake_standard_map(low_obj, high_obj, map_name, resolution, dilation_px, samples)
        else:
            continue
        images[map_name] = img
        miss_stats[map_name] = round(miss, 4)

    _wire_into_material(
        low_obj,
        albedo=images.get("albedo"),
        normal=images.get("normal"),
        ao=images.get("ao"),
        roughness=images.get("roughness"),
        metallic=images.get("metallic"),
    )

    bpy.data.objects.remove(high_obj, do_unlink=True)
    io_glb.export_glb(output_path)

    return {
        "bakedMaps": list(images.keys()),
        "missFraction": miss_stats,
        "resolution": resolution,
        "dilationPx": dilation_px,
    }
