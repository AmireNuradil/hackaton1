export const MAX_PHOTOS = 6;
export const MAX_PHOTO_SIZE = 12 * 1024 * 1024;
export const MAX_AUDIO_SIZE = 20 * 1024 * 1024;

export async function readPalette(file) {
  let image;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error(`Could not read ${file.name}. Use a JPEG, PNG, WebP or GIF image.`);
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 32, 32);
    const { data } = context.getImageData(0, 0, 32, 32);
    const bins = new Map();
    let light = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 127) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      light += luminance;
      total++;
      const key = `${r >> 5}/${g >> 5}/${b >> 5}`;
      const bin = bins.get(key) ?? { sum: [0, 0, 0], count: 0, score: 0 };
      bin.sum[0] += r;
      bin.sum[1] += g;
      bin.sum[2] += b;
      bin.count++;
      bin.score += (0.08 + chroma) * (0.08 + Math.sin(Math.PI * luminance));
      bins.set(key, bin);
    }
    if (!total) return { color: [160, 150, 142], light: 0.5 };
    const best = [...bins.values()].reduce((max, bin) => bin.score > max.score ? bin : max);
    return { color: best.sum.map((value) => Math.round(value / best.count)), light: light / total };
  } finally {
    image.close();
  }
}

export function combinePalettes(palettes) {
  const weight = palettes.length + 1;
  const weighted = [palettes[0], ...palettes];
  return {
    color: [0, 1, 2].map((channel) => Math.round(weighted.reduce((sum, palette) => sum + palette.color[channel], 0) / weight)),
    light: weighted.reduce((sum, palette) => sum + palette.light, 0) / weight,
  };
}

export function measureMusic(samples, sampleRate) {
  const stride = Math.max(1, Math.round(sampleRate / 100));
  const frames = Math.min(Math.floor(samples.length / stride), 4500);
  if (frames < 150) return { bpm: null, energy: 0.35 };
  const onsets = new Float64Array(frames);
  let average = 0;
  let previous = 0;
  for (let frame = 0; frame < frames; frame++) {
    let power = 0;
    const start = frame * stride;
    for (let i = start; i < start + stride; i++) power += samples[i] ** 2;
    const rms = Math.sqrt(power / stride);
    average += rms / frames;
    onsets[frame] = Math.max(0, rms - previous);
    previous = previous * 0.45 + rms * 0.55;
  }
  const mean = onsets.reduce((sum, value) => sum + value, 0) / frames;
  const variance = onsets.reduce((sum, value) => sum + (value - mean) ** 2, 0) / frames;
  const correlations = new Float64Array(122);
  if (variance > 1e-7) {
    for (let lag = 34; lag <= 121; lag++) {
      let score = 0;
      for (let j = lag; j < frames; j++) score += (onsets[j] - mean) * (onsets[j - lag] - mean);
      correlations[lag] = score / ((frames - lag) * variance);
    }
  }
  const peaks = [];
  for (let lag = 35; lag <= 120; lag++) {
    const score = correlations[lag];
    if (score > 0.2 && score >= correlations[lag - 1] && score > correlations[lag + 1]) peaks.push(lag);
  }
  const strongest = peaks.reduce((best, lag) => correlations[lag] > correlations[best] ? lag : best, 0);
  // Treat a convincing shorter peak as the beat when the strongest peak spans several beats.
  const beat = peaks.find((lag) => {
    const multiple = Math.round(strongest / lag);
    return Math.abs(strongest - lag * multiple) <= 3 && correlations[lag] >= 0.68 * correlations[strongest];
  });
  return {
    bpm: beat == null ? null : Math.round(60 * sampleRate / (beat * stride)),
    energy: Math.min(1, average * 4 + Math.sqrt(variance) / Math.max(0.06, average) * 1.7),
  };
}

export async function analyzeAudio(file) {
  try {
    const context = new OfflineAudioContext(1, 1, 22050);
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    return measureMusic(audio.getChannelData(0), audio.sampleRate);
  } catch {
    throw new Error('Could not read this audio file. Try an MP3, WAV, OGG or a song link.');
  }
}
