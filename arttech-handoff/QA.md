# Rehearsal and verification

## Check the project

From the repository root:

```bash
npm ci
npm test
npm run build
npm run preview
```

Keep the preview server running. With Python Playwright and Chromium available in your environment, run in a second terminal:

```bash
python3 arttech-handoff/check_browser.py
```

The browser check uses only a fresh browser profile, bundled media, and local HTTP. If needed, install `playwright` in a Python virtual environment and run `python3 -m playwright install chromium` there. The check uses an installed Chromium when it finds one, or accepts `--chromium /path/to/chromium`. Pass `--url` if your preview server assigned a different port.

The check creates three days in a temporary browser profile, tests the linked and uploaded tracks, verifies ZIP content and the extracted player's audio, reloads the archive, and checks mobile layout. It includes the rainy-bus comparison with two separately saved records. When adding the in-viewer compare feature, extend the checks with the cases in [CLAUDE-TASK.txt](CLAUDE-TASK.txt).

## Record from the PC

Use the [spoken script](DEMO-RU.txt) and check the recording against [the challenge brief](ARTTECH-BRIEF-RU.txt). The baseline video was made by recording a Chromium session, then adding the original scores and Russian subtitles with FFmpeg. Re-record it after the team approves the in-viewer comparison. Leave a few seconds to hear each track and show the timing in the viewer. Close with a reload of the archive and a downloaded day folder.

For comparison, the [baseline video and sample ZIPs](reference/README.md) are preserved on the branch. Use the exact approved source commit and note it with the final recording. Upload via the event's submission channel when the organizers provide it.
