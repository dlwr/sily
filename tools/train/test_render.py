import numpy as np
import soundfile as sf

import render

RATE = 44100


def fake_render(hits, silent_notes=()):
    length = int((hits[-1].time + render.SPACING) * RATE)
    audio = np.zeros((length, 2), dtype=np.float32)
    for hit in hits:
        if hit.note in silent_notes:
            continue
        start = int(hit.time * RATE)
        decay = np.exp(-np.arange(int(0.3 * RATE)) / (0.05 * RATE)) * hit.velocity / 127
        audio[start : start + len(decay), 0] = decay
        audio[start : start + len(decay), 1] = decay
    return audio


def test_midi_has_a_note_on_for_every_hit(tmp_path):
    hits = render.schedule([36, 38], [64, 127])
    path = tmp_path / "hits.mid"
    render.write_midi(hits, path)
    data = path.read_bytes()
    assert data.count(bytes([0x99, 36])) + data.count(bytes([0x99, 38])) == 4


def test_hits_are_spaced_evenly():
    hits = render.schedule([36, 38], [100])
    assert [h.time for h in hits] == [0.0, render.SPACING]


def test_split_files_gm_hits_by_label(tmp_path):
    hits = render.schedule([36, 42], [100])
    wav = tmp_path / "kit.wav"
    sf.write(wav, fake_render(hits), RATE, subtype="PCM_24")
    render.split(wav, hits, tmp_path / "out", "kit")
    assert sorted(p.parent.name for p in (tmp_path / "out").glob("*/*.wav")) == ["closed_hat", "kick"]


def test_split_skips_notes_the_kit_does_not_play(tmp_path):
    hits = render.schedule([36, 38], [100])
    wav = tmp_path / "kit.wav"
    sf.write(wav, fake_render(hits, silent_notes={38}), RATE, subtype="PCM_24")
    render.split(wav, hits, tmp_path / "out", "kit")
    assert [p.parent.name for p in (tmp_path / "out").glob("*/*.wav")] == ["kick"]


def test_split_trims_the_silent_tail(tmp_path):
    hits = render.schedule([36], [100])
    wav = tmp_path / "kit.wav"
    sf.write(wav, fake_render(hits), RATE, subtype="PCM_24")
    render.split(wav, hits, tmp_path / "out", "kit")
    clip, _ = sf.read(next((tmp_path / "out").glob("*/*.wav")))
    assert len(clip) < 0.5 * RATE


def test_sheet_packs_audible_hits_with_gaps(tmp_path):
    hits = render.schedule([36, 38, 42], [100])
    wav = tmp_path / "kit.wav"
    sf.write(wav, fake_render(hits, silent_notes={38}), RATE, subtype="PCM_24")
    count = render.sheet(wav, hits, tmp_path / "sheet.wav")
    sheet, _ = sf.read(tmp_path / "sheet.wav")
    assert count == 2
    assert len(sheet) < 2 * (0.5 + render.SHEET_GAP) * RATE
