import { mountMessageMetadata } from '../../../modules/chatgpt-booster/packages/ui/src/message-metadata'
import { mountToolInspector } from '../../../modules/chatgpt-booster/packages/ui/src/tool-inspector'

document.documentElement.style.cssText =
  'color-scheme:dark;background:#171717;color:#eee;font:14px system-ui'
const main = document.querySelector('main'),
  stack = document.getElementById('stack'),
  anchor = document.getElementById('metadata'),
  warning = document.getElementById('warning')
if (!main || !stack || !anchor || !warning) throw Error('Missing synthetic overlay anchors')
main.style.cssText = 'position:relative;max-width:480px;margin:32px auto;padding:16px'
stack.style.cssText =
  'position:relative;z-index:0;transform:translateZ(0);overflow:hidden;height:90px;border:1px solid #444;padding:16px'
warning.style.cssText =
  'position:relative;z-index:10;margin-top:-25px;padding:24px;background:#240d0d;border:1px solid #803030'
const mounted = mountMessageMetadata(
  anchor,
  {
    sentAt: 1800000000,
    editedAt: null,
    edited: false,
    model: 'Synthetic model',
    thinking: 'Synthetic effort',
  },
  'ru',
)
window.addEventListener('pagehide', () => mounted.unmount(), { once: true })

const toolAnchor = document.createElement('div')
toolAnchor.style.cssText = 'padding:24px;background:#111;color:#000'
main.append(toolAnchor)
const tool = mountToolInspector(toolAnchor, {
  id: 'synthetic-call',
  locale: 'ru',
  active: false,
  structuredPayloads: [],
  attributes: {},
  visibleText: '',
  score: 0,
  signals: ['synthetic'],
  metadata: {
    sentAt: 1800000000,
    editedAt: null,
    edited: false,
    model: 'Synthetic model',
    thinking: 'Detailed',
  },
  tool: {
    kind: 'mcp',
    iconKey: null,
    provider: 'functions',
    action: 'exec',
    label: 'functions.exec',
    timestamp: 1800000000,
    finishedAt: 1800000003,
    durationMs: 3300,
    recipient: 'functions.exec',
    path: null,
    link: null,
    iconUrl: null,
    payload: { command: 'Synthetic example' },
    result: { status: 'ok' },
  },
})
window.addEventListener('pagehide', () => tool.unmount(), { once: true })
