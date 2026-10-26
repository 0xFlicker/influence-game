"""Pinned CPU BiRefNet recipe; local files and HTTP jobs share identical inference."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import resource
import time
import urllib.request

RECIPE = "birefnet-general-58f621f0-rembg2.0.86-r1"


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
               "cpu_max": Path("/sys/fs/cgroup/cpu.max").read_text().strip(),
               "memory_max": Path("/sys/fs/cgroup/memory.max").read_text().strip(), "images": []}
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
            metrics["cgroup_peak_bytes"] = int(Path("/sys/fs/cgroup/memory.peak").read_text())
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
                                     headers={"Authorization": "Bearer " + token, "Content-Type": content_type})
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.read()
    claim = json.loads(request("/claim", json.dumps({"recipe": RECIPE}).encode(), "POST"))
    if not claim["claimed"]:
        return
    source = request("/source")
    if hashlib.sha256(source).hexdigest() != claim["sourceHash"]:
        raise ValueError("Source digest mismatch")
    started = time.monotonic()
    output = process(session, source)
    request("/result", output, "PUT", "image/png")
    print(json.dumps({"job": job, "recipe": RECIPE, "seconds": time.monotonic() - started,
                      "source_sha256": claim["sourceHash"], "output_sha256": hashlib.sha256(output).hexdigest(),
                      "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
                      "cgroup_peak_bytes": int(Path("/sys/fs/cgroup/memory.peak").read_text())}), flush=True)


if __name__ == "__main__":
    main()
