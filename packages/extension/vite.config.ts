import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import webExtension from 'vite-plugin-web-extension'
import manifest from './manifest.json' with { type: 'json' }

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
  },
  plugins: [
    vue(),
    tailwindcss(),
    webExtension({
      manifest: () => manifest,
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: false,
    emptyOutDir: true,
  },
})
