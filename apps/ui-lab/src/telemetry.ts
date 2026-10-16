import type { DeliveryTarget, SettingsStore } from '@kobaproduction/browser-core'
import type { TelemetryEntry, TelemetryJournal } from '@kobaproduction/browser-storage'
import { createApplicationTelemetry } from '../../../packages/adapters/src/application-telemetry'

/** Synthetic journal only: no IndexedDB, extension messages or network transport. */
export function createLabTelemetry(
  target: DeliveryTarget,
  settings: SettingsStore,
  productId: 'vk-booster' | 'chatgpt-booster' | 'all-in-one',
) {
  let rows: TelemetryEntry[] = []
  let id = 0
  let configuration: unknown
  let delivery: unknown
  let discarded = 0
  let lastRotationAt: number | null = null
  const journal: TelemetryJournal = {
    async append(event) {
      if (rows.length >= 10000) {
        discarded++
        return
      }
      rows.push({ ...event, id: ++id, state: 'pending', leaseOwner: null, leaseUntil: 0, attempts: 0 })
    },
    async claim(owner, now = Date.now(), limit = 50) {
      const selected = rows
        .filter((row) => row.state === 'pending' || (row.state === 'sending' && row.leaseUntil <= now))
        .slice(0, limit)
      for (const row of selected) {
        row.state = 'sending'
        row.leaseOwner = owner
        row.leaseUntil = now + 45000
        row.attempts++
      }
      return structuredClone(selected)
    },
    async acknowledge(owner, ids) {
      let count = 0
      for (const row of rows)
        if (
          row.id !== undefined &&
          ids.includes(row.id) &&
          row.leaseOwner === owner &&
          row.state === 'sending'
        ) {
          row.state = 'sent'
          row.leaseOwner = null
          row.leaseUntil = 0
          count++
        }
      return count
    },
    async release(owner, ids) {
      for (const row of rows)
        if (
          row.id !== undefined &&
          ids.includes(row.id) &&
          row.leaseOwner === owner &&
          row.state === 'sending'
        ) {
          row.state = 'pending'
          row.leaseOwner = null
          row.leaseUntil = 0
        }
    },
    async summary() {
      return {
        retained: rows.length,
        pending: rows.filter((row) => row.state === 'pending').length,
        sending: rows.filter((row) => row.state === 'sending').length,
        delivered: rows.filter((row) => row.state === 'sent').length,
        discarded,
        lastRotationAt,
      }
    },
    async list(options = {}) {
      return structuredClone(
        rows
          .filter(
            (row) =>
              (!options.providerId || (row.providerId ?? 'application') === options.providerId) &&
              (options.beforeId === undefined || (row.id ?? 0) < options.beforeId),
          )
          .reverse()
          .slice(0, options.limit ?? 50),
      )
    },
    async prune(maxEvents, maxAgeMs, now = Date.now()) {
      const before = rows.length
      rows = rows.filter(
        (row) => row.timestamp >= now - maxAgeMs || (row.state === 'sending' && row.leaseUntil > now),
      )
      let excess = Math.max(0, rows.length - maxEvents)
      rows = rows.filter((row) => {
        if (excess && (row.state !== 'sending' || row.leaseUntil <= now)) {
          excess--
          return false
        }
        return true
      })
      lastRotationAt = now
      discarded += before - rows.length
      return before - rows.length
    },
    async readConfiguration() {
      return structuredClone(configuration)
    },
    async writeConfiguration(value) {
      configuration = structuredClone(value)
    },
    async readDeliveryStatus() {
      return structuredClone(delivery)
    },
    async writeDeliveryStatus(value) {
      delivery = structuredClone(value)
    },
    async clear() {
      rows = []
      discarded = 0
      lastRotationAt = null
    },
    close() {
      rows = []
    },
  }
  return createApplicationTelemetry(target, settings, `${productId}:dev`, journal, {
    local: true,
    remoteAvailable: false,
    sender: async () => {
      throw Error('External telemetry is disabled in UI Lab')
    },
  })
}
