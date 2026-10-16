const PART_BYTES = 48 * 1024
export const REMOTE_RESULT_MAX_BYTES = 32 * 1024 * 1024
export const REMOTE_RESULT_CACHE_BYTES = 64 * 1024 * 1024
const base64 = (bytes: Uint8Array) => {
  let text = ''
  for (let at = 0; at < bytes.length; at += 4096)
    text += String.fromCharCode(...bytes.subarray(at, at + 4096))
  return btoa(text)
}
/** Small v1 responses retain their existing frame; large results are logical transfers. */
export async function remoteCommandResultFrames(
  base: Record<string, unknown>,
  payload: unknown,
): Promise<{ frames: Record<string, unknown>[]; bytes: number }> {
  if (payload === undefined) return { frames: [base], bytes: JSON.stringify(base).length }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  if (bytes.byteLength > REMOTE_RESULT_MAX_BYTES)
    throw Error('Remote command result exceeds bounded transfer')
  if (bytes.byteLength <= PART_BYTES)
    return {
      frames: [{ ...base, result: payload }],
      bytes: bytes.byteLength + JSON.stringify(base).length,
    }
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('')
  const count = Math.ceil(bytes.byteLength / PART_BYTES),
    frames: Record<string, unknown>[] = []
  for (let index = 0; index < count; index++)
    frames.push({
      type: 'command-result-part',
      id: base.id,
      capability: base.capability,
      index,
      count,
      sha256,
      byteLength: bytes.byteLength,
      data: base64(bytes.subarray(index * PART_BYTES, (index + 1) * PART_BYTES)),
    })
  frames.push({ ...base, resultTransfer: { count, sha256, byteLength: bytes.byteLength } })
  return { frames, bytes: frames.reduce((sum, frame) => sum + JSON.stringify(frame).length, 0) }
}
