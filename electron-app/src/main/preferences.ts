import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { MAX_CONCURRENT_IMAGE_DOWNLOADS } from '../shared/settings-constraints'

export interface AppPreferences {
  chatWidth: number
  maxVisibleMessages: number
  historyEnabled: boolean
  historyLimit: number
  thirdPartyEmotesEnabled: boolean
  toggleChatShortcut: string
  emoteImageScale: '1x' | '3x' | '4x'
  emoteBestQuality: boolean
  maxConcurrentImageDownloads: number
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  chatWidth: 360,
  maxVisibleMessages: 10,
  historyEnabled: false,
  historyLimit: 20,
  thirdPartyEmotesEnabled: true,
  toggleChatShortcut: '',
  emoteImageScale: '3x',
  emoteBestQuality: true,
  maxConcurrentImageDownloads: MAX_CONCURRENT_IMAGE_DOWNLOADS
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
  if (
    !Number.isInteger(candidate.maxVisibleMessages) ||
    candidate.maxVisibleMessages! < 3 ||
    candidate.maxVisibleMessages! > 100
  ) {
    throw new Error('Visible message limit must be between 3 and 100')
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
    maxVisibleMessages: Math.min(candidate.maxVisibleMessages!, 20),
    historyEnabled: candidate.historyEnabled,
    historyLimit: candidate.historyLimit!,
    thirdPartyEmotesEnabled,
    toggleChatShortcut,
    emoteImageScale,
    emoteBestQuality,
    maxConcurrentImageDownloads
  }
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
      return DEFAULT_PREFERENCES
    }
    let migrated = false
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const stored = parsed as Record<string, unknown>
      if (
        typeof stored.maxConcurrentImageDownloads === 'number' &&
        Number.isInteger(stored.maxConcurrentImageDownloads) &&
        stored.maxConcurrentImageDownloads > MAX_CONCURRENT_IMAGE_DOWNLOADS
      ) {
        parsed = {
          ...stored,
          maxConcurrentImageDownloads: MAX_CONCURRENT_IMAGE_DOWNLOADS
        }
        migrated = true
      }
    }
    let preferences: AppPreferences
    try {
      preferences = validatePreferences(parsed)
    } catch (err) {
      console.warn('[StreamShell Backend] Invalid preferences; using defaults:', err)
      return DEFAULT_PREFERENCES
    }
    if (migrated) {
      console.warn(
        `[StreamShell Backend] Capped saved image download concurrency at ${MAX_CONCURRENT_IMAGE_DOWNLOADS}.`
      )
      await savePreferences(preferences)
    }
    return preferences
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_PREFERENCES
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
