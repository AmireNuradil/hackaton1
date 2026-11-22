"""Recreate the six synthesized demo scores in public/samples with Python 3 and FFmpeg."""

import math
import shutil
import subprocess
import tempfile
import wave
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public" / "samples"
RATE = 22050
DURATION = 28
THEMES = {
    "coast": (72, (53, 57, 60, 65), 0.25),
    "city": (132, (46, 53, 56, 62), 0.77),
    "morning": (60, (60, 64, 67, 74), 0.18),
    "forest": (67, (50, 55, 57, 62), 0.25),
    "tide": (80, (55, 59, 62, 69), 0.31),
    "train": (98, (48, 51, 55, 62), 0.38),
}


def score(bpm, notes, drive):
    frequencies = [440 * 2 ** ((note - 69) / 12) for note in notes]
    samples = array("h")
    for index in range(RATE * DURATION):
        time = index / RATE
        beat = time * bpm / 60
        bar = int(beat) // 4
        fraction = beat % 1
        phase = time * math.tau
        groups = [
            math.sin(phase * frequency + offset * 0.6) * (0.8 + 0.2 * math.sin(time * (offset + 1) * 0.6))
            for offset, frequency in enumerate(frequencies)
        ]
        chord = sum(groups) / len(groups) * 0.095
        note = frequencies[(int(beat) + bar) % len(frequencies)] * (2 if drive > 0.5 else 1)
        pluck = math.sin(phase * note) * math.exp(-fraction * (4 + 7 * drive))
        kick = math.sin(math.tau * (25 * fraction + 3 * (1 - math.exp(-20 * fraction)))) * math.exp(-fraction * 16)
        envelope = min(1, time / 1.2, (DURATION - time) / 1.6)
        signal = envelope * (chord + pluck * (0.07 + 0.15 * drive) + kick * drive * 0.27)
        samples.append(int(signal * 32000))
    return samples.tobytes()


def main():
    if not shutil.which("ffmpeg"):
        raise SystemExit("FFmpeg is required to encode the demo scores.")
    with tempfile.TemporaryDirectory() as directory:
        wav = Path(directory) / "score.wav"
        for name, parameters in THEMES.items():
            with wave.open(str(wav), "wb") as stream:
                stream.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
                stream.writeframes(score(*parameters))
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-c:a", "libmp3lame", "-q:a", "6",
                            str(ROOT / f"{name}.mp3")], check=True)


if __name__ == "__main__":
    main()
