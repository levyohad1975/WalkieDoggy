#!/usr/bin/env python3
"""
Self-test for the tutorial-video tooling (no network, no hosted data).

Everything runs on synthetic inputs in a temporary directory: ffmpeg test
patterns stand in for recordings and are labelled TEST PATTERN — they are
never app UI and are never written to captures/. Checks:

  timing     every active cue fits its window; audio_qa / build / timing sheet
             share one rule
  edit.json  capture scenes resolve; crops > 20 %, bad in/out are refused;
             uncut multi-segment scenes fall back to a rough preview
  assets     wordmark approval gate (no record / PENDING QA / hash mismatch)
             and music licence gate refuse non-draft use
  render     a two-segment capture scene with a status-bar crop and a tap
             ring renders at the scene length, crop removes the top band
  intake     check_captures.py fails landscape, flags re-compressed / mic
             audio, passes a clean portrait recording
  final      validate_video --final refuses a DRAFT build report

Usage: python3 scripts/tutorial-video/selftest.py
"""
from __future__ import annotations

import importlib.util
import io
import json
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True   # importing the sibling scripts must not leave __pycache__ in the repo
results: list[tuple[bool, str]] = []


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / f'{name}.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check(ok: bool, label: str) -> None:
    results.append((bool(ok), label))
    print(('PASS ' if ok else 'FAIL ') + label)


def refuses(fn, *a, contains: str = '', **kw) -> bool:
    try:
        with redirect_stdout(io.StringIO()):
            fn(*a, **kw)
    except SystemExit as e:
        return contains in str(e)
    return False


def ffmpeg(*args: str) -> None:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args], check=True)


def test_timing(bv, nt, aq) -> None:
    rows = nt.rows(False)
    check(len(rows) == 16, f'timing: 16 active cues without the GPS scene ({len(rows)})')
    check(all(r['headroom'] >= 0.5 for r in rows), 'timing: every cue has ≥ 0.5 s headroom at the slow pace')
    spans, total = aq.timeline(False)
    cues = [(n, c) for n, c in enumerate(aq.EDIT['cues'], 1) if c['scene'] in spans]
    same = True
    for i, (n, c) in enumerate(cues):
        start = c['start'] + spans[c['scene']][2]
        nxt = cues[i + 1][1]['start'] + spans[cues[i + 1][1]['scene']][2] if i + 1 < len(cues) else total
        room = min(nxt, spans[c['scene']][1]) - start - 0.1
        same &= abs(room - rows[i]['window']) < 1e-6
    check(same, 'timing: audio_qa windows equal the timing sheet (same 0.1 s rule as the build)')


def test_edit(bv, tmp: Path) -> None:
    edit = json.loads(bv.EDIT.read_text(encoding='utf-8'))
    caps = [s for s in edit['scenes'] if s['type'] == 'capture']
    ok = True
    for s in caps:
        with redirect_stdout(io.StringIO()):
            segs, missing = bv.capture_plan(dict(s), tmp)
        ok &= bool(segs) and len(missing) >= 1
    check(ok, 'edit.json: every capture scene resolves to segments (all missing in an empty folder → DRAFT slates)')
    s3 = next(dict(s) for s in caps if s['id'] == 'S3-members-schedule')
    with redirect_stdout(io.StringIO()):
        segs, _ = bv.capture_plan(s3, tmp)
    check([p['src'].name for p in segs] == ['C01-family-create-dog.mp4', 'C02b-home-next-walk.mp4'] and s3.get('_uncut'),
          'edit.json: uncut S3 falls back to a rough preview of C01 then C02b')
    bad_crop = {'id': 'X', 'capture': 'captures/x.mp4', 'captureEdit': {'segments': [{'src': 'x.mp4', 'in': 0, 'out': 2, 'cropTop': 0.3}]}}
    check(refuses(bv.capture_plan, bad_crop, tmp, contains='crops are limited'), 'edit.json: a 30 % crop is refused')
    bad_io = {'id': 'X', 'capture': 'captures/x.mp4', 'captureEdit': {'segments': [{'src': 'x.mp4', 'in': 3, 'out': 2}]}}
    check(refuses(bv.capture_plan, bad_io, tmp, contains='"out" > "in"'), 'edit.json: out ≤ in is refused')


