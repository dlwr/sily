# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""Freesound から CC0 のワンショットをクラスごとに集める。

FREESOUND_API_KEY を環境変数か、リポジトリ直下の .env に置いて実行する。
    uv run tools/train/fetch.py --per-class 300
"""

import argparse
import concurrent.futures
import json
import os
import pathlib
import time

import requests

from classes import QUERIES

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp" / "train" / "freesound"
API = "https://freesound.org/apiv2/search/text/"
FILTER = 'license:"Creative Commons 0" duration:[0.05 TO 4]'


def api_key() -> str:
    key = os.environ.get("FREESOUND_API_KEY")
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("FREESOUND_API_KEY="):
                key = line.split("=", 1)[1].strip()
    if not key:
        raise SystemExit("FREESOUND_API_KEY が見つからない")
    return key


def search(key: str, query: str, page: int) -> dict:
    params = {
        "query": query,
        "filter": FILTER,
        "fields": "id,name,tags,previews,duration",
        "page_size": 150,
        "page": page,
        "token": key,
    }
    res = requests.get(API, params=params, timeout=30)
    res.raise_for_status()
    time.sleep(1.1)
    return res.json()


def download(url: str, path: pathlib.Path) -> bool:
    if path.exists():
        return True
    audio = requests.get(url, timeout=30)
    if audio.status_code != 200:
        return False
    path.write_bytes(audio.content)
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-class", type=int, default=300)
    parser.add_argument("--workers", type=int, default=16)
    args = parser.parse_args()
    key = api_key()
    seen: set[int] = set()
    manifest = []
    with concurrent.futures.ThreadPoolExecutor(args.workers) as pool:
        for label, queries in QUERIES.items():
            folder = OUT / label
            folder.mkdir(parents=True, exist_ok=True)
            picked = []
            for query in queries:
                page = 1
                while len(picked) < args.per_class:
                    data = search(key, query, page)
                    for sound in data["results"]:
                        if len(picked) < args.per_class and sound["id"] not in seen:
                            seen.add(sound["id"])
                            picked.append(sound)
                    if not data.get("next"):
                        break
                    page += 1
                if len(picked) >= args.per_class:
                    break
            paths = [folder / f"{s['id']}.mp3" for s in picked]
            ok = list(pool.map(download, [s["previews"]["preview-hq-mp3"] for s in picked], paths))
            for sound, path, fine in zip(picked, paths, ok):
                if fine:
                    manifest.append({"id": sound["id"], "label": label, "name": sound["name"], "path": str(path)})
            print(f"{label}: {sum(ok)}", flush=True)
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
