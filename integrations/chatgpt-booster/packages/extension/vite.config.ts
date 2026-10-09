import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import webExtension from 'vite-plugin-web-extension'
import manifest from './manifest.json' with { type: 'json' }

const buildSha = process.env.CHATGPT_BOOSTER_BUILD_SHA ?? ''
const buildVersion = process.env.CHATGPT_BOOSTER_BUILD_VERSION?.trim() || manifest.version

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __BOOSTER_BUILD_SHA__: JSON.stringify(buildSha),
    __BOOSTER_BUILD_VERSION__: JSON.stringify(buildVersion),
    'process.env': '{}',
  },
  plugins: [
    vue(),
    tailwindcss(),
    webExtension({
      manifest: () => ({
        ...manifest,
        version: buildVersion,
        version_name: buildVersion,
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
