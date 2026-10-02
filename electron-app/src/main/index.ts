import './load-env'

import {
  getAuthenticatedTwitchUserAvatar,
  getStreamerAvatar,
  setTwitchUserAccessTokenProvider,
  getTwitchUserProfile
} from './twitch-api'
import { preloadBadges, resolveBadges } from './twitch-badges'
import { buildSegments, stripReplyMention, type ChatReply, type Segment } from './chat-segments'
import { cacheImage, clearImageCache, setMaxConcurrentImageDownloads } from './emote-cache'
import { clearThirdPartyEmotes, loadThirdPartyEmotes } from './third-party-emotes'
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  validatePreferences
} from './preferences'
import {
  clearStoredTwitchSession,
  loadStoredTwitchSession,
  pollTwitchDeviceAuthorization,
  refreshTwitchSession,
  requestTwitchDeviceAuthorization,
  revokeTwitchAccessToken,
  saveTwitchSession,
  TwitchAuthError,
  validateTwitchAccessToken,
  type TwitchDeviceAuthorization,
  type TwitchAuthSession
} from './twitch-auth'

import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { basename, join } from 'path'
import { readFile, readlink } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { Message, MessageBus } from 'dbus-next'
import {
  checkGnomeSetup,
  ensureGnomeExtensionEnabled,
  resolveRepoExtensionPath,
  type GnomeCheckResult
} from './gnome-setup'
import tmi from 'tmi.js'
import * as dbus from 'dbus-next'
import type { AppPreferences, TwitchAuthStatus, TwitchChatClient } from '../shared/types'

class StreamShellInterface extends dbus.interface.Interface {
  constructor(name: string) {
    super(name)
  }

  MessageReceived(user: string, color: string, text: string): [string, string, string] {
    return [user, color, text]
  }
  HistoryMessageReceived(user: string, color: string, text: string): [string, string, string] {
    return [user, color, text]
  }
  ChatCleared(): [] {
    return []
  }
  OverlaySettingsChanged(settings: string): string {
    return settings
  }
  GetOverlaySettings(): string {
    return overlaySettingsJson()
  }
  GetUserProfile(login: string): Promise<string> {
    return loadUserProfile(login)
  }
}

function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/i.test(value)
}

async function isGnomeShellSender(bus: MessageBus, sender: string): Promise<boolean> {
  if (process.platform !== 'linux' || !sender.startsWith(':')) return false
  const response = await bus.call(
    new dbus.Message({
      destination: 'org.freedesktop.DBus',
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus',
      member: 'GetConnectionUnixProcessID',
      signature: 's',
      body: [sender]
    })
  )
  const pid = response?.body[0]
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    const [executable, status] = await Promise.all([
      readlink(`/proc/${pid}/exe`),
      readFile(`/proc/${pid}/status`, 'utf8')
    ])
    const uid = status.match(/^Uid:\s+(\d+)/m)?.[1]
    return basename(executable) === 'gnome-shell' && uid === String(process.getuid?.())
  } catch (error) {
    console.warn('[StreamShell Backend] Could not verify D-Bus caller process:', error)
    return false
  }
}

function installChatMethodHandler(bus: MessageBus): void {
  bus.addMethodHandler((message: Message): boolean => {
    if (
      message.path !== '/org/streamshell/Twitch/Chat' ||
      message.interface !== 'org.streamshell.Twitch.Chat' ||
      message.member !== 'SendChatMessage'
    ) {
      return false
    }

    void (async () => {
      try {
        if (message.signature !== 'ss' || message.body.length !== 2) {
          throw new dbus.DBusError(
            'org.streamshell.Twitch.Error.InvalidArguments',
            'SendChatMessage expects a request ID and message text.'
          )
        }
        if (!(await isGnomeShellSender(bus, message.sender))) {
          console.warn(
            `[StreamShell Backend] Rejected SendChatMessage from untrusted D-Bus sender ${message.sender}.`
          )
          throw new dbus.DBusError(
            'org.streamshell.Twitch.Error.Unauthorized',
            'Only the GNOME Shell overlay can send chat messages.'
          )
        }
        const [requestId, text] = message.body
        if (!isValidRequestId(requestId) || typeof text !== 'string') {
          throw new dbus.DBusError(
            'org.streamshell.Twitch.Error.InvalidArguments',
            'SendChatMessage received invalid arguments.'
          )
        }
        const result = await sendTwitchChatMessage(requestId, text)
        bus.send(dbus.Message.newMethodReturn(message, 's', [result]))
      } catch (error) {
        if (error instanceof dbus.DBusError) {
          sendDbusError(bus, message, error.type, error.text)
          return
        }
        console.error('[StreamShell Backend] SendChatMessage D-Bus handler failed:', error)
        sendDbusError(
          bus,
          message,
          'org.streamshell.Twitch.Error.Internal',
          'The backend could not process the chat message.'
        )
      }
    })()
    return true
  })
}

