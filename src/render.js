// Paints a diary page on a 1080×1350 canvas. Constant frame + a technique chosen by the rules.
import { hslToRgb, rgbToHsl } from './photo.js';
import { TECHNIQUES } from './system.js';

export const PAGE = { width: 1080, height: 1350, margin: 72 };
const PAPER = [243, 238, 228];
const INK = [38, 33, 30];
const FONTS = {
  serif: '"Cormorant Garamond Variable", "Cormorant Garamond", Georgia, serif',
  hand: '"Caveat Variable", "Caveat", "Comic Sans MS", cursive',
  sans: '"Manrope Variable", "Manrope", system-ui, sans-serif',
};
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

export function seeded(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) { h = Math.imul(h ^ text.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let state = h >>> 0;
  return () => {
    state |= 0; state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dateLine(date) {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export async function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([
    document.fonts.load(`500 80px ${FONTS.serif}`, 'Аа'), document.fonts.load(`italic 500 80px ${FONTS.serif}`, 'Аа'),
    document.fonts.load(`400 48px ${FONTS.hand}`, 'Аа'), document.fonts.load(`600 20px ${FONTS.sans}`, 'Аа'),
  ]).catch(() => {});
}

function canvas(width, height) {
  const element = document.createElement('canvas');
  element.width = Math.max(1, Math.round(width));
  element.height = Math.max(1, Math.round(height));
  return element;
}

function windowFor(technique, texture) {
  const { margin, width } = PAGE;
  const full = { x: margin, y: 150, w: width - 2 * margin, h: 860 };
  if (technique === 'ma') {
    const w = Math.round(full.w * (1 - texture.air * 0.78));
    const h = Math.round(w * 1.22);
    return { x: margin + full.w - w, y: 196, w, h };
  }
  if (technique === 'film') return { x: margin + 34, y: 176, w: full.w - 68, h: 800 };
  return full;
}

function coverDraw(ctx, image, w, h, focus = [0.5, 0.5]) {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, (w - dw) * focus[0], (h - dh) * focus[1], dw, dh);
}

function sampler(image, w, h) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  coverDraw(ctx, image, w, h);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  return {
    at(x, y) {
      const px = clamp(Math.floor(x), 0, c.width - 1);
      const py = clamp(Math.floor(y), 0, c.height - 1);
      const i = (py * c.width + px) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    },
    luma(x, y) { const [r, g, b] = this.at(x, y); return 0.2126 * r + 0.7152 * g + 0.0722 * b; },
    width: c.width, height: c.height, canvas: c,
  };
}

function nearest(palette, color) {
  let best = palette[0];
  let distance = Infinity;
  for (const c of palette) {
    const d = (c[0] - color[0]) ** 2 + (c[1] - color[1]) ** 2 + (c[2] - color[2]) ** 2;
    if (d < distance) { distance = d; best = c; }
  }
  return best;
}

const toPalette = (palette, color, amount) => mix(color, nearest(palette, color), amount);

// ——— Technique plates: rendered once per photo, animated cheaply per frame ———

function monetPlate(image, w, h, design, random) {
  const plate = canvas(w, h);
  const ctx = plate.getContext('2d');
  const s = sampler(image, w / 3, h / 3);
  ctx.filter = 'blur(10px) saturate(0.9)';
  ctx.drawImage(s.canvas, -20, -20, w + 40, h + 40);
  ctx.filter = 'none';
  ctx.fillStyle = rgb(design.palette[0], 0.25);
  ctx.fillRect(0, 0, w, h);
  const size = design.texture.stroke;
  const count = Math.round(w * h / (size * size) * 1.15);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = random() * w;
    const y = random() * h;
    const sx = x / 3;
    const sy = y / 3;
    const gx = s.luma(sx + 1, sy) - s.luma(sx - 1, sy);
    const gy = s.luma(sx, sy + 1) - s.luma(sx, sy - 1);
    const angle = Math.atan2(gy, gx) + Math.PI / 2 + (random() - 0.5) * 0.9;
    const base = toPalette(design.palette, s.at(sx, sy), 0.38);
    const jitter = (random() - 0.5) * 34;
    const color = base.map((v) => clamp(v + jitter, 0, 255));
    const length = size * (1 + random() * 1.3);
    ctx.strokeStyle = rgb(color, 0.78);
    ctx.lineWidth = size * (0.32 + random() * 0.28);
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(angle) * length / 2, y - Math.sin(angle) * length / 2);
    ctx.quadraticCurveTo(x + (random() - 0.5) * size * 0.6, y + (random() - 0.5) * size * 0.6, x + Math.cos(angle) * length / 2, y + Math.sin(angle) * length / 2);
    ctx.stroke();
  }
  const light = Array.from({ length: 240 }, () => {
    const x = random() * w;
    const y = random() * h * 0.85;
    const color = s.at(x / 3, y / 3);
    return { x, y, angle: random() * Math.PI, color: mix(color, [255, 236, 200], 0.55), phase: random() * Math.PI * 2, length: size * (1.2 + random()) };
  }).filter((stroke) => stroke.color[0] + stroke.color[1] > 300);
  return { plate, light };
}

