# /// script
# requires-python = ">=3.10"
# ///
"""本番で直したラベルの音声を D1 / R2 から tmp/train/corrections/<ラベル>/ に取ってくる。

    uv run tools/train/pull.py
"""

import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp" / "train" / "corrections"
BUCKET = "sily-corrections"


def wrangler(*args: str) -> str:
    result = subprocess.run(["wrangler", *args], cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"wrangler {' '.join(args[:2])} failed:\n{result.stderr or result.stdout}")
    return result.stdout


def main() -> None:
    rows = json.loads(wrangler("d1", "execute", "sily", "--remote", "--json", "--command", "SELECT id, label FROM corrections"))[0]["results"]
    fetched = 0
    for row in rows:
        name = f"{row['id']}.wav"
        dest = OUT / row["label"] / name
        for stale in OUT.glob(f"*/{name}"):
            if stale != dest:
                stale.unlink()
        if dest.exists():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        wrangler("r2", "object", "get", f"{BUCKET}/corrections/{name}", "--remote", "--file", str(dest))
        fetched += 1
    print(f"{len(rows)} corrections, fetched {fetched}")


if __name__ == "__main__":
    main()
