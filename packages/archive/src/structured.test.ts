import { expect, test } from 'bun:test'
import { encodeArchiveClone, decodeArchiveClone } from './structured'

test('portable IDB codec retains undefined, NaN and unusual object keys',async()=>{
 const original={ a: undefined,b: [1,undefined,Number.NaN,-0], '__proto__': 'text' }
 Object.defineProperty(original,'__proto__',{value:'literal key',enumerable:true,writable:true,configurable:true})
 const decoded=decodeArchiveClone(await encodeArchiveClone(original)) as Record<string,unknown>
 expect(Object.hasOwn(decoded,'a')).toBe(true)
 expect(decoded.a).toBeUndefined()
 expect((decoded.b as unknown[])[1]).toBeUndefined()
 expect(Number.isNaN((decoded.b as number[])[2])).toBe(true)
 expect(Object.is((decoded.b as number[])[3],-0)).toBe(true)
 expect(decoded.__proto__).toBe('literal key')
})

test('portable archive codec preserves binary buffers and typed views',async()=>{
 const original={data:new Uint8Array([1,2,3,4,5]),bytes:new Uint8Array(Array.from({length:80000},(_,i)=>i%251)),
   buffer:new Uint8Array([1,3,7]).buffer}
 const result=decodeArchiveClone(await encodeArchiveClone(original)) as typeof original
 expect([...result.data]).toEqual([1,2,3,4,5])
 expect([...result.bytes]).toEqual([...original.bytes])
 expect([...new Uint8Array(result.buffer)]).toEqual([1,3,7])
})

test('portable codec round-trips Blob, map, set, date and sparse arrays',async()=>{
 const sparse=new Array(3)
 sparse[1]='kept'
 const original={blob:new Blob(['original binary'],{type:'application/octet-stream'}),
   map:new Map([['key',42]]),set:new Set(['a','b']),date:new Date('2026-10-10T00:00:00.000Z'),sparse}
 const decoded=decodeArchiveClone(await encodeArchiveClone(original)) as typeof original
 expect(await decoded.blob.text()).toBe('original binary')
 expect(decoded.blob.type).toBe('application/octet-stream')
 expect(decoded.map.get('key')).toBe(42)
 expect([...decoded.set]).toEqual(['a','b'])
 expect(decoded.date.toISOString()).toBe('2026-10-10T00:00:00.000Z')
 expect(decoded.sparse.length).toBe(3)
 expect(Object.hasOwn(decoded.sparse,0)).toBe(false)
 expect(decoded.sparse[1]).toBe('kept')
})

test('structured encoder refuses cycles instead of emitting a misleading backup',async()=>{
 const cyclic:Record<string,unknown>={}
 cyclic.self=cyclic
 await expect(encodeArchiveClone(cyclic)).rejects.toThrow()
 expect(()=>decodeArchiveClone(['unknown',{}])).toThrow()
})

test('portable codec retains invalid Date and enumerable custom array properties', async()=>{
 const array: Array<unknown> & { note?: string } = [2,4]
 array.note = 'retained'
 const result = decodeArchiveClone(await encodeArchiveClone({date:new Date(Number.NaN),array})) as {date:Date;array:typeof array}
 expect(Number.isNaN(result.date.getTime())).toBe(true)
 expect(result.array.note).toBe('retained')
})

test('portable codec retains file metadata, data views and regular expressions',async()=>{
 const raw={
  attachment:new File([new Uint8Array([1,2,3])], 'original-name.ogg',{
    type:'audio/ogg',lastModified:1712345678900,
  }),
  view:new DataView(new Uint8Array([9,8,7,6]).buffer,1,2),
  filter:/file_\\d+/gi,
 }
 const value=decodeArchiveClone(await encodeArchiveClone(raw)) as typeof raw
 expect(value.attachment.name).toBe('original-name.ogg')
 expect(value.attachment.lastModified).toBe(1712345678900)
 expect([...new Uint8Array(await value.attachment.arrayBuffer())]).toEqual([1,2,3])
 expect(value.view.byteOffset).toBe(1)
 expect(value.view.getUint8(0)).toBe(8)
 expect(value.filter.source).toBe(raw.filter.source)
 expect(value.filter.flags).toBe('gi')
})
