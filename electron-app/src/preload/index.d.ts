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

export interface AppPreferences {
  chatWidth: number
  backgroundOpacity: number
  maxVisibleMessages: number
  historyEnabled: boolean
  historyLimit: number
  thirdPartyEmotesEnabled: boolean
  toggleChatShortcut: string
  emoteImageScale: '1x' | '3x' | '4x'
  emoteBestQuality: boolean
  maxConcurrentImageDownloads: number
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      setChannel: (channel: string) => void
      disconnectChannel: () => void
      getStreamerAvatar: (channel: string) => Promise<string | null>
      getPreferences: () => Promise<AppPreferences>
      setPreferences: (preferences: AppPreferences) => Promise<AppPreferences>
      clearCache: () => Promise<boolean>
      onTwitchConnected: (cb: (data: { channel: string }) => void) => () => void
      onTwitchError: (
        cb: (data: { key: string; params?: Record<string, string> }) => void
      ) => () => void
      onTwitchDisconnected: (cb: (data: { reason: string }) => void) => () => void
      onGnomeStatus: (cb: (data: GnomeStatus) => void) => () => void
    }
  }
}
