import { FeatureRuntime, FeatureSettings, defaultCapabilities, type Feature } from '@kobaproduction/browser-core'
import { createSettingsStore } from '@kobaproduction/browser-adapters'
import { mountControlCenter } from '@kobaproduction/browser-shell'
import type { Component } from 'vue'
export function bootstrapUserscript(features:Feature[], title='Koba Browser Tools',views:Record<string,Component>={}) {
  const runtime=new FeatureRuntime(features,{
    target:'userscript',url:new URL(location.href),
    capabilities:defaultCapabilities('userscript'),
    settings:new FeatureSettings(createSettingsStore('userscript')),
  })
  let open:()=>void=()=>{}
  const launch=async()=>{
    await runtime.start()
    const ui=mountControlCenter({runtime,title,launcher:true,views})
    open=ui.open
  }
  if(typeof GM_registerMenuCommand==='function') GM_registerMenuCommand('Открыть '+title,()=>open())
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void launch(),{once:true})
  else void launch()
}
declare function GM_registerMenuCommand(title:string,callback:()=>void):unknown
