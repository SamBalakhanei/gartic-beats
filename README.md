# Beat Telephone

A browser party game where friends turn silly prompts into music, then reinterpret what they hear.

## Current scope

A home screen, live local lobbies, and drum sandbox built with React, TypeScript, Vite, and the browser Web Audio API.

- Eight synthesized sounds: kick, snare, closed hi-hat, clap, open hi-hat, low tom, rimshot, and cowbell. No audio downloads.
- Four bars of 16 steps with an editable tempo from 40–240 BPM (120 by default). The loop duration updates with tempo.
- Play/stop, volume, sound previews, a playhead, and independent bar selection.
- Three starter patterns with deliberately sparse percussion, clear bar/all, and undo for the last 20 edits.
- Keyboard-accessible buttons and a stacked beat layout on small screens.

The home screen offers Create game and Go to Sandbox. Enter a guest name to create a server-owned room, then share the invite link with another browser on the same computer. The roster updates live. Only the host can request Start, and the server requires two connected players. Start opens a prompt-writing round for every connected player. After everyone submits, the server randomly assigns each prompt to someone else and starts a shared 10-minute song round. Each person makes one song. Results open when everyone submits or time expires, with playback, prompts, and credits for every song.

Lobby membership survives refresh through a private reconnect token in per-tab session storage. Disconnects reserve a player slot for 30 seconds. Leaving immediately releases the slot; an absent host transfers ownership when their grace period expires. Rooms are stored in memory and disappear on server restart (including Vite config/server code changes). Empty rooms are deleted.

Sandbox navigation preserves the lobby connection and beat and stops audio when leaving the studio. Beat edits still reset on refresh. The current game is a single prompt-to-song round. Longer telephone chains and public hosting are future steps.

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
- `src/Studio.tsx`: shared sandbox/game editor controls and pattern history.
- `src/game/GameScreen.tsx`: prompt form, round timer, submission, and results playback.
- `server/game.ts`: game state, assignment, validation, and per-player views.
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

Playtest the single-song round before expanding the game.

## Try local joining

1. Run `npm run dev` and open http://localhost:5173.
2. Enter your name and select **Create game**, then **Copy link**.
3. Paste the invite into a fresh tab or another browser window, enter a different name, and select **Join lobby**. Each tab has its own player session. If you duplicate an existing tab, copied session storage may first show an already-connected message; enter a name to join separately.
4. Both rosters should update immediately. Start is enabled only for the host with at least two connected players.
5. Refresh a joined tab: it should reclaim its player slot rather than create a duplicate.
6. Leave as the host to see immediate host transfer, or close the host tab and wait 30 seconds for transfer.
7. Open Sandbox and return: membership remains connected and your beat is preserved.

A localhost invite works on this computer only. Do not send it to friends on other computers yet. No accounts or public deployment are included. If clipboard access fails, select and copy the visible invite field.

## Play a round

1. Join from two or more tabs and have the host select **Start game**.
2. Every player writes and submits a prompt (1–240 characters). There is no prompt timer yet.
3. When all prompts are ready, each player receives someone else's prompt and a blank studio. The shared song deadline is fixed at 10 minutes. Each prompt is used once.
4. Edit the rhythm and BPM. Each edit is sent to the server; **All changes saved** means the server acknowledged it. Refreshing restores the latest saved draft and the same assignment/deadline. Editing pauses while disconnected.
5. **Record voice** captures a vocal take over one loop (headphones recommended). Preview with **Play song**, add up to four layers, or select a take to replace or delete. A completed, non-silent recording is required for manual submission.
6. **Submit song** locks the song and waits for the remaining players. When everyone submits, or the deadline passes, all players see the results.
7. Play a song beside its creator's name. The prompt and prompt author are shown; switching tracks stops the previous one. Empty songs are identified explicitly.

The server owns phase transitions, deadlines, assignments, and validation. Other prompts and songs are not sent to players before results. Deadline submissions use the last server-saved draft; no browser tab needs to stay active for the deadline to fire. Unsent edits during a connection failure cannot be recovered by the server.

Players who leave or exceed the 30-second reconnect grace period do not block the game. Missing prompts receive a fallback; departed players' saved songs are finalized automatically. The original participant list and contributions remain in results. New players cannot join an active or completed game; create a new lobby for another round. Rooms and game data still disappear on a server restart.

## Try the editor

