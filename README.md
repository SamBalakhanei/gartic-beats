# Beat Telephone

A browser music party game for 2–8 friends. Everyone writes a prompt, receives someone else’s prompt, and has ten minutes to make one song. The host then reveals songs one at a time. The sandbox has eight synthesized instruments, an in-key piano editor, and up to four vocal layers with independent pitch/speed, trim, placement, and mix controls.

## Run locally

Use Node.js 24 LTS (`nvm use` if you use nvm), then:

```sh
npm install
npm run dev
```

Open http://localhost:5173/home. Local development now uses Cloudflare’s local runtime alongside Vite; it does not require a Cloudflare account or deploy anything. Stop it with Ctrl+C. Share the invite into another browser/tab to try multiplayer. A copied tab may copy the player session too; enter a new name if prompted.

Do not use plain HTTP on a LAN address to test microphones/WebRTC: secure browser APIs require HTTPS, except on localhost. Use the deployed HTTPS URL for separate devices.

## Deploy with a $0 hosting budget

1. Create/sign into a Cloudflare account. In **Workers & Pages → Plans**, confirm the account is on **Workers Free**. Do not upgrade or accept a paid-plan prompt. Configuration files do not control your account’s billing plan.
2. Do not enable R2, paid TURN, or other paid services. This project has no bindings for them. No custom domain is required.
3. In the project directory, run:

   ```sh
   npx wrangler login
   npm run deploy
   ```

4. Select the correct free account if you have multiple accounts. Use the HTTPS `workers.dev` address printed by Wrangler, then open `/home` and create a room. No separate frontend host is needed.
5. To update, run `npm run deploy` again after making your own commits if desired. GitHub integration is optional. No commit is made by these commands.

`npm run deploy` builds both the website and worker, then uses the generated configuration under `dist/beat_telephone`. The Vite plugin creates `.wrangler/deploy/config.json` pointing Wrangler to that output. The SQLite Durable Object migration is compatible with Workers Free.

If deployment asks for payment, stop and verify the selected account/plan. Do not solve quota failures by upgrading if your budget must remain zero. Workers/DO free limits can stop the game until limits reset; this project cannot promise unlimited availability. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Durable Object free quotas](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## How hosting and audio work

- Workers Static Assets serves the website. The Worker routes `/lobby?room=…` to one SQLite-backed Durable Object per room.
- The room stores names, private reconnect tokens, prompts, song arrangements, audio SHA-256 references, deadlines, and host/reveal state. Audio payloads are rejected. Host controls and prompt assignment remain server-authoritative.
- Rooms expire after two hours, even if active. Empty rooms are deleted. Disconnects reserve a seat for thirty seconds; host ownership transfers on leave/expiry.
- Hibernating WebSockets and persistent alarms keep deadlines and reconnect handling working when the coordinator sleeps. Small automatic ping/pong messages do not wake the room.
- Browsers establish direct WebRTC data channels. Google’s public STUN endpoint assists discovery. **There are no TURN relays and no paid fallback.** Peer networks can learn each other’s public IP addresses.
- Each completed take is hashed, split into bounded chunks, checked for valid WAV content and matching hash at the recipient, and copied to other connected players. Changing the beat BPM, sample BPM, placement, or volume reuses the same audio bytes.
- A manual submission waits up to thirty seconds for every currently connected peer to acknowledge its recordings. If sharing fails, the player sees a retry message; the arrangement has already been saved. At the ten-minute deadline, the latest saved arrangement is revealed even if sharing is unfinished.
- The lobby requires direct channel readiness for all connected players before starting. This is a connectivity check, not a guarantee that the network will remain available throughout the game.
- Results do not play partial audio: a missing take displays a waiting message. Other players who already have copies can still listen. The host can skip an unavailable song.
- Audio is held only in browser memory, bounded to 128 MiB of encoded audio / 128 takes per room. Re-recordings count toward this cache. A full cache requires a fresh room. There is **no cloud archive**. Refresh can recover audio only if another connected player still holds a copy; if everyone closes/refreshes, audio may be lost. Keep tabs open through the reveal.
- Replicated audio travels before its on-screen reveal. This is intended for private games among friends, not secrecy against someone inspecting browser internals. Server-saved prompts remain hidden until the appropriate turn/reveal.

Our instruments and piano are synthesized locally with Web Audio; only voice recordings require large transfers. Recordings remain mono 48 kHz PCM WAV. P2P does not re-encode or lower their quality. Playback uses the same saved mix and audio engine in the studio and reveal. Shared play commands are not sample-perfect synchronization across devices.

## Accepted limitations of $0 hosting

Some school, work, mobile, VPN, or restrictive home networks cannot establish direct connections. Try another network, disable a VPN if appropriate, or leave and rejoin. Without TURN, some pairs simply cannot play together. Public STUN availability is also external to this project.

Free service quotas may make rooms unavailable. Message limits and per-connection throttling reduce accidental load, but do not make a public anonymous service immune to deliberate quota exhaustion. The application never upgrades your account or purchases capacity. The $0 assumption requires keeping the Cloudflare account on the Free plan.

Players supply their own bandwidth, devices, and internet access. Hosting is the $0 constraint; those existing costs are not covered.

## Commands and verification

- `npm run dev`: Vite + local Cloudflare worker on localhost:5173.
- `npm run typecheck`: browser and worker TypeScript checks.
- `npm run build`: production website and worker build.
- `npm test`: audio, game, legacy server, manifest, and simulated peer transport regressions.
- `npm run test:cloudflare`: build, then exercise the actual local Cloudflare runtime for rooms, readiness, signaling, hibernation, reconnect, audio rejection, and host reveal controls. Test runtimes are disposed on completion.
- `npm run deploy`: build and publish using your Cloudflare account.

Automated peer tests simulate data channels; they do not prove real internet NAT traversal or microphone behavior. Browser verification is intentionally not performed. Before sharing widely, manually try two devices on different networks, record on both, submit, and listen to both reveals. Refresh one participant while another stays open to check recovery. Check failed connectivity and a disconnected sender as well.

## Code map

- `cloudflare/worker.ts`: production and local-dev room coordinator.
- `wrangler.jsonc`: free-compatible Worker/static asset/SQLite DO configuration.
- `src/p2p/Peers.ts`: peer discovery, chunk transfers, acknowledgments, and bounded recording cache.
- `src/p2p/audio.ts`: content references, integrity checks, and audio restoration.
- `src/lobby/useLobby.ts`: session restoration, coordinator connection, and peer integration.
- `server/game.ts`: shared game rules and validation (including reference-only validation).
- `server/lobby-server.ts`: retained legacy Node server for existing regression tests; it is no longer attached to Vite or deployed.
- `src/Studio.tsx`, `src/music/`: editor, synthesis, recording, and playback.
- `src/game/`: prompt turns and host-led reveal.

Sandbox edits last for the current page session. Clicking Beat Telephone leaves the room and returns to `/home`.
