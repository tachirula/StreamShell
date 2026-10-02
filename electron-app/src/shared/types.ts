export type EmoteImageScale = '1x' | '3x' | '4x'

export interface AppPreferences {
  chatWidth: number
  backgroundOpacity: number
  maxVisibleMessages: number
  historyEnabled: boolean
  historyLimit: number
  disableClickThrough: boolean
  interactiveChatEnabled: boolean
  clickableProfilesEnabled: boolean
  profileMessageLimit: number
  thirdPartyEmotesEnabled: boolean
  toggleChatShortcut: string
  emoteImageScale: EmoteImageScale
  emoteBestQuality: boolean
  maxConcurrentImageDownloads: number
  animatedEmotesEnabled: boolean
}

export interface TwitchDeviceAuthorization {
  userCode: string
  verificationUri: string
}

export interface TwitchAuthStatus {
  authenticated: boolean
  canSendChat: boolean
  username: string | null
  avatarUrl: string | null
  deviceAuthorization: TwitchDeviceAuthorization | null
  error: string | null
}

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

export interface TwitchErrorPayload {
  key: string
  params?: Record<string, string>
}

export interface TwitchDisconnectedPayload {
  reason: string
}

export interface TwitchConnectedPayload {
  channel: string
}

export interface TwitchChatClient {
  connect(): Promise<[string, number]>
  disconnect(): Promise<void>
  getUsername(): string | null
  say(channel: string, message: string): Promise<unknown>
  on(event: 'connected', listener: (address: string, port: number) => void): this
  on(event: 'join', listener: (channel: string, username: string, self: boolean) => void): this
  on(event: 'notice', listener: (channel: string, messageId: string, message: string) => void): this
  on(event: 'disconnected', listener: (reason: string) => void): this
  on(
    event: 'message',
    listener: (
      channel: string,
      tags: Record<string, unknown>,
      message: string,
      self: boolean
    ) => void
  ): this
}
