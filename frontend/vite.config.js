import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Explicitly allow VITE_ env vars to be injected at build time
  // (needed for Railway to pass VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL)
  envPrefix: 'VITE_',
})
