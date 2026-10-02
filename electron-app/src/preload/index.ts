import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppPreferences } from '../shared/types'
import type {
  GnomeStatus,
  TwitchAuthStatus,
  TwitchConnectedPayload,
  TwitchDisconnectedPayload,
  TwitchErrorPayload
} from '../shared/types'

const api = {
  setChannel: (channel: string) => ipcRenderer.send('set-twitch-channel', channel),
  disconnectChannel: () => ipcRenderer.send('disconnect-twitch'),
  getStreamerAvatar: (channel: string) => ipcRenderer.invoke('get-streamer-avatar', channel),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setPreferences: (preferences: AppPreferences) =>
    ipcRenderer.invoke('preferences:set', preferences),
  getTwitchAuthStatus: () => ipcRenderer.invoke('auth:get-status'),
  loginToTwitch: () => ipcRenderer.invoke('auth:login'),
  cancelTwitchLogin: () => ipcRenderer.invoke('auth:cancel-login'),
  logoutFromTwitch: () => ipcRenderer.invoke('auth:logout'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),

  onTwitchConnected: (cb: (data: { channel: string }) => void) => {
    const listener = (_e: unknown, data: TwitchConnectedPayload): void => cb(data)
    ipcRenderer.on('twitch:connected', listener)
    return () => ipcRenderer.removeListener('twitch:connected', listener)
  },
  onTwitchError: (cb: (data: { key: string; params?: Record<string, string> }) => void) => {
    const listener = (_e: unknown, data: TwitchErrorPayload): void => cb(data)
    ipcRenderer.on('twitch:error', listener)
    return () => ipcRenderer.removeListener('twitch:error', listener)
  },
  onTwitchDisconnected: (cb: (data: { reason: string }) => void) => {
    const listener = (_e: unknown, data: TwitchDisconnectedPayload): void => cb(data)
    ipcRenderer.on('twitch:disconnected', listener)
    return () => ipcRenderer.removeListener('twitch:disconnected', listener)
  },

  onGnomeStatus: (cb: (data: GnomeStatus) => void) => {
    const listener = (_e: unknown, data: GnomeStatus): void => cb(data)
    ipcRenderer.on('gnome:status', listener)
    return () => ipcRenderer.removeListener('gnome:status', listener)
  },
  onTwitchAuthStatus: (cb: (data: TwitchAuthStatus) => void) => {
    const listener = (_e: unknown, data: TwitchAuthStatus): void => cb(data)
    ipcRenderer.on('twitch:auth-status', listener)
    return () => ipcRenderer.removeListener('twitch:auth-status', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  Object.assign(window, { electron: electronAPI, api })
}
