import { useState, useEffect, useRef, type ReactElement } from 'react'
import twitchLogo from './assets/twitch-logo.png'
import { t } from './i18n'
import { getCachedAvatar, setCachedAvatar } from './avatar-cache'

// --- SVGs Integrados ---
const LoadingIcon = () => (
  <svg className="spin-anim" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)

const CancelIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
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

  const prevNonceRef = useRef(0)

  // Suscripción a los eventos REALES del backend
  useEffect(() => {
    const offConnected = window.api.onTwitchConnected(({ channel: ch }) => {
      console.log('[Renderer] twitch:connected →', ch)
      setErrorMsg(null)
      setStatus('connected')
    })
    const offError = window.api.onTwitchError(({ message }) => {
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

  // Estado de GNOME (symlink, schema, extensión stale)
  useEffect(() => {
    const off = window.api.onGnomeStatus((data) => {
      console.log('[Renderer] gnome:status →', data)
      setGnomeWarnings(data.warnings ?? [])
    })
    return () => off()
  }, [])

  // Avatar: muestra caché al instante, refresca en background.
  // - Typing: 2s de debounce si no hay caché; instantáneo si la hay.
  // - Blur (nonce): forzar refresh inmediato.
  // - Cambios de status (connecting/connected/error) NO disparan el efecto,
  //   porque `status` ya no está en las dependencias.
  useEffect(() => {
    const clean = channel.trim().toLowerCase()
    const isForced = avatarLookupNonce !== prevNonceRef.current
    prevNonceRef.current = avatarLookupNonce

    // Input vacío → limpiamos todo.
    if (!clean) {
      setAvatarUrl(null)
      setAvatarLoading(false)
      return
    }

    // 1) Mostrar caché ya, sin flicker.
    const cached = getCachedAvatar(clean)
    if (cached !== undefined) {
      setAvatarUrl(cached)
      setAvatarLoading(false)
    } else {
      setAvatarLoading(true)
    }

    // 2) Refresh en background. Delay 0 si ya hay algo en pantalla o si
    //    viene de un blur; 2s solo cuando el usuario está tecleando en frío.
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

    setErrorMsg(null)
    setStatus('connecting')
    window.api.setChannel(cleanChannel)
  }

  const isConnected = status === 'connected' || status === 'connecting'
  const btnColor = isConnected ? '#ef4444' : '#9146FF'
  const btnHoverColor = isConnected ? '#dc2626' : '#772ce8'

  const initial = channel.trim() ? channel.trim()[0].toUpperCase() : '?'
  const inputDisabled = status !== 'idle' && status !== 'error'

  return (
    <div
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
        <img src={twitchLogo} alt="Twitch Logo" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
        <h1 style={{ color: '#bf94ff', margin: 0 }}>StreamShell</h1>
      </div>
      <p style={{ color: '#adadb8', marginTop: 0 }}>{t('panel.subtitle')}</p>

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

      <div style={{ marginTop: '2.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', width: '350px', maxWidth: '100%' }}>
        <label htmlFor="channel" style={{ fontWeight: '600' }}>{t('panel.channelLabel')}</label>

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
    </div>
  )
}

export default App