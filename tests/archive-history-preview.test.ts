import { describe, expect, test } from 'bun:test'
import { archiveHistoryPreview } from '../packages/ui/src/archive-history-preview'

describe('Archive History label presentation', () => {
  test('hides real Free attachment transport pointers without mutating the source', () => {
    const raw =
      '[image_asset_pointer] sediment://file_00000000032c824697d84d1140898533\nЭто оригинальный кабель?'
    expect(archiveHistoryPreview(raw, 'ru')).toBe('Изображение · Это оригинальный кабель?')
    expect(archiveHistoryPreview(raw, 'en')).toBe('Image · Это оригинальный кабель?')
    expect(raw).toContain('sediment://file_')
  })
  test('renders readable Markdown without citations or raw links', () => {
    const raw = '## **Ответ** с `кодом` и [ссылкой](https://example.com/path) citeturn0search0'
    expect(archiveHistoryPreview(raw, 'ru')).toBe('Ответ с кодом и ссылкой')
  })
  test('keeps relevant ordinary text and suppresses opaque standalone asset identifiers', () => {
    const raw = 'Смотри sediment://file_123 подробности'
    expect(archiveHistoryPreview(raw, 'ru')).toBe('Смотри подробности')
  })
  test('truncates navigator display text only', () => {
    const raw = 'x'.repeat(300)
    expect(archiveHistoryPreview(raw, 'ru').length).toBe(180)
    expect(raw.length).toBe(300)
  })
})
