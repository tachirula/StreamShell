import { net } from 'electron'
import { getUserInfo } from './twitch-api'

const channelEmotes = new Map<string, string[]>()
const REQUEST_TIMEOUT_MS = 15000
let loadRevision = 0
let activeLoadController: AbortController | null = null
let emoteRevision = 0

interface ThirdPartyEmote {
  code: string
  urls: string[]
}

export type EmoteImageScale = '1x' | '3x' | '4x'

export interface ThirdPartyEmoteOptions {
  imageScale: EmoteImageScale
  bestQuality: boolean
}

const DEFAULT_OPTIONS: ThirdPartyEmoteOptions = {
  imageScale: '3x',
  bestQuality: true
}

const IMAGE_SCALES = ['3x', '2x', '1x'] as const

function requestedScales(options: ThirdPartyEmoteOptions): string[] {
  return options.bestQuality
    ? [...IMAGE_SCALES]
    : [options.imageScale, ...IMAGE_SCALES.filter((scale) => scale !== options.imageScale)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const result = value[key]
  return typeof result === 'string' && result.length > 0 ? result : null
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await net.fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
  })
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }
  return response.json() as Promise<unknown>
}

async function loadBttv(
  userId: string,
  options: ThirdPartyEmoteOptions,
  signal: AbortSignal
): Promise<ThirdPartyEmote[]> {
  const data = await fetchJson(
    `https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(userId)}`,
    signal
  )
  if (!isRecord(data)) return []

  const result: ThirdPartyEmote[] = []
  for (const key of ['channelEmotes', 'sharedEmotes']) {
    const emotes = data[key]
    if (!Array.isArray(emotes)) continue
    for (const item of emotes) {
      if (!isRecord(item)) continue
      const code = stringField(item, 'code')
      const id = stringField(item, 'id')
      if (code && id) {
        const urls = requestedScales(options)
          .filter((scale) => scale !== '4x')
          .map((scale) => `https://cdn.betterttv.net/emote/${id}/${scale}`)
        result.push({ code, urls })
      }
    }
  }
  return result
}

