/** Portable, collision-free structured-clone encoding for IndexedDB rows that
 * are NOT representable by JSON. Ordinary JSON rows stay in their native form;
 * this tagged representation is used only when the lossless fast path fails.
 * References/cycles and arbitrary class instances are refused rather than
 * silently lost. No application source/owner information is interpreted. */
export type ArchiveCloneNode = unknown

const safeBytes = (buffer: ArrayBuffer | Uint8Array): Uint8Array =>
  buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
function toBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = safeBytes(data)
  const parts: string[] = []
  // Encode exact 3-byte-aligned windows so only the last Base64 block is padded.
  for (let offset = 0; offset < bytes.length; offset += 32766) {
    let text = ''
    for (const byte of bytes.subarray(offset, offset + 32766))
      text += String.fromCharCode(byte)
    parts.push(btoa(text))
  }
  return parts.join('')
}
function fromBase64(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > 400_000_000)
    throw new Error('Invalid portable binary value')
  const decoded = atob(value)
  const output = new Uint8Array(decoded.length)
  for(let i=0;i<decoded.length;i++) output[i]=decoded.charCodeAt(i)
  return output
}
const typed = new Set([
  'Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array',
  'Int32Array','Uint32Array','Float32Array','Float64Array',
  'BigInt64Array','BigUint64Array','DataView',
])
const isPlain = (value: object) => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export async function encodeArchiveClone(value: unknown): Promise<ArchiveCloneNode> {
  const visited = new Set<object>()
  async function encode(input: unknown, depth: number): Promise<ArchiveCloneNode> {
    if (depth > 150) throw new Error('Archive structured data exceeds maximum nesting depth')
    if (input === undefined) return ['undefined']
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'number') return Number.isFinite(input) && !Object.is(input, -0)
      ? input : ['number', String(input)]
    if (typeof input === 'bigint') return ['bigint', input.toString()]
    if (!input || typeof input !== 'object' || visited.has(input))
      throw new Error('Archive structured data contains a cycle or unsupported value')
    // Keep every identity until the record is encoded; repeated references
    // require a real reference graph and must never be cloned as distinct rows.
    visited.add(input)
    if (input instanceof Date) return ['date', Number.isFinite(input.getTime()) ? input.getTime() : 'NaN']
      if (input instanceof RegExp) return ['regexp', input.source, input.flags]
      if (typeof File !== 'undefined' && input instanceof File)
        return ['file', input.name, input.lastModified, input.type,
          toBase64(await input.arrayBuffer())]
      if (typeof Blob !== 'undefined' && input instanceof Blob)
        return ['blob', input.type, toBase64(await input.arrayBuffer())]
      if (input instanceof ArrayBuffer) return ['buffer',toBase64(input)]
      if (ArrayBuffer.isView(input)) {
        const name = input.constructor.name
        if (!typed.has(name) || !(input.buffer instanceof ArrayBuffer))
          throw new Error('Unsupported typed view in archive')
        return ['view',name,input.byteOffset,input.byteLength,toBase64(input.buffer)]
      }
      if (input instanceof Map) {
        const entries: unknown[] = []
        for (const [key,value] of input)
          entries.push([await encode(key,depth+1), await encode(value,depth+1)])
        return ['map',entries]
      }
      if (input instanceof Set) {
        const entries: unknown[] = []
        for (const item of input) entries.push(await encode(item,depth+1))
        return ['set',entries]
      }
      if (Array.isArray(input)) {
        const entries: unknown[] = []
        for (const key of Object.keys(input))
          entries.push([key,await encode(input[key as unknown as number],depth+1)])
        return ['array',input.length,entries]
      }
      if (!isPlain(input)) throw new Error('Unsupported archive structured object prototype')
      const entries: unknown[] = []
      for (const [key,item] of Object.entries(input))
        entries.push([key,await encode(item,depth+1)])
      return ['object',entries]
  }
  return encode(value,0)
}

