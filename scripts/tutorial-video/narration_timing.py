#!/usr/bin/env python3
"""
Narration timing sheet for the tutorial — derived only from edit.json.

For each active cue (GPS-gated cue excluded unless --include-gps):
  window   hard maximum take length: from the cue start to the next cue or the
           scene end, minus 0.1 s — the exact rule build_video.py enforces
           with --vo-dir (and audio_qa.py checks)
  words    spoken words (the brand name counts as its three words)
  natural  estimated spoken length at the voice brief's pace, 2.2–2.4 words/s,
           plus 0.25 s per internal comma/question pause
  headroom window − slow estimate; < 0.5 s is flagged TIGHT
  cps      caption reading speed while the caption is shown (characters incl.
           spaces ÷ display time); above --max-cps (default 17) is flagged

Outputs a Markdown table (stdout) and, with --csv <file>, a cue sheet for the
narrator / TTS operator (UTF-8 with BOM so Excel shows Hebrew correctly).

Usage: python3 scripts/tutorial-video/narration_timing.py [--include-gps] [--csv cue-sheet.csv] [--max-cps 17]
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EDIT = json.loads((REPO / 'docs/product/tutorial-video/edit.json').read_text(encoding='utf-8'))
SLOW, FAST, PAUSE = 2.2, 2.4, 0.25
MARGIN = 0.1  # build_video.make_narration: limit = min(next cue, scene end) − 0.1


def rows(include_gps: bool) -> list[dict]:
    t, offs, ends = 0.0, {}, {}
    for s in EDIT['scenes']:
        if s.get('gated') and not include_gps:
            continue
        offs[s['id']] = t - s['start']
        t += s['end'] - s['start']
        ends[s['id']] = t
    total = t
    cues = [(n, c) for n, c in enumerate(EDIT['cues'], 1) if c['scene'] in offs]
    out = []
    for i, (n, c) in enumerate(cues):
        start = c['start'] + offs[c['scene']]
        nxt = cues[i + 1][1]['start'] + offs[cues[i + 1][1]['scene']] if i + 1 < len(cues) else total
        window = min(nxt, ends[c['scene']]) - start - MARGIN
        text = c['text']
        words = len(text.split())
        pauses = len(re.findall(r'[,?](?!\s*$)', text))
        slow, fast = words / SLOW + PAUSE * pauses, words / FAST + PAUSE * pauses
        display = min(slow + 0.4, window + MARGIN)
        out.append({'n': n, 'file': f'cue-{n:02}', 'scene': c['scene'], 'start': start, 'window': window, 'words': words,
                    'fast': fast, 'slow': slow, 'headroom': window - slow, 'cps': len(text) / display, 'text': text,
                    'onScreen': c.get('onScreen', '')})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--include-gps', action='store_true')
    ap.add_argument('--csv')
    ap.add_argument('--max-cps', type=float, default=17.0)
    a = ap.parse_args()
    data = rows(a.include_gps)
    print('| File | Starts at | Max (hard) | Words | Natural length | Headroom | Caption cps | Flags |')
    print('| --- | --- | --- | --- | --- | --- | --- | --- |')
    for r in data:
        flags = []
        if r['headroom'] < 0:
            flags.append('**OVER**')
        elif r['headroom'] < 0.5:
            flags.append('TIGHT')
        if r['cps'] > a.max_cps:
            flags.append(f'cps>{a.max_cps:g}')
        print(f"| {r['file']} | {r['start']:.1f} s | {r['window']:.1f} s | {r['words']} | "
              f"{r['fast']:.1f}–{r['slow']:.1f} s | {r['headroom']:+.1f} s | {r['cps']:.1f} | {' '.join(flags) or 'ok'} |")
    tight = [r['file'] for r in data if r['headroom'] < 0.5]
    print(f"\n{len(data)} cues · total narration ≈ {sum(r['fast'] for r in data):.0f}–{sum(r['slow'] for r in data):.0f} s"
          f" · tight: {', '.join(tight) or 'none'}")
    if a.csv:
        with open(a.csv, 'w', encoding='utf-8-sig', newline='') as f:
            wr = csv.writer(f)
            wr.writerow(['file', 'text (read exactly)', 'max seconds (hard)', 'natural seconds', 'video timeline start', 'on screen'])
            for r in data:
                wr.writerow([f"{r['file']}.wav", r['text'], f"{r['window']:.1f}", f"{r['fast']:.1f}–{r['slow']:.1f}",
                             f"{r['start']:.1f}", r['onScreen']])
        print(f'cue sheet → {a.csv}')


if __name__ == '__main__':
    main()
