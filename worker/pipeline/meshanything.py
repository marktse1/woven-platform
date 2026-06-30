"""
MeshAnything V2 — AI topology generation via Replicate API.

Requires REPLICATE_API_KEY in the Modal secret (woven-worker-env).
Add it via the Modal web dashboard: https://modal.com/secrets
  → woven-worker-env → Edit → add REPLICATE_API_KEY = r8_...

Model: https://replicate.com/adirik/meshanything-v2
Input: GLB or OBJ file  Output: OBJ (converted to GLB here)
Average inference time: 60–90 s.
"""

import os
import time
import tempfile
import logging

import requests

log = logging.getLogger(__name__)

REPLICATE_API_KEY = os.environ.get("REPLICATE_API_KEY", "")
REPLICATE_API_BASE = "https://api.replicate.com/v1"

# Community-hosted MeshAnything V2 on Replicate.
# See https://replicate.com/adirik/meshanything-v2 for version IDs.
MODEL_ID = "adirik/meshanything-v2"

# Face count per preset
PRESET_FACES = {"fast": 800, "balanced": 2000, "quality": 4000}


def run(input_path: str, output_path: str, target_polys: int = 2000, preset: str = "balanced") -> dict:
    """
    Run MeshAnything V2 on the GLB at input_path and write the result to output_path.
    Returns a stats dict: {faces, preset}.
    """
    if not REPLICATE_API_KEY:
        raise ValueError(
            "REPLICATE_API_KEY is not set. "
            "Add it via the Modal web dashboard at https://modal.com/secrets "
            "→ woven-worker-env → Edit → REPLICATE_API_KEY = r8_..."
        )

    face_count = PRESET_FACES.get(preset, target_polys)
    log.info("MeshAnything V2: preset=%s faces=%d", preset, face_count)

    # Upload the input GLB to Replicate file storage
    mesh_url = _upload_file(input_path, "model/gltf-binary")
    log.info("Uploaded input to Replicate: %s", mesh_url)

    headers = {
        "Authorization": f"Token {REPLICATE_API_KEY}",
        "Content-Type": "application/json",
    }

    # Create prediction
    pred_res = requests.post(
        f"{REPLICATE_API_BASE}/predictions",
        headers=headers,
        json={
            "model": MODEL_ID,
            "input": {
                "mesh": mesh_url,
                "face_number": face_count,
            },
        },
        timeout=30,
    )

    if pred_res.status_code == 404:
        raise RuntimeError(
            f"Replicate model '{MODEL_ID}' not found. "
            "The MeshAnything V2 model may have moved — check "
            "https://replicate.com and update MODEL_ID in worker/pipeline/meshanything.py"
        )
    pred_res.raise_for_status()

    prediction = pred_res.json()
    pred_id = prediction["id"]
    log.info("Created prediction %s", pred_id)

    # Poll until done (timeout: 12 minutes)
    deadline = time.time() + 720
    while time.time() < deadline:
        poll = requests.get(
            f"{REPLICATE_API_BASE}/predictions/{pred_id}",
            headers={"Authorization": f"Token {REPLICATE_API_KEY}"},
            timeout=30,
        )
        poll.raise_for_status()
        data = poll.json()
        status = data.get("status")
        log.info("Prediction %s status: %s", pred_id, status)

        if status == "succeeded":
            output = data.get("output")
            if isinstance(output, list):
                output = output[0]
            if not output:
                raise RuntimeError("MeshAnything V2 succeeded but returned no output URL.")
            _download_and_convert(output, output_path)
            return {"faces": face_count, "preset": preset}

        elif status in ("failed", "canceled"):
            err = data.get("error") or "unknown error"
            raise RuntimeError(f"MeshAnything V2 {status}: {err}")

        time.sleep(6)

    raise TimeoutError("MeshAnything V2 prediction timed out after 12 minutes.")


def _upload_file(path: str, content_type: str) -> str:
    """Upload a local file to Replicate file storage and return its public URL.

    Replicate requires both Content-Type AND Content-Disposition headers;
    omitting Content-Disposition causes a 400 Bad Request.
    """
    import os as _os
    filename = _os.path.basename(path)
    with open(path, "rb") as f:
        data = f.read()
    res = requests.post(
        f"{REPLICATE_API_BASE}/files",
        headers={
            "Authorization": f"Token {REPLICATE_API_KEY}",
            "Content-Type": content_type,
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
        data=data,
        timeout=60,
    )
    if res.status_code == 400:
        raise RuntimeError(
            f"Replicate file upload failed (400): {res.text[:200]}"
        )
    res.raise_for_status()
    return res.json()["urls"]["get"]


def _download_and_convert(url: str, output_glb_path: str) -> None:
    """Download the Replicate output (OBJ or GLB) and write a GLB to output_glb_path."""
    r = requests.get(url, timeout=120)
    r.raise_for_status()

    content_type = r.headers.get("Content-Type", "")
    is_obj = url.lower().endswith(".obj") or "text/plain" in content_type or "wavefront" in content_type

    if is_obj:
        import trimesh
        with tempfile.NamedTemporaryFile(suffix=".obj", delete=False) as tmp:
            tmp.write(r.content)
            tmp_path = tmp.name
        mesh = trimesh.load(tmp_path, force="mesh")
        mesh.export(output_glb_path)
        os.unlink(tmp_path)
        log.info("Converted OBJ → GLB at %s", output_glb_path)
    else:
        with open(output_glb_path, "wb") as f:
            f.write(r.content)
        log.info("Wrote GLB at %s", output_glb_path)
