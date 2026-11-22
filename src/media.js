import { measureMusic } from './music.js';
import { readPixels } from './photo.js';

export const MAX_PHOTOS = 6;
export const MAX_PHOTO_SIZE = 15 * 1024 * 1024;
export const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

export function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не получилось открыть фото. Попробуйте JPG, PNG или WebP.'));
    image.src = typeof source === 'string' ? source : URL.createObjectURL(source);
  });
}

export function readImage(image) {
  const scale = Math.min(1, 120 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return readPixels(context.getImageData(0, 0, canvas.width, canvas.height).data);
}

export async function analyzeAudio(source) {
  const bytes = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const Context = window.AudioContext || window.webkitAudioContext;
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0));
    const rate = 22050;
    const seconds = Math.min(decoded.duration, 40);
    const start = decoded.duration > 50 ? Math.min(20, decoded.duration * 0.25) : 0;
    const offline = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
    const node = offline.createBufferSource();
    node.buffer = decoded;
    node.connect(offline.destination);
    node.start(0, start, seconds);
    const rendered = await offline.startRendering();
    return { ...measureMusic(rendered.getChannelData(0), rate), duration: Math.round(decoded.duration) };
  } catch {
    throw new Error('Не удалось прочитать аудиофайл. Подойдут MP3, WAV, OGG или M4A.');
  } finally {
    context.close?.();
  }
}
