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
from sklearn.ensemble import HistGradientBoostingClassifier
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
    width = len(xs[0]) if xs else 0
    kept = [(f, label) for f, label in zip(cx, cy) if len(f) == width]
    if len(kept) < len(cx):
        print(f"skipped {len(cx) - len(kept)} corrections recorded with older features")
    x = np.array(xs + [f for f, _ in kept], dtype=np.float64)
    y = np.array(ys + [label for _, label in kept])
    if len(set(y)) < 2:
        raise SystemExit("クラスが2つ以上必要")

    model = HistGradientBoostingClassifier(max_iter=100, max_leaf_nodes=15, learning_rate=0.1, class_weight="balanced", random_state=0)
    folds = min(5, min(np.unique(y, return_counts=True)[1]))
    if folds >= 2:
        predicted = cross_val_predict(model, x, y, cv=folds)
        print(classification_report(y, predicted, zero_division=0))
    model.fit(x, y)

    exported = export(model)
    agreement = (np.array(exported["classes"])[evaluate(exported, x).argmax(axis=1)] == model.predict(x)).mean()
    print(f"exported model agrees with scikit-learn on {agreement:.4f} of samples")
    if agreement < 0.999:
        raise SystemExit("書き出したモデルが scikit-learn と一致しない")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(exported, separators=(",", ":")))
    print(f"wrote {args.out} ({len(y)} samples, {len(model.classes_)} classes)")


def export(model: HistGradientBoostingClassifier) -> dict:
    trees = []
    for iteration in model._predictors:
        for k, predictor in enumerate(iteration):
            nodes = predictor.nodes
            trees.append(
                {
                    "class": k if len(model.classes_) > 2 else 1,
                    "feature": nodes["feature_idx"].tolist(),
                    "threshold": [float(t) for t in nodes["num_threshold"]],
                    "left": nodes["left"].tolist(),
                    "right": nodes["right"].tolist(),
                    "value": [round(float(v), 6) for v in nodes["value"]],
                    "leaf": nodes["is_leaf"].astype(bool).tolist(),
                }
            )
    baseline = np.ravel(model._baseline_prediction).tolist()
    if len(model.classes_) == 2:
        baseline = [0.0, baseline[0]]
    return {"kind": "trees", "classes": [str(c) for c in model.classes_], "baseline": baseline, "trees": trees}


def evaluate(exported: dict, x: np.ndarray) -> np.ndarray:
    logits = np.tile(np.array(exported["baseline"], dtype=np.float64), (len(x), 1))
    for tree in exported["trees"]:
        for i, row in enumerate(x):
            node = 0
            while not tree["leaf"][node]:
                node = tree["left"][node] if row[tree["feature"][node]] <= tree["threshold"][node] else tree["right"][node]
            logits[i, tree["class"]] += tree["value"][node]
    return logits


if __name__ == "__main__":
    main()
