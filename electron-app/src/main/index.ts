import './load-env'

import { getStreamerAvatar, getUserInfo } from './twitch-api'
import { preloadBadges, resolveBadges } from './twitch-badges'
import { buildSegments } from './chat-segments'

import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  checkGnomeSetup,
  ensureGnomeExtensionEnabled,
  resolveRepoExtensionPath,
  type GnomeCheckResult
} from './gnome-setup'

const tmi = require('tmi.js')
const dbus = require('dbus-next')

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
}

class StreamShellInterface extends dbus.interface.Interface {
  constructor(name: string) { super(name) }
  MessageReceived(user: string, color: string, text: string) { return [user, color, text] }
  ChatCleared() { return [] }
}

StreamShellInterface.configureMembers({
  signals: {
    MessageReceived: { signature: 'sss', names: ['user', 'color', 'text'] },
    ChatCleared: { signature: '', names: [] }
  }
})

let chatInterface: any = null
let twitchClient: any = null
let mainWindow: BrowserWindow | null = null
let joinTimeout: NodeJS.Timeout | null = null
let broadcasterId: string | null = null
let messageChain: Promise<void> = Promise.resolve()
let pendingGnomeStatus: GnomeCheckResult | null = null

const REPO_EXTENSION_PATH = resolveRepoExtensionPath()

async function initDBus() {
  try {
    const bus = dbus.sessionBus()
    await bus.requestName('org.streamshell.Twitch')
    chatInterface = new StreamShellInterface('org.streamshell.Twitch.Chat')
    bus.export('/org/streamshell/Twitch/Chat', chatInterface)
  } catch (err) {
    console.error('[StreamShell Backend] Error D-Bus:', err)
  }
}

function sendToRenderer(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function notifyOverlayClear(): void {
  if (chatInterface) chatInterface.ChatCleared()
}

function clearJoinTimeout(): void {
  if (joinTimeout) {
    clearTimeout(joinTimeout)
    joinTimeout = null
  }
}

function teardownTwitchClient(): void {
  clearJoinTimeout()
  if (twitchClient) {
    twitchClient.disconnect().catch(console.error)
    twitchClient = null
  }
}

function connectToTwitch(channel: string): void {
  teardownTwitchClient()

  // Empezamos una sesión nueva: pedimos al overlay que borre los
  // mensajes anteriores y muestre de nuevo el placeholder.
  notifyOverlayClear()

  twitchClient = new tmi.Client({ channels: [channel] })

  twitchClient.on('connected', (addr: string, port: number) => {
    console.log(`[StreamShell Backend] WebSocket abierto con ${addr}:${port}, esperando JOIN...`)
    clearJoinTimeout()
    joinTimeout = setTimeout(() => {
      console.warn('[StreamShell Backend] JOIN timeout')
      sendToRenderer('twitch:error', {
        message: `No se pudo entrar al canal "${channel}" (timeout)`
      })
      teardownTwitchClient()
    }, 8000)
  })

  twitchClient.on('join', (_ch: string, _user: string, self: boolean) => {
    if (!self) return
    clearJoinTimeout()
    console.log(`[StreamShell Backend] JOIN confirmado en: ${channel}`)
    sendToRenderer('twitch:connected', { channel })
    broadcasterId = null
    void getUserInfo(channel).then((info) => {
      broadcasterId = info?.id ?? null
      return preloadBadges(broadcasterId)
    })
  })

  twitchClient.on('notice', (_ch: string, msgid: string, message: string) => {
    console.warn(`[StreamShell Backend] notice ${msgid}: ${message}`)
    clearJoinTimeout()
    sendToRenderer('twitch:error', { message })
    teardownTwitchClient()
  })

  twitchClient.on('disconnected', (reason: string) => {
    clearJoinTimeout()
    console.log(`[StreamShell Backend] Desconectado: ${reason}`)
    sendToRenderer('twitch:disconnected', { reason })
  })

  twitchClient.on('message', (_channel: string, tags: any, message: string, self: boolean) => {
    if (self) return
    const user = String(tags['display-name'] || tags.username || 'unknown')
    const color = String(tags.color || '#8A2BE2')
    const text = String(message)

    messageChain = messageChain.then(async () => {
      const [badges, segments] = await Promise.all([
        resolveBadges(tags.badges, broadcasterId),
        buildSegments(text, tags.emotes)
      ])
      if (chatInterface) {
        chatInterface.MessageReceived(user, color, JSON.stringify({ badges, segments }))
      }
    })
  })

  twitchClient.connect().catch((err: Error) => {
    clearJoinTimeout()
    console.error('[StreamShell Backend] Error de conexión:', err)
    sendToRenderer('twitch:error', { message: err?.message ?? String(err) })
    teardownTwitchClient()
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#18181b',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.setBackgroundColor('#18181b')
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingGnomeStatus) {
      mainWindow?.webContents.send('gnome:status', pendingGnomeStatus)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  ipcMain.on('set-twitch-channel', (_event, channel: string) => connectToTwitch(channel))

  ipcMain.on('disconnect-twitch', () => {
    console.log('[StreamShell Backend] Desconectado por el usuario')
    teardownTwitchClient()
    notifyOverlayClear()
  })

  ipcMain.handle('get-streamer-avatar', async (_event, channel: string) => {
    return await getStreamerAvatar(channel)
  })

  await initDBus()

  try {
    pendingGnomeStatus = await checkGnomeSetup(is.dev, REPO_EXTENSION_PATH)
    for (const w of pendingGnomeStatus.warnings) {
      console.warn('[StreamShell Backend] GNOME warning:', w.key, w.params ?? '')
    }
  } catch (err) {
    console.error('[StreamShell Backend] checkGnomeSetup failed:', err)
    pendingGnomeStatus = { warnings: [], errors: [], needsRelogin: false, isWayland: false }
  }

  await ensureGnomeExtensionEnabled()

  createWindow()

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })