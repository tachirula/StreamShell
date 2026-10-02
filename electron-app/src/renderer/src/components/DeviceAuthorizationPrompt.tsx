import { useState, type ReactElement } from 'react'
import { t } from '../i18n'

const CopyIcon = (): ReactElement => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d="M20.829 12.861c.171-.413.171-.938.171-1.986s0-1.573-.171-1.986a2.25 2.25 0 0 0-1.218-1.218c-.413-.171-.938-.171-1.986-.171H11.1c-1.26 0-1.89 0-2.371.245a2.25 2.25 0 0 0-.984.984C7.5 9.209 7.5 9.839 7.5 11.1v6.525c0 1.048 0 1.573.171 1.986c.229.551.667.99 1.218 1.218c.413.171.938.171 1.986.171s1.573 0 1.986-.171m7.968-7.968a2.25 2.25 0 0 1-1.218 1.218c-.413.171-.938.171-1.986.171s-1.573 0-1.986.171a2.25 2.25 0 0 0-1.218 1.218c-.171.413-.171.938-.171 1.986s0 1.573-.171 1.986a2.25 2.25 0 0 1-1.218 1.218m7.968-7.968a11.68 11.68 0 0 1-7.75 7.9l-.218.068M16.5 7.5v-.9c0-1.26 0-1.89-.245-2.371a2.25 2.25 0 0 0-.983-.984C14.79 3 14.16 3 12.9 3H6.6c-1.26 0-1.89 0-2.371.245a2.25 2.25 0 0 0-.984.984C3 4.709 3 5.339 3 6.6v6.3c0 1.26 0 1.89.245 2.371c.216.424.56.768.984.984c.48.245 1.111.245 2.372.245H7.5" />
  </svg>
)

export function DeviceAuthorizationPrompt({
  authorization,
  onCancel
}: {
  authorization: { userCode: string; verificationUri: string }
  onCancel: () => void
}): ReactElement {
  const [copyError, setCopyError] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(authorization.userCode)
      setCopied(true)
      setCopyError(false)
    } catch (error) {
      console.error('[StreamShell] Could not copy Twitch activation code:', error)
      setCopyError(true)
      setCopied(false)
    }
  }

  return (
    <section
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '0.65rem',
        margin: '1rem 0',
        padding: '1rem',
        border: '1px solid #5b3b87',
        borderRadius: '8px',
        background: '#211a2b',
        color: '#fff'
      }}
    >
      <span>
        {t('settings.deviceCodeInstructionsBefore')}{' '}
        <a
          href={authorization.verificationUri}
          target="_blank"
          rel="noreferrer"
          style={{ color: '#bf94ff', textDecoration: 'underline' }}
        >
          twitch.tv/activate
        </a>{' '}
        {t('settings.deviceCodeInstructionsAfter')}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <code
          style={{
            padding: '0.45rem 0.7rem',
            borderRadius: '6px',
            background: '#27272a',
            color: '#fff',
            fontSize: '1.15rem',
            fontWeight: 700,
            letterSpacing: '0.08em'
          }}
        >
          {authorization.userCode}
        </code>
        <button
          type="button"
          onClick={() => void copyCode()}
          aria-label={t('settings.copyActivationCode')}
          title={t('settings.copyActivationCode')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2.3rem',
            height: '2.3rem',
            border: '1px solid #52525b',
            borderRadius: '6px',
            background: '#3f3f46',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          <CopyIcon />
        </button>
      </div>
      {(copied || copyError) && (
        <span
          role={copyError ? 'alert' : 'status'}
          style={{ color: copyError ? '#ff9f1c' : '#fff', fontSize: '0.85rem' }}
        >
          {t(copyError ? 'settings.copyActivationCodeError' : 'settings.activationCodeCopied')}
        </span>
      )}
      <button
        type="button"
        onClick={onCancel}
        style={{
          padding: '0.5rem 0.75rem',
          border: '1px solid #52525b',
          borderRadius: '6px',
          background: '#3f3f46',
          color: '#fff',
          cursor: 'pointer'
        }}
      >
        {t('settings.cancelSignIn')}
      </button>
    </section>
  )
}
