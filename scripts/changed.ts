import {affectedModules,KNOWN_MODULES} from './catalog'
export async function changedModules(base:string|undefined,head='HEAD'){
 if(!base)return [...KNOWN_MODULES]
 const output=await Bun.$`git diff --name-only ${base}...${head}`.quiet().nothrow()
 if(output.exitCode!==0)return [...KNOWN_MODULES]
 return affectedModules(output.stdout.toString().trim().split('\n').filter(Boolean))
}
if(import.meta.main)console.log(JSON.stringify(await changedModules(process.env.BASE_SHA,process.env.HEAD_SHA||'HEAD')))
