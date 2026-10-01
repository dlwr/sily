# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "soundfile"]
# ///
"""ドラム音源を1発ずつ鳴らす MIDI を作り、それを書き出した WAV を GM 配列のラベルで切り分ける。

    uv run tools/train/render.py midi tmp/render/hits.mid
    （DAW のテンポを 120 にして MIDI をドラム音源に鳴らし、小節1の頭から WAV に書き出す）
    uv run tools/train/render.py split tmp/render/acoustic-kit.wav

切った音は tmp/train/render/<ラベル>/ に入り、train.py が自動で読み込む。
GM 配列でないキットは render.py sheet で鳴った音だけを詰めた WAV を作り、sily に読み込んでラベル付けモードで付ける。
"""

import argparse
import pathlib
import struct
from typing import NamedTuple

import numpy as np
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "tmp" / "train" / "render"
BPM = 120
SPACING = 2.0
TICKS_PER_BEAT = 480
NOTE_SECONDS = 0.1
SILENCE_DB = -60
QUIET_DB = -45
SHEET_GAP = 0.5
SHEET_PEAK = 0.9

GM = {
    35: "kick", 36: "kick",
    37: "rim",
    38: "snare", 40: "snare",
    39: "clap",
    42: "closed_hat", 44: "closed_hat",
    46: "open_hat",
    41: "tom", 43: "tom", 45: "tom", 47: "tom", 48: "tom", 50: "tom",
    49: "cymbal", 51: "cymbal", 52: "cymbal", 53: "cymbal", 55: "cymbal", 57: "cymbal", 59: "cymbal",
    **{n: "perc" for n in [54, 56, 58, *range(60, 82)]},
}


class Hit(NamedTuple):
    time: float
    note: int
    velocity: int


def schedule(notes: list[int], velocities: list[int]) -> list[Hit]:
    pairs = [(n, v) for n in notes for v in velocities]
    return [Hit(i * SPACING, n, v) for i, (n, v) in enumerate(pairs)]


def vlq(value: int) -> bytes:
    out = [value & 0x7F]
    while value := value >> 7:
        out.append(0x80 | (value & 0x7F))
    return bytes(reversed(out))


def write_midi(hits: list[Hit], path: pathlib.Path) -> None:
    ticks = lambda seconds: round(seconds * BPM / 60 * TICKS_PER_BEAT)
    messages = sorted(
        [(ticks(h.time), bytes([0x99, h.note, h.velocity])) for h in hits]
        + [(ticks(h.time + NOTE_SECONDS), bytes([0x89, h.note, 0])) for h in hits],
        key=lambda m: m[0],
    )
    track = vlq(0) + b"\xff\x51\x03" + (60_000_000 // BPM).to_bytes(3, "big")
    now = 0
    for at, message in messages:
        track += vlq(at - now) + message
        now = at
    track += vlq(0) + b"\xff\x2f\x00"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"MThd" + struct.pack(">IHHH", 6, 0, 1, TICKS_PER_BEAT) + b"MTrk" + struct.pack(">I", len(track)) + track)


def clips(wav: pathlib.Path, hits: list[Hit]):
    audio, rate = sf.read(wav, always_2d=True, dtype="float32")
    level = np.abs(audio).max(axis=1)
    for hit in hits:
        start = int(hit.time * rate)
        segment = level[start : start + int(SPACING * rate)]
        if len(segment) == 0 or segment.max() < 10 ** (QUIET_DB / 20):
            continue
        loud = np.nonzero(segment > 10 ** (SILENCE_DB / 20))[0]
        yield hit, audio[start + loud[0] : start + loud[-1] + 1], rate


def split(wav: pathlib.Path, hits: list[Hit], out: pathlib.Path, kit: str) -> int:
    written = 0
    for hit, clip, rate in clips(wav, [h for h in hits if h.note in GM]):
        dest = out / GM[hit.note] / f"{kit}-{hit.note}-{hit.velocity}.wav"
        dest.parent.mkdir(parents=True, exist_ok=True)
        sf.write(dest, clip, rate, subtype="PCM_24")
        written += 1
    return written


def sheet(wav: pathlib.Path, hits: list[Hit], out: pathlib.Path) -> int:
    parts = []
    for _, clip, rate in clips(wav, hits):
        parts += [clip * (SHEET_PEAK / np.abs(clip).max()), np.zeros((int(SHEET_GAP * rate), clip.shape[1]), dtype=np.float32)]
    if parts:
        sf.write(out, np.concatenate(parts), rate, subtype="PCM_24")
    return len(parts) // 2


def note_range(text: str) -> list[int]:
    low, _, high = text.partition("-")
    return list(range(int(low), int(high or low) + 1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["midi", "split", "sheet"])
    parser.add_argument("path", type=pathlib.Path)
    parser.add_argument("--notes", type=note_range, default=note_range("35-81"))
    parser.add_argument("--velocities", type=lambda t: [int(v) for v in t.split(",")], default=[40, 80, 120])
    parser.add_argument("--kit", help="split の出力ファイル名に付ける名前（省略時は WAV のファイル名）")
    args = parser.parse_args()
    hits = schedule(args.notes, args.velocities)
    if args.command == "midi":
        write_midi(hits, args.path)
        print(f"wrote {args.path} ({len(hits)} hits, {hits[-1].time + SPACING:.0f} s at {BPM} BPM)")
    elif args.command == "split":
        written = split(args.path, hits, OUT, args.kit or args.path.stem)
        print(f"wrote {written} clips to {OUT}")
    else:
        out = args.path.with_name(f"{args.path.stem}-sheet.wav")
        print(f"wrote {out} ({sheet(args.path, hits, out)} hits)")


if __name__ == "__main__":
    main()
