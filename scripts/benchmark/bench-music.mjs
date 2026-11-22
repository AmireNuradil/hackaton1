import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// Measures the app's own analyser on songs with known tempo and key, through the same 40 s window
// the browser uses. Usage: python3 scripts/benchmark/make-songs.py <dir> && node scripts/benchmark/bench-music.mjs <dir>
import { measureMusic } from '../../src/music.js';
const dir = process.argv[2];
const truth = JSON.parse(readFileSync(`${dir}/truth.json`));
const rate = 22050;
let tempoOk = 0, tempoOctave = 0, keyOk = 0, modeOk = 0, n = 0;
for (const t of truth) {
  const file = `${dir}/${t.file}`;
  const duration = Number(execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
  const seconds = Math.min(duration, 40);
  const start = duration > 50 ? Math.min(20, duration * 0.25) : 0;
  const raw = execFileSync('ffmpeg', ['-v', 'quiet', '-ss', String(start), '-t', String(seconds), '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const t0 = performance.now();
  const r = measureMusic(new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), rate);
  const ms = performance.now() - t0;
  n++;
  let tempo = '—';
  if (!t.beat) tempo = r.bpm == null ? 'ok (no beat)' : `FALSE BEAT ${r.bpm}`;
  else if (r.bpm == null) tempo = 'MISSED';
  else {
    const ratio = r.bpm / t.bpm;
    if (Math.abs(ratio - 1) < 0.04 || (t.alt ?? []).some((b) => Math.abs(r.bpm / b - 1) < 0.04)) { tempo = 'ok'; tempoOk++; }
    else if ([0.5, 2, 2 / 3, 1.5].some((x) => Math.abs(ratio - x) < 0.04)) { tempo = `octave ×${ratio.toFixed(2)}`; tempoOctave++; }
    else tempo = 'WRONG';
  }
  if (!t.beat && r.bpm == null) tempoOk++;
  if (r.key === t.key.replace('Bb', 'B♭').replace('Eb', 'E♭')) keyOk++;
  if (r.mode === t.mode) modeOk++;
  console.log(`${t.file.padEnd(32)} bpm ${String(t.bpm).padStart(3)} → ${String(r.bpm).padStart(4)} ${tempo.padEnd(14)} key ${t.key.padEnd(9)} → ${String(r.key).padEnd(9)} (conf ${r.keyConfidence}) energy ${r.energy} ${ms.toFixed(0)}ms`);
}
console.log(`\ntempo right (incl. accepted felt tempo) ${tempoOk}/${n}, other octave errors ${tempoOctave}; key exact ${keyOk}/${n}; mode ${modeOk}/${n}`);
