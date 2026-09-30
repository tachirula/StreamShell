import { ElectronAPI } from '@electron-toolkit/preload'

export type GnomeWarningKey =
  | 'repoNotFound'
  | 'symlinkElsewhere'
  | 'symlinkCheckFailed'
  | 'schemaCompileFailed'
  | 'staleWayland'
  | 'staleGeneric'

export interface GnomeWarning {
  key: GnomeWarningKey
  params?: Record<string, string>
}

export interface GnomeStatus {
  warnings: GnomeWarning[]
  errors: string[]
  needsRelogin: boolean
  isWayland: boolean
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      setChannel: (channel: string) => void
      disconnectChannel: () => void
      onTwitchConnected: (cb: (data: { channel: string }) => void) => () => void
      onTwitchError: (cb: (data: { message: string }) => void) => () => void
      onTwitchDisconnected: (cb: (data: { reason: string }) => void) => () => void
      onGnomeStatus: (cb: (data: GnomeStatus) => void) => () => void
    }
  }
}