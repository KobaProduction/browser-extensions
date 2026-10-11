<script setup lang="ts">
const props = defineProps<{
  locale: 'ru' | 'en'
  savedCount: number | null
  captureFailed: boolean
  busy: boolean
  error: string
  preview: readonly { id: string; text: string; coverage: string }[]
}>()
const emit = defineEmits<{ read: []; export: [] }>()
const tr = (ru: string, en: string) => props.locale === 'ru' ? ru : en
</script>

<template>
  <section class="booster-stack-card" aria-label="Фиксированный Dexie архив ChatGPT">
    <div class="booster-setting-copy">
      <b>{{ tr('Dexie — собственная структура v1', 'Dexie — fixed canonical v1') }}</b>
      <small>{{ tr('Только новые подтверждённые события сохранения; прежние базы v3/v4 не переносятся.',
        'Only new verified capture events; existing v3/v4 archives are not converted.') }}</small>
      <small v-if="savedCount !== null">{{ tr('Сохранено', 'Saved') }}: {{ savedCount }}</small>
      <small v-if="captureFailed" role="status">{{ tr('Исходное сообщение изменилось; прежний снимок сохранён.', 'The source message changed; the previous snapshot was preserved.') }}</small>
    </div>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="booster-action-secondary" :disabled="busy" @click="emit('read')">
        {{ tr('Читать Dexie', 'Read Dexie') }}
      </button>
      <button type="button" class="booster-action-secondary" :disabled="busy" @click="emit('export')">
        {{ tr('Экспорт Dexie JSON.gz', 'Export Dexie JSON.gz') }}
      </button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <ol v-if="preview.length" class="max-h-60 overflow-y-auto p-2">
      <li v-for="record in preview" :key="record.id" class="border-b border-border py-2">
        <b>{{ record.id }}</b>
        <span v-if="record.coverage === 'contains_opaque'"> · {{ tr('Есть неизвестные части', 'Contains unknown content') }}</span>
        <p class="whitespace-pre-wrap break-words">{{ record.text }}</p>
      </li>
    </ol>
  </section>
</template>