def test_assets(bv, tmp: Path) -> None:
    src = bv.REPO / 'docs/product/tutorial-video/assets/walkie-doggy-link-wordmark-clean.DRAFT.png'
    wm = tmp / 'wm.DRAFT.png'
    wm.write_bytes(src.read_bytes())
    check(refuses(bv.wordmark_approval, wm, False, contains='approval record'), 'assets: DRAFT wordmark without a record is refused')
    with redirect_stdout(io.StringIO()):
        draft_ok = bv.wordmark_approval(wm, True).startswith('DRAFT')
    check(draft_ok, 'assets: DRAFT wordmark allowed in a --draft render')
    rec = json.loads((bv.REPO / 'docs/product/tutorial-video/assets/walkie-doggy-link-wordmark-clean.DRAFT.png.approval.json').read_text(encoding='utf-8'))
    Path(str(wm) + '.approval.json').write_text(json.dumps(rec), encoding='utf-8')
    check(refuses(bv.wordmark_approval, wm, False, contains='final visual QA is PENDING'),
          'assets: committed record (final visual QA PENDING) refuses a non-draft render')
    signed = dict(rec, finalVisualQA='Test Reviewer, 2026-10-17, approved')
    Path(str(wm) + '.approval.json').write_text(json.dumps(signed), encoding='utf-8')
    with redirect_stdout(io.StringIO()):
        signed_ok = 'approved' in bv.wordmark_approval(wm, False)
    check(signed_ok, 'assets: a signed record allows a non-draft render')
    Path(str(wm) + '.approval.json').write_text(json.dumps(dict(signed, fileSha256='0' * 64)), encoding='utf-8')
    check(refuses(bv.wordmark_approval, wm, True, contains='does not match'), 'assets: hash mismatch is refused even in --draft')
    music = tmp / 'bed.wav'
    ffmpeg('-f', 'lavfi', '-i', 'sine=f=440:d=1', str(music))
    lic = {'title': 't', 'source': 's', 'license': 'PENDING OWNER DECISION', 'rightsHolder': 'r', 'approvedBy': 'PENDING',
           'fileSha256': bv.sha256(music)}
    Path(str(music) + '.license.json').write_text(json.dumps(lic), encoding='utf-8')
    check(refuses(bv.music_license, music, False, contains='PENDING'), 'assets: PENDING music refused without --draft')


def test_narration(bv, tmp: Path) -> None:
    takes = tmp / 'takes'
    takes.mkdir()
    for n in (1, 2):
        ffmpeg('-f', 'lavfi', '-i', f'sine=f={300 + n * 50}:d=1.5', '-ar', '48000', str(takes / f'cue-{n:02}.wav'))
    check(refuses(bv.narration_approval, takes, [1, 2], False, contains='without an approval record'),
          'narration: takes without an approval record refuse a non-draft render')
    r = subprocess.run([sys.executable, str(HERE / 'audio_qa.py'), str(takes), '--write-approval-template'],
                       capture_output=True, text=True)
    rec_path = takes / 'narration.approval.json'
    # The QA run fails (cue-03 … missing in this fixture), so no template may be written.
    check(r.returncode == 1 and not rec_path.exists(), 'narration: approval template is not written while QA fails')
    rec = {'voiceArtist': 'PENDING', 'license': 'PENDING', 'ownerApproval': 'PENDING',
           'nativeSpeakerReview': {'decision': 'PENDING'},
           'takesSha256': {f'cue-{n:02}.wav': bv.sha256(takes / f'cue-{n:02}.wav') for n in (1, 2)}}
    rec_path.write_text(json.dumps(rec), encoding='utf-8')
    check(refuses(bv.narration_approval, takes, [1, 2], False, contains='approval incomplete'),
          'narration: PENDING review/licence/owner approval refuses a non-draft render')
    signed = dict(rec, voiceArtist='Test Artist', license='buyout (test)', ownerApproval='Owner (test)',
                  nativeSpeakerReview={'reviewer': 'Reviewer (test)', 'date': '2026-10-17', 'decision': 'approved'})
    rec_path.write_text(json.dumps(signed), encoding='utf-8')
    with redirect_stdout(io.StringIO()):
        ok = 'reviewed by' in bv.narration_approval(takes, [1, 2], False)['approval']
    check(ok, 'narration: a signed record with matching hashes allows a non-draft render')
    ffmpeg('-f', 'lavfi', '-i', 'sine=f=900:d=1.5', '-ar', '48000', str(takes / 'cue-02.wav'))
    check(refuses(bv.narration_approval, takes, [1, 2], True, contains='not the take recorded'),
          'narration: a replaced take no longer matches its sign-off (refused even in --draft)')


def make_pattern(path: Path, w: int, h: int, seconds: float, *, band: bool = True, audio: bool = False, crf: str = '20') -> None:
    """Synthetic stand-in recording. With band=True: flat grey + a pure-red top band (6 % of the height)."""
    vf = f"drawtext=text='TEST PATTERN':fontcolor=white:fontsize={w // 9}:x=(w-tw)/2:y=h/2"
    src = f'color=c=0x5a6470:s={w}x{h}:r=30:d={seconds}' if band else f'testsrc2=s={w}x{h}:r=30:d={seconds}'
    if band:
        vf = f"drawbox=x=0:y=0:w=iw:h=ih*0.06:color=red:t=fill,{vf}"
    a = ['-f', 'lavfi', '-i', f'sine=f=300:d={seconds}'] if audio else []
    ffmpeg('-f', 'lavfi', '-i', src, *a, '-vf', vf, '-c:v', 'libx264', '-crf', crf,
           '-pix_fmt', 'yuv420p', *(['-c:a', 'aac'] if audio else []), str(path))


