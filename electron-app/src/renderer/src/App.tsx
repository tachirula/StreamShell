import { useState, useEffect, useRef, type ReactElement } from 'react'
import twitchLogo from './assets/twitch-logo.png'
import { t } from './i18n'
import { clearAvatarCache, getCachedAvatar, setCachedAvatar } from './avatar-cache'

// --- SVGs Integrados ---
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

interface Preferences {
  chatWidth: number
  maxVisibleMessages: number
  historyEnabled: boolean
  historyLimit: number
}

interface GnomeWarningView {
  key: string
  params?: Record<string, string>
}

function acceleratorKey(event: KeyboardEvent<HTMLElement>): string | null {
  const namedKeys: Record<string, string> = {
    Backspace: 'BackSpace',
    CapsLock: 'Caps_Lock',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Return',
    Home: 'Home',
    Insert: 'Insert',
    PageDown: 'Page_Down',
    PageUp: 'Page_Up',
    PrintScreen: 'Print',
    ScrollLock: 'Scroll_Lock',
    Space: 'space',
    Tab: 'Tab',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up'
  }
  if (namedKeys[event.key]) return namedKeys[event.key]
  if (/^F([1-9]|1[0-2])$/.test(event.key)) return event.key
  if (/^[a-zA-Z0-9]$/.test(event.key)) return event.key.toLowerCase()

  const codeKeys: Record<string, string> = {
    Minus: 'minus',
    Equal: 'equal',
    BracketLeft: 'bracketleft',
    BracketRight: 'bracketright',
    Backslash: 'backslash',
    Semicolon: 'semicolon',
    Quote: 'apostrophe',
    Backquote: 'grave',
    Comma: 'comma',
    Period: 'period',
    Slash: 'slash',
    NumpadAdd: 'KP_Add',
    NumpadSubtract: 'KP_Subtract',
    NumpadMultiply: 'KP_Multiply',
    NumpadDivide: 'KP_Divide',
    NumpadDecimal: 'KP_Decimal',
    NumpadEnter: 'KP_Enter'
  }
  return codeKeys[event.code] ?? null
}

function formatAccelerator(accelerator: string): string {
  return accelerator
    .replaceAll('<Control>', 'Ctrl')
    .replaceAll('<Shift>', 'Shift')
    .replaceAll('<Alt>', 'Alt')
    .replaceAll('<Mod5>', 'AltGr')
}

function formatShortcut(shortcut: string): string {
  const modifiers: string[] = []
  const key = shortcut.replace(/<(Control|Shift|Alt|Mod5)>/g, (modifier) => {
    modifiers.push(formatAccelerator(modifier))
    return ''
  })
  const keyLabels: Record<string, string> = {
    BackSpace: 'Backspace',
    Caps_Lock: 'Caps Lock',
    Page_Down: 'Page Down',
    Page_Up: 'Page Up',
    Print: 'Print Screen',
    Scroll_Lock: 'Scroll Lock',
    space: 'Space'
  }
  const keyLabel = keyLabels[key] ?? (/^[a-z]$/.test(key) ? key.toUpperCase() : key)
  return [...modifiers, keyLabel].join(' + ')
}