function sendDbusError(
  bus: MessageBus,
  request: Message,
  errorName: string,
  errorText: string
): void {
  bus.send(
    new dbus.Message({
      type: dbus.MessageType.ERROR,
      errorName,
      replySerial: String(request.serial ?? ''),
      destination: request.sender,
      signature: 's',
      body: [errorText]
    })
  )
}

function overlaySettingsJson(): string {
  return JSON.stringify({
    chatWidth: preferences.chatWidth,
    backgroundOpacity: preferences.backgroundOpacity,
    maxVisibleMessages: preferences.maxVisibleMessages,
    historyEnabled: preferences.historyEnabled,
    historyLimit: preferences.historyLimit,
    disableClickThrough: preferences.disableClickThrough,
    interactiveChatEnabled: preferences.interactiveChatEnabled,
    clickableProfilesEnabled: preferences.clickableProfilesEnabled,
    profileMessageLimit: preferences.profileMessageLimit,
    toggleChatShortcut: preferences.toggleChatShortcut,
    animatedEmotesEnabled: preferences.animatedEmotesEnabled
  })
}

StreamShellInterface.configureMembers({
  signals: {
    MessageReceived: { signature: 'sss' },
    HistoryMessageReceived: { signature: 'sss' },
    ChatCleared: { signature: '' },
    OverlaySettingsChanged: { signature: 's' }
  },
  methods: {
    GetOverlaySettings: { inSignature: '', outSignature: 's' },
    GetUserProfile: { inSignature: 's', outSignature: 's' }
  }
})

let chatInterface: StreamShellInterface | null = null
let twitchClient: TwitchChatClient | null = null
let mainWindow: BrowserWindow | null = null
let joinTimeout: NodeJS.Timeout | null = null
let broadcasterId: string | null = null
let thirdPartyBroadcasterId: string | null = null
let joinedChannel: string | null = null
let firstChatMessageLogged = false
let messageChain: Promise<void> = Promise.resolve()
const pendingChatEchoes = new Map<string, { requestId: string; timeout: NodeJS.Timeout }[]>()
let thirdPartyEmotesReady: Promise<void> = Promise.resolve()
const MESSAGE_ASSET_TIMEOUT_MS = 2500
let pendingGnomeStatus: GnomeCheckResult | null = null
let preferences: AppPreferences = { ...DEFAULT_PREFERENCES }
let activeChannel: string | null = null
let authSession: TwitchAuthSession | null = null
let authError: string | null = null
let authAvatarUrl: string | null = null
let authPromise: Promise<TwitchAuthSession> | null = null
let authValidationTimer: NodeJS.Timeout | null = null
let authAbortController: AbortController | null = null
let authDeviceAuthorization: TwitchDeviceAuthorization | null = null
let preferenceRevision = 0
const chatHistory: {
  user: string
  login: string
  userId: string
  color: string
  text: string
  sequence: number
  badges: string[]
  emotes: Record<string, string[]> | null
  reply: ChatReply | null
}[] = []
let chatMessageSequence = 0
const MAX_STORED_HISTORY = 500

const REPO_EXTENSION_PATH = resolveRepoExtensionPath()
const hasSingleInstanceLock = app.requestSingleInstanceLock()

setTwitchUserAccessTokenProvider(() => authSession?.accessToken ?? null)

