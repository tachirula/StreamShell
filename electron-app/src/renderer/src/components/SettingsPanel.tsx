import { useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react'
import { t } from '../i18n'
import { clearAvatarCache } from '../avatar-cache'
import { DeviceAuthorizationPrompt } from './DeviceAuthorizationPrompt'
import { DownloadConcurrencyStepper } from './DownloadConcurrencyStepper'
import type { Preferences, TwitchAuthStatus } from './types'

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
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(-1)
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

export function SettingsPanel({
  preferences,
  preferencesError,
  onChange,
  connected,
  authStatus,
  authBusy,
  signInNotice,
  onLogin,
  onCancelLogin,
  onLogout,
  onEnableInteractiveChat
}: {
  preferences: Preferences | null
  preferencesError: string | null
  onChange: (update: Partial<Preferences>) => void
  connected: boolean
  authStatus: TwitchAuthStatus
  authBusy: boolean
  signInNotice: string
  onLogin: (enableInteractiveChatAfterLogin?: boolean) => void
  onCancelLogin: () => void
  onLogout: () => void
  onEnableInteractiveChat: () => void
}): ReactElement {
  const [cacheBusy, setCacheBusy] = useState(false)
  const [cacheMessage, setCacheMessage] = useState('')
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [shortcutHint, setShortcutHint] = useState('')
  const [showSignInView, setShowSignInView] = useState(false)
  const [signInRequiresChatEdit, setSignInRequiresChatEdit] = useState(false)
  const inSignInView = showSignInView || authStatus.deviceAuthorization !== null

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
  const rangeProgressStyle = (value: number, min: number, max: number): CSSProperties =>
    ({ '--range-progress': `${((value - min) / (max - min)) * 100}%` }) as CSSProperties

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
      className="settings-panel-scrollbar"
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
      {inSignInView ? (
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.9rem',
            padding: '1rem',
            border: '1px solid #3f3f46',
            borderRadius: '8px',
            background: '#202024'
          }}
        >
          <h3 style={{ color: '#bf94ff', margin: 0 }}>{t('settings.twitchAccount')}</h3>
          {authStatus.authenticated ? (
            <p style={{ color: '#fff', margin: 0 }}>
              {t('settings.signedInAs')} {authStatus.username}
            </p>
          ) : (
            <p style={{ color: '#fff', margin: 0 }}>{t('settings.notSignedIn')}</p>
          )}
          {authStatus.error && (
            <p role="alert" style={{ color: '#ff9f1c', margin: 0 }}>
              {authStatus.error}
            </p>
          )}
          {signInNotice && (
            <p role="status" style={{ color: '#fff', margin: 0 }}>
              {signInNotice}
            </p>
          )}
          {authStatus.deviceAuthorization ? (
            <DeviceAuthorizationPrompt
              authorization={authStatus.deviceAuthorization}
              onCancel={onCancelLogin}
            />
          ) : (
            <>
              <p style={{ color: '#a1a1aa', margin: 0 }}>
                {signInRequiresChatEdit
                  ? t(
                      authStatus.authenticated
                        ? 'settings.chatEditGrantExplanation'
                        : 'settings.chatEditSignInExplanation'
                    )
                  : t('settings.optionalSignInExplanation')}
              </p>
              {!authStatus.authenticated || (signInRequiresChatEdit && !authStatus.canSendChat) ? (
                <button
                  type="button"
                  onClick={() => onLogin(signInRequiresChatEdit)}
                  disabled={authBusy}
                  style={{
                    padding: '0.65rem',
                    border: '1px solid #52525b',
                    borderRadius: '6px',
                    background: authBusy ? '#27272a' : '#9146ff',
                    color: '#fff',
                    cursor: authBusy ? 'wait' : 'pointer'
                  }}
                >
                  {authBusy ? t('panel.connecting') : t('settings.generateActivationCode')}
                </button>
              ) : null}
            </>
          )}
          <button
            type="button"
            onClick={() => setShowSignInView(false)}
            disabled={authStatus.deviceAuthorization !== null}
            style={{
              padding: '0.65rem',
              border: '1px solid #52525b',
              borderRadius: '6px',
              background: authStatus.deviceAuthorization ? '#27272a' : '#3f3f46',
              color: authStatus.deviceAuthorization ? '#71717a' : '#fff',
              cursor: authStatus.deviceAuthorization ? 'not-allowed' : 'pointer'
            }}
          >
            {t('settings.backToSettings')}
          </button>
        </section>
      ) : preferencesError ? (
        <p role="alert" style={{ color: '#ff9f1c' }}>
          {preferencesError}
        </p>
      ) : null}
      {inSignInView ? null : !preferences ? (
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
              {t('settings.twitchAccount')}
            </legend>
            {authStatus.authenticated ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.7rem',
                  minHeight: '40px',
                  color: '#fff'
                }}
              >
                {authStatus.avatarUrl ? (
                  <img
                    src={authStatus.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '2px solid #9146ff'
                    }}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    style={{
                      width: '40px',
                      height: '40px',
                      flex: '0 0 40px',
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: '50%',
                      background: '#3f3f46',
                      color: '#fff',
                      fontWeight: 700
                    }}
                  >
                    {authStatus.username?.[0]?.toUpperCase() ?? '?'}
                  </span>
                )}
                <span style={{ color: '#fff' }}>
                  {t('settings.signedInAs')} {authStatus.username}
                </span>
              </div>
            ) : (
              <p style={{ color: '#fff' }}>{t('settings.notSignedIn')}</p>
            )}
            {authStatus.error && (
              <p role="alert" style={{ color: '#ff9f1c', fontSize: '0.85rem' }}>
                {authStatus.error}
              </p>
            )}
            {!authStatus.deviceAuthorization && (
              <button
                type="button"
                onClick={() => {
                  if (authStatus.authenticated) onLogout()
                  else {
                    setSignInRequiresChatEdit(false)
                    setShowSignInView(true)
                  }
                }}
                disabled={authBusy}
                style={{
                  padding: '0.65rem',
                  border: '1px solid #52525b',
                  borderRadius: '6px',
                  background: authBusy ? '#27272a' : '#9146ff',
                  color: '#fff',
                  cursor: authBusy ? 'wait' : 'pointer'
                }}
              >
                {authBusy
                  ? t('panel.connecting')
                  : authStatus.authenticated
                    ? t('settings.signOut')
                    : t('settings.signIn')}
              </button>
            )}
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
              {t('settings.overlayInteraction')}
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
                checked={preferences.disableClickThrough}
                onChange={(event) =>
                  onChange({
                    disableClickThrough: event.target.checked,
                    ...(event.target.checked
                      ? {}
                      : { interactiveChatEnabled: false, clickableProfilesEnabled: false })
                  })
                }
                style={{ marginTop: '0.3rem', accentColor: '#9146ff' }}
              />
              <span>{t('settings.disableClickThrough')}</span>
            </label>
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
              {t('settings.disableClickThroughHelp')}
            </p>
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
              {t('settings.interactiveChat')}
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
                checked={preferences.interactiveChatEnabled}
                disabled={!preferences.disableClickThrough}
                onChange={(event) => {
                  if (event.target.checked && authStatus.canSendChat) onEnableInteractiveChat()
                  else if (event.target.checked) {
                    setSignInRequiresChatEdit(true)
                    setShowSignInView(true)
                  } else {
                    onChange({ interactiveChatEnabled: false })
                  }
                }}
                style={{
                  marginTop: '0.3rem',
                  accentColor: '#9146ff',
                  cursor: preferences.disableClickThrough ? 'pointer' : 'not-allowed'
                }}
              />
              <span>{t('settings.enableInteractiveChat')}</span>
            </label>
            {!preferences.disableClickThrough && (
              <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
                {t('settings.clickThroughRequired')}
              </p>
            )}
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
              {t('settings.interactiveChatHelp')}
            </p>
            {authStatus.authenticated && !authStatus.canSendChat && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <p style={{ color: '#ff9f1c', fontSize: '0.85rem', margin: 0 }}>
                  {t('settings.chatEditRequired')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSignInRequiresChatEdit(true)
                    setShowSignInView(true)
                  }}
                  style={{
                    alignSelf: 'flex-start',
                    padding: '0.5rem 0.65rem',
                    border: '1px solid #5b3b87',
                    borderRadius: '6px',
                    background: '#2b2138',
                    color: '#d8b4fe',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  {t('settings.grantChatEdit')}
                </button>
              </div>
            )}
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
              {t('settings.userProfiles')}
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
                checked={preferences.clickableProfilesEnabled}
                disabled={!preferences.disableClickThrough}
                onChange={(event) => onChange({ clickableProfilesEnabled: event.target.checked })}
                style={{
                  marginTop: '0.3rem',
                  accentColor: '#9146ff',
                  cursor: preferences.disableClickThrough ? 'pointer' : 'not-allowed'
                }}
              />
              <span>{t('settings.enableClickableProfiles')}</span>
            </label>
            {!preferences.disableClickThrough && (
              <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
                {t('settings.clickThroughRequired')}
              </p>
            )}
            <label
              style={{
                ...fieldStyle,
                opacity:
                  preferences.disableClickThrough && preferences.clickableProfilesEnabled ? 1 : 0.55
              }}
            >
              <span>
                {t('settings.profileMessageLimit')}: {preferences.profileMessageLimit}
              </span>
              <input
                type="range"
                min="1"
                max="500"
                step="1"
                value={preferences.profileMessageLimit}
                disabled={!preferences.disableClickThrough || !preferences.clickableProfilesEnabled}
                onChange={(event) => onChange({ profileMessageLimit: Number(event.target.value) })}
                className="settings-range"
                style={rangeProgressStyle(preferences.profileMessageLimit, 1, 500)}
              />
            </label>
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
              {t('settings.userProfilesHelp')}
            </p>
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
                className="settings-range"
                style={rangeProgressStyle(preferences.chatWidth, 280, 600)}
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
                className="settings-range"
                style={rangeProgressStyle(preferences.maxVisibleMessages, 3, 20)}
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
              gap: '1rem'
            }}
          >
            <legend style={{ padding: '0 0.4rem', color: '#bf94ff' }}>
              {t('settings.chatBackground')}
            </legend>
            <label style={fieldStyle}>
              <span>
                {t('settings.backgroundOpacity')}: {preferences.backgroundOpacity}%
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={preferences.backgroundOpacity}
                onChange={(event) => onChange({ backgroundOpacity: Number(event.target.value) })}
                className="settings-range"
                style={rangeProgressStyle(preferences.backgroundOpacity, 0, 100)}
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
              {t('settings.downloads')}
            </legend>
            <div style={fieldStyle}>
              <label htmlFor="max-concurrent-image-downloads">
                {t('settings.concurrentDownloads')}
              </label>
              <DownloadConcurrencyStepper
                value={preferences.maxConcurrentImageDownloads}
                inputLabel={t('settings.concurrentDownloads')}
                decreaseLabel={t('settings.decreaseDownloads')}
                increaseLabel={t('settings.increaseDownloads')}
                onChange={(value) => onChange({ maxConcurrentImageDownloads: value })}
              />
            </div>
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
              {t('settings.concurrentDownloadsHelp')}
            </p>
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
              {t('settings.backendWaylandNote')}
            </p>
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
              {t('settings.emoteQuality')}
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
                checked={preferences.animatedEmotesEnabled}
                onChange={(event) => onChange({ animatedEmotesEnabled: event.target.checked })}
                style={{ marginTop: '0.3rem', accentColor: '#9146ff' }}
              />
              <span>{t('settings.animatedEmotesEnabled')}</span>
            </label>
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
              {t('settings.animatedEmotesHelp')}
            </p>
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
                checked={preferences.thirdPartyEmotesEnabled}
                onChange={(event) => onChange({ thirdPartyEmotesEnabled: event.target.checked })}
                style={{ marginTop: '0.3rem', accentColor: '#9146ff' }}
              />
              <span>{t('settings.thirdPartyEmotesEnabled')}</span>
            </label>
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
              {t('settings.thirdPartyEmotesHelp')}
            </p>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
                cursor: preferences.thirdPartyEmotesEnabled ? 'pointer' : 'not-allowed',
                opacity: preferences.thirdPartyEmotesEnabled ? 1 : 0.55
              }}
            >
              <input
                type="checkbox"
                checked={preferences.emoteBestQuality}
                disabled={!preferences.thirdPartyEmotesEnabled}
                onChange={(event) => onChange({ emoteBestQuality: event.target.checked })}
                style={{ marginTop: '0.3rem', accentColor: '#9146ff' }}
              />
              <span>{t('settings.emoteBestQuality')}</span>
            </label>
            <label
              style={{
                ...fieldStyle,
                opacity:
                  !preferences.thirdPartyEmotesEnabled || preferences.emoteBestQuality ? 0.55 : 1
              }}
            >
              <span>{t('settings.emoteImageScale')}</span>
              <select
                value={preferences.emoteImageScale}
                disabled={!preferences.thirdPartyEmotesEnabled || preferences.emoteBestQuality}
                onChange={(event) => {
                  const scale = event.currentTarget.value
                  if (scale === '1x' || scale === '3x' || scale === '4x') {
                    onChange({ emoteImageScale: scale })
                  }
                }}
                style={{
                  padding: '0.55rem',
                  border: '1px solid #52525b',
                  borderRadius: '6px',
                  background: '#27272a',
                  color: '#fff'
                }}
              >
                <option value="1x">x1</option>
                <option value="3x">x3</option>
                <option value="4x">x4</option>
              </select>
            </label>
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>
              {t('settings.emoteQualityCacheHint')}
            </p>
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
                className="settings-range"
                style={rangeProgressStyle(preferences.historyLimit, 5, 100)}
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
                  color: cacheMessage.startsWith(t('settings.cacheError')) ? '#ff9f1c' : '#fff'
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
