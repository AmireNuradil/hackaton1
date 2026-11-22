import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource-variable/playfair-display';
import './style.css';
import { compose, dateLabel, framing, localDate, moods, safeLink } from './compose.js';
import { examples } from './examples.js';
import { exportDay } from './export.js';
import { analyzeAudio, combinePalettes, MAX_AUDIO_SIZE, MAX_PHOTOS, MAX_PHOTO_SIZE, readPalette } from './media.js';
import { fetchDays, saveDay } from './store.js';

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const viewer = $('viewer');
const scene = $('scene');
const soundtrack = $('soundtrack');
const form = $('entry-form');
const photosInput = $('entry-photos');
const soundToggle = $('sound-toggle');
const archiveStatus = $('archive-status');
const viewerMessage = $('viewer-message');
const blobUrls = new Map();
let days = [...examples];
let activeDay;
let selectedPhotos = [];
let previewUrls = [];
let saving = false;
let storeError = false;
let mute = false;
let frame = 0;
let last = 0;
let elapsed = 0;
let playing = false;
let shots = [];
let shotIndex = 0;

const dateFormat = { month: 'long', day: 'numeric', year: 'numeric' };
const assetUrl = (path) => new URL(`memories/${path}`, document.baseURI).href;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function dateNode(date, className, options = dateFormat) {
  const time = node('time', className, dateLabel(date, options));
  time.dateTime = date;
  return time;
}

function mediaUrl(media) {
  if (!media.blob) return assetUrl(media.path);
  if (!blobUrls.has(media.blob)) blobUrls.set(media.blob, URL.createObjectURL(media.blob));
  return blobUrls.get(media.blob);
}

function imageFor(photo, className, lazy = false) {
  const image = node('img', className);
  image.src = mediaUrl(photo);
  image.alt = '';
  image.decoding = 'async';
  if (lazy) image.loading = 'lazy';
  return image;
}

