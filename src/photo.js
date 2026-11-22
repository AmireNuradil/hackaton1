// Photo reading from RGBA pixels: palette, light, contrast, warmth, saturation.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(clamp(v, 0, 1) * 255));
}

// Deterministic k-means seeded from luminance-sorted samples.
export function readPixels(data, k = 5) {
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 32) pixels.push([data[i], data[i + 1], data[i + 2]]);
  if (!pixels.length) return { palette: [[128, 128, 128]], weights: [1], light: 0.5, contrast: 0, warmth: 0, saturation: 0 };
  const luma = (p) => (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
  const sorted = [...pixels].sort((a, b) => luma(a) - luma(b));
  let centers = Array.from({ length: k }, (_, i) => [...sorted[Math.floor((i + 0.5) * sorted.length / k)]]);
  let counts = new Array(k).fill(0);
  for (let round = 0; round < 8; round++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = new Array(k).fill(0);
    for (const p of pixels) {
      let best = 0;
      let bestDistance = Infinity;
      centers.forEach((c, i) => {
        const distance = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (distance < bestDistance) { bestDistance = distance; best = i; }
      });
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2];
      counts[best]++;
    }
    centers = centers.map((c, i) => counts[i] ? sums[i].map((v) => Math.round(v / counts[i])) : c);
  }
  const order = centers.map((c, i) => i).sort((a, b) => counts[b] - counts[a]);
  const lights = pixels.map(luma);
  const light = lights.reduce((sum, v) => sum + v, 0) / lights.length;
  const contrast = Math.sqrt(lights.reduce((sum, v) => sum + (v - light) ** 2, 0) / lights.length);
  let warmth = 0;
  let saturation = 0;
  for (const p of pixels) {
    warmth += (p[0] - p[2]) / 255;
    saturation += rgbToHsl(p)[1];
  }
  return {
    palette: order.map((i) => centers[i]),
    weights: order.map((i) => Number((counts[i] / pixels.length).toFixed(3))),
    light: Number(light.toFixed(3)),
    contrast: Number(contrast.toFixed(3)),
    warmth: Number(clamp(warmth / pixels.length * 2, -1, 1).toFixed(3)),
    saturation: Number((saturation / pixels.length).toFixed(3)),
  };
}

// The first photo leads the day; later ones contribute half as much.
export function combinePhotos(readings) {
  const weights = readings.map((_, i) => (i === 0 ? 2 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const avg = (key) => Number((readings.reduce((sum, r, i) => sum + r[key] * weights[i], 0) / total).toFixed(3));
  const swatches = readings.flatMap((r, i) => r.palette.map((color, j) => ({ color, weight: r.weights[j] * weights[i] })));
  swatches.sort((a, b) => b.weight - a.weight);
  const palette = [];
  for (const { color } of swatches) {
    if (palette.every((c) => Math.hypot(c[0] - color[0], c[1] - color[1], c[2] - color[2]) > 38)) palette.push(color);
    if (palette.length === 5) break;
  }
  return { palette, light: avg('light'), contrast: avg('contrast'), warmth: avg('warmth'), saturation: avg('saturation'), count: readings.length };
}
