import type { Source } from './archive-v4-entities'

export function key(...values: string[]): string {
  return JSON.stringify(values)
}

export function identity(value: string, label: string): string {
  if (!value || value.trim() !== value) throw new Error('Invalid value: '.concat(label))
  return value
}

export function sourceObject(value: unknown): Source {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid source message object')
  return value as Source
}

export function comparePoint(aTime: number, aId: string, bTime: number, bId: string): number {
  return aTime - bTime || (aId < bId ? -1 : aId > bId ? 1 : 0)
}
