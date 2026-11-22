// Records the animated page with its soundtrack to a WebM file, in real time, entirely in the browser.
import { createPainter } from './render.js';

const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

export function videoType() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  return TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export async function recordMemory(day, images, audioBytes, number, onProgress) {
  const type = videoType();
  if (!type) throw new Error('Этот браузер не умеет записывать видео. Папка сохранится с постером.');
  const canvas = document.createElement('canvas');
  const painter = await createPainter(canvas, day, images, { number });
  painter.draw(0);
  const stream = canvas.captureStream(30);
  let context;
  let source;
  if (audioBytes) {
    context = new AudioContext();
    await context.resume();
    const buffer = await context.decodeAudioData(audioBytes.slice(0));
    const destination = context.createMediaStreamDestination();
    const gain = context.createGain();
    source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const seconds = painter.duration / 1000;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(1, context.currentTime + 0.6);
    gain.gain.setValueAtTime(1, context.currentTime + seconds - 1.6);
    gain.gain.linearRampToValueAtTime(0, context.currentTime + seconds);
    source.connect(gain).connect(destination);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
  }
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start(500);
  source?.start();
  const start = performance.now();
  await new Promise((resolve) => {
    const frame = () => {
      const time = performance.now() - start;
      painter.draw(time);
      onProgress?.(Math.min(1, time / painter.duration));
      if (time >= painter.duration) resolve();
      else requestAnimationFrame(frame);
    };
    frame();
  });
  recorder.stop();
  await stopped;
  source?.stop();
  await context?.close();
  for (const track of stream.getTracks()) track.stop();
  const extension = type.startsWith('video/mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(chunks, { type: type.split(';')[0] }), name: `memory.${extension}` };
}
