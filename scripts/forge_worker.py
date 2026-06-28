"""
Forge worker — polls the Woven retopology job queue and processes each job
with Blender QuadriFlow.

Setup:
  pip install requests

Run:
  WOVEN_API_URL=https://woven.app \
  RETOPO_WORKER_SECRET=<your-secret> \
  BLENDER_PATH=/Applications/Blender.app/Contents/MacOS/Blender \
  python scripts/forge_worker.py

The worker polls every 5 seconds, claims the oldest queued job, runs Blender
QuadriFlow, uploads the result via the /api/tools/retopology/upload endpoint,
then patches the job as done.

RETOPO_WORKER_SECRET must match the RETOPO_WORKER_SECRET environment variable
set in Vercel. Set it there under Settings → Environment Variables.
"""

import os
import sys
import tempfile
import subprocess
import pathlib
import time
import requests

# ---- config from environment -----------------------------------------------------
API_URL = os.environ.get("WOVEN_API_URL", "").rstrip("/")
SECRET  = os.environ.get("RETOPO_WORKER_SECRET", "")
BLENDER = os.environ.get("BLENDER_PATH", "blender")
SCRIPT  = pathlib.Path(__file__).parent / "blender_quadremesh.py"

if not API_URL or not SECRET:
    print("ERROR: WOVEN_API_URL and RETOPO_WORKER_SECRET must be set.", file=sys.stderr)
    sys.exit(1)

HEADERS = {"x-worker-secret": SECRET}
JOBS_URL   = f"{API_URL}/api/tools/retopology/jobs"
UPLOAD_URL = f"{API_URL}/api/tools/retopology/upload"


def process_job(job: dict) -> None:
    job_id        = job["id"]
    signed_url    = job.get("input_signed_url")
    target_polys  = job.get("target_polys") or 5000
    user_id       = job["clerk_user_id"]

    if not signed_url:
        raise ValueError("Job has no input_signed_url — was the API updated?")

    print(f"[{job_id}] starting — target {target_polys} polys")

    with tempfile.TemporaryDirectory() as tmp:
        inp = os.path.join(tmp, "input.glb")
        out = os.path.join(tmp, "output.glb")

        # Download input GLB
        r = requests.get(signed_url, timeout=120)
        r.raise_for_status()
        with open(inp, "wb") as f:
            f.write(r.content)
        print(f"[{job_id}] downloaded {len(r.content):,} bytes")

        # Run Blender QuadriFlow
        result = subprocess.run(
            [BLENDER, "--background", "--python", str(SCRIPT),
             "--", inp, out, str(target_polys)],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode != 0:
            print(result.stderr[-2000:])
            raise RuntimeError(f"Blender exited {result.returncode}")
        print(f"[{job_id}] blender done")
        for line in result.stdout.splitlines():
            if "quadremesh_done" in line:
                print(f"[{job_id}] {line}")

        # Upload result
        with open(out, "rb") as f:
            glb_bytes = f.read()
        r = requests.post(
            UPLOAD_URL,
            headers=HEADERS,
            files={"glb": (f"retopo-{job_id[:8]}.glb", glb_bytes, "model/gltf-binary")},
            data={"userId": user_id, "name": f"retopo-{job_id[:8]}.glb"},
            timeout=120,
        )
        r.raise_for_status()
        asset_id = r.json()["assetId"]
        print(f"[{job_id}] uploaded → asset {asset_id}")

    # Report done
    requests.patch(
        JOBS_URL,
        headers=HEADERS,
        json={
            "jobId": job_id,
            "status": "done",
            "outputAssetId": asset_id,
            "stats": {"targetFaces": target_polys},
        },
        timeout=30,
    ).raise_for_status()
    print(f"[{job_id}] complete")


def main() -> None:
    print(f"Forge worker ready — polling {JOBS_URL}")
    print(f"Blender: {BLENDER}  |  Script: {SCRIPT}")

    while True:
        try:
            r = requests.get(JOBS_URL, headers=HEADERS, timeout=30)
            r.raise_for_status()
            job = r.json().get("job")

            if job:
                try:
                    process_job(job)
                except Exception as exc:
                    # Report failure back to the API so the UI shows the error
                    print(f"[{job['id']}] FAILED: {exc}")
                    try:
                        requests.patch(
                            JOBS_URL,
                            headers=HEADERS,
                            json={"jobId": job["id"], "status": "failed", "error": str(exc)},
                            timeout=30,
                        )
                    except Exception:
                        pass
            else:
                time.sleep(5)

        except KeyboardInterrupt:
            print("Stopping.")
            break
        except Exception as exc:
            print(f"Poll error: {exc}")
            time.sleep(10)


if __name__ == "__main__":
    main()
