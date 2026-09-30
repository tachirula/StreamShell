import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const tmi = require('tmi.js')
const dbus = require('dbus-next')

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
}

class StreamShellInterface extends dbus.interface.Interface {
  constructor(name: string) { super(name) }
  MessageReceived(user: string, color: string, text: string) { return [user, color, text] }
}

StreamShellInterface.configureMembers({
  signals: { MessageReceived: { signature: 'sss', names: ['user', 'color', 'text'] } }
})

let chatInterface: any = null
let twitchClient: any = null

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

function connectToTwitch(channel: string): void {
  if (twitchClient) {
    twitchClient.disconnect().catch(console.error)
  }
  twitchClient = new tmi.Client({ channels: [channel] })

  twitchClient.on('connected', (addr, port) => {
    console.log(`[StreamShell Backend] Conectado exitosamente a: ${channel} (${addr}:${port})`)
  })

  twitchClient.connect().catch(console.error)

  twitchClient.on('message', (_channel, tags, message, self) => {
    if (self) return
    const user = String(tags['display-name'] || tags.username || 'unknown')
    const color = String(tags.color || '#8A2BE2')
    const text = String(message)
    if (chatInterface) chatInterface.MessageReceived(user, color, text)
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 600,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#18181b',   // 👈 ESTA LÍNEA elimina la franja blanca
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Refuerzo: por si el SO pinta algo antes del primer frame
  mainWindow.setBackgroundColor('#18181b')

  mainWindow.on('ready-to-show', () => mainWindow.show())

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

  ipcMain.on('set-twitch-channel', (event, channel) => connectToTwitch(channel))

  ipcMain.on('disconnect-twitch', () => {
    if (twitchClient) {
      twitchClient.disconnect().catch(console.error)
      twitchClient = null
      console.log('[StreamShell Backend] Desconectado por el usuario')
    }
  })

  await initDBus()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })