# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scikit-learn"]
# ///
"""CLAP の音声埋め込みに Rust の特徴量をつなげたものの上にロジスティック回帰を載せ、probe.json を書き出す。

埋め込みはブラウザと同じ transformers.js のモデルを Node で動かして取る（web/scripts/embed-audio.ts）。
    (cd web && pnpm install)
    uv run tools/train/probe.py tmp/train/freesound

tmp/train/corrections/ など実際の録音から切った音は、--real-weight 倍の重みで学習する。
tmp/train/eval/ の音は学習に使わずに精度を出す。--include-eval を付けると、精度を出したあと評価用も含めて学習し直して書き出す。
"""

import argparse
import json
import pathlib
import subprocess

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report

from train import AUDIO, EVAL_FOLDER, EXTRA_FOLDERS, ROOT, features, role

PROBE_OUT = ROOT / "web" / "src" / "classify" / "probe.json"


def embeddings(paths: list[pathlib.Path]) -> dict[str, list[float]]:
    result = subprocess.run(
        ["node", "scripts/embed-audio.ts"],
        cwd=ROOT / "web",
        input="\n".join(str(p.resolve()) for p in paths),
        capture_output=True,
        text=True,
        check=True,
    )
    rows = {}
    for line in result.stdout.splitlines():
        path, *values = line.split("\t")
        rows[path] = [float(v) for v in values]
    return rows


def load(roots: list[pathlib.Path]) -> tuple[np.ndarray, np.ndarray]:
    labelled = [(p.resolve(), role(p.parent.name)) for root in roots for p in root.glob("*/*") if p.suffix.lower() in AUDIO]
    paths = [p for p, _ in labelled]
    embedded, measured = embeddings(paths), features(paths)
    kept = [(embedded[str(p)] + measured[str(p)], label) for p, label in labelled if str(p) in embedded and str(p) in measured]
    return np.array([x for x, _ in kept], dtype=np.float64).reshape(len(kept), -1), np.array([y for _, y in kept])


def fit(x: np.ndarray, y: np.ndarray, c: float, weight: np.ndarray | None = None) -> tuple[LogisticRegression, np.ndarray, np.ndarray]:
    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    scale[scale == 0] = 1
    model = LogisticRegression(C=c, max_iter=2000, class_weight="balanced")
    model.fit((x - mean) / scale, y, sample_weight=weight)
    return model, mean, scale


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folders", nargs="+", type=pathlib.Path)
    parser.add_argument("--c", type=float, default=0.05)
    parser.add_argument("--real-weight", type=float, default=10.0)
    parser.add_argument("--include-eval", action="store_true")
    parser.add_argument("--out", type=pathlib.Path, default=PROBE_OUT)
    args = parser.parse_args()

    given = [f.resolve() for f in args.folders]
    xb, yb = load(args.folders)
    xr, yr = load([f for f in EXTRA_FOLDERS if f.exists() and f.resolve() not in given])
    x, y = np.concatenate([xb, xr]), np.concatenate([yb, yr])
    weight = np.concatenate([np.ones(len(yb)), np.full(len(yr), args.real_weight)])
    model, mean, scale = fit(x, y, args.c, weight)
    if EVAL_FOLDER.exists():
        ex, ey = load([EVAL_FOLDER])
        if len(ey):
            print(f"held-out recordings ({len(ey)} slices):")
            print(classification_report(ey, model.predict((ex - mean) / scale), zero_division=0))
            if args.include_eval:
                x, y = np.concatenate([x, ex]), np.concatenate([y, ey])
                weight = np.concatenate([weight, np.full(len(ey), args.real_weight)])
                model, mean, scale = fit(x, y, args.c, weight)

    exported = {
        "classes": [str(c) for c in model.classes_],
        "mean": [round(float(v), 6) for v in mean],
        "scale": [round(float(v), 6) for v in scale],
        "weights": [[round(float(w), 6) for w in row] for row in model.coef_],
        "bias": [round(float(b), 6) for b in model.intercept_],
    }
    args.out.write_text(json.dumps(exported, separators=(",", ":")))
    print(f"wrote {args.out} ({len(y)} samples, {len(model.classes_)} classes)")


if __name__ == "__main__":
    main()
