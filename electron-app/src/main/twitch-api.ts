import { net } from 'electron'

interface TokenCache {
  token: string
  expiresAt: number
}

export interface TwitchUserInfo {
  /** Helix user id (a.k.a. broadcaster_id for channel endpoints). */
  id: string
  avatar: string | null
}

let tokenCache: TokenCache | null = null
const userCache = new Map<string, TwitchUserInfo | null>()

// Twitch usernames are 1-25 chars, lowercase letters, numbers and underscores.
const CHANNEL_REGEX = /^[a-z0-9_]{1,25}$/

/**
 * Obtains a Twitch App Access Token using the Client Credentials Grant.
 * The token is cached until ~5 minutes before its real expiry, so we only
 * hit the auth endpoint roughly once every two months per running process.
 */
async function getAppAccessToken(): Promise<string | null> {
  const clientId = process.env.TWITCH_API_ID_CLIENT
  const clientSecret = process.env.TWITCH_API_SECRET_CLIENT

  if (!clientId || !clientSecret) {
    console.error(
      '[StreamShell Backend] Missing TWITCH_API_ID_CLIENT or TWITCH_API_SECRET_CLIENT. ' +
      'Check your .env file.'
    )
    return null
  }

  const now = Date.now()
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token
  }

  const url =
    `https://id.twitch.tv/oauth2/token` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    `&grant_type=client_credentials`

  try {
    const res = await net.fetch(url, { method: 'POST' })
    if (!res.ok) {
      console.error(
        '[StreamShell Backend] Twitch token request failed:',
        res.status,
        await res.text()
      )
      return null
    }

    const data = (await res.json()) as { access_token: string; expires_in: number }
    tokenCache = {
      token: data.access_token,
      // Safety margin: refresh 5 minutes before Twitch actually expires it.
      expiresAt: now + (data.expires_in - 300) * 1000
    }
    return tokenCache.token
  } catch (err) {
    console.error('[StreamShell Backend] Twitch token request errored:', err)
    return null
  }
}

/**
 * Authenticated GET against Helix. `pathAndQuery` starts with "/", e.g.
 * "/users?login=foo". Returns the parsed JSON body, or null on any failure.
 * On a 401 the cached token is dropped and the request is retried once.
 */
export async function helixGet<T>(pathAndQuery: string, retry = true): Promise<T | null> {
  const clientId = process.env.TWITCH_API_ID_CLIENT
  if (!clientId) return null

  const token = await getAppAccessToken()
  if (!token) return null

  try {
    const res = await net.fetch(`https://api.twitch.tv/helix${pathAndQuery}`, {
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${token}`
      }
    })

    if (res.status === 401 && retry) {
      tokenCache = null
      return helixGet<T>(pathAndQuery, false)
    }

    if (!res.ok) {
      console.warn('[StreamShell Backend] Helix request failed:', res.status, pathAndQuery)
      return null
    }

    return (await res.json()) as T
  } catch (err) {
    console.error('[StreamShell Backend] Helix request errored:', pathAndQuery, err)
    return null
  }
}

/**
 * Looks up a channel's Helix user (id + avatar). Cached in memory for the
 * lifetime of the process. Returns null if the channel doesn't exist or the
 * request fails.
 */
export async function getUserInfo(channel: string): Promise<TwitchUserInfo | null> {
  const clean = channel.trim().toLowerCase()
  if (!CHANNEL_REGEX.test(clean)) return null

  if (userCache.has(clean)) {
    return userCache.get(clean) ?? null
  }

  const data = await helixGet<{ data: Array<{ id: string; profile_image_url: string }> }>(
    `/users?login=${encodeURIComponent(clean)}`
  )
  if (!data) return null // network/auth failure: don't cache, allow retry

  const user = data.data?.[0]
  const info: TwitchUserInfo | null = user
    ? { id: user.id, avatar: user.profile_image_url ?? null }
    : null

  userCache.set(clean, info)
  return info
}

/** Same contract as before: profile image URL, or null. */
export async function getStreamerAvatar(channel: string): Promise<string | null> {
  const info = await getUserInfo(channel)
  return info?.avatar ?? null
}