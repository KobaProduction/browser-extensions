/** File System Access output adapter. No provider DTOs, auth or archive schema. */
export function createArchiveFiles(getRoot: () => FileSystemDirectoryHandle) {
  async function json(name: string): Promise<unknown | null> {
    try {
      const file = await getRoot().getFileHandle(name)
      return JSON.parse(await (await file.getFile()).text())
    } catch (error) {
      if ((error as Error)?.name === 'NotFoundError') return null
      throw error
    }
  }

  async function write(name: string, data: unknown, parent = getRoot()): Promise<void> {
    const file = await parent.getFileHandle(name, { create: true })
    const writer = await file.createWritable()
    try {
      const payload =
        data instanceof Uint8Array
          ? new Uint8Array(data)
          : typeof data === 'string' || data instanceof Blob
            ? data
            : JSON.stringify(data, null, 2) + '\n'
      await writer.write(payload)
      await writer.close()
    } catch (error) {
      await writer.abort().catch(() => undefined)
      throw error
    }
  }

  async function dir(name: string, parent = getRoot()): Promise<FileSystemDirectoryHandle> {
    return parent.getDirectoryHandle(name, { create: true })
  }

  return { json, write, dir }
}
