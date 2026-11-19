#!/usr/bin/env python3
"""
Walkie Doggy Link — tutorial video build (editable source project).

Reads docs/product/tutorial-video/edit.json and produces:
  captions:  tutorial.he.vtt / tutorial.he.srt / tutorial.he.ass
  video:     tutorial_16x9.mp4            (master: soft Hebrew subtitle track, no burn-in)
             tutorial_16x9_review.mp4     (review copy with burned-in captions)
             tutorial_9x16.mp4            (optional vertical cut, --vertical)
  frames:    review/*.png                 (one still per scene, for visual QA)

Rules this script enforces (see docs/product/tutorial-video/PRODUCTION_PLAN.md):
  * Only real assets: the approved transparent mascot (SHA-256 checked) and the
    wordmark. Nothing is generated or redrawn.
  * Capture scenes use genuine Staging recordings from captures/. When a
    recording is missing the scene renders a clearly-labelled DRAFT slate —
    never a mock of app UI.
  * The GPS scene and its narration are gated: excluded unless --include-gps
    is passed after real-iPhone acceptance.
  * Narration comes from supplied takes (--vo-dir, per cue; or --vo, one
    DRAFT-only take). Without it the video is a timing animatic only.
  * Capture scenes may be cut from several recordings with edit.json
    "captureEdit" (real-time in/out points, status-bar/admin-row crop ≤ 20 %,
    tap highlight rings). No speed changes, no compositing of UI.
  * Approval gates (refused unless --draft): music licence record, wordmark
    approval record incl. final visual QA, narration approval record (take
    hashes, voice licence, native-speaker review, owner approval).
  * Writes build_report.json (hashes of every asset and recording, cuts,
    crops, approvals) — the input for validate_video.py --final.

Usage:
  python3 scripts/tutorial-video/build_video.py --out <dir> [--vo-dir takes/ | --vo narration.wav]
          [--captures <dir>] [--music bed.wav] [--wordmark png] [--include-gps] [--vertical] [--draft]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, features

REPO = Path(__file__).resolve().parents[2]
EDIT = REPO / 'docs/product/tutorial-video/edit.json'
FONT_REG = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
MAX_LINE = 42  # caption characters per line
FADE = 0.4
REPORT: dict = {'renders': {}}   # written to <out>/build_report.json (provenance + final-gate input)


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sh(*cmd: str) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr[-4000:])
        raise SystemExit(f'command failed: {cmd[0]} … (exit {proc.returncode})')


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size, layout_engine=ImageFont.Layout.RAQM)


def rtl_text(draw: ImageDraw.ImageDraw, xy, text: str, fnt, fill, anchor='ma') -> None:
    draw.text(xy, text, font=fnt, fill=fill, anchor=anchor, direction='rtl', language='he')


RLE, PDF = '\u202b', '\u202c'


def rtl_line(line: str) -> str:
    """Explicit right-to-left embedding per caption line. libass (and some SRT
    players) lay lines out with an LTR base direction, which reverses the order
    of mixed Hebrew/Latin runs and puts edge punctuation on the wrong side;
    RLE…PDF fixes both and is invisible. Verified visually: RLM alone is not
    enough for mixed lines such as "עם Walkie Doggy Link, …"."""
    return f'{RLE}{line}{PDF}'


def wrap(text: str, limit: int = MAX_LINE) -> list[str]:
    """Balanced wrap into at most two lines of <= limit characters."""
    if len(text) <= limit:
        return [text]
    words = text.split(' ')
    best: list[str] | None = None
    for i in range(1, len(words)):
        a, b = ' '.join(words[:i]), ' '.join(words[i:])
        if len(a) <= limit and len(b) <= limit:
            if best is None or abs(len(a) - len(b)) < abs(len(best[0]) - len(best[1])):
                best = [a, b]
    if best is None:
        raise SystemExit(f'caption too long for two lines of {limit}: {text}')
    return best


def wrap_free(text: str, limit: int) -> list[str]:
    """Greedy wrap with no line cap — for card text, never for captions."""
    lines: list[str] = []
    for word in text.split(' '):
        if lines and len(lines[-1]) + 1 + len(word) <= limit:
            lines[-1] += ' ' + word
        else:
            lines.append(word)
    return lines


def ts(seconds: float, sep: str) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f'{h:02}:{m:02}:{s:02}{sep}{ms:03}'


def write_captions(cues: list[dict], out: Path) -> None:
    vtt = ['WEBVTT', 'Language: he', '']
    srt: list[str] = []
    for n, cue in enumerate(cues, 1):
        lines = [rtl_line(l) for l in wrap(cue['text'])]
        vtt += [f"{ts(cue['start'], '.')} --> {ts(cue['end'], '.')} line:-2 align:center", *lines, '']
        srt += [str(n), f"{ts(cue['start'], ',')} --> {ts(cue['end'], ',')}", *lines, '']
    (out / 'tutorial.he.vtt').write_text('\n'.join(vtt), encoding='utf-8')
    (out / 'tutorial.he.srt').write_text('\n'.join(srt), encoding='utf-8')


def write_ass(cues: list[dict], out: Path, w: int, h: int, name: str) -> Path:
    size = round(h * 0.046) if w > h else round(w * 0.05)
    margin_v = round(h * 0.05)
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,DejaVu Sans,{size},&H00FFFFFF,&H00FFFFFF,&H00241F1B,&H99241F1B,1,0,0,0,100,100,0,0,3,14,0,2,80,80,{margin_v},177

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    def ass_ts(s: float) -> str:
        cs = int(round(s * 100))
        hh, cs = divmod(cs, 360000)
        mm, cs = divmod(cs, 6000)
        ss, cs = divmod(cs, 100)
        return f'{hh}:{mm:02}:{ss:02}.{cs:02}'

    newline = '\\N'
    events = []
    for c in cues:
        text = newline.join(rtl_line(l) for l in wrap(c['text']))
        events.append(f"Dialogue: 0,{ass_ts(c['start'])},{ass_ts(c['end'])},Cap,,0,0,0,,{text}")
    path = out / name
    path.write_text(head + '\n'.join(events) + '\n', encoding='utf-8')
    return path


def card(edit: dict, scene: dict, w: int, h: int, path: Path, *, slate: bool = False) -> None:
    """Renders a brand card or a DRAFT capture slate at 2x for smooth zoom."""
    b = edit['brand']
    W, H = w * 2, h * 2
    img = Image.new('RGB', (W, H), hex_rgb(b['background']))
    d = ImageDraw.Draw(img)
    vertical = h > w
    if not slate:
        # Everything stays above the bottom ~22% caption band.
        mascot = Image.open(REPO / b['mascot']).convert('RGBA')
        m = int(min(W, H) * (0.36 if not vertical else 0.60))
        mascot = mascot.resize((m, m), Image.LANCZOS)
        top = int(H * (0.05 if not vertical else 0.12))
        img.paste(mascot, ((W - m) // 2, top), mascot)
        y = top + m + int(H * 0.02)
        if scene['id'] == 'S1-open':
            # The wordmark PNG carries a soft near-white matte; seat it on the
            # brand's white surface card so the matte is invisible (asset untouched).
            wm = Image.open(REPO / b['wordmark'] if not Path(b['wordmark']).is_absolute() else b['wordmark']).convert('RGBA')
            ww = int(W * (0.24 if not vertical else 0.56))
            wm = wm.resize((ww, int(wm.height * ww / wm.width)), Image.LANCZOS)
            pad = int(ww * 0.06)
            if b.get('wordmarkCard', True):
                d.rounded_rectangle(((W - ww) // 2 - pad, y, (W + ww) // 2 + pad, y + wm.height + 2 * pad),
                                    radius=int(pad * 1.4), fill=hex_rgb(b['surface']), outline=hex_rgb(b['border']), width=4)
            img.paste(wm, ((W - ww) // 2, y + pad), wm)
            y += wm.height + 2 * pad + int(H * 0.03)
        else:
            rtl_text(d, (W // 2, y), scene['title'], font(FONT_BOLD, int(H * (0.06 if not vertical else 0.040))), hex_rgb(b['text']))
            y += int(H * 0.09)
        sub_font = font(FONT_REG, int(H * (0.038 if not vertical else 0.026)))
        for i, line in enumerate(wrap_free(scene['subtitle'], 60 if not vertical else 26)):
            rtl_text(d, (W // 2, y + i * int(H * (0.05 if not vertical else 0.034))), line, sub_font, hex_rgb(b['textSecondary']))
    else:
        # A slate is explicitly NOT app UI: dashed outline, DRAFT badge, file name.
        pw = int(H * 0.40) if not vertical else int(W * 0.70)
        # Keep the slate frame clear of the bottom caption band.
        ph = min(int(pw * 2.05), int(H * (0.66 if not vertical else 0.62)))
        x0, y0 = (W - pw) // 2, int(H * 0.10)
        d.rounded_rectangle((x0, y0, x0 + pw, y0 + ph), radius=int(pw * 0.09), outline=hex_rgb(b['border']), width=8)
        dash_col = hex_rgb(b['primary'])
        for x in range(x0 + 60, x0 + pw - 60, 48):
            d.line((x, y0, x + 24, y0), fill=dash_col, width=8)
            d.line((x, y0 + ph, x + 24, y0 + ph), fill=dash_col, width=8)
        rtl_text(d, (W // 2, y0 + int(ph * 0.30)), 'טיוטה · DRAFT', font(FONT_BOLD, int(H * 0.04)), dash_col)
        label = scene.get('pendingLabel') if scene.get('gated') else 'כאן יוצג צילום מסך אמיתי מ־Staging'
        label_lines = wrap_free(label, 26)
        step = int(H * (0.05 if not vertical else 0.032))
        y_label = y0 + int(ph * 0.42)
        for i, line in enumerate(label_lines):
            rtl_text(d, (W // 2, y_label + i * step), line, font(FONT_REG, int(H * (0.034 if not vertical else 0.022))), hex_rgb(b['text']))
        d.text((W // 2, y_label + len(label_lines) * step + int(step * 0.6)), Path(scene['capture']).name,
               font=font(FONT_REG, int(H * (0.024 if not vertical else 0.016))), fill=hex_rgb(b['textSecondary']), anchor='ma')
    if scene.get('chapter'):
        cx = W - int(W * 0.05)
        rtl_text(d, (cx, int(H * 0.05)), scene['chapter'], font(FONT_BOLD, int(H * 0.045)), hex_rgb(b['primaryDark']), anchor='ra')
    img.save(path)


def still_segment(png: Path, seconds: float, w: int, h: int, fps: int, bg: str, out: Path, zoom: float) -> None:
    frames = int(round(seconds * fps))
    z = f"1+{zoom}*on/{max(frames - 1, 1)}"
    vf = (f"zoompan=z='{z}':d={frames}:s={w}x{h}:fps={fps}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',"
          f"fade=t=in:st=0:d={FADE}:color={bg},fade=t=out:st={seconds - FADE:.3f}:d={FADE}:color={bg},format=yuv420p")
    sh('ffmpeg', '-y', '-loglevel', 'error', '-i', str(png), '-vf', vf, '-frames:v', str(frames),
       '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', str(fps), str(out))


MAX_CROP = 0.20      # never crop more than 20 % of a recording's height
TAP_SECONDS = 0.6    # how long a tap highlight ring stays on screen


def capture_plan(scene: dict, captures: Path) -> tuple[list[dict], list[str]]:
    """Resolves a capture scene into ordered segments of genuine recordings.

    Without "captureEdit" the scene plays its single recording from 0 s. With
    it, "segments" lists [{src, in, out, cropTop, cropBottom}] cut from one or
    more recordings, in order (real-time only: no speed changes, no
    compositing). Crops are fractions of the source height (≤ MAX_CROP) and
    exist only to remove the status bar or an admin-only control row
    (CAPTURE_SESSION_AUTHORIZATION.md decision D3). Returns (segments, missing)."""
    edit = scene.get('captureEdit') or {}
    default_src = Path(scene['capture']).name
    raw = edit.get('segments') or [{'src': default_src}]
    if len(raw) > 1 and any(seg.get('in') is None and seg.get('out') is None for seg in raw):
        # Not cut yet: a rough preview plays each distinct recording once from 0 s.
        seen: list[str] = []
        for seg in raw:
            name = Path(seg.get('src') or default_src).name
            if name not in seen:
                seen.append(name)
        if all((captures / name).exists() for name in seen):
            print(f"WARN {scene['id']}: captureEdit in/out not set yet — rough preview of {', '.join(seen)}")
        scene['_uncut'] = True
        raw = [{'src': name, 'cropTop': raw[0].get('cropTop'), 'cropBottom': raw[0].get('cropBottom')} for name in seen]
    segs, missing = [], []
    for i, seg in enumerate(raw):
        src = captures / Path(seg.get('src') or default_src).name
        a = float(seg.get('in') or 0.0)
        z = seg.get('out')
        z = float(z) if z is not None else None
        ct = float(seg.get('cropTop', edit.get('cropTop')) or 0.0)
        cb = float(seg.get('cropBottom', edit.get('cropBottom')) or 0.0)
        where = f"{scene['id']} segment {i + 1}"
        if a < 0 or (z is not None and z <= a):
            raise SystemExit(f'{where}: "in" must be ≥ 0 and "out" > "in"')
        if not (0 <= ct <= MAX_CROP and 0 <= cb <= MAX_CROP):
            raise SystemExit(f'{where}: crops are limited to {MAX_CROP:.0%} of the height (cropTop={ct}, cropBottom={cb})')
        if not src.exists():
            missing.append(src.name)
        segs.append({'src': src, 'in': a, 'out': z, 'cropTop': ct, 'cropBottom': cb})
    return segs, missing


def probe_size(path: Path) -> tuple[int, int]:
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                          '-of', 'csv=p=0', str(path)], capture_output=True, text=True, check=True).stdout
    w, h = out.strip().split(',')[:2]
    return int(w), int(h)


def tap_ring(path: Path, size: int, colour: tuple[int, int, int]) -> None:
    """A plain highlight ring marking where the real tap happened (annotation, not UI)."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    stroke = max(3, size // 12)
    d.ellipse((stroke, stroke, size - stroke, size - stroke), fill=(255, 255, 255, 70), outline=colour + (235,), width=stroke)
    img.save(path)


