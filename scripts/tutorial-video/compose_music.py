#!/usr/bin/env python3
"""
Original background bed for the tutorial video — deterministic synthesis.

No samples, no third-party recordings, no generative model: every sample is
computed here from sine partials, envelopes and a one-pole low-pass filter,
from a fixed seed. Running it twice produces bit-identical audio, so the
file's provenance is the source code itself.

Character: warm, calm, unobtrusive — a slow four-chord loop (Cmaj7 · Am7 ·
Fmaj7 · G6, 72 BPM) with soft pads, a sparse bell-like arpeggio and a quiet
bass. Designed to sit under narration at −26 LUFS or lower and to be ducked.

Writes <out>.wav (48 kHz, 24-bit stereo) and <out>.wav.license.json.
Rights: original work created for Walkie Doggy Link; the owner records the
final licence decision (suggested: CC0 / project-owned) in the JSON.

Usage: python3 scripts/tutorial-video/compose_music.py <out.wav> [--seconds 139]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import wave
from pathlib import Path

import numpy as np

SR = 48_000
BPM = 72
BEAT = 60 / BPM
BAR = 4 * BEAT
# MIDI note numbers. Voicings kept in a mid register so the bed never masks speech fundamentals.
CHORDS = [
    ('Cmaj7', [48, 55, 59, 64], 36),   # C3 G3 B3 E4, bass C2
    ('Am7',   [45, 52, 55, 60], 33),   # A2 E3 G3 C4, bass A1
    ('Fmaj7', [41, 48, 52, 57], 29),   # F2 C3 E3 A3, bass F1
    ('G6',    [43, 50, 52, 59], 31),   # G2 D3 E3 B3, bass G1
]
ARP = [[64, 67, 71, 72], [64, 67, 69, 72], [65, 69, 72, 76], [62, 67, 71, 74]]


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def env_adsr(n: int, a: float, r: float) -> np.ndarray:
    t = np.arange(n) / SR
    e = np.minimum(1.0, t / a)
    e *= np.minimum(1.0, (n / SR - t) / r).clip(0, 1)
    return e


def one_pole_lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    from scipy.signal import lfilter
    k = np.exp(-2 * np.pi * cutoff / SR)
    return lfilter([1 - k], [1, -k], x, axis=0)


def compose(seconds: float, seed: int = 20261017) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    out = np.zeros((n, 2))
    bars = int(np.ceil(seconds / BAR)) + 1
    for b in range(bars):
        name, notes, bass = CHORDS[b % 4]
        start = int(b * BAR * SR)
        # Pad: overlaps the next bar by 1.5 s for a seamless crossfade.
        length = int((BAR + 1.5) * SR)
        if start >= n:
            break
        seg = min(length, n - start)
        t = np.arange(seg) / SR
        e = env_adsr(seg, 1.2, 1.6)
        pad = np.zeros((seg, 2))
        for j, m in enumerate(notes):
            f = hz(m)
            for side, det in ((0, -0.12), (1, 0.12)):         # gentle stereo detune
                ph = rng.uniform(0, 2 * np.pi)
                pad[:, side] += np.sin(2 * np.pi * (f + det) * t + ph) * 0.16
                pad[:, side] += np.sin(2 * np.pi * 2 * f * t + ph) * 0.02   # soft 2nd harmonic
        out[start:start + seg] += pad * e[:, None]
        # Bass: root on beat 1, slow decay.
        bseg = min(int(2.4 * SR), n - start)
        tb = np.arange(bseg) / SR
        bass_wave = np.sin(2 * np.pi * hz(bass) * tb) * np.exp(-tb / 1.1) * np.minimum(1, tb / 0.03) * 0.22
        out[start:start + bseg] += bass_wave[:, None]
        # Arpeggio: notes on beats 1 and 3 only (sparse), alternating pan.
        for k, beat in enumerate((0, 2)):
            ps = start + int(beat * BEAT * SR)
            if ps >= n:
                continue
            m = ARP[b % 4][(2 * b + k) % 4]
            aseg = min(int(1.8 * SR), n - ps)
            ta = np.arange(aseg) / SR
            bell = (np.sin(2 * np.pi * hz(m) * ta) + 0.25 * np.sin(2 * np.pi * 2 * hz(m) * ta)) \
                * np.exp(-ta / 0.55) * np.minimum(1, ta / 0.006) * 0.07
            pan = 0.3 if (b + k) % 2 else -0.3
            out[ps:ps + aseg, 0] += bell * (1 - pan)
            out[ps:ps + aseg, 1] += bell * (1 + pan)
    out = one_pole_lowpass(out, 3200.0)
    # Fades and peak normalisation (−6 dBFS); final loudness is set in the mix.
    fade_in, fade_out = int(2.5 * SR), int(4.0 * SR)
    out[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    out[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
    out *= 10 ** (-6 / 20) / max(np.abs(out).max(), 1e-9)
    return out


def write_wav(path: Path, audio: np.ndarray) -> None:
    pcm = np.clip(audio, -1, 1)
    ints = (pcm * (2 ** 23 - 1)).astype('<i4')
    raw = ints.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3].tobytes()   # little-endian 24-bit
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(raw)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--seconds', type=float, default=139.0)
    args = ap.parse_args()
    out = Path(args.out)
    write_wav(out, compose(args.seconds))
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    script = Path(__file__).read_bytes()
    manifest = {
        'title': 'Walkie Doggy Link — tutorial bed (original)',
        'source': 'scripts/tutorial-video/compose_music.py (deterministic synthesis, seed 20261017)',
        'generatorSha256': hashlib.sha256(script).hexdigest(),
        'fileSha256': digest,
        'thirdPartyMaterial': 'none — no samples, recordings or generative models',
        'license': 'PENDING OWNER DECISION (suggested: CC0 / project-owned original work)',
        'rightsHolder': 'Walkie Doggy Link project owner',
        'approvedBy': 'PENDING — must be auditioned and approved by a human before final use',
    }
    Path(str(out) + '.license.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(out, f'{args.seconds:.1f}s', digest[:16])


if __name__ == '__main__':
    main()
