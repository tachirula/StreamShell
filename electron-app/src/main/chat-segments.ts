import { cacheEmote, cacheImage } from './emote-cache'
import {
  getThirdPartyEmote,
  getThirdPartyEmoteNames,
  getThirdPartyEmoteRevision
} from './third-party-emotes'

// Splits a chat message into text and emote segments using the `emotes` tag
// that Twitch attaches to every IRC message. No dictionary needed: the tag
// says which emote id sits at which position.
//
// tmi.js delivers it as:  { '25': ['0-4', '10-14'], '1902': ['6-10'] }
// (emote id -> list of "start-end" ranges, both inclusive)
//
// IMPORTANT: ranges are in Unicode code points, not UTF-16 units. That is
// why the message is split with Array.from() instead of using substring():
// a single emoji counts as 1 for Twitch but 2 for JavaScript's .length.

export type Segment =
  { t: 'text'; v: string } | { t: 'emote'; path: string; name: string; animated?: boolean }

export interface ChatPayload {
  badges: string[]
  segments: Segment[]
}

export interface ChatReply {
  user: string
  message: string
}

interface EmoteRange {
  start: number
  end: number
  id: string
}

function parseRanges(
  emotesTag: Record<string, string[]> | null | undefined,
  length: number
): EmoteRange[] {
  if (!emotesTag) return []

  const ranges: EmoteRange[] = []
  for (const [id, positions] of Object.entries(emotesTag)) {
    for (const pos of positions) {
      const [s, e] = pos.split('-').map(Number)
      // Defensive: ignore malformed or out-of-bounds ranges instead of crashing.
      if (!Number.isInteger(s) || !Number.isInteger(e)) continue
      if (s < 0 || e < s || e >= length) continue
      ranges.push({ start: s, end: e, id })
    }
  }

  ranges.sort((a, b) => a.start - b.start)
  return ranges
}

function pushText(segments: Segment[], value: string): void {
  if (!value) return
  const last = segments[segments.length - 1]
  if (last && last.t === 'text')
    last.v += value // merge adjacent text
  else segments.push({ t: 'text', v: value })
}

export function stripReplyMention(segments: Segment[], replyUser: string): Segment[] {
  const first = segments[0]
  if (!first || first.t !== 'text') return segments

  const mention = new RegExp(`^@${replyUser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i')
  const match = first.v.match(mention)
  if (!match) return segments

  const result: Segment[] = []
  pushText(result, first.v.slice(match[0].length))
  for (const segment of segments.slice(1)) {
    if (segment.t === 'text') pushText(result, segment.v)
    else result.push(segment)
  }
  return result
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value)
}

let thirdPartyCodesByInitial = new Map<string, string[]>()
let knownThirdPartyRevision = -1

function refreshThirdPartyCodes(): void {
  const revision = getThirdPartyEmoteRevision()
  if (revision === knownThirdPartyRevision) return
  const codes = getThirdPartyEmoteNames()
  thirdPartyCodesByInitial = new Map()
  for (const code of codes.sort((a, b) => b.length - a.length)) {
    const initial = Array.from(code)[0]
    if (!initial) continue
    const matches = thirdPartyCodesByInitial.get(initial) ?? []
    matches.push(code)
    thirdPartyCodesByInitial.set(initial, matches)
  }
  knownThirdPartyRevision = revision
}

function splitThirdPartyEmotes(
  text: string
): Array<{ text: string; code?: string; urls?: string[] }> {
  const parts: Array<{ text: string; code?: string; urls?: string[] }> = []
  let textStart = 0
  let cursor = 0
  while (cursor < text.length) {
    const initial = String.fromCodePoint(text.codePointAt(cursor)!)
    const candidates = thirdPartyCodesByInitial.get(initial)
    const match = candidates?.find((code) => {
      if (!text.startsWith(code, cursor)) return false
      const before = cursor > 0 ? [...text.slice(0, cursor)].at(-1) : undefined
      const end = cursor + code.length
      const after = end < text.length ? String.fromCodePoint(text.codePointAt(end)!) : undefined
      return !isWordCharacter(before) && !isWordCharacter(after)
    })
    if (!match) {
      cursor += initial.length
      continue
    }

    if (cursor > textStart) parts.push({ text: text.slice(textStart, cursor) })
    parts.push({ text: '', code: match, urls: getThirdPartyEmote(match) })
    cursor += match.length
    textStart = cursor
  }
  if (textStart < text.length) parts.push({ text: text.slice(textStart) })
  return parts
}

/**
 * @param message    Message text as delivered by tmi.js
 * @param emotesTag  `tags.emotes` from tmi.js (or null when there are none)
 */
export async function buildSegments(
  message: string,
  emotesTag: Record<string, string[]> | null | undefined,
  options: { animated?: boolean; timeoutMs?: number } = {}
): Promise<Segment[]> {
  const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : null
  let timeoutLogged = false
  const cacheBeforeDeadline = async (operation: Promise<string | null>): Promise<string | null> => {
    if (deadline === null) return operation
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      if (!timeoutLogged) {
        timeoutLogged = true
        console.warn(
          '[StreamShell Backend] Emote asset deadline exceeded; rendering text fallback.'
        )
      }
      return null
    }
    let timer: NodeJS.Timeout | undefined
    let result: string | null
    try {
      result = await Promise.race([
        operation,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), remainingMs)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (result === null && !timeoutLogged) {
      timeoutLogged = true
      console.warn('[StreamShell Backend] Emote asset deadline exceeded; rendering text fallback.')
    }
    return result
  }
  const chars = Array.from(message)
  const ranges = parseRanges(emotesTag, chars.length)

  // Download every distinct emote in parallel (cacheImage dedupes and caches).
  const uniqueIds = [...new Set(ranges.map((r) => r.id))]
  const paths = new Map<string, string | null>()
  await Promise.all(
    uniqueIds.map(async (id) => {
      paths.set(
        id,
        await cacheBeforeDeadline(
          cacheEmote(id, options.animated === false ? 'static' : 'animated')
        )
      )
    })
  )

  const twitchSegments: Segment[] = []
  let cursor = 0

  for (const r of ranges) {
    if (r.start < cursor) continue // overlapping range: skip

    pushText(twitchSegments, chars.slice(cursor, r.start).join(''))

    const name = chars.slice(r.start, r.end + 1).join('')
    const path = paths.get(r.id)

    if (path) twitchSegments.push({ t: 'emote', path, name })
    else pushText(twitchSegments, name) // download failed: show the emote's name

    cursor = r.end + 1
  }

  pushText(twitchSegments, chars.slice(cursor).join(''))

  refreshThirdPartyCodes()
  const resolved = await Promise.all(
    twitchSegments.map(async (segment): Promise<Segment[]> => {
      if (segment.t === 'emote') return [segment]

      const parts = splitThirdPartyEmotes(segment.v)
      const assets = await Promise.all(
        parts.map(async (part): Promise<Segment> => {
          if (!part.code) return { t: 'text', v: part.text }
          if (!part.urls?.length) return { t: 'text', v: part.code }
          let path: string | null = null
          for (const url of part.urls) {
            path = await cacheBeforeDeadline(cacheImage(url))
            if (path) break
            if (deadline !== null && Date.now() >= deadline) break
          }
          return path
            ? { t: 'emote', path, name: part.code, animated: options.animated !== false }
            : { t: 'text', v: part.code }
        })
      )
      const merged: Segment[] = []
      for (const asset of assets) {
        if (asset.t === 'text') pushText(merged, asset.v)
        else merged.push(asset)
      }
      return merged
    })
  )

  return resolved.flat()
}
