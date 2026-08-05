import { useEffect, useRef, useState } from 'react'
import { buildCompanionContext } from './companion-context.js'
import './companion.css'

const CODEX_URL = 'https://chatgpt.com/codex'
const CHATGPT_URL = 'https://chatgpt.com/'

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function CompanionPanel({ isOpen, onClose, projects, tasks }) {
  const [bridgeReady, setBridgeReady] = useState(false)
  const [voiceActive, setVoiceActive] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [feedback, setFeedback] = useState('')
  const [copied, setCopied] = useState(false)
  const recognitionRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return undefined
    const syncBridgeStatus = () => setBridgeReady(Boolean(window.DaymarkAI?.version))
    syncBridgeStatus()
    window.addEventListener('daymark:agent-ready', syncBridgeStatus)
    window.addEventListener('daymark:agent-state', syncBridgeStatus)
    return () => {
      window.removeEventListener('daymark:agent-ready', syncBridgeStatus)
      window.removeEventListener('daymark:agent-state', syncBridgeStatus)
      recognitionRef.current?.stop?.()
      recognitionRef.current = null
      setVoiceActive(false)
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

  const toggleVoice = () => {
    if (voiceActive) {
      recognitionRef.current?.stop?.()
      return
    }
    const Recognition = getSpeechRecognition()
    if (!Recognition) {
      setFeedback('Voice capture is unavailable here. Open ChatGPT voice instead.')
      return
    }
    const recognition = new Recognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'
    recognition.onstart = () => {
      setFeedback('Listening...')
      setVoiceActive(true)
    }
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? '')
        .join(' ')
        .trim()
      if (text) setTranscript(text)
    }
    recognition.onerror = () => {
      setVoiceActive(false)
      setFeedback('Voice capture stopped.')
    }
    recognition.onend = () => {
      setVoiceActive(false)
      recognitionRef.current = null
    }
    recognitionRef.current = recognition
    recognition.start()
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
          <button className="secondary-button" onClick={toggleVoice} type="button">{voiceActive ? 'Stop voice capture' : 'Start voice capture'}</button>
          <a className="secondary-button companion-link" href={CODEX_URL} rel="noreferrer" target="_blank">Open Codex</a>
          <a className="secondary-button companion-link" href={CHATGPT_URL} rel="noreferrer" target="_blank">Open ChatGPT voice</a>
        </div>

        <label className="companion-transcript">
          <span>Voice transcript</span>
          <textarea aria-label="Voice transcript" onChange={(event) => setTranscript(event.target.value)} placeholder="Your captured request will appear here." rows={3} value={transcript} />
        </label>

        <div className="companion-facts">
          <div><strong>{projects.length}</strong><span>projects</span></div>
          <div><strong>{tasks.filter((task) => !task.completed).length}</strong><span>active tasks</span></div>
          <div><strong>{tasks.filter((task) => task.completed).length}</strong><span>completed</span></div>
        </div>

        {feedback ? <p aria-live="polite" className="companion-feedback" role="status">{feedback}</p> : null}

        <footer className="companion-panel__footer">
          <span>Connected Codex sessions use the live DaymarkAI bridge.</span>
          <button className="text-button" onClick={onClose} type="button">Done</button>
        </footer>
      </section>
    </div>
  )
}
