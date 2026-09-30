import { helixGet } from './twitch-api'
import { cacheImage } from './emote-cache'

// Twitch badges.
//
// The IRC `badges` tag only carries ids: { moderator: '1', subscriber: '12' }.
// The images come from Helix (works with the App Access Token, no scopes):
//   GET /chat/badges/global
//   GET /chat/badges?broadcaster_id={id}
// Channel badges override global ones that share the same set_id
// (e.g. the channel's own "subscriber" badges replace the generic one).

interface HelixBadgeVersion {
  id: string
  image_url_1x: string
  image_url_2x: string
  image_url_4x: string
}

interface HelixBadgeSet {
  set_id: string
  versions: HelixBadgeVersion[]
}

interface HelixBadgeResponse {
  data: HelixBadgeSet[]
}

/** set_id -> version id -> image URL */
type BadgeIndex = Map<string, Map<string, string>>

/** Which Helix image size to use (1x=18px, 2x=36px, 4x=72px). */
const IMAGE_KEY = 'image_url_2x' as const

let globalIndex: BadgeIndex | null = null
let globalLoading: Promise<BadgeIndex> | null = null
const channelIndexes = new Map<string, BadgeIndex>()
const channelLoading = new Map<string, Promise<BadgeIndex>>()

function toIndex(response: HelixBadgeResponse | null): BadgeIndex {
  const index: BadgeIndex = new Map()
  for (const set of response?.data ?? []) {
    const versions = new Map<string, string>()
    for (const v of set.versions ?? []) versions.set(v.id, v[IMAGE_KEY])
    index.set(set.set_id, versions)
  }
  return index
}

function loadGlobal(): Promise<BadgeIndex> {
  if (globalIndex) return Promise.resolve(globalIndex)
  if (!globalLoading) {
    globalLoading = helixGet<HelixBadgeResponse>('/chat/badges/global')
      .then((res) => {
        const index = toIndex(res)
        // Only keep it if the request actually worked, otherwise retry later.
        if (res) globalIndex = index
        return index
      })
      .finally(() => {
        globalLoading = null
      })
  }
  return globalLoading
}

function loadChannel(broadcasterId: string): Promise<BadgeIndex> {
  const cached = channelIndexes.get(broadcasterId)
  if (cached) return Promise.resolve(cached)

  let pending = channelLoading.get(broadcasterId)
  if (!pending) {
    pending = helixGet<HelixBadgeResponse>(
      `/chat/badges?broadcaster_id=${encodeURIComponent(broadcasterId)}`
    )
      .then((res) => {
        const index = toIndex(res)
        if (res) channelIndexes.set(broadcasterId, index)
        return index
      })
      .finally(() => {
        channelLoading.delete(broadcasterId)
      })
    channelLoading.set(broadcasterId, pending)
  }
  return pending
}

/**
 * Call once when joining a channel so the first message doesn't have to
 * wait for the two Helix requests.
 */
export async function preloadBadges(broadcasterId: string | null): Promise<void> {
  await Promise.all([loadGlobal(), broadcasterId ? loadChannel(broadcasterId) : null])
}

/**
 * Turns the IRC `badges` tag into local image paths, in tag order
 * (Twitch already sends them in display order).
 * Unknown badges (event badges missing from both lists, failed downloads)
 * are silently omitted.
 *
 * @param badgesTag  `tags.badges` from tmi.js: `{ moderator: '1' }` or null
 */
export async function resolveBadges(
  badgesTag: Record<string, string> | null | undefined,
  broadcasterId: string | null
): Promise<string[]> {
  if (!badgesTag) return []
  const entries = Object.entries(badgesTag)
  if (entries.length === 0) return []

  const [global, channel] = await Promise.all([
    loadGlobal(),
    broadcasterId ? loadChannel(broadcasterId) : Promise.resolve(null)
  ])

  const paths = await Promise.all(
    entries.map(async ([setId, versionId]) => {
      const url = channel?.get(setId)?.get(versionId) ?? global.get(setId)?.get(versionId)
      return url ? cacheImage(url) : null
    })
  )

  return paths.filter((p): p is string => p !== null)
}