export function decodeArchiveClone(value: ArchiveCloneNode): unknown {
  function decode(input: unknown, depth: number): unknown {
    if (depth > 150) throw new Error('Encoded archive structure exceeds maximum nesting depth')
    if (!Array.isArray(input)) {
      if (input === null || typeof input === 'string' || typeof input === 'boolean' ||
        (typeof input === 'number' && Number.isFinite(input))) return input
      throw new Error('Invalid encoded archive primitive')
    }
    const [tag,...fields] = input
    if (tag === 'undefined' && !fields.length) return undefined
    if (tag === 'number' && typeof fields[0] === 'string') {
      if (fields[0] === 'NaN') return Number.NaN
      if (fields[0] === 'Infinity') return Infinity
      if (fields[0] === '-Infinity') return -Infinity
      if (fields[0] === '0' || fields[0] === '-0') return -0
      throw new Error('Invalid encoded numeric value')
    }
    if (tag === 'bigint' && typeof fields[0] === 'string') return BigInt(fields[0])
    if (tag === 'date' && (typeof fields[0] === 'number' || fields[0] === 'NaN'))
      return new Date(fields[0] === 'NaN' ? Number.NaN : fields[0] as number)
    if (tag === 'regexp' && typeof fields[0] === 'string' && typeof fields[1] === 'string')
      return new RegExp(fields[0],fields[1])
    if (tag === 'buffer') return fromBase64(fields[0]).buffer
    if (tag === 'blob' && typeof fields[0] === 'string')
      return new Blob([fromBase64(fields[1])],{type:fields[0]})
    if (tag === 'file' && typeof fields[0] === 'string' &&
        typeof fields[1] === 'number' && typeof fields[2] === 'string')
      return new File([fromBase64(fields[3])],fields[0],{lastModified:fields[1],type:fields[2]})
    if (tag === 'view') {
      const [name,offset,size,encoded] = fields
      if (typeof name !== 'string' || !typed.has(name) || !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(size) || (offset as number)<0 || (size as number)<0)
        throw new Error('Invalid portable typed view')
      const buffer = fromBase64(encoded).buffer
      if ((offset as number)+(size as number)>buffer.byteLength) throw new Error('Portable view out of bounds')
      switch(name) {
        case 'DataView': return new DataView(buffer,offset as number,size as number)
        case 'Int8Array': return new Int8Array(buffer,offset as number,size as number)
        case 'Uint8Array': return new Uint8Array(buffer,offset as number,size as number)
        case 'Uint8ClampedArray': return new Uint8ClampedArray(buffer,offset as number,size as number)
        case 'Int16Array': return new Int16Array(buffer,offset as number,(size as number)/2)
        case 'Uint16Array': return new Uint16Array(buffer,offset as number,(size as number)/2)
        case 'Int32Array': return new Int32Array(buffer,offset as number,(size as number)/4)
        case 'Uint32Array': return new Uint32Array(buffer,offset as number,(size as number)/4)
        case 'Float32Array': return new Float32Array(buffer,offset as number,(size as number)/4)
        case 'Float64Array': return new Float64Array(buffer,offset as number,(size as number)/8)
        case 'BigInt64Array': return new BigInt64Array(buffer,offset as number,(size as number)/8)
        case 'BigUint64Array': return new BigUint64Array(buffer,offset as number,(size as number)/8)
      }
    }
    if (tag === 'array') {
      const length = fields[0]
      const entries = fields[1]
      if (!Number.isSafeInteger(length) || (length as number) < 0 ||
          (length as number) > 20_000_000 || !Array.isArray(entries))
        throw new Error('Invalid portable archive array length')
      const result = new Array(length as number)
      for (const pair of entries) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' ||
            pair[0] === 'length' || (/^(0|[1-9]\d*)$/.test(pair[0]) &&
              Number(pair[0]) >= (length as number)))
          throw new Error('Invalid portable archive array index')
        Object.defineProperty(result, pair[0], { value: decode(pair[1], depth+1),
          enumerable: true, writable: true, configurable: true })
      }
      return result
    }
    const pairs = fields[0]
    if (!Array.isArray(pairs)) throw new Error('Encoded archive collection is not an array')
    if (tag === 'map') {
      const result = new Map<unknown, unknown>()
      for (const pair of pairs) {
        if (!Array.isArray(pair) || pair.length!==2) throw new Error('Malformed encoded Map')
        result.set(decode(pair[0],depth+1),decode(pair[1],depth+1))
      }
      return result
    }
    if (tag === 'set') return new Set(pairs.map(row=>decode(row,depth+1)))
    if (tag === 'object') {
      const object: Record<string,unknown> = Object.create(null) as Record<string,unknown>
      for (const pair of pairs) {
        if (!Array.isArray(pair) || pair.length!==2 || typeof pair[0]!=='string')
          throw new Error('Malformed archive object property')
        Object.defineProperty(object,pair[0],{value:decode(pair[1],depth+1),enumerable:true,
          writable:true,configurable:true})
      }
      return object
    }
    throw new Error('Unknown structured archive type tag')
  }
  return decode(value,0)
}
