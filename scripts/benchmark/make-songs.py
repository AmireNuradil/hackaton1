"""Compose 12 test songs with known tempo, key and metre as MIDI and render them with the FluidR3 GM soundfont.

Needs Python 3, mido, fluidsynth and fluid-soundfont-gm (apt) and FFmpeg. Usage: python3 make-songs.py <dir>
"""
import json, random, subprocess, sys
from pathlib import Path
import mido

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
SF2 = '/usr/share/sounds/sf2/FluidR3_GM.sf2'
TPB = 480
NOTE = {'C': 60, 'C#': 61, 'Db': 61, 'D': 62, 'Eb': 63, 'E': 64, 'F': 65, 'F#': 66, 'G': 67, 'Ab': 68, 'A': 69, 'Bb': 70, 'B': 71}
MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]

def triad(root, mode, degree, seventh=False):
    scale = MAJOR if mode == 'major' else MINOR
    steps = [0, 2, 4, 6] if seventh else [0, 2, 4]
    return [root + scale[(degree + s) % 7] + 12 * ((degree + s) // 7) for s in steps]

class Song:
    def __init__(self, bpm, beats_per_bar=4):
        self.bpm, self.bpb, self.events = bpm, beats_per_bar, []
    def note(self, ch, pitch, start_beats, dur_beats, vel=80):
        s = int(start_beats * TPB); e = int((start_beats + dur_beats) * TPB)
        self.events += [(s, mido.Message('note_on', channel=ch, note=pitch, velocity=vel)), (e, mido.Message('note_off', channel=ch, note=pitch, velocity=0))]
    def program(self, ch, prog):
        self.events.append((0, mido.Message('program_change', channel=ch, program=prog)))
    def save(self, path, tempo_changes=None):
        mid = mido.MidiFile(ticks_per_beat=TPB)
        track = mido.MidiTrack(); mid.tracks.append(track)
        track.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(self.bpm), time=0))
        track.append(mido.MetaMessage('time_signature', numerator=self.bpb, denominator=4, time=0))
        events = list(self.events)
        for beat, bpm in (tempo_changes or []):
            events.append((int(beat * TPB), mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(bpm))))
        events.sort(key=lambda e: (e[0], 0 if e[1].type in ('program_change', 'set_tempo', 'note_off') else 1))
        last = 0
        for t, msg in events:
            track.append(msg.copy(time=t - last)); last = t
        mid.save(path)

def drums(song, bars, pattern, start=0, swing=0.0, vel=1.0):
    for bar in range(bars):
        for kind, positions, note, v in pattern:
            for p in positions:
                off = swing if (p % 1) == 0.5 else 0
                song.note(9, note, start + bar * song.bpb + p + off, 0.25, int(v * vel))

def progression(song, ch, root, mode, degrees, bars_each, start, octave=0, style='block', vel=70, seventh=False, swing=0.0):
    t = start
    for d in degrees:
        chord = [n + 12 * octave for n in triad(root, mode, d, seventh)]
        for bar in range(bars_each):
            b0 = t + bar * song.bpb
            if style == 'block':
                for n in chord: song.note(ch, n, b0, song.bpb - 0.05, vel)
            elif style == 'pulse':
                for beat in range(song.bpb):
                    for n in chord: song.note(ch, n, b0 + beat, 0.45, vel)
            elif style == 'arp':
                seq = chord + [chord[1] + 12, chord[2] + 12, chord[1] + 12]
                for i in range(song.bpb * 2):
                    song.note(ch, seq[i % len(seq)], b0 + i * 0.5 + (swing if i % 2 else 0), 0.5, vel)
            elif style == 'waltz':
                song.note(ch, chord[0] - 12, b0, 0.9, vel + 10)
                for beat in (1, 2):
                    for n in chord[1:]: song.note(ch, n, b0 + beat, 0.8, vel - 10)
            elif style == 'comp':
                for p in (0, 1.5 + swing, 2.5 + swing):
                    for n in chord: song.note(ch, n, b0 + p, 0.4, vel)
        t += bars_each * song.bpb

def bassline(song, ch, root, mode, degrees, bars_each, start, style='root', vel=90, swing=0.0):
    t = start
    for d in degrees:
        r = triad(root, mode, d)[0] - 24
        for bar in range(bars_each):
            b0 = t + bar * song.bpb
            if style == 'root':
                for beat in range(song.bpb): song.note(ch, r, b0 + beat, 0.9, vel)
            elif style == 'eighths':
                for i in range(song.bpb * 2): song.note(ch, r + (12 if i % 4 == 3 else 0), b0 + i * 0.5, 0.45, vel)
            elif style == 'walk':
                scale = MAJOR if mode == 'major' else MINOR
                for beat in range(song.bpb): song.note(ch, r + [0, scale[2], scale[4], scale[5]][beat % 4], b0 + beat, 0.95, vel)
            elif style == 'long':
                song.note(ch, r, b0, song.bpb, vel)
        t += bars_each * song.bpb

