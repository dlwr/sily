# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""Freesound から CC0 のワンショットをクラスごとに集める。

FREESOUND_API_KEY を環境変数か、リポジトリ直下の .env に置いて実行する。
    uv run tools/train/fetch.py --per-class 300
"""

import argparse
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-class", type=int, default=300)
    args = parser.parse_args()
    key = api_key()
    seen: set[int] = set()
    manifest = []
    for label, queries in QUERIES.items():
        folder = OUT / label
        folder.mkdir(parents=True, exist_ok=True)
        count = 0
        for query in queries:
            page = 1
            while count < args.per_class:
                data = search(key, query, page)
                for sound in data["results"]:
                    if count >= args.per_class or sound["id"] in seen:
                        continue
                    seen.add(sound["id"])
                    path = folder / f"{sound['id']}.mp3"
                    if not path.exists():
                        audio = requests.get(sound["previews"]["preview-hq-mp3"], timeout=30)
                        if audio.status_code != 200:
                            continue
                        path.write_bytes(audio.content)
                    manifest.append({"id": sound["id"], "label": label, "name": sound["name"], "path": str(path)})
                    count += 1
                if not data.get("next"):
                    break
                page += 1
            if count >= args.per_class:
                break
        print(f"{label}: {count}")
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
