import { useCallback, useState, useEffect, useRef, type ReactElement } from 'react'
import twitchLogo from './assets/twitch-logo.png'
import { t } from './i18n'
import { getCachedAvatar, setCachedAvatar } from './avatar-cache'
import { SettingsPanel } from './components/SettingsPanel'
import type { Preferences, TwitchAuthStatus } from './components/types'

// --- Integrated SVG icons ---
const LoadingIcon = (): ReactElement => (
  <svg
    className="spin-anim"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)

const CancelIcon = (): ReactElement => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const SettingsIcon = (): ReactElement => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.08-.02a1.7 1.7 0 0 0-1.75.5l-.06.06h-3.4l-.03-.08a1.7 1.7 0 0 0-1.4-1.18 1.7 1.7 0 0 0-1.36.5l-.06.06-2.94-1.7.02-.08a1.7 1.7 0 0 0-.5-1.75l-.06-.06v-3.4l.08-.03a1.7 1.7 0 0 0 1.18-1.4 1.7 1.7 0 0 0-.5-1.36l-.06-.06 1.7-2.94.08.02a1.7 1.7 0 0 0 1.75-.5l.06-.06h3.4l.03.08a1.7 1.7 0 0 0 1.4 1.18 1.7 1.7 0 0 0 1.36-.5l.06-.06 2.94 1.7-.02.08a1.7 1.7 0 0 0 .5 1.75l.06.06v3.4z" />
  </svg>
)
// -----------------------

type Status = 'idle' | 'connecting' | 'connected' | 'error'

interface GnomeWarningView {
  key: string
  params?: Record<string, string>
}

