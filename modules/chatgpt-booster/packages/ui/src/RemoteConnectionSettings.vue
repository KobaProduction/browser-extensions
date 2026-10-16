<script setup lang="ts">
import type { ChatGptAutomationControl, SecretAdapter } from '@chatgpt-booster/core'
import type { RemoteSessionConfig } from '@kobaproduction/browser-core'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingRow,
  Skeleton,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { LoaderCircle } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { AUTOMATION_UI_MESSAGES } from './i18n/automation'

const text = useLocalizedText(AUTOMATION_UI_MESSAGES)

const props = defineProps<{
  configuration: RemoteSessionConfig
  secrets?: SecretAdapter
  control?: ChatGptAutomationControl
  disabled?: boolean
  saveConfiguration: (patch: Partial<RemoteSessionConfig>) => Promise<boolean>
}>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const id = useId()
const endpoint = ref(props.configuration.endpoint),
  token = ref(''),
  hasToken = ref(false)
const operation = ref<'probe' | 'save' | 'delete-token' | null>(null),
  tokenLoading = ref(true)
const error = ref(''),
  notice = ref('')
const verified = ref<{ endpoint: string; token: string } | null>(null)
const busy = computed(() => operation.value !== null)
const unavailable = computed(() => busy.value || props.disabled || tokenLoading.value)
const changed = computed(
  () => endpoint.value.trim() !== props.configuration.endpoint || Boolean(token.value),
)
const canSave = computed(
  () =>
    changed.value &&
    verified.value?.endpoint === endpoint.value.trim() &&
    verified.value?.token === token.value &&
    !unavailable.value,
)
const canConnect = computed(() =>
  Boolean(props.configuration.endpoint && hasToken.value && props.configuration.mode !== 'local-only'),
)
let generation = 0,
  disposed = false
