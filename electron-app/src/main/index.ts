import './load-env'

import { getStreamerAvatar, getUserInfo } from './twitch-api'
import { preloadBadges, resolveBadges } from './twitch-badges'
import { buildSegments, type Segment } from './chat-segments'
import { clearImageCache } from './emote-cache'
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  validatePreferences,
  type AppPreferences
} from './preferences'

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
  constructor(name: string) {
    super(name)
  }
  MessageReceived(user: string, color: string, text: string) {
    return [user, color, text]
  }
  HistoryMessageReceived(user: string, color: string, text: string) {
    return [user, color, text]
  }
  ChatCleared() {
    return []
  }
  OverlaySettingsChanged(settings: string) {
    return settings
  }
}

StreamShellInterface.configureMembers({
  signals: {
    MessageReceived: { signature: 'sss', names: ['user', 'color', 'text'] },
    HistoryMessageReceived: { signature: 'sss', names: ['user', 'color', 'text'] },
    ChatCleared: { signature: '', names: [] },
    OverlaySettingsChanged: { signature: 's', names: ['settings'] }
  }
})

let chatInterface: any = null
let twitchClient: any = null
let mainWindow: BrowserWindow | null = null
let joinTimeout: NodeJS.Timeout | null = null
let broadcasterId: string | null = null
let messageChain: Promise<void> = Promise.resolve()
let pendingGnomeStatus: GnomeCheckResult | null = null
let preferences: AppPreferences = DEFAULT_PREFERENCES
let activeChannel: string | null = null
let preferenceRevision = 0
const chatHistory: {
  user: string
  color: string
  text: string
  badges: string[]
  emotes: Record<string, string[]> | null
}[] = []
const MAX_STORED_HISTORY = 500

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

async function publishPreferences(): Promise<void> {
  const revision = ++preferenceRevision
  const queued = messageChain.then(async () => {
    if (revision !== preferenceRevision) return
    const shouldReplayHistory = preferences.historyEnabled && activeChannel !== null
    const history = shouldReplayHistory ? chatHistory.slice(-preferences.historyLimit) : []
    const replay: { user: string; color: string; payload: string }[] = []
    for (const message of history) {
      if (revision !== preferenceRevision) return
      const segments = await buildSegments(message.text, message.emotes, { animated: false })
      replay.push({
        user: message.user,
        color: message.color,
        payload: JSON.stringify({ badges: message.badges, segments })
      })
    }

    if (revision !== preferenceRevision || !chatInterface) return
    chatInterface.OverlaySettingsChanged(
      JSON.stringify({
        chatWidth: preferences.chatWidth,
        maxVisibleMessages: preferences.maxVisibleMessages,
        historyEnabled: preferences.historyEnabled,
        historyLimit: preferences.historyLimit
      })
    )
    if (shouldReplayHistory) {
      chatInterface.ChatCleared()
      for (const message of replay) {
        chatInterface.HistoryMessageReceived(message.user, message.color, message.payload)
      }
    }
  })
  messageChain = queued.catch((err) => {
    console.error('[StreamShell Backend] Failed to publish overlay preferences:', err)
  })
  await messageChain
}

function clearJoinTimeout(): void {
  if (joinTimeout) {
    clearTimeout(joinTimeout)
    joinTimeout = null
  }
}

function teardownTwitchClient(): void {
  clearJoinTimeout()
  activeChannel = null
  if (twitchClient) {
    twitchClient.disconnect().catch(console.error)
    twitchClient = null
  }
}

function connectToTwitch(channel: string): void {
  teardownTwitchClient()
  activeChannel = channel
  chatHistory.length = 0

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
    activeChannel = null
    console.log(`[StreamShell Backend] Desconectado: ${reason}`)
    sendToRenderer('twitch:disconnected', { reason })
  })

  twitchClient.on('message', (_channel: string, tags: any, message: string, self: boolean) => {
    if (self) return
    const user = String(tags['display-name'] || tags.username || 'unknown')
    const color = String(tags.color || '#8A2BE2')
    const text = String(message)

    messageChain = messageChain
      .then(async () => {
        let badges: string[] = []
        let segments: Segment[] = [{ t: 'text', v: text }]
        try {
          ;[badges, segments] = await Promise.all([
            resolveBadges(tags.badges, broadcasterId),
            buildSegments(text, tags.emotes)
          ])
        } catch (err) {
          console.warn('[StreamShell Backend] could not resolve message assets:', err)
        }
        const emotes =
          tags.emotes && typeof tags.emotes === 'object'
            ? Object.fromEntries(
                Object.entries(tags.emotes as Record<string, string[]>).map(([id, positions]) => [
                  id,
                  [...positions]
                ])
              )
            : null
        if (activeChannel) {
          chatHistory.push({ user, color, text, badges, emotes })
          if (chatHistory.length > MAX_STORED_HISTORY) chatHistory.shift()
        }
        if (chatInterface) {
          chatInterface.MessageReceived(user, color, JSON.stringify({ badges, segments }))
        }
      })
      .catch((err) => console.error('[StreamShell Backend] message pipeline failed:', err))
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
  mainWindow.on('closed', () => {
    mainWindow = null
  })

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

  preferences = await loadPreferences()

  ipcMain.on('set-twitch-channel', (_event, channel: string) => connectToTwitch(channel))

  ipcMain.on('disconnect-twitch', () => {
    console.log('[StreamShell Backend] Desconectado por el usuario')
    teardownTwitchClient()
    notifyOverlayClear()
  })

  ipcMain.handle('preferences:get', async () => {
    await publishPreferences()
    return preferences
  })

  ipcMain.handle('preferences:set', async (_event, value: unknown) => {
    const next = validatePreferences(value)
    await savePreferences(next)
    preferences = next
    await publishPreferences()
    return preferences
  })

  ipcMain.handle('cache:clear', async () => {
    if (activeChannel) {
      throw new Error('Disconnect from Twitch before clearing the image cache')
    }
    await clearImageCache()
    return true
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
