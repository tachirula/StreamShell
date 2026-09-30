import { useState, type ReactElement } from 'react'
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

function App(): ReactElement {
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected'>('idle')

  const handleAction = () => {
    if (status !== 'idle') {
      window.api.disconnectChannel()
      setStatus('idle')
      return
    }

    const cleanChannel = channel.trim().toLowerCase()
    if (!cleanChannel) return

    setStatus('connecting')

    setTimeout(() => {
      window.api.setChannel(cleanChannel)
      setStatus('connected')
    }, 1200)
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

      <div style={{ marginTop: '2.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', width: '350px', maxWidth: '100%' }}>
        <label htmlFor="channel" style={{ fontWeight: '600' }}>Canal de Twitch:</label>

        <input
          id="channel"
          type="text"
          placeholder="Ej: hashiruta"
          value={channel}
          disabled={status !== 'idle'}
          onChange={(e) => setChannel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAction()}
          style={{
            padding: '0.75rem',
            borderRadius: '6px',
            border: '2px solid #3f3f46',
            background: status !== 'idle' ? '#27272a' : '#0e0e10',
            color: status !== 'idle' ? '#a1a1aa' : '#fff',
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
    </div>
  )
}

export default App