function ffzImageUrl(value: string): string | null {
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    if (
      url.protocol !== 'https:' ||
      (url.hostname !== 'frankerfacez.com' && !url.hostname.endsWith('.frankerfacez.com'))
    ) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

async function loadFfz(
  userId: string,
  options: ThirdPartyEmoteOptions,
  signal: AbortSignal
): Promise<ThirdPartyEmote[]> {
  const data = await fetchJson(
    `https://api.frankerfacez.com/v1/room/id/${encodeURIComponent(userId)}`,
    signal
  )
  if (!isRecord(data) || !isRecord(data.sets)) return []

  const result: ThirdPartyEmote[] = []
  for (const set of Object.values(data.sets)) {
    if (!isRecord(set) || !Array.isArray(set.emoticons)) continue
    for (const item of set.emoticons) {
      if (!isRecord(item)) continue
      const code = stringField(item, 'name')
      const urls = item.urls
      if (!code || !isRecord(urls)) continue

      const images = requestedScales(options)
        .map((scale) => stringField(urls, scale.slice(0, -1)))
        .filter((image): image is string => image !== null)
      const imageUrls = images.map(ffzImageUrl).filter((url): url is string => url !== null)
      if (imageUrls.length > 0) result.push({ code, urls: imageUrls })
    }
  }
  return result
}

async function loadSevenTv(
  userId: string,
  options: ThirdPartyEmoteOptions,
  signal: AbortSignal
): Promise<ThirdPartyEmote[]> {
  const data = await fetchJson(
    `https://7tv.io/v3/users/twitch/${encodeURIComponent(userId)}`,
    signal
  )
  if (!isRecord(data) || !isRecord(data.emote_set) || !Array.isArray(data.emote_set.emotes)) {
    return []
  }

  const result: ThirdPartyEmote[] = []
  for (const item of data.emote_set.emotes) {
    if (!isRecord(item)) continue
    const code = stringField(item, 'name')
    const id = stringField(item, 'id')
    if (code && id) {
      const data = item.data
      const host = isRecord(data) && isRecord(data.host) ? data.host : null
      const hostUrl = host ? stringField(host, 'url') : null
      const files = host && Array.isArray(host.files) ? host.files : []
      const webpFiles = files
        .filter(
          (file): file is Record<string, unknown> =>
            isRecord(file) && typeof file.name === 'string' && /^\d+x\.webp$/i.test(file.name)
        )
        .sort((left, right) => {
          const leftScale = Number((left.name as string).match(/^(\d+)x\.webp$/i)?.[1] ?? 0)
          const rightScale = Number((right.name as string).match(/^(\d+)x\.webp$/i)?.[1] ?? 0)
          return rightScale - leftScale
        })

      let urls: string[]
      if (hostUrl && webpFiles.length > 0) {
        const orderedFiles = options.bestQuality
          ? webpFiles
          : [
              ...webpFiles.filter((file) => file.name === `${options.imageScale}.webp`),
              ...webpFiles.filter((file) => file.name !== `${options.imageScale}.webp`)
            ]
        const normalizedHost = hostUrl.startsWith('//') ? `https:${hostUrl}` : hostUrl
        try {
          const parsedHost = new URL(normalizedHost)
          if (parsedHost.protocol !== 'https:' || parsedHost.hostname !== 'cdn.7tv.app') {
            continue
          }
          const baseUrl = parsedHost.toString().replace(/\/$/, '')
          urls = orderedFiles
            .map((file) => stringField(file, 'name'))
            .filter((fileName): fileName is string => fileName !== null)
            .map((fileName) => `${baseUrl}/${fileName}`)
        } catch {
          urls = requestedScales(options).map(
            (scale) => `https://cdn.7tv.app/emote/${id}/${scale}.webp`
          )
        }
      } else {
        urls = requestedScales(options).map(
          (scale) => `https://cdn.7tv.app/emote/${id}/${scale}.webp`
        )
      }
      if (urls.length > 0) result.push({ code, urls })
    }
  }
  return result
}

async function loadProvider(
  provider: string,
  loader: (
    userId: string,
    options: ThirdPartyEmoteOptions,
    signal: AbortSignal
  ) => Promise<ThirdPartyEmote[]>,
  userId: string,
  options: ThirdPartyEmoteOptions,
  signal: AbortSignal
): Promise<ThirdPartyEmote[]> {
  try {
    return await loader(userId, options, signal)
  } catch (error) {
    if (!signal.aborted) {
      console.warn(`[StreamShell Backend] Error loading ${provider} emotes:`, error)
    }
    return []
  }
}

export function getThirdPartyEmote(code: string): string[] | undefined {
  return channelEmotes.get(code)
}

export function getThirdPartyEmoteNames(): string[] {
  return [...channelEmotes.keys()]
}

export function getThirdPartyEmoteRevision(): number {
  return emoteRevision
}

export function clearThirdPartyEmotes(): void {
  loadRevision++
  emoteRevision++
  activeLoadController?.abort()
  activeLoadController = null
  channelEmotes.clear()
}

export async function loadThirdPartyEmotes(
  channel: string,
  userId?: string | null,
  options: ThirdPartyEmoteOptions = DEFAULT_OPTIONS
): Promise<void> {
  const revision = ++loadRevision
  activeLoadController?.abort()
  const controller = new AbortController()
  activeLoadController = controller
  channelEmotes.clear()

  let resolvedUserId = userId
  if (!resolvedUserId) {
    try {
      resolvedUserId = (await getUserInfo(channel))?.id ?? null
    } catch (error) {
      console.warn(
        '[StreamShell Backend] Could not get broadcaster ID for third-party emotes:',
        error
      )
      return
    }
  }
  if (!resolvedUserId || revision !== loadRevision || controller.signal.aborted) return

  const [bttv, ffz, sevenTv] = await Promise.all([
    loadProvider('BTTV', loadBttv, resolvedUserId, options, controller.signal),
    loadProvider('FFZ', loadFfz, resolvedUserId, options, controller.signal),
    loadProvider('7TV', loadSevenTv, resolvedUserId, options, controller.signal)
  ])
  if (revision !== loadRevision || controller.signal.aborted) return
  activeLoadController = null

  // Later providers take precedence when different services reuse a code.
  for (const emote of [...bttv, ...ffz, ...sevenTv]) {
    channelEmotes.set(emote.code, emote.urls)
  }
  emoteRevision++

  console.log(
    `[StreamShell Backend] Third-party emotes for ${channel}: ` +
      `BTTV ${bttv.length}, FFZ ${ffz.length}, 7TV ${sevenTv.length} ` +
      `(${channelEmotes.size} unique codes).`
  )
}