def capture_segment(edit: dict, scene: dict, segs: list[dict], seconds: float, w: int, h: int, fps: int,
                    out: Path, work: Path) -> None:
    """Genuine screen recording(s) framed as a rounded phone on the brand background."""
    b = edit['brand']
    tag = f"{scene['id']}_{w}x{h}"
    bg_png = work / f"{tag}_bg.png"
    img = Image.new('RGB', (w, h), hex_rgb(b['background']))
    d = ImageDraw.Draw(img)
    if scene.get('chapter'):
        rtl_text(d, (w - int(w * 0.05), int(h * 0.05)), scene['chapter'], font(FONT_BOLD, int(min(w, h) * 0.045)), hex_rgb(b['primaryDark']), anchor='ra')
    img.save(bg_png)
    vertical = h > w
    # Safe area: below the chapter title, above the bottom caption band, so
    # captions never cover app UI (e.g. buttons at the bottom of the screen).
    ph = int(h * (0.70 if not vertical else 0.74))
    top = int(h * (0.11 if not vertical else 0.10))
    sw, sh_ = probe_size(segs[0]['src'])
    visible = sh_ * (1 - segs[0]['cropTop'] - segs[0]['cropBottom'])
    pw = min(int(ph * sw / visible), int(w * 0.9)) // 2 * 2
    mask = work / f"{tag}_mask.png"
    m = Image.new('L', (pw, ph), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, pw - 1, ph - 1), radius=int(pw * 0.11), fill=255)
    m.save(mask)
    bg = b['background'].replace('#', '0x')
    inputs: list[str] = []
    chains: list[str] = []
    for i, sg in enumerate(segs):
        if sg['in']:
            inputs += ['-ss', f"{sg['in']:.3f}"]
        if sg['out'] is not None:
            inputs += ['-t', f"{sg['out'] - sg['in']:.3f}"]
        inputs += ['-i', str(sg['src'])]
        ct, cb = sg['cropTop'], sg['cropBottom']
        # Round the removed strips UP to even rows so no sliver of the cropped
        # status bar / admin row survives.
        top_px, bot_px = f"ceil(ih*{ct:.5f}/2)*2", f"ceil(ih*{cb:.5f}/2)*2"
        crop = f"crop=iw:trunc((ih-{top_px}-{bot_px})/2)*2:0:{top_px}," if (ct or cb) else ''
        chains.append(f"[{i}:v]{crop}scale={pw}:{ph}:force_original_aspect_ratio=decrease,"
                      f"pad={pw}:{ph}:(ow-iw)/2:(oh-ih)/2:color={bg},fps={fps},setsar=1,format=rgba[s{i}]")
    n = len(segs)
    joined = ''.join(f'[s{i}]' for i in range(n))
    chains.append(f"{joined}concat=n={n}:v=1:a=0,tpad=stop_mode=clone:stop_duration={seconds},"
                  f"trim=duration={seconds},setpts=PTS-STARTPTS[cat]")
    taps = (scene.get('captureEdit') or {}).get('taps') or []
    bg_i, mask_i = n, n + 1
    extra = ['-loop', '1', '-i', str(bg_png), '-loop', '1', '-i', str(mask)]
    last = 'cat'
    if taps:
        ring = work / f"{tag}_ring.png"
        rs = max(24, int(pw * 0.16)) // 2 * 2
        tap_ring(ring, rs, hex_rgb(b['primary']))
        extra += ['-loop', '1', '-i', str(ring)]
        ring_i = n + 2
        chains.append(f"[{ring_i}:v]format=rgba,split={len(taps)}" + ''.join(f'[r{k}]' for k in range(len(taps))))
        for k, tp in enumerate(taps):
            t0, x, y = float(tp['t']), float(tp['x']), float(tp['y'])
            if not (0 <= x <= 1 and 0 <= y <= 1 and 0 <= t0 < seconds):
                raise SystemExit(f"{scene['id']} tap {k + 1}: t within the scene, x/y as 0–1 fractions of the recording")
            chains.append(f"[{last}][r{k}]overlay=x='{x:.4f}*W-w/2':y='{y:.4f}*H-h/2':"
                          f"enable='between(t,{t0:.3f},{t0 + TAP_SECONDS:.3f})'[t{k}]")
            last = f't{k}'
    chains.append(f"[{mask_i}:v]format=gray[m];[{last}]format=rgba[capa];[capa][m]alphamerge[rounded]")
    chains.append(f"[{bg_i}:v][rounded]overlay=(W-w)/2:{top}:shortest=0,"
                  f"fade=t=in:st=0:d={FADE}:color={bg},fade=t=out:st={seconds - FADE:.3f}:d={FADE}:color={bg},format=yuv420p[v]")
    sh('ffmpeg', '-y', '-loglevel', 'error', *inputs, *extra, '-filter_complex', ';'.join(chains), '-map', '[v]',
       '-t', f'{seconds}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', str(fps), '-an', str(out))