function App(): ReactElement {
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [gnomeWarnings, setGnomeWarnings] = useState<GnomeWarningView[]>([])
  const [warningsDismissed, setWarningsDismissed] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [avatarLookupNonce, setAvatarLookupNonce] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [preferencesError, setPreferencesError] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<TwitchAuthStatus>({
    authenticated: false,
    canSendChat: false,
    username: null,
    avatarUrl: null,
    deviceAuthorization: null,
    error: null
  })
  const [authStatusLoaded, setAuthStatusLoaded] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [signInNotice, setSignInNotice] = useState('')

  const prevNonceRef = useRef(0)
  const authStatusRef = useRef(false)
  const authStatusRevisionRef = useRef(0)
  const disconnectRequestedRef = useRef(false)
  const signInNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateAuthStatus = useCallback((nextStatus: TwitchAuthStatus): void => {
    authStatusRef.current = nextStatus.authenticated
    setAuthStatus(nextStatus)
    setAuthStatusLoaded(true)
  }, [])

  const showSignInCancelledNotice = (): void => {
    if (signInNoticeTimeoutRef.current) clearTimeout(signInNoticeTimeoutRef.current)
    setSignInNotice(t('settings.signInCancelled'))
    signInNoticeTimeoutRef.current = setTimeout(() => {
      setSignInNotice('')
      signInNoticeTimeoutRef.current = null
    }, 2000)
  }

  useEffect(() => {
    window.api
      .getPreferences()
      .then(setPreferences)
      .catch((err: unknown) => setPreferencesError(String(err)))
    const offAuthStatus = window.api.onTwitchAuthStatus((nextStatus) => {
      authStatusRevisionRef.current += 1
      if (authStatusRef.current && !nextStatus.authenticated) {
        setPreferences((current) =>
          current ? { ...current, interactiveChatEnabled: false } : current
        )
      }
      updateAuthStatus(nextStatus)
    })
    window.api
      .getTwitchAuthStatus()
      .then((nextStatus) => {
        if (authStatusRevisionRef.current !== 0) return
        updateAuthStatus(nextStatus)
      })
      .catch((err: unknown) =>
        updateAuthStatus({
          authenticated: false,
          canSendChat: false,
          username: null,
          avatarUrl: null,
          deviceAuthorization: null,
          error: String(err)
        })
      )
    return offAuthStatus
  }, [updateAuthStatus])

  useEffect(
    () => () => {
      if (signInNoticeTimeoutRef.current) clearTimeout(signInNoticeTimeoutRef.current)
    },
    []
  )

  useEffect(() => {
    if (!preferences) return
    const timer = setTimeout(() => {
      window.api
        .setPreferences(preferences)
        .then(() => setPreferencesError(null))
        .catch((err: unknown) => setPreferencesError(String(err)))
    }, 250)
    return () => clearTimeout(timer)
  }, [preferences])

  // Subscribe to actual backend events.
  useEffect(() => {
    const offConnected = window.api.onTwitchConnected(({ channel: ch }) => {
      console.log('[Renderer] twitch:connected →', ch)
      setErrorMsg(null)
      setStatus('connected')
    })
    const offError = window.api.onTwitchError(({ key, params }) => {
      const message = t(key, params)
      console.log('[Renderer] twitch:error →', message)
      setErrorMsg(message)
      setStatus('error')
    })
    const offDisconnected = window.api.onTwitchDisconnected(({ reason }) => {
      console.log('[Renderer] twitch:disconnected →', reason)
    })

    return () => {
      offConnected()
      offError()
      offDisconnected()
    }
  }, [])

  // GNOME status (symlink, schema, stale extension).
  useEffect(() => {
    const off = window.api.onGnomeStatus((data) => {
      console.log('[Renderer] gnome:status →', data)
      setGnomeWarnings(data.warnings ?? [])
    })
    return () => off()
  }, [])

  // Avatar: show the cache immediately and refresh in the background.
  // - Typing: 2s debounce when there is no cache; immediate when cached.
  // - Blur (nonce): force an immediate refresh.
  // - Status changes (connecting/connected/error) do NOT trigger this effect,
  //   because `status` is no longer a dependency.
  useEffect(() => {
    const clean = channel.trim().toLowerCase()
    const isForced = avatarLookupNonce !== prevNonceRef.current
    prevNonceRef.current = avatarLookupNonce

    // Empty input: clear everything.
    if (!clean) {
      setAvatarUrl(null)
      setAvatarLoading(false)
      return
    }

    // 1) Show cached data immediately, without flicker.
    const cached = getCachedAvatar(clean)
    if (cached !== undefined) {
      setAvatarUrl(cached)
      setAvatarLoading(false)
    } else {
      setAvatarLoading(true)
    }

    // 2) Refresh in the background. Use no delay if data is already visible or
    //    this came from blur; wait 2s only while typing with a cold cache.
    const delay = cached !== undefined || isForced ? 0 : 2000

    const timer = setTimeout(async () => {
      const fresh = await window.api.getStreamerAvatar(clean)
      setAvatarUrl(fresh)
      setAvatarLoading(false)
      setCachedAvatar(clean, fresh)
    }, delay)

    return () => clearTimeout(timer)
  }, [channel, avatarLookupNonce])

  const handleAction = () => {
    if (status !== 'idle') {
      window.api.disconnectChannel()
      setStatus('idle')
      setErrorMsg(null)
      return
    }

    const cleanChannel = channel.trim().toLowerCase()
    if (!cleanChannel) return

    disconnectRequestedRef.current = false
    setErrorMsg(null)
    setStatus('connecting')
    window.api.setChannel(cleanChannel)
  }

  const handleTwitchLogin = async (
    enableInteractiveChatAfterLogin = false
  ): Promise<TwitchAuthStatus | null> => {
    setAuthBusy(true)
    try {
      if (signInNoticeTimeoutRef.current) clearTimeout(signInNoticeTimeoutRef.current)
      signInNoticeTimeoutRef.current = null
      setSignInNotice('')
      const nextStatus = await window.api.loginToTwitch()
      updateAuthStatus(nextStatus)
      if (enableInteractiveChatAfterLogin && nextStatus.canSendChat) {
        setPreferences((current) =>
          current ? { ...current, interactiveChatEnabled: true } : current
        )
      }
      return nextStatus
    } catch (err) {
      if (/cancelled/i.test(String(err))) {
        showSignInCancelledNotice()
      } else {
        updateAuthStatus({
          authenticated: false,
          canSendChat: false,
          username: null,
          avatarUrl: null,
          deviceAuthorization: null,
          error: String(err)
        })
      }
      return null
    } finally {
      setAuthBusy(false)
    }
  }

  const handleTwitchLogout = async (): Promise<void> => {
    setAuthBusy(true)
    try {
      updateAuthStatus(await window.api.logoutFromTwitch())
      setPreferences((current) =>
        current ? { ...current, interactiveChatEnabled: false } : current
      )
      setStatus('idle')
    } catch (err) {
      updateAuthStatus({
        authenticated: false,
        canSendChat: false,
        username: null,
        avatarUrl: null,
        deviceAuthorization: null,
        error: String(err)
      })
    } finally {
      setAuthBusy(false)
    }
  }

  const handleTwitchLoginCancel = async (): Promise<void> => {
    try {
      await window.api.cancelTwitchLogin()
      showSignInCancelledNotice()
    } catch (err) {
      setAuthStatus((current) => ({
        ...current,
        error: String(err)
      }))
    }
  }

  const enableInteractiveChat = async (): Promise<void> => {
    if (authStatus.canSendChat) {
      setPreferences((current) =>
        current ? { ...current, interactiveChatEnabled: true } : current
      )
    }
  }

  const isConnected = status === 'connected' || status === 'connecting'
  const btnColor = isConnected ? '#ff9f1c' : '#9146FF'
  const btnHoverColor = isConnected ? '#e88900' : '#772ce8'

  const initial = channel.trim() ? channel.trim()[0].toUpperCase() : '?'
  const inputDisabled = status !== 'idle' && status !== 'error'

  return (
    <div
      className={`app-shell${showSettings ? ' settings-open' : ''}`}
      style={{
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
        color: '#e0e0e0',
        background: '#18181b',
        boxSizing: 'border-box'
      }}
    >
      <style>{`
        .action-btn {
          transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s ease;
        }
        .action-btn:active { transform: scale(0.94); }
        .action-btn:hover { background-color: ${btnHoverColor} !important; }

        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin-anim { animation: spin 1s linear infinite; }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.6; }
          50%      { opacity: 1; }
        }
        .avatar-loading {
          animation: pulse 1.2s ease-in-out infinite;
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '0.5rem' }}>
        <img
          src={twitchLogo}
          alt="Twitch Logo"
          style={{ width: '32px', height: '32px', objectFit: 'contain' }}
        />
        <h1 style={{ color: '#bf94ff', margin: 0, flex: 1 }}>StreamShell</h1>
        <button
          type="button"
          onClick={() => setShowSettings((visible) => !visible)}
          aria-label={showSettings ? t('settings.back') : t('settings.open')}
          aria-pressed={showSettings}
          title={showSettings ? t('settings.back') : t('settings.open')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.5rem 0.65rem',
            borderRadius: '6px',
            border: '1px solid #3f3f46',
            background: showSettings ? '#3f3f46' : '#26262c',
            color: '#e0e0e0',
            cursor: 'pointer'
          }}
        >
          <SettingsIcon />
          <span>{showSettings ? t('settings.back') : t('settings.open')}</span>
        </button>
      </div>
      <p style={{ color: '#adadb8', marginTop: 0 }}>{t('panel.subtitle')}</p>

      {!showSettings && authStatusLoaded && !authStatus.authenticated && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.5rem 1rem',
            padding: '0.65rem 0.75rem',
            borderLeft: '3px solid #ff9f1c',
            borderRadius: '4px',
            background: '#26262c',
            color: '#ffb454',
            fontSize: '0.9rem',
            width: '100%',
            maxWidth: '720px',
            marginTop: '0.75rem'
          }}
        >
          <span style={{ flex: '1 1 240px' }}>{t('panel.signInUnlockFeatures')}</span>
          <button
            type="button"
            onClick={() => {
              setShowSettings(true)
              void handleTwitchLogin()
            }}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#ffb454',
              cursor: 'pointer',
              font: 'inherit',
              fontWeight: 600,
              textDecoration: 'underline',
              whiteSpace: 'nowrap'
            }}
          >
            {t('settings.signIn')}
          </button>
        </div>
      )}

      {showSettings ? (
        <SettingsPanel
          preferences={preferences}
          preferencesError={preferencesError}
          connected={isConnected}
          authStatus={authStatus}
          authBusy={authBusy}
          signInNotice={signInNotice}
          onLogin={(enableInteractiveChatAfterLogin) =>
            void handleTwitchLogin(enableInteractiveChatAfterLogin)
          }
          onCancelLogin={() => void handleTwitchLoginCancel()}
          onLogout={() => void handleTwitchLogout()}
          onEnableInteractiveChat={() => void enableInteractiveChat()}
          onChange={(update) =>
            setPreferences((current) => (current ? { ...current, ...update } : current))
          }
        />
      ) : (
        <>
          {gnomeWarnings.length > 0 && !warningsDismissed && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1rem',
                borderLeft: '4px solid #f59e0b',
                background: '#26262c',
                borderRadius: '4px',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                width: '350px',
                maxWidth: '100%',
                animation: 'fadeIn 0.3s ease-in-out'
              }}
            >
              <div style={{ flex: 1 }}>
                <strong style={{ color: '#f59e0b' }}>{t('gnome.warningTitle')}</strong>
                {gnomeWarnings.map((w, i) => (
                  <div key={i} style={{ marginTop: '4px', color: '#e0e0e0' }}>
                    {t(`gnome.warn.${w.key}`, w.params)}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setWarningsDismissed(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#a1a1aa',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  padding: 0,
                  lineHeight: 1
                }}
                aria-label={t('gnome.dismiss')}
              >
                ✕
              </button>
            </div>
          )}

          <div
            style={{
              marginTop: '2.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              width: '350px',
              maxWidth: '100%'
            }}
          >
            <label htmlFor="channel" style={{ fontWeight: '600' }}>
              {t('panel.channelLabel')}
            </label>

            <div style={{ display: 'flex', alignItems: 'stretch', gap: '10px' }}>
              <div
                aria-hidden="true"
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  background: '#0e0e10',
                  border: `2px solid ${avatarUrl ? '#9146FF' : '#3f3f46'}`,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'border-color 0.2s ease'
                }}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span
                    className={avatarLoading ? 'avatar-loading' : ''}
                    style={{
                      color: channel.trim() ? '#bf94ff' : '#52525b',
                      fontSize: '1.15rem',
                      fontWeight: 'bold',
                      userSelect: 'none'
                    }}
                  >
                    {initial}
                  </span>
                )}
              </div>

              <input
                id="channel"
                type="text"
                placeholder={t('panel.channelPlaceholder')}
                value={channel}
                disabled={inputDisabled}
                onChange={(e) => setChannel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAction()}
                onBlur={() => setAvatarLookupNonce((n) => n + 1)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '0.75rem',
                  borderRadius: '6px',
                  border: '2px solid #3f3f46',
                  background: inputDisabled ? '#27272a' : '#0e0e10',
                  color: inputDisabled ? '#a1a1aa' : '#fff',
                  fontSize: '1rem',
                  outline: 'none',
                  transition: 'all 0.2s ease'
                }}
              />
            </div>

            <button
              className="action-btn"
              onClick={handleAction}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '0.75rem',
                borderRadius: '6px',
                border: 'none',
                background: btnColor,
                color: 'white',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '1rem',
                marginTop: '0.5rem',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
              }}
            >
              {status === 'idle' && t('panel.connect')}
              {status === 'error' && t('panel.retry')}
              {status === 'connecting' && (
                <>
                  <LoadingIcon />
                  {t('panel.connecting')}
                </>
              )}
              {status === 'connected' && (
                <>
                  <CancelIcon />
                  {t('panel.cancel')}
                </>
              )}
            </button>
          </div>

          {status === 'connected' && (
            <div
              style={{
                marginTop: '2rem',
                padding: '1rem',
                borderLeft: '4px solid #00ff7f',
                background: '#26262c',
                borderRadius: '4px',
                animation: 'fadeIn 0.3s ease-in-out'
              }}
            >
              {t('panel.status.connected')} <strong style={{ color: '#00ff7f' }}>{channel}</strong>
            </div>
          )}

          {status === 'error' && (
            <div
              style={{
                marginTop: '2rem',
                padding: '1rem',
                borderLeft: '4px solid #ef4444',
                background: '#26262c',
                borderRadius: '4px',
                animation: 'fadeIn 0.3s ease-in-out'
              }}
            >
              {t('panel.status.error')} <strong style={{ color: '#ef4444' }}>{errorMsg}</strong>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default App
