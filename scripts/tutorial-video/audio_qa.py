#!/usr/bin/env python3
"""
Audio QA for tutorial narration, run BEFORE build_video.py uses it.

Accepts either
  * a directory of per-cue files  cue-01.wav … cue-NN.wav  (1-based, edit.json order), or
  * one continuous take (a single .wav/.m4a/.mp3 file).

Technical checks (exit 1 on failure):
  * decodable audio, sample rate ≥ 44.1 kHz, mono or stereo
  * integrated loudness and true peak measured (EBU R128 via ffmpeg loudnorm);
    the build normalises to −16 LUFS / −1 dBTP, so here only clipping
    (true peak > −0.1 dBTP) and near-silence (< −40 LUFS) fail
  * per-cue files: each take fits its caption window plus the gap before the
    next cue (so lines never overlap); leading/trailing silence reported
  * continuous take: not longer than the edited timeline

What this script CANNOT judge: whether the voice is female, native Israeli
Hebrew, warm, or correctly pronounced. That is a mandatory human review by a
native Hebrew speaker (see PRODUCTION_PLAN.md §6) — the report says so.

Usage: python3 scripts/tutorial-video/audio_qa.py <vo-dir-or-file> [--include-gps]
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EDIT = json.loads((REPO / 'docs/product/tutorial-video/edit.json').read_text(encoding='utf-8'))
failures: list[str] = []


def check(ok: bool, label: str) -> None:
    print(('PASS ' if ok else 'FAIL ') + label)
    if not ok:
        failures.append(label)


def probe(path: Path) -> dict:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)],
                         capture_output=True, text=True)
    if out.returncode != 0:
        return {}
    return json.loads(out.stdout)


def loudness(path: Path) -> dict:
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af',
                          'loudnorm=I=-16:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', err, re.S)
    return json.loads(m.group(0)) if m else {}


def edge_silence(path: Path) -> tuple[float, float]:
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af',
                          'silencedetect=noise=-45dB:d=0.05', '-f', 'null', '-'], capture_output=True, text=True).stderr
    dur = float(probe(path).get('format', {}).get('duration', 0) or 0)
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', err)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', err)]
    head = ends[0] if starts and starts[0] < 0.01 and ends else 0.0
    tail = dur - starts[-1] if starts and (len(ends) < len(starts)) else 0.0
    return head, tail


def check_file(path: Path, label: str) -> float:
    info = probe(path)
    a = [s for s in info.get('streams', []) if s.get('codec_type') == 'audio']
    check(bool(a), f'{label}: decodable audio stream')
    if not a:
        return 0.0
    sr, ch = int(a[0].get('sample_rate', 0)), int(a[0].get('channels', 0))
    check(sr >= 44100, f'{label}: sample rate {sr} Hz ≥ 44.1 kHz')
    check(ch in (1, 2), f'{label}: {ch} channel(s)')
    dur = float(info['format']['duration'])
    ld = loudness(path)
    if ld:
        i, tp = float(ld['input_i']), float(ld['input_tp'])
        check(tp <= -0.1, f'{label}: true peak {tp:.1f} dBTP (no clipping)')
        check(i >= -40, f'{label}: integrated loudness {i:.1f} LUFS (not near-silent)')
    head, tail = edge_silence(path)
    print(f'INFO {label}: duration {dur:.2f}s, leading silence {head:.2f}s, trailing silence {tail:.2f}s')
    return dur


def timeline(include_gps: bool):
    t, spans = 0.0, {}
    for s in EDIT['scenes']:
        if s.get('gated') and not include_gps:
            continue
        d = s['end'] - s['start']
        spans[s['id']] = (t, t + d, t - s['start'])
        t += d
    return spans, t


def main() -> None:
    src = Path(sys.argv[1])
    include_gps = '--include-gps' in sys.argv
    spans, total = timeline(include_gps)
    cues = [(n, c) for n, c in enumerate(EDIT['cues'], 1) if c['scene'] in spans]
    if src.is_dir():
        for idx, (n, c) in enumerate(cues):
            f = next((p for ext in ('wav', 'm4a', 'mp3', 'flac') for p in [src / f'cue-{n:02}.{ext}'] if p.exists()), None)
            check(f is not None, f'cue-{n:02} present ({c["text"][:28]}…)')
            if not f:
                continue
            dur = check_file(f, f'cue-{n:02}')
            start = c['start'] + spans[c['scene']][2]
            nxt = cues[idx + 1][1]['start'] + spans[cues[idx + 1][1]['scene']][2] if idx + 1 < len(cues) else total
            room = min(nxt, spans[c['scene']][1]) - start - 0.15
            check(dur <= room, f'cue-{n:02}: {dur:.2f}s fits before next cue/scene end ({room:.2f}s available)')
    else:
        dur = check_file(src, src.name)
        check(dur <= total + 0.05, f'{src.name}: {dur:.2f}s ≤ timeline {total:.1f}s')
        print('INFO continuous take: caption cue times must be aligned to the take by ear '
              '(edit "cues" in edit.json) before building.')
    print('\nMANUAL (not automatable): native Israeli-Hebrew female voice · warmth · pronunciation of '
          '"Walkie Doggy Link", button labels and Hebrew construct forms — owner/native-speaker sign-off required.')
    print(f'{len(failures)} failure(s)')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
