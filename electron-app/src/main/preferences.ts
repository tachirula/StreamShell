import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'

export interface AppPreferences {
  chatWidth: number
  maxVisibleMessages: number
  historyEnabled: boolean
  historyLimit: number
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  chatWidth: 360,
  maxVisibleMessages: 10,
  historyEnabled: false,
  historyLimit: 20
}

const SETTINGS_FILE = 'preferences.json'

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
  return {
    chatWidth: candidate.chatWidth!,
    maxVisibleMessages: Math.min(candidate.maxVisibleMessages!, 20),
    historyEnabled: candidate.historyEnabled,
    historyLimit: candidate.historyLimit!
  }
}

export async function loadPreferences(): Promise<AppPreferences> {
  const file = join(app.getPath('userData'), SETTINGS_FILE)
  try {
    const raw = await readFile(file, 'utf8')
    try {
      return validatePreferences(JSON.parse(raw))
    } catch (err) {
      console.warn('[StreamShell Backend] Invalid preferences; using defaults:', err)
      return DEFAULT_PREFERENCES
    }
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
