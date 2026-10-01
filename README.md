# Beat Telephone

A browser party game where friends turn silly prompts into music, then reinterpret what they hear.

## Current scope

A local drum-editor prototype built with React, TypeScript, Vite, and the browser Web Audio API.

- Four synthesized sounds: kick, snare, hi-hat, and cowbell. No audio downloads.
- Four bars of 16 steps at 120 BPM: an eight-second loop.
- Play/stop, volume, sound previews, a playhead, and independent bar selection.
- Three starter patterns, clear bar/all, and undo for the last 20 edits.
- Keyboard-accessible buttons and a stacked beat layout on small screens.

This is a practice screen with a fixed example prompt. Edits are held in memory and reset on refresh. Rooms, saved drafts, timers, submission, and reveal are not implemented yet.

## Run locally

Use Node.js 24 LTS and npm. If you use nvm, run `nvm install` and `nvm use` in this directory to use `.nvmrc`.

```sh
npm install
npm run dev
```

Open http://localhost:5173 in your browser. Keep the terminal running; press Ctrl+C to stop the server. Changes in `src/` update the page automatically. If port 5173 is occupied, stop the other server first or run `npm run dev -- --port 5174` and open that port instead.

## Commands

- `npm run dev`: start the local development server.
- `npm test`: run pattern integrity and non-destructive editing checks.
- `npm run typecheck`: check TypeScript without building.
- `npm run build`: check TypeScript and build the site into `dist/`.
- `npm run preview`: preview the production build locally after building.

## Files

- `src/App.tsx`: editor controls and pattern history.
- `src/music/pattern.ts`: serializable pattern data and editing operations.
- `src/music/DrumMachine.ts`: sound synthesis and audio-clock scheduling.
- `src/styles.css`: shared styles and responsive layout.
- `src/main.tsx`: React entry point.
- `vite.config.ts`: development and build configuration.

## Next milestone

Playtest this editor before adding game rounds and multiplayer.

## Try the editor

1. Press **Play beat** to hear the initial Sneaky steps pattern. Audio starts only after an interaction.
2. Tap squares to change the rhythm while it plays. The white outline shows the current step; the bar indicator shows the current playback bar.
3. Select another bar to edit it. Bar selection does not jump playback.
4. Tap an instrument name to preview its sound. Adjust Volume as needed.
5. Try a starter, Clear bar, or Clear all, then Undo to recover the previous pattern.
6. Switching away from the tab stops playback; press Play again when you return.

## Playback notes

The engine schedules sounds slightly ahead against `AudioContext.currentTime`, following the [Web Audio sequencing approach](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques). Edits affect future steps; a sound already queued within the next 100 ms may still play. Playback restarts from bar 1. Audio context cleanup handles page/component teardown.

For manual checks, test playback, stop/restart, volume at zero, all three presets, undo after clearing, each bar, and a narrow phone viewport. Automated pattern checks do not verify audible output or browser-specific audio behavior.
