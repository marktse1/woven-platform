# Mesh Loom Tier-2 worker: polls app/api/tools/retopology/jobs for queued
# retopo_jobs rows and runs the matching Blender pipeline stage (retopo,
# segment, finalize). Deploy with:
#
#   modal deploy worker/modal_app.py
#
# Requires a Modal secret named "woven-worker-env" with WOVEN_BASE_URL,
# RETOPO_WORKER_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        # Headless Blender still links against these even with no display attached.
        "libxrender1",
        "libxi6",
        "libxkbcommon0",
        "libxfixes3",
        "libxxf86vm1",
        "libsm6",
        "libgl1",
    )
    .pip_install("bpy==4.5.11", "requests==2.32.3", "numpy==1.26.4", "trimesh==4.6.14")
    .add_local_python_source("pipeline")
)

app = modal.App("mesh-loom-worker", image=image)

WORKER_SECRETS = [modal.Secret.from_name("woven-worker-env")]


def _run_one() -> dict | None:
    from pipeline.claim import claim_job, report_job
    from pipeline.dispatch import process_job

    job = claim_job()
    if not job:
        return None

    try:
        output_asset, stats = process_job(job)
        report_job(job["id"], "done", output_asset_id=output_asset["id"], stats=stats)
        return {"jobId": job["id"], "op": job["op"], "status": "done"}
    except Exception as e:  # noqa: BLE001 - report every failure, never leave a job stuck "processing"
        report_job(job["id"], "failed", error=str(e))
        return {"jobId": job["id"], "op": job.get("op"), "status": "failed", "error": str(e)}


@app.function(
    schedule=modal.Period(seconds=15),
    secrets=WORKER_SECRETS,
    timeout=900,
)
def poll_and_process() -> dict | None:
    return _run_one()


@app.function(secrets=WORKER_SECRETS, timeout=900)
def process_once() -> dict | None:
    """Manual trigger for testing: `modal run worker/modal_app.py`."""
    return _run_one()


@app.local_entrypoint()
def main() -> None:
    result = process_once.remote()
    print(result if result is not None else "No queued job found.")