function SettingsPanel({
  preferences,
  preferencesError,
  onChange,
  connected
}: {
  preferences: Preferences | null
  preferencesError: string | null
  onChange: (update: Partial<Preferences>) => void
  connected: boolean
}): ReactElement {
  const [cacheBusy, setCacheBusy] = useState(false)
  const [cacheMessage, setCacheMessage] = useState('')
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [shortcutHint, setShortcutHint] = useState('')

  const clearCache = async (): Promise<void> => {
    setCacheBusy(true)
    setCacheMessage('')
    try {
      await window.api.clearCache()
      clearAvatarCache()
      setCacheMessage(t('settings.cacheCleared'))
    } catch (err) {
      setCacheMessage(`${t('settings.cacheError')} ${String(err)}`)
    } finally {
      setCacheBusy(false)
    }
  }

  const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: '0.4rem' }
  const rangeStyle = { width: '100%', accentColor: '#bf94ff', cursor: 'pointer' }

  const onShortcutKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (!recordingShortcut) return
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      setRecordingShortcut(false)
      setShortcutHint('')
      return
    }
    if (event.key === 'Meta' || event.metaKey) {
      setShortcutHint(t('settings.shortcutSuperReserved'))
      return
    }

    const altGraph = event.getModifierState('AltGraph')
    const modifiers: string[] = []
    if (!altGraph && event.ctrlKey) modifiers.push('<Control>')
    if (!altGraph && event.altKey) modifiers.push('<Alt>')
    if (altGraph) modifiers.push('<Mod5>')
    if (event.shiftKey) modifiers.push('<Shift>')

    if (['Control', 'Shift', 'Alt', 'AltGraph'].includes(event.key)) {
      setShortcutHint(
        `${t('settings.shortcutRecording')} ${modifiers.map(formatAccelerator).join(' + ')}`
      )
      return
    }

    const key = acceleratorKey(event)
    if (!key) {
      setShortcutHint(t('settings.shortcutUnsupportedKey'))
      return
    }
    if (modifiers.length === 0) {
      setShortcutHint(t('settings.shortcutNeedsModifier'))
      return
    }

    onChange({ toggleChatShortcut: `${modifiers.join('')}${key}` })
    setRecordingShortcut(false)
    setShortcutHint('')
  }

  return (
    <section
      onKeyDownCapture={onShortcutKeyDown}
      style={{
        width: '350px',
        maxWidth: '100%',
        maxHeight: 'calc(100vh - 150px)',
        overflowY: 'auto',
        paddingRight: '0.5rem',
        marginTop: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem'
      }}
    >
      <h2 style={{ fontSize: '1.2rem', color: '#e0e0e0' }}>{t('settings.title')}</h2>
      {preferencesError && (
        <p role="alert" style={{ color: '#fca5a5' }}>
          {preferencesError}
        </p>
      )}
      {!preferences ? (
        <p style={{ color: '#adadb8' }}>
          {preferencesError
            ? `${t('settings.loadError')} ${preferencesError}`
            : t('panel.connecting')}
        </p>
      ) : (
        <>
          <fieldset
            style={{
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}
          >
            <legend style={{ padding: '0 0.4rem', color: '#bf94ff' }}>
              {t('settings.chatShortcut')}
            </legend>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => {
                  setRecordingShortcut((recording) => !recording)
                  setShortcutHint('')
                }}
                style={{
                  flex: 1,
                  padding: '0.65rem',
                  border: '1px solid #52525b',
                  borderRadius: '6px',
                  background: recordingShortcut ? '#5b21b6' : '#3f3f46',
                  color: '#fff',
                  cursor: 'pointer'
                }}
              >
                {recordingShortcut
                  ? t('settings.shortcutRecording')
                  : preferences.toggleChatShortcut
                    ? formatShortcut(preferences.toggleChatShortcut)
                    : t('settings.shortcutNotSet')}
              </button>
              {preferences.toggleChatShortcut && (
                <button
                  type="button"
                  onClick={() => onChange({ toggleChatShortcut: '' })}
                  style={{
                    padding: '0.65rem',
                    border: '1px solid #52525b',
                    borderRadius: '6px',
                    background: '#3f3f46',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  {t('settings.shortcutClear')}
                </button>
              )}
            </div>
            {(recordingShortcut || shortcutHint) && (
              <p role="status" style={{ color: '#c4b5fd', fontSize: '0.85rem' }}>
                {shortcutHint || t('settings.shortcutInstruction')}
              </p>
            )}
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>{t('settings.shortcutWayland')}</p>
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
              {t('settings.shortcutHardwareNote')}
            </p>
          </fieldset>

          <fieldset
            style={{
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}
          >
            <legend style={{ padding: '0 0.4rem', color: '#bf94ff' }}>
              {t('settings.chatSize')}
            </legend>
            <label style={fieldStyle}>
              <span>
                {t('settings.chatWidth')}: {preferences.chatWidth} px
              </span>
              <input
                type="range"
                min="280"
                max="600"
                step="20"
                value={preferences.chatWidth}
                onChange={(event) => onChange({ chatWidth: Number(event.target.value) })}
                style={rangeStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span>
                {t('settings.visibleBeforeScroll')}: {preferences.maxVisibleMessages}
              </span>
              <input
                type="range"
                min="3"
                max="20"
                step="1"
                value={preferences.maxVisibleMessages}
                onChange={(event) => onChange({ maxVisibleMessages: Number(event.target.value) })}
                style={rangeStyle}
              />
            </label>
          </fieldset>

          <fieldset
            style={{
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}
          >
            <legend style={{ padding: '0 0.4rem', color: '#bf94ff' }}>
              {t('settings.history')}
            </legend>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
                cursor: 'pointer'
              }}
            >
              <input
                type="checkbox"
                checked={preferences.historyEnabled}
                onChange={(event) => onChange({ historyEnabled: event.target.checked })}
                style={{ marginTop: '0.3rem', accentColor: '#9146ff' }}
              />
              <span>{t('settings.historyEnabled')}</span>
            </label>
            <label style={{ ...fieldStyle, opacity: preferences.historyEnabled ? 1 : 0.55 }}>
              <span>
                {t('settings.historyLimit')}: {preferences.historyLimit}
              </span>
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                value={preferences.historyLimit}
                disabled={!preferences.historyEnabled}
                onChange={(event) => onChange({ historyLimit: Number(event.target.value) })}
                style={rangeStyle}
              />
            </label>
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>{t('settings.historyRisk')}</p>
          </fieldset>

          <fieldset
            style={{
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}
          >
            <legend style={{ padding: '0 0.4rem', color: '#bf94ff' }}>{t('settings.cache')}</legend>
            <button
              type="button"
              onClick={clearCache}
              disabled={connected || cacheBusy}
              style={{
                padding: '0.65rem',
                border: '1px solid #52525b',
                borderRadius: '6px',
                background: connected || cacheBusy ? '#27272a' : '#3f3f46',
                color: '#fff',
                cursor: connected || cacheBusy ? 'not-allowed' : 'pointer'
              }}
            >
              {cacheBusy ? t('panel.connecting') : t('settings.clearCache')}
            </button>
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
              {connected ? t('settings.cacheStreaming') : t('settings.cacheRecommendation')}
            </p>
            {cacheMessage && (
              <p
                role="status"
                style={{
                  color: cacheMessage.startsWith(t('settings.cacheError')) ? '#fca5a5' : '#86efac'
                }}
              >
                {cacheMessage}
              </p>
            )}
          </fieldset>
        </>
      )}
    </section>
  )
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

  const prevNonceRef = useRef(0)

  useEffect(() => {
    window.api
      .getPreferences()
      .then(setPreferences)
      .catch((err: unknown) => setPreferencesError(String(err)))
  }, [])

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

      {showSettings ? (
        <SettingsPanel
          preferences={preferences}
          preferencesError={preferencesError}
          connected={isConnected}
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