if (!hasSingleInstanceLock) {
  console.warn('[StreamShell Backend] Another StreamShell instance is already running.')
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

async function initDBus(): Promise<void> {
  try {
    const bus = dbus.sessionBus()
    const result = await bus.requestName('org.streamshell.Twitch', dbus.NameFlag.DO_NOT_QUEUE)
    if (
      result !== dbus.RequestNameReply.PRIMARY_OWNER &&
      result !== dbus.RequestNameReply.ALREADY_OWNER
    ) {
      throw new Error(`Could not acquire D-Bus service name (request result ${result}).`)
    }
    installChatMethodHandler(bus)
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

function twitchAuthStatus(): TwitchAuthStatus {
  return {
    authenticated: authSession !== null,
    canSendChat: authSession?.scopes.includes('chat:edit') ?? false,
    username: authSession?.login ?? null,
    avatarUrl: authAvatarUrl,
    deviceAuthorization: authDeviceAuthorization,
    error: authError
  }
}

function loadSignedInAvatar(session: TwitchAuthSession): void {
  authAvatarUrl = null
  void getAuthenticatedTwitchUserAvatar(session.accessToken).then((avatarUrl) => {
    if (authSession?.accessToken !== session.accessToken) return
    authAvatarUrl = avatarUrl
    publishTwitchAuthStatus()
  })
}

function publishTwitchAuthStatus(): TwitchAuthStatus {
  const status = twitchAuthStatus()
  sendToRenderer('twitch:auth-status', status)
  return status
}

function scheduleTwitchTokenValidation(): void {
  if (authValidationTimer) clearTimeout(authValidationTimer)
  if (!authSession) return
  const refreshIn = authSession.expiresAt - Date.now() - 5 * 60 * 1000
  authValidationTimer = setTimeout(
    () => {
      authValidationTimer = null
      void validateActiveTwitchSession()
    },
    Math.max(60 * 1000, Math.min(60 * 60 * 1000, refreshIn))
  )
}

async function validateActiveTwitchSession(): Promise<void> {
  if (!authSession) return
  try {
    let current = authSession
    if (current.expiresAt <= Date.now() + 5 * 60 * 1000 && current.refreshToken) {
      const refreshed = await refreshTwitchSession(current)
      await saveTwitchSession(refreshed)
      current = refreshed
      authSession = refreshed
    }
    const validated = await validateTwitchAccessToken(
      current.accessToken,
      preferences.interactiveChatEnabled
    )
    const nextSession = { ...current, ...validated }
    await saveTwitchSession(nextSession)
    authSession = nextSession
    loadSignedInAvatar(nextSession)
    authError = null
    publishTwitchAuthStatus()
  } catch (error) {
    if (error instanceof TwitchAuthError && !error.invalidToken) {
      authError = error.message
      publishTwitchAuthStatus()
      scheduleTwitchTokenValidation()
      return
    }
    console.warn('[StreamShell Backend] Twitch session expired or was revoked.')
    const channelToReconnect = activeChannel
    authSession = null
    authAvatarUrl = null
    await clearStoredTwitchSession()
    teardownTwitchClient()
    if (preferences.interactiveChatEnabled) {
      preferences = { ...preferences, interactiveChatEnabled: false }
      await savePreferences(preferences)
    }
    authError = 'Your Twitch session expired. Sign in again to continue.'
    publishTwitchAuthStatus()
    notifyOverlayClear()
    if (channelToReconnect) connectToTwitch(channelToReconnect)
    return
  }
  scheduleTwitchTokenValidation()
}

async function startTwitchLogin(): Promise<TwitchAuthSession> {
  if (authPromise) return authPromise

  const controller = new AbortController()
  authAbortController = controller
  authDeviceAuthorization = null
  const pending = (async (): Promise<TwitchAuthSession> => {
    const deviceAuthorization = await requestTwitchDeviceAuthorization(true, controller.signal)
    authDeviceAuthorization = {
      userCode: deviceAuthorization.userCode,
      verificationUri: deviceAuthorization.verificationUri
    }
    authError = null
    publishTwitchAuthStatus()
    const tokens = await pollTwitchDeviceAuthorization(
      deviceAuthorization.deviceCode,
      deviceAuthorization.scopes,
      deviceAuthorization.interval,
      deviceAuthorization.expiresAt,
      controller.signal
    )
    const validated = await validateTwitchAccessToken(tokens.accessToken, true)
    const session: TwitchAuthSession = {
      ...validated,
      refreshToken: tokens.refreshToken
    }
    await saveTwitchSession(session)
    return session
  })()

  authPromise = pending
    .then((session) => {
      authSession = session
      loadSignedInAvatar(session)
      authError = null
      authDeviceAuthorization = null
      scheduleTwitchTokenValidation()
      publishTwitchAuthStatus()
      if (activeChannel) {
        console.log(
          `[StreamShell Backend] Reconnecting ${activeChannel} with the signed-in Twitch account.`
        )
        connectToTwitch(activeChannel, true)
      }
      return session
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      authError = /cancelled/i.test(message) ? null : message
      authDeviceAuthorization = null
      publishTwitchAuthStatus()
      throw error
    })
    .finally(() => {
      authPromise = null
      authAbortController = null
    })
  return authPromise
}

function cancelTwitchLogin(): void {
  authAbortController?.abort()
  authAbortController = null
  authDeviceAuthorization = null
  authError = null
  publishTwitchAuthStatus()
}

async function initializeTwitchAuth(): Promise<void> {
  try {
    const saved = await loadStoredTwitchSession()
    if (saved) {
      let current = saved
      try {
        if (current.expiresAt <= Date.now() + 5 * 60 * 1000 && current.refreshToken) {
          current = await refreshTwitchSession(current)
          await saveTwitchSession(current)
        }
        if (current.expiresAt <= Date.now()) {
          throw new TwitchAuthError('The Twitch session expired.', true)
        }
        const validated = await validateTwitchAccessToken(
          current.accessToken,
          preferences.interactiveChatEnabled
        )
        const session = { ...current, ...validated }
        await saveTwitchSession(session)
        authSession = session
        loadSignedInAvatar(session)
        authError = null
        scheduleTwitchTokenValidation()
        publishTwitchAuthStatus()
        return
      } catch (error) {
        if (error instanceof TwitchAuthError && !error.invalidToken) {
          if (current.expiresAt > Date.now()) {
            authSession = current
            loadSignedInAvatar(current)
            scheduleTwitchTokenValidation()
          } else if (current.refreshToken) {
            authSession = null
            if (authValidationTimer) clearTimeout(authValidationTimer)
            authValidationTimer = setTimeout(() => {
              authValidationTimer = null
              void initializeTwitchAuth()
            }, 60 * 1000)
          }
          authError = error.message
          publishTwitchAuthStatus()
          if (current.expiresAt > Date.now() || current.refreshToken) return
        }
        console.warn('[StreamShell Backend] Saved Twitch session is no longer valid.')
      }
      await clearStoredTwitchSession()
      authSession = null
      authAvatarUrl = null
      if (preferences.interactiveChatEnabled) {
        preferences = { ...preferences, interactiveChatEnabled: false }
        await savePreferences(preferences)
      }
    } else if (preferences.interactiveChatEnabled) {
      preferences = { ...preferences, interactiveChatEnabled: false }
      await savePreferences(preferences)
    }
  } catch (error) {
    authError = error instanceof Error ? error.message : String(error)
    console.error('[StreamShell Backend] Could not load saved Twitch credentials:', error)
  }

  publishTwitchAuthStatus()
}

function getStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') return null
    result[key] = item
  }
  return result
}

async function sendTwitchChatMessage(requestId: string, rawText: string): Promise<string> {
  const text = rawText.trim()
  console.log(
    `[StreamShell Backend] [chat:${requestId}] SendChatMessage received (length=${text.length}).`
  )
  if (!preferences.interactiveChatEnabled) {
    console.warn(
      `[StreamShell Backend] [chat:${requestId}] Rejected: interactive chat is disabled.`
    )
    throw new dbus.DBusError(
      'org.streamshell.Twitch.Error.Disabled',
      'Interactive chat is disabled.'
    )
  }
  if (!authSession || !twitchClient || !activeChannel) {
    console.warn(
      `[StreamShell Backend] [chat:${requestId}] Rejected: missing auth, IRC client, or active channel.`
    )
    throw new dbus.DBusError(
      'org.streamshell.Twitch.Error.NotConnected',
      'Connect to Twitch before sending a message.'
    )
  }
  if (!authSession.scopes.includes('chat:edit')) {
    console.warn(
      `[StreamShell Backend] [chat:${requestId}] Rejected: account lacks chat:edit scope.`
    )
    throw new dbus.DBusError(
      'org.streamshell.Twitch.Error.PermissionDenied',
      'Sign in again to grant chat:edit.'
    )
  }
  if (!text || text.length > 500 || /[\r\n]/.test(text)) {
    console.warn(
      `[StreamShell Backend] [chat:${requestId}] Rejected: invalid message length or line breaks.`
    )
    throw new dbus.DBusError(
      'org.streamshell.Twitch.Error.InvalidMessage',
      'Message must contain 1 to 500 characters on one line.'
    )
  }
  const client = twitchClient
  const channel = activeChannel
  const account = authSession.login
  if (joinedChannel !== channel) {
    console.warn(
      `[StreamShell Backend] [chat:${requestId}] Rejected: IRC has not joined ${channel} yet.`
    )
    throw new dbus.DBusError(
      'org.streamshell.Twitch.Error.NotConnected',
      'The Twitch chat connection is still joining the channel. Try again in a moment.'
    )
  }
  const connectedUsername = client.getUsername()
  if (
    typeof connectedUsername !== 'string' ||
    connectedUsername.toLowerCase() !== account.toLowerCase()
  ) {
    console.error(
      `[StreamShell Backend] [chat:${requestId}] Refusing to send: IRC identity does not match the signed-in account.`,
      { connectedUsername, account, channel }
    )
    throw new dbus.DBusError(
      'org.streamshell.Twitch.Error.NotAuthenticated',
      'The Twitch chat connection is not authenticated as the signed-in account. Reconnect to the channel and try again.'
    )
  }
  console.log(
    `[StreamShell Backend] [chat:${requestId}] Calling tmi.js say() as ${account} in ${channel}.`
  )
  const echoKey = chatEchoKey(channel, text)
  const timeout = setTimeout(() => {
    const pending = pendingChatEchoes.get(echoKey)
    if (!pending) return
    const index = pending.findIndex((entry) => entry.requestId === requestId)
    if (index === -1) return
    pending.splice(index, 1)
    if (pending.length === 0) pendingChatEchoes.delete(echoKey)
    console.warn(
      `[StreamShell Backend] [chat:${requestId}] No Twitch self-echo observed within 15 seconds; tmi.js acceptance does not confirm channel delivery.`
    )
  }, 15_000)
  const pending = pendingChatEchoes.get(echoKey) ?? []
  pending.push({ requestId, timeout })
  pendingChatEchoes.set(echoKey, pending)
  try {
    await client.say(channel, text)
    console.log(
      `[StreamShell Backend] [chat:${requestId}] tmi.js say() resolved; waiting for Twitch self-echo.`
    )
    return 'sent'
  } catch (error) {
    clearTimeout(timeout)
    const remaining =
      pendingChatEchoes.get(echoKey)?.filter((entry) => entry.requestId !== requestId) ?? []
    if (remaining.length > 0) pendingChatEchoes.set(echoKey, remaining)
    else pendingChatEchoes.delete(echoKey)
    console.error(
      `[StreamShell Backend] [chat:${requestId}] tmi.js say() failed for ${channel}:`,
      error
    )
    throw new dbus.DBusError(
      'org.streamshell.Twitch.Error.SendFailed',
      error instanceof Error ? error.message : String(error)
    )
  }
}

async function loadUserProfile(rawLogin: string): Promise<string> {
  if (!preferences.clickableProfilesEnabled) {
    throw new dbus.DBusError(
      'org.streamshell.Twitch.Error.Disabled',
      'Clickable profiles are disabled.'
    )
  }
  const login = rawLogin.trim().toLowerCase()
  if (!/^[a-z0-9_]{1,25}$/.test(login)) {
    throw new dbus.DBusError('org.streamshell.Twitch.Error.InvalidUser', 'Invalid Twitch username.')
  }

  const profile = await getTwitchUserProfile(login)
  const messages = chatHistory
    .filter((message) =>
      profile?.id && message.userId
        ? message.userId === profile.id
        : message.login.toLowerCase() === login
    )
    .slice(-preferences.profileMessageLimit)
    .map(({ sequence, text }) => ({ sequence, text }))
  const lastSequence = chatMessageSequence
  const avatarPath = profile?.avatar ? await cacheImage(profile.avatar) : null
  return JSON.stringify({
    login,
    displayName: profile?.displayName ?? login,
    description: profile?.description ?? '',
    avatarPath,
    messages,
    lastSequence
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function getEmotePositions(value: unknown): Record<string, string[]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result: Record<string, string[]> = {}
  for (const [id, positions] of Object.entries(value)) {
    if (!isStringArray(positions)) return null
    result[id] = [...positions]
  }
  return result
}

function getChatReply(tags: Record<string, unknown>): ChatReply | null {
  const replyUserLogin =
    typeof tags['reply-parent-user-login'] === 'string' ? tags['reply-parent-user-login'] : ''
  const replyDisplayName =
    typeof tags['reply-parent-display-name'] === 'string' ? tags['reply-parent-display-name'] : ''
  const replyMessage =
    typeof tags['reply-parent-msg-body'] === 'string' ? tags['reply-parent-msg-body'] : ''
  const hasReplyTags =
    typeof tags['reply-parent-msg-id'] === 'string' ||
    replyUserLogin.length > 0 ||
    replyDisplayName.length > 0 ||
    replyMessage.length > 0
  if (!hasReplyTags) return null

  const user = replyUserLogin || replyDisplayName
  return user ? { user, message: replyMessage } : null
}

function notifyOverlayClear(): void {
  if (chatInterface) chatInterface.ChatCleared()
  messageChain = messageChain.then(() => {
    if (chatInterface) chatInterface.ChatCleared()
  })
}

async function publishPreferences(): Promise<void> {
  const revision = ++preferenceRevision
  const queued = messageChain.then(async () => {
    if (revision !== preferenceRevision) return
    const shouldReplayHistory = preferences.historyEnabled && activeChannel !== null
    const history = shouldReplayHistory ? chatHistory.slice(-preferences.historyLimit) : []
    const replay: { user: string; color: string; payload: string }[] = []
    await thirdPartyEmotesReady
    for (const message of history) {
      if (revision !== preferenceRevision) return
      const segments = await buildSegments(message.text, message.emotes, {
        animated: preferences.animatedEmotesEnabled,
        timeoutMs: MESSAGE_ASSET_TIMEOUT_MS
      })
      const displaySegments = message.reply
        ? stripReplyMention(segments, message.reply.user)
        : segments
      replay.push({
        user: message.user,
        color: message.color,
        payload: JSON.stringify({
          badges: message.badges,
          segments: displaySegments,
          login: message.login,
          text: message.text,
          sequence: message.sequence,
          reply: message.reply
        })
      })
    }

    if (revision !== preferenceRevision || !chatInterface) return
    chatInterface.OverlaySettingsChanged(overlaySettingsJson())
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

function chatEchoKey(channel: string, text: string): string {
  return JSON.stringify([channel.replace(/^#/, '').toLowerCase(), text])
}

function roomIdFromTags(tags: Record<string, unknown>): string | null {
  const roomId = tags['room-id']
  return typeof roomId === 'string' && /^\d{1,32}$/.test(roomId) ? roomId : null
}

function loadEmotesForRoom(channel: string, roomId: string): void {
  if (!preferences.thirdPartyEmotesEnabled || thirdPartyBroadcasterId === roomId) return
  thirdPartyBroadcasterId = roomId
  thirdPartyEmotesReady = loadThirdPartyEmotes(channel, roomId, {
    imageScale: preferences.emoteImageScale,
    bestQuality: preferences.emoteBestQuality
  }).catch((error) => {
    console.error('[StreamShell Backend] Failed to load third-party emotes:', error)
  })
}

async function resolveMessageAssets(
  badgesTag: Record<string, string> | null,
  text: string,
  emotes: Record<string, string[]> | null,
  roomId: string | null
): Promise<{ badges: string[]; segments: Segment[] }> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      Promise.all([
        resolveBadges(badgesTag, roomId ?? broadcasterId),
        buildSegments(text, emotes, {
          animated: preferences.animatedEmotesEnabled,
          timeoutMs: MESSAGE_ASSET_TIMEOUT_MS
        }),
        thirdPartyEmotesReady
      ]).then(([badges, segments]) => ({ badges, segments })),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Message assets exceeded ${MESSAGE_ASSET_TIMEOUT_MS}ms`)),
          MESSAGE_ASSET_TIMEOUT_MS
        )
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function teardownTwitchClient(): void {
  clearJoinTimeout()
  for (const pending of pendingChatEchoes.values()) {
    for (const echo of pending) clearTimeout(echo.timeout)
  }
  pendingChatEchoes.clear()
  activeChannel = null
  broadcasterId = null
  thirdPartyBroadcasterId = null
  joinedChannel = null
  thirdPartyEmotesReady = Promise.resolve()
  clearThirdPartyEmotes()
  if (twitchClient) {
    twitchClient.disconnect().catch(console.error)
    twitchClient = null
  }
}

function connectToTwitch(channel: string, preserveChat = false): void {
  teardownTwitchClient()
  activeChannel = channel
  firstChatMessageLogged = false

  if (!preserveChat) {
    chatHistory.length = 0
    notifyOverlayClear()
  }

  const client = new tmi.Client({
    ...(authSession
      ? {
          identity: {
            username: authSession.login,
            password: `oauth:${authSession.accessToken}`
          }
        }
      : {}),
    channels: [channel]
  })
  twitchClient = client

  client.on('connected', (addr: string, port: number) => {
    console.log(`[StreamShell Backend] WebSocket connected to ${addr}:${port}; waiting for JOIN...`)
    clearJoinTimeout()
    joinTimeout = setTimeout(() => {
      console.warn('[StreamShell Backend] JOIN timeout')
      sendToRenderer('twitch:error', {
        key: 'twitch.error.joinTimeout',
        params: { channel }
      })
      teardownTwitchClient()
    }, 8000)
  })

  client.on('join', (_ch: string, _user: string, self: boolean) => {
    if (!self || twitchClient !== client || activeChannel !== channel) return
    clearJoinTimeout()
    joinedChannel = channel
    console.log(`[StreamShell Backend] JOIN confirmed for: ${channel} as ${client.getUsername()}.`)
    sendToRenderer('twitch:connected', { channel })
    broadcasterId = null
    thirdPartyBroadcasterId = null
    thirdPartyEmotesReady = Promise.resolve()
    void preloadBadges(null).catch((error) => {
      console.warn('[StreamShell Backend] Failed to preload global chat badges:', error)
    })
  })

  client.on('notice', (_ch: string, msgid: string, message: string) => {
    if (twitchClient !== client) return
    console.warn(`[StreamShell Backend] notice ${msgid}: ${message}`)
  })

  client.on('disconnected', (reason: string) => {
    if (twitchClient !== client) return
    clearJoinTimeout()
    activeChannel = null
    broadcasterId = null
    thirdPartyBroadcasterId = null
    joinedChannel = null
    thirdPartyEmotesReady = Promise.resolve()
    clearThirdPartyEmotes()
    notifyOverlayClear()
    console.log(`[StreamShell Backend] Disconnected: ${reason}`)
    sendToRenderer('twitch:disconnected', { reason })
  })

  client.on(
    'message',
    (_channel: string, tags: Record<string, unknown>, message: string, self: boolean) => {
      if (twitchClient !== client) return
      if (self && !preferences.interactiveChatEnabled) return
      if (self) {
        const echoedText = String(message).trim()
        const echoKey = chatEchoKey(_channel, echoedText)
        const pending = pendingChatEchoes.get(echoKey)
        const matched = pending?.shift()
        if (pending && matched) {
          clearTimeout(matched.timeout)
          if (pending.length === 0) pendingChatEchoes.delete(echoKey)
          console.log(
            `[StreamShell Backend] [chat:${matched.requestId}] Twitch self-echo received in ${_channel} (length=${echoedText.length}).`
          )
        } else {
          console.log(
            `[StreamShell Backend] Unmatched Twitch self-echo received in ${_channel} (length=${echoedText.length}).`
          )
        }
      }
      if (!firstChatMessageLogged) {
        firstChatMessageLogged = true
        console.log(`[StreamShell Backend] First chat message received in ${channel}.`)
      }
      const user = String(tags['display-name'] || tags.username || 'unknown')
      const login = String(tags.username || user).toLowerCase()
      const userId = String(tags['user-id'] || '')
      const roomId = roomIdFromTags(tags)
      if (roomId) {
        broadcasterId = roomId
        loadEmotesForRoom(channel, roomId)
      }
      const color = String(tags.color || '#8A2BE2')
      const text = String(message)
      const reply = getChatReply(tags)
      const badgesTag = getStringRecord(tags.badges)
      const emotes = getEmotePositions(tags.emotes)

      messageChain = messageChain
        .then(async () => {
          let badges: string[] = []
          let segments: Segment[] = [{ t: 'text', v: text }]
          try {
            ;({ badges, segments } = await resolveMessageAssets(badgesTag, text, emotes, roomId))
            if (reply) segments = stripReplyMention(segments, reply.user)
          } catch (err) {
            console.warn(
              `[StreamShell Backend] Message assets unavailable; showing text only after ${MESSAGE_ASSET_TIMEOUT_MS}ms:`,
              err
            )
            badges = []
            segments = [{ t: 'text', v: text }]
            if (reply) segments = stripReplyMention(segments, reply.user)
          }
          const sequence = ++chatMessageSequence
          if (activeChannel) {
            chatHistory.push({
              user,
              login,
              userId,
              color,
              text,
              sequence,
              badges,
              emotes,
              reply
            })
            if (chatHistory.length > MAX_STORED_HISTORY) chatHistory.shift()
          }
          if (chatInterface) {
            chatInterface.MessageReceived(
              user,
              color,
              JSON.stringify({ badges, segments, login, text, sequence, reply })
            )
          }
        })
        .catch((err) => console.error('[StreamShell Backend] message pipeline failed:', err))
    }
  )

  client.connect().catch((err: Error) => {
    clearJoinTimeout()
    console.error('[StreamShell Backend] Twitch connection failed:', err)
    sendToRenderer('twitch:error', {
      key: 'twitch.error.connectionFailed',
      params: { reason: err?.message ?? String(err) }
    })
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
    try {
      const url = new URL(details.url)
      const isTrustedTwitchUrl =
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        (url.hostname === 'twitch.tv' || url.hostname.endsWith('.twitch.tv'))
      if (!isTrustedTwitchUrl) {
        console.warn('[StreamShell Backend] Blocked an untrusted external URL:', url.origin)
        return { action: 'deny' }
      }
      void shell.openExternal(url.toString()).catch((error) => {
        console.error('[StreamShell Backend] Could not open Twitch URL:', error)
      })
    } catch (error) {
      console.warn('[StreamShell Backend] Blocked an invalid external URL:', error)
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  electronApp.setAppUserModelId('com.electron')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  preferences = await loadPreferences()
  setMaxConcurrentImageDownloads(preferences.maxConcurrentImageDownloads)

  ipcMain.on('set-twitch-channel', (_event, value: unknown) => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{1,25}$/.test(value.trim())) {
      console.warn('[StreamShell Backend] Rejected an invalid Twitch channel name.')
      sendToRenderer('twitch:error', {
        key: 'twitch.error.connectionFailed',
        params: { reason: 'Invalid Twitch channel name.' }
      })
      return
    }
    connectToTwitch(value.trim().toLowerCase())
  })

  ipcMain.on('disconnect-twitch', () => {
    console.log('[StreamShell Backend] Disconnected by user')
    teardownTwitchClient()
    notifyOverlayClear()
  })

  ipcMain.handle('preferences:get', async () => {
    await publishPreferences()
    return preferences
  })

  ipcMain.handle('auth:get-status', () => twitchAuthStatus())
  ipcMain.handle('auth:login', async () => {
    await startTwitchLogin()
    return twitchAuthStatus()
  })
  ipcMain.handle('auth:cancel-login', () => {
    cancelTwitchLogin()
  })
  ipcMain.handle('auth:logout', async () => {
    cancelTwitchLogin()
    const channelToReconnect = activeChannel
    teardownTwitchClient()
    if (authValidationTimer) clearTimeout(authValidationTimer)
    authValidationTimer = null
    const token = authSession?.accessToken
    const refreshToken = authSession?.refreshToken
    authSession = null
    authAvatarUrl = null
    authError = null
    let revokeError: string | null = null
    if (token) {
      try {
        await revokeTwitchAccessToken(token)
      } catch (error) {
        revokeError = error instanceof Error ? error.message : String(error)
        console.warn('[StreamShell Backend] Could not revoke Twitch token on sign-out:', error)
      }
    }
    if (refreshToken) {
      try {
        await revokeTwitchAccessToken(refreshToken)
      } catch (error) {
        revokeError ??= error instanceof Error ? error.message : String(error)
        console.warn(
          '[StreamShell Backend] Could not revoke Twitch refresh token on sign-out:',
          error
        )
      }
    }
    await clearStoredTwitchSession()
    if (preferences.interactiveChatEnabled) {
      preferences = { ...preferences, interactiveChatEnabled: false }
      await savePreferences(preferences)
    }
    authError = revokeError
    publishTwitchAuthStatus()
    notifyOverlayClear()
    if (channelToReconnect) connectToTwitch(channelToReconnect)
    return twitchAuthStatus()
  })

  ipcMain.handle('preferences:set', async (_event, value: unknown) => {
    const next = validatePreferences(value)
    if (
      next.interactiveChatEnabled &&
      !preferences.interactiveChatEnabled &&
      !authSession?.scopes.includes('chat:edit')
    ) {
      throw new Error('Sign in again and grant chat:edit before enabling interactive chat.')
    }
    await savePreferences(next)
    if (next.maxConcurrentImageDownloads !== preferences.maxConcurrentImageDownloads) {
      setMaxConcurrentImageDownloads(next.maxConcurrentImageDownloads)
    }
    const thirdPartyEmotesChanged =
      next.thirdPartyEmotesEnabled !== preferences.thirdPartyEmotesEnabled
    const emoteQualityChanged =
      next.emoteImageScale !== preferences.emoteImageScale ||
      next.emoteBestQuality !== preferences.emoteBestQuality
    preferences = next
    if (!preferences.thirdPartyEmotesEnabled) {
      clearThirdPartyEmotes()
      thirdPartyBroadcasterId = null
      thirdPartyEmotesReady = Promise.resolve()
    } else if ((thirdPartyEmotesChanged || emoteQualityChanged) && activeChannel && broadcasterId) {
      thirdPartyBroadcasterId = broadcasterId
      thirdPartyEmotesReady = loadThirdPartyEmotes(activeChannel, broadcasterId, {
        imageScale: preferences.emoteImageScale,
        bestQuality: preferences.emoteBestQuality
      }).catch((error) => {
        console.error('[StreamShell Backend] Failed to reload emotes with updated quality:', error)
      })
    }
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
    if (typeof channel !== 'string' || !/^[a-zA-Z0-9_]{1,25}$/.test(channel.trim())) {
      throw new Error('Invalid Twitch channel name for avatar lookup.')
    }
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
  void initializeTwitchAuth()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
