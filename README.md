# Beat Telephone

A browser party game where friends turn silly prompts into music, then reinterpret what they hear.

## Current scope

A home screen, live local lobbies, and drum sandbox built with React, TypeScript, Vite, and the browser Web Audio API.

- Eight synthesized sounds: kick, snare, closed hi-hat, clap, open hi-hat, low tom, rimshot, and cowbell. No audio downloads.
- Four bars of 16 steps at 120 BPM: an eight-second loop.
- Play/stop, volume, sound previews, a playhead, and independent bar selection.
- Three starter patterns with deliberately sparse percussion, clear bar/all, and undo for the last 20 edits.
- Keyboard-accessible buttons and a stacked beat layout on small screens.

The home screen offers Create game and Go to Sandbox. Enter a guest name to create a server-owned room, then share the invite link with another browser on the same computer. The roster updates live. Only the host can request Start, and the server requires two connected players. Start broadcasts a readiness message; game rounds are not implemented yet.

Lobby membership survives refresh through a private reconnect token in per-tab session storage. Disconnects reserve a player slot for 30 seconds. Leaving immediately releases the slot; an absent host transfers ownership when their grace period expires. Rooms are stored in memory and disappear on server restart (including Vite config/server code changes). Empty rooms are deleted.

Sandbox navigation preserves the lobby connection and beat and stops audio when leaving the studio. Beat edits still reset on refresh. Timers, submissions, chain rotation, reveal, and public hosting are future steps.

## Run locally

Use Node.js 24 LTS and npm. If you use nvm, run `nvm install` and `nvm use` in this directory to use `.nvmrc`.

```sh
npm install
npm run dev
```

Open http://localhost:5173 in your browser. Keep the terminal running; press Ctrl+C to stop the server. Changes in `src/` update the page automatically. If port 5173 is occupied, stop the other server first or run `npm run dev -- --port 5174` and open that port instead.

## Commands

- `npm run dev`: start the website and WebSocket lobby server together on port 5173.
- `npm test`: run pattern integrity, non-destructive editing, and sound-generation checks, plus real WebSocket lobby integration tests.
- `npm run typecheck`: check TypeScript without building.
- `npm run build`: check TypeScript and build the site into `dist/`.
- `npm run preview`: preview the static production build only; lobby joining requires `npm run dev`. A production lobby service is not deployed yet.

## Files

- `src/App.tsx`: home, local lobby, and sandbox navigation.
- `src/Studio.tsx`: editor controls and pattern history.
- `src/lobby/lobby.ts`: shared room/message types and the connected-player start rule.
- `src/lobby/useLobby.ts`: browser connection, per-tab session restoration, and reconnect handling.
- `server/lobby-server.ts`: authoritative in-memory room service, attached to Vite at `/lobby`.
- `src/music/pattern.ts`: serializable pattern data and editing operations.
- `src/music/DrumMachine.ts`: audio-clock scheduling and output compression for overlapping voices.
- `src/music/sounds.ts`: eight synthesized percussion voices.
- `src/styles.css`: shared styles and responsive layout.
- `src/main.tsx`: React entry point.
- `vite.config.ts`: development and build configuration.

## Next milestone

Add the first synchronized prompt round after testing local joining.

## Try local joining

1. Run `npm run dev` and open http://localhost:5173.
2. Enter your name and select **Create game**, then **Copy link**.
3. Paste the invite into a fresh tab or another browser window, enter a different name, and select **Join lobby**. Each tab has its own player session. If you duplicate an existing tab, copied session storage may first show an already-connected message; enter a name to join separately.
4. Both rosters should update immediately. Start is enabled only for the host with at least two connected players.
5. Refresh a joined tab: it should reclaim its player slot rather than create a duplicate.
6. Leave as the host to see immediate host transfer, or close the host tab and wait 30 seconds for transfer.
7. Open Sandbox and return: membership remains connected and your beat is preserved.

A localhost invite works on this computer only. Do not send it to friends on other computers yet. No accounts or public deployment are included. If clipboard access fails, select and copy the visible invite field.

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
