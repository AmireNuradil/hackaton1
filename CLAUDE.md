# Afterimage project instructions

Afterimage is the ArtTech entry for **Make the Invisible Visible**. The browser app turns a journal entry, photos, and music into a replayable scene. The submission demonstrates how the same day can feel different when its soundtrack changes.

## Start here

- Read [the handoff](arttech-handoff/HANDOFF.md) for the architecture, decisions, evidence, and known limits. The [ArtTech brief](arttech-handoff/ARTTECH-BRIEF-RU.txt) and [submission design note](SUBMISSION.md) supply the judging context.
- Use [the continuation prompt](arttech-handoff/PROMPT.md) to start the first coding task. [The task spec](arttech-handoff/CLAUDE-TASK.txt) defines acceptance for soundtrack preview. Start implementation when the team asks for it, on a branch off `main`.
- Use Node.js 22.12+ or Node.js 20.19+ on the Node 20 line. Run `npm ci`, `npm test`, and `npm run build`. Run `npm run dev` for development or `npm run preview` to exercise the build. For a repeatable Chromium check, see the smoke test in the handoff.

## Working conventions

- Claude Code leads implementation. Codex prepares images, art direction, and the spoken pitch. The team previews the draft PR on the PC and records from the approved commit.
- Keep the app static and browser-local. The production build resolves assets relative to its deployment path. The demo supports an offline run with bundled fonts, photos and original scores.
- Reuse `compose()` and preserve the stored `day` shape and existing archive entries. Keep preview state separate from the saved record. Exports use the saved version. Uploaded audio plays in the viewer, and an HTTPS song link opens the source service with the user's own pace and energy estimates used for composition.
- Keep the editorial visual system, keyboard access, mobile layout, and reduced-motion behavior. Show design impact with a controlled comparison using the same text and photos.
- Use the supplied fictional examples or approved team media when testing or recording. Personal entries stay in each browser's IndexedDB; the project repository holds code and consented demonstration materials.
- Return the draft PR URL, exact commit, commands run, browser reproduction steps, and any blocked verification. Record a meaningful change in the handoff if it supersedes a previous decision or limitation.
