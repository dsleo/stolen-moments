"""Check every YouTube ID used by the static catalog without downloading media."""
from __future__ import annotations

import gzip
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .corpus import ROOT


CATALOG = ROOT / "static" / "catalog" / "index.json.gz"
OUTPUT = ROOT / "data" / "joint-video-audit.json"


def inspect_video(video_id: str) -> dict:
    try:
        run = subprocess.run(["yt-dlp", "--skip-download", "--dump-single-json", "--no-warnings",
                              "--socket-timeout", "12", "--retries", "1",
                              f"https://www.youtube.com/watch?v={video_id}"],
                             capture_output=True, text=True, timeout=45)
        if run.returncode:
            return {"id": video_id, "status": "unavailable", "error": run.stderr[-300:]}
        value = json.loads(run.stdout)
        return {"id": video_id, "status": "available", "title": value.get("title"),
                "duration": value.get("duration"), "channel": value.get("channel"),
                "availability": value.get("availability")}
    except (subprocess.TimeoutExpired, ValueError) as exc:
        return {"id": video_id, "status": "unknown", "error": str(exc)[-300:]}


def audit(catalog: Path = CATALOG, output: Path = OUTPUT) -> dict:
    data = json.loads(gzip.decompress(catalog.read_bytes()))
    solos = data["solos"]
    videos = {s["video_id"] for s in solos.values() if s.get("video_id")}
    checked = {}
    if output.exists():
        old = json.loads(output.read_text())
        checked = {v["id"]: v for v in old.get("videos", []) if v["id"] in videos and v["status"] == "available"}
    pending = sorted(videos - checked.keys())
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {pool.submit(inspect_video, vid): vid for vid in pending}
        for future in as_completed(jobs):
            result = future.result()
            checked[result["id"]] = result
            if len(checked) % 25 == 0:
                print(f"Checked {len(checked)}/{len(videos)} videos", flush=True)
    report = {"videos": [checked[vid] for vid in sorted(videos)]}
    max_second = {}
    for row in data["rows"]:
        for mid, second in ((row[0], row[12]), (row[1], row[13])):
            if second is not None:
                vid = solos[str(mid)].get("video_id")
                if vid:max_second[vid] = max(max_second.get(vid, 0), second)
    report["beyond_duration"] = [{"id": vid, "max_passage_second": second,
                                   "video_duration": checked[vid].get("duration")}
                                  for vid, second in max_second.items()
                                  if checked[vid]["status"] == "available"
                                  and checked[vid].get("duration") is not None
                                  and second >= checked[vid]["duration"]]
    report["status_counts"] = {status: sum(v["status"] == status for v in checked.values())
                               for status in ("available", "unavailable", "unknown")}
    output.write_text(json.dumps(report, indent=2) + "\n")
    return {"videos": len(videos), "status_counts": report["status_counts"],
            "beyond_duration": len(report["beyond_duration"]), "output": str(output)}


if __name__ == "__main__":
    print(json.dumps(audit(), indent=2))
