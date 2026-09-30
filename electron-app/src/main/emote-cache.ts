import { app, net } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { rename, writeFile } from 'fs/promises'
import { join } from 'path'

// Disk cache for remote images (badges now, emotes later).
//
// Why on disk: the GNOME Shell extension can't (and shouldn't) download
// remote images. Electron downloads them once, stores them here, and sends
// the extension local file paths over D-Bus.
//
// The cache key is a hash of the URL. Twitch image URLs are immutable
// (a changed badge/emote gets a new URL or id), so the same URL always maps
// to the same file and no invalidation logic is needed.

const DOWNLOAD_TIMEOUT_MS = 4000

let cacheDir: string | null = null

/** In-memory index: url -> absolute file path (skips touching the disk). */
const known = new Map<string, string>()

/** Downloads in progress: url -> promise (dedupes concurrent requests). */
const inflight = new Map<string, Promise<string | null>>()

function getCacheDir(): string {
  if (!cacheDir) {
    // Linux: ~/.cache/streamshell/images
    cacheDir = join(app.getPath('cache'), 'streamshell', 'images')
    mkdirSync(cacheDir, { recursive: true })
  }
  return cacheDir
}

function pathFor(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 20)
  return join(getCacheDir(), `${hash}.png`)
}

async function download(url: string, target: string): Promise<string | null> {
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!res.ok) {
      console.warn('[StreamShell Backend] Image download failed:', res.status, url)
      return null
    }
    const bytes = Buffer.from(await res.arrayBuffer())

    // Write to a temp file and rename, so a crash mid-write never leaves
    // a truncated PNG that would be treated as a valid cache hit.
    const tmp = `${target}.${process.pid}.tmp`
    await writeFile(tmp, bytes)
    await rename(tmp, target)
    return target
  } catch (err) {
    console.warn('[StreamShell Backend] Image download errored:', url, err)
    return null
  }
}

/**
 * Returns a local file path for a remote image, downloading it on first use.
 * Resolves to null if the download fails or times out (the caller should
 * simply omit the image).
 */
export function cacheImage(url: string): Promise<string | null> {
  const hit = known.get(url)
  if (hit) return Promise.resolve(hit)

  const target = pathFor(url)
  if (existsSync(target)) {
    known.set(url, target)
    return Promise.resolve(target)
  }

  const pending = inflight.get(url)
  if (pending) return pending

  const job = download(url, target)
    .then((path) => {
      if (path) known.set(url, path)
      return path
    })
    .finally(() => inflight.delete(url))

  inflight.set(url, job)
  return job
}

// --- Emotes (skeleton) ------------------------------------------------------

export type EmoteScale = '1.0' | '2.0' | '3.0'

/**
 * Official Twitch CDN URL for an emote id taken from the IRC `emotes` tag.
 * `default` format = static image (St.Icon won't animate GIFs anyway).
 */
export function twitchEmoteUrl(id: string, scale: EmoteScale = '2.0'): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/${scale}`
}

// TODO (step 2): buildSegments(message, tags.emotes) -> Segment[]
//   - slice with Array.from(message): emote ranges are in code points
//   - for each emote: cacheImage(twitchEmoteUrl(id))
// TODO (step 4): third-party emotes (BTTV / 7TV / FFZ) as a Map<name, url>
