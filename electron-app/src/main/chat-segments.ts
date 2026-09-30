import { cacheEmote } from './emote-cache'

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
  | { t: 'text'; v: string }
  | { t: 'emote'; path: string; name: string }

export interface ChatPayload {
  badges: string[]
  segments: Segment[]
}

interface EmoteRange {
  start: number
  end: number
  id: string
}

function parseRanges(emotesTag: Record<string, string[]> | null | undefined, length: number): EmoteRange[] {
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
  if (last && last.t === 'text') last.v += value // merge adjacent text
  else segments.push({ t: 'text', v: value })
}

/**
 * @param message    Message text as delivered by tmi.js
 * @param emotesTag  `tags.emotes` from tmi.js (or null when there are none)
 */
export async function buildSegments(
  message: string,
  emotesTag: Record<string, string[]> | null | undefined
): Promise<Segment[]> {
  const chars = Array.from(message)
  const ranges = parseRanges(emotesTag, chars.length)

  if (ranges.length === 0) return [{ t: 'text', v: message }]

  // Download every distinct emote in parallel (cacheImage dedupes and caches).
  const uniqueIds = [...new Set(ranges.map((r) => r.id))]
  const paths = new Map<string, string | null>()
  await Promise.all(
    uniqueIds.map(async (id) => {
      paths.set(id, await cacheEmote(id))
    })
  )

  const segments: Segment[] = []
  let cursor = 0

  for (const r of ranges) {
    if (r.start < cursor) continue // overlapping range: skip

    pushText(segments, chars.slice(cursor, r.start).join(''))

    const name = chars.slice(r.start, r.end + 1).join('')
    const path = paths.get(r.id)

    if (path) segments.push({ t: 'emote', path, name })
    else pushText(segments, name) // download failed: show the emote's name

    cursor = r.end + 1
  }

  pushText(segments, chars.slice(cursor).join(''))
  return segments
}