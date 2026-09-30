import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      setChannel: (channel: string) => void
      disconnectChannel: () => void
      onTwitchConnected: (cb: (data: { channel: string; addr: string; port: number }) => void) => () => void
      onTwitchError: (cb: (data: { message: string }) => void) => () => void
      onTwitchDisconnected: (cb: (data: { reason: string }) => void) => () => void
    }
  }
}