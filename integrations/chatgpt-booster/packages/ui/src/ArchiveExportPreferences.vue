<script setup lang="ts">
type PreferenceScope = 'global' | 'project' | 'conversation'
defineProps<{
  scope:PreferenceScope; source:PreferenceScope; hasProject:boolean
  saving:boolean; loading:boolean; busy:boolean; locale:'en'|'ru'
}>()
const emit=defineEmits<{'update:scope':[scope:PreferenceScope]; reset:[]}>()
function scopeChanged(event:Event){
  const value=(event.target as HTMLSelectElement).value
  if(value==='global'||value==='project'||value==='conversation')emit('update:scope',value)
}
</script>
<template>
      <section class="booster-export-preferences">
        <label>{{ locale === 'ru' ? 'Сохранять настройки для' : 'Save preferences for' }}
          <select :value="scope" :disabled="busy || saving || loading" @change="scopeChanged">
            <option value="global">{{ locale === 'ru' ? 'По умолчанию (все чаты)' : 'Global default' }}</option>
            <option value="project" :disabled="!hasProject">{{ locale === 'ru' ? 'Проект' : 'Project' }}</option>
            <option value="conversation">{{ locale === 'ru' ? 'Этот диалог' : 'This conversation' }}</option>
          </select>
        </label>
        <p class="booster-note">
          {{ locale === 'ru' ? 'Сейчас применяется уровень' : 'Currently inherited from' }}:
          {{ source === 'global' ? (locale === 'ru' ? 'общий' : 'global') :
             source === 'project' ? (locale === 'ru' ? 'проект' : 'project') :
             (locale === 'ru' ? 'диалог' : 'conversation') }}
        </p>
        <button v-if="scope !== 'global'" type="button" class="booster-action-secondary"
          :disabled="busy || saving" @click="emit('reset')">
          {{ locale === 'ru' ? 'Убрать переопределение' : 'Reset override' }}
        </button>
      </section>
</template>
