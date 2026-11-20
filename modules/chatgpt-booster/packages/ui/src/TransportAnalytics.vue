<script setup lang="ts">
import {
  type DiagnosticsAdapter,
  EMPTY_TRANSPORT_COUNTERS,
  type PersistentDiagnosticsAdapter,
} from '@chatgpt-booster/core'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
  SettingsGrid,
} from '@kobaproduction/browser-ui'
import { Activity, ArrowDownLeft, ArrowUpRight, RefreshCcw } from 'lucide-vue-next'
import { computed, shallowRef, watch } from 'vue'
import { type SupportedLocale, type TranslationKey, translate } from './i18n'

const props = defineProps<{
  locale: SupportedLocale
  diagnostics?: DiagnosticsAdapter | undefined
  persistentDiagnostics?: PersistentDiagnosticsAdapter | undefined
}>()
const t = (key: TranslationKey) => translate(props.locale, key)
const current = shallowRef(EMPTY_TRANSPORT_COUNTERS)
const lifetime = shallowRef(EMPTY_TRANSPORT_COUNTERS)
const failed = shallowRef(false)
watch(
  () => [props.diagnostics, props.persistentDiagnostics] as const,
  ([session, persistent], _, onCleanup) => {
    current.value = EMPTY_TRANSPORT_COUNTERS
    lifetime.value = EMPTY_TRANSPORT_COUNTERS
    failed.value = false
    let active = true
    let receivedLifetime = false
    let unsubscribeSession: (() => void) | undefined
    let unsubscribeLifetime: (() => void) | undefined
    onCleanup(() => {
      active = false
      unsubscribeSession?.()
      unsubscribeLifetime?.()
    })
    try {
      if (session) {
        current.value = session.getTransportCounters()
        unsubscribeSession = session.subscribeTransport((value) => {
          if (active) current.value = value
        })
      }
      if (persistent) {
        unsubscribeLifetime = persistent.subscribeLifetimeTransport((value) => {
          if (!active) return
          receivedLifetime = true
          lifetime.value = value
        })
        void persistent
          .getLifetimeTransportCounters()
          .then((value) => {
            if (active && !receivedLifetime) lifetime.value = value
          })
          .catch(() => {
            if (active && !receivedLifetime) failed.value = true
          })
      }
    } catch {
      failed.value = true
    }
  },
  { immediate: true },
)
const metrics = computed(
  () =>
    [
      {
        key: 'control.requestTraffic',
        count: current.value.requestsSent + current.value.responsesReceived,
        total: lifetime.value.requestsSent + lifetime.value.responsesReceived,
      },
      {
        key: 'control.messageTraffic',
        count: current.value.messagesSent + current.value.messagesReceived,
        total: lifetime.value.messagesSent + lifetime.value.messagesReceived,
      },
      {
        key: 'control.errors',
        count: current.value.errors,
        total: lifetime.value.errors,
        warning: current.value.errors > 0,
      },
    ] as const,
)
const flowGroups = [
  { key: 'control.outbound', icon: ArrowUpRight, fields: ['requestsSent', 'messagesSent'] },
  { key: 'control.inbound', icon: ArrowDownLeft, fields: ['responsesReceived', 'messagesReceived'] },
] as const
const flows = computed(() =>
  flowGroups.map(({ key, icon, fields }) => {
    const rows = fields.map((field) => ({ kind: field, count: current.value[field] }))
    return { key, icon, rows, total: rows.reduce((sum, row) => sum + row.count, 0) }
  }),
)
const lastActivity = computed(() =>
  current.value.lastEventAt
    ? new Date(current.value.lastEventAt).toLocaleTimeString(props.locale, { timeStyle: 'medium' })
    : t('control.noActivity'),
)
</script>

<template>
  <section class="booster-analytics-dashboard grid min-w-0 gap-3">
    <header class="flex flex-wrap items-start justify-between gap-2">
      <div class="grid min-w-0 gap-1">
        <h2 class="text-sm font-semibold">{{ t('control.analyticsOverview') }}</h2>
        <p class="text-xs text-muted-foreground">{{ t('control.analyticsDescription') }}</p>
      </div>
      <Button v-if="diagnostics" variant="outline" size="sm" type="button" @click="diagnostics.resetTransport()">
        <RefreshCcw class="size-4" aria-hidden="true" />{{ t('control.resetCurrent') }}
      </Button>
    </header>
    <Alert v-if="failed" role="status"><AlertDescription>{{ locale === 'ru' ? 'Счётчики диагностики недоступны. Настройки доступны.' : 'Diagnostic counters are unavailable. Settings are available.' }}</AlertDescription></Alert>
    <div class="booster-analytics-metrics grid min-w-0 grid-cols-1 gap-3 @sm:grid-cols-3">
      <article v-for="metric in metrics" :key="metric.key" class="min-w-0">
        <Card class="grid gap-1 p-3" :class="{ 'border-destructive/40': 'warning' in metric && metric.warning }">
          <span class="text-xs text-muted-foreground">{{ t(metric.key) }}</span>
          <strong class="text-xl leading-tight tabular-nums">{{ metric.count }}</strong>
          <small class="text-xs text-muted-foreground">{{ metric.total }} · {{ t('control.allTime').toLocaleLowerCase(locale) }}</small>
        </Card>
      </article>
    </div>
    <SettingsGrid>
      <Card v-for="flow in flows" :key="flow.key" class="booster-analytics-flow-card min-w-0">
        <CardHeader compact>
          <CardTitle class="flex items-center justify-between gap-2 text-sm">
            <span class="inline-flex items-center gap-2"><component :is="flow.icon" class="size-4" aria-hidden="true" />{{ t(flow.key) }}</span>
            <span class="tabular-nums">{{ flow.total }}</span>
          </CardTitle>
        </CardHeader>
        <CardContent compact class="grid gap-2">
          <div v-for="row in flow.rows" :key="row.kind" class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 text-xs">
            <span class="text-muted-foreground">{{ t(`control.${row.kind}`) }}</span>
            <Progress class="h-1.5" :model-value="flow.total ? row.count / flow.total * 100 : 0" :aria-label="t(`control.${row.kind}`)" />
            <span class="tabular-nums">{{ row.count }}</span>
          </div>
        </CardContent>
      </Card>
    </SettingsGrid>
    <Card class="flex flex-wrap items-center gap-2 p-3 text-xs">
      <Activity class="size-4 text-muted-foreground" aria-hidden="true" />
      <span class="text-muted-foreground">{{ t('control.lastActivity') }}</span>
      <strong class="tabular-nums">{{ lastActivity }}</strong>
    </Card>
  </section>
</template>
