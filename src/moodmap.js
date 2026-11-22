// The mood map: every day is a point on two axes, and the technique zones are drawn exactly where
// techniqueFor() draws them. It makes the system's rule visible instead of describing it.
import { TECHNIQUES } from './system.js';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 320;
const PAD = 30;
const INNER = SIZE - PAD * 2;
const ZONE = { kandinsky: '#3b4a8c', seurat: '#d0583c', ma: '#6f6a64', monet: '#c58a3e', film: '#b8772f' };

export const toX = (valence) => PAD + (valence + 1) / 2 * INNER;
export const toY = (arousal) => PAD + (1 - (arousal + 1) / 2) * INNER;

function el(name, attributes = {}, text) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text != null) element.textContent = text;
  return element;
}

function zones() {
  const group = el('g', { class: 'zones' });
  const mid = toY(0.12);
  const rects = [
    ['kandinsky', PAD, PAD, toX(0) - PAD, mid - PAD],
    ['seurat', toX(0), PAD, SIZE - PAD - toX(0), mid - PAD],
    ['ma', PAD, mid, toX(0.05) - PAD, SIZE - PAD - mid],
    ['monet', toX(0.05), mid, SIZE - PAD - toX(0.05), SIZE - PAD - mid],
  ];
  for (const [technique, x, y, w, h] of rects) {
    group.append(el('rect', { x, y, width: w, height: h, fill: ZONE[technique], 'fill-opacity': 0.09 }));
    const top = y < mid;
    const left = x < toX(0);
    group.append(el('text', {
      x: left ? x + 8 : x + w - 8, y: top ? y + 16 : y + h - 8, 'text-anchor': left ? 'start' : 'end', class: 'zone-label', fill: ZONE[technique],
    }, TECHNIQUES[technique].short));
  }
  group.append(el('line', { x1: PAD, x2: SIZE - PAD, y1: mid, y2: mid, class: 'axis' }));
  group.append(el('line', { x1: toX(0), x2: toX(0), y1: PAD, y2: mid, class: 'axis' }));
  group.append(el('line', { x1: toX(0.05), x2: toX(0.05), y1: mid, y2: SIZE - PAD, class: 'axis' }));
  group.append(el('rect', { x: PAD, y: PAD, width: INNER, height: INNER, class: 'frame' }));
  group.append(el('text', { x: SIZE / 2, y: SIZE - 8, 'text-anchor': 'middle', class: 'axis-label' }, 'темнее ← окраска → светлее'));
  group.append(el('text', { x: 10, y: SIZE / 2, 'text-anchor': 'middle', class: 'axis-label', transform: `rotate(-90 10 ${SIZE / 2})` }, 'тише ← подвижность → живее'));
  return group;
}

function dot(day, { current = false, onSelect } = {}) {
  const { mood, technique } = day.design;
  const group = el('g', { class: `dot${current ? ' current' : ''}${technique === 'film' ? ' film' : ''}`, tabindex: onSelect ? 0 : -1 });
  group.style.transform = `translate(${toX(mood.valence)}px, ${toY(mood.arousal)}px)`;
  if (technique === 'film') group.append(el('circle', { r: current ? 15 : 10, class: 'film-ring' }));
  group.append(el('circle', { r: current ? 8 : 5.5, fill: ZONE[technique] }));
  const label = `${day.design.title} — ${TECHNIQUES[technique].name}`;
  group.append(el('title', {}, label));
  if (onSelect) {
    group.setAttribute('role', 'button');
    group.setAttribute('aria-label', label);
    group.addEventListener('click', () => onSelect(day));
    group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(day); } });
  }
  return group;
}

export function createMoodMap(container, { label = 'Карта настроения' } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'mood-map', role: 'group', 'aria-label': label });
  svg.append(zones());
  const others = el('g', { class: 'others' });
  const currentLayer = el('g');
  svg.append(others, currentLayer);
  container.replaceChildren(svg);
  let currentDot = null;
  return {
    // Other days as faint points, the active day as a large one that glides when its mood changes.
    update({ days = [], current = null, onSelect } = {}) {
      others.replaceChildren(...days.filter((day) => day !== current && day.id !== current?.id).map((day) => dot(day, { onSelect })));
      if (!current) { currentLayer.replaceChildren(); currentDot = null; return; }
      const next = dot(current, { current: true });
      if (currentDot) {
        const from = currentDot.style.transform;
        next.style.transform = from;
        currentLayer.replaceChildren(next);
        requestAnimationFrame(() => requestAnimationFrame(() => { next.style.transform = `translate(${toX(current.design.mood.valence)}px, ${toY(current.design.mood.arousal)}px)`; }));
      } else currentLayer.replaceChildren(next);
      currentDot = next;
    },
  };
}
