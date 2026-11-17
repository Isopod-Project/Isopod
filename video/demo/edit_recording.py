"""Cut a real screen recording of Isopod into a short captioned demo video.

    python edit_recording.py "C:/Users/me/Videos/isopod demo.mp4" [out.mp4]
    python edit_recording.py --portrait "C:/Users/me/Videos/isopod demo.mp4" out-portrait.mp4

The source is a 3840x2160 capture of the dashboard in a browser. Each segment below is
trimmed, cropped to the part of the screen that matters, sped up if it drags, blurred
where the server's public IP shows, and captioned. Segments are joined with short
crossfades between a title card and an end card, over the piano bed from audio.py.

Narration is synthesized locally with Kokoro (kokoro-onnx); model files go in models/:
  kokoro-v1.0.onnx and voices-v1.0.bin from github.com/thewh1teagle/kokoro-onnx releases.
VOICE=am_michael picks another voice; NARRATE=0 renders music only.

Work files go to out/edit/. Needs pillow, numpy, scipy, soundfile, kokoro-onnx, imageio-ffmpeg.
"""
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy.io import wavfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PORTRAIT = "--portrait" in sys.argv
if PORTRAIT:
    sys.argv.remove("--portrait")
WORK = HERE / "out" / ("edit-portrait" if PORTRAIT else "edit")
VOICE_CACHE = HERE / "out" / "edit" / "voice"
W, H, FPS = (1080, 1920, 30) if PORTRAIT else (2560, 1440, 30)
# Portrait layout: header band, a square of the app, the caption, then empty space
# at the bottom where the Shorts / TikTok / Reels overlay sits.
P_VIDEO_Y, P_VIDEO = 300, 1080
P_CAPTION_Y = 1430
XFADE = 0.35
ACCENT = (62, 142, 208)
FONT_DIR = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"


def ffmpeg_exe():
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


FF = ffmpeg_exe()

# Crop rectangles in source pixels (x, y, w, h), all 16:9.
FULL = (0, 0, 3840, 2160)
MODAL = (320, 236, 3200, 1800)       # the edit dialog and the create wizard
SETTINGS = (533, 364, 2774, 1560)    # application settings dialog
DIALOG = (764, 486, 2311, 1300)      # "Change Minecraft version" confirmation

# Portrait uses square crops: the dialogs are about as tall as they are wide.
PORTRAIT_CROP = {
    FULL: (0, 120, 1300, 1300),           # server cards and folders, top-left
    MODAL: (1040, 256, 1760, 1760),
    SETTINGS: (1180, 404, 1480, 1480),
    DIALOG: (1345, 561, 1150, 1150),
}
PORTRAIT_OVERRIDE = {
    7: (1040, 140, 1720, 1720),           # docs article, centred
    13: (2960, 100, 880, 880),            # sidebar status while it restarts
}

# Boxes to blur, in source pixels: the server address shows the host's public IP.
SIDEBAR_IP = (3590, 1915, 240, 120)
FOOTER_IP_ONLINE = (1222, 1930, 628, 62)    # footer chips when the status pill is short
FOOTER_IP_DEMO = (1376, 1930, 474, 62)      # footer chips after a long "Downloading..." pill

# (start s, end s, crop, speed, caption, blur boxes)
SEGMENTS = [
    (7.5, 13.9, FULL, 1.0, "Every server in one dashboard, sorted into folders", [SIDEBAR_IP]),
    (14.0, 19.5, MODAL, 1.0, "Create a server: pick a Minecraft version and a mod loader", []),
    (19.5, 33.0, MODAL, 1.6, "Or start from a Modrinth modpack", []),
    (33.0, 44.5, MODAL, 1.6, "Set up the world, game mode and whitelist", []),
    (44.5, 52.5, FULL, 1.5, "The new server shows up and starts installing", [SIDEBAR_IP]),
    (64.5, 76.0, MODAL, 1.6, "Every mod from the pack, ready to toggle or update", [FOOTER_IP_DEMO]),
    (119.0, 132.0, MODAL, 1.5, "Live console. Send commands straight to the server", [FOOTER_IP_ONLINE]),
    (141.5, 148.0, FULL, 1.0, "The ? on every screen opens its docs", [SIDEBAR_IP]),
    (151.5, 159.5, MODAL, 1.3, "Scheduled and on-demand world backups", [FOOTER_IP_ONLINE]),
    (160.0, 166.5, MODAL, 1.2, "Browse and manage server files", [FOOTER_IP_ONLINE]),
    (170.0, 175.5, MODAL, 1.0, "Switch between Fabric, Forge, NeoForge, Paper and more", [FOOTER_IP_ONLINE]),
    (175.5, 180.5, MODAL, 1.2, "Change the Minecraft version", [FOOTER_IP_ONLINE]),
    (186.0, 195.5, DIALOG, 1.5, "Isopod updates the loader and checks your mods", []),
    (201.0, 209.0, FULL, 1.3, "It restarts on the new version", [SIDEBAR_IP]),
    (219.0, 231.0, SETTINGS, 1.6, "App settings: server defaults, updates, accounts", []),
]

