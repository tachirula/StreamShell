import { net } from 'electron'

interface TokenCache {
  token: string
  expiresAt: number
}

let tokenCache: TokenCache | null = null
const avatarCache = new Map<string, string | null>()

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
 * Fetches the profile image URL for a Twitch channel via Helix.
 * Returns null on any failure (bad channel, network, auth). Results are
 * cached in memory for the lifetime of the process — repeat lookups of the
 * same channel are instant.
 */
export async function getStreamerAvatar(channel: string): Promise<string | null> {
  const clean = channel.trim().toLowerCase()
  if (!CHANNEL_REGEX.test(clean)) return null

  if (avatarCache.has(clean)) {
    return avatarCache.get(clean) ?? null
  }

  const clientId = process.env.TWITCH_API_ID_CLIENT
  if (!clientId) return null

  const token = await getAppAccessToken()
  if (!token) return null

  const url = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(clean)}`

  try {
    const res = await net.fetch(url, {
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${token}`
      }
    })

    if (!res.ok) {
      console.warn('[StreamShell Backend] Twitch users request failed:', res.status)
      avatarCache.set(clean, null)
      return null
    }

    const data = (await res.json()) as { data: Array<{ profile_image_url: string }> }
    const avatar = data.data?.[0]?.profile_image_url ?? null
    avatarCache.set(clean, avatar)
    return avatar
  } catch (err) {
    console.error('[StreamShell Backend] Twitch users request errored:', err)
    return null
  }
}