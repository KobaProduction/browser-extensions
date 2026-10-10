import type { FeatureRuntime } from '@kobaproduction/browser-core'
import type { Component } from 'vue'
export interface ControlCenterOptions {
  runtime: FeatureRuntime
  title?: string
  launcher?: boolean
  views?: Record<string, Component>
}
export interface ControlCenter {
  open(): void
  close(): void
  destroy(): void
}
export declare function mountControlCenter(options: ControlCenterOptions): ControlCenter
