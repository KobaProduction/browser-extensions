import {test,expect} from 'bun:test'
import {readArchiveMedia} from './media'

test('reads original binary data with a bounded result and digest', async () => {
  const bytes = new TextEncoder().encode('OggS-original-media')
  const response = new Response(bytes,{headers:{'content-type':'audio/ogg; codecs=opus'}})
  const result = await readArchiveMedia(response,{maxBytes:100,expectedBytes:bytes.length})
  expect(result.size).toBe(bytes.length)
  expect(result.mime).toBe('audio/ogg')
  expect([...result.bytes]).toEqual([...bytes])
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
})
test('rejects HTML masquerading as media and mismatched original size', async () => {
  await expect(readArchiveMedia(new Response('<html/>',{headers:{'content-type':'text/html'}}),
    {maxBytes:100})).rejects.toThrow('HTML')
  await expect(readArchiveMedia(new Response('body'),{maxBytes:100,expectedBytes:15}))
    .rejects.toThrow('Invalid original media size')
})
test('rejects declared or streamed oversize without exposing provider URLs', async () => {
  await expect(readArchiveMedia(new Response('too long',{headers:{'content-length':'999'}}),
    {maxBytes:4})).rejects.toThrow('size limit')
  await expect(readArchiveMedia(new Response('too long'),{maxBytes:4}))
    .rejects.toThrow('size limit')
})
