import { app, net, safeStorage } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
export type { TwitchAuthStatus, TwitchDeviceAuthorization } from '../shared/types'

const READ_SCOPES = ['chat:read'] as const
const AUTH_FILE = 'twitch-auth.bin'
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const REFRESH_GRANT_TYPE = 'refresh_token'
const TWITCH_DEVICE_ENDPOINT = 'https://id.twitch.tv/oauth2/device'
const TWITCH_TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token'
const TWITCH_DEVICE_VERIFICATION_URI = 'https://www.twitch.tv/activate'
const NETWORK_RETRY_MS = 5000

export interface TwitchAuthSession {
  accessToken: string
  refreshToken?: string
  login: string
  userId: string
  scopes: string[]
  expiresAt: number
}

export class TwitchAuthError extends Error {
  constructor(
    message: string,
    readonly invalidToken = false
  ) {
    super(message)
    this.name = 'TwitchAuthError'
  }
}

export function getTwitchClientId(): string {
  const clientId = process.env.TWITCH_API_ID_CLIENT?.trim()
  if (!clientId) {
    throw new TwitchAuthError(
      'Twitch Client ID is not configured. Set TWITCH_API_ID_CLIENT before building the app.'
    )
  }
  return clientId
}

function requestedScopes(requireChatEdit: boolean): string[] {
  return requireChatEdit ? [...READ_SCOPES, 'chat:edit'] : [...READ_SCOPES]
}

async function readOAuthResponse(response: Response): Promise<Record<string, unknown>> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new TwitchAuthError(`Twitch returned an unreadable OAuth response: ${String(error)}`)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TwitchAuthError('Twitch returned an invalid OAuth response.')
  }
  return payload as Record<string, unknown>
}

function responseError(payload: Record<string, unknown>): string {
  if (typeof payload.message === 'string') return payload.message
  if (typeof payload.error === 'string') return payload.error
  return ''
}

function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(new TwitchAuthError('Twitch sign-in was cancelled.'))
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function requestTwitchDeviceAuthorization(
  requireChatEdit: boolean,
  signal: AbortSignal
): Promise<{
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
  expiresAt: number
  scopes: string[]
}> {
  const scopes = requestedScopes(requireChatEdit)
  const body = new URLSearchParams({
    client_id: getTwitchClientId(),
    scopes: scopes.join(' ')
  })
  let response: Response
  try {
    response = await net.fetch(TWITCH_DEVICE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal
    })
  } catch (error) {
    if (signal.aborted) throw new TwitchAuthError('Twitch sign-in was cancelled.')
    throw new TwitchAuthError(`Could not start Twitch device authorization: ${String(error)}`)
  }
  const payload = await readOAuthResponse(response)
  if (!response.ok) {
    throw new TwitchAuthError(
      `Twitch device authorization failed (${response.status}): ${responseError(payload) || 'unknown error'}`
    )
  }
  if (
    typeof payload.device_code !== 'string' ||
    typeof payload.user_code !== 'string' ||
    typeof payload.verification_uri !== 'string' ||
    typeof payload.expires_in !== 'number' ||
    typeof payload.interval !== 'number' ||
    payload.expires_in <= 0 ||
    payload.interval <= 0
  ) {
    throw new TwitchAuthError('Twitch returned incomplete device authorization details.')
  }
  let verificationUri: URL
  try {
    verificationUri = new URL(payload.verification_uri)
  } catch {
    throw new TwitchAuthError('Twitch returned an invalid device activation URL.')
  }
  if (
    verificationUri.protocol !== 'https:' ||
    verificationUri.hostname !== 'www.twitch.tv' ||
    verificationUri.pathname !== '/activate'
  ) {
    throw new TwitchAuthError('Twitch returned an unexpected device activation URL.')
  }
  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUri: TWITCH_DEVICE_VERIFICATION_URI,
    interval: payload.interval,
    expiresAt: Date.now() + payload.expires_in * 1000,
    scopes
  }
}

export async function pollTwitchDeviceAuthorization(
  deviceCode: string,
  scopes: string[],
  initialInterval: number,
  expiresAt: number,
  signal: AbortSignal
): Promise<{ accessToken: string; refreshToken: string }> {
  let intervalMs = initialInterval * 1000
  while (Date.now() < expiresAt) {
    await waitForPoll(Math.min(intervalMs, expiresAt - Date.now()), signal)
    if (signal.aborted) throw new TwitchAuthError('Twitch sign-in was cancelled.')

    const body = new URLSearchParams({
      client_id: getTwitchClientId(),
      scopes: scopes.join(' '),
      device_code: deviceCode,
      grant_type: DEVICE_GRANT_TYPE
    })
    let response: Response
    try {
      response = await net.fetch(TWITCH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal
      })
    } catch (error) {
      if (signal.aborted) throw new TwitchAuthError('Twitch sign-in was cancelled.')
      console.warn('[StreamShell Backend] Device-code polling failed; retrying.', error)
      await waitForPoll(Math.min(NETWORK_RETRY_MS, Math.max(1, expiresAt - Date.now())), signal)
      continue
    }
    const payload = await readOAuthResponse(response)
    if (response.ok) {
      if (typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string') {
        throw new TwitchAuthError('Twitch did not return the device-flow tokens.')
      }
      return { accessToken: payload.access_token, refreshToken: payload.refresh_token }
    }

    const oauthError = responseError(payload)
    if (oauthError === 'authorization_pending') continue
    if (oauthError === 'slow_down') {
      intervalMs += 5000
      continue
    }
    if (oauthError === 'access_denied') {
      throw new TwitchAuthError('Twitch authorization was denied.')
    }
    if (oauthError === 'expired_token' || oauthError === 'invalid device code') {
      throw new TwitchAuthError('The Twitch device code expired. Please try again.')
    }
    throw new TwitchAuthError(
      `Twitch device authorization polling failed (${response.status}): ${oauthError || 'unknown error'}`
    )
  }
  throw new TwitchAuthError('The Twitch device code expired. Please try again.')
}

