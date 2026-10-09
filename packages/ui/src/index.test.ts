import { test, expect } from 'bun:test'
import { Window } from 'happy-dom'
import { FeatureRuntime, FeatureSettings, defaultCapabilities, type Feature } from '@kobaproduction/browser-core'
import { mountControlCenter } from './index'
import { installVkArchive } from '../../../modules/vk-booster/src/archive-runtime.js'

function mockBrowser() {
  const old = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
    testMode: globalThis.__VK_EXPORT_TEST_MODE,
  }
  const browser = new Window({url:'https://vk.ru/im/convo/7654321'})
  Object.assign(globalThis,{document:browser.document,window:browser,location:browser.location})
  return {
    browser,
    restore() {
      Object.assign(globalThis,{
        document:old.document,window:old.window,location:old.location,
        __VK_EXPORT_TEST_MODE:old.testMode,
      })
      browser.close()
    },
  }
}

test('classic Control Center renders isolated shared logo, feature status and actions',async()=>{
  const {browser,restore}=mockBrowser()
  let opens=0
  const feature:Feature={
    id:'vk-booster',title:'VK Booster',description:'Экспорт сообщений',
    match:()=>true,targets:['userscript'],requiredCapabilities:['page-dom'],
    start(){},open(){opens++},
  }
  const enabled=new Map<string,boolean>()
  const runtime=new FeatureRuntime([feature],{
    target:'userscript',url:new URL(browser.location.href),
    capabilities:defaultCapabilities('userscript'),
    settings:new FeatureSettings({
      async get(k){return enabled.get(k)},
      async set(k,v){enabled.set(k,v)},
    }),
  })
  await runtime.start()
  try{
    const ui=mountControlCenter({runtime,title:'Koba Browser Tools',launcher:true})
    const host=browser.document.getElementById('koba-browser-tools-root')
    expect(host).toBeTruthy()
    expect(host?.shadowRoot?.querySelector('svg')).toBeTruthy()
    const panel=host?.shadowRoot?.querySelector('.kb-control') as HTMLElement
    expect(panel?.hidden).toBe(true)
    ui.open()
    expect(panel.hidden).toBe(false)
    expect(panel.textContent).toContain('VK Booster')
    expect(panel.textContent).toContain('Готово')
    expect(host?.shadowRoot?.querySelector('.kb-mark svg')).toBeTruthy()
    const open=panel.querySelector<HTMLButtonElement>('.kb-feature-actions button')
    open?.click()
    expect(opens).toBe(1)
    expect(panel.hidden).toBe(true)
    ui.open()
    browser.document.dispatchEvent(new browser.KeyboardEvent('keydown',{key:'Escape'}))
    expect(panel.hidden).toBe(true)
    ui.destroy()
    expect(browser.document.getElementById('koba-browser-tools-root')).toBeNull()
  }finally{restore()}
})

test('VK Booster export form uses the same isolated classic tokens, progress and settings',()=>{
  const {browser,restore}=mockBrowser()
  globalThis.__VK_EXPORT_TEST_MODE=false
  try{
    installVkArchive()
    const host=browser.document.getElementById('vk-archive-v2')
    expect(host).toBeTruthy()
    expect(host?.hidden).toBe(true)
    const exporter=globalThis.VKExport
    expect(exporter).toBeTruthy()
    exporter?.show()
    expect(host?.hidden).toBe(false)
    const shadow=host?.shadowRoot
    expect(shadow?.querySelector('.kb-brand .kb-mark svg')).toBeTruthy()
    expect(shadow?.querySelector('.kb-title')?.textContent).toBe('VK Booster')
    expect(shadow?.querySelector('#mode')).toBeTruthy()
    expect(shadow?.querySelector('#limit')).toBeTruthy()
    expect(shadow?.querySelector('#progress-track')?.getAttribute('aria-valuenow')).toBe('0')
    expect(shadow?.querySelector('#count-all')?.textContent).toBe('0')
    expect(shadow?.querySelector('.kb-details')).toBeTruthy()
    expect(shadow?.querySelector('style')?.textContent).toContain('--kb-accent')
    ;(shadow?.getElementById('hide') as HTMLButtonElement)?.click()
    expect(host?.hidden).toBe(true)
    exporter?.destroy?.()
    expect(browser.document.getElementById('vk-archive-v2')).toBeNull()
  }finally{
    globalThis.VKExport?.destroy?.()
    restore()
  }
})