function playIcon() {
  const icon = node('span', 'play');
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function renderFeatured(day) {
  const image = imageFor(day.photos[0], 'feature-image');
  image.fetchPriority = 'high';
  const heading = node('h2', 'feature-title', day.design.title);
  const label = node('p', 'feature-tag');
  const dot = node('span');
  dot.style.background = `rgb(${day.design.accent.join(' ')})`;
  label.append(dot, `${moods[day.design.mood].label} · ${day.design.seconds} sec`);
  const copy = node('div', 'feature-copy');
  copy.append(heading, label);
  const button = node('button', 'button', 'Play memory');
  button.type = 'button';
  button.prepend(playIcon());
  button.addEventListener('click', () => openViewer(day, true));
  $('feature').replaceChildren(image, dateNode(day.date, 'feature-date'), copy, button);
  $('journal-date').textContent = dateLabel(day.date, { month: 'long', year: 'numeric' });
}

function archiveCard(day) {
  const button = node('button', 'entry');
  button.type = 'button';
  button.dataset.day = day.id;
  const imageWrap = node('span', 'entry-image-wrap');
  const iconWrap = node('span', 'entry-play');
  iconWrap.append(playIcon());
  imageWrap.append(imageFor(day.photos[0], 'entry-image', true), iconWrap);
  const info = node('span', 'entry-info');
  const meta = node('span', 'entry-meta');
  meta.append(dateNode(day.date, '', { month: 'short', day: 'numeric', year: 'numeric' }), node('span', '', moods[day.design.mood].label));
  info.append(meta, node('span', 'entry-title', day.design.title));
  button.append(imageWrap, info);
  button.addEventListener('click', () => openViewer(day));
  return button;
}

function renderArchive() {
  const filter = $('entry-filter').value;
  const records = days.filter((day) => filter === 'all' || (filter === 'examples') === Boolean(day.example));
  $('entries').replaceChildren(...records.map(archiveCard));
  $('entry-count').textContent = `${records.length} ${records.length === 1 ? 'day' : 'days'}`;
  showMessage(archiveStatus, storeError ? 'Browser storage is unavailable. Sample memories are still available.' : records.length ? '' : 'Your saved memories will appear here.');
}

function renderJournal() {
  days.sort((a, b) => b.date.localeCompare(a.date) || (b.created ?? 0) - (a.created ?? 0));
  renderFeatured(days[0]);
  renderArchive();
}

function setSongSource() {
  const isLink = form.elements['song-source'].value === 'link';
  $('link-group').hidden = !isLink;
  $('upload-group').hidden = isLink;
  $('entry-audio').disabled = isLink;
  for (const id of ['song-link', 'song-tempo', 'song-energy']) $(id).disabled = !isLink;
}

function clearPhotoPreview() {
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls = [];
  $('photo-selection').replaceChildren();
  $('photo-selection').hidden = true;
}

function openEditor() {
  form.reset();
  $('memory-date').value = localDate();
  setSongSource();
  clearPhotoPreview();
  selectedPhotos = [];
  showMessage($('form-error'), '');
  editor.showModal();
  $('entry-text').focus();
}

function selectPhotos() {
  clearPhotoPreview();
  const files = [...photosInput.files];
  const error = files.length > MAX_PHOTOS ? 'Choose up to six photos.' : files.some((photo) => photo.size > MAX_PHOTO_SIZE) ? 'Each photo must be 12 MB or smaller.' : '';
  selectedPhotos = error ? [] : files;
  if (error) photosInput.value = '';
  showMessage($('form-error'), error);
  for (const file of selectedPhotos) {
    const image = node('img');
    image.alt = file.name;
    image.src = URL.createObjectURL(file);
    previewUrls.push(image.src);
    $('photo-selection').append(image);
  }
  $('photo-selection').hidden = !selectedPhotos.length;
}

async function createMemory(event) {
  event.preventDefault();
  if (saving) return;
  const text = $('entry-text').value.trim();
  if (!text || !selectedPhotos.length) {
    showMessage($('form-error'), 'Write about the day and attach at least one photo.');
    return;
  }
  const button = $('create-memory');
  const date = $('memory-date').value;
  const files = [...selectedPhotos];
  const source = form.elements['song-source'].value;
  saving = true;
  button.disabled = true;
  button.textContent = 'Composing…';
  showMessage($('form-error'), '');
  try {
    let music;
    if (source === 'link') {
      const link = safeLink($('song-link').value);
      music = { source, link, name: new URL(link).hostname, bpm: Number($('song-tempo').value), energy: Number($('song-energy').value) };
    } else {
      const file = $('entry-audio').files[0];
      if (!file || file.size > MAX_AUDIO_SIZE) throw new Error('Choose an audio file of up to 20 MB.');
      music = { ...await analyzeAudio(file), name: file.name, source, blob: file };
    }
    const photo = combinePalettes(await Promise.all(files.map(readPalette)));
    const day = {
      id: crypto.randomUUID(), date, created: Date.now(), text,
      photos: files.map((file) => ({ name: file.name, blob: file })), photo, music,
      design: compose({ text, photo, music, photoCount: files.length }),
    };
    await saveDay(day);
    storeError = false;
    days.push(day);
    $('entry-filter').value = 'all';
    editor.close();
    renderJournal();
    openViewer(day);
  } catch (error) {
    showMessage($('form-error'), error.name === 'QuotaExceededError' ? 'Your browser storage is full. Try smaller photos or a shorter audio file.' : error.message || 'Could not save this memory.');
  } finally {
    saving = false;
    button.disabled = false;
    button.textContent = 'Create memory';
  }
}

function fillRecipe(day) {
  const { design, music, photo, photos } = day;
  const textValue = design.textCue ? `“${design.textCue}” suggests ${moods[design.mood].label.toLowerCase()} treatment` : 'A quiet treatment for an open-ended entry';
  const bpm = music.bpm == null ? 'No steady beat detected' : music.source === 'link' ? `Described pace · about ${music.bpm} BPM` : `About ${music.bpm} BPM`;
  const entries = [
    ['Text', `${textValue}, with ${moods[design.mood].motif}.`],
    ['Photos', `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} · the dominant color (${photo.color.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}) blends into the caption and tonal grade.`],
    ['Music', `${music.name} · ${bpm} · ${Math.round(music.energy * 100)}% energy.`],
    ['Timing', `${(design.seconds / design.shotCount).toFixed(1)} sec per frame · ${design.crossfade} ms dissolve.`],
  ];
  $('memory-recipe').replaceChildren(...entries.flatMap(([term, value]) => [node('dt', '', term), node('dd', '', value)]));
}

function activateShot(index) {
  for (const shot of shots) shot.className = 'shot';
  if (shotIndex !== index) shots[shotIndex].classList.add('previous');
  shots[index].classList.add('active');
  shotIndex = index;
  const { design } = activeDay;
  scene.style.setProperty('--scene-motion', framing(index, design.motion).motion);
  const captions = design.captions ?? [design.phrase];
  const caption = captions[Math.floor(index * captions.length / shots.length)];
  const phrase = $('scene-phrase');
  if (phrase.textContent !== caption) {
    phrase.textContent = caption;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      phrase.animate([{ opacity: 0.45 }, { opacity: 1 }], Math.min(420, design.crossfade));
    }
  }
}

