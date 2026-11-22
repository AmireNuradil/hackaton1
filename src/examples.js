import { compose } from './compose.js';

const entries = [
  ['coast', '2026-11-20', 'The last light at the coast. The sea was almost too loud for how quiet the evening felt. Salt on the car windows, a wool sweater, and the last warm bit of sunlight.', [222, 117, 67], 0.43, 72, 0.28, 'The Last Light', ['coast.webp', 'coast-detail.webp']],
  ['city', '2026-11-17', 'When the city caught fire. Neon shone in the wet pavement after the deadline. We ran for the last tram and kept laughing even after we missed it.', [41, 106, 139], 0.38, 132, 0.86, 'Red Signals'],
  ['morning', '2026-11-14', 'Coffee before the world woke. The light ran across the table while a quiet song played from the kitchen. The book stayed open to the same page all morning.', [199, 156, 91], 0.65, 60, 0.19, 'An Open Window'],
  ['forest', '2026-11-11', 'A walk into the mist. The path turned soft under our boots. We slowed down to hear the trees drip and let the morning stay still.', [91, 121, 100], 0.39, 67, 0.24, 'Between the Pines'],
  ['tide', '2026-11-08', 'Where the tide turned pink. We laughed every time the water got closer to our shoes. After a whole warm summer, this was the first afternoon that felt like ours.', [160, 140, 139], 0.67, 80, 0.43, 'The Line of Foam'],
  ['train', '2026-11-04', 'The train after dark. I missed her already. The last lights moved across the glass, and every empty platform felt like a little farewell.', [75, 101, 161], 0.34, 98, 0.39, 'Leaving the Platform'],
];

export const examples = entries.map(([id, date, text, color, light, bpm, energy, name, images = [`${id}.webp`]]) => {
  const music = { name, bpm, energy, source: 'score', path: `${id}.mp3` };
  const photo = { color, light };
  const photos = images.map((path) => ({ path, name: path }));
  return { id: `sample-${id}`, date, text, photos, music, photo, example: true, design: compose({ text, photo, music, photoCount: photos.length }) };
});
