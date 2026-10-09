import { test, expect } from 'bun:test'
import { brandMark, classicThemeCss } from './theme'

test('brand has independent vector mark without external image assets', () => {
  expect(brandMark).toContain('<svg')
  expect(brandMark).toContain('viewBox="0 0 44 44"')
  expect(brandMark).not.toMatch(/https?:\/\//)
})

test('classic palette, focus, contrast and hidden host are part of shared skin', () => {
  expect(classicThemeCss).toContain('--kb-bg')
  expect(classicThemeCss).toContain('--kb-accent')
  expect(classicThemeCss).toContain(':host([hidden]){display:none!important}')
  expect(classicThemeCss).toContain('focus-visible')
  expect(classicThemeCss).toContain('prefers-color-scheme:dark')
  expect(classicThemeCss).toContain('max-width:520px')
})
