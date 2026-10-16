<script setup lang="ts">
import type { FeatureIndicator } from '@kobaproduction/browser-core'
import { useApplicationLocale, useLocalizedText } from '@kobaproduction/browser-ui'
import { indicatorDescription, indicatorStatusText } from './launcher-indicators'
import { SHELL_UI_MESSAGES } from './ui-messages'

const text = useLocalizedText(SHELL_UI_MESSAGES)
const locale = useApplicationLocale()

defineProps<{ indicators: readonly FeatureIndicator[]; compact?: boolean }>()
</script>
<template>
  <span v-if="compact" class="booster-launcher-signals" aria-hidden="true">
    <span v-for="indicator in indicators" :key="indicator.id" class="booster-signal-dot" :data-status="indicator.status" />
  </span>
  <ul v-else class="booster-indicator-legend" :aria-label="text('Состояние подключения и операций')" aria-live="polite">
    <li v-for="indicator in indicators" :key="indicator.id" :title="indicatorDescription(indicator, text, locale === 'en')" :aria-label="indicatorDescription(indicator, text, locale === 'en')">
      <span class="booster-signal-dot" :data-status="indicator.status" aria-hidden="true" />
      <span class="booster-indicator-copy"><strong>{{ locale === 'en' ? indicator.labelEn ?? indicator.label : indicator.label }}</strong><span>{{ indicator.detail ? (locale === 'en' ? indicator.detailEn ?? indicator.detail : indicator.detail) : text(indicatorStatusText[indicator.status]) }}</span></span>
    </li>
  </ul>
</template>
