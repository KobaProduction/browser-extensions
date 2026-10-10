import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

type Bundle = (src:string, dir:string, file:string, format?: 'es'|'iife', external?:string[], productVersion?:string)=>Promise<string>

/** One verified implementation with distinct browser delivery adapters.
 * The experimental ChatGPT module never joins an automatic release plan. */
export async function buildChatGptModule(
 root: string, target: string, version: string, bundle: Bundle,
) {
 const id='chatgpt-booster'
 const dir=join(root,'dist',id)
 const extRoot=join(root,'modules',id,'packages','extension')
 await mkdir(dir,{recursive:true})
 if(target!=='extension') {
  const output=await bundle(join(root,'apps/userscript/src/chatgpt-booster.ts'),join(dir,'_userscript'),'bundle.js','iife',[],version)
  const header=[
   '// ==UserScript==','// @name         ChatGPT Booster (monorepo preview)',
   '// @namespace    https://github.com/KobaProduction/browser-extensions',
   '// @version      '+version,'// @description  ChatGPT Booster — shared platform preview',
   // Preview artifacts are manually installed; no update channel before release.
   '// @match        https://chatgpt.com/*','// @run-at       document-start',
   '// @grant        GM_registerMenuCommand','// @grant        GM_getValue',
   '// @grant        GM_setValue','// @grant        GM_xmlhttpRequest',
   '// @grant        unsafeWindow','// @sandbox      raw',
   '// ==/UserScript==','',
  ].join('\n')
  await writeFile(join(dir,id+'.user.js'),header+'\n'+output)
 }
 if(target!=='userscript') {
  const ext=join(dir,'extension');await mkdir(ext,{recursive:true})
  await bundle(join(root,'apps/extension/src/chatgpt-content.ts'),join(dir,'_content'),'bundle.js','iife',[],version)
  await copyFile(join(dir,'_content','bundle.js'),join(ext,'content.js'))
  await bundle(join(extRoot,'src/observer/index.ts'),join(dir,'_observer'),'bundle.js','iife',[],version)
  await copyFile(join(dir,'_observer','bundle.js'),join(ext,'observer.js'))
  await bundle(join(extRoot,'src/background/index.ts'),join(dir,'_background'),'bundle.js','es',[],version)
  await copyFile(join(dir,'_background','bundle.js'),join(ext,'background.js'))
  await bundle(join(extRoot,'src/popup/main.ts'),join(dir,'_popup'),'bundle.js','iife',[],version)
  await copyFile(join(dir,'_popup','bundle.js'),join(ext,'popup.js'))
  let html=await readFile(join(extRoot,'src/popup/index.html'),'utf8')
  html=html.replace('<script type="module" src="./main.ts"></script>','<script src="popup.js"></script>')
  await writeFile(join(ext,'popup.html'),html)
  const manifest={
   manifest_version:3, name:'ChatGPT Booster (monorepo preview)', version,
   description:'Source-preserving ChatGPT archive with one shared browser shell',
   permissions:['storage','scripting'], host_permissions:['https://chatgpt.com/*'],
   action:{default_title:'ChatGPT Booster',default_popup:'popup.html'},
   content_scripts:[
    {matches:['https://chatgpt.com/*'],js:['observer.js'],run_at:'document_start',world:'MAIN'},
    {matches:['https://chatgpt.com/*'],js:['content.js'],run_at:'document_start'},
   ],
   background:{service_worker:'background.js',type:'module'},
  }
  await writeFile(join(ext,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
  const child=spawn('zip',['-q','-r','../chatgpt-booster-extension.zip','.'],{cwd:ext,stdio:'inherit'})
  await new Promise<void>((done,fail)=>{child.once('exit',code=>code===0?done():fail(new Error('ZIP packaging failed')));child.once('error',fail)})
 }
 console.log('Built experimental ChatGPT Booster',version,'('+target+')')
}
