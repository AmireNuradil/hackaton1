# Verified baseline materials

These files capture Afterimage at `66f634e15f52cf252663e34f67b2a9b63d3cf5ba`. The later fictional bus image is in `../assets/last-bus.webp` and has its own spoken script in `../DEMO-RU.txt`.

| File | Contents |
|---|---|
| `afterimage-demo.mp4` | 61-second Chromium screen recording with Russian captions and original scores. It shows memory creation, a soundtrack comparison with two entries, archive replay and export. |
| `afterimage-prototype.zip` | Static browser build with six bundled examples. Extract the `Afterimage` folder and serve it from a local HTTP server. The ZIP includes start instructions. |
| `afterimage-six-sample-days.zip` | Six exported memory folders, each with original input, metadata, assets, and its own `memory.html`. |
| `afterimage-example-day.zip` | Export of the two-photo browser test entry with an uploaded score. Useful for checking `day.json` and local playback. |
| `afterimage-journal.png`, `afterimage-memory.png` | Desktop archive and example viewer. |
| `afterimage-mobile.png`, `afterimage-mobile-editor.png` | Mobile archive and creation form. |

Verify the binary files in this folder with `sha256sum -c SHA256SUMS`.
