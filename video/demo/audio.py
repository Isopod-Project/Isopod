"""Synthesize the soundtrack: soft UI clicks and key taps on the timeline's events, over a
quiet felt-piano arpeggio. No samples; numpy and scipy only.

Reads out/events.json (written by render.py) and writes out/audio.wav. If only the
sound changes, run this and then `python render.py mux` instead of re-rendering frames.
"""
import json
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
rng = np.random.default_rng(7)


def lowpass(x, hz, order=2):
    return sosfilt(butter(order, hz, "low", fs=SR, output="sos"), x)


def env(n, attack, decay):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-t / decay)


def damped(freq, dur, decay, attack=0.0008):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t) * env(n, attack, decay)


def transient(dur=0.004, hz=3500):
    n = int(dur * SR)
    return lowpass(rng.standard_normal(n), hz) * np.linspace(1, 0, n) ** 2


def layer(*parts):
    """Sum sounds of different lengths, all starting at 0."""
    out = np.zeros(max(len(p) for p in parts))
    for p in parts:
        out[: len(p)] += p
    return out


def click():
    # Wooden "tock" around 1.1 kHz plus a lighter release ~60 ms later.
    down = layer(damped(1100, 0.05, 0.007), 0.45 * damped(2300, 0.03, 0.003), 0.08 * transient())
    up = 0.45 * layer(damped(1450, 0.04, 0.005), 0.04 * transient(0.003, 4000))
    out = np.zeros(int(0.12 * SR))
    out[: len(down)] += down
    o = int(0.06 * SR)
    out[o: o + len(up)] += up
    return out


def key(freq):
    # Rounded thump: low body, faint top.
    return layer(damped(freq, 0.09, 0.016, attack=0.0015), 0.3 * damped(freq * 2.7, 0.05, 0.006), 0.05 * transient(0.003, 2500))


def room(x, seconds=0.35, mix=0.12):
    n = int(seconds * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR / (seconds / 5))
    ir = lowpass(ir, 5000)
    wet = fftconvolve(x, ir)[: len(x)]
    wet /= np.max(np.abs(wet)) + 1e-9
    return x + mix * wet * np.max(np.abs(x))


def piano_note(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    tone = sum(a * np.sin(2 * np.pi * freq * h * t) for h, a in ((1, 1.0), (2, 0.35), (3, 0.12), (4, 0.05)))
    e = np.clip(t / 0.012, 0, 1) * np.exp(-t / 1.1)
    return lowpass(tone * e, 1800)


def note_hz(name):
    names = {"C": 0, "C#": 1, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}
    pitch, octave = name[:-1], int(name[-1])
    return 440 * 2 ** ((names[pitch] + 12 * (octave + 1) - 69) / 12)


def music(duration, end_at):
    bpm = 80
    eighth = 60 / bpm / 2
    chords = [
        ["F2", "C3", "A3", "E4", "F4", "C4"],    # Fmaj7
        ["D2", "A2", "F3", "C4", "E4", "A3"],    # Dm9
        ["Bb1", "F2", "D3", "A3", "C4", "F3"],   # Bbmaj7
        ["C2", "G2", "D3", "G3", "C4", "D4"],    # Csus2
    ]
    out = np.zeros(int((duration + 4) * SR))
    t = 0.0
    bar = 0
    while t < end_at - 0.1:
        ch = chords[bar % 4]
        pattern = [0, 2, 3, 4, 5, 4, 3, 2]
        for k, idx in enumerate(pattern):
            at = t + k * eighth
            if at >= end_at - 0.1:
                break
            vel = 0.55 if k == 0 else 0.32
            x = piano_note(note_hz(ch[idx]), 2.2) * vel
            if k == 0:
                x = layer(x, piano_note(note_hz(ch[1]), 2.8) * 0.35)
            i = int(at * SR)
            out[i: i + len(x)] += x[: len(out) - i]
        t += 8 * eighth
        bar += 1
    # One held chord under the end card
    i = int(end_at * SR)
    for name, vel in (("F2", 0.5), ("C3", 0.4), ("A3", 0.35), ("E4", 0.3), ("G4", 0.22)):
        x = piano_note(note_hz(name), 6.0) * vel
        out[i: i + len(x)] += x[: len(out) - i]
    out = room(out, seconds=2.4, mix=0.35)
    out = out[: int(duration * SR)]
    n = len(out)
    fade_in = np.clip(np.arange(n) / (1.2 * SR), 0, 1)
    fade_out = np.clip((n - np.arange(n)) / (1.6 * SR), 0, 1)
    out *= fade_in * fade_out
    return out / (np.max(np.abs(out)) + 1e-9)


def main():
    info = json.loads((OUT / "events.json").read_text())
    duration = info["duration"]
    n = int(duration * SR)
    fx = np.zeros(n + SR)
    c = click()
    for ev in info["sounds"]:
        i = int(ev["t"] * SR)
        if ev["type"] == "click":
            s = c
        elif ev["type"] == "mod":
            s = key(210)
        else:
            s = key(260 * (1 + 0.04 * rng.standard_normal()))
        s = s * (0.9 + 0.2 * rng.random())
        fx[i: i + len(s)] += s[: len(fx) - i]
    fx = room(fx[:n], seconds=0.3, mix=0.1)
    fx = fx / (np.max(np.abs(fx)) + 1e-9) * 0.11

    mus = music(duration, info["beats"]["end"]) * 0.24
    mix = mus + fx
    # About -11 dBFS peak
    mix = mix / (np.max(np.abs(mix)) + 1e-9) * 10 ** (-11 / 20)
    rms = np.sqrt(np.mean(mix ** 2))
    print(f"peak {20 * np.log10(np.max(np.abs(mix))):.1f} dBFS, rms {20 * np.log10(rms):.1f} dBFS")
    stereo = np.stack([mix, mix], axis=1)
    wavfile.write(OUT / "audio.wav", SR, (stereo * 32767).astype(np.int16))
    print(OUT / "audio.wav")


if __name__ == "__main__":
    main()
