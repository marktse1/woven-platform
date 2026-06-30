# Routes a claimed retopo_jobs row to the right pipeline stage and produces
# a new creator_assets row from the result.
#
# retopo/segment operate on job["source_asset_id"], which is the *current*
# working asset at the time the step was queued (queueTier2Step in
# lib/assets.ts always passes inputAssetId = the session's current_asset_id).
# finalize additionally needs the session's *original* hi-res source (with
# its original textures) to bake from - that's looked up via the job's
# linked pipeline_step -> pipeline_session, not from the job row itself.

import os
import tempfile

from . import io_glb, meshanything, retopo, segment, uv_bake


def process_job(job: dict) -> tuple[dict, dict]:
    op = job["op"]
    classification = job.get("classification") or "auto"
    target_polys = job.get("target_polys") or 10000

    source_asset = io_glb.get_asset(job["source_asset_id"])
    source_bytes = io_glb.download_asset_bytes(source_asset["storage_path"])

    with tempfile.TemporaryDirectory() as tmp:
        input_path = os.path.join(tmp, "input.glb")
        output_path = os.path.join(tmp, "output.glb")
        with open(input_path, "wb") as f:
            f.write(source_bytes)

        if op == "retopo":
            # Segment face-set guidance is stored in the step's params (same
            # pattern as finalize/bake reads dilationPx from step params).
            step = io_glb.get_step(job["pipeline_step_id"]) if job.get("pipeline_step_id") else None
            step_params = (step or {}).get("params") or {}
            segment_data_b64 = step_params.get("segmentData")
            stats = retopo.run(input_path, output_path, classification, target_polys, segment_data_b64=segment_data_b64)
        elif op == "segment":
            stats = segment.run(input_path, output_path, classification)
        elif op == "finalize":
            step = io_glb.get_step(job["pipeline_step_id"]) if job.get("pipeline_step_id") else None
            session = io_glb.get_session(step["session_id"]) if step else None
            if not session:
                raise ValueError("finalize job is missing its pipeline session context")

            hi_res_asset = io_glb.get_asset(session["source_asset_id"])
            hi_res_bytes = io_glb.download_asset_bytes(hi_res_asset["storage_path"])
            high_path = os.path.join(tmp, "source.glb")
            with open(high_path, "wb") as f:
                f.write(hi_res_bytes)

            bake_maps = job.get("bake_maps") or ["normal", "ao", "albedo"]
            params = (step or {}).get("params") or {}
            dilation_px = int(params.get("dilationPx", 16))
            stats = uv_bake.run(input_path, high_path, output_path, bake_maps, dilation_px=dilation_px)
        elif op == "meshanything":
            step = io_glb.get_step(job["pipeline_step_id"]) if job.get("pipeline_step_id") else None
            step_params = (step or {}).get("params") or {}
            preset = step_params.get("preset", "balanced")
            stats = meshanything.run(input_path, output_path, target_polys=target_polys, preset=preset)
        else:
            raise ValueError(f"unknown job op: {op}")

        with open(output_path, "rb") as f:
            output_bytes = f.read()

    output_name = f"{source_asset['name'].rsplit('.', 1)[0]}-{op}.glb"
    output_asset = io_glb.upload_asset(
        clerk_user_id=job["clerk_user_id"],
        name=output_name,
        data=output_bytes,
        poly_count=stats.get("resultPolys"),
        meta=stats,
    )
    return output_asset, stats