1. From home, choose **Go to Sandbox**, then press **Play beat** to hear the initial Soul Chop pattern. Audio starts only after an interaction.
2. Tap squares to change the rhythm while it plays. The white outline shows the current step; the bar indicator shows the current playback bar.
3. Select another bar to edit it. Bar selection does not jump playback.
4. Tap an instrument name to preview its sound. Adjust Volume or BPM as needed. Tempo changes work during playback without restarting the loop; the playhead follows the scheduled audio. Clear/preset/undo actions edit notes only and keep your chosen tempo.
5. Try a starter, Clear bar, or Clear all, then Undo to recover the previous pattern.
6. Switching away from the tab stops playback; press Play again when you return.

## Starter directions

These original drum sketches explore the soulful-to-industrial range of the project's early-2000s-to-2010s hip-hop reference:

- **Soul Chop:** a half-time backbeat, syncopated kicks, and skipping hats.
- **Stadium Glow:** full backbeats, layered claps, open hats, and a closing tom fill.
- **Industrial Stomp:** clustered kicks, metallic accents, and deliberate empty space.

Each has four distinct bars. They keep your selected tempo on the existing step grid and synthesized kit; they do not yet include sample chops, pitched instruments, swing timing, or distortion. They are original patterns, not transcriptions of songs.

## Playback notes

The engine schedules sounds slightly ahead against `AudioContext.currentTime`, following the [Web Audio sequencing approach](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques). Edits affect future steps; a sound already queued within the next 100 ms may still play. Tempo changes take effect as subsequent notes are scheduled; the next already-planned step retains its timestamp. Playback restarts from bar 1. Audio context cleanup handles page/component teardown.

For manual checks, test playback, stop/restart, volume at zero, all three presets, undo after clearing, each bar, and a narrow phone viewport. Automated pattern checks do not verify audible output or browser-specific audio behavior.


## Voice recording

Microphone access is requested only when Record voice is pressed. Takes are converted to mono 48 kHz, 16-bit PCM WAV, stored in the current room's memory with the song, and revealed only with results. Recording lasts one loop (4–24 seconds), or can be stopped early; early takes are padded with silence. Re-recording keeps the previous take until a replacement succeeds. A silent take is rejected, but the app does not attempt speech recognition or judge the lyrics.

The microphone is released after stopping, cancelling, hiding/leaving the page, or the turn ending. Permission denial and unsupported browsers show an error. A recording still being processed at the deadline is not included: results use the last completed server-saved take. Beat-only timeout results are explicitly labeled.

Changing beat BPM keeps every recording. Each vocal layer has an independent sample BPM: increasing it raises both speed and pitch, with a **2× chipmunk** shortcut. Pitch-preserving time stretching is not implemented. Timing changes restart playback from the beginning; volume changes are live.

Record beside the BPM control, in either the sandbox or a game. Up to four vocal layers can overlap. Select a timeline lane to edit its name, sample BPM, volume, and start position. Drag a clip to move it, or drag either edge to trim the audio without changing pitch. Snap rounds edits to the step grid; turn it off or hold Shift for fine placement. Arrow keys move a focused clip or trim handle, Escape cancels a drag, and Undo reverses one complete gesture. Reset trim restores the original source range. Edits preview while dragging and save on release. Each clip plays once per four-bar loop; tails beyond the last bar are cut off. Recording a new layer plays the current mix for reference; use headphones to avoid recording speaker audio.

The mixer saves separate beat and voice levels, plus each layer's own volume. Drafts save after a short 200 ms pause in editing; manual submission sends the complete current song. Reconnecting restores these settings, and the post-game player uses the same audio engine and mix. Sandbox changes last for the current page session. Audio remains in server memory and is lost when the server restarts.


## Shared reveal

Results show one player's song and assigned prompt at a time. The server owns the current reveal and only the current room host can move Previous/Next or Play/Stop for everyone. Changing songs stops playback. Only the current result is sent in reveal snapshots, and reconnecting restores that selection. Host transfer uses the existing lobby rules.

Each device must enable sound once; listeners can mute locally. Playback follows host commands but is not sample-synchronized across devices. Enabling sound mid-song or returning to the tab starts the current loop locally. On the final song, the host can revisit earlier songs with Previous.


Recording quality is automatic: the browser is asked for a 48 kHz mono microphone signal with speech processing (echo cancellation, noise suppression, and automatic gain) disabled. Capture prefers PCM when supported, otherwise requests 256 kbps compressed audio. Browser/device support determines the actual capture format; saving a WAV does not undo compression applied during capture. Browser audio rendering handles resampling and downmixing. Older 16 kHz takes remain playable. Headphones avoid capturing the beat from speakers. Four maximum-length recordings fit the server message limit; audio remains in RAM.
