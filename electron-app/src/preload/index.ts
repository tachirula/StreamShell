import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  setChannel: (channel: string) => ipcRenderer.send('set-twitch-channel', channel),
  disconnectChannel: () => ipcRenderer.send('disconnect-twitch'),

  onTwitchConnected: (cb: (data: { channel: string; addr: string; port: number }) => void) => {
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