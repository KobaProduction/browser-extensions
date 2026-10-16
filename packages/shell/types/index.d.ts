import type {
  ApplicationBackupController,
  ApplicationTelemetryController,
  FeatureRuntime,
} from '@kobaproduction/browser-core'
import type { Component } from 'vue'
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
export interface ControlCenterOptions {
  runtime: FeatureRuntime
  title?: string
  application?: ApplicationIdentity
  launcher?: boolean
  views?: Record<string, Component>
  telemetry?: ApplicationTelemetryController
  backup?: ApplicationBackupController
}
export interface ControlCenter {
  open(): void
  openSettings(categoryId?: string): void
  openMenu(): void
  close(): void
  destroy(): void
}
export declare function mountControlCenter(options: ControlCenterOptions): ControlCenter
export interface BrowserToolsPopupOptions {
  openSettings(): Promise<void>
  openMenu(): Promise<void>
  application?: Pick<ApplicationIdentity, 'title' | 'version'>
  locale?: import('@kobaproduction/browser-core').ApplicationLocaleController
}
export declare function mountBrowserToolsPopup(
  host: HTMLElement,
  options: BrowserToolsPopupOptions,
): { destroy(): void }
