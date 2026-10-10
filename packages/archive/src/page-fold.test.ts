import { expect, test } from 'bun:test'
import { foldArchivePage } from './page-fold'

type Message = { id: number; date: number; body: string }
const messages = (ids: readonly number[]) => ids.map(id=>({id, date:100+id,body:`source-${id}`}))
const indexed = (ids: readonly number[]) => new Map(messages(ids).map(m=>[m.id,m]))
const id = (row: Message) => row.id

test('recent exact-N counts previously archived items, but only inserts missing IDs',()=>{
 const known=indexed([1,2])
 const result=foldArchivePage(messages([5,4,3,2,1]),known,{mode:'recent',identity:id,remaining:4})
 expect(result).toEqual({consumed:4,matched:4,inserted:3,skipped:0,stopReason:'target_reached'})
 expect([...known.keys()].sort()).toEqual([1,2,3,4,5])
})

test('incremental stops at first existing message even after adding new items',()=>{
 const known=indexed([3,2])
 const result=foldArchivePage(messages([5,4,3,2,1]),known,{mode:'incremental',identity:id,remaining:10})
 expect(result).toEqual({consumed:3,matched:2,inserted:2,skipped:0,stopReason:'known_record'})
 expect([...known.keys()].sort()).toEqual([2,3,4,5])
})

test('backfill skips known rows, counts only unseen messages toward N',()=>{
 const known=indexed([5,4,2])
 const result=foldArchivePage(messages([5,4,3,2,1]),known,{mode:'backfill',identity:id,remaining:2})
 expect(result).toEqual({consumed:5,matched:2,inserted:2,skipped:3,stopReason:'target_reached'})
 expect([...known.keys()].sort()).toEqual([1,2,3,4,5])
})

test('inclusive window and bound checks preserve exact consumed offsets',()=>{
 const known=indexed([])
 const result=foldArchivePage(messages([8,7,6,5,4,3]),known,{
  mode:'recent',identity:id,remaining:5,skip:(m)=>m.id>6,stop:(m)=>m.id<4,
 })
 expect(result).toEqual({consumed:6,matched:3,inserted:3,skipped:2,stopReason:'range_end'})
 expect([...known.keys()]).toEqual([6,5,4])
})

test('native snapshot fold rejects a conflicting duplicate instead of silently picking last',()=>{
 const known=new Map<string,{id:string;source:string}>()
 const same=(a:{source:string},b:{source:string})=>a.source===b.source
 const first=foldArchivePage([{id:'a',source:'v1'},{id:'a',source:'v1'}],known,{mode:'snapshot',identity:r=>r.id,same})
 expect(first).toEqual({consumed:2,matched:1,inserted:1,skipped:1,stopReason:null})
 expect(()=>foldArchivePage([{id:'a',source:'v2'}],known,{mode:'snapshot',identity:r=>r.id,same}))
  .toThrow('Conflicting native record')
 expect(known.get('a')?.source).toBe('v1')
})

test('empty target and invalid IDs do not mutate an existing index',()=>{
 const known=indexed([1])
 expect(foldArchivePage(messages([2]),known,{mode:'recent',identity:id,remaining:0}))
  .toEqual({consumed:0,matched:0,inserted:0,skipped:0,stopReason:'target_reached'})
 expect(()=>foldArchivePage([{id:Number.NaN,date:0,body:'x'}],known,{mode:'snapshot',identity:id})).toThrow()
 expect([...known.keys()]).toEqual([1])
})
