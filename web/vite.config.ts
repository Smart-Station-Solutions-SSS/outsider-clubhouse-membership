import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API runs on :4100; proxying keeps the session cookie same-origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:4100' },
  },
})
