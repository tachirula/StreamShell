import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  setChannel: (channel: string) => ipcRenderer.send('set-twitch-channel', channel),
  disconnectChannel: () => ipcRenderer.send('disconnect-twitch'),

  onTwitchConnected: (cb: (data: { channel: string }) => void) => {
    const listener = (_e: unknown, data: any) => cb(data)
    ipcRenderer.on('twitch:connected', listener)
    return () => ipcRenderer.removeListener('twitch:connected', listener)
  },
  onTwitchError: (cb: (data: { message: string }) => void) => {
    const listener = (_e: unknown, data: any) => cb(data)
    ipcRenderer.on('twitch:error', listener)
    return () => ipcRenderer.removeListener('twitch:error', listener)
  },
  onTwitchDisconnected: (cb: (data: { reason: string }) => void) => {
    const listener = (_e: unknown, data: any) => cb(data)
    ipcRenderer.on('twitch:disconnected', listener)
    return () => ipcRenderer.removeListener('twitch:disconnected', listener)
  },

  onGnomeStatus: (cb: (data: {
    warnings: string[]
    errors: string[]
    needsRelogin: boolean
    isWayland: boolean
  }) => void) => {
    const listener = (_e: unknown, data: any) => cb(data)
    ipcRenderer.on('gnome:status', listener)
    return () => ipcRenderer.removeListener('gnome:status', listener)
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
  // @ts-ignore (define in dts)
  window.electron = electronAPI; window.api = api
}