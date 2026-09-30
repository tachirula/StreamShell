import { app, net } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { rename, writeFile } from 'fs/promises'
import { join } from 'path'

// Disk cache for remote images (badges, emotes).
//
// Why on disk: the GNOME Shell extension can't (and shouldn't) download
// remote images. Electron downloads them once, stores them here, and sends
// the extension local file paths over D-Bus.
//
// The cache key is a hash of the URL. Twitch image URLs are immutable
// (a changed badge/emote gets a new URL or id), so no invalidation is needed.
//
// The file extension is chosen from the real content (GIF magic bytes), so
// the extension can tell animated files (.gif) from static ones (.png).

const DOWNLOAD_TIMEOUT_MS = 4000

type Ext = 'png' | 'gif'
const EXTENSIONS: Ext[] = ['gif', 'png']

type FetchResult =
  | { ok: true; path: string }
  | { ok: false; missing: boolean } // missing = HTTP 404

let cacheDir: string | null = null

/** In-memory index: url -> absolute file path (skips touching the disk). */
const known = new Map<string, string>()

/** Downloads in progress: url -> promise (dedupes concurrent requests). */
const inflight = new Map<string, Promise<FetchResult>>()

function getCacheDir(): string {
  if (!cacheDir) {
    // Linux: $XDG_CACHE_HOME or ~/.cache, so files end up in
    // ~/.cache/streamshell/images. Other platforms: the app's userData dir.
    // ('cache' is not a documented key of app.getPath, hence the manual path.)
    const base =
      process.platform === 'linux'
        ? process.env.XDG_CACHE_HOME || join(app.getPath('home'), '.cache')
        : app.getPath('userData')
    cacheDir = join(base, 'streamshell', 'images')
    mkdirSync(cacheDir, { recursive: true })
  }
  return cacheDir
}

function hashOf(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 20)
}

function pathFor(url: string, ext: Ext): string {
  return join(getCacheDir(), `${hashOf(url)}.${ext}`)
}

function findCached(url: string): string | null {
  for (const ext of EXTENSIONS) {
    const p = pathFor(url, ext)
    if (existsSync(p)) return p
  }
  return null
}

function detectExt(bytes: Buffer): Ext {
  return bytes.subarray(0, 3).toString('latin1') === 'GIF' ? 'gif' : 'png'
}

async function fetchToDisk(url: string): Promise<FetchResult> {
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!res.ok) {
      if (res.status !== 404) {
        console.warn('[StreamShell Backend] Image download failed:', res.status, url)
      }
      return { ok: false, missing: res.status === 404 }
    }

    const bytes = Buffer.from(await res.arrayBuffer())
    const target = pathFor(url, detectExt(bytes))

    // Write to a temp file and rename, so a crash mid-write never leaves
    // a truncated file that would be treated as a valid cache hit.
    const tmp = `${target}.${process.pid}.tmp`
    await writeFile(tmp, bytes)
    await rename(tmp, target)
    return { ok: true, path: target }
  } catch (err) {
    console.warn('[StreamShell Backend] Image download errored:', url, err)
    return { ok: false, missing: false }
  }
}

function resolveImage(url: string): Promise<FetchResult> {
  const hit = known.get(url)
  if (hit) return Promise.resolve({ ok: true, path: hit })

  const onDisk = findCached(url)
  if (onDisk) {
    known.set(url, onDisk)
    return Promise.resolve({ ok: true, path: onDisk })
  }

  const pending = inflight.get(url)
  if (pending) return pending

  const job = fetchToDisk(url)
    .then((result) => {
      if (result.ok) known.set(url, result.path)
      return result
    })
    .finally(() => inflight.delete(url))

  inflight.set(url, job)
  return job
}

/**
 * Returns a local file path for a remote image, downloading it on first use.
 * Resolves to null if the download fails or times out (the caller should
 * simply omit the image).
 */
export async function cacheImage(url: string): Promise<string | null> {
  const result = await resolveImage(url)
  return result.ok ? result.path : null
}

// --- Emotes -----------------------------------------------------------------

export type EmoteScale = '1.0' | '2.0' | '3.0'
export type EmoteFormat = 'static' | 'animated'

/** Official Twitch CDN URL for an emote id from the IRC `emotes` tag. */
export function twitchEmoteUrl(
  id: string,
  scale: EmoteScale = '2.0',
  format: EmoteFormat = 'static'
): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/${format}/dark/${scale}`
}

/** Emote ids known to have no animated version (skips a request next time). */
const noAnim = new Set<string>()
const emoteInflight = new Map<string, Promise<string | null>>()

function noAnimMarker(id: string): string {
  return join(getCacheDir(), `noanim-${id.replace(/[^a-zA-Z0-9_]/g, '_')}`)
}

async function loadEmote(id: string): Promise<string | null> {
  const animatedUrl = twitchEmoteUrl(id, '2.0', 'animated')
  const staticUrl = twitchEmoteUrl(id, '2.0', 'static')

  const cachedAnimated = findCached(animatedUrl)
  if (cachedAnimated) return cachedAnimated

  if (noAnim.has(id) || existsSync(noAnimMarker(id))) {
    noAnim.add(id)
    return cacheImage(staticUrl)
  }

  const result = await resolveImage(animatedUrl)
  if (result.ok) return result.path

  // Transient failure (timeout, 5xx): show the static one now and retry the
  // animated one next time. Only a 404 is remembered as "no animated version".
  if (!result.missing) return cacheImage(staticUrl)

  noAnim.add(id)
  await writeFile(noAnimMarker(id), '').catch(() => {})
  return cacheImage(staticUrl)
}

/**
 * Local path for a Twitch emote: the animated version (.gif) when it exists,
 * otherwise the static one (.png). Null if nothing could be downloaded.
 */
export function cacheEmote(id: string): Promise<string | null> {
  const pending = emoteInflight.get(id)
  if (pending) return pending

  const job = loadEmote(id).finally(() => emoteInflight.delete(id))
  emoteInflight.set(id, job)
  return job
}

// TODO (step 4): third-party emotes (BTTV / 7TV / FFZ) as a Map<name, url>