# Voiceover, one line per clip: the title card, each segment above, then the end card.
# A clip that is shorter than its line is slowed toward 1x, then holds its last frame.
NARRATION = [
    "Running a Minecraft server for your friends shouldn't mean living in a terminal.",
    "This is Isopod. Every server you run, in one dashboard.",
    "Making a new one takes about a minute. Pick a version, pick a loader,",
    "or grab a whole modpack straight from Modrinth. Search it, pick it, done.",
    "Set the difficulty, game mode and whitelist before it ever starts.",
    "Hit create, and Isopod sets the whole thing up for you in Docker.",
    "Every mod in the pack shows up here. Turn them on or off, or check for updates.",
    "The live console is right there, so you can run commands without opening the game.",
    "Stuck? The question mark on every screen opens the docs for it.",
    "Backups run on a schedule, or whenever you click the button.",
    "You can dig through the server's files without touching a terminal,",
    "switch between Fabric, Forge, NeoForge and Paper,",
    "and when a new Minecraft version drops, it's a couple of clicks.",
    "Isopod updates the loader and turns off any mods that won't work yet.",
    "Then it restarts on the new version, and your friends can jump right back in.",
    "Defaults for new servers, updates and accounts all live in settings.",
    "Isopod is free and open source. Grab it on GitHub.",
]
VOICE = os.environ.get("VOICE", "af_heart")
VOICE_LEAD = 0.3   # seconds into a clip before its line starts
VOICE_TAIL = 0.45  # breathing room after a line before the next clip's crossfade


def font(name, size):
    return ImageFont.truetype(str(FONT_DIR / name), size)


def wrap(draw, text, fnt, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def caption_png(text, path):
    if PORTRAIT:
        return caption_png_portrait(text, path)
    """Bottom-left caption card on a transparent full frame."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fnt = font("seguisb.ttf", 42)
    lines = wrap(d, text, fnt, 440)
    line_h = 56
    pad = 30
    box_w = int(max(d.textlength(l, font=fnt) for l in lines)) + pad * 2 + 10
    box_h = line_h * len(lines) + pad * 2 - 8
    x0, y1 = 56, H - 64
    y0 = y1 - box_h
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x0, y0 + 8, x0 + box_w, y1 + 8], 18, fill=(0, 0, 0, 140))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x0, y0, x0 + box_w, y1], 18, fill=(22, 22, 26, 235), outline=(255, 255, 255, 28), width=2)
    d.rounded_rectangle([x0, y0, x0 + 8, y1], 4, fill=ACCENT + (255,))
    for i, l in enumerate(lines):
        d.text((x0 + pad + 10, y0 + pad - 6 + i * line_h), l, font=fnt, fill=(240, 240, 242, 255))
    img.save(path)


def caption_png_portrait(text, path):
    """Centred caption under the app square."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fnt = font("seguisb.ttf", 58)
    lines = wrap(d, text, fnt, 940)
    for i, l in enumerate(lines):
        x = (W - d.textlength(l, font=fnt)) / 2
        d.text((x, P_CAPTION_Y + i * 76), l, font=fnt, fill=(242, 242, 245, 255))
    img.save(path)


def portrait_bg(path):
    """Static backdrop: logo and name in the header band."""
    img = Image.new("RGB", (W, H), (20, 20, 23))
    logo = Image.open(ROOT / "assets" / "logo.png").convert("RGBA").resize((110, 110), Image.LANCZOS)
    d = ImageDraw.Draw(img)
    fnt = font("seguibl.ttf", 76)
    tw = d.textlength("Isopod", font=fnt)
    x = (W - (110 + 24 + tw)) / 2
    img.paste(logo, (int(x), 120), logo)
    d.text((x + 134, 118), "Isopod", font=fnt, fill=(245, 245, 247))
    d.line([(0, P_VIDEO_Y - 1), (W, P_VIDEO_Y - 1)], fill=(44, 44, 50), width=2)
    d.line([(0, P_VIDEO_Y + P_VIDEO), (W, P_VIDEO_Y + P_VIDEO)], fill=(44, 44, 50), width=2)
    img.save(path)


def card_png(path, title, sub, small):
    if PORTRAIT:
        return card_png_portrait(path, title, sub, small)
    img = Image.new("RGB", (W, H), (24, 24, 27))
    # faint vignette glow behind the logo
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W / 2 - 520, 220, W / 2 + 520, 980], fill=(30, 52, 78))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(160)), 0.55)
    logo = Image.open(ROOT / "assets" / "logo.png").convert("RGBA").resize((300, 300), Image.LANCZOS)
    img.paste(logo, ((W - 300) // 2, 300), logo)
    d = ImageDraw.Draw(img)

    def centered(y, text, fnt, fill):
        d.text(((W - d.textlength(text, font=fnt)) / 2, y), text, font=fnt, fill=fill)

    centered(650, title, font("seguibl.ttf", 130), (245, 245, 247))
    centered(830, sub, font("segoeui.ttf", 54), (190, 190, 198))
    if small:
        centered(930, small, font("seguisb.ttf", 44), ACCENT)
    img.save(path)


def card_png_portrait(path, title, sub, small):
    img = Image.new("RGB", (W, H), (24, 24, 27))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W / 2 - 460, 360, W / 2 + 460, 1120], fill=(30, 52, 78))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(160)), 0.55)
    logo = Image.open(ROOT / "assets" / "logo.png").convert("RGBA").resize((300, 300), Image.LANCZOS)
    img.paste(logo, ((W - 300) // 2, 480), logo)
    d = ImageDraw.Draw(img)

    def centered(y, text, fnt, fill):
        d.text(((W - d.textlength(text, font=fnt)) / 2, y), text, font=fnt, fill=fill)

    centered(820, title, font("seguibl.ttf", 130), (245, 245, 247))
    sub_font = font("segoeui.ttf", 52)
    y = 1000
    for line in wrap(d, sub, sub_font, 900):
        centered(y, line, sub_font, (190, 190, 198))
        y += 68
    if small:
        centered(y + 40, small, font("seguisb.ttf", 42), ACCENT)
    img.save(path)


def run(args):
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def render_segment(src, i, seg, min_dur=0.0):
    start, end, crop, speed, text, blurs = seg
    if PORTRAIT:
        crop = PORTRAIT_OVERRIDE.get(i, PORTRAIT_CROP[crop])
    cx, cy, cw, ch = crop
    cap = WORK / f"cap{i:02d}.png"
    caption_png(text, cap)
    span = end - start
    # Make room for the voice line: slow toward 1x first, then hold the last frame.
    if span / speed < min_dur:
        speed = max(1.0, span / min_dur)
    hold = max(0.0, min_dur - span / speed)
    dur = span / speed + hold
    out = WORK / f"seg{i:02d}.mp4"

    chain = []
    last = "[0:v]"
    if blurs:
        chain.append(f"{last}split={len(blurs) + 1}[base]" + "".join(f"[b{k}]" for k in range(len(blurs))))
        last = "[base]"
        for k, (bx, by, bw, bh) in enumerate(blurs):
            chain.append(f"[b{k}]crop={bw}:{bh}:{bx}:{by},boxblur=luma_radius=14:luma_power=3[bb{k}]")
            chain.append(f"{last}[bb{k}]overlay={bx}:{by}[o{k}]")
            last = f"[o{k}]"
    pad = f",tpad=stop_mode=clone:stop_duration={hold:.3f}" if hold > 0 else ""
    size = f"{P_VIDEO}:{P_VIDEO}" if PORTRAIT else f"{W}:{H}"
    chain.append(
        f"{last}crop={cw}:{ch}:{cx}:{cy},scale={size}:flags=lanczos,"
        f"setpts=(PTS-STARTPTS)/{speed:.4f},fps={FPS}{pad},format=yuv420p[{'app' if PORTRAIT else 'v'}]"
    )
    if PORTRAIT:
        chain.append(f"[2:v][app]overlay=0:{P_VIDEO_Y}:shortest=1[v]")
    fade_out = max(dur - 0.55, 0.6)
    chain.append(
        f"[1:v]format=rgba,fade=in:st=0.35:d=0.35:alpha=1,fade=out:st={fade_out:.2f}:d=0.3:alpha=1[c]"
    )
    chain.append("[v][c]overlay=0:0:shortest=1,format=yuv420p[out]")
    run([
        "-ss", f"{start}", "-t", f"{span}", "-i", str(src),
        "-loop", "1", "-framerate", str(FPS), "-t", f"{dur:.3f}", "-i", str(cap),
        *(["-loop", "1", "-framerate", str(FPS), "-t", f"{dur:.3f}", "-i", str(WORK / "bg.png")] if PORTRAIT else []),
        "-filter_complex", ";".join(chain), "-map", "[out]", "-an",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-r", str(FPS), str(out),
    ])
    return out, dur


def render_card(png, dur, out):
    run([
        "-loop", "1", "-framerate", str(FPS), "-t", f"{dur:.3f}", "-i", str(png),
        "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "16",
        "-r", str(FPS), str(out),
    ])
    return out, dur


def voice_lines():
    """Synthesize each narration line with Kokoro (local, free). Returns [(samples, sr)]."""
    import hashlib
    import soundfile as sf
    cache = VOICE_CACHE
    cache.mkdir(parents=True, exist_ok=True)
    tts = None
    lines = []
    for text in NARRATION:
        key = hashlib.sha1(f"{VOICE}|{text}".encode()).hexdigest()[:12]
        wav = cache / f"{key}.wav"
        if not wav.exists():
            if tts is None:
                from kokoro_onnx import Kokoro
                tts = Kokoro(str(HERE / "models" / "kokoro-v1.0.onnx"), str(HERE / "models" / "voices-v1.0.bin"))
            samples, sr = tts.create(text, voice=VOICE, speed=1.0, lang="en-us")
            sf.write(wav, samples, sr)
        samples, sr = sf.read(wav, dtype="float32")
        # trim leading/trailing silence so timing is predictable
        loud = np.flatnonzero(np.abs(samples) > 0.01)
        if len(loud):
            samples = samples[max(loud[0] - int(0.03 * sr), 0): loud[-1] + int(0.08 * sr)]
        lines.append((samples, sr))
    return lines


def soundtrack(duration, starts, lines, path):
    sys.path.insert(0, str(HERE))
    from audio import SR, music
    from scipy.signal import resample_poly
    n = int(duration * SR)
    voice = np.zeros(n)
    for at, (samples, sr) in zip(starts, lines):
        x = resample_poly(samples, SR, sr) if sr != SR else samples
        i = int((at + VOICE_LEAD) * SR)
        voice[i: i + len(x)] += x[: n - i]
    if lines:
        voice = voice / (np.max(np.abs(voice)) + 1e-9) * 10 ** (-2 / 20)

    mus = music(duration, end_at=duration - 4.0)
    # Duck the music under the voice: a smoothed envelope of where the voice is talking.
    active = (np.abs(voice) > 0.02).astype(float)
    win = int(0.35 * SR)
    active = np.convolve(active, np.ones(win) / win, mode="same")
    duck = 1.0 - 0.6 * np.clip(active * 4, 0, 1)
    bed = 10 ** (-13 / 20) if lines else 10 ** (-12 / 20)
    mix = voice + mus * bed * duck
    mix = mix / max(np.max(np.abs(mix)), 1.0) * 10 ** (-1 / 20)
    stereo = np.stack([mix, mix], axis=1)
    wavfile.write(path, SR, (stereo * 32767).astype(np.int16))


def main():
    src = Path(sys.argv[1])
    dest = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_name(src.stem + " (edited).mp4")
    WORK.mkdir(parents=True, exist_ok=True)
    if PORTRAIT:
        portrait_bg(WORK / "bg.png")

    narrate = os.environ.get("NARRATE", "1") != "0"
    lines = voice_lines() if narrate else []
    assert not lines or len(lines) == len(SEGMENTS) + 2, "one narration line per clip"

    def need(k, base):
        if not lines:
            return base
        samples, sr = lines[k]
        return max(base, VOICE_LEAD + len(samples) / sr + VOICE_TAIL + XFADE)

    clips = []
    card_png(WORK / "title.png", "Isopod", "Self-hosted Minecraft servers, managed like Prism instances.", None)
    clips.append(render_card(WORK / "title.png", need(0, 3.2), WORK / "title.mp4"))
    for i, seg in enumerate(SEGMENTS):
        print(f"segment {i + 1}/{len(SEGMENTS)}: {seg[4]}")
        clips.append(render_segment(src, i, seg, need(i + 1, 0.0)))
    card_png(WORK / "end.png", "Isopod", "Free and open source. Runs on Docker.", "github.com/Isopod-Project/Isopod")
    clips.append(render_card(WORK / "end.png", need(len(SEGMENTS) + 1, 4.5) + 1.5, WORK / "end.mp4"))

    # Chain crossfades; each xfade starts XFADE seconds before the running end.
    inputs, parts, starts = [], [], [0.0]
    for path, _ in clips:
        inputs += ["-i", str(path)]
    last = "[0:v]"
    total = clips[0][1]
    for k in range(1, len(clips)):
        offset = total - XFADE
        starts.append(offset)
        parts.append(f"{last}[{k}:v]xfade=transition=fade:duration={XFADE}:offset={offset:.3f}[x{k}]")
        last = f"[x{k}]"
        total = offset + clips[k][1]
    parts.append(f"{last}fade=in:st=0:d=0.5,fade=out:st={total - 0.8:.3f}:d=0.8[vout]")

    audio_path = WORK / "mix.wav"
    soundtrack(total, starts, lines, audio_path)
    inputs += ["-i", str(audio_path)]
    run([
        *inputs, "-filter_complex", ";".join(parts),
        "-map", "[vout]", "-map", f"{len(clips)}:a",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(dest),
    ])
    print(f"{dest}  ({total:.1f}s)")


if __name__ == "__main__":
    main()