def cue_file(vo_dir: Path, n: int) -> Path | None:
    for ext in ('wav', 'flac', 'm4a', 'mp3'):
        p = vo_dir / f'cue-{n:02}.{ext}'
        if p.exists():
            return p
    return None


def duration(path: Path) -> float:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def make_narration(args, cues: list[dict], scene_end: dict, total: float, work: Path) -> Path | None:
    """Builds one normalised narration track (−16 LUFS, −1 dBTP, 48 kHz stereo).

    --vo-dir: per-cue takes are placed at their cue start, and each caption's
    end is re-timed to the spoken length (+0.4 s), never past the next cue or
    the scene end. --vo: one continuous take, used as-is (cue times must
    already be aligned in edit.json). Neither: None → silent animatic."""
    norm = 'aresample=48000,aformat=channel_layouts=stereo'
    raw = work / 'narration_raw.wav'
    out = work / 'narration.wav'
    if args.vo_dir:
        vo_dir = Path(args.vo_dir)
        inputs, chains, labels = [], [], []
        for i, c in enumerate(cues):
            f = cue_file(vo_dir, c['n'])
            if not f:
                raise SystemExit(f"missing narration take cue-{c['n']:02} for: {c['text']}")
            d = duration(f)
            nxt = cues[i + 1]['start'] if i + 1 < len(cues) else total
            limit = min(nxt - 0.1, scene_end[c['scene']] - 0.1)
            if c['start'] + d > limit + 0.05:
                raise SystemExit(f"cue-{c['n']:02} take is {d:.2f}s and would overlap the next line; re-time edit.json or shorten the take")
            c['end'] = round(min(c['start'] + d + 0.4, limit), 3)
            inputs += ['-i', str(f)]
            ms = int(round(c['start'] * 1000))
            chains.append(f'[{i}:a]aformat=channel_layouts=stereo,aresample=48000,adelay={ms}|{ms}[a{i}]')
            labels.append(f'[a{i}]')
        fc = ';'.join(chains) + f";{''.join(labels)}amix=inputs={len(labels)}:normalize=0:dropout_transition=0," \
             f"apad,atrim=0:{total},{norm}[out]"
        sh('ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', fc, '-map', '[out]', '-ar', '48000', str(raw))
        loudnorm_2pass(raw, out, -16)
        return out
    if args.vo:
        sh('ffmpeg', '-y', '-loglevel', 'error', '-i', args.vo, '-af', f'apad,atrim=0:{total},{norm}', '-ar', '48000', str(raw))
        loudnorm_2pass(raw, out, -16)
        return out
    return None


