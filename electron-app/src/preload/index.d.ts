import { ElectronAPI } from '@electron-toolkit/preload'

export interface GnomeStatus {
  warnings: string[]
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