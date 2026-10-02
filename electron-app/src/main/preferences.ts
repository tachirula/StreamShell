import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  DEFAULT_CONCURRENT_IMAGE_DOWNLOADS,
  MAX_CONCURRENT_IMAGE_DOWNLOADS
} from '../shared/settings-constraints'
import type { AppPreferences } from '../shared/types'

export type { AppPreferences } from '../shared/types'

export const DEFAULT_PREFERENCES: AppPreferences = {
  chatWidth: 360,
  backgroundOpacity: 35,
  maxVisibleMessages: 10,
  historyEnabled: false,
  historyLimit: 20,
  disableClickThrough: false,
  interactiveChatEnabled: false,
  clickableProfilesEnabled: false,
  profileMessageLimit: 100,
  thirdPartyEmotesEnabled: true,
  toggleChatShortcut: '',
  emoteImageScale: '3x',
  emoteBestQuality: true,
  maxConcurrentImageDownloads: DEFAULT_CONCURRENT_IMAGE_DOWNLOADS,
  animatedEmotesEnabled: true
}

const SETTINGS_FILE = 'preferences.json'
const ACCELERATOR_PATTERN =
  /^(?:(?:<Control>|<Shift>|<Alt>|<Mod5>)+)(?:[a-z0-9]|F(?:[1-9]|1[0-2])|BackSpace|Caps_Lock|Delete|Down|End|Home|Insert|KP_(?:Add|Decimal|Divide|Enter|Multiply|Subtract)|Left|Page_Down|Page_Up|Print|Return|Right|Scroll_Lock|Tab|Up|apostrophe|backslash|bracketleft|bracketright|comma|equal|grave|minus|period|semicolon|slash|space)$/