def loudnorm_2pass(src: Path, dst: Path, target_i: float, target_tp: float = -1.0, lra: float = 11.0) -> None:
    """Measure, then apply an exact linear gain (EBU R128). Single-pass
    loudnorm is dynamic and undershoots on speech with long pauses."""
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(src), '-af',
                          f'loudnorm=I={target_i}:TP={target_tp}:LRA={lra}:print_format=json', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    m = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', err, re.S).group(0))
    af = (f"loudnorm=I={target_i}:TP={target_tp}:LRA={lra}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,"
          f"aresample=48000")
    sh('ffmpeg', '-y', '-loglevel', 'error', '-i', str(src), '-af', af, '-ar', '48000', str(dst))


def music_license(music: Path, allow_pending: bool) -> dict:
    """Every music file needs <file>.license.json; unapproved music is DRAFT-only."""
    lic_path = Path(str(music) + '.license.json')
    if not lic_path.exists():
        raise SystemExit(f'refusing music without a licence record: {lic_path}')
    lic = json.loads(lic_path.read_text(encoding='utf-8'))
    for key in ('title', 'source', 'license', 'rightsHolder', 'approvedBy'):
        if not lic.get(key):
            raise SystemExit(f'music licence record is missing "{key}"')
    digest = hashlib.sha256(music.read_bytes()).hexdigest()
    if lic.get('fileSha256') and lic['fileSha256'] != digest:
        raise SystemExit('music file does not match the SHA-256 in its licence record')
    pending = str(lic['license']).startswith('PENDING') or str(lic['approvedBy']).startswith('PENDING')
    if pending and not allow_pending:
        raise SystemExit('music licence/approval is PENDING — pass --draft to use it in a DRAFT render only')
    print(f"music: {lic['title']} | licence: {lic['license']} | approved: {lic['approvedBy']}")
    return lic


