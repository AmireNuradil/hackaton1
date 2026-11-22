# Claude Code continuation prompt

You are the coding lead for Afterimage, the team's ArtTech competition entry. Use the checked-out repository as your source of truth. Read `CLAUDE.md`, `arttech-handoff/HANDOFF.md`, `arttech-handoff/CLAUDE-TASK.txt`, and `arttech-handoff/DEMO-RU.txt` before editing. Check the current base commit and status, then take a separate branch off `main`.

Implement the first pending task: an in-viewer soundtrack comparison for a single saved memory. The jury should hear and see two treatments of the same story and photos in one viewer. Reuse the bundled scores, existing `compose()` logic, and the current viewer. Make the selected track and its effect on timing legible. Make the preview temporary and keep the saved soundtrack and composition the source for archive replay and ZIP export. Check both uploaded audio and saved song links. Preserve the visual system, accessibility, and static, offline-capable build.

First inspect how `openViewer`, `activateShot`, `tick`, `togglePlayback`, and `downloadMemory` share `activeDay`. Keep the persisted entry and the preview view model distinct. When switching tracks, use one audio element and one animation loop. Exercise close, reopen, reload, and export while the preview is active.

Run `npm test` and `npm run build`. Rehearse in Chromium on a desktop and narrow viewport. Use the instructions in the task file to verify the preview state and export. Return a draft pull request targeting `main` with the exact commit, test results, browser reproduction steps, and any blocked checks. The team handles approval and merge.
