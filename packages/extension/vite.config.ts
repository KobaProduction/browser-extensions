import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import webExtension from 'vite-plugin-web-extension'
import manifest from './manifest.json' with { type: 'json' }

export default defineConfig({
  plugins: [
    vue(),
    webExtension({
      manifest: () => manifest,
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
  },
})