def mix_music(args, narration: Path | None, total: float, work: Path) -> Path | None:
    """Subtle bed: levelled to −30 LUFS, faded, ducked under narration
    (side-chain), final mix −16 LUFS / −1 dBTP. Without narration the bed is
    left at −24 LUFS for DRAFT previews."""
    if not args.music:
        return narration
    music = Path(args.music)
    music_license(music, args.draft)
    out = work / 'mix.wav'
    bed = (f"[m]aformat=channel_layouts=stereo,aresample=48000,apad,atrim=0:{total},"
           f"afade=t=in:d=1.5,afade=t=out:st={max(total - 3, 0):.3f}:d=3")
    shaped = work / 'bed_shaped.wav'
    sh('ffmpeg', '-y', '-loglevel', 'error', '-i', str(music), '-filter_complex', bed.replace('[m]', '[0:a]', 1) + '[out]',
       '-map', '[out]', '-ar', '48000', str(shaped))
    if narration is None:
        loudnorm_2pass(shaped, out, -24, -3, 7)
        return out
    levelled = work / 'bed_levelled.wav'
    loudnorm_2pass(shaped, levelled, -30, -6, 7)
    raw = work / 'mix_raw.wav'
    # Gentle side-chain ducking (≈8–10 dB under speech), slow release to avoid pumping.
    fc = ("[0:a]asplit=2[vo][key];"
          "[1:a][key]sidechaincompress=threshold=0.05:ratio=3:attack=40:release=600:makeup=1[ducked];"
          "[vo][ducked]amix=inputs=2:normalize=0:dropout_transition=0[out]")
    sh('ffmpeg', '-y', '-loglevel', 'error', '-i', str(narration), '-i', str(levelled), '-filter_complex', fc,
       '-map', '[out]', '-ar', '48000', str(raw))
    loudnorm_2pass(raw, out, -16)
    return out


