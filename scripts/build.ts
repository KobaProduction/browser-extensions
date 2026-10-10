import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { build as viteBuild } from 'vite'
import ts from 'typescript'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { manifest, userscriptChannelUrl } from './catalog'
import { changedModules } from './changed'
import { buildChatGptModule } from './build-chatgpt'

const root=resolve(import.meta.dir,'..')
process.chdir(root)
const requested=process.argv.find(a=>a.startsWith('--module='))?.split('=')[1] ??
 process.argv.slice(2).find((x,i,arr)=>arr[i-1]==='--module') ?? 'all'
const target=process.argv.find(a=>a.startsWith('--target='))?.split('=')[1]??'both'
const ids=requested==='all'?['vk-booster','all-in-one']:
 requested==='changed'?(await changedModules(process.env.BASE_SHA,process.env.HEAD_SHA||'HEAD')).filter(id=>id!=='proxy-switcher'):[requested]
if(!['both','userscript','extension'].includes(target))throw Error('Invalid --target')

function plugins(){return [vue(),tailwindcss()]}
async function viteBundle(src:string,dir:string,file:string,format:'es'|'iife'='iife',external:string[]=[]){
 await viteBuild({configFile:false,root,logLevel:'error',plugins:plugins(),build:{
   outDir:dir,emptyOutDir:true,minify:false,cssCodeSplit:false,
   lib:{entry:src,formats:[format],name:'KobaBrowserTools',fileName:()=>file},
   rollupOptions: external.length?{external}:undefined,
 }})
 return readFile(join(dir,file),'utf8')
}
function emitTypes(name:string,src:string,dir:string){
 const config=ts.readConfigFile(join(root,'tsconfig.json'),ts.sys.readFile)
 if(config.error)throw Error('Cannot read TypeScript config')
 const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root)
 const options:ts.CompilerOptions={
  ...parsed.options,noEmit:false,declaration:true,emitDeclarationOnly:true,
  paths:{...parsed.options.paths,'@kobaproduction/browser-core':['packages/core/dist/index.d.ts']},
  rootDir:join(root,'packages',name,'src'),outDir:dir
 }
 const program=ts.createProgram([src],options)
 const emit=program.emit()
 const errors=[...ts.getPreEmitDiagnostics(program),...emit.diagnostics]
 if(emit.emitSkipped||errors.some(x=>x.category===ts.DiagnosticCategory.Error)){
  throw Error('Declaration emit failed: '+name+' '+errors.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')).join('; ').slice(0,1100))
 }
}
async function pack(name:string){
 const src=join(root,'packages',name,'src','index.ts')
 const dir=join(root,'packages',name,'dist')
 await mkdir(dir,{recursive:true})
 if(name==='ui'||name==='shell'){
  await viteBundle(src,dir,'index.js','es',
    ['vue','lucide-vue-next','@kobaproduction/browser-core','@kobaproduction/browser-ui','clsx','tailwind-merge'])
  await copyFile(join(root,'packages',name,'types/index.d.ts'),join(dir,'index.d.ts'))
 }else{
  const compiled=await Bun.build({entrypoints:[src],target:'browser',format:'esm',outdir:dir,
   external:['@kobaproduction/browser-core','@kobaproduction/browser-adapters','@kobaproduction/browser-ui']})
  if(!compiled.success)throw Error('Shared package build failed: '+name)
  emitTypes(name,src,dir)
 }
}
for(const name of ['core','adapters','archive','ui','shell'])await pack(name)
for(const id of ids){
 const info=await manifest(id)
 if(!info.release&&id!=='chatgpt-booster')throw Error('Module '+id+' is not releasable')
 if(id==='chatgpt-booster'){await buildChatGptModule(root,target,info.version,viteBundle);continue}
 const dir=join(root,'dist',id);await mkdir(dir,{recursive:true})
 if(target!=='extension'){
  const src=join(root,'apps/userscript/src',id==='vk-booster'?'vk-booster.ts':'all-in-one.ts')
  const output=await viteBundle(src,join(dir,'_userscript'),'bundle.js')
  const url=userscriptChannelUrl(id)
  const header=[
    '// ==UserScript==','// @name         '+info.name,
    '// @namespace    https://github.com/KobaProduction/browser-extensions',
    '// @version      '+info.version,
    '// @description  Koba Browser Tools / '+info.name,
    '// @homepageURL   https://github.com/KobaProduction/browser-extensions',
    '// @updateURL    '+url,'// @downloadURL  '+url,
    '// @match        https://vk.ru/im*','// @match        https://vk.com/im*',
    '// @run-at       document-idle','// @grant        GM_registerMenuCommand',
    '// @sandbox      raw','// ==/UserScript==','',
  ].join('\n')
  await writeFile(join(dir,id+'.user.js'),header+'\n'+output)
 }
 if(target!=='userscript'){
  const ext=join(dir,'extension');await mkdir(ext,{recursive:true})
  const content=await viteBundle(join(root,'apps/extension/src/content.ts'),
    join(dir,'_content'),'bundle.js')
  await writeFile(join(ext,'content.js'),content)
  const popup=await Bun.build({entrypoints:[join(root,'apps/extension/src/popup.ts')],
      target:'browser',format:'esm'})
  if(!popup.success)throw Error('Popup build failed')
  await writeFile(join(ext,'popup.js'),await popup.outputs[0]!.text())
  const base=JSON.parse(await readFile('apps/extension/src/manifest.json','utf8'))
  base.version=info.version;base.name=info.name
  await writeFile(join(ext,'manifest.json'),JSON.stringify(base,null,2)+'\n')
  await copyFile(join(root,'apps/extension/src/popup.html'),join(ext,'popup.html'))
  const child=spawn('zip',['-q','-r','../'+id+'-extension.zip','.'],{cwd:ext,stdio:'inherit'})
  await new Promise<void>((ok,bad)=>{child.on('exit',c=>c===0?ok():bad(Error('zip failed')));child.on('error',bad)})
 }
 console.log('Built '+id+' '+info.version+' ('+target+')')
}
