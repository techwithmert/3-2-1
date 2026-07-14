import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // relative base so the site works at any path (GitHub Pages serves it
  // from /3-2-1/, Vercel from /)
  base: './',
  plugins: [react()],
})
