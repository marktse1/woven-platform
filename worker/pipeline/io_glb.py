# Supabase access for the worker: asset/storage I/O via the service-role
# key (no Clerk session here, mirrors lib/supabase-admin.ts's pattern but in
# Python), plus thin bpy helpers shared by every pipeline stage.

import os
import time
import uuid

import bpy
import requests

BUCKET = "creator-assets"


def _supabase_url() -> str:
    return os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")


def _service_headers() -> dict:
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def get_asset(asset_id: str) -> dict:
    r = requests.get(
        f"{_supabase_url()}/rest/v1/creator_assets",
        params={"id": f"eq.{asset_id}", "select": "*"},
        headers=_service_headers(),
        timeout=20,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise ValueError(f"asset {asset_id} not found")
    return rows[0]


def get_step(step_id: str) -> dict | None:
    r = requests.get(
        f"{_supabase_url()}/rest/v1/pipeline_steps",
        params={"id": f"eq.{step_id}", "select": "*"},
        headers=_service_headers(),
        timeout=20,
    )
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def get_session(session_id: str) -> dict | None:
    r = requests.get(
        f"{_supabase_url()}/rest/v1/pipeline_sessions",
        params={"id": f"eq.{session_id}", "select": "*"},
        headers=_service_headers(),
        timeout=20,
    )
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def download_asset_bytes(storage_path: str) -> bytes:
    url = f"{_supabase_url()}/storage/v1/object/{BUCKET}/{storage_path}"
    last_err: Exception | None = None
    for attempt in range(4):
        if attempt:
            time.sleep(5 * attempt)  # 5s, 10s, 15s between retries
        try:
            r = requests.get(url, headers=_service_headers(), timeout=180)
            r.raise_for_status()
            return r.content
        except requests.HTTPError as exc:
            # 502/503/504 are transient gateway errors; retry
            if exc.response is not None and exc.response.status_code in (502, 503, 504) and attempt < 3:
                print(f"download: {exc.response.status_code} on attempt {attempt + 1}, retrying…")
                last_err = exc
                continue
            raise
    raise last_err  # type: ignore[misc]


def upload_asset(
    clerk_user_id: str,
    name: str,
    data: bytes,
    poly_count: int | None = None,
    visibility: str = "private",
    meta: dict | None = None,
) -> dict:
    """Mirrors lib/assets.ts's uploadAsset() so worker output rows look identical
    to ones the browser creates."""
    asset_id = str(uuid.uuid4())
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
    storage_path = f"{clerk_user_id}/{asset_id}-{safe_name}"

    up = requests.post(
        f"{_supabase_url()}/storage/v1/object/{BUCKET}/{storage_path}",
        headers={**_service_headers(), "Content-Type": "model/gltf-binary"},
        data=data,
        timeout=180,
    )
    up.raise_for_status()

    row = {
        "id": asset_id,
        "clerk_user_id": clerk_user_id,
        "name": name,
        "kind": "model",
        "format": "glb",
        "visibility": visibility,
        "storage_path": storage_path,
        "file_bytes": len(data),
        "poly_count": poly_count,
        "meta": meta or {},
    }
    ins = requests.post(
        f"{_supabase_url()}/rest/v1/creator_assets",
        headers={
            **_service_headers(),
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        json=row,
        timeout=20,
    )
    ins.raise_for_status()
    return ins.json()[0]


# ---------------------------------------------------------------------------
# bpy helpers shared by retopo.py / segment.py / uv_bake.py
# ---------------------------------------------------------------------------


def import_glb(path: str) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    _weld_all_meshes()


def _weld_all_meshes() -> None:
    """glTF stores meshes pre-split per loop (every UV seam/hard edge becomes
    a duplicate coincident vertex) and Blender's importer preserves that
    exactly - left as-is, the mesh reads as non-manifold everywhere, which
    breaks quadriflow_remesh and fragments segment.py's connectivity
    analysis at every seam. Weld-by-distance restores real topology."""
    for obj in mesh_objects():
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=0.0001)
        bpy.ops.object.mode_set(mode="OBJECT")


def export_glb(path: str) -> None:
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_extras=True)


def mesh_objects() -> list:
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def triangle_count() -> int:
    total = 0
    for obj in mesh_objects():
        for poly in obj.data.polygons:
            total += max(0, len(poly.vertices) - 2)
    return total
