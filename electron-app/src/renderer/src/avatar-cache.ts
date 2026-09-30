// Persistent avatar cache backed by localStorage. Survives app restarts,
// unlike the in-memory cache in the main process. Entries older than TTL
// are considered stale and will be refreshed by the next lookup, but the
// stale value is still returned so we can render it immediately.

const CACHE_KEY = 'streamshell.avatar-cache.v1'
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

interface CacheEntry {
  url: string | null
  fetchedAt: number
}

type CacheMap = Record<string, CacheEntry>

function readCache(): CacheMap {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as CacheMap) : {}
  } catch {
    return {}
  }
}

function writeCache(map: CacheMap): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map))
  } catch {
    // Quota exceeded or localStorage disabled — silently ignore.
  }
}

/**
 * Returns the cached URL for a channel.
 *   - `undefined` → never fetched (or expired beyond TTL, treat as miss).
 *   - `null`      → fetched and confirmed to not exist (invalid channel).
 *   - `string`    → cached URL.
 */
export function getCachedAvatar(channel: string): string | null | undefined {
  const entry = readCache()[channel]
  if (!entry) return undefined
  if (Date.now() - entry.fetchedAt > TTL_MS) return undefined
  return entry.url
}

export function setCachedAvatar(channel: string, url: string | null): void {
  const map = readCache()
  map[channel] = { url, fetchedAt: Date.now() }
  writeCache(map)
}

/** Debug helper. Call from DevTools: `__clearAvatarCache()` after wiring. */
export function clearAvatarCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // ignore
  }
}