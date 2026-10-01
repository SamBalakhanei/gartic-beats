# Beat Telephone

A browser party game where friends turn silly prompts into music, then reinterpret what they hear.

## Current scope

Project initialization only: React, TypeScript, Vite, and a responsive placeholder page. Rooms, audio editing, game rounds, and the reveal are not implemented yet.

## Run locally

Use Node.js 24 LTS and npm. If you use nvm, run `nvm install` and `nvm use` in this directory to use `.nvmrc`.

```sh
npm install
npm run dev
```

Open http://localhost:5173 in your browser. Keep the terminal running; press Ctrl+C to stop the server. Changes in `src/` update the page automatically. If port 5173 is occupied, stop the other server first or run `npm run dev -- --port 5174` and open that port instead.

## Commands

- `npm run dev`: start the local development server.
- `npm run typecheck`: check TypeScript without building.
- `npm run build`: check TypeScript and build the site into `dist/`.
- `npm run preview`: preview the production build locally after building.

## Files

- `src/App.tsx`: the initial page.
- `src/styles.css`: shared styles and responsive layout.
- `src/main.tsx`: React entry point.
- `vite.config.ts`: development and build configuration.

## Next milestone

Prototype a single music turn: a small drum step grid with playback, before adding multiplayer.
