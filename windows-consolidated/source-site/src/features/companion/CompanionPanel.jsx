import { useEffect, useState } from 'react'
import { buildCompanionContext, buildCompanionPrompt } from './companion-context.js'
import './companion.css'

const CODEX_URL = 'https://chatgpt.com/codex'
const CHATGPT_URL = 'https://chatgpt.com/'

export function CompanionPanel({ isOpen, onClose, projects, tasks }) {
  const [bridgeReady, setBridgeReady] = useState(false)
  const [request, setRequest] = useState('')
  const [feedback, setFeedback] = useState('')
  const [copied, setCopied] = useState(false)
  const [sessionEvents, setSessionEvents] = useState([])

  useEffect(() => {
    if (!isOpen) return undefined
    const syncBridgeStatus = () => setBridgeReady(Boolean(window.DaymarkAI?.version))
    const handleSession = (event) => {
      const session = event.detail?.session
      if (!session) return
      setSessionEvents((current) => [...current, session].slice(-4))
    }
    syncBridgeStatus()
    window.addEventListener('daymark:agent-ready', syncBridgeStatus)
    window.addEventListener('daymark:agent-state', syncBridgeStatus)
    window.addEventListener('daymark:agent-session', handleSession)
    return () => {
      window.removeEventListener('daymark:agent-ready', syncBridgeStatus)
      window.removeEventListener('daymark:agent-state', syncBridgeStatus)
      window.removeEventListener('daymark:agent-session', handleSession)
    }
  }, [isOpen])

  if (!isOpen) return null

  const copyContext = async () => {
    const context = buildCompanionContext({
      bridgeVersion: window.DaymarkAI?.version ?? 2,
      projects,
      tasks,
    })
    try {
      await navigator.clipboard.writeText(context)
      setCopied(true)
      setFeedback('Workspace context copied.')
    } catch {
      setCopied(false)
      setFeedback('Clipboard access is unavailable.')
    }
  }

  const readWorkspace = () => {
    const state = window.DaymarkAI?.getState?.()
    if (!state) {
      setFeedback('DaymarkAI is not connected.')
      return
    }
    const active = Object.values(state.tasks ?? {}).filter((task) => !task.completedAt).length
    setFeedback(`Live read: ${Object.keys(state.projects ?? {}).length} projects, ${active} active tasks.`)
  }

  const copyHandoff = async (destination) => {
    const context = buildCompanionPrompt({
      bridgeVersion: window.DaymarkAI?.version ?? 2,
      projects,
      request,
      tasks,
    })
    try {
      await navigator.clipboard.writeText(context)
      setFeedback(`${destination} opened. Your request and live workspace context are ready to paste.`)
    } catch {
      setFeedback(`${destination} opened. Clipboard access is unavailable, so copy the workspace context manually.`)
    }
  }

  return (
    <div className="companion-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="companion-title" aria-modal="true" className="companion-panel" role="dialog">
        <header className="companion-panel__header">
          <div>
            <span className="section-kicker">ASSISTANT ACCESS</span>
            <h2 id="companion-title">Codex companion</h2>
          </div>
          <button aria-label="Close Codex companion" className="icon-button" onClick={onClose} title="Close" type="button">×</button>
        </header>

        <div className={`companion-status ${bridgeReady ? 'is-connected' : ''}`}>
          <span aria-hidden="true" className="companion-status__dot" />
          <span>{bridgeReady ? `DaymarkAI v${window.DaymarkAI.version} connected` : 'DaymarkAI bridge unavailable'}</span>
        </div>

        <div className="companion-actions">
          <button className="primary-button" onClick={readWorkspace} type="button">Read workspace</button>
          <button className="secondary-button" onClick={copyContext} type="button">{copied ? 'Copied' : 'Copy workspace context'}</button>
          <a className="primary-button companion-link" href={CHATGPT_URL} onClick={() => copyHandoff('ChatGPT')} rel="noopener" target="_blank">Open ChatGPT chat / voice</a>
          <a className="secondary-button companion-link" href={CODEX_URL} onClick={() => copyHandoff('Codex')} rel="noopener" target="_blank">Open Codex control</a>
        </div>

        <label className="companion-transcript">
          <span>Live request to the signed-in companion</span>
          <textarea
            aria-label="Companion request"
            onChange={(event) => setRequest(event.target.value)}
            placeholder="Tell ChatGPT what to do in Daymark, then open the signed-in chat or voice session."
            rows={3}
            value={request}
          />
        </label>

        <div className="companion-session">
          <div className="companion-session__heading">
            <span>Bridge activity</span>
            <strong>{sessionEvents.length ? `${sessionEvents.length} recent` : 'Waiting for ChatGPT'}</strong>
          </div>
          {sessionEvents.length ? sessionEvents.map((session) => (
            <div className="companion-session__event" key={session.id}>
              <span>{session.name}</span>
              <small>{session.status} · {session.results?.length ?? 0} actions</small>
            </div>
          )) : (
            <p>ChatGPT or Codex can use the connected DaymarkAI bridge to read, navigate, and update this workspace.</p>
          )}
        </div>

        <div className="companion-facts">
          <div><strong>{projects.length}</strong><span>projects</span></div>
          <div><strong>{tasks.filter((task) => !task.completed).length}</strong><span>active tasks</span></div>
          <div><strong>{tasks.filter((task) => task.completed).length}</strong><span>completed</span></div>
        </div>

        {feedback ? <p aria-live="polite" className="companion-feedback" role="status">{feedback}</p> : null}

        <footer className="companion-panel__footer">
          <span>Your signed-in ChatGPT subscription is the conversation and voice engine; DaymarkAI is the live app control channel.</span>
          <button className="text-button" onClick={onClose} type="button">Done</button>
        </footer>
      </section>
    </div>
  )
}
