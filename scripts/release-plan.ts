import {manifest,scopeFor} from './catalog'
export interface ReleaseCandidate {id:string;version:string;tag:string;changed:boolean}
export function hasRelevantChange(paths:string[],scopes:string[]):boolean{
 return paths.some(p=>scopes.some(scope=>scope.endsWith('/')?p.startsWith(scope):p===scope))
}
export async function releasePlan(){
 const result:ReleaseCandidate[]=[]
 const idList=['vk-archive','all-in-one']
 for(const id of idList){
  const m=await manifest(id),tag=`${id}/v${m.version}`
  const tags=await Bun.$`git tag --list ${tag}`.quiet().text()
  if(tags.trim())continue // exactly this release was published already
  const pattern=`${id}/v*`
  const previous=(await Bun.$`git tag --list ${pattern} --sort=-version:refname`.quiet().text()).trim().split('\n')[0]
  const scopes=scopeFor(id)
  let changed=true
  if(previous){
    const diff=await Bun.$`git diff --name-only ${previous} HEAD`.quiet().nothrow()
    changed=diff.exitCode!==0||hasRelevantChange(diff.stdout.toString().trim().split('\n'),scopes)
  }
  if(changed)result.push({id,version:m.version,tag,changed})
 }
 return result
}
if(import.meta.main){
 const plan=await releasePlan()
 if(process.argv.includes('--json'))console.log(JSON.stringify(plan))
 else if(process.argv.includes('--tsv'))for(const r of plan)console.log(`${r.id}|${r.version}|${r.tag}`)
 else for(const r of plan)console.log(`${r.id} ${r.tag}`)
}
