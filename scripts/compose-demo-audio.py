"""Compose the six demo scores in public/samples as MIDI and render them with real instrument samples.

Needs Python 3 with mido, the fluidsynth CLI with the FluidR3 General MIDI soundfont (Debian/Ubuntu:
apt install fluidsynth fluid-soundfont-gm) and FFmpeg. Melodies come from a fixed seed, so every run
writes the same music. Usage: python3 scripts/compose-demo-audio.py
"""
import random
import subprocess
import tempfile
from pathlib import Path

import mido

ROOT = Path(__file__).resolve().parents[1] / "public" / "samples"
SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
TPB = 480
NOTE = {"C": 60, "D": 62, "E": 64, "F": 65, "G": 67, "A": 69, "B": 71}
SCALES = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10]}
KICK, SNARE, CLAP, HAT, OHAT, RIDE, SHAKER, BRUSH = 36, 38, 39, 42, 46, 51, 70, 40


class Score:
    def __init__(self, bpm, root, mode):
        self.bpm, self.root, self.mode, self.events = bpm, NOTE[root], mode, []
        self.scale = SCALES[mode]

    def program(self, channel, program, volume=100, reverb=60):
        self.events += [(0, mido.Message("program_change", channel=channel, program=program)),
                        (0, mido.Message("control_change", channel=channel, control=7, value=volume)),
                        (0, mido.Message("control_change", channel=channel, control=91, value=reverb))]

    def note(self, channel, pitch, start, length, velocity=80):
        on, off = int(start * TPB), int((start + length) * TPB)
        self.events += [(on, mido.Message("note_on", channel=channel, note=pitch, velocity=max(1, min(127, velocity)))),
                        (off, mido.Message("note_off", channel=channel, note=pitch, velocity=0))]

    def chord(self, degree, octave=0, size=3):
        steps = [0, 2, 4, 6][:size]
        return [self.root + 12 * octave + self.scale[(degree + s) % 7] + 12 * ((degree + s) // 7) for s in steps]

    def minor_chord(self, degree, octave=0, size=3):
        """Chords of harmonic minor: the V chord is major (raised 7th), which is what makes a minor key sound minor."""
        notes = self.chord(degree, octave, size)
        leading = (self.root + 10) % 12
        return [n + 1 if self.mode == "minor" and degree % 7 == 4 and n % 12 == leading else n for n in notes]

    def degree_pitch(self, degree, octave=0):
        return self.root + 12 * (octave + degree // 7) + self.scale[degree % 7]

    def render(self, name, seconds_hint):
        mid = mido.MidiFile(ticks_per_beat=TPB)
        track = mido.MidiTrack()
        mid.tracks.append(track)
        track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(self.bpm), time=0))
        ordered = sorted(self.events, key=lambda e: (e[0], 0 if e[1].type != "note_on" else 1))
        last = 0
        for tick, message in ordered:
            track.append(message.copy(time=tick - last))
            last = tick
        with tempfile.TemporaryDirectory() as tmp:
            midi_path, wav = Path(tmp) / f"{name}.mid", Path(tmp) / f"{name}.wav"
            mid.save(midi_path)
            subprocess.run(["fluidsynth", "-ni", "-g", "0.8", "-r", "44100", "-F", str(wav), SF2, str(midi_path)], check=True, capture_output=True)
            # Gentle fade-in, trim to the arrangement, fade out so the loop restarts softly.
            fade = max(1.0, seconds_hint - 2.5)
            subprocess.run(["ffmpeg", "-v", "quiet", "-y", "-i", str(wav), "-t", str(seconds_hint),
                            "-af", f"afade=t=in:d=0.6,afade=t=out:st={fade}:d=2.5,loudnorm=I=-18:TP=-1.5",
                            "-ar", "44100", "-b:a", "128k", str(ROOT / f"{name}.mp3")], check=True)


def melody(score, channel, degrees, bars, start, rng, octave=1, rhythm=(1, 1, 1, 1), velocity=72, rest=0.15):
    """A singable line: chord tones on strong beats, steps in between, an occasional rest."""
    t = start
    previous = 2
    for bar in range(bars):
        tones = [d - score.root for d in score.chord(degrees[bar % len(degrees)])]
        targets = [score.scale.index(x % 12) if x % 12 in score.scale else 0 for x in tones]
        position = 0
        for i, length in enumerate(rhythm):
            if rng.random() < rest and i:
                position += length
                continue
            if i == 0:
                step = min(targets, key=lambda d: abs(d - previous % 7)) + 7 * (previous // 7)
            else:
                step = previous + rng.choice([-1, 1, 1, -2, 2])
            step = max(0, min(11, step))
            score.note(channel, score.degree_pitch(step, octave), t + position, length * 0.95, velocity + rng.randint(-8, 6))
            previous = step
            position += length
        t += sum(rhythm)


def coast():
    """«Берег»: a warm evening by the sea. Nylon guitar, strings, a slow piano line. 72 BPM, F major."""
    s, rng = Score(72, "F", "major"), random.Random(11)
    s.program(0, 24, 100, 70)
    s.program(1, 48, 70, 90)
    s.program(2, 0, 85, 80)
    degrees = [0, 5, 3, 4] * 5
    for bar, d in enumerate(degrees):
        tones = s.chord(d, -1)
        # Fingerpicked on the beat: bass with the first note, then three chord tones, one per beat.
        s.note(0, tones[0] - 12, bar * 4, 3.8, 78)
        for i, pitch in enumerate([tones[2], tones[1] + 12, tones[2] + 12, tones[1] + 12]):
            s.note(0, pitch, bar * 4 + i, 1.6, 66 if i else 72)
        s.note(0, tones[0] + 12, bar * 4 + 3.5, 0.5, 50)
        for pitch in s.chord(d, 0):
            s.note(1, pitch, bar * 4, 4, 44)
    melody(s, 2, degrees, 16, 16, rng, octave=1, rhythm=(1.5, 0.5, 2), velocity=60, rest=0.2)
    s.render("coast", 68)


def city():
    """«Сигналы»: a night at the office before a deadline. Electronic pulse in D minor, 132 BPM."""
    s, rng = Score(132, "D", "minor"), random.Random(23)
    s.program(0, 38, 110, 30)
    s.program(1, 81, 80, 60)
    s.program(2, 89, 70, 90)
    degrees = [0, 5, 3, 4] * 9  # i – VI – iv – V: the dominant gets its raised leading tone below
    for bar, d in enumerate(degrees):
        b0 = bar * 4
        bass = s.chord(d, -2)[0]
        for i in range(16):
            s.note(0, bass + (12 if i % 4 == 3 else 0), b0 + i * 0.25, 0.2, 92 if i % 4 == 0 else 70)
        for pitch in s.minor_chord(d, 0, 4):
            s.note(2, pitch, b0, 4, 40)
        for beat in range(4):
            s.note(9, KICK, b0 + beat, 0.2, 112)
            s.note(9, OHAT, b0 + beat + 0.5, 0.2, 64)
            s.note(9, HAT, b0 + beat + 0.25, 0.1, 36)
            s.note(9, HAT, b0 + beat + 0.75, 0.1, 36)
        s.note(9, CLAP, b0 + 1, 0.2, 86)
        s.note(9, CLAP, b0 + 3, 0.2, 86)
        if bar >= 8:
            arp = s.minor_chord(d, 1)
            for i in range(8):
                s.note(1, arp[(i * 2 + bar) % 3] + (12 if i % 4 == 3 else 0), b0 + i * 0.5, 0.3, 66)
    s.render("city", 64)


def morning():
    """«Окно»: morning in the kitchen. Piano, celesta and soft strings, 60 BPM, C major."""
    s, rng = Score(60, "C", "major"), random.Random(5)
    s.program(0, 0, 95, 80)
    s.program(1, 8, 70, 90)
    s.program(2, 49, 60, 100)
    degrees = [0, 3, 5, 4] * 4
    for bar, d in enumerate(degrees):
        tones = s.chord(d, -1)
        for i, pitch in enumerate([tones[0] - 12, tones[1], tones[2], tones[1] + 12]):
            s.note(0, pitch, bar * 4 + i, 1.8, 56)
        for pitch in s.chord(d, 0):
            s.note(2, pitch, bar * 4, 4, 36)
    melody(s, 1, degrees, 12, 8, rng, octave=1, rhythm=(1, 1, 2), velocity=58, rest=0.25)
    s.render("morning", 64)


def forest():
    """«Туман»: a quiet ride through the rain. Electric piano over a pad, 66 BPM, A minor."""
    s, rng = Score(66, "A", "minor"), random.Random(17)
    s.program(0, 4, 95, 90)
    s.program(1, 89, 65, 110)
    s.program(2, 11, 55, 110)
    degrees = [0, 5, 3, 4] * 4
    for bar, d in enumerate(degrees):
        tones = s.chord(d, -1, 4)
        for i, pitch in enumerate(tones):
            s.note(0, pitch, bar * 4 + i * 0.5, 3.4 - i * 0.5, 52)
        s.note(0, tones[0] - 12, bar * 4, 4, 48)
        for pitch in s.chord(d, 0):
            s.note(1, pitch, bar * 4, 4, 40)
        s.note(9, SHAKER, bar * 4 + 1, 0.1, 22)
        s.note(9, SHAKER, bar * 4 + 3, 0.1, 22)
    melody(s, 2, degrees, 12, 8, rng, octave=1, rhythm=(2, 1, 1), velocity=50, rest=0.3)
    s.render("forest", 60)


def tide():
    """«Прилив»: a bright day on the beach. Strummed guitar, flute, light drums, 118 BPM, G major."""
    s, rng = Score(118, "G", "major"), random.Random(31)
    s.program(0, 25, 90, 60)
    s.program(1, 33, 100, 30)
    s.program(2, 73, 80, 70)
    degrees = [0, 4, 5, 3] * 8
    strum = [0, 0.75, 1.5, 2, 2.75, 3.5]
    for bar, d in enumerate(degrees):
        b0 = bar * 4
        for k, p in enumerate(strum):
            for j, pitch in enumerate(s.chord(d, -1) + [s.chord(d, 0)[0]]):
                s.note(0, pitch, b0 + p + j * 0.02, 0.6, (72 if k % 2 == 0 else 58) - j * 3)
        root = s.chord(d, -2)[0]
        for p in (0, 1.5, 2, 3):
            s.note(1, root + (7 if p == 3 else 0), b0 + p, 0.5, 88)
        for beat in range(4):
            s.note(9, KICK if beat % 2 == 0 else CLAP, b0 + beat, 0.2, 92 if beat % 2 == 0 else 78)
            s.note(9, SHAKER, b0 + beat + 0.5, 0.1, 60)
    melody(s, 2, degrees, 24, 8 * 4, rng, octave=1, rhythm=(0.5, 0.5, 1, 0.5, 0.5, 1), velocity=70, rest=0.12)
    s.render("tide", 64)


def train():
    """«Перрон»: a farewell on a night platform, in the manner of a late-70s ballad. 98 BPM, C minor."""
    s, rng = Score(98, "C", "minor"), random.Random(79)
    s.program(0, 4, 95, 80)
    s.program(1, 48, 70, 100)
    s.program(2, 33, 95, 40)
    s.program(3, 65, 70, 90)
    degrees = [0, 5, 3, 4] * 7  # i – VI – iv – V, the classic minor-ballad turn
    for bar, d in enumerate(degrees):
        b0 = bar * 4
        for p in (0, 1.5, 2, 3):
            for pitch in s.minor_chord(d, -1, 4):
                s.note(0, pitch, b0 + p, 0.9, 58)
        for pitch in s.minor_chord(d, 0):
            s.note(1, pitch, b0, 4, 38)
        root = s.chord(d, -2)[0]
        for p in (0, 2, 2.5):
            s.note(2, root, b0 + p, 0.9, 86)
        for beat in range(4):
            s.note(9, KICK if beat in (0, 2) else BRUSH, b0 + beat, 0.2, 84 if beat in (0, 2) else 70)
            s.note(9, HAT, b0 + beat + 0.5, 0.1, 40)
    melody(s, 3, degrees, 20, 8 * 4, rng, octave=0, rhythm=(1, 0.5, 0.5, 2), velocity=66, rest=0.18)
    s.render("train", 66)


if __name__ == "__main__":
    for compose in (coast, city, morning, forest, tide, train):
        compose()
        print(f"{compose.__name__}.mp3")
