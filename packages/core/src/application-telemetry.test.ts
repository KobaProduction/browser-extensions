import { expect, test } from 'bun:test'
import { classifyTelemetryError, reportTelemetryError } from './application-telemetry'

test('error boundary classification emits only finite classes and never reads private exception fields', async () => {
  const calls: unknown[][] = []
  const controller = {
    record: async (...args: unknown[]) => {
      calls.push(args)
    },
  }
  const error = {
    name: 'QuotaExceededError',
    get message() {
      throw Error('Private message must not be read')
    },
    get stack() {
      throw Error('Private stack must not be read')
    },
  }
  expect(classifyTelemetryError(error)).toBe('storage')
  reportTelemetryError(controller, error, 'chatgpt-booster')
  expect(calls).toEqual([
    ['application.error', 1, undefined, { providerId: 'chatgpt-booster', errorClass: 'storage' }],
  ])
  expect(
    classifyTelemetryError({
      get name() {
        throw Error('Private')
      },
    }),
  ).toBe('internal')
  expect(
    classifyTelemetryError({
      name: {
        toString() {
          throw Error('Private')
        },
      },
    }),
  ).toBe('internal')
  expect(classifyTelemetryError(new DOMException('synthetic-private', 'AbortError'))).toBe('cancelled')
  expect(() =>
    reportTelemetryError(
      {
        record: () => {
          throw Error('sink')
        },
      } as never,
      error,
    ),
  ).not.toThrow()
  reportTelemetryError(
    {
      record: async () => {
        throw Error('async sink')
      },
    },
    error,
  )
  await Promise.resolve()
})
