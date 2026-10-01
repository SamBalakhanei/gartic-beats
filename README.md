# Beat Telephone

A browser party game where friends turn silly prompts into music, then reinterpret what they hear.

## Current scope

A home screen, local lobby preview, and drum sandbox built with React, TypeScript, Vite, and the browser Web Audio API.

- Eight synthesized sounds: kick, snare, closed hi-hat, clap, open hi-hat, low tom, rimshot, and cowbell. No audio downloads.
- Four bars of 16 steps at 120 BPM: an eight-second loop.
- Play/stop, volume, sound previews, a playhead, and independent bar selection.
- Three starter patterns with deliberately sparse percussion, clear bar/all, and undo for the last 20 edits.
- Keyboard-accessible buttons and a stacked beat layout on small screens.

The home screen offers Create game and Go to Sandbox. Create game creates a local lobby with you as host; add local guest names to preview the roster. Start game appears only with a lobby and is disabled below two players. At two or more players it shows a readiness message; it does not start rounds yet. Guests are local entries, not connected users.

Sandbox is the practice studio with a fixed example prompt. Navigation preserves the lobby and beat, stops audio when leaving the studio, and supports browser back/forward through hash links. Edits are held in memory and reset on refresh. Online rooms and joining, saved drafts, timers, submission, and reveal are not implemented yet.

## Run locally

Use Node.js 24 LTS and npm. If you use nvm, run `nvm install` and `nvm use` in this directory to use `.nvmrc`.

```sh
npm install
npm run dev
```

Open http://localhost:5173 in your browser. Keep the terminal running; press Ctrl+C to stop the server. Changes in `src/` update the page automatically. If port 5173 is occupied, stop the other server first or run `npm run dev -- --port 5174` and open that port instead.

## Commands

- `npm run dev`: start the local development server.
- `npm test`: run pattern integrity, non-destructive editing, and sound-generation checks.
- `npm run typecheck`: check TypeScript without building.
- `npm run build`: check TypeScript and build the site into `dist/`.
- `npm run preview`: preview the production build locally after building.

## Files

- `src/App.tsx`: home, local lobby, and sandbox navigation.
- `src/Studio.tsx`: editor controls and pattern history.
- `src/lobby/lobby.ts`: local roster operations and the two-player start rule.
- `src/music/pattern.ts`: serializable pattern data and editing operations.
- `src/music/DrumMachine.ts`: audio-clock scheduling and output compression for overlapping voices.
- `src/music/sounds.ts`: eight synthesized percussion voices.
- `src/styles.css`: shared styles and responsive layout.
- `src/main.tsx`: React entry point.
- `vite.config.ts`: development and build configuration.

## Next milestone

Playtest this editor before adding game rounds and multiplayer.

## Try the editor

1. From home, choose **Go to Sandbox**, then press **Play beat** to hear the initial Soul Chop pattern. Audio starts only after an interaction.
2. Tap squares to change the rhythm while it plays. The white outline shows the current step; the bar indicator shows the current playback bar.
3. Select another bar to edit it. Bar selection does not jump playback.
4. Tap an instrument name to preview its sound. Adjust Volume as needed.
5. Try a starter, Clear bar, or Clear all, then Undo to recover the previous pattern.
6. Switching away from the tab stops playback; press Play again when you return.

## Starter directions

These original drum sketches explore the soulful-to-industrial range of the project's early-2000s-to-2010s hip-hop reference:

- **Soul Chop:** a half-time backbeat, syncopated kicks, and skipping hats.
- **Stadium Glow:** full backbeats, layered claps, open hats, and a closing tom fill.
- **Industrial Stomp:** clustered kicks, metallic accents, and deliberate empty space.

Each has four distinct bars. They use the existing fixed 120 BPM grid and synthesized kit; they do not yet include sample chops, pitched instruments, swing timing, or distortion. They are original patterns, not transcriptions of songs.

## Playback notes

The engine schedules sounds slightly ahead against `AudioContext.currentTime`, following the [Web Audio sequencing approach](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques). Edits affect future steps; a sound already queued within the next 100 ms may still play. Playback restarts from bar 1. Audio context cleanup handles page/component teardown.

For manual checks, test playback, stop/restart, volume at zero, all three presets, undo after clearing, each bar, and a narrow phone viewport. Automated pattern checks do not verify audible output or browser-specific audio behavior.
