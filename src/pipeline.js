// One path from inputs to a stored day. Samples and the author's own days both go through it.
import { combinePhotos } from './photo.js';
import { composeDay } from './system.js';
import { folderName, readText } from './text.js';

export function buildDay({ id, date, text, photos, photoReadings, music, created = Date.now(), example = false }) {
  const reading = readText(text, date);
  const photo = combinePhotos(photoReadings);
  const design = composeDay({ text, date, reading, photo, music, photoCount: photos.length });
  return { id, date, created, text, photos, music, reading, photo, design, folder: folderName(date, design.title), ...(example ? { example: true } : {}) };
}
