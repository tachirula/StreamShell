import { ElectronAPI } from '@electron-toolkit/preload'
declare global {
  interface Window {
    electron: ElectronAPI
    api: { setChannel: (channel: string) => void; disconnectChannel: () => void }
  }
}