export function validatePreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object') throw new Error('Preferences must be an object')
  const candidate = value as Partial<AppPreferences>
  if (
    !Number.isInteger(candidate.chatWidth) ||
    candidate.chatWidth! < 280 ||
    candidate.chatWidth! > 600
  ) {
    throw new Error('Chat width must be between 280 and 600 pixels')
  }
  const backgroundOpacity = candidate.backgroundOpacity ?? DEFAULT_PREFERENCES.backgroundOpacity
  if (!Number.isInteger(backgroundOpacity) || backgroundOpacity < 0 || backgroundOpacity > 100) {
    throw new Error('Background opacity must be between 0 and 100 percent')
  }
  if (
    !Number.isInteger(candidate.maxVisibleMessages) ||
    candidate.maxVisibleMessages! < 3 ||
    candidate.maxVisibleMessages! > 20
  ) {
    throw new Error('Visible message limit must be between 3 and 20')
  }
  if (typeof candidate.historyEnabled !== 'boolean') {
    throw new Error('History enabled must be a boolean')
  }
  if (
    !Number.isInteger(candidate.historyLimit) ||
    candidate.historyLimit! < 5 ||
    candidate.historyLimit! > 100
  ) {
    throw new Error('History limit must be between 5 and 100')
  }
  const interactiveChatEnabled =
    candidate.interactiveChatEnabled ?? DEFAULT_PREFERENCES.interactiveChatEnabled
  const disableClickThrough =
    candidate.disableClickThrough ?? DEFAULT_PREFERENCES.disableClickThrough
  const clickableProfilesEnabled =
    candidate.clickableProfilesEnabled ?? DEFAULT_PREFERENCES.clickableProfilesEnabled
  const profileMessageLimit =
    candidate.profileMessageLimit ?? DEFAULT_PREFERENCES.profileMessageLimit
  if (typeof interactiveChatEnabled !== 'boolean') {
    throw new Error('Interactive chat enabled must be a boolean')
  }
  if (typeof disableClickThrough !== 'boolean') {
    throw new Error('Disable click-through must be a boolean')
  }
  if (typeof clickableProfilesEnabled !== 'boolean') {
    throw new Error('Clickable profiles enabled must be a boolean')
  }
  if (
    !Number.isInteger(profileMessageLimit) ||
    profileMessageLimit < 1 ||
    profileMessageLimit > 500
  ) {
    throw new Error('Profile message limit must be between 1 and 500')
  }
  const thirdPartyEmotesEnabled =
    candidate.thirdPartyEmotesEnabled ?? DEFAULT_PREFERENCES.thirdPartyEmotesEnabled
  if (typeof thirdPartyEmotesEnabled !== 'boolean') {
    throw new Error('Third-party emotes enabled must be a boolean')
  }
  const toggleChatShortcut = candidate.toggleChatShortcut ?? DEFAULT_PREFERENCES.toggleChatShortcut
  if (typeof toggleChatShortcut !== 'string' || toggleChatShortcut.length > 128) {
    throw new Error('Chat visibility shortcut must be a valid accelerator')
  }
  if (toggleChatShortcut && !ACCELERATOR_PATTERN.test(toggleChatShortcut)) {
    throw new Error('Chat visibility shortcut must use a supported key and non-Super modifier')
  }
  const emoteImageScale = candidate.emoteImageScale ?? DEFAULT_PREFERENCES.emoteImageScale
  if (!['1x', '3x', '4x'].includes(emoteImageScale)) {
    throw new Error('Emote image scale must be 1x, 3x, or 4x')
  }
  const emoteBestQuality = candidate.emoteBestQuality ?? DEFAULT_PREFERENCES.emoteBestQuality
  if (typeof emoteBestQuality !== 'boolean') {
    throw new Error('Emote best quality must be a boolean')
  }
  const animatedEmotesEnabled =
    candidate.animatedEmotesEnabled ?? DEFAULT_PREFERENCES.animatedEmotesEnabled
  if (typeof animatedEmotesEnabled !== 'boolean') {
    throw new Error('Animated emotes enabled must be a boolean')
  }
  const maxConcurrentImageDownloads =
    candidate.maxConcurrentImageDownloads ?? DEFAULT_PREFERENCES.maxConcurrentImageDownloads
  if (
    !Number.isInteger(maxConcurrentImageDownloads) ||
    maxConcurrentImageDownloads < 1 ||
    maxConcurrentImageDownloads > MAX_CONCURRENT_IMAGE_DOWNLOADS
  ) {
    throw new Error(
      `Concurrent image downloads must be between 1 and ${MAX_CONCURRENT_IMAGE_DOWNLOADS}`
    )
  }
  return {
    chatWidth: candidate.chatWidth!,
    backgroundOpacity,
    maxVisibleMessages: Math.min(candidate.maxVisibleMessages!, 20),
    historyEnabled: candidate.historyEnabled,
    historyLimit: candidate.historyLimit!,
    disableClickThrough,
    interactiveChatEnabled: disableClickThrough && interactiveChatEnabled,
    clickableProfilesEnabled: disableClickThrough && clickableProfilesEnabled,
    profileMessageLimit,
    thirdPartyEmotesEnabled,
    toggleChatShortcut,
    emoteImageScale,
    emoteBestQuality,
    maxConcurrentImageDownloads,
    animatedEmotesEnabled
  }
}

function normalizeStoredPreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    console.warn('[StreamShell Backend] Saved preferences are not an object; using defaults.')
    return { ...DEFAULT_PREFERENCES }
  }

  const stored = value as Record<string, unknown>
  let normalized = { ...DEFAULT_PREFERENCES }
  for (const key of Object.keys(DEFAULT_PREFERENCES) as (keyof AppPreferences)[]) {
    if (!(key in stored)) continue
    try {
      normalized = validatePreferences({ ...normalized, [key]: stored[key] })
    } catch (error) {
      console.warn(
        `[StreamShell Backend] Invalid saved preference "${key}"; using its default:`,
        error
      )
    }
  }
  return normalized
}

export async function loadPreferences(): Promise<AppPreferences> {
  const file = join(app.getPath('userData'), SETTINGS_FILE)
  try {
    const raw = await readFile(file, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      console.warn('[StreamShell Backend] Invalid preferences; using defaults:', err)
      return { ...DEFAULT_PREFERENCES }
    }
    const preferences = normalizeStoredPreferences(parsed)
    if (JSON.stringify(parsed) !== JSON.stringify(preferences)) {
      await savePreferences(preferences)
    }
    return preferences
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_PREFERENCES }
    throw err
  }
}

export async function savePreferences(preferences: AppPreferences): Promise<void> {
  const directory = app.getPath('userData')
  const file = join(directory, SETTINGS_FILE)
  const temporary = `${file}.${process.pid}.tmp`
  await mkdir(directory, { recursive: true })
  await writeFile(temporary, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}
