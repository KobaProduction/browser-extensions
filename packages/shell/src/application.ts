import type { FeatureRuntime } from '@kobaproduction/browser-core'

/** App identity is supplied by the composition root, independently of the host provider. */
export interface ApplicationIdentity {
  readonly id: string
  readonly title: string
  readonly version?: string
  readonly installation?: string
  readonly components?: readonly {
    readonly id: string
    readonly title: string
    readonly version: string
  }[]
}

export function resolveApplicationIdentity(
  runtime: FeatureRuntime,
  title: string,
  application?: ApplicationIdentity,
): ApplicationIdentity {
  if (application) return application
  const feature = runtime.features.length === 1 ? runtime.features[0] : undefined
  return {
    id: feature?.id ?? 'browser-tools',
    title: feature?.title ?? title,
    version: feature?.presentation?.version,
    installation: feature?.presentation?.installation,
  }
}
