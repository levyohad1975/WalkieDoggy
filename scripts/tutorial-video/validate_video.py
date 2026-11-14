#!/usr/bin/env python3
"""
Technical validation for a tutorial build directory produced by build_video.py.

Checks (exit 1 on any failure):
  * MP4: H.264 High, yuv420p, 30 fps, expected size; AAC 48 kHz audio present;
    moov atom before mdat (+faststart → progressive playback on iOS/Android).
  * Master: a Hebrew (heb) mov_text subtitle stream is present.
  * Captions: every cue sits inside its own scene on the edited timeline,
    cues do not overlap, ≤ 2 lines × 42 chars, every line RTL-embedded.
  * Duration of every MP4 matches the edited timeline (±0.2 s).
  * Audio: reports whether the track is silent (animatic) or carries narration.
  * build_report.json: matches the current edit.json; with --final it must show
    no --draft render, no DRAFT slate, every capture scene cut (in/out set),
    narration and music present, and every asset approval signed (no PENDING).

Usage: python3 scripts/tutorial-video/validate_video.py <build-dir> [--include-gps] [--final]
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EDIT = json.loads((REPO / 'docs/product/tutorial-video/edit.json').read_text(encoding='utf-8'))
RLE, PDF = '\u202b', '\u202c'
failures: list[str] = []


def check(ok: bool, label: str) -> None:
    print(('PASS ' if ok else 'FAIL ') + label)
    if not ok:
        failures.append(label)


def probe(path: Path) -> dict:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def moov_first(path: Path) -> bool:
    data = path.read_bytes()[:4_000_000]
    moov, mdat = data.find(b'moov'), data.find(b'mdat')
    return moov != -1 and (mdat == -1 or moov < mdat)


def timeline(include_gps: bool) -> tuple[dict, float]:
    t, spans = 0.0, {}
    for s in EDIT['scenes']:
        if s.get('gated') and not include_gps:
            continue
        d = s['end'] - s['start']
        spans[s['id']] = (t, t + d, t - s['start'])
        t += d
    return spans, t


def parse_vtt(path: Path) -> list[tuple[float, float, list[str]]]:
    def sec(v: str) -> float:
        h, m, s = v.split(':')
        return int(h) * 3600 + int(m) * 60 + float(s)
    cues, lines = [], path.read_text(encoding='utf-8').splitlines()
    i = 0
    while i < len(lines):
        m = re.match(r'(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})', lines[i])
        if m:
            text, i = [], i + 1
            while i < len(lines) and lines[i].strip():
                text.append(lines[i]); i += 1
            cues.append((sec(m.group(1)), sec(m.group(2)), text))
        i += 1
    return cues


def check_report(out: Path, final: bool) -> None:
    path = out / 'build_report.json'
    if not path.exists():
        check(not final, 'build_report.json present' + ('' if final else ' (older build — skipped)'))
        return
    rep = json.loads(path.read_text(encoding='utf-8'))
    edit_sha = hashlib.sha256((REPO / 'docs/product/tutorial-video/edit.json').read_bytes()).hexdigest()
    check(rep.get('editSha256') == edit_sha, 'build_report: rendered from the current edit.json')
    kinds = {sc['id']: sc['kind'] for r in rep.get('renders', {}).values() for sc in r['scenes']}
    slates = sorted(k for k, v in kinds.items() if v == 'DRAFT slate')
    uncut = sorted(k for r in rep.get('renders', {}).values() for k, c in r.get('captures', {}).items() if c.get('uncut'))
    print(f"INFO build_report: draft={rep.get('draft')} slates={slates or 'none'} uncut={uncut or 'none'} "
          f"narration={'yes' if rep.get('narration') else 'no'} music={'yes' if rep.get('music') else 'no'}")
    if not final:
        return
    check(rep.get('draft') is False, 'final: rendered without --draft')
    check(not slates, f'final: no DRAFT slates ({", ".join(slates) or "none"})')
    check(not uncut, f'final: every capture scene cut with in/out points ({", ".join(uncut) or "all cut"})')
    check(bool(rep.get('narration')), 'final: narration present')
    check(bool(rep.get('narration')) and not any(x in str((rep.get('narration') or {}).get('approval')) for x in ('PENDING', 'DRAFT')),
          'final: narration licensed, native-speaker reviewed and owner-approved')
    music = rep.get('music') or {}
    check(bool(music) and 'PENDING' not in str(music.get('license')) + str(music.get('approvedBy')),
          'final: music licensed and approved')
    check('PENDING' not in str((rep.get('wordmark') or {}).get('approval')) and 'DRAFT' not in str((rep.get('wordmark') or {}).get('approval')),
          'final: wordmark approved incl. final visual QA')


def main() -> None:
    out = Path(sys.argv[1])
    include_gps = '--include-gps' in sys.argv
    spans, total = timeline(include_gps)
    print(f'timeline {total:.1f}s ({"with" if include_gps else "without"} GPS scene)')

    for name, size, master in (('tutorial_16x9.mp4', (1920, 1080), True),
                               ('tutorial_16x9_review.mp4', (1920, 1080), False),
                               ('tutorial_9x16.mp4', (1080, 1920), False)):
        path = out / name
        if not path.exists():
            if name == 'tutorial_9x16.mp4':
                print(f'SKIP {name}: not built (optional vertical cut, --vertical)')
            else:
                check(False, f'{name}: present')
            continue
        info = probe(path)
        v = next(s for s in info['streams'] if s['codec_type'] == 'video')
        a = [s for s in info['streams'] if s['codec_type'] == 'audio']
        subs = [s for s in info['streams'] if s['codec_type'] == 'subtitle']
        check(v['codec_name'] == 'h264' and v.get('profile') == 'High', f'{name}: H.264 High ({v.get("profile")})')
        check(v['pix_fmt'] == 'yuv420p', f'{name}: yuv420p')
        check((v['width'], v['height']) == size, f'{name}: {v["width"]}x{v["height"]}')
        check(v['r_frame_rate'] in ('30/1',), f'{name}: 30 fps ({v["r_frame_rate"]})')
        check(len(a) == 1 and a[0]['codec_name'] == 'aac' and a[0]['sample_rate'] == '48000', f'{name}: AAC 48 kHz audio')
        check(moov_first(path), f'{name}: faststart (moov before mdat)')
        dur = float(info['format']['duration'])
        check(abs(dur - total) <= 0.2, f'{name}: duration {dur:.2f}s ≈ {total:.1f}s')
        if master:
            check(any(s['codec_name'] == 'mov_text' and s.get('tags', {}).get('language') == 'heb' for s in subs),
                  f'{name}: soft Hebrew subtitle track')
        vol = subprocess.run(['ffmpeg', '-v', 'info', '-i', str(path), '-map', '0:a', '-af', 'volumedetect', '-f', 'null', '-'],
                             capture_output=True, text=True).stderr
        m = re.search(r'max_volume: (-?[\d.inf]+) dB', vol)
        print(f'INFO {name}: audio max_volume {m.group(1) if m else "?"} dB '
              f'({"silent — animatic, no audio yet" if m and m.group(1) in ("-inf", "-91.0") else "audio present (narration and/or music)"})')

    vtt = out / 'tutorial.he.vtt'
    cues = parse_vtt(vtt)
    expected = [c for c in EDIT['cues'] if c['scene'] in spans]
    check(len(cues) == len(expected), f'captions: {len(cues)} cues (expected {len(expected)})')
    prev_end = 0.0
    for (start, end, lines), c in zip(cues, expected):
        a, z, off = spans[c['scene']]
        tag = f'cue {start:6.2f}-{end:6.2f} [{c["scene"]}]'
        ok_time = a <= start < end <= z and abs(start - (c['start'] + off)) < 0.01 and start >= prev_end
        ok_lines = 1 <= len(lines) <= 2 and all(l.startswith(RLE) and l.endswith(PDF) and len(l) - 2 <= 42 for l in lines)
        joined = ' '.join(l.strip(RLE + PDF) for l in lines)
        ok_text = joined == c['text']
        check(ok_time and ok_lines and ok_text, f'{tag} inside scene, no overlap, ≤2×42, RTL-embedded, text exact')
        prev_end = end
    if not include_gps:
        check(all('GPS' not in ' '.join(t) and 'מעקב המיקום' not in ' '.join(t) for _, _, t in cues),
              'gated GPS narration absent from captions')

    check_report(out, '--final' in sys.argv)

    print(f'\n{len(failures)} failure(s)')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
