# Mesh Loom Tier-2 worker

Headless-Blender worker for the Pipeline Studio's heavier ops: quad
retopology with edge loops (`retopo`), animation-part labeling (`segment`),
and the deterministic UV-unwrap + hi→lo texture bake (`finalize`).

Polls `app/api/tools/retopology/jobs` (unchanged on the Next.js side) for
queued `retopo_jobs` rows via a shared `x-worker-secret`, processes the
matching stage with `bpy` (no full Blender install - the `bpy` PyPI wheel),
and reports the result back.

## Layout

- `modal_app.py` - Modal App/Image definition + the scheduled poll loop.
- `pipeline/claim.py` - GET-claim / PATCH-report against the job queue.
- `pipeline/io_glb.py` - Supabase Storage/REST I/O (service-role key) + bpy import/export helpers.
- `pipeline/retopo.py` - `bpy.ops.object.quadriflow_remesh` + sharp-edge marking.
- `pipeline/segment.py` - PCA-banded animation-part labels, layered on connectivity segments.
- `pipeline/uv_bake.py` - `smart_project` unwrap + Cycles cage bake (albedo/normal/AO/roughness/metallic) with dilation and a ray-miss cage-extrusion retry.

## Deploy

Requires a Modal secret named `woven-worker-env` with:
`WOVEN_BASE_URL`, `RETOPO_WORKER_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

```
modal deploy worker/modal_app.py
```

Test a single poll without waiting for the schedule:

```
modal run worker/modal_app.py
```

## Known v1 limitations

- `segment.py`'s per-object PCA banding is a coarse heuristic - it works best
  when a classification's whole body is one connected mesh object, and its
  head/torso/limb/tail thresholds are not yet tuned against real character
  assets. Not currently triggered by the UI (Pipeline Studio's Tier-1
  connectivity segmentation is what's wired up today).
- `uv_bake.py` relies on `smart_project`'s own area-weighted scaling rather
  than a full per-island world-area texel-density normalization pass.
- AO is multiplied into the baked albedo rather than wired into a dedicated
  glTF `occlusionTexture` slot - Blender's exporter emits a benign warning
  about this but still produces a valid file.
