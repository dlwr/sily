# /// script
# requires-python = ">=3.10"
# ///
"""本番で直したラベルの音声を D1 / R2 から tmp/train/corrections/<ラベル>/ に取ってくる。

評価用に取り分けた録音のもの（split が eval か、split を記録する前のもの）は tmp/train/eval/<ラベル>/ に入れる。

    uv run tools/train/pull.py
"""

import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
TRAIN = ROOT / "tmp" / "train" / "corrections"
EVAL = ROOT / "tmp" / "train" / "eval"
BUCKET = "sily-corrections"


def wrangler(*args: str) -> str:
    result = subprocess.run(["wrangler", *args], cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"wrangler {' '.join(args[:2])} failed:\n{result.stderr or result.stdout}")
    return result.stdout


def main() -> None:
    rows = json.loads(wrangler("d1", "execute", "sily", "--remote", "--json", "--command", "SELECT id, label, split FROM corrections"))[0]["results"]
    fetched = 0
    for row in rows:
        name = f"{row['id']}.wav"
        dest = (TRAIN if row["split"] == "train" else EVAL) / row["label"] / name
        for stale in [*TRAIN.glob(f"*/{name}"), *EVAL.glob(f"*/{name}")]:
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
