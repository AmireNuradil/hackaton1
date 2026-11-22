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
  // A single pitch class (a drone) carries no major/minor information.
  const mean = chroma.reduce((sum, value) => sum + value, 0) / 12;
  const sorted = [...chroma].sort((a, b) => b - a);
  if (!mean || sorted[2] < mean * 0.9) return { key: null, mode: null, confidence: 0 };
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
  // Noise fits no key well (best correlation 0.46 on pink noise; real songs in the test set reach 0.59–0.94).
  if (!Number.isFinite(best.score) || best.score < 0.52) return { key: null, mode: null, confidence: 0 };
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

// Tempo from the onset envelope: remove the slow trend, autocorrelate, and pick the strongest period,
// weighted by a log-normal prior around 115 BPM (σ = 0.7 octave) the way most listeners tap along, with a
// bonus when the beat also divides in two (most music does; it stops an even hi-hat stream reading as 3/8).
// On 17 rendered songs plus 4 hi-hat grooves, 20 of 21 land within 4% or on an accepted half/double tempo;
// every neighbouring setting scores the same. scripts/benchmark/ reproduces the measurement.
export function estimateTempo(flux, framesPerSecond) {
  const window = Math.max(1, Math.round(framesPerSecond * 0.4));
  const envelope = new Float64Array(flux.length);
  let running = 0;
  for (let i = 0; i < flux.length; i++) {
    running += flux[i];
    if (i >= window) running -= flux[i - window];
    envelope[i] = Math.max(0, flux[i] - running / Math.min(i + 1, window));
  }
  const mean = envelope.reduce((sum, value) => sum + value, 0) / envelope.length;
  const centered = envelope.map((value) => value - mean);
  const zero = centered.reduce((sum, value) => sum + value * value, 0) / centered.length;
  if (!zero) return { bpm: null, confidence: 0 };
  const lagFor = (bpm) => framesPerSecond * 60 / bpm;
  const minLag = Math.floor(lagFor(200));
  const maxLag = Math.ceil(lagFor(45));
  const acf = new Map();
  for (let lag = Math.max(1, Math.floor(minLag / 2) - 1); lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = lag; i < centered.length; i++) sum += centered[i] * centered[i - lag];
    acf.set(lag, sum / (centered.length - lag) / zero);
  }
  const at = (lag) => {
    const low = Math.floor(lag);
    const fraction = lag - low;
    return (acf.get(low) ?? 0) * (1 - fraction) + (acf.get(low + 1) ?? 0) * fraction;
  };
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const prior = Math.exp(-0.5 * (Math.log2(60 * framesPerSecond / lag / 115) / 0.7) ** 2);
    const score = (acf.get(lag) + 0.3 * at(lag / 2)) * prior;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  const peak = acf.get(best);
  // Songs reach 0.57–0.95 here; noise, a steady drone and beatless pads stay under 0.2.
  if (peak < 0.3) return { bpm: null, confidence: Number(Math.max(0, peak).toFixed(2)) };
  const left = acf.get(best - 1);
  const right = acf.get(best + 1);
  const denom = left - 2 * peak + right;
  const offset = denom ? clamp(0.5 * (left - right) / denom, -0.5, 0.5) : 0;
  return { bpm: Math.round(60 * framesPerSecond / (best + offset)), confidence: Number(peak.toFixed(2)) };
}

// Pitch-class profile from a long FFT (≈2.7 Hz bins at 22 kHz) so low chord tones land in the right semitone.
// Each semitone gets equal weight however many bins it spans; each frame is normalized and log-compressed.
// With Krumhansl–Kessler profiles this names 15 of 17 test keys exactly and 17 of 17 modes.
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
    if (hz < 40 || hz > 2100) continue;
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
    // The bass (below 250 Hz) counts double: it usually carries the tonic.
    for (const [bin, semitone] of semitones) {
      const weight = bin * binHz < 250 ? 2 : 1;
      energy.set(semitone, (energy.get(semitone) ?? 0) + weight * Math.hypot(re[bin], im[bin]) ** 2 / counts.get(semitone));
    }
    const values = [...energy.values()];
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!total) continue;
    for (const [semitone, value] of energy) chroma[((semitone + 9) % 12 + 12) % 12] += Math.log1p(1000 * value / total);
  }
  return chroma;
}

// Per-frame features (2048-sample frames, 512 hop): onset strength (log-spectral flux), loudness, centroid.
// Onsets are measured after scaling the whole track to one level, so a loudly mastered ballad and a quiet
// recording of the same song read the same; only how the music moves counts.
export function analyseFrames(samples, sampleRate) {
  const hop = 512;
  const size = 2048;
  const frames = Math.floor((samples.length - size) / hop);
  if (frames < 32) return null;
  let power = 0;
  for (let i = 0; i < samples.length; i++) power += samples[i] * samples[i];
  const gain = 0.1 / (Math.sqrt(power / samples.length) || 1);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  let previous = new Float64Array(size / 2);
  let highRise = 0;
  let lowRise = 0;
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
      const value = Math.log1p(100 * gain * Math.hypot(re[bin], im[bin]));
      magnitude[bin] = value;
      const step = Math.max(0, value - previous[bin]);
      rise += step;
      if (bin * binHz > 5000) highRise += step;
      else if (bin * binHz < 150) lowRise += step;
      weighted += value * bin * binHz;
      sum += value;
    }
    if (sum) { centroidSum += weighted / sum * sum; centroidWeight += sum; }
    flux.push(rise);
    previous = magnitude;
  }
  const totalRise = flux.reduce((total, value) => total + value, 0);
  return {
    flux, framesPerSecond: sampleRate / hop, rms: rmsSum / frames, centroid: centroidWeight ? centroidSum / centroidWeight : 0,
    // Share of onset strength above 5 kHz: hats, snares and cymbals put most of their attack there.
    percussion: totalRise ? highRise / totalRise : 0,
    kick: totalRise ? lowRise / totalRise : 0,
  };
}

export function measureMusic(samples, sampleRate) {
  const frames = analyseFrames(samples, sampleRate);
  if (!frames) return { bpm: null, energy: 0, mode: null, key: null, keyConfidence: 0, brightness: 0 };
  const { flux, framesPerSecond, rms, centroid, percussion, kick } = frames;
  const onsetStrength = flux.reduce((total, value) => total + value, 0) / flux.length;
  const brightness = clamp((centroid - 900) / 2600, 0, 1);
  // A steady tone has almost no onsets (songs in the test set average 110–340 on this scale): no tempo.
  let bpm = rms < 0.002 || onsetStrength < 12 ? null : estimateTempo(flux, framesPerSecond).bpm;
  // Heuristic: without drums, a fast even run of notes is heard at half speed (arpeggios at 136 feel like a
  // 68 ballad). Drum songs in the test set reach 0.48–0.57 high-band onset share, drumless arpeggios
  // 0.42–0.45; a bare kick pattern (low-band share above 0.08) keeps its tempo.
  if (bpm > 120 && percussion < 0.47 && kick < 0.08) bpm = Math.round(bpm / 2);
  // Felt intensity: how densely and sharply notes and hits land (gain-normalized onset strength, r = 0.84
  // with hand-rated intensity of 18 test songs), plus a little tempo. Loudness is left out on purpose:
  // streamed and downloaded songs are all mastered loud, ballads included.
  const energy = rms < 0.002 ? 0 : clamp(0.8 * clamp((onsetStrength - 130) / 200, 0, 1) + 0.2 * clamp(((bpm ?? 70) - 60) / 100, 0, 1), 0, 1);
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
