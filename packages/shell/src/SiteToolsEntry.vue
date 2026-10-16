<script setup lang="ts">
import { shellInstanceKey } from '@kobaproduction/browser-core'
import {
  Button,
  createSiteInjector,
  type SiteInjector,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { SHELL_UI_MESSAGES } from './ui-messages'

const text = useLocalizedText(SHELL_UI_MESSAGES)

const emit = defineEmits<{ settings: []; menu: []; available: [value: boolean] }>()
const host = shallowRef<HTMLElement | null>(null)
let injector: SiteInjector | undefined
onMounted(() => {
  injector = createSiteInjector({
    targets: [
      {
        id: 'browser-tools-header',
        selectors: ['[data-browser-tools-host]', '[role="banner"]', 'header'],
        mount(element) {
          const entry = document.createElement('div')
          entry.style.cssText = 'display:inline-flex;margin-inline-start:auto'
          const shadow = entry.attachShadow({ mode: 'open' })
          const theme = document
            .getElementById(shellInstanceKey('koba-browser-tools-root'))
            ?.shadowRoot?.querySelector('style')
          if (theme) shadow.append(theme.cloneNode(true))
          const target = document.createElement('div')
          shadow.append(target)
          element.append(entry)
          host.value = target
          emit('available', true)
          return () => {
            if (host.value === target) host.value = null
            entry.remove()
            emit('available', false)
          }
        },
      },
    ],
    onUnavailable: () => emit('available', false),
  })
})
onBeforeUnmount(() => {
  injector?.stop()
  emit('available', false)
})
</script>
<template>
  <Teleport v-if="host" :to="host"><nav aria-label="Browser Tools" class="ml-auto flex items-center gap-1 p-1"><Button type="button" variant="outline" size="sm" @click="emit('menu')">Browser Tools</Button><Button type="button" variant="ghost" size="sm" @click="emit('settings')">{{ text('Настройки Browser Tools') }}</Button></nav></Teleport>
</template>