let probeAbort: AbortController | undefined
watch(operation, (value) => emit('busy', value !== null), { flush: 'sync' })
watch(
  () => props.configuration.endpoint,
  (value) => {
    endpoint.value = value
  },
)
watch(
  [endpoint, token],
  () => {
    verified.value = null
    error.value = ''
    notice.value = ''
    probeAbort?.abort()
  },
  { flush: 'sync' },
)
watch(
  [() => props.secrets, () => props.control],
  async ([secrets]) => {
    const current = ++generation
    probeAbort?.abort()
    verified.value = null
    tokenLoading.value = true
    hasToken.value = false
    try {
      const present = Boolean(await secrets?.getRemoteToken?.())
      if (current === generation) hasToken.value = present
    } catch {
      if (current === generation)
        error.value = 'Не удалось прочитать состояние токена. Повторно откройте раздел.'
    } finally {
      if (current === generation) tokenLoading.value = false
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  disposed = true
  generation++
  probeAbort?.abort()
  token.value = ''
  verified.value = null
  emit('busy', false)
})

async function checkConnection() {
  if (!props.control || unavailable.value) return
  const control = props.control,
    secrets = props.secrets,
    current = generation
  const candidate = { endpoint: endpoint.value.trim(), token: token.value }
  probeAbort?.abort()
  probeAbort = new AbortController()
  const signal = probeAbort.signal
  operation.value = 'probe'
  error.value = ''
  notice.value = ''
  verified.value = null
  try {
    const accessToken = candidate.token || (await secrets?.getRemoteToken?.()) || ''
    if (signal.aborted || current !== generation) return
    const result = await control.probe({ endpoint: candidate.endpoint, token: accessToken, signal })
    if (
      signal.aborted ||
      current !== generation ||
      disposed ||
      control !== props.control ||
      secrets !== props.secrets ||
      candidate.endpoint !== endpoint.value.trim() ||
      candidate.token !== token.value
    )
      return
    if (!result.ok) {
      error.value =
        result.errorCode === 'authentication-failed'
          ? 'Сервер отклонил токен.'
          : result.errorCode === 'invalid-configuration'
            ? 'Укажите wss:// адрес. Для локального сервера допустим ws://localhost.'
            : result.errorCode === 'timeout'
              ? 'Сервер не подтвердил доступ вовремя.'
              : 'Не удалось подключиться к серверу. Проверьте адрес и доступность сети.'
      return
    }
    verified.value = candidate
    notice.value = changed.value
      ? 'Авторизация подтверждена. Можно сохранить подключение.'
      : 'Подключение проверено. Текущие параметры уже сохранены.'
  } catch {
    if (!signal.aborted && !disposed && current === generation)
      error.value = 'Не удалось проверить подключение.'
  } finally {
    operation.value = null
  }
}
async function saveConnection() {
  const candidate = verified.value,
    secrets = props.secrets,
    current = generation
  if (!candidate || !canSave.value) return
  operation.value = 'save'
  error.value = ''
  notice.value = ''
  try {
    if (candidate.token) {
      if (!secrets?.setRemoteToken) throw Error('Credential storage unavailable')
      await secrets.setRemoteToken(candidate.token)
    }
    if (
      disposed ||
      current !== generation ||
      secrets !== props.secrets ||
      candidate.endpoint !== endpoint.value.trim() ||
      candidate.token !== token.value
    )
      return
    if (candidate.token) hasToken.value = true
    if (!(await props.saveConfiguration({ endpoint: candidate.endpoint, enabled: false })))
      throw Error('Configuration write was not acknowledged')
    if (disposed || current !== generation) return
    token.value = ''
    verified.value = null
    notice.value = 'Подключение сохранено. Выберите режим доставки и включите обмен.'
  } catch {
    if (!disposed && current === generation) error.value = 'Не удалось сохранить подключение.'
  } finally {
    operation.value = null
  }
}
async function removeToken() {
  const secrets = props.secrets,
    current = generation
  if (unavailable.value || !hasToken.value || !secrets?.setRemoteToken) return
  operation.value = 'delete-token'
  error.value = ''
  notice.value = ''
  try {
    await secrets.setRemoteToken('')
    if (disposed || current !== generation || secrets !== props.secrets) return
    hasToken.value = false
    token.value = ''
    verified.value = null
    if (!(await props.saveConfiguration({ enabled: false }))) throw Error('Configuration write failed')
  } catch {
    if (!disposed && current === generation) error.value = 'Не удалось удалить токен.'
  } finally {
    operation.value = null
  }
}
async function removeEndpoint() {
  if (unavailable.value || !props.configuration.endpoint) return
  operation.value = 'save'
  error.value = ''
  try {
    if (!(await props.saveConfiguration({ endpoint: '', enabled: false })))
      throw Error('Configuration write failed')
    if (disposed) return
    endpoint.value = ''
    verified.value = null
  } catch {
    if (!disposed) error.value = 'Не удалось удалить сохранённый адрес.'
  } finally {
    operation.value = null
  }
}
async function saveOption(patch: Partial<RemoteSessionConfig>) {
  if (unavailable.value) return
  operation.value = 'save'
  error.value = ''
  try {
    if (!(await props.saveConfiguration(patch))) throw Error('Configuration write failed')
  } catch {
    if (!disposed) error.value = 'Не удалось сохранить настройки подключения.'
  } finally {
    operation.value = null
  }
}
</script>

<template>
  <Card class="min-w-0">
    <CardHeader class="p-4 pb-3"><CardTitle class="text-base">{{ text('Подключение к серверу') }}</CardTitle><CardDescription>{{ text('Проверьте адрес и доступ, сохраните параметры, затем включите обмен.') }}</CardDescription></CardHeader>
    <CardContent class="space-y-3 p-4 pt-0" :aria-busy="busy || tokenLoading">
      <div class="grid min-w-0 gap-3 min-[1024px]:grid-cols-2">
        <div class="grid min-w-0 content-start gap-2">
          <Label :for="`${id}-endpoint`">{{ text('Адрес WebSocket') }}</Label>
          <Input :id="`${id}-endpoint`" v-model="endpoint" :disabled="unavailable" placeholder="wss://server.example/socket" autocomplete="off" :spellcheck="false" maxlength="2048" />
          <div v-if="configuration.endpoint" class="flex min-w-0 flex-wrap items-center justify-between gap-2"><Badge variant="outline">{{ endpoint.trim() === configuration.endpoint ? text('Адрес сохранён') : text('Адрес изменён, не сохранён') }}</Badge><Button variant="ghost" size="sm" :disabled="unavailable" :aria-label="text('Удалить сохранённый адрес')" @click="removeEndpoint">{{ text('Удалить адрес') }}</Button></div>
        </div>
        <div class="grid min-w-0 content-start gap-2">
          <Label :for="`${id}-token`">{{ hasToken ? text('Заменить токен доступа') : text('Токен доступа') }}</Label>
          <Skeleton v-if="tokenLoading" class="h-9 w-full" :aria-label="text('Читаем состояние токена')" />
          <Input v-else :id="`${id}-token`" v-model="token" type="password" autocomplete="new-password" :disabled="unavailable || !secrets?.setRemoteToken" maxlength="8192" :placeholder="hasToken ? text('Сохранённый токен скрыт') : text('Токен сервера')" />
          <div v-if="hasToken" class="flex min-w-0 flex-wrap items-center justify-between gap-2"><span class="text-xs text-muted-foreground">{{ text('Токен сохранён отдельно от бэкапов') }}</span><Button variant="ghost" size="sm" :disabled="unavailable" @click="removeToken">{{ operation === 'delete-token' ? text('Удаляем токен…') : text('Удалить токен') }}</Button></div>
        </div>
      </div>
      <div class="flex min-h-9 flex-wrap gap-2"><Button variant="outline" :disabled="unavailable || !control || !endpoint.trim() || (!token && !hasToken)" @click="checkConnection"><LoaderCircle v-if="operation === 'probe'" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ operation === 'probe' ? text('Проверяем…') : text('Проверить подключение') }}</Button><Button v-if="canSave || operation === 'save'" :disabled="unavailable" @click="saveConnection"><LoaderCircle v-if="operation === 'save'" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ operation === 'save' ? text('Сохраняем…') : text('Сохранить подключение') }}</Button></div>
      <Alert v-if="error" variant="destructive"><AlertDescription>{{ text(error) }}</AlertDescription></Alert>
      <p v-if="notice" role="status" class="text-sm text-success">{{ text(notice) }}</p>
      <p v-if="!control" class="text-xs text-muted-foreground">{{ text('В этом просмотре проверка соединения недоступна.') }}</p>
      <div class="grid min-w-0 gap-2"><Label :for="`${id}-mode`">{{ text('Хранение сообщений') }}</Label><Select :model-value="configuration.mode" :disabled="unavailable" @update:model-value="saveOption( { mode: $event as RemoteSessionConfig['mode'] })"><SelectTrigger :id="`${id}-mode`"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="local-only">{{ text('Только локально') }}</SelectItem><SelectItem value="local-and-remote">{{ text('Локально и на сервере') }}</SelectItem><SelectItem value="remote-only">{{ text('Только на сервере') }}</SelectItem></SelectContent></Select></div>
      <SettingRow flat :id="`${id}-enabled`" :title="text('Включить подключение')" :description="text('При обрыве связи повторяем подключение автоматически.')" :model-value="configuration.enabled" :disabled="unavailable || !canConnect" @update:model-value="saveOption( { enabled: $event })" />
      <p v-if="!canConnect" class="text-xs leading-5 text-muted-foreground">{{ text('Для включения нужны сохранённые адрес, токен и режим доставки на сервер.') }}</p>
      <SettingRow flat :id="`${id}-raw`" :title="text('Разрешить исходные пакеты')" :description="text('Сервер сможет запросить исходный формат при изменении API сайта. Без запроса передаётся нормализованная модель.')" :model-value="configuration.rawEvents" :disabled="unavailable" @update:model-value="saveOption( { rawEvents: $event })" />
    </CardContent>
  </Card>
</template>
