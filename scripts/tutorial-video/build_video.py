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
  * Narration comes from a supplied audio file (--vo). Without it the video
    has a silent track and is a timing animatic only.

Usage:
  python3 scripts/tutorial-video/build_video.py --out <dir> [--vo narration.wav | --vo-dir takes/]
          [--captures <dir>] [--include-gps] [--vertical]
"""
from __future__ import annotations

import argparse
import hashlib
import json
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
            wm = Image.open(REPO / b['wordmark']).convert('RGBA')
            ww = int(W * (0.24 if not vertical else 0.56))
            wm = wm.resize((ww, int(wm.height * ww / wm.width)), Image.LANCZOS)
            pad = int(ww * 0.06)
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


def capture_segment(edit: dict, scene: dict, src: Path, seconds: float, w: int, h: int, fps: int, out: Path, work: Path) -> None:
    """Genuine screen recording framed as a rounded phone on the brand background."""
    b = edit['brand']
    bg_png = work / f"{scene['id']}_bg.png"
    img = Image.new('RGB', (w, h), hex_rgb(b['background']))
    d = ImageDraw.Draw(img)
    if scene.get('chapter'):
        rtl_text(d, (w - int(w * 0.05), int(h * 0.05)), scene['chapter'], font(FONT_BOLD, int(min(w, h) * 0.045)), hex_rgb(b['primaryDark']), anchor='ra')
    img.save(bg_png)
    vertical = h > w
    ph = int(h * (0.80 if not vertical else 0.78))
    mask = work / f"{scene['id']}_mask.png"
    pw_guess = int(ph * 0.4615)  # iPhone 19.5:9 portrait
    m = Image.new('L', (pw_guess, ph), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, pw_guess - 1, ph - 1), radius=int(pw_guess * 0.11), fill=255)
    m.save(mask)
    bg = b['background'].replace('#', '0x')
    fc = (f"[0:v]scale={pw_guess}:{ph}:force_original_aspect_ratio=decrease,pad={pw_guess}:{ph}:(ow-iw)/2:(oh-ih)/2:color={bg},"
          f"fps={fps},tpad=stop_mode=clone:stop_duration={seconds},trim=duration={seconds},setpts=PTS-STARTPTS,format=rgba[cap];"
          f"[2:v]format=gray[m];[cap][m]alphamerge[rounded];"
          f"[1:v][rounded]overlay=(W-w)/2:(H-h)/2+{int(h * 0.03)}:shortest=0,"
          f"fade=t=in:st=0:d={FADE}:color={bg},fade=t=out:st={seconds - FADE:.3f}:d={FADE}:color={bg},format=yuv420p[v]")
    sh('ffmpeg', '-y', '-loglevel', 'error', '-i', str(src), '-loop', '1', '-i', str(bg_png), '-loop', '1', '-i', str(mask),
       '-filter_complex', fc, '-map', '[v]', '-t', f'{seconds}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
       '-r', str(fps), '-an', str(out))


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
    norm = 'loudnorm=I=-16:TP=-1:LRA=11,aresample=48000,aformat=channel_layouts=stereo'
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
        sh('ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', fc, '-map', '[out]', '-ar', '48000', str(out))
        return out
    if args.vo:
        sh('ffmpeg', '-y', '-loglevel', 'error', '-i', args.vo, '-af', f'apad,atrim=0:{total},{norm}', '-ar', '48000', str(out))
        return out
    return None


def build(edit: dict, args, w: int, h: int, tag: str, out: Path, work: Path) -> Path:
    fps = edit['fps']
    bg = edit['brand']['background'].replace('#', '0x')
    scenes = [s for s in edit['scenes'] if args.include_gps or not s.get('gated')]
    segs: list[Path] = []
    review = out / 'review'
    review.mkdir(exist_ok=True)
    t = 0.0
    timeline = []
    for s in scenes:
        dur = s['end'] - s['start']
        seg = work / f"{tag}_{s['id']}.mp4"
        src = Path(args.captures) / Path(s['capture']).name if s['type'] == 'capture' else None
        if s['type'] == 'brand':
            png = work / f"{tag}_{s['id']}.png"
            card(edit, s, w, h, png)
            still_segment(png, dur, w, h, fps, bg, seg, 0.03)
            kind = 'brand'
        elif src and src.exists():
            capture_segment(edit, s, src, dur, w, h, fps, seg, work)
            kind = 'capture'
        else:
            png = work / f"{tag}_{s['id']}.png"
            card(edit, s, w, h, png, slate=True)
            still_segment(png, dur, w, h, fps, bg, seg, 0.0)
            kind = 'DRAFT slate'
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
    return master


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--vo', help='one continuous narration take (cue times must already match)')
    ap.add_argument('--vo-dir', help='per-cue takes cue-01.wav … (run audio_qa.py first); captions re-time to the takes')
    ap.add_argument('--captures', default=str(REPO / 'docs/product/tutorial-video/captures'))
    ap.add_argument('--include-gps', action='store_true', help='only after real-iPhone GPS acceptance')
    ap.add_argument('--vertical', action='store_true')
    args = ap.parse_args()

    if not features.check('raqm'):
        raise SystemExit('Pillow without raqm cannot shape Hebrew RTL text')
    edit = json.loads(EDIT.read_text(encoding='utf-8'))
    digest = hashlib.sha256((REPO / edit['brand']['mascot']).read_bytes()).hexdigest()
    if digest != edit['brand']['mascotSha256']:
        raise SystemExit(f'mascot asset is not the approved derivative (sha256 {digest})')
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    work = out / 'work'
    work.mkdir(exist_ok=True)
    build(edit, args, edit['canvas']['w'], edit['canvas']['h'], '16x9', out, work)
    if args.vertical:
        build(edit, args, edit['vertical']['w'], edit['vertical']['h'], '9x16', out, work)


if __name__ == '__main__':
    main()