// Pointillism the way Seurat built it: a softened colour ground, then dense dots of vivid colour, with small
// dots of the complementary hue mixed in so the eye blends them into a shimmer.
function seuratPlate(image, w, h, design, random) {
  const plate = canvas(w, h);
  const ctx = plate.getContext('2d');
  const s = sampler(image, w / 4, h / 4);
  ctx.filter = 'blur(14px) saturate(0.8) brightness(1.08)';
  ctx.drawImage(s.canvas, -24, -24, w + 48, h + 48);
  ctx.filter = 'none';
  ctx.fillStyle = rgb(mix(PAPER, design.palette[0], 0.25), 0.35);
  ctx.fillRect(0, 0, w, h);
  const r = design.texture.dot;
  const step = r * 1.3;
  const dots = [];
  for (let y = 0; y < h + step; y += step) {
    for (let x = (Math.round(y / step) % 2) ? step / 2 : 0; x < w + step; x += step) {
      const px = x + (random() - 0.5) * step * 0.7;
      const py = y + (random() - 0.5) * step * 0.7;
      const base = toPalette(design.palette, s.at(px / 4, py / 4), 0.25);
      const [hue, sat, light] = rgbToHsl(base);
      const vivid = hslToRgb([hue + (random() - 0.5) * 18, clamp(sat * 1.25 + 0.12, 0, 0.95), clamp(light + (random() - 0.5) * 0.12, 0.08, 0.92)]);
      ctx.fillStyle = rgb(vivid, 0.92);
      ctx.beginPath();
      ctx.arc(px, py, r * (0.62 + random() * 0.3), 0, Math.PI * 2);
      ctx.fill();
      if (random() < 0.16) {
        ctx.fillStyle = rgb(hslToRgb([hue + 180, clamp(sat * 0.9 + 0.2, 0, 0.8), clamp(light, 0.25, 0.75)]), 0.6);
        ctx.beginPath();
        ctx.arc(px + r * 0.55, py - r * 0.45, r * 0.34, 0, Math.PI * 2);
        ctx.fill();
      }
      if (random() < 0.06) dots.push({ x: px, y: py, color: vivid, phase: Math.floor(random() * 4) });
    }
  }
  // Only a few hundred dots pulse on the beat: enough to read as rhythm, cheap enough for 60 fps.
  const step2 = Math.max(1, Math.ceil(dots.length / 420));
  return { plate, dots: dots.filter((_, i) => i % step2 === 0) };
}

function kandinskyPlate(image, w, h, design, random) {
  const plate = canvas(w, h);
  const ctx = plate.getContext('2d', { willReadFrequently: true });
  coverDraw(ctx, image, w, h);
  const pixels = ctx.getImageData(0, 0, w, h);
  const dark = mix([18, 22, 44], design.palette[0], 0.15);
  const mid = mix(design.palette[1] ?? design.palette[0], [70, 88, 128], 0.55);
  const light = mix(PAPER, [200, 210, 222], 0.5);
  const tones = [dark, mid, mix(mid, light, 0.55), light];
  for (let i = 0; i < pixels.data.length; i += 4) {
    const l = (0.2126 * pixels.data[i] + 0.7152 * pixels.data[i + 1] + 0.0722 * pixels.data[i + 2]) / 255;
    const tone = tones[clamp(Math.floor(l * 4.2), 0, 3)];
    pixels.data[i] = tone[0]; pixels.data[i + 1] = tone[1]; pixels.data[i + 2] = tone[2];
  }
  ctx.putImageData(pixels, 0, 0);
  const colors = [[214, 58, 46], [236, 186, 52], [34, 52, 140], [18, 18, 22], design.palette[0]];
  const shapes = Array.from({ length: design.texture.shapes }, (_, i) => {
    const kind = ['circle', 'ring', 'line', 'line', 'triangle', 'bar'][i % 6];
    return {
      kind, x: random(), y: random(), size: 0.06 + random() * 0.2, angle: random() * Math.PI, color: colors[Math.floor(random() * colors.length)],
      jump: { x: (random() - 0.5) * 0.08, y: (random() - 0.5) * 0.08 }, every: 1 + Math.floor(random() * 4),
    };
  });
  return { plate, shapes };
}