export async function refreshTwitchSession(session: TwitchAuthSession): Promise<TwitchAuthSession> {
  if (!session.refreshToken) {
    throw new TwitchAuthError('This Twitch session cannot be refreshed.', true)
  }
  const body = new URLSearchParams({
    client_id: getTwitchClientId(),
    grant_type: REFRESH_GRANT_TYPE,
    refresh_token: session.refreshToken
  })
  let response: Response
  try {
    response = await net.fetch(TWITCH_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
  } catch (error) {
    throw new TwitchAuthError(`Could not refresh the Twitch session: ${String(error)}`)
  }
  const payload = await readOAuthResponse(response)
  if (!response.ok) {
    const error = responseError(payload)
    throw new TwitchAuthError(
      `Twitch session refresh failed (${response.status}): ${error || 'unknown error'}`,
      error === 'invalid_grant' || error.toLowerCase().includes('invalid refresh token')
    )
  }
  if (
    typeof payload.access_token !== 'string' ||
    typeof payload.refresh_token !== 'string' ||
    typeof payload.expires_in !== 'number' ||
    payload.expires_in <= 0 ||
    !Array.isArray(payload.scope) ||
    !payload.scope.every((scope): scope is string => typeof scope === 'string')
  ) {
    throw new TwitchAuthError('Twitch returned incomplete refreshed credentials.')
  }
  return {
    ...session,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    scopes: payload.scope,
    expiresAt: Date.now() + payload.expires_in * 1000
  }
}

export async function validateTwitchAccessToken(
  accessToken: string,
  requireChatEdit = false
): Promise<TwitchAuthSession> {
  let response: Response
  try {
    response = await net.fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${accessToken}` }
    })
  } catch (error) {
    throw new TwitchAuthError(`Could not validate the Twitch session: ${String(error)}`)
  }

  if (response.status === 401) {
    throw new TwitchAuthError('The Twitch session expired or was revoked.', true)
  }
  if (!response.ok) {
    throw new TwitchAuthError(`Twitch session validation failed (${response.status}).`)
  }

  let data: {
    client_id?: unknown
    login?: unknown
    user_id?: unknown
    scopes?: unknown
    expires_in?: unknown
  }
  try {
    data = (await response.json()) as typeof data
  } catch (error) {
    throw new TwitchAuthError(`Twitch returned an unreadable validation response: ${String(error)}`)
  }
  const scopes = Array.isArray(data.scopes)
    ? data.scopes.filter((scope): scope is string => typeof scope === 'string')
    : []
  if (
    data.client_id !== getTwitchClientId() ||
    typeof data.login !== 'string' ||
    typeof data.user_id !== 'string' ||
    typeof data.expires_in !== 'number' ||
    data.expires_in <= 0
  ) {
    throw new TwitchAuthError('Twitch returned incomplete or mismatched account information.', true)
  }
  const requiredScopes = requireChatEdit ? [...READ_SCOPES, 'chat:edit'] : READ_SCOPES
  const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope))
  if (missingScopes.length > 0) {
    throw new TwitchAuthError(
      `The Twitch account is missing required permissions: ${missingScopes.join(', ')}.`,
      true
    )
  }

  return {
    accessToken,
    login: data.login,
    userId: data.user_id,
    scopes,
    expiresAt: Date.now() + data.expires_in * 1000
  }
}

export async function revokeTwitchAccessToken(accessToken: string): Promise<void> {
  const url = new URL('https://id.twitch.tv/oauth2/revoke')
  url.searchParams.set('client_id', getTwitchClientId())
  url.searchParams.set('token', accessToken)
  const response = await net.fetch(url.toString(), { method: 'POST' })
  if (!response.ok) {
    throw new TwitchAuthError(`Twitch token revocation failed (${response.status}).`)
  }
}

function authFilePath(): string {
  return join(app.getPath('userData'), AUTH_FILE)
}

function assertSecureStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure operating-system credential storage is not available.')
  }
}

export async function loadStoredTwitchSession(): Promise<TwitchAuthSession | null> {
  let encrypted: Buffer
  try {
    encrypted = await readFile(authFilePath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  assertSecureStorageAvailable()
  let parsed: unknown
  try {
    parsed = JSON.parse(safeStorage.decryptString(encrypted))
  } catch (error) {
    throw new Error(`Could not decrypt saved Twitch credentials: ${String(error)}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Saved Twitch credentials have an invalid format.')
  }
  const session = parsed as Partial<TwitchAuthSession>
  if (
    typeof session.accessToken !== 'string' ||
    typeof session.login !== 'string' ||
    typeof session.userId !== 'string' ||
    !Array.isArray(session.scopes) ||
    !session.scopes.every((scope) => typeof scope === 'string') ||
    typeof session.expiresAt !== 'number'
  ) {
    throw new Error('Saved Twitch credentials have an invalid format.')
  }
  return session as TwitchAuthSession
}

export async function saveTwitchSession(session: TwitchAuthSession): Promise<void> {
  assertSecureStorageAvailable()
  const directory = app.getPath('userData')
  await mkdir(directory, { recursive: true })
  const target = authFilePath()
  const temporary = `${target}.${process.pid}.tmp`
  const encrypted = safeStorage.encryptString(JSON.stringify(session))
  await writeFile(temporary, encrypted, { mode: 0o600 })
  await rename(temporary, target)
}

export async function clearStoredTwitchSession(): Promise<void> {
  await rm(authFilePath(), { force: true })
}
