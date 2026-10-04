import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import webExtension from 'vite-plugin-web-extension'
import manifest from './manifest.json' with { type: 'json' }

const buildSha = process.env.CHATGPT_BOOSTER_BUILD_SHA ?? ''
const displayBaseVersion = manifest.version.split('.').slice(0, 2).join('.')

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __BOOSTER_BUILD_SHA__: JSON.stringify(buildSha),
    'process.env': '{}',
  },
  plugins: [
    vue(),
    tailwindcss(),
    webExtension({
      manifest: () => ({
        ...manifest,
        version_name: buildSha
          ? `${displayBaseVersion}-${buildSha.slice(0, 8)}`
          : displayBaseVersion,
      }),
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: false,
    emptyOutDir: true,
  },
})