KICK, SNARE, HAT, OHAT, RIDE, CLAP, CRASH = 36, 38, 42, 46, 51, 39, 49
specs = []

def make(name, bpm, key, mode, meter, genre, build, fmt='mp3', expect_beat=True, tempo_changes=None, notes='', alt=()):
    song = Song(bpm, meter)
    build(song, NOTE[key], mode)
    mid = OUT / f'{name}.mid'
    song.save(mid, tempo_changes)
    wav = OUT / f'{name}.wav'
    subprocess.run(['fluidsynth', '-ni', '-g', '0.9', '-r', '44100', '-F', str(wav), SF2, str(mid)], check=True, capture_output=True)
    final = OUT / f'{name}.{fmt}'
    if fmt != 'wav':
        args = {'mp3': ['-b:a', '192k'], 'ogg': ['-c:a', 'libvorbis', '-q:a', '5'], 'm4a': ['-c:a', 'aac', '-b:a', '160k'], 'flac': []}[fmt]
        subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-i', str(wav), *args, str(final)], check=True)
        wav.unlink()
    mid.unlink()
    specs.append({'file': final.name, 'bpm': bpm, 'key': f'{key} {"мажор" if mode == "major" else "минор"}', 'mode': mode, 'meter': meter, 'genre': genre, 'beat': expect_beat, 'notes': notes, 'alt': list(alt)})

def ballad(s, root, mode):
    s.program(0, 0); s.program(1, 48)
    degs = [0, 5, 3, 4] * 4
    progression(s, 0, root, mode, degs, 1, 0, octave=0, style='arp', vel=62)
    progression(s, 1, root, mode, degs, 1, 0, octave=-1, style='block', vel=45)
make('ballad-piano-68-Amin', 68, 'A', 'minor', 4, 'classical', ballad, notes='piano arpeggios + strings, no drums')

def pop(s, root, mode):
    s.program(0, 0); s.program(1, 33); s.program(2, 25)
    degs = [0, 4, 5, 3] * 5
    progression(s, 0, root, mode, degs, 1, 0, style='pulse', vel=60)
    progression(s, 2, root, mode, degs, 1, 0, octave=-1, style='arp', vel=55)
    bassline(s, 1, root, mode, degs, 1, 0, style='eighths', vel=85)
    drums(s, 20, [('k', [0, 2, 2.5], KICK, 100), ('s', [1, 3], SNARE, 95), ('h', [i * 0.5 for i in range(8)], HAT, 60)])
make('pop-120-Gmaj', 120, 'G', 'major', 4, 'pop', pop)

def house(s, root, mode):
    s.program(0, 81); s.program(1, 38); s.program(2, 89)
    degs = [0, 5, 2, 6] * 8
    progression(s, 2, root, mode, degs, 1, 0, style='block', vel=50)
    bassline(s, 1, root, mode, degs, 1, 0, style='eighths', vel=95)
    for bar in range(32):
        if bar % 2: 
            for i, n in enumerate(triad(root, mode, degs[bar])): s.note(0, n + 12, bar * 4 + 0.5 + i, 0.4, 70)
    drums(s, 32, [('k', [0, 1, 2, 3], KICK, 115), ('c', [1, 3], CLAP, 80), ('o', [0.5, 1.5, 2.5, 3.5], OHAT, 70)])
make('house-128-Fmin', 128, 'F', 'minor', 4, 'electronic', house, fmt='m4a')

def swing(s, root, mode):
    s.program(0, 0); s.program(1, 32)
    degs = [1, 4, 0, 0] * 8
    progression(s, 0, root, mode, degs, 1, 0, style='comp', vel=60, seventh=True, swing=0.17)
    bassline(s, 1, root, mode, degs, 1, 0, style='walk', vel=90)
    drums(s, 32, [('r', [0, 1, 1.5, 2, 3, 3.5], RIDE, 70), ('h', [1, 3], HAT, 60)], swing=0.17)
make('jazz-swing-160-Bbmaj', 160, 'Bb', 'major', 4, 'jazz', swing, notes='swung 8ths, walking bass; 80 is an acceptable felt tempo', alt=(80,))

def waltz(s, root, mode):
    s.program(0, 0); s.program(1, 48)
    degs = [0, 3, 4, 0] * 6
    progression(s, 0, root, mode, degs, 1, 0, style='waltz', vel=70)
    progression(s, 1, root, mode, degs, 1, 0, octave=1, style='block', vel=40)
make('waltz-90-Dmaj-3-4', 90, 'D', 'major', 3, 'classical', waltz, fmt='ogg', notes='3/4 time')

