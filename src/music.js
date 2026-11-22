// Browser-free audio analysis: tempo, energy, major/minor key and spectral brightness.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const KEYS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
// Krumhansl–Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const GENRES = {
  ambient: { label: 'Эмбиент / неоклассика', energy: 0.2, warmth: 0, texture: 'air' },
  classical: { label: 'Классика', energy: 0.35, warmth: 0.2, texture: 'paint' },
  jazz: { label: 'Джаз / свинг / соул', energy: 0.45, warmth: 0.6, texture: 'grain' },
  folk: { label: 'Фолк / акустика', energy: 0.35, warmth: 0.5, texture: 'paint' },
  pop: { label: 'Поп', energy: 0.6, warmth: 0.3, texture: 'clean' },
  rock: { label: 'Рок / инди', energy: 0.75, warmth: 0, texture: 'grain' },
  hiphop: { label: 'Хип-хоп / R&B', energy: 0.65, warmth: 0.1, texture: 'clean' },
  electronic: { label: 'Электроника', energy: 0.8, warmth: -0.6, texture: 'geometry' },
};

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = -2 * Math.PI / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

function correlate(a, b) {
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function detectKey(chroma) {
  // Flat chroma (noise) or a single pitch class (a drone) carries no major/minor information.
  const mean = chroma.reduce((sum, value) => sum + value, 0) / 12;
  const sorted = [...chroma].sort((a, b) => b - a);
  if (!mean || (sorted[0] - sorted[11]) / mean < 0.35 || sorted[2] < mean * 0.9) return { key: null, mode: null, confidence: 0 };
  let best = { score: -Infinity };
  const scores = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = chroma.map((_, index) => chroma[(index + tonic) % 12]);
    for (const [mode, profile] of [['major', MAJOR], ['minor', MINOR]]) {
      const score = correlate(rotated, profile);
      scores.push(score);
      if (score > best.score) best = { tonic, mode, score };
    }
  }
  if (!Number.isFinite(best.score) || best.score <= 0) return { key: null, mode: null, confidence: 0 };
  // Confidence: how far the winner stands above the best key of the opposite mode.
  let rival = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = chroma.map((_, index) => chroma[(index + tonic) % 12]);
    rival = Math.max(rival, correlate(rotated, best.mode === 'major' ? MINOR : MAJOR));
  }
  return {
    key: `${KEYS[best.tonic]} ${best.mode === 'major' ? 'мажор' : 'минор'}`,
    mode: best.mode,
    confidence: Number(clamp((best.score - rival) * 4, 0, 1).toFixed(2)),
  };
}

function tempo(envelope, framesPerSecond) {
  const mean = envelope.reduce((sum, value) => sum + value, 0) / envelope.length;
  const centered = envelope.map((value) => Math.max(0, value - mean));
  const lagFor = (bpm) => framesPerSecond * 60 / bpm;
  const minLag = Math.floor(lagFor(180));
  const maxLag = Math.ceil(lagFor(55));
  const scores = new Map();
  let total = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < centered.length; i++) sum += centered[i] * centered[i - lag];
    scores.set(lag, sum / (centered.length - lag));
    total += sum;
  }
  if (!total) return null;
  const at = (lag) => {
    const low = Math.floor(lag);
    const fraction = lag - low;
    return (scores.get(low) ?? 0) * (1 - fraction) + (scores.get(low + 1) ?? 0) * fraction;
  };
  let bestLag = minLag;
  for (const [lag, score] of scores) {
    // Count the lag together with its double, the way a listener hears a steady pulse.
    const value = score + 0.5 * at(lag * 2);
    const bestValue = scores.get(bestLag) + 0.5 * at(bestLag * 2);
    if (value > bestValue) bestLag = lag;
  }
  // Prefer the shorter period when the beat is just as convincing there.
  const half = bestLag / 2;
  if (half >= minLag && at(half) > 0.72 * scores.get(bestLag)) bestLag = half;
  const peak = scores.get(Math.round(bestLag)) ?? at(bestLag);
  const average = [...scores.values()].reduce((sum, value) => sum + value, 0) / scores.size;
  const variance = envelope.reduce((sum, value) => sum + (value - mean) ** 2, 0) / envelope.length;
  // A beat needs a clear periodic peak (≥ 6.5× the average lag score) on an envelope that actually
  // pulses (coefficient of variation ≥ 0.8). Noise and steady drones fail one of the two.
  if (peak < average * 6.5 || Math.sqrt(variance) / mean < 0.8) return null;
  // Refine with a parabola around the peak.
  const center = Math.round(bestLag);
  const left = scores.get(center - 1) ?? peak;
  const right = scores.get(center + 1) ?? peak;
  const denom = left - 2 * peak + right;
  const offset = denom ? clamp(0.5 * (left - right) / denom, -0.5, 0.5) : 0;
  const bpm = Math.round(60 * framesPerSecond / (center + offset));
  return bpm >= 50 && bpm <= 190 ? bpm : null;
}

// Pitch-class profile from a long FFT (≈2.7 Hz bins at 22 kHz) so low chord tones land in the right semitone.
// Each semitone gets equal weight however many bins it spans; the spectrum is whitened per frame.
export function chromaOf(samples, sampleRate) {
  const size = 8192;
  const hop = 4096;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  const binHz = sampleRate / size;
  const semitones = [];
  for (let bin = 1; bin < size / 2; bin++) {
    const hz = bin * binHz;
    if (hz < 65 || hz > 2100) continue;
    const exact = 12 * Math.log2(hz / 440);
    const semitone = Math.round(exact);
    if (Math.abs(exact - semitone) > 0.35) continue;
    semitones.push([bin, semitone]);
  }
  const counts = new Map();
  for (const [, semitone] of semitones) counts.set(semitone, (counts.get(semitone) ?? 0) + 1);
  const chroma = new Array(12).fill(0);
  for (let start = 0; start + size <= samples.length; start += hop) {
    for (let i = 0; i < size; i++) { re[i] = samples[start + i] * window[i]; im[i] = 0; }
    fft(re, im);
    const energy = new Map();
    for (const [bin, semitone] of semitones) energy.set(semitone, (energy.get(semitone) ?? 0) + Math.hypot(re[bin], im[bin]) ** 2 / counts.get(semitone));
    const values = [...energy.values()];
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!total) continue;
    for (const [semitone, value] of energy) chroma[((semitone + 9) % 12 + 12) % 12] += Math.sqrt(value / total);
  }
  return chroma;
}

export function measureMusic(samples, sampleRate) {
  const hop = 512;
  const size = 2048;
  const frames = Math.floor((samples.length - size) / hop);
  if (frames < 32) return { bpm: null, energy: 0, mode: null, key: null, keyConfidence: 0, brightness: 0 };
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  let previous = new Float64Array(size / 2);
  const flux = [];
  let rmsSum = 0;
  let centroidSum = 0;
  let centroidWeight = 0;
  const binHz = sampleRate / size;
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop;
    let energy = 0;
    for (let i = 0; i < size; i++) {
      const value = samples[start + i];
      energy += value * value;
      re[i] = value * window[i];
      im[i] = 0;
    }
    rmsSum += Math.sqrt(energy / size);
    fft(re, im);
    const magnitude = new Float64Array(size / 2);
    let rise = 0;
    let weighted = 0;
    let sum = 0;
    for (let bin = 1; bin < size / 2; bin++) {
      const value = Math.log1p(10 * Math.hypot(re[bin], im[bin]));
      magnitude[bin] = value;
      rise += Math.max(0, value - previous[bin]);
      weighted += value * bin * binHz;
      sum += value;
    }
    if (sum) { centroidSum += weighted / sum * sum; centroidWeight += sum; }
    flux.push(rise);
    previous = magnitude;
  }
  const rms = rmsSum / frames;
  const onsetRate = flux.reduce((total, value) => total + value, 0) / frames;
  const loudness = clamp((20 * Math.log10(rms + 1e-9) + 40) / 30, 0, 1);
  const centroid = centroidWeight ? centroidSum / centroidWeight : 0;
  const brightness = clamp((centroid - 900) / 2600, 0, 1);
  const bpm = rms < 0.002 ? null : tempo(flux, sampleRate / hop);
  const energy = rms < 0.002 ? 0 : clamp(0.4 * loudness + 0.45 * clamp((onsetRate - 8) / 40, 0, 1) + 0.15 * brightness, 0, 1);
  const key = rms < 0.002 ? { key: null, mode: null, confidence: 0 } : detectKey(chromaOf(samples, sampleRate));
  return {
    bpm,
    energy: Number(energy.toFixed(2)),
    mode: key.mode,
    key: key.key,
    keyConfidence: key.confidence,
    brightness: Number(brightness.toFixed(2)),
  };
}

// For a streamed song the author describes what they hear; the description stands in for analysis.
export function describedMusic({ pace, energy, mode, genre, year }) {
  const bpm = { slow: 66, medium: 96, fast: 132 }[pace] ?? null;
  const level = { soft: 0.25, full: 0.55, intense: 0.85 }[energy] ?? GENRES[genre]?.energy ?? 0.5;
  return {
    bpm,
    energy: level,
    mode: mode === 'major' || mode === 'minor' ? mode : null,
    key: null,
    keyConfidence: mode === 'major' || mode === 'minor' ? 0.6 : 0,
    brightness: level,
    genre: GENRES[genre] ? genre : null,
    year: Number.isInteger(year) ? year : null,
  };
}
