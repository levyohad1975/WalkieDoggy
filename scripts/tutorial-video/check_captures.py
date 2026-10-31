#!/usr/bin/env python3
"""
Intake check for genuine iPhone screen recordings, run BEFORE build_video.py.

For every recording that edit.json expects (scene "capture" + captureEdit
segments) this reports present / missing, then probes each present file:

  FAIL (exit 1)  undecodable · landscape · width < 720 px · shorter than 2 s
  WARN           not ~19.5:9 (the phone frame pads it) · HDR transfer ·
                 audio with sound (mic was on — the build drops audio, but
                 listen for voices/private info) · bitrate so low it was
                 probably re-compressed by a messaging app · variable or
                 < 24 fps · unexpected file names in the folder
  INFO           codec, size, fps, duration vs. the scene(s) using it, and a
                 suggested cropTop for the iOS status bar

It also writes a contact sheet per recording (<out>/<name>.contact.jpg, nine
frames) so a person can check the stop conditions in CAPTURE_CHECKLIST.md
(real names, codes, PIN pad, admin console, error banners) before editing.
Nothing here can judge content — the contact sheet is for human review.

Usage: python3 scripts/tutorial-video/check_captures.py [captures-dir] [--out <dir>] [--include-gps]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
EDIT = json.loads((REPO / 'docs/product/tutorial-video/edit.json').read_text(encoding='utf-8'))
VIDEO_EXT = {'.mp4', '.mov', '.m4v'}
failures: list[str] = []


def say(kind: str, msg: str) -> None:
    print(f'{kind:<4} {msg}')
    if kind == 'FAIL':
        failures.append(msg)


def expected_files(include_gps: bool) -> dict[str, list[str]]:
    """file name → scene ids that use it."""
    want: dict[str, list[str]] = {}
    for s in EDIT['scenes']:
        if s.get('type') != 'capture' or (s.get('gated') and not include_gps):
            continue
        names = [Path(s['capture']).name] + [Path(seg['src']).name for seg in (s.get('captureEdit') or {}).get('segments', []) if seg.get('src')]
        for n in dict.fromkeys(names):
            want.setdefault(n, []).append(s['id'])
    return want


def probe(path: Path) -> dict:
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)],
                       capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else {}


def fps(v: dict) -> tuple[float, float]:
    def frac(x: str) -> float:
        a, _, b = x.partition('/')
        return float(a) / float(b) if b and float(b) else 0.0
    return frac(v.get('avg_frame_rate', '0/1')), frac(v.get('r_frame_rate', '0/1'))


def max_volume(path: Path) -> float | None:
    err = subprocess.run(['ffmpeg', '-v', 'info', '-i', str(path), '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    m = re.search(r'max_volume: (-?[\d.]+|-inf) dB', err)
    return None if not m else (-120.0 if m.group(1) == '-inf' else float(m.group(1)))


def contact_sheet(path: Path, dur: float, out: Path) -> Path:
    thumbs = []
    for i in range(9):
        t = dur * (0.05 + 0.9 * i / 8)
        frame = out / f'.{path.stem}_{i}.png'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{t:.2f}', '-i', str(path), '-frames:v', '1',
                        '-vf', 'scale=-2:640', str(frame)], check=True)
        thumbs.append((t, Image.open(frame).convert('RGB')))
        frame.unlink()
    tw, th = thumbs[0][1].size
    sheet = Image.new('RGB', (tw * 9 + 80, th + 60), (251, 248, 243))
    d = ImageDraw.Draw(sheet)
    for i, (t, im) in enumerate(thumbs):
        x = 10 + i * (tw + 7)
        sheet.paste(im, (x, 10))
        d.text((x + 4, th + 18), f'{t:5.1f}s', fill=(46, 42, 36))
    d.text((10, th + 38), f'{path.name} — check: no real names, codes, PIN pad, admin console, error banners', fill=(139, 129, 113))
    dst = out / f'{path.stem}.contact.jpg'
    sheet.save(dst, quality=88)
    return dst


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('captures', nargs='?', default=str(REPO / 'docs/product/tutorial-video/captures'))
    ap.add_argument('--out', help='where contact sheets go (default: <captures>/intake)')
    ap.add_argument('--include-gps', action='store_true')
    a = ap.parse_args()
    cap_dir = Path(a.captures)
    out = Path(a.out) if a.out else cap_dir / 'intake'
    include_gps = a.include_gps
    want = expected_files(include_gps)
    scene_len = {s['id']: s['end'] - s['start'] for s in EDIT['scenes']}
    out.mkdir(parents=True, exist_ok=True)
    present = {p.name: p for p in cap_dir.glob('*') if p.suffix.lower() in VIDEO_EXT} if cap_dir.exists() else {}

    print(f'captures: {cap_dir}')
    for name, scenes in want.items():
        say('INFO' if name in present else 'MISS', f'{name} → {", ".join(scenes)}' + ('' if name in present else ' (scene stays a DRAFT slate)'))
    for extra in sorted(set(present) - set(want)):
        say('WARN', f'{extra}: not referenced by edit.json — misnamed? (expected one of: {", ".join(want)})')

    for name in [n for n in want if n in present]:
        path = present[name]
        info = probe(path)
        vs = [s for s in info.get('streams', []) if s.get('codec_type') == 'video']
        if not vs:
            say('FAIL', f'{name}: no decodable video stream')
            continue
        v = vs[0]
        w, h = int(v.get('width', 0)), int(v.get('height', 0))
        rot = next((int(sd.get('rotation', 0)) for sd in v.get('side_data_list', []) if 'rotation' in sd), 0)
        if abs(rot) in (90, 270):
            w, h = h, w
        dur = float(info.get('format', {}).get('duration', 0) or 0)
        avg, real = fps(v)
        say('INFO', f'{name}: {v.get("codec_name")} {w}x{h}, {avg:.1f} fps avg, {dur:.1f}s, '
                    f'{int(info["format"].get("bit_rate", 0)) // 1000} kb/s')
        if h <= w:
            say('FAIL', f'{name}: landscape {w}x{h} — record the iPhone in portrait')
            continue
        if w < 720:
            say('FAIL', f'{name}: width {w}px < 720 — send the original recording, not a preview/export')
        if dur < 2:
            say('FAIL', f'{name}: only {dur:.1f}s long')
        ratio = h / w
        if not 2.0 <= ratio <= 2.25:
            say('WARN', f'{name}: aspect {ratio:.2f}:1 (iPhone Face ID models ≈ 2.16) — the phone frame will pad it')
        if v.get('color_transfer') in ('smpte2084', 'arib-std-b67'):
            say('WARN', f'{name}: HDR transfer {v["color_transfer"]} — colours may shift; re-record with HDR off if they look wrong')
        if avg and avg < 24:
            say('WARN', f'{name}: {avg:.1f} fps average — motion may stutter')
        bpp = int(info['format'].get('bit_rate', 0) or 0) / max(w * h * max(avg, 1), 1)
        if bpp and bpp < 0.02:
            say('WARN', f'{name}: {bpp:.3f} bits/pixel/frame — looks re-compressed (messaging app?); send the original via AirDrop/Files')
        if any(s.get('codec_type') == 'audio' for s in info.get('streams', [])):
            mv = max_volume(path)
            if mv is not None and mv > -50:
                say('WARN', f'{name}: audio track has sound (max {mv:.0f} dB) — microphone was on? The build discards it; '
                            'check nothing private was said')
        used = [scene_len[s] for s in want[name]]
        say('INFO', f'{name}: used by {len(used)} scene(s) totalling {sum(used):.0f}s; in/out points are set in edit.json captureEdit')
        if 2.0 <= ratio <= 2.25:
            say('INFO', f'{name}: suggested cropTop ≈ 0.065 (iOS status bar) — confirm on the contact sheet')
        sheet = contact_sheet(path, dur, out)
        say('INFO', f'{name}: contact sheet → {sheet}')

    print(f'\n{len(failures)} failure(s) · MANUAL: review every contact sheet against the stop conditions before editing.')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
