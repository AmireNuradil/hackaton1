# Тон дня — project instructions

Тон дня is the team's ArtTech entry for **Make the Invisible Visible** (brief: `docs/ARTTECH-BRIEF-RU.txt`). A static browser app turns a day's text, photos and song into an animated 4:5 diary page through explicit rules, and saves a day folder.

- Use Node.js 20.19+ or 22.12+. Run `npm ci`, `npm test`, `npm run build`; `npm run preview` then `node scripts/check-browser.mjs` (needs a global Playwright) for the end-to-end check.
- Rules live in `src/system.js`; analysis in `src/text.js`, `src/photo.js`, `src/music.js`; painting in `src/render.js`. Keep analysis and rules free of DOM so Node tests cover them. Every visual decision must add a reason in `design.reasons`.
- Keep the app static, offline-capable and browser-local. Do not add network APIs or store personal entries in the repository; sample media are fictional (ImageGen images, synthesized scores).
- The UI and copy are Russian. Keep keyboard access, the phone layout (390 px, no horizontal scroll) and reduced-motion behaviour.
- Update `SUBMISSION.md` when a rule, technique or limitation changes, and regenerate `examples/` with `node scripts/export-examples.mjs`.
