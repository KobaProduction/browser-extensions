import {manifest} from './catalog'
import {changedModules} from './changed'
const ids=['vk-booster','chatgpt-booster','proxy-switcher','all-in-one'] as const
const capabilities=['page-dom','origin-storage','local-files','proxy-settings','request-routing','user-agent']
const names=new Set<string>()
for(const id of ids){
 const m=await manifest(id)
 if(m.id!==id||names.has(m.id)||!/^[a-z][a-z0-9-]+$/.test(m.id))throw Error('Invalid module id: '+id)
 if(!/^\d+\.\d+\.\d+$/.test(m.version))throw Error('Invalid semver: '+id)
 if(m.capabilities?.some(x=>!capabilities.includes(x)))throw Error('Invalid capabilities: '+id)
 if(m.targets?.some(x=>!['userscript','chromium'].includes(x)))throw Error('Unsupported targets: '+id)
 names.add(m.id)
}
const selector=process.argv[process.argv.indexOf('--module')+1]
const checked=selector==='changed'?
 (await changedModules(process.env.BASE_SHA,process.env.HEAD_SHA||'HEAD')).filter(x=>x!=='proxy-switcher'):
 selector==='vk-booster'||selector==='chatgpt-booster'||selector==='all-in-one'?[selector]:['vk-booster','chatgpt-booster','all-in-one']
if(process.argv.includes('--built'))for(const id of checked){
 const m=await manifest(id)
 const root=`dist/${id}`
 const user=await Bun.file(`${root}/${id}.user.js`).text()
 if(!user.startsWith('// ==UserScript==')||!user.includes(`// @version      ${m.version}`)||!user.includes('GM_registerMenuCommand'))throw Error('Invalid userscript: '+id)
 if(m.release){
  if(!user.includes(`@updateURL    https://raw.githubusercontent.com/KobaProduction/browser-extensions/distribution/userscripts/${id}.user.js`)||!user.includes('@downloadURL'))throw Error('Released module lost update channel: '+id)
 }else if(user.includes('// @updateURL')||user.includes('// @downloadURL'))throw Error('Experimental module advertises an unapproved update channel: '+id)
 if(id==='chatgpt-booster'&&(!user.includes('// @match        https://chatgpt.com/*')||!user.includes('// @grant        unsafeWindow')))throw Error('ChatGPT page observer grants missing')
 const chrome=await Bun.file(`${root}/extension/manifest.json`).json()
 if(chrome.manifest_version!==3||chrome.version!==m.version||chrome.permissions.includes('proxy'))throw Error('Invalid extension manifest: '+id)
 if(id==='chatgpt-booster'){
  const hosts=chrome.host_permissions as unknown
  if(!Array.isArray(hosts)||hosts.length!==1||hosts[0]!=='https://chatgpt.com/*'||
      chrome.background?.service_worker!=='background.js'||
      !Array.isArray(chrome.content_scripts)||chrome.content_scripts.length!==2||
      chrome.content_scripts[0]?.world!=='MAIN'||chrome.content_scripts[0]?.js?.[0]!=='observer.js'||
      chrome.content_scripts[1]?.js?.[0]!=='content.js')throw Error('ChatGPT isolated observer/manifest contract changed')
 }
 for(const path of ['content.js','popup.js','popup.html',...(id==='chatgpt-booster'?['observer.js','background.js']:[]),`${id}-extension.zip`]){
  const file=path.endsWith('.zip')?`${root}/${path}`:`${root}/extension/${path}`
  if(!(await Bun.file(file).exists()))throw Error('Missing artifact: '+file)
 }
}
console.log('Module catalog and outputs valid')
