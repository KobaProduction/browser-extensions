import {test,expect} from 'bun:test'
import {selectArchivePage} from './index'

const entries=[{id:'m5',at:5},{id:'m4',at:4},{id:'m3',at:3},{id:'m2',at:2}]
const base={records:entries,keyOf:(r:typeof entries[number])=>r.id,
  timestampOf:(r:typeof entries[number])=>r.at, knownKeys:new Set(['m4']),remaining:3}

test('recent counts known records toward exact N but persists only missing identities',()=>{
 const result=selectArchivePage({...base,mode:'recent'})
 expect(result).toEqual({consumed:3,matched:3,added:[entries[0],entries[2]],boundaryReached:false})
 expect(base.knownKeys.has('m5')).toBe(false)
})
test('incremental ends at first known source identity',()=>{
 expect(selectArchivePage({...base,mode:'incremental'})).toEqual({
   consumed:2,matched:1,added:[entries[0]],boundaryReached:true,
 })
})
test('backfill skips known records and advances source offset by actual consumed',()=>{
 expect(selectArchivePage({...base,mode:'backfill',remaining:2})).toEqual({
   consumed:3,matched:2,added:[entries[0],entries[2]],boundaryReached:false,
 })
})
test('date selection excludes newer records, stops on older bound, does not invent dates',()=>{
 expect(selectArchivePage({...base,mode:'recent',remaining:10,fromInclusive:3,toExclusive:5})).toEqual({
   consumed:4,matched:2,added:[entries[2]],boundaryReached:true,
 })
 expect(()=>selectArchivePage({...base,mode:'recent',fromInclusive:3,timestampOf:()=>null})).toThrow('timestamp')
})
