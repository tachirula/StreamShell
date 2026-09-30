import { useState, useEffect, type ReactElement } from 'react'
import twitchLogo from './assets/twitch-logo.png'

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

function App(): ReactElement {
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [gnomeWarnings, setGnomeWarnings] = useState<string[]>([])
  const [warningsDismissed, setWarningsDismissed] = useState(false)

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

  const handleAction = () => {
    // Cancelar / desconectar
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
    window.api.setChannel(cleanChannel)   // el paso a 'connected' lo decide el backend
  }

  const isConnected = status === 'connected' || status === 'connecting'
  const btnColor = isConnected ? '#ef4444' : '#9146FF'
  const btnHoverColor = isConnected ? '#dc2626' : '#772ce8'

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
        /* Animación de clic en el botón */
        .action-btn {
          transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s ease;
        }
        .action-btn:active {
          transform: scale(0.94);
        }
        .action-btn:hover {
          background-color: ${btnHoverColor} !important;
        }

        /* Animación de rotación para el SVG de carga */
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin-anim {
          animation: spin 1s linear infinite;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '0.5rem' }}>
        <img src={twitchLogo} alt="Twitch Logo" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
        <h1 style={{ color: '#bf94ff', margin: 0 }}>StreamShell</h1>
      </div>
      <p style={{ color: '#adadb8', marginTop: 0 }}>Panel de Control del Overlay</p>

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
            <strong style={{ color: '#f59e0b' }}>Aviso de GNOME Shell</strong>
            {gnomeWarnings.map((w, i) => (
              <div key={i} style={{ marginTop: '4px', color: '#e0e0e0' }}>{w}</div>
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
            aria-label="Cerrar aviso"
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ marginTop: '2.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', width: '350px', maxWidth: '100%' }}>
        <label htmlFor="channel" style={{ fontWeight: '600' }}>Canal de Twitch:</label>

        <input
          id="channel"
          type="text"
          placeholder="Ej: hashiruta"
          value={channel}
          disabled={status !== 'idle' && status !== 'error'}
          onChange={(e) => setChannel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAction()}
          style={{
            padding: '0.75rem',
            borderRadius: '6px',
            border: '2px solid #3f3f46',
            background: (status !== 'idle' && status !== 'error') ? '#27272a' : '#0e0e10',
            color: (status !== 'idle' && status !== 'error') ? '#a1a1aa' : '#fff',
            fontSize: '1rem',
            outline: 'none',
            transition: 'all 0.2s ease'
          }}
        />

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
          {status === 'idle' && 'Conectar al Chat'}
          {status === 'error' && 'Reintentar conexión'}
          {status === 'connecting' && (
            <>
              <LoadingIcon />
              Conectando...
            </>
          )}
          {status === 'connected' && (
            <>
              <CancelIcon />
              Cancelar conexión
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
          Estado: Recibiendo mensajes de <strong style={{ color: '#00ff7f' }}>{channel}</strong>
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
          Error al conectar: <strong style={{ color: '#ef4444' }}>{errorMsg}</strong>
        </div>
      )}
    </div>
  )
}

export default App