<script setup lang="ts">
import type { FeatureRuntime } from '@kobaproduction/browser-core'
import { Badge, Button } from '@kobaproduction/browser-ui'
import { BarChart3, FolderArchive, SlidersHorizontal, Wrench, X } from 'lucide-vue-next'
import { type Component, computed, ref, watch } from 'vue'

const props = defineProps<{
  runtime: FeatureRuntime
  views: Record<string, Component>
  title: string
  selectedSection: string
}>()
const emit = defineEmits<{ close: []; select: [section: string] }>()
const section = ref(props.selectedSection)
watch(
  () => props.selectedSection,
  (value) => {
    section.value = value
  },
)
const statuses = computed(() => props.runtime.list())
const activeFeatures = computed(() => statuses.value.filter((s) => s.state === 'active'))
const currentView = computed(() => props.views[section.value])
async function enable(id: string, enabled: boolean) {
  await props.runtime.setEnabled(id, enabled)
}
function selectSection(id: string) {
  section.value = id
  emit('select', id)
}
function openModule(id: string) {
  if (props.views[id]) selectSection(id)
  else void props.runtime.open(id)
}
</script>
<template>
  <section class="booster-control-center" lang="ru">
    <header class="booster-control-header">
      <div class="booster-header-copy">
        <div class="flex items-center gap-2">
          <strong>{{title}}</strong><Badge variant="outline">Browser Tools</Badge>
        </div>
        <p>Модульные инструменты браузера</p>
      </div>
      <div class="booster-header-actions">
        <Badge variant="secondary">{{activeFeatures.length}} активен</Badge>
        <Button variant="ghost" size="icon" class="size-8" title="Закрыть" @click="emit('close')"><X class="size-4"/></Button>
      </div>
    </header>
    <div class="booster-settings-layout">
      <nav class="booster-settings-nav" aria-label="Разделы">
        <button type="button" :class="{active:section==='modules'}" @click="selectSection('modules')">
          <Wrench class="size-4"/>Модули
        </button>
        <button
          v-for="feature in statuses.filter(s=>Boolean(views[s.id]))"
          :key="feature.id" type="button" :class="{active:section===feature.id}"
          @click="selectSection(feature.id)"
        >
          <FolderArchive class="size-4"/>{{feature.title}}
        </button>
        <button type="button" :class="{active:section==='analytics'}" @click="selectSection('analytics')">
          <BarChart3 class="size-4"/>Аналитика
        </button>
        <button type="button" :class="{active:section==='settings'}" @click="selectSection('settings')">
          <SlidersHorizontal class="size-4"/>Настройки
        </button>
      </nav>
      <main class="booster-settings-content">
        <template v-if="section==='modules'">
          <section v-for="feature in statuses" :key="feature.id" class="booster-setting-card">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2">
                <Wrench class="size-4"/><b>{{feature.title}}</b>
                <Badge :variant="feature.state==='active'?'default':'secondary'">
                  {{feature.state==='active'?'Включён':feature.state==='disabled'?'Выключен':feature.state==='unsupported'?'Недоступен':'Ошибка'}}
                </Badge>
              </div>
              <span>{{feature.description}}</span>
            </div>
            <div class="booster-header-actions">
              <button
                type="button" class="booster-switch"
                :class="{'booster-switch-on':feature.state==='active'}"
                :disabled="feature.state==='unsupported'"
                :aria-pressed="feature.state==='active'"
                :aria-label="'Включить '+feature.title"
                @click="enable(feature.id,feature.state!=='active')"
              ><span/></button>
              <Button v-if="feature.state==='active'" variant="outline" size="sm" @click="openModule(feature.id)">Открыть</Button>
            </div>
          </section>
        </template>
        <component :is="currentView" v-else-if="currentView" />
        <template v-else-if="section==='analytics'">
          <section class="booster-setting-card"><div class="booster-setting-copy"><b>Аналитика</b><span>Общая телеметрия выключена по умолчанию. Содержимое сообщений не собирается.</span></div></section>
        </template>
        <template v-else>
          <section class="booster-setting-card"><div class="booster-setting-copy"><b>Настройки</b><span>Включение модулей — на вкладке «Модули». Настройки экспорта — внутри VK Booster.</span></div></section>
        </template>
      </main>
    </div>
  </section>
</template>
