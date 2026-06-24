# Polling client for the worker-facing job queue endpoint at
# app/api/tools/retopology/jobs/route.ts. That route already does exactly
# "claim the oldest queued retopo_jobs row" / "update by id" generically -
# nothing there needs to change for this worker to plug in.

import os

import requests


def _base_url() -> str:
    return os.environ["WOVEN_BASE_URL"].rstrip("/")


def _headers() -> dict:
    return {"x-worker-secret": os.environ["RETOPO_WORKER_SECRET"]}


def claim_job() -> dict | None:
    r = requests.get(
        f"{_base_url()}/api/tools/retopology/jobs",
        headers=_headers(),
        timeout=20,
    )
    r.raise_for_status()
    return r.json().get("job")


def report_job(
    job_id: str,
    status: str,
    output_asset_id: str | None = None,
    stats: dict | None = None,
    error: str | None = None,
) -> dict:
    body = {
        "jobId": job_id,
        "status": status,
        "outputAssetId": output_asset_id,
        "stats": stats or {},
        "error": error,
    }
    r = requests.patch(
        f"{_base_url()}/api/tools/retopology/jobs",
        headers=_headers(),
        json=body,
        timeout=20,
    )
    r.raise_for_status()
    return r.json()
