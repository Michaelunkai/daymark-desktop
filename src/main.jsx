import { Component, StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installSmoothWheelScrolling } from './core/smooth-wheel'
import { ThemeProvider } from './styles/theme'
import './components/ui/ui.css'
import './styles/theme.css'
import './styles/app-shell.css'

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    try {
      window.DaymarkAndroid?.onAppError?.()
    } catch {
      // The Android shell is optional.
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main
        role="alert"
        style={{
          alignItems: 'center',
          background: '#000',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          justifyContent: 'center',
          minHeight: 'var(--daymark-viewport-height)',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <p>Daymark needs to restart.</p>
        <button onClick={() => window.location.reload()} type="button">Reload Daymark</button>
      </main>
    )
  }
}

function AndroidReadyApp() {
  useEffect(() => {
    try {
      document.getElementById('root')?.setAttribute('data-daymark-ready', 'true')
      window.DaymarkAndroid?.onAppReady?.()
    } catch {
      // The Android shell is optional.
    }
  }, [])

  return <App />
}

async function pairCanonicalWorkspace() {
  const explicitSync = new URLSearchParams(window.location.search).get('sync')
  if (explicitSync) return
  if (document.cookie.split(';').some((entry) => entry.trim() === 'daymark.canonical-workspace=1')) return
  try {
    await fetch('/api/sync/pair-canonical', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
  } catch {
    // Existing pairing storage remains available while offline.
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider defaultPreference="dark">
      <AppErrorBoundary>
        <AndroidReadyApp />
      </AppErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
)

pairCanonicalWorkspace()

const removeSmoothWheelScrolling = installSmoothWheelScrolling()
if (import.meta.hot) {
  import.meta.hot.dispose(removeSmoothWheelScrolling)
}
