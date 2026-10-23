from __future__ import annotations

import argparse
import json
import urllib.request

from .corpus import SOURCE, combined_source_checksum, load_combined_corpus, load_corpus, source_checksum, validate_corpus
from .mining import build_index
from .server import serve


def main():
    parser = argparse.ArgumentParser(description="Jazz motif workbench")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("download", help="Download the official WJazzD SQLite database")
    check = sub.add_parser("validate", help="Validate the source corpus")
    check.add_argument("--all", action="store_true", help="Include a complete DTL1000 import")
    sub.add_parser("build", help="Build the candidate search index")
    sub.add_parser("evaluate", help="Report synthetic sensitivity and human review progress")
    videos = sub.add_parser("discover-videos", help="Find duration-matched YouTube recordings")
    videos.add_argument("--limit", type=int, default=50)
    jazz = sub.add_parser("sync-jazztube", help="Import JazzTube's published solo/video alignments")
    jazz.add_argument("--csv", type=str, help="Use a previously downloaded JazzTube CSV")
    warm = sub.add_parser("warm-covers", help="Fetch and cache covers for the top-ranked pairs")
    warm.add_argument("--pairs", type=int, default=500, help="How many top-ranked pairs to cover")
    web = sub.add_parser("serve", help="Start the local web app")
    web.add_argument("--host", default="127.0.0.1")
    web.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    if args.command == "download":
        SOURCE.parent.mkdir(parents=True, exist_ok=True)
        if SOURCE.exists():
            print(f"Already present: {SOURCE}")
        else:
            url = "https://jazzomat.hfm-weimar.de/download/downloads/wjazzd.db"
            urllib.request.urlretrieve(url, SOURCE)
            print(f"Downloaded {SOURCE} from {url}")
    elif args.command == "validate":
        corpus = load_combined_corpus(require_dtl=True) if args.all else load_corpus()
        print(json.dumps(validate_corpus(corpus, combined_source_checksum() if args.all else source_checksum()), indent=2))
    elif args.command == "build":
        print(json.dumps(build_index(), indent=2))
    elif args.command == "evaluate":
        from .evaluation import evaluate
        print(json.dumps(evaluate(), indent=2))
    elif args.command == "discover-videos":
        from .server import App
        from .videos import populate
        print(json.dumps(populate(App(), args.limit), indent=2))
    elif args.command == "sync-jazztube":
        from pathlib import Path
        from .corpus import STORE
        from .jazztube import sync
        print(json.dumps(sync(STORE, set(load_corpus()), Path(args.csv) if args.csv else None), indent=2))
    elif args.command == "warm-covers":
        from concurrent.futures import ThreadPoolExecutor
        from . import covers
        from .server import App
        app = App()
        top = sorted(app.rows, key=lambda r: -r["heuristic_score"])[:args.pairs]
        wanted = {(s.performer, s.album or s.title, s.title) for r in top
                  for s in (app.solos[r["a_melid"]], app.solos[r["b_melid"]])}
        with ThreadPoolExecutor(4) as pool:
            found = sum(1 for hit in pool.map(lambda w: covers.get(*w), sorted(wanted)) if hit)
        print(json.dumps({"covers_wanted": len(wanted), "covers_found": found}))
    elif args.command == "serve":
        serve(args.host, args.port)


if __name__ == "__main__":
    main()
