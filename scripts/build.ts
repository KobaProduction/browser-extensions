import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { manifest } from './catalog'
import { changedModules } from './changed'
const root=resolve(import.meta.dir,'..')
process.chdir(root)
const requested=process.argv.find(a=>a.startsWith('--module='))?.split('=')[1]??
 process.argv.slice(2).find((x,i,arr)=>arr[i-1]==='--module')??'all'
const target=process.argv.find(a=>a.startsWith('--target='))?.split('=')[1]??'both'
const ids=requested==='all'?['vk-archive','all-in-one']:
 requested==='changed'?(await changedModules(process.env.BASE_SHA,process.env.HEAD_SHA||'HEAD')).filter(id=>id!=='proxy-switcher'):[requested]
if(!['both','userscript','extension'].includes(target))throw Error('Invalid --target')
async function pack(name:string){
 const src=join(root,'packages',name,'src','index.ts')
 const dir=join(root,'packages',name,'dist');await mkdir(dir,{recursive:true})
 const r=await Bun.build({entrypoints:[src],target:'browser',format:'esm',outdir:dir,
   external:['@kobaproduction/browser-core','@kobaproduction/browser-adapters','@kobaproduction/browser-ui']})
 if(!r.success)throw new Error(`Failed shared package ${name}: ${r.logs.map(x=>x.message).join('; ')}`)
 const decl=['core','ui','adapters'].includes(name)
 if(decl){const res=Bun.spawnSync([process.execPath,'x','tsc','--declaration','--emitDeclarationOnly','--outDir',dir,'--rootDir',join(root,'packages',name,'src'),
     '--moduleResolution','bundler','--module','esnext','--target','es2022','--skipLibCheck',src],{cwd:root,stdout:'pipe',stderr:'pipe'});
   if(res.exitCode!==0)throw Error(`Declarations failed: ${new TextDecoder().decode(res.stderr).slice(-1200)}`)}
}
for(const name of ['core','adapters','ui'])await pack(name)
const sourceFor=(id:string)=>id==='vk-archive'?'vk-archive':'all-in-one'
for(const id of ids){
 const info=await manifest(id)
 if(!info.release)throw Error(`Module ${id} is not releasable yet`)
 const dir=join(root,'dist',id);await mkdir(dir,{recursive:true})
 if(target!=='extension'){
   const src=join(root,'apps/userscript/src',sourceFor(id)+'.ts')
   const out=await Bun.build({entrypoints:[src],target:'browser',format:'iife',minify:false})
   if(!out.success)throw Error(out.logs.map(l=>l.message).join('\n'))
   const meta=['// ==UserScript==',`// @name         ${info.name}`,`// @namespace    https://github.com/KobaProduction/browser-extensions`,
     `// @version      ${info.version}`,`// @description  Reusable Koba Browser Tools / ${info.name}`,
     '// @match        https://vk.ru/im*','// @match        https://vk.com/im*',
     '// @run-at       document-idle','// @grant        GM_registerMenuCommand','// @sandbox      raw','// ==/UserScript==',''].join('\n')
   await writeFile(join(dir,id+'.user.js'),meta+'\n'+await out.outputs[0]!.text())
 }
 if(target!=='userscript'){
  const ext=join(dir,'extension');await mkdir(ext,{recursive:true})
  for(const [entry,output,format] of [['content.ts','content.js','iife'],['popup.ts','popup.js','esm']] as const){
   const compiled=await Bun.build({entrypoints:[join(root,'apps/extension/src',entry)],target:'browser',format,minify:false})
   if(!compiled.success)throw Error(compiled.logs.map(x=>x.message).join('; '))
   await writeFile(join(ext,output),await compiled.outputs[0]!.text())
  }
  const base=JSON.parse(await readFile('apps/extension/src/manifest.json','utf8'))
  base.version=info.version;base.name=info.name
  await writeFile(join(ext,'manifest.json'),JSON.stringify(base,null,2)+'\n')
  await copyFile(join(root,'apps/extension/src/popup.html'),join(ext,'popup.html'))
  // The ZIP is produced inside dist/module (outside the extension directory).
  const child=spawn('zip',['-q','-r','../'+id+'-extension.zip','.'],{cwd:ext,stdio:'inherit'})
  await new Promise<void>((ok,bad)=>{child.on('exit',code=>code===0?ok():bad(Error('zip failed')));child.on('error',bad)})
 }
 console.log('Built '+id+' '+info.version+' ('+target+')')
}
