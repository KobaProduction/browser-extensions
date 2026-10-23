/** Real shared widget with synthetic evidence only; no account, network or archive writes. */
import { conversationIntegrityFromGraph } from '@kobaproduction/browser-archive'
import { Button } from '@kobaproduction/browser-ui'
import { createApp, h, ref } from 'vue'
import ArchiveIntegrityDetails from '../../../packages/widgets/src/ArchiveIntegrityDetails.vue'
import ArchiveIntegrityIndicator from '../../../packages/widgets/src/ArchiveIntegrityIndicator.vue'
import '../../../packages/ui/src/styles.css'

document.documentElement.classList.add('dark')
document.body.style.cssText = 'background:#171717;color:#eee;font:14px system-ui;margin:24px'
const complete = conversationIntegrityFromGraph(
  [
    { id: 'first', parentId: null, parentKnown: true },
    { id: 'last', parentId: 'first', parentKnown: true },
  ],
  { startReached: true, endReached: true, headId: 'last' },
)
const partial = conversationIntegrityFromGraph(
  [{ id: 'fragment', parentId: 'missing', parentKnown: true }],
  { startReached: false, endReached: true, headId: 'fragment' },
)
const unverified = conversationIntegrityFromGraph(
  [{ id: 'fragment', parentId: null, parentKnown: false }],
  { startReached: false, endReached: false, headId: null },
)
const manyGaps = conversationIntegrityFromGraph(
  Array.from({ length: 1222 }, (_, index) => ({
    id: `synthetic-fragment-${index}`,
    parentId: `synthetic-missing-${index}`,
    parentKnown: true,
  })),
  { startReached: false, endReached: true, headId: 'synthetic-fragment-1221' },
)
const repaired = ref(false)
createApp({
  render: () =>
    h('div', { style: 'max-width:680px;margin:40px auto;display:grid;gap:16px' }, [
      h('h1', { style: 'font-size:20px;font-weight:600' }, 'Состояние архива'),
      h('section', { class: 'space-y-4 rounded-lg border p-4', style: 'max-width:480px' }, [
        h('h2', { class: 'font-semibold' }, 'Проверка архива · синтетический сценарий'),
        h(
          ArchiveIntegrityDetails,
          {
            integrity: repaired.value ? complete : manyGaps,
            complete: repaired.value,
            locale: 'ru',
          },
          {
            actions: () =>
              h(
                Button,
                {
                  size: 'sm',
                  onClick: () => {
                    repaired.value = !repaired.value
                  },
                },
                () => (repaired.value ? 'Сбросить сценарий' : 'Собрать историю'),
              ),
          },
        ),
      ]),
      ...[
        { integrity: complete, complete: true },
        {
          integrity: { ...complete, scope: 'current-native-graph' as const, retainedOutsideGraph: 12 },
          complete: true,
        },
        { integrity: partial, hasOlderHistory: true },
        { integrity: unverified },
        { loading: true },
        { error: true },
      ].map((props) => h(ArchiveIntegrityIndicator, { ...props, locale: 'ru' })),
    ]),
}).mount('#app')
