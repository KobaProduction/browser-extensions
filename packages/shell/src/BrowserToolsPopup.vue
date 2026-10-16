<script setup lang="ts">
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { ref } from 'vue'
import type { ApplicationIdentity } from './application'
import { SHELL_UI_MESSAGES } from './ui-messages'

const text = useLocalizedText(SHELL_UI_MESSAGES)

const props = defineProps<{
  openSettings(): Promise<void>
  openMenu(): Promise<void>
  application?: Pick<ApplicationIdentity, 'title' | 'version'>
}>()
const busy = ref(false)
const error = ref('')
async function open(action: 'settings' | 'menu') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await (action === 'settings' ? props.openSettings() : props.openMenu())
    window.close()
  } catch {
    error.value = 'Откройте поддерживаемый сайт. Если расширение ещё не загрузилось, обновите вкладку.'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <Card class="w-80 rounded-none border-0 shadow-none" :aria-busy="busy">
    <CardHeader class="gap-2 p-4">
      <CardTitle class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
        <span>{{ application?.title || 'Browser Tools' }}</span>
        <span v-if="application?.version" class="text-xs font-normal text-muted-foreground">{{ application.version }}</span>
      </CardTitle>
      <CardDescription>{{ text('Настройки приложения и инструменты текущей страницы.') }}</CardDescription>
    </CardHeader>
    <CardContent class="grid gap-2 px-4 pb-4">
      <Button type="button" :disabled="busy" @click="open('settings')">{{ text('Открыть настройки') }}</Button>
      <Button type="button" variant="outline" :disabled="busy" @click="open('menu')">{{ text('Показать меню') }}</Button>
      <Alert v-if="error" variant="destructive" class="mt-2"><AlertDescription role="status">{{ text(error) }}</AlertDescription></Alert>
    </CardContent>
  </Card>
</template>
