import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
export default defineConfig({
  root: import.meta.dirname,
  plugins: [vue(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 0,
    allowedHosts: ['terminal'],
    fs: { allow: [resolve(import.meta.dirname, '../..')] },
  },
})
