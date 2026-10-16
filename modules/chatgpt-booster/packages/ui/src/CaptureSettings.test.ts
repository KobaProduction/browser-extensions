import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import ts from 'typescript'
import * as vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import * as core from '../../core/src'
import * as i18n from './i18n'

/** Mount the real SFC logic/template; registry controls are neutral host stubs.
 * These tests exercise async settings states, while browser acceptance owns control behavior. */
function mountCapture(
  adapter: core.SettingsAdapter,
  getCurrentContext: () => Promise<{
    projectId: string | null
    projectTitle: string | null
    conversationId: string | null
    conversationTitle: string | null
  }> = async () => {
    throw Error('Unverified account')
  },
  projects: { projectId: string; title: string | null }[] = [],
) {
  const dom = new Window()
  const document = dom.document as unknown as Document
  const renderer = vue.createRenderer<Node, Element>({
    createElement: (tag) => document.createElement(tag),
    createText: (value) => document.createTextNode(value),
    createComment: (value) => document.createComment(value),
    insert: (node, parent, anchor) => parent.insertBefore(node, anchor),
    remove: (node) => node.parentNode?.removeChild(node),
    parentNode: (node) => node.parentNode as Element | null,
    nextSibling: (node) => node.nextSibling,
    setText: (node, value) => {
      node.nodeValue = value
    },
    setElementText: (node, value) => {
      node.textContent = value
    },
    patchProp(element, key, previous, value) {
      if (key.startsWith('onUpdate:')) return
      if (key.startsWith('on')) {
        const event = key.slice(2).toLowerCase()
        if (previous) element.removeEventListener(event, previous)
        if (value) element.addEventListener(event, value)
      } else if (value === undefined || value === null || value === false) element.removeAttribute(key)
      else element.setAttribute(key, String(value))
    },
  })
  const controls = Object.fromEntries(
    [
      'Alert',
      'AlertDescription',
      'Button',
      'Card',
      'CardContent',
      'CardDescription',
      'CardHeader',
      'CardTitle',
      'Checkbox',
      'Label',
      'Select',
      'SelectContent',
      'SelectItem',
      'SelectTrigger',
      'SelectValue',
    ].map((name) => [
      name,
      vue.defineComponent({
        inheritAttrs: false,
        props: name === 'Checkbox' ? ['modelValue'] : [],
        emits: name === 'Checkbox' ? ['update:modelValue'] : [],
        setup(props, { attrs, slots, emit }) {
          return () =>
            name === 'Checkbox'
              ? vue.h('button', {
                  ...attrs,
                  type: 'button',
                  'aria-checked': String(props.modelValue),
                  onClick: () => emit('update:modelValue', !props.modelValue),
                })
              : vue.h(name === 'Button' ? 'button' : 'div', attrs, slots.default?.())
        },
      }),
    ]),
  )
  const imports: Record<string, Record<string, unknown>> = {
    vue,
    '@chatgpt-booster/core': core,
    '@kobaproduction/browser-ui': controls,
    './i18n': i18n,
    './CopyIdentity.vue': { default: vue.defineComponent({ render: () => null }) },
  }
  const filename = 'CaptureSettings.vue'
  const { descriptor } = parse(readFileSync(new URL(filename, import.meta.url), 'utf8'), { filename })
  const script = compileScript(descriptor, {
    id: 'capture-settings-state-test',
    inlineTemplate: true,
    genDefaultAs: 'CaptureSettingsView',
  })
  let source = new Bun.Transpiler({ loader: 'ts' }).transformSync(script.content)
  const tree = ts.createSourceFile('compiled.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  for (const declaration of [...tree.statements].reverse()) {
    if (!ts.isImportDeclaration(declaration) || !ts.isStringLiteral(declaration.moduleSpecifier))
      continue
    const module = JSON.stringify(declaration.moduleSpecifier.text),
      bindings = declaration.importClause
    const values: string[] = []
    if (bindings?.name) values.push(`const ${bindings.name.text} = imports[${module}].default;`)
    if (bindings?.namedBindings && ts.isNamedImports(bindings.namedBindings))
      for (const item of bindings.namedBindings.elements)
        values.push(
          `const ${item.name.text} = imports[${module}][${JSON.stringify(item.propertyName?.text ?? item.name.text)}];`,
        )
    source =
      source.slice(0, declaration.getStart(tree)) + values.join('\n') + source.slice(declaration.end)
  }
  const component = new Function('imports', `${source}\nreturn CaptureSettingsView;`)(imports)
  const host = document.createElement('div')
  const app = renderer.createApp(component, {
    settingsAdapter: adapter,
    locale: 'en',
    archiveAdapter: {
      getCurrentContext,
      listProjects: async () => projects,
      listConversations: async () => [],
    },
  })
  app.mount(host)
  return {
    host,
    dispose: async () => {
      app.unmount()
      await dom.happyDOM.close()
    },
  }
}
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await vue.nextTick()
}

test('unavailable archive contexts do not manufacture a save failure or block the loaded default rule', async () => {
  let stored = core.normalizeSettings({
      archive: { defaultRule: { ...core.DEFAULT_CAPTURE_RULE, enabled: false } },
    }),
    writes = 0
  const adapter: core.SettingsAdapter = {
    get: async () => stored,
    set: async (next) => {
      stored = next
    },
    subscribe: () => () => {},
    update: async (patch) => {
      writes++
      stored = core.mergeSettings(stored, patch)
      return stored
    },
  }
  const { host, dispose } = mountCapture(adapter)
  try {
    await settle()
    expect(host.textContent).toContain(i18n.translate('en', 'capture.contextsUnavailable'))
    expect(host.textContent).not.toContain(i18n.translate('en', 'common.saveError'))
    const save = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === i18n.translate('en', 'capture.apply'),
    ) as HTMLButtonElement
    expect(save).toBeDefined()
    save.click()
    await settle()
    expect(writes).toBe(1)
    expect(host.textContent).toContain(i18n.translate('en', 'capture.saved'))
    expect(host.textContent).not.toContain(i18n.translate('en', 'common.saveError'))
    expect(stored.archive.defaultRule.enabled).toBe(false)
  } finally {
    await dispose()
  }
})

test('a real failed write displays the save error separately from unavailable contexts', async () => {
  const adapter: core.SettingsAdapter = {
    get: async () => core.normalizeSettings(),
    set: async () => {},
    subscribe: () => () => {},
    update: async () => {
      throw Error('Persistence unavailable')
    },
  }
  const { host, dispose } = mountCapture(adapter)
  try {
    await settle()
    const save = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === i18n.translate('en', 'capture.apply'),
    ) as HTMLButtonElement
    save.click()
    await settle()
    expect(host.textContent).toContain(i18n.translate('en', 'capture.contextsUnavailable'))
    expect(host.textContent).toContain(i18n.translate('en', 'common.saveError'))
    expect(host.textContent).not.toContain(i18n.translate('en', 'capture.saved'))
  } finally {
    await dispose()
  }
})

test('pending optional contexts expose the persisted rule and cannot replace an edited default draft', async () => {
  let stored = core.normalizeSettings({
    archive: { defaultRule: { enabled: true, reasoning: true, tools: false, internal: false } },
  })
  const patches: core.BoosterSettingsPatch[] = []
  const adapter: core.SettingsAdapter = {
    get: async () => stored,
    set: async (next) => {
      stored = next
    },
    subscribe: () => () => {},
    update: async (patch) => {
      patches.push(patch)
      stored = core.mergeSettings(stored, patch)
      return stored
    },
  }
  let resolveContext!: (context: {
    projectId: string | null
    projectTitle: string | null
    conversationId: string | null
    conversationTitle: string | null
  }) => void
  const pendingContext = new Promise<Parameters<typeof resolveContext>[0]>((resolve) => {
    resolveContext = resolve
  })
  const { host, dispose } = mountCapture(adapter, () => pendingContext)
  try {
    await settle()
    const reasoning = host.querySelector('button[id$="-reasoning"]') as HTMLButtonElement
    expect(reasoning.getAttribute('aria-checked')).toBe('true')
    reasoning.click()
    await settle()
    resolveContext({
      projectId: null,
      projectTitle: null,
      conversationId: 'synthetic-late-conversation',
      conversationTitle: 'Late synthetic context',
    })
    await settle()
    expect(reasoning.getAttribute('aria-checked')).toBe('false')
    const save = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === i18n.translate('en', 'capture.apply'),
    ) as HTMLButtonElement
    save.click()
    await settle()
    expect(patches).toHaveLength(1)
    expect(patches[0]?.archive?.defaultRule).toEqual({
      enabled: true,
      reasoning: false,
      tools: false,
      internal: false,
    })
    expect(stored.archive.conversations).toEqual({})
    expect(host.textContent).toContain(i18n.translate('en', 'capture.saved'))
  } finally {
    await dispose()
  }
})

test('the selected scope caption reflects the title returned by a late context read', async () => {
  const adapter: core.SettingsAdapter = {
    get: async () => core.normalizeSettings(),
    set: async () => {},
    subscribe: () => () => {},
    update: async () => core.normalizeSettings(),
  }
  let resolveContext!: (context: {
    projectId: string | null
    projectTitle: string | null
    conversationId: string | null
    conversationTitle: string | null
  }) => void
  const pendingContext = new Promise<Parameters<typeof resolveContext>[0]>((resolve) => {
    resolveContext = resolve
  })
  const { host, dispose } = mountCapture(adapter, () => pendingContext)
  try {
    await settle()
    const trigger = host.querySelector('[id$="-scope"]')
    expect(trigger?.textContent).toBe(i18n.translate('en', 'capture.global'))
    resolveContext({
      projectId: null,
      projectTitle: null,
      conversationId: 'synthetic-late-caption',
      conversationTitle: 'Verified synthetic title',
    })
    await settle()
    expect(trigger?.textContent).toBe(
      `${i18n.translate('en', 'capture.conversation')}: Verified synthetic title`,
    )
    expect(trigger?.textContent).not.toContain(i18n.translate('en', 'identity.untitled'))
  } finally {
    await dispose()
  }
})

test.each([
  { override: true, projectOverride: true, master: true, source: 'conversation', auto: 'dock.autoOn' },
  { override: false, projectOverride: true, master: true, source: 'project', auto: 'dock.autoOff' },
  { override: true, projectOverride: true, master: false, source: 'conversation', auto: 'dock.autoOff' },
  { override: false, projectOverride: false, master: true, source: 'default', auto: 'dock.autoOn' },
] as const)(
  'verified projects without overrides are selectable and effective capture respects $source / master $master',
  async ({ override, projectOverride, master, source, auto }) => {
    const settings = core.normalizeSettings({
      enabled: master,
      archive: {
        defaultRule: { ...core.DEFAULT_CAPTURE_RULE, enabled: true },
        projects: projectOverride
          ? { 'project-off': { ...core.DEFAULT_CAPTURE_RULE, enabled: false } }
          : {},
        conversations: override ? { 'chat-on': { ...core.DEFAULT_CAPTURE_RULE, enabled: true } } : {},
      },
    })
    const adapter: core.SettingsAdapter = {
      get: async () => settings,
      set: async () => {},
      subscribe: () => () => {},
      update: async () => settings,
    }
    const { host, dispose } = mountCapture(
      adapter,
      async () => ({
        projectId: 'project-off',
        projectTitle: 'Verified current project',
        conversationId: 'chat-on',
        conversationTitle: 'Verified current conversation',
      }),
      [
        { projectId: 'project-off', title: 'Verified current project' },
        { projectId: 'project-without-override', title: 'Verified project without override' },
      ],
    )
    try {
      await settle()
      expect(host.querySelector('[value="project:project-without-override"]')?.textContent).toContain(
        'Verified project without override',
      )
      const effective = host.querySelector('[data-capture-effective]')?.textContent
      expect(effective).toContain(i18n.translate('en', auto))
      expect(effective).toContain(i18n.translate('en', `scope.source.${source}`))
      const project = host.querySelector('[data-capture-project-status]')?.textContent
      expect(project).toContain('Verified current project')
      expect(project).toContain(
        i18n.translate('en', projectOverride || !master ? 'dock.autoOff' : 'dock.autoOn'),
      )
      expect(project).toContain(
        i18n.translate('en', projectOverride ? 'scope.source.project' : 'scope.source.default'),
      )
    } finally {
      await dispose()
    }
  },
)
