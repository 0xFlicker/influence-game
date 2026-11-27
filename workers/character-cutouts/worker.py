"""Pinned CPU BiRefNet recipe; local files and HTTP jobs share identical inference."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import resource
import sys
import time
import traceback
import urllib.error
import urllib.request

RECIPE = "birefnet-general-58f621f0-rembg2.0.86-r1"


def cgroup_metrics(root=Path("/sys/fs/cgroup")):
    """Read Docker cgroup v2 or Fargate cgroup v1 diagnostics, when exposed."""
    def read(*paths):
        for path in paths:
            try:
                return (root / path).read_text().strip()
            except FileNotFoundError:
                continue
        return None

    cpu = read("cpu.max")
    if cpu is None:
        quota = read("cpu/cpu.cfs_quota_us", "cpu,cpuacct/cpu.cfs_quota_us")
        period = read("cpu/cpu.cfs_period_us", "cpu,cpuacct/cpu.cfs_period_us")
        cpu = f"{quota} {period}" if quota is not None and period is not None else None
    peak = read("memory.peak", "memory/memory.max_usage_in_bytes")
    return {"cpu_max": cpu,
            "memory_max": read("memory.max", "memory/memory.limit_in_bytes"),
            "cgroup_peak_bytes": int(peak) if peak is not None else None}


def process(session, source):
    from PIL import Image, ImageOps
    from rembg import remove
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(source))).convert("RGB")
    result = remove(image, session=session)
    assert result.mode == "RGBA" and result.size == image.size
    output = io.BytesIO()
    result.save(output, format="PNG")
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    from rembg import new_session
    start = time.monotonic()
    session = new_session("birefnet-general", providers=["CPUExecutionProvider"])
    metrics = {"recipe": RECIPE, "load_seconds": time.monotonic() - start,
               **cgroup_metrics(), "images": []}
    if args.input:
        if not args.output:
            parser.error("--output is required with --input")
        args.output.mkdir(parents=True, exist_ok=True)
        for path in sorted(args.input.iterdir()):
            if path.suffix.lower() not in (".webp", ".png", ".jpg", ".jpeg"):
                continue
            source = path.read_bytes()
            started = time.monotonic()
            result = process(session, source)
            (args.output / (path.stem + ".png")).write_bytes(result)
            row = {"name": path.stem, "seconds": time.monotonic() - started,
                   "source_sha256": hashlib.sha256(source).hexdigest(),
                   "output_sha256": hashlib.sha256(result).hexdigest(), "bytes": len(result)}
            metrics["images"].append(row)
            metrics["peak_rss_bytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
            metrics.update(cgroup_metrics())
            (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2))
            print(json.dumps(row), flush=True)
    else:
        run_job(session)


def run_job(session):
    base = os.environ["CUTOUT_API_URL"].rstrip("/")
    job = os.environ["CUTOUT_JOB_ID"]
    token = os.environ["CUTOUT_JOB_TOKEN"]
    # URLs and credentials come from the operator/job definition, never the source image.
    def request(path, data=None, method="GET", content_type="application/json"):
        req = urllib.request.Request(base + "/api/internal/cutouts/" + job + path,
                                     data=data, method=method,
                                     headers={"Authorization": "Bearer " + token, "Content-Type": content_type,
                                              "User-Agent": "HouseCharacterCutouts/1.0"})
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.read()
    phase = "claim"
    try:
        claim = json.loads(request("/claim", json.dumps({"recipe": RECIPE}).encode(), "POST"))
        if not claim["claimed"]:
            return
        phase = "source"
        source = request("/source")
        if hashlib.sha256(source).hexdigest() != claim["sourceHash"]:
            raise ValueError("Source digest mismatch")
        phase = "inference"
        started = time.monotonic()
        output = process(session, source)
        phase = "result"
        request("/result", output, "PUT", "image/png")
    except Exception as error:
        raise CutoutFailure(phase) from error
    print(json.dumps({"job": job, "recipe": RECIPE, "seconds": time.monotonic() - started,
                      "source_sha256": claim["sourceHash"], "output_sha256": hashlib.sha256(output).hexdigest(),
                      "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
                      **cgroup_metrics()}), flush=True)


class CutoutFailure(Exception):
    def __init__(self, phase):
        super().__init__("Cutout job failed")
        self.phase = phase


def failure_diagnostic(error):
    phase = error.phase if isinstance(error, CutoutFailure) else "startup"
    cause = error.__cause__ or error
    release = os.environ.get("GIT_SHA", "")
    job = os.environ.get("CUTOUT_JOB_ID", "")
    uuid = r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"
    frames = [f"workers/character-cutouts/worker.py:{frame.lineno}"
              for frame in traceback.extract_tb(cause.__traceback__)
              if frame.filename == __file__]
    result = {
        "component": "character-cutout-worker", "phase": phase, "recipe": RECIPE,
        "release": release if re.fullmatch(r"[a-f0-9]{40}", release) else "unknown",
        "code": "cutout_job_failed", "summary": "The cutout worker could not complete the job.",
        "frames": frames,
    }
    if not frames:
        result["no_frames_reason"] = "no_first_party_coordinates" if cause.__traceback__ else "stack_unavailable"
    if re.fullmatch(uuid, job):
        result["job_id"] = job
    if isinstance(cause, urllib.error.HTTPError):
        result.update(code="cutout_api_http", status=cause.code, summary="The cutout API returned an HTTP error.")
        request_id = cause.headers.get("X-House-Request-Id", "") if cause.headers else ""
        if isinstance(request_id, str) and re.fullmatch(uuid, request_id):
            result["request_id"] = request_id
    elif isinstance(cause, urllib.error.URLError):
        result.update(code="cutout_api_transport", summary="The cutout worker could not reach the API.")
    return result


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps(failure_diagnostic(error)), file=sys.stderr, flush=True)
        raise SystemExit(1) from None
