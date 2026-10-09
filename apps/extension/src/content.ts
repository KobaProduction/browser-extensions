import {FeatureRuntime,FeatureSettings,type Capability} from '@kobaproduction/browser-core'
import {createSettingsStore} from '@kobaproduction/browser-adapters'
import {mountControlCenter} from '@kobaproduction/browser-ui'
import {vkArchiveFeature} from '@kobaproduction/module-vk-archive'
const runtime=new FeatureRuntime([vkArchiveFeature],{
 target:'chromium',url:new URL(location.href),
 // The current manifest does not grant proxy or user-agent powers.
 capabilities:new Set<Capability>(['page-dom','origin-storage','local-files']),
 settings:new FeatureSettings(createSettingsStore('chromium')),
})
async function launch(){await runtime.start();const ui=mountControlCenter({runtime,launcher:false});
 chrome.runtime.onMessage.addListener((message:{type?:string;id?:string},_,sendResponse)=>{
  if(message?.type==='koba:open'){ui.open();sendResponse({ok:true});return}
  if(message?.type==='koba:open-feature'&&message.id){void runtime.open(message.id);sendResponse({ok:true});return}
  if(message?.type==='koba:list'){sendResponse({features:runtime.list()})}
 })
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void launch(),{once:true})
else void launch()
