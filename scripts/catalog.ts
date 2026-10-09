import {readFile} from 'node:fs/promises'
export interface ModuleManifest {id:string;name:string;version:string;hosts?:string[];targets?:string[];capabilities?:string[];release:boolean;dependencies?:string[]}
export const DIST='dist'
export const KNOWN_MODULES=['vk-booster','proxy-switcher','all-in-one'] as const
export type ModuleId=typeof KNOWN_MODULES[number]
export async function manifest(id:string):Promise<ModuleManifest>{
 const path=id==='all-in-one'?'apps/all-in-one.json':`modules/${id}/module.json`
 return JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8')) as ModuleManifest
}
export function scopeFor(id:string):string[]{return id==='all-in-one'?['apps/','modules/vk-booster/','packages/','scripts/','package.json','bun.lock']:['modules/'+id+'/','packages/','scripts/','package.json','bun.lock']}
export function affectedModules(paths:string[]):ModuleId[]{
 const universal=paths.some(p=>/^(packages\/|scripts\/|package\.json$|bun\.lock$|tsconfig\.json$|\.github\/)/.test(p))
 const vk=paths.some(p=>p.startsWith('modules/vk-booster/'))
 const proxy=paths.some(p=>p.startsWith('modules/proxy-switcher/'))
 const all=paths.some(p=>p.startsWith('apps/'))
 return KNOWN_MODULES.filter(id=>universal||(id==='vk-booster'&&vk)||(id==='proxy-switcher'&&proxy)||(id==='all-in-one'&&(vk||all)))
}

export function userscriptChannelUrl(id:string):string {
 if (!/^[a-z][a-z0-9-]+$/.test(id))throw Error('Invalid userscript module ID')
 return 'https://raw.githubusercontent.com/KobaProduction/browser-extensions/distribution/userscripts/'+id+'.user.js'
}
