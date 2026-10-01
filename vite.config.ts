import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { attachLobbyServer } from './server/lobby-server.ts'

export default defineConfig({
  plugins: [react(), {
    name: 'local-lobbies',
    configureServer(server) {
      if (server.httpServer) attachLobbyServer(server.httpServer)
    },
  }],
})
