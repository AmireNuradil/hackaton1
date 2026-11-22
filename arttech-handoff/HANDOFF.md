# Afterimage handoff

## Project state

The first working ArtTech prototype was merged in [PR #2](https://github.com/AmireNuradil/hackaton1/pull/2) at `66f634e15f52cf252663e34f67b2a9b63d3cf5ba`. Its current feature path is **New memory → write the day → add photo and music → create → play → archive → download**. Six fictional days ship with it. The first pending improvement is [soundtrack comparison inside one viewer](CLAUDE-TASK.txt). The recorded baseline demonstrates the same idea with two separately created memories.

## Challenge and pitch

The [original Russian brief](ARTTECH-BRIEF-RU.txt) specifies a personal diary that preserves how a day felt. Text, photos and a song must shape one recognizable visual system. The user can revisit the result later. The submission requires a working prototype or launch instructions, a video up to three minutes, three to seven examples, a one-page design description, artistic references, code or evidence of implementation, and tool credits. The rubric awards 30 points for atmosphere, 25 for the visual system, 20 for implementation, 15 for the connection between input and output and usability, and 10 for the demo and clarity.

Lead with the memory, then replay it with a different soundtrack while the photo and words stay fixed. Give each track a few seconds of room to be heard. Finish by reopening the archive and showing the downloadable day folder. The [Russian spoken script](DEMO-RU.txt) has operator cues and a new fictional rainy-bus story. [SUBMISSION.md](../SUBMISSION.md) is the public-facing design note.

## Implementation map

| Area | Files and behavior |
|---|---|
| Authoring and playback | `index.html`, `src/main.js`, `src/style.css`. The viewer uses one audio element, successive still-photo treatments, CSS motion and dissolves, timed captions, and `requestAnimationFrame` to advance shots. `How this memory was made` surfaces text cues, photo color, musical estimates and actual frame timing. |
| Composition | `src/compose.js`. `compose({text, photo, music, photoCount})` produces title, captions, mood, shot count, duration, dissolve, and visual variables. Light and color come from photos. Music affects timing, saturation, and the strength of the movement. Short source phrases provide the title, with Russian and English mood cues. |
| Media | `src/media.js`. Canvas samples photos for dominant color and light. `OfflineAudioContext` decodes a local file and `measureMusic()` estimates tempo and energy. An autocorrelation peak check prefers a convincing shorter beat over its doubled period. The UI allows 1–6 photos with up to 12 MB each and audio up to 20 MB. |
| Persistence | `src/store.js` stores the day and its media blobs in the `days` store of `afterimage-journal` IndexedDB. `src/examples.js` supplies six bundled sample days. A `day` carries `id`, `date`, `text`, `photos`, analysed `photo` and `music`, and `design`. User days also carry `created`. |
| Portable day | `src/export.js` writes a named ZIP folder with `entry.txt`, `day.json`, media and `memory.html`. The player reads the folder's files and can run from a local static server. A linked track is exported as its link. |
| Assets | `public/memories/` contains ImageGen illustrations and original instrumental tracks. `scripts/compose-demo-audio.py` recreates the audio using Python and FFmpeg. `public/licenses/` records the runtime font and ZIP-library licenses. |
| Regression tests | `test/compose.test.js` checks independent input influence, bilingual titles, tempo, silence, link handling, palette weighting and safe export. |

## Verified evidence

- `npm test` passed seven checks. `npm run build` produced the static app. At the prototype baseline, `npm audit` reported zero vulnerabilities.
- Chromium covered audio and photo upload, audio playback and mute, HTTPS song links, persistence after reload, `My memories` filtering, desktop and mobile layout, ZIP contents, and standalone player playback after extracting and serving the day locally.
- The archived prototype ZIP ran from a nested path using only local requests. The six exported example folders each contain their own player. Run the repeatable browser check with the documented [QA commands](QA.md).
- The same rainy bus image and Russian story produced **5.0 seconds per frame and a 574 ms dissolve** with `city.mp3`, then **6.7 seconds per frame and a 1111 ms dissolve** with `coast.mp3` on the baseline build. These are measurements for this scene. Other input combinations may produce different values.

## Constraints and decisions

- The app runs in a single browser origin and keeps entries in that browser. `Download day` moves a replayable memory between devices as a standalone folder.
- A streamed song link opens in its source service. The author's pace and energy selection drive the visuals. Uploaded-file tempo is approximate and may be unavailable for weak or irregular beats.
- Demo text and people are fictional. The prototype art and bus image were generated with ImageGen. The tracks are original synthesized demo scores. The demo video has Russian captions and the spoken script is for the live presenter.
- The timing, palette, and captions already follow from the inputs without API calls. A/B preview is a usability improvement to the same design. Prioritize a clear comparison, stable playback and export before recording a new demo.

## Reference files

The reference binaries were built from `66f634e` before the new bus scene and pending viewer comparison. They give the team a working fallback and evidence for comparison. See [the file index](reference/README.md) for contents and checksums. The current [creative handoff](WORKFLOW.txt) assigns the images and speech to Codex, the implementation to Claude, and release capture to the PC.