function openViewer(day, autoPlay = false) {
  activeDay = day;
  const { design, music } = day;
  const date = $('viewer-date');
  date.dateTime = day.date;
  date.textContent = dateLabel(day.date, dateFormat);
  $('viewer-title').textContent = design.title;
  $('scene-phrase').textContent = design.phrase;
  $('original-entry').textContent = day.text;
  fillRecipe(day);
  for (const details of viewer.querySelectorAll('details')) details.open = false;
  scene.style.setProperty('--scene-shadow', `rgb(${design.shadow.join(' ')} / .93)`);
  scene.style.setProperty('--scene-accent', `rgb(${design.accent.join(' ')})`);
  scene.style.setProperty('--scene-zoom', String(design.zoom));
  scene.style.setProperty('--scene-saturation', String(design.saturation));
  scene.style.setProperty('--scene-brightness', String(design.brightness));
  scene.style.setProperty('--scene-fade', `${design.crossfade}ms`);
  scene.style.setProperty('--shot-ms', `${design.seconds * 1000 / design.shotCount}ms`);
  shots = Array.from({ length: design.shotCount }, (_, index) => {
    const image = imageFor(day.photos[index % day.photos.length], 'shot');
    image.style.objectPosition = framing(index, design.motion).position;
    return image;
  });
  $('shot-images').replaceChildren(...shots);
  shotIndex = 0;
  activateShot(0);
  elapsed = 0;
  $('scene-progress').style.transform = 'scaleX(0)';
  $('play-label').textContent = 'Play memory';
  const linked = music.source === 'link';
  soundToggle.hidden = linked;
  $('song-open').hidden = !linked;
  if (linked) $('song-open').href = music.link;
  else {
    soundtrack.src = mediaUrl(music);
    soundtrack.muted = mute;
  }
  soundToggle.textContent = mute ? 'Unmute' : 'Mute';
  soundToggle.setAttribute('aria-pressed', String(mute));
  showMessage(viewerMessage, '');
  viewer.showModal();
  if (autoPlay) togglePlayback();
}

function pausePlayback(label = 'Resume memory') {
  playing = false;
  cancelAnimationFrame(frame);
  soundtrack.pause();
  scene.classList.add('is-paused');
  $('play-label').textContent = label;
}

function tick(now) {
  if (!playing) return;
  if (last) elapsed += now - last;
  last = now;
  const duration = activeDay.design.seconds * 1000;
  const fraction = Math.min(1, elapsed / duration);
  const index = Math.min(shots.length - 1, Math.floor(fraction * shots.length));
  if (index !== shotIndex) activateShot(index);
  $('scene-progress').style.transform = `scaleX(${fraction})`;
  if (fraction >= 1) pausePlayback('Replay memory');
  else frame = requestAnimationFrame(tick);
}

function togglePlayback() {
  if (playing) {
    pausePlayback();
    return;
  }
  if (elapsed >= activeDay.design.seconds * 1000) {
    elapsed = 0;
    scene.classList.remove('playing');
    void scene.offsetWidth;
    activateShot(0);
    if (soundtrack.src) soundtrack.currentTime = 0;
  }
  last = 0;
  playing = true;
  scene.classList.add('playing');
  scene.classList.remove('is-paused');
  $('play-label').textContent = 'Pause';
  if (activeDay.music.source !== 'link') soundtrack.play().catch(() => {
    if (playing && viewer.open) showMessage(viewerMessage, 'Sound couldn’t start. Tap Pause, then Resume memory to retry.');
  });
  frame = requestAnimationFrame(tick);
}

async function downloadMemory() {
  const button = $('export-memory');
  button.disabled = true;
  try {
    const { blob, name } = await exportDay(activeDay, assetUrl);
    const url = URL.createObjectURL(blob);
    const link = node('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    showMessage(viewerMessage, error.message || 'Could not download this memory.');
  } finally {
    button.disabled = false;
  }
}

for (const button of document.querySelectorAll('.new-memory')) button.addEventListener('click', openEditor);
for (const button of document.querySelectorAll('.close-editor')) button.addEventListener('click', () => { if (!saving) editor.close(); });
editor.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
editor.addEventListener('close', clearPhotoPreview);
form.addEventListener('submit', createMemory);
for (const radio of form.elements['song-source']) radio.addEventListener('change', setSongSource);
photosInput.addEventListener('change', selectPhotos);
$('entry-filter').addEventListener('change', renderArchive);
$('close-viewer').addEventListener('click', () => viewer.close());
$('play-scene').addEventListener('click', togglePlayback);
$('export-memory').addEventListener('click', downloadMemory);
soundToggle.addEventListener('click', () => {
  mute = !mute;
  soundtrack.muted = mute;
  soundToggle.textContent = mute ? 'Unmute' : 'Mute';
  soundToggle.setAttribute('aria-pressed', String(mute));
});
viewer.addEventListener('close', () => {
  pausePlayback();
  scene.classList.remove('playing', 'is-paused');
  soundtrack.removeAttribute('src');
  soundtrack.load();
  activeDay = null;
});

renderJournal();
fetchDays().then((saved) => {
  const currentIds = new Set(days.map((day) => day.id));
  days.push(...saved.filter((day) => !currentIds.has(day.id)));
  if (saved.length) renderJournal();
}).catch(() => {
  storeError = true;
  renderArchive();
});