def test_render(bv, tmp: Path) -> None:
    caps = tmp / 'caps'
    caps.mkdir()
    make_pattern(caps / 'A.mp4', 590, 1278, 4)
    make_pattern(caps / 'B.mp4', 590, 1278, 4)
    edit = json.loads(bv.EDIT.read_text(encoding='utf-8'))
    scene = {'id': 'T-render', 'type': 'capture', 'chapter': 'בדיקה', 'capture': 'captures/A.mp4',
             'captureEdit': {'segments': [{'src': 'A.mp4', 'in': 0.5, 'out': 2.5, 'cropTop': 0.06},
                                          {'src': 'B.mp4', 'in': 1.0, 'out': 3.0, 'cropTop': 0.06}],
                             'taps': [{'t': 1.0, 'x': 0.5, 'y': 0.6}]}}
    with redirect_stdout(io.StringIO()):
        segs, missing = bv.capture_plan(scene, caps)
    out = tmp / 'seg.mp4'
    bv.capture_segment(edit, scene, segs, 4.0, 1920, 1080, 30, out, tmp)
    check(abs(bv.duration(out) - 4.0) < 0.05, f'render: two segments fill the 4.0 s scene ({bv.duration(out):.2f}s)')
    frame = tmp / 'f.png'
    ffmpeg('-ss', '2.0', '-i', str(out), '-frames:v', '1', str(frame))
    im = Image.open(frame).convert('RGB')
    px = im.load()   # every row (a 1-px sliver must be caught), every 2nd column
    red = sum(1 for y in range(im.height) for x in range(0, im.width, 2)
              if px[x, y][0] > 180 and px[x, y][1] < 90 and px[x, y][2] < 90)
    check(red == 0, f'render: cropTop removed the 6 % top band (red samples left: {red})')
    ffmpeg('-ss', '1.2', '-i', str(out), '-frames:v', '1', str(tmp / 'tap.png'))
    ffmpeg('-ss', '3.0', '-i', str(out), '-frames:v', '1', str(tmp / 'notap.png'))
    a, b = Image.open(tmp / 'tap.png').convert('RGB'), Image.open(tmp / 'notap.png').convert('RGB')
    teal = lambda im: sum(1 for x in range(0, im.width, 3) for y in range(0, im.height, 3)
                          if (lambda p: abs(p[0] - 32) < 30 and abs(p[1] - 167) < 30 and abs(p[2] - 181) < 30)(im.getpixel((x, y))))
    check(teal(a) > teal(b) + 20, f'render: tap ring visible only during its 0.6 s ({teal(a)} vs {teal(b)} ring samples)')


def test_intake(tmp: Path) -> None:
    caps = tmp / 'intake'
    caps.mkdir()
    make_pattern(caps / 'C06-swap-time-change.mp4', 1179, 2556, 3, band=False)
    make_pattern(caps / 'C07-schedule-history-stats-admin.mp4', 1280, 720, 3, band=False)
    make_pattern(caps / 'C03-dashboard-start-walk.mp4', 1179, 2556, 3, band=False, audio=True, crf='51')
    r = subprocess.run([sys.executable, str(HERE / 'check_captures.py'), str(caps), '--out', str(tmp / 'sheets')],
                       capture_output=True, text=True)
    out = r.stdout
    check(r.returncode == 1 and 'FAIL C07-schedule-history-stats-admin.mp4: landscape' in out, 'intake: landscape recording fails')
    check('re-compressed' in out and 'microphone was on' in out, 'intake: low bitrate and mic audio are flagged')
    check('FAIL C06' not in out and (tmp / 'sheets/C06-swap-time-change.contact.jpg').exists(),
          'intake: clean portrait recording passes and gets a contact sheet')


def test_final(vv, tmp: Path) -> None:
    rep = {'editSha256': 'x', 'draft': True, 'renders': {'16x9': {'scenes': [{'id': 'S2-family', 'kind': 'DRAFT slate'}],
                                                                  'captures': {'S3-members-schedule': {'uncut': True}}}},
           'narration': None, 'music': {'license': 'PENDING', 'approvedBy': 'PENDING'}, 'wordmark': {'approval': 'DRAFT'}}
    (tmp / 'build_report.json').write_text(json.dumps(rep), encoding='utf-8')
    vv.failures.clear()
    with redirect_stdout(io.StringIO()):
        vv.check_report(tmp, True)
    check(len(vv.failures) == 8, f'final: DRAFT report fails all 8 final gates ({len(vv.failures)})')
    vv.failures.clear()


def main() -> None:
    bv, nt, aq, vv = load('build_video'), load('narration_timing'), load('audio_qa'), load('validate_video')
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        test_timing(bv, nt, aq)
        test_edit(bv, tmp)
        test_assets(bv, tmp)
        test_narration(bv, tmp)
        test_render(bv, tmp)
        test_intake(tmp)
        test_final(vv, tmp)
    bad = [label for ok, label in results if not ok]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