def rock(s, root, mode):
    s.program(0, 30); s.program(1, 33)
    degs = [0, 5, 3, 6] * 6
    t = 0
    for d in degs:
        r = triad(root, mode, d)[0] - 12
        for i in range(8):
            for n in (r, r + 7, r + 12): s.note(0, n, t + i * 0.5, 0.45, 95)
        t += 4
    bassline(s, 1, root, mode, degs, 1, 0, style='eighths', vel=95)
    drums(s, 24, [('k', [0, 1.5, 2], KICK, 115), ('s', [1, 3], SNARE, 110), ('h', [i * 0.5 for i in range(8)], HAT, 75)])
    for bar in range(0, 24, 4): s.note(9, CRASH, bar * 4, 1, 100)
make('rock-140-Emin', 140, 'E', 'minor', 4, 'rock', rock)

def ambient(s, root, mode):
    s.program(0, 89); s.program(1, 91)
    for i, d in enumerate([0, 3, 0, 4, 5, 3]):
        for n in triad(root, mode, d): s.note(0, n, i * 8, 8.2, 55)
        s.note(1, triad(root, mode, d)[0] + 12, i * 8 + 2, 5, 40)
make('ambient-pads-noBeat-Cmaj', 60, 'C', 'major', 4, 'ambient', ambient, fmt='flac', expect_beat=False, notes='long pads, no rhythm section')

def lofi(s, root, mode):
    s.program(0, 4); s.program(1, 33)
    degs = [1, 4, 0, 5] * 6
    progression(s, 0, root, mode, degs, 1, 0, style='comp', vel=55, seventh=True, swing=0.12)
    bassline(s, 1, root, mode, degs, 1, 0, style='root', vel=80)
    drums(s, 24, [('k', [0, 1.75, 2.5], KICK, 95), ('s', [1, 3], SNARE, 85), ('h', [i * 0.5 for i in range(8)], HAT, 50)], swing=0.12)
make('lofi-85-Ebmaj', 85, 'Eb', 'major', 4, 'hiphop', lofi)

def dnb(s, root, mode):
    s.program(1, 38); s.program(2, 89)
    degs = [0, 5, 3, 4] * 12
    progression(s, 2, root, mode, degs, 1, 0, style='block', vel=45)
    bassline(s, 1, root, mode, degs, 1, 0, style='long', vel=100)
    drums(s, 48, [('k', [0, 2.5], KICK, 115), ('s', [1, 3], SNARE, 110), ('h', [i * 0.5 for i in range(8)], HAT, 60)])
make('dnb-174-Dmin', 174, 'D', 'minor', 4, 'electronic', dnb, notes='87 is an acceptable felt tempo', alt=(87,))

def folk(s, root, mode):
    s.program(0, 25); s.program(1, 73)
    degs = [0, 3, 4, 0, 5, 3, 4, 4] * 2
    progression(s, 0, root, mode, degs, 1, 0, style='arp', vel=70)
    t = 0
    for d in degs:
        mel = triad(root, mode, d)
        for i, n in enumerate([mel[2] + 12, mel[1] + 12, mel[0] + 12, mel[1] + 12]): s.note(1, n, t + i, 0.9, 55)
        t += 4
make('folk-guitar-100-Cmaj', 100, 'C', 'major', 4, 'folk', folk, fmt='wav')

def tempo_shift(s, root, mode):
    s.program(0, 0); s.program(1, 33)
    degs = [0, 4, 5, 3] * 8
    progression(s, 0, root, mode, degs, 1, 0, style='pulse', vel=60)
    bassline(s, 1, root, mode, degs, 1, 0, style='root', vel=85)
    drums(s, 32, [('k', [0, 2], KICK, 100), ('s', [1, 3], SNARE, 95), ('h', [i * 0.5 for i in range(8)], HAT, 60)])
make('shift-90to130-Amaj', 90, 'A', 'major', 4, 'pop', tempo_shift, tempo_changes=[(48, 130)], notes='90 BPM for 12 bars, then 130; either is acceptable', alt=(130,))

def long_song(s, root, mode):
    s.program(0, 0); s.program(1, 33); s.program(2, 48)
    degs = [0, 5, 3, 4] * 40
    progression(s, 0, root, mode, degs, 1, 0, style='pulse', vel=58)
    progression(s, 2, root, mode, degs, 1, 0, octave=-1, style='block', vel=40)
    bassline(s, 1, root, mode, degs, 1, 0, style='root', vel=80)
    drums(s, 160, [('k', [0, 2], KICK, 95), ('s', [1, 3], SNARE, 90), ('h', [i * 0.5 for i in range(8)], HAT, 55)])
make('long-5min-110-Fmaj', 110, 'F', 'major', 4, 'pop', long_song, notes='5:49 long; analysis must not hang')

(OUT / 'truth.json').write_text(json.dumps(specs, ensure_ascii=False, indent=1))
print(len(specs), 'songs')
