import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sites } from './build/sites-vite-plugin.js'

export default defineConfig({
  plugins: [react(), sites()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
  },
})