def build(edit: dict, args, w: int, h: int, tag: str, out: Path, work: Path) -> Path:
    fps = edit['fps']
    bg = edit['brand']['background'].replace('#', '0x')
    scenes = [s for s in edit['scenes'] if args.include_gps or not s.get('gated')]
    segs: list[Path] = []
    report_captures: dict = {}
    review = out / 'review'
    review.mkdir(exist_ok=True)
    t = 0.0
    timeline = []
    for s in scenes:
        dur = s['end'] - s['start']
        seg = work / f"{tag}_{s['id']}.mp4"
        plan, missing = capture_plan(s, Path(args.captures)) if s['type'] == 'capture' else ([], [])
        if s['type'] == 'brand':
            png = work / f"{tag}_{s['id']}.png"
            card(edit, s, w, h, png)
            still_segment(png, dur, w, h, fps, bg, seg, 0.03)
            kind = 'brand'
        elif plan and not missing:
            capture_segment(edit, s, plan, dur, w, h, fps, seg, work)
            kind = 'capture'
            used = sum((p['out'] if p['out'] is not None else duration(p['src'])) - p['in'] for p in plan)
            if used < dur - 0.05:
                print(f"WARN {s['id']}: recordings cover {used:.1f}s of {dur:.1f}s — the last frame is held")
            elif used > dur + 0.05:
                print(f"WARN {s['id']}: recordings run {used:.1f}s; only the first {dur:.1f}s are used")
            report_captures[s['id']] = {'uncut': bool(s.get('_uncut')), 'segments': [{'file': p['src'].name, 'sha256': sha256(p['src']), 'in': p['in'], 'out': p['out'],
                                         'cropTop': p['cropTop'], 'cropBottom': p['cropBottom']} for p in plan],
                                    'taps': len((s.get('captureEdit') or {}).get('taps') or [])}
        else:
            png = work / f"{tag}_{s['id']}.png"
            card(edit, s, w, h, png, slate=True)
            still_segment(png, dur, w, h, fps, bg, seg, 0.0)
            kind = 'DRAFT slate'
            if missing:
                print(f"INFO {s['id']}: DRAFT slate — missing {', '.join(missing)}")
        segs.append(seg)
        timeline.append((s, t, t + dur, kind))
        sh('ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{dur / 2:.2f}', '-i', str(seg), '-frames:v', '1', str(review / f"{tag}_{s['id']}.png"))
        t += dur
    # Re-time cues onto the edited timeline (gated scene removal shifts later scenes).
    offsets = {s['id']: start - s['start'] for s, start, _, _ in timeline}
    cues = [{**c, 'n': n, 'start': c['start'] + offsets[c['scene']], 'end': c['end'] + offsets[c['scene']]}
            for n, c in enumerate(edit['cues'], 1) if c['scene'] in offsets]
    total = t
    scene_end = {s['id']: z for s, _, z, _ in timeline}
    narration = make_narration(args, cues, scene_end, total, work)
    narration = mix_music(args, narration, total, work)
    lst = work / f'{tag}_concat.txt'
    lst.write_text(''.join(f"file '{p}'\n" for p in segs))
    silent = work / f'{tag}_video.mp4'
    sh('ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(lst), '-c', 'copy', str(silent))
    audio = ['-f', 'lavfi', '-t', f'{total}', '-i', 'anullsrc=r=48000:cl=stereo'] if not narration else ['-i', str(narration)]
    if tag == '16x9':
        write_captions(cues, out)
    ass = write_ass(cues, work, w, h, f'{tag}.ass')
    if tag == '16x9':
        shutil.copy(ass, out / 'tutorial.he.ass')
    enc = ['-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '20',
           '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart',
           # Explicit length: -shortest would stop at the last caption when a
           # soft subtitle stream is muxed, truncating the closing card.
           '-t', f'{total:.3f}']
    master = out / f'tutorial_{tag}.mp4'
    if tag == '16x9':
        sh('ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), *audio, '-i', str(out / 'tutorial.he.srt'),
           '-map', '0:v', '-map', '1:a', '-map', '2:s', *enc, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=heb',
           '-metadata:s:s:0', 'title=עברית', '-metadata', 'title=Walkie Doggy Link — הדרכה (DRAFT)', str(master))
        reviewed = out / f'tutorial_{tag}_review.mp4'
        sh('ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), *audio, '-vf', f"ass={ass}", '-map', '0:v', '-map', '1:a',
           *enc, str(reviewed))
        for s, start, end, _ in timeline:
            mid = start + (end - start) / 2
            sh('ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{mid:.2f}', '-i', str(reviewed), '-frames:v', '1',
               str(review / f"captioned_{s['id']}.png"))
    else:
        sh('ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), *audio, '-vf', f"ass={ass}", '-map', '0:v', '-map', '1:a',
           *enc, str(master))
    print(f'[{tag}] {total:.1f}s')
    for s, a, z, kind in timeline:
        print(f'  {a:6.1f}–{z:6.1f}  {s["id"]:<22} {kind}')
    REPORT['renders'][tag] = {
        'file': master.name, 'seconds': round(total, 3),
        'scenes': [{'id': s['id'], 'start': round(a, 3), 'end': round(z, 3), 'kind': kind} for s, a, z, kind in timeline],
        'captures': report_captures,
        'cues': [{'n': c['n'], 'start': round(c['start'], 3), 'end': round(c['end'], 3), 'text': c['text']} for c in cues],
        'narration': bool(args.vo or args.vo_dir), 'music': bool(args.music),
    }
    return master


def narration_approval(vo_dir: Path, cue_numbers: list[int], allow_pending: bool) -> dict:
    """Per-cue takes need <vo-dir>/narration.approval.json (written by
    audio_qa.py --write-approval-template): the SHA-256 of every take, the voice
    artist's licence, the native Israeli-Hebrew speaker's pronunciation sign-off
    and the owner's approval. Anything PENDING is DRAFT-only."""
    rec_path = vo_dir / 'narration.approval.json'
    if not rec_path.exists():
        if allow_pending:
            print('narration: no approval record (DRAFT render)')
            return {'approval': 'DRAFT (no approval record)'}
        raise SystemExit(f'refusing narration without an approval record: {rec_path} (audio_qa.py --write-approval-template)')
    rec = json.loads(rec_path.read_text(encoding='utf-8'))
    hashes = rec.get('takesSha256') or {}
    for n in cue_numbers:
        take = cue_file(vo_dir, n)
        if take is None:
            continue   # make_narration reports the missing take
        if hashes.get(take.name) != sha256(take):
            raise SystemExit(f'{take.name} is not the take recorded in narration.approval.json (re-run the QA and sign-off)')
    review = rec.get('nativeSpeakerReview') or {}
    pending = [k for k, v in (('licence', rec.get('license')), ('native-speaker review', review.get('decision')),
                              ('owner approval', rec.get('ownerApproval'))) if not v or str(v).startswith('PENDING')]
    if pending and not allow_pending:
        raise SystemExit(f"narration approval incomplete ({', '.join(pending)}) — pass --draft for a DRAFT render only")
    summary = 'PENDING: ' + ', '.join(pending) if pending else \
        f"licensed; reviewed by {review.get('reviewer')} {review.get('date')}; owner: {rec.get('ownerApproval')}"
    print(f'narration: {summary}')
    return {'approval': summary, 'voiceArtist': rec.get('voiceArtist')}


def wordmark_approval(png: Path, allow_pending: bool) -> str:
    """A replacement wordmark needs <file>.approval.json whose SHA-256 matches.
    Until its final visual QA is signed off it may only appear in --draft renders."""
    rec_path = Path(str(png) + '.approval.json')
    if not rec_path.exists():
        if 'DRAFT' in png.name and allow_pending:
            return 'DRAFT (no approval record)'
        raise SystemExit(f'refusing a wordmark without an approval record: {rec_path}')
    rec = json.loads(rec_path.read_text(encoding='utf-8'))
    if rec.get('fileSha256') != sha256(png):
        raise SystemExit('wordmark file does not match the SHA-256 in its approval record')
    final_qa = str(rec.get('finalVisualQA', 'PENDING'))
    if final_qa.startswith('PENDING') and not allow_pending:
        raise SystemExit('wordmark final visual QA is PENDING — pass --draft to use it in a DRAFT render only')
    print(f"wordmark: {png.name} | production use: {rec.get('approvedForProduction')} | final visual QA: {final_qa}")
    return f"production: {rec.get('approvedForProduction')}; final visual QA: {final_qa}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--vo', help='one continuous narration take (cue times must already match)')
    ap.add_argument('--vo-dir', help='per-cue takes cue-01.wav … (run audio_qa.py first); captions re-time to the takes')
    ap.add_argument('--captures', default=str(REPO / 'docs/product/tutorial-video/captures'))
    ap.add_argument('--include-gps', action='store_true', help='only after real-iPhone GPS acceptance')
    ap.add_argument('--music', help='background bed; requires <file>.license.json')
    ap.add_argument('--draft', action='store_true', help='allow PENDING music/assets (DRAFT renders only)')
    ap.add_argument('--wordmark', help='override wordmark PNG (e.g. the clean DRAFT candidate; requires --draft)')
    ap.add_argument('--vertical', action='store_true')
    args = ap.parse_args()

    if not features.check('raqm'):
        raise SystemExit('Pillow without raqm cannot shape Hebrew RTL text')
    edit = json.loads(EDIT.read_text(encoding='utf-8'))
    digest = hashlib.sha256((REPO / edit['brand']['mascot']).read_bytes()).hexdigest()
    if digest != edit['brand']['mascotSha256']:
        raise SystemExit(f'mascot asset is not the approved derivative (sha256 {digest})')
    music = music_license(Path(args.music), args.draft) if args.music else None   # fail fast, before rendering
    wordmark = {'file': edit['brand']['wordmark'], 'sha256': sha256(REPO / edit['brand']['wordmark']), 'approval': 'brand asset'}
    if args.wordmark:
        approval = wordmark_approval(Path(args.wordmark), args.draft)
        edit['brand']['wordmark'] = str(Path(args.wordmark).resolve())
        edit['brand']['wordmarkCard'] = False   # a clean transparent wordmark sits directly on cream
        wordmark = {'file': Path(args.wordmark).name, 'sha256': sha256(Path(args.wordmark)), 'approval': approval}
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    work = out / 'work'
    work.mkdir(exist_ok=True)
    gated = {sc['id'] for sc in edit['scenes'] if sc.get('gated')}
    if args.vo and not args.draft:
        raise SystemExit('a single continuous take has no per-cue approval record — use --vo-dir, or --draft')
    REPORT.update({
        'tool': 'scripts/tutorial-video/build_video.py', 'edit': 'docs/product/tutorial-video/edit.json',
        'editSha256': sha256(EDIT), 'scriptVersion': edit.get('scriptVersion'), 'draft': bool(args.draft),
        'includeGps': bool(args.include_gps), 'mascot': {'file': edit['brand']['mascot'], 'sha256': digest},
        'wordmark': wordmark,
        'music': ({'file': Path(args.music).name, 'sha256': sha256(Path(args.music)), 'license': music['license'],
                   'approvedBy': music['approvedBy']} if music else None),
        'narration': ({'mode': 'per-cue', 'dir': Path(args.vo_dir).name, **narration_approval(
                          Path(args.vo_dir), [n for n, c in enumerate(edit['cues'], 1)
                                              if args.include_gps or c['scene'] not in gated], args.draft)}
                      if args.vo_dir else
                      {'mode': 'single', 'file': Path(args.vo).name,
                       'approval': 'DRAFT (single take — no per-cue approval record)'} if args.vo else None),
    })
    build(edit, args, edit['canvas']['w'], edit['canvas']['h'], '16x9', out, work)
    if args.vertical:
        build(edit, args, edit['vertical']['w'], edit['vertical']['h'], '9x16', out, work)
    (out / 'build_report.json').write_text(json.dumps(REPORT, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"report: {out / 'build_report.json'}")


if __name__ == '__main__':
    main()
