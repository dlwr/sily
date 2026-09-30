# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scikit-learn"]
# ///
"""音源フォルダ（クラス名のサブフォルダ）から分類器を学習し、model.json を書き出す。

特徴量は Rust の CLI（sily-tools の features）で計算するので、推論と同じ値になる。
    cargo build -p sily-tools --release
    uv run tools/train/train.py tmp/train/freesound
"""

import argparse
import json
import pathlib
import subprocess

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import cross_val_predict

ROOT = pathlib.Path(__file__).resolve().parents[2]
FEATURES_BIN = ROOT / "target" / "release" / "features"
MODEL_OUT = ROOT / "web" / "src" / "classify" / "model.json"
AUDIO = {".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff"}


def features(paths: list[pathlib.Path]) -> dict[str, list[float]]:
    result = subprocess.run(
        [str(FEATURES_BIN)],
        input="\n".join(str(p) for p in paths),
        capture_output=True,
        text=True,
        check=True,
    )
    rows = {}
    for line in result.stdout.splitlines():
        path, *values = line.split("\t")
        rows[path] = [float(v) for v in values]
    return rows


def load_folders(roots: list[pathlib.Path]) -> tuple[list[list[float]], list[str]]:
    labelled = [(p, p.parent.name) for root in roots for p in root.glob("*/*") if p.suffix.lower() in AUDIO]
    rows = features([p for p, _ in labelled])
    xs, ys = [], []
    for path, label in labelled:
        if str(path) in rows:
            xs.append(rows[str(path)])
            ys.append(label)
    return xs, ys


def load_corrections(files: list[pathlib.Path]) -> tuple[list[list[float]], list[str]]:
    xs, ys = [], []
    for f in files:
        for row in json.loads(f.read_text()):
            xs.append(row["features"])
            ys.append(row["label"])
    return xs, ys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folders", nargs="+", type=pathlib.Path)
    parser.add_argument("--corrections", nargs="*", type=pathlib.Path, default=[])
    parser.add_argument("--out", type=pathlib.Path, default=MODEL_OUT)
    args = parser.parse_args()

    xs, ys = load_folders(args.folders)
    cx, cy = load_corrections(args.corrections)
    x = np.array(xs + cx, dtype=np.float64)
    y = np.array(ys + cy)
    if len(set(y)) < 2:
        raise SystemExit("クラスが2つ以上必要")

    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    scale[scale == 0] = 1.0
    z = (x - mean) / scale

    model = LogisticRegression(max_iter=4000, C=1.0, class_weight="balanced")
    folds = min(5, min(np.unique(y, return_counts=True)[1]))
    if folds >= 2:
        predicted = cross_val_predict(model, z, y, cv=folds)
        print(classification_report(y, predicted, zero_division=0))
    model.fit(z, y)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(
            {
                "classes": list(model.classes_),
                "mean": mean.tolist(),
                "scale": scale.tolist(),
                "weights": model.coef_.tolist() if len(model.classes_) > 2 else [(-model.coef_[0]).tolist(), model.coef_[0].tolist()],
                "bias": model.intercept_.tolist() if len(model.classes_) > 2 else [-model.intercept_[0], model.intercept_[0]],
            }
        )
    )
    print(f"wrote {args.out} ({len(y)} samples, {len(model.classes_)} classes)")


if __name__ == "__main__":
    main()
