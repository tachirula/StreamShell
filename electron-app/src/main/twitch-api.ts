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

export interface TwitchUserProfile extends TwitchUserInfo {
  login: string
  displayName: string
  description: string
}

let tokenCache: TokenCache | null = null
let lastMissingCredentials: string | null = null
let getUserAccessToken: () => string | null = () => null
const userCache = new Map<string, TwitchUserInfo | null>()
const profileCache = new Map<string, TwitchUserProfile | null>()

// Twitch usernames are 1-25 chars, lowercase letters, numbers and underscores.
const CHANNEL_REGEX = /^[a-z0-9_]{1,25}$/

export function setTwitchUserAccessTokenProvider(provider: () => string | null): void {
  getUserAccessToken = provider
}

/**
 * Obtains a Twitch App Access Token using the Client Credentials Grant.
 * The token is cached until ~5 minutes before its real expiry, so we only
 * hit the auth endpoint roughly once every two months per running process.
 */
async function getAppAccessToken(): Promise<string | null> {
  const clientId = process.env.TWITCH_API_ID_CLIENT
  const clientSecret = process.env.TWITCH_API_SECRET_CLIENT

  if (!clientId || !clientSecret) {
    const missing = [
      !clientId && 'TWITCH_API_ID_CLIENT',
      !clientSecret && 'TWITCH_API_SECRET_CLIENT'
    ].filter((name): name is string => Boolean(name))
    const missingKey = missing.join(', ')
    if (lastMissingCredentials !== missingKey) {
      console.error(
        `[StreamShell Backend] Missing ${missingKey} in .env; Twitch Helix lookups are unavailable.`
      )
      lastMissingCredentials = missingKey
    }
    return null
  }
  lastMissingCredentials = null

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
 * Authenticated GET against Helix. Prefer the signed-in user's token, then
 * fall back to an app token when there is no user session or Twitch rejects it.
 */
export async function helixGet<T>(pathAndQuery: string): Promise<T | null> {
  return requestHelix<T>(pathAndQuery, true)
}

async function requestHelix<T>(pathAndQuery: string, allowUserToken: boolean): Promise<T | null> {
  const clientId = process.env.TWITCH_API_ID_CLIENT
  if (!clientId) return null

  const userToken = allowUserToken ? getUserAccessToken() : null
  const token = userToken
    ? { value: userToken, type: 'user' as const }
    : { value: await getAppAccessToken(), type: 'app' as const }
  if (!token.value) return null

  try {
    const res = await net.fetch(`https://api.twitch.tv/helix${pathAndQuery}`, {
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${token.value}`
      }
    })

    if (res.status === 401 && token.type === 'user') {
      console.warn(
        '[StreamShell Backend] Twitch user token was rejected by Helix; retrying with an app token.'
      )
      return requestHelix<T>(pathAndQuery, false)
    }

    if (res.status === 401 && token.type === 'app') {
      tokenCache = null
      return retryAppHelix<T>(pathAndQuery)
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

async function retryAppHelix<T>(pathAndQuery: string): Promise<T | null> {
  const clientId = process.env.TWITCH_API_ID_CLIENT
  if (!clientId) return null
  const token = await getAppAccessToken()
  if (!token) return null

  try {
    const response = await net.fetch(`https://api.twitch.tv/helix${pathAndQuery}`, {
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${token}`
      }
    })
    if (!response.ok) {
      console.warn(
        '[StreamShell Backend] Helix request failed after token refresh:',
        response.status,
        pathAndQuery
      )
      return null
    }
    return (await response.json()) as T
  } catch (error) {
    console.error('[StreamShell Backend] Helix retry errored:', pathAndQuery, error)
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

export async function getTwitchUserProfile(login: string): Promise<TwitchUserProfile | null> {
  const clean = login.trim().toLowerCase()
  if (!CHANNEL_REGEX.test(clean)) return null
  if (profileCache.has(clean)) return profileCache.get(clean) ?? null

  const data = await helixGet<{
    data: Array<{
      id: string
      login: string
      display_name: string
      description: string
      profile_image_url: string
    }>
  }>(`/users?login=${encodeURIComponent(clean)}`)
  if (!data) return null

  const user = data.data?.[0]
  const profile: TwitchUserProfile | null = user
    ? {
        id: user.id,
        login: user.login,
        displayName: user.display_name,
        description: user.description ?? '',
        avatar: user.profile_image_url ?? null
      }
    : null
  if (profileCache.size >= 128) {
    const oldestLogin = profileCache.keys().next().value
    if (oldestLogin) profileCache.delete(oldestLogin)
  }
  profileCache.set(clean, profile)
  if (profile) userCache.set(clean, { id: profile.id, avatar: profile.avatar })
  return profile
}

export async function getAuthenticatedTwitchUserAvatar(
  accessToken: string
): Promise<string | null> {
  const clientId = process.env.TWITCH_API_ID_CLIENT
  if (!clientId) {
    console.warn(
      '[StreamShell Backend] Cannot load the signed-in Twitch avatar without a Client ID.'
    )
    return null
  }

  try {
    const response = await net.fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${accessToken}`
      }
    })
    if (!response.ok) {
      console.warn(
        '[StreamShell Backend] Could not load the signed-in Twitch avatar:',
        response.status
      )
      return null
    }
    const data = (await response.json()) as {
      data?: Array<{ profile_image_url?: unknown }>
    }
    const avatar = data.data?.[0]?.profile_image_url
    if (typeof avatar !== 'string') return null
    const avatarUrl = new URL(avatar)
    return avatarUrl.protocol === 'https:' ? avatarUrl.toString() : null
  } catch (error) {
    console.warn('[StreamShell Backend] Could not load the signed-in Twitch avatar:', error)
    return null
  }
}
