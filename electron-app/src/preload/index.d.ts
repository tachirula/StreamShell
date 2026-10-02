import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AppPreferences,
  GnomeStatus,
  TwitchAuthStatus,
  TwitchConnectedPayload,
  TwitchDisconnectedPayload,
  TwitchErrorPayload
} from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      setChannel: (channel: string) => void
      disconnectChannel: () => void
      getStreamerAvatar: (channel: string) => Promise<string | null>
      getPreferences: () => Promise<AppPreferences>
      setPreferences: (preferences: AppPreferences) => Promise<AppPreferences>
      getTwitchAuthStatus: () => Promise<TwitchAuthStatus>
      loginToTwitch: () => Promise<TwitchAuthStatus>
      cancelTwitchLogin: () => Promise<void>
      logoutFromTwitch: () => Promise<TwitchAuthStatus>
      clearCache: () => Promise<boolean>
      onTwitchConnected: (cb: (data: TwitchConnectedPayload) => void) => () => void
      onTwitchError: (cb: (data: TwitchErrorPayload) => void) => () => void
      onTwitchDisconnected: (cb: (data: TwitchDisconnectedPayload) => void) => () => void
      onGnomeStatus: (cb: (data: GnomeStatus) => void) => () => void
      onTwitchAuthStatus: (cb: (data: TwitchAuthStatus) => void) => () => void
    }
  }
}