// Sumi-e: the photo becomes ink on paper with its full tonal range, and only its brightest coloured lights
// keep a single colour — the day's accent — the way ink painting allows one touch of colour.
function maPlate(image, w, h, design) {
  const plate = canvas(w, h);
  const ctx = plate.getContext('2d', { willReadFrequently: true });
  coverDraw(ctx, image, w, h);
  const pixels = ctx.getImageData(0, 0, w, h);
  const data = pixels.data;
  const lumas = new Float32Array(w * h);
  for (let i = 0; i < lumas.length; i++) lumas[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
  const sorted = Float32Array.from(lumas).sort();
  const low = sorted[Math.floor(sorted.length * 0.04)];
  const high = sorted[Math.floor(sorted.length * 0.97)];
  const span = Math.max(0.05, high - low);
  const ink = [30, 30, 34];
  const paper = mix(PAPER, design.palette[0], 0.05);
  const wash = mix(ink, paper, 0.62);
  const accent = design.accent;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = y * w + x;
      const i = index * 4;
      const tone = clamp((lumas[index] - low) / span, 0, 1);
      // Three ink densities, softly blended: deep ink, grey wash, bare paper.
      let color = tone < 0.5 ? mix(ink, wash, (tone / 0.5) ** 0.9) : mix(wash, paper, ((tone - 0.5) / 0.5) ** 0.7);
      const [, saturation] = rgbToHsl([data[i], data[i + 1], data[i + 2]]);
      const glow = clamp((tone - 0.78) / 0.22, 0, 1) * clamp((saturation - 0.18) / 0.4, 0, 1);
      if (glow > 0) color = mix(color, accent, glow * 0.75);
      const edge = clamp(Math.min(x, y, w - x, h - y) / (Math.min(w, h) * 0.14), 0, 1);
      color = mix(color, paper, (1 - edge) ** 1.8);
      data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return { plate };
}

function filmPlate(image, w, h, design) {
  const plate = canvas(w, h);
  const ctx = plate.getContext('2d');
  const sepia = design.texture.sepia;
  ctx.filter = `sepia(${sepia}) saturate(${0.85 - sepia * 0.25}) contrast(0.9) brightness(1.04)`;
  coverDraw(ctx, image, w, h);
  ctx.filter = 'blur(14px) brightness(1.3)';
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.28;
  coverDraw(ctx, image, w, h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(40, 28, 60, 0.10)';
  ctx.fillRect(0, 0, w, h);
  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(30,18,10,0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  return { plate };
}

function grainFrames(random, count = 4, size = 256) {
  return Array.from({ length: count }, () => {
    const c = canvas(size, size);
    const ctx = c.getContext('2d');
    const noise = ctx.createImageData(size, size);
    for (let i = 0; i < noise.data.length; i += 4) {
      const v = random() * 255;
      noise.data[i] = v; noise.data[i + 1] = v; noise.data[i + 2] = v; noise.data[i + 3] = 255;
    }
    ctx.putImageData(noise, 0, 0);
    return c;
  });
}

function paperTexture(random, tint) {
  const c = canvas(PAGE.width, PAGE.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = rgb(mix(PAPER, tint, 0.035));
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(${random() < 0.5 ? '90,70,50' : '255,255,255'},${random() * 0.05})`;
    ctx.fillRect(random() * c.width, random() * c.height, 1 + random() * 2, 1 + random() * 2);
  }
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `rgba(120,100,80,${0.015 + random() * 0.02})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    const y = random() * c.height;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(c.width * 0.3, y + (random() - 0.5) * 40, c.width * 0.7, y + (random() - 0.5) * 40, c.width, y + (random() - 0.5) * 30);
    ctx.stroke();
  }
  return c;
}

function wrapLines(ctx, text, width, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[,.;:]?$/, '')}…`;
    return kept;
  }
  return lines;
}

// ——— Page ———

// `scale` renders the page at the size it is shown (× devicePixelRatio): fewer pixels per frame on small
// screens. Posters and video always use scale 1, the full 1080×1350 page.
export async function createPainter(target, day, images, { number = 1, scale = 1 } = {}) {
  const { design } = day;
  const screen = target.getContext('2d');
  // Helpers draw into `ctx`; static layers are baked once by pointing it at an offscreen canvas.
  let ctx = screen;
  target.width = Math.round(PAGE.width * scale);
  target.height = Math.round(PAGE.height * scale);
  screen.setTransform(scale, 0, 0, scale, 0, 0);
  const random = seeded(day.id);
  const rect = windowFor(design.technique, design.texture);
  const over = 1.14;
  const pw = Math.round(rect.w * over);
  const ph = Math.round(rect.h * over);
  const build = { monet: monetPlate, seurat: seuratPlate, kandinsky: kandinskyPlate, ma: maPlate, film: filmPlate }[design.technique];
  const plates = images.map((image) => build(image, pw, ph, design, random));
  const paper = paperTexture(seeded(`${day.id}-paper`), design.palette[0]);
  const grainPatterns = grainFrames(seeded(`${day.id}-grain`)).map((frame) => screen.createPattern(frame, 'repeat'));
  const { rhythm, motion, texture, technique } = design;
  const scenes = rhythm.scenes;
  const sceneMs = rhythm.sceneSeconds * 1000;
  const beatMs = rhythm.beat * 1000;
  const duration = scenes * sceneMs;
  const accent = design.accent;
  const titleWeight = design.type.weight;
  const enso = { x: PAGE.margin + 190, y: rect.y + rect.h - 120, r: 132, start: random() * Math.PI * 2 };
  const leaks = { side: random() < 0.5 ? 0 : 1, phase: random() * Math.PI * 2 };
  const music = day.music;
  const songLine = [`♪ ${music.title || music.name}`, music.bpm ? `${music.bpm} BPM` : null, music.key ?? (music.mode === 'major' ? 'мажор' : music.mode === 'minor' ? 'минор' : null)].filter(Boolean).join('  ·  ');
  ctx.font = `${design.type.italic ? 'italic ' : ''}${titleWeight} 78px ${FONTS.serif}`;
  let titleSize = 78;
  let titleLines = wrapLines(ctx, design.title, PAGE.width - 2 * PAGE.margin, 2);
  if (titleLines.length > 1) {
    titleSize = 64;
    ctx.font = `${design.type.italic ? 'italic ' : ''}${titleWeight} ${titleSize}px ${FONTS.serif}`;
    titleLines = wrapLines(ctx, design.title, PAGE.width - 2 * PAGE.margin, 2);
  }

  function drawPlate(index, progress, alpha) {
    const plate = plates[index % plates.length];
    const odd = index % 2;
    const zoom = odd ? lerp(motion.zoom, 1, ease(progress)) : lerp(1, motion.zoom, ease(progress));
    const travel = (over - 1) / 2;
    const dx = (odd ? -1 : 1) * lerp(-travel, travel, ease(progress)) * motion.drift;
    const sw = rect.w / zoom;
    const sh = rect.h / zoom;
    const sx = (pw - sw) / 2 + dx * pw * 0.5;
    const sy = (ph - sh) / 2 + (index % 3 - 1) * travel * ph * 0.3 * progress;
    ctx.globalAlpha = alpha;
    ctx.drawImage(plate.plate, clamp(sx, 0, pw - sw), clamp(sy, 0, ph - sh), sw, sh, rect.x, rect.y, rect.w, rect.h);
    ctx.globalAlpha = 1;
    return plate;
  }

  function overlay(plate, time, sceneIndex, sceneProgress, alpha) {
    const beatPhase = (time % beatMs) / beatMs;
    const beatEnvelope = Math.exp(-beatPhase * 5) * motion.pulse;
    const beatIndex = Math.floor(time / beatMs);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.globalAlpha = alpha;
    if (technique === 'monet') {
      ctx.lineCap = 'round';
      const scaleX = rect.w / pw;
      const scaleY = rect.h / ph;
      for (const stroke of plate.light) {
        const shimmer = 0.5 + 0.5 * Math.sin(time / (beatMs * 4) * Math.PI * 2 + stroke.phase);
        ctx.strokeStyle = rgb(stroke.color, 0.55 * shimmer * alpha);
        ctx.lineWidth = texture.stroke * 0.35;
        const x = rect.x + stroke.x * scaleX;
        const y = rect.y + stroke.y * scaleY;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(stroke.angle) * stroke.length / 2, y - Math.sin(stroke.angle) * stroke.length / 2);
        ctx.lineTo(x + Math.cos(stroke.angle) * stroke.length / 2, y + Math.sin(stroke.angle) * stroke.length / 2);
        ctx.stroke();
      }
    } else if (technique === 'seurat') {
      const scaleX = rect.w / pw;
      const scaleY = rect.h / ph;
      for (const dot of plate.dots) {
        const on = dot.phase === beatIndex % 4 ? 1 : 0.25;
        ctx.fillStyle = rgb(dot.color, 0.9 * alpha);
        ctx.beginPath();
        ctx.arc(rect.x + dot.x * scaleX, rect.y + dot.y * scaleY, texture.dot * (0.9 + 1.1 * beatEnvelope * on), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (technique === 'kandinsky') {
      for (const shape of plate.shapes) {
        const step = Math.floor(beatIndex / shape.every) % 2;
        const x = rect.x + (shape.x + shape.jump.x * step) * rect.w;
        const y = rect.y + (shape.y + shape.jump.y * step) * rect.h;
        const size = shape.size * rect.w * (1 + 0.12 * beatEnvelope);
        ctx.fillStyle = rgb(shape.color, 0.82);
        ctx.strokeStyle = rgb(shape.color, 0.95);
        if (shape.kind === 'circle') { ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.fill(); }
        if (shape.kind === 'ring') { ctx.lineWidth = 6; for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(x, y, size * k / 4, 0, Math.PI * 2); ctx.stroke(); } }
        if (shape.kind === 'line') {
          ctx.lineWidth = 3 + 5 * shape.size;
          const angle = shape.angle + step * 0.12;
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(angle) * rect.w, y - Math.sin(angle) * rect.w);
          ctx.lineTo(x + Math.cos(angle) * rect.w, y + Math.sin(angle) * rect.w);
          ctx.stroke();
        }
        if (shape.kind === 'triangle') {
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const a = shape.angle + step * 0.2 + k * Math.PI * 2 / 3;
            ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * size / 1.6, y + Math.sin(a) * size / 1.6);
          }
          ctx.closePath();
          ctx.fill();
        }
        if (shape.kind === 'bar') ctx.fillRect(x - size, y, size * 2, size * 0.16);
      }
    } else if (technique === 'film') {
      const leak = 0.5 + 0.5 * Math.sin(time / 4200 + leaks.phase);
      const lx = leaks.side ? rect.x + rect.w : rect.x;
      const gradient = ctx.createRadialGradient(lx, rect.y + rect.h * 0.3, 0, lx, rect.y + rect.h * 0.3, rect.w * 0.7);
      gradient.addColorStop(0, `rgba(255,140,60,${0.42 * leak})`);
      gradient.addColorStop(0.5, `rgba(255,90,40,${0.14 * leak})`);
      gradient.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = gradient;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.globalCompositeOperation = 'source-over';
      const [, month, dayOfMonth] = day.date.split('-');
      const year = music.year ? String(music.year).slice(2) : day.date.slice(2, 4);
      ctx.font = `600 30px ${FONTS.sans}`;
      ctx.fillStyle = `rgba(255,150,60,${0.85 * alpha})`;
      ctx.shadowColor = 'rgba(255,120,40,.8)';
      ctx.shadowBlur = 8;
      ctx.textAlign = 'right';
      ctx.fillText(`’${year}  ${month}  ${dayOfMonth}`, rect.x + rect.w - 34, rect.y + rect.h - 34);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
    }
    if (texture.grain > 0.05) {
      ctx.globalAlpha = texture.grain * 0.32 * alpha;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = grainPatterns[Math.floor(time / 83) % grainPatterns.length];
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function frameDecor(time, sceneIndex, sceneProgress) {
    if (technique === 'monet') {
      // Painted, uneven border: paper-coloured strokes over the window edge.
      const r = seeded(`${day.id}-edge`);
      ctx.lineCap = 'round';
      for (let i = 0; i < 360; i++) {
        const side = i % 4;
        const t = r();
        const inset = r() * 14 - 2;
        const x = side === 0 ? rect.x + t * rect.w : side === 1 ? rect.x + rect.w - inset : side === 2 ? rect.x + t * rect.w : rect.x + inset;
        const y = side === 0 ? rect.y + inset : side === 1 ? rect.y + t * rect.h : side === 2 ? rect.y + rect.h - inset : rect.y + t * rect.h;
        ctx.strokeStyle = rgb(mix(PAPER, design.palette[0], 0.04), 0.9);
        ctx.lineWidth = 4 + r() * 12;
        const a = (side % 2 ? Math.PI / 2 : 0) + (r() - 0.5) * 0.7;
        const half = 6 + r() * 16;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(a) * half, y - Math.sin(a) * half);
        ctx.lineTo(x + Math.cos(a) * half, y + Math.sin(a) * half);
        ctx.stroke();
      }
    }
    if (technique === 'kandinsky') {
      ctx.strokeStyle = rgb(INK, 0.85);
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgb(INK, 0.25);
      for (let i = 1; i < 12; i++) {
        const x = PAGE.margin + i * (PAGE.width - 2 * PAGE.margin) / 12;
        ctx.beginPath(); ctx.moveTo(x, rect.y + rect.h + 8); ctx.lineTo(x, rect.y + rect.h + 30); ctx.stroke();
      }
      ctx.fillStyle = rgb(accent);
      ctx.fillRect(rect.x + rect.w - 120, rect.y - 14, 120, 8);
    }
    if (technique === 'film') {
      ctx.save();
      ctx.shadowColor = 'rgba(40,30,20,.25)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = '#fbf8f1';
      ctx.fillRect(rect.x - 22, rect.y - 22, rect.w + 44, rect.h + 74);
      ctx.restore();
    }
    if (technique === 'ma') {
      // Ensō, brushed once per scene; the stroke speed follows the tempo.
      const reveal = ease(clamp(sceneProgress * 1.4, 0, 1));
      const end = enso.start + reveal * Math.PI * 1.85;
      ctx.lineCap = 'round';
      const steps = 80;
      for (let i = 0; i < steps; i++) {
        const a0 = enso.start + (end - enso.start) * (i / steps);
        const a1 = enso.start + (end - enso.start) * ((i + 1) / steps);
        const pressure = Math.sin(Math.PI * (i / steps)) ** 0.6;
        ctx.strokeStyle = rgb(INK, 0.78 - 0.3 * (i / steps));
        ctx.lineWidth = 6 + 20 * pressure;
        ctx.beginPath();
        ctx.arc(enso.x, enso.y, enso.r, a0, a1 + 0.01);
        ctx.stroke();
      }
    }
  }

  function header() {
    ctx.fillStyle = rgb(INK, 0.86);
    ctx.font = `700 21px ${FONTS.sans}`;
    ctx.letterSpacing = '4px';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(dateLine(day.date).toUpperCase(), PAGE.margin, 98);
    ctx.textAlign = 'right';
    ctx.fillText(`ДНЕВНИК  ·  №${String(number).padStart(2, '0')}`, PAGE.width - PAGE.margin, 98);
    ctx.textAlign = 'left';
    ctx.letterSpacing = '0px';
    ctx.fillStyle = rgb(INK, 0.5);
    ctx.fillRect(PAGE.margin, 118, PAGE.width - 2 * PAGE.margin, 1.5);
  }

  const titleTop = technique === 'ma' ? Math.max(rect.y + rect.h + 92, 1060) : 1094;

  function staticTitle() {
    ctx.fillStyle = rgb(INK);
    ctx.font = `${design.type.italic ? 'italic ' : ''}${titleWeight} ${titleSize}px ${FONTS.serif}`;
    titleLines.forEach((line, i) => ctx.fillText(line, PAGE.margin, titleTop + i * titleSize * 0.98));
    if (technique === 'ma') {
      ctx.fillStyle = rgb(accent);
      const x = PAGE.margin;
      const y = rect.y;
      ctx.fillRect(x, y, 64, 64);
      ctx.fillStyle = rgb(PAPER);
      ctx.font = `700 26px ${FONTS.serif}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(number).padStart(2, '0'), x + 32, y + 41);
      ctx.textAlign = 'left';
    }
  }

  function caption(sceneIndex, sceneProgress) {
    const captionY = titleTop + (titleLines.length - 1) * titleSize * 0.98 + 66;
    const caption = design.captions[Math.floor(sceneIndex * design.captions.length / scenes) % design.captions.length];
    ctx.font = `500 42px ${FONTS.hand}`;
    const lines = wrapLines(ctx, caption, PAGE.width - 2 * PAGE.margin - 40, 2);
    const writeTime = clamp(sceneProgress * (technique === 'kandinsky' ? 3 : 1.7), 0, 1);
    const total = lines.reduce((sum, line) => sum + line.length, 0);
    let budget = Math.round(total * writeTime);
    ctx.fillStyle = rgb(mix(accent, INK, 0.25));
    lines.forEach((line, i) => {
      const visible = line.slice(0, Math.max(0, budget));
      budget -= line.length;
      if (visible) ctx.fillText(visible, PAGE.margin + 4, captionY + i * 44);
    });
  }

  function staticFooter() {
    ctx.fillStyle = rgb(INK, 0.68);
    ctx.font = `600 19px ${FONTS.sans}`;
    const maxWidth = PAGE.width - 2 * PAGE.margin - 300;
    let line = songLine;
    while (ctx.measureText(line).width > maxWidth && line.length > 8) line = `${line.slice(0, -2)}…`.replace(/……$/, '…');
    ctx.fillText(line, PAGE.margin, 1292);
    ctx.textAlign = 'right';
    ctx.fillText(TECHNIQUES[technique].name.toUpperCase(), PAGE.width - PAGE.margin, 1292);
    ctx.textAlign = 'left';
    ctx.fillStyle = rgb(INK, 0.14);
    ctx.fillRect(PAGE.margin, 1312, PAGE.width - 2 * PAGE.margin, 2);
  }

  function progress(time) {
    ctx.fillStyle = rgb(accent);
    ctx.fillRect(PAGE.margin, 1312, (PAGE.width - 2 * PAGE.margin) * clamp(time / duration, 0, 1), 2);
  }

  function layer(paint) {
    const element = canvas(PAGE.width * scale, PAGE.height * scale);
    ctx = element.getContext('2d');
    ctx.scale(scale, scale);
    paint();
    ctx = screen;
    return element;
  }
  const base = layer(() => {
    ctx.drawImage(paper, 0, 0);
    header();
    if (technique === 'film') frameDecor(0, 0, 0);
    staticTitle();
    staticFooter();
  });
  const after = technique === 'monet' || technique === 'kandinsky' ? layer(() => frameDecor(0, 0, 0)) : null;

  // Layers are already at screen resolution: copy them 1:1.
  function blit(source) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  }

  function draw(time) {
    const t = clamp(time, 0, duration - 1);
    const sceneIndex = Math.floor(t / sceneMs);
    const sceneTime = t - sceneIndex * sceneMs;
    const sceneProgress = sceneTime / sceneMs;
    blit(base);
    if (technique === 'ma') frameDecor(t, sceneIndex, sceneProgress);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.fillStyle = rgb(mix(PAPER, design.palette[0], 0.2));
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    const fade = clamp(sceneTime / rhythm.transition, 0, 1);
    if (sceneIndex > 0 && fade < 1) {
      const previous = drawPlate(sceneIndex - 1, 1, 1);
      overlay(previous, t, sceneIndex - 1, 1, 1);
    }
    const current = drawPlate(sceneIndex, sceneProgress, sceneIndex > 0 ? ease(fade) : 1);
    overlay(current, t, sceneIndex, sceneProgress, sceneIndex > 0 ? ease(fade) : 1);
    ctx.restore();
    if (after) blit(after);
    caption(sceneIndex, sceneProgress);
    progress(t);
  }

  return { draw, duration, rect };
}

export function posterTime(design) {
  return design.rhythm.sceneSeconds * 1000 * 0.62;
}
