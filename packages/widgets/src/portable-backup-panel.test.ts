import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from 'vue/compiler-sfc'

const source = readFileSync(new URL('./PortableBackupPanel.vue', import.meta.url), 'utf8')
test('reusable backup panel compiles and presents independent restore choices', () => {
  const { descriptor, errors } = parse(source, { filename: 'PortableBackupPanel.vue' })
  expect(errors).toHaveLength(0)
  const compiled = compileTemplate({
    source: descriptor.template?.content ?? '',
    filename: 'PortableBackupPanel.vue',
    id: 'portable-backup',
  })
  expect(compiled.errors).toHaveLength(0)
  expect(source).toContain("event: 'export'")
  expect(source).toContain("(event: 'restore'")
  expect(source).toContain('Сжать весь TAR (GZIP)')
  expect(source).toContain('Размер чанка')
  expect(source).toContain('Сохранить TAR / TAR.GZ')
  expect(source).toContain('progress.percent')
  expect(source).toContain('Состояние текущей вкладки и сессии никогда')
  expect(source).toContain('Подтверждаю восстановление')
})
