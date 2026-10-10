<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ text: string }>()

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
function safeLink(value: string) {
  try {
    const url = new URL(value, 'https://chatgpt.com')
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
function inline(value: string) {
  const code: string[] = []
  let text = value.replace(/`([^`]+)`/g, (_, content: string) => {
    const index = code.push(`<code>${escapeHtml(content)}</code>`) - 1
    return `\u0000CODE${index}\u0000`
  })
  text = escapeHtml(text)
  text = text.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label: string, href: string) => {
    const safe = safeLink(href.replaceAll('&amp;', '&'))
    return safe
      ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer noopener">${label}</a>`
      : `${label} (${href})`
  })
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
  return text.replace(/\u0000CODE(\d+)\u0000/g, (_, index: string) => code[Number(index)] ?? '')
}
function table(lines: string[], start: number) {
  if (start + 1 >= lines.length || !lines[start]?.includes('|')) return null
  const separator = lines[start + 1]?.trim() ?? ''
  if (!/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator)) return null
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())
  const header = cells(lines[start] ?? '')
  const rows: string[][] = []
  let end = start + 2
  while (end < lines.length && lines[end]?.includes('|') && lines[end]?.trim()) {
    rows.push(cells(lines[end] ?? ''))
    end++
  }
  return {
    end,
    html: `<div class="booster-markdown-table-wrap"><table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
  }
}
function renderMarkdown(source: string) {
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  const out: string[] = []
  let paragraph: string[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  const flushParagraph = () => {
    if (!paragraph.length) return
    out.push(`<p>${inline(paragraph.join('\n')).replaceAll('\n', '<br>')}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    out.push(`<${list.type}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.type}>`)
    list = null
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    if (line.trim().startsWith('```')) {
      flushParagraph(); flushList()
      const language = line.trim().slice(3).trim()
      const body: string[] = []
      index++
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        body.push(lines[index] ?? '')
        index++
      }
      out.push(`<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    const parsedTable = table(lines, index)
    if (parsedTable) {
      flushParagraph(); flushList(); out.push(parsedTable.html); index = parsedTable.end - 1; continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph(); flushList()
      const level = heading[1]?.length ?? 1
      out.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`)
      continue
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      flushParagraph()
      const type = ordered ? 'ol' : 'ul'
      if (list && list.type !== type) flushList()
      list ??= { type, items: [] }
      list.items.push((ordered?.[1] ?? unordered?.[1]) || '')
      continue
    }
    if (/^\s*>/.test(line)) {
      flushParagraph(); flushList()
      const quote = [line.replace(/^\s*>\s?/, '')]
      while (index + 1 < lines.length && /^\s*>/.test(lines[index + 1] ?? '')) {
        index++; quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''))
      }
      out.push(`<blockquote>${inline(quote.join('\n')).replaceAll('\n', '<br>')}</blockquote>`)
      continue
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph(); flushList(); out.push('<hr>'); continue
    }
    if (!line.trim()) {
      flushParagraph(); flushList(); continue
    }
    paragraph.push(line)
  }
  flushParagraph(); flushList()
  return out.join('')
}
const html = computed(() => renderMarkdown(props.text))
</script>

<template>
  <div class="booster-markdown" v-html="html" />
</template>
