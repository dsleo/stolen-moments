"""Validate the committed static catalog without source databases or network access."""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

from .corpus import ROOT


CATALOG = ROOT / "static" / "catalog"
ROW_WIDTH = 14


def read_json_gz(path: Path):
    try:
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, EOFError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Invalid gzip JSON: {path}") from exc


def validate(catalog: Path = CATALOG) -> dict:
    index_path = catalog / "index.json.gz"
    report_path = catalog / "report.json"
    if not index_path.is_file() or not report_path.is_file():
        raise ValueError("Catalog must contain index.json.gz and report.json")
    index = read_json_gz(index_path)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if index.get("version") != 1:
        raise ValueError(f"Unsupported catalog version: {index.get('version')!r}")
    rows, solos = index.get("rows"), index.get("solos")
    shard_size, floor = index.get("shard_size"), index.get("floor")
    if not isinstance(rows, list) or not isinstance(solos, dict):
        raise ValueError("Catalog index is missing rows or solo metadata")
    if not isinstance(shard_size, int) or shard_size < 1:
        raise ValueError("Catalog has an invalid detail shard size")
    if report.get("passages") != len(rows) or report.get("solos") != len(solos):
        raise ValueError("Catalog counts do not match report.json")
    if report.get("floor") != floor:
        raise ValueError("Catalog similarity floor does not match report.json")
    if report.get("index_bytes") != index_path.stat().st_size:
        raise ValueError("Catalog index size does not match report.json")

    notes: dict[str, list] = {}
    for mid, solo in solos.items():
        note_path = catalog / "notes" / f"{mid}.json.gz"
        note_rows = read_json_gz(note_path)
        if not isinstance(note_rows, list) or any(not isinstance(note, list) or len(note) != 7 for note in note_rows):
            raise ValueError(f"Invalid note records for solo {mid}")
        if solo.get("cover"):
            cover = ROOT / "static" / solo["cover"]
            if not cover.is_file():
                raise ValueError(f"Missing cover asset for solo {mid}: {solo['cover']}")
        notes[mid] = note_rows

    shard_count = (len(rows) + shard_size - 1) // shard_size
    details = []
    for shard_id in range(shard_count):
        path = catalog / "detail" / f"{shard_id:04d}.json.gz"
        shard = read_json_gz(path)
        expected = min(shard_size, len(rows) - shard_id * shard_size)
        if not isinstance(shard, list) or len(shard) != expected:
            raise ValueError(f"Detail shard {shard_id:04d} has {len(shard) if isinstance(shard, list) else 'invalid'} rows; expected {expected}")
        details.extend(shard)

    for row_id, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != ROW_WIDTH:
            raise ValueError(f"Passage row {row_id} has an invalid shape")
        a, b, a0, a1, b0, b1, paired, gaps, similarity, evidence, ta, tb, va, vb = row
        if str(a) not in solos or str(b) not in solos:
            raise ValueError(f"Passage row {row_id} references missing solo metadata")
        if not (0 <= a0 < a1 <= len(notes[str(a)]) and 0 <= b0 < b1 <= len(notes[str(b)])):
            raise ValueError(f"Passage row {row_id} has note bounds outside its source solos")
        if not isinstance(paired, int) or paired < 1 or not isinstance(gaps, int) or gaps < 0:
            raise ValueError(f"Passage row {row_id} has invalid pair or gap counts")
        if not isinstance(similarity, (int, float)) or not 0 <= similarity <= 1:
            raise ValueError(f"Passage row {row_id} has invalid similarity")
        if similarity + 1e-8 < floor:
            raise ValueError(f"Passage row {row_id} is below the exported similarity floor")
        if any(value is not None and (not isinstance(value, int) or value < 0) for value in (va, vb)):
            raise ValueError(f"Passage row {row_id} has an invalid recording timestamp")
        entry = details[row_id]
        if not isinstance(entry, list) or len(entry) != 2 or not isinstance(entry[1], list):
            raise ValueError(f"Passage detail {row_id} has an invalid alignment")
        alignment = entry[1]
        if sum(1 for ai, bi in alignment if ai >= 0 and bi >= 0) != paired:
            raise ValueError(f"Passage detail {row_id} paired-note count does not match its alignment")
        if sum(1 for ai, bi in alignment if (ai < 0) != (bi < 0)) != gaps:
            raise ValueError(f"Passage detail {row_id} gap count does not match its alignment")
        if any(ai >= len(notes[str(a)]) or bi >= len(notes[str(b)]) for ai, bi in alignment):
            raise ValueError(f"Passage detail {row_id} alignment points past the source notes")

    return {"passages": len(rows), "solos": len(solos), "detail_shards": shard_count,
            "index_bytes": index_path.stat().st_size, "similarity_floor": floor}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=CATALOG)
    args = parser.parse_args()
    try:
        report = validate(args.catalog)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
