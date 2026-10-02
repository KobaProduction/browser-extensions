<script setup lang="ts">
import type { BoosterSettings } from '@chatgpt-booster/core'
import { onMounted, ref } from 'vue'
import { chromeSettings } from '../settings'

const settings = ref<BoosterSettings>()
const ready = ref(false)

onMounted(async () => {
  settings.value = await chromeSettings.get()
  ready.value = true
})

async function persist() {
  if (settings.value) await chromeSettings.set(settings.value)
}
</script>

<template>
  <main>
    <header>
      <div>
        <strong>ChatGPT Booster</strong>
        <small>Browser tools for ChatGPT</small>
      </div>
      <span>0.1.1</span>
    </header>

    <div v-if="ready && settings" class="settings">
      <label>
        <span>
          <b>Page integration</b>
          <small>Enable all Booster integrations on ChatGPT.</small>
        </span>
        <input v-model="settings.enabled" type="checkbox" @change="persist" />
      </label>

      <label :class="{ disabled: !settings.enabled }">
        <span>
          <b>Tool inspector</b>
          <small>Reveal client-visible details for tool and MCP blocks.</small>
        </span>
        <input
          v-model="settings.features.toolInspector"
          type="checkbox"
          :disabled="!settings.enabled"
          @change="persist"
        />
      </label>
    </div>

    <p>Only runs on chatgpt.com. No chat content is sent anywhere.</p>
  </main>
</template>

<style>
:root {
  color-scheme: light dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  min-width: 340px;
  background: #18181b;
  color: #f4f4f5;
}

main {
  padding: 16px;
}

header,
label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

header {
  margin-bottom: 16px;
}

header > div,
label span {
  display: grid;
  gap: 3px;
}

header span,
small,
p {
  color: #a1a1aa;
  font-size: 12px;
}

.settings {
  display: grid;
  gap: 8px;
}

label {
  padding: 12px;
  border: 1px solid #3f3f46;
  border-radius: 12px;
}

label.disabled {
  opacity: 0.5;
}

p {
  margin: 14px 2px 0;
  line-height: 1.4;
}
</style>
