<script setup lang="ts">
import {
  APPLICATION_TELEMETRY,
  type ApplicationTelemetryController,
  type ApplicationTelemetryStatus,
} from '@kobaproduction/browser-core'
import { Button } from '@kobaproduction/browser-ui'
import { inject, onMounted, onUnmounted, ref } from 'vue'

const controller = inject<ApplicationTelemetryController | null>(APPLICATION_TELEMETRY, null)
const busy = ref(false)
const error = ref('')
const state = ref<ApplicationTelemetryStatus | null>(null)
let cleanup: (() => void) | undefined
let disposed = false
async function refresh() {
  if (!controller) return
  try {
    const next = await controller.status()
    if (!disposed) state.value = next
  } catch {
    if (!disposed) error.value = 'Статус телеметрии недоступен.'
  }
}
async function toggle() {
  if (!controller || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await controller.setLocalEnabled(!state.value?.localEnabled)
    await refresh()
  } catch {
    error.value = 'Не удалось сохранить согласие на локальную телеметрию.'
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  cleanup = controller?.subscribe(() => {
    void refresh()
  })
  void refresh()
})
onUnmounted(() => {
  disposed = true
  cleanup?.()
})
</script>

<template>
  <section class="booster-stack-card" aria-label="Телеметрия приложения">
    <div class="booster-setting-copy">
      <b>Телеметрия приложения</b>
      <small>Единая техническая диагностика VK, ChatGPT и all-in-one. Без текста сообщений, идентификаторов переписок и токенов.</small>
    </div>
    <p v-if="!controller || state?.available === false" class="text-sm text-muted-foreground">Недоступна в этой установке.</p>
    <div v-else class="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" :disabled="busy || !state" @click="toggle">
        {{ state?.localEnabled ? 'Выключить локальный сбор' : 'Включить локальный сбор' }}
      </Button>
      <span class="text-xs text-muted-foreground">{{ state?.localEnabled ? 'Локальный сбор включён' : 'По умолчанию выключен' }}</span>
    </div>
    <small v-if="state?.localEnabled" class="text-muted-foreground">
      Ожидают доставки: {{ state.pending ?? 'недоступно' }}.
      Вытеснено по лимиту: {{ state.discarded ?? 'недоступно' }}.
    </small>
    <small class="text-muted-foreground">Отправка на сервер не настроена и выключена. Локальное согласие не включает сетевую передачу.</small>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
  </section>
</template>
