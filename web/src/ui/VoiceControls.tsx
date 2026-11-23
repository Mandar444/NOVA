// The microphone strip shared by "Ask NOVA" and "Write on page": one clear state at a time, explicit actions only.

import { useEffect, useState } from 'react'
import type { VoiceSession, VoiceState } from '../voice/session'
import { Icon } from './icons'

export function VoiceControls({ state, session, sendHint }: { state: VoiceState; session: VoiceSession; sendHint: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (state.status !== 'listening') return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [state.status])
  const secs = state.startedAt ? Math.max(0, Math.round((now - state.startedAt) / 1000)) : 0
  const has = !!state.draft.trim()
  const engine = state.engine === 'local' ? "NOVA's offline speech" : state.engine === 'browser' ? "the browser's speech" : ''
  return (
    <div className={`voice-bar ${state.status}`} data-testid="voice-bar" data-status={state.status}>
      {state.status === 'listening' && (
        <>
          <span className="rec-dot" aria-hidden="true" />
          <span className="voice-level" aria-hidden="true"><i style={{ width: `${Math.round(state.level * 100)}%` }} /></span>
          <span className="voice-note">Listening · {secs} s — pause whenever you like</span>
          <button className="vb-btn" data-testid="voice-pause" onClick={() => session.pause()}>Pause</button>
          <button className="vb-btn strong" data-testid="voice-stop" onClick={() => session.stop()}><Icon.stop /> Stop</button>
          <button className="link" data-testid="voice-cancel" title="Discard only what you said since you pressed the mic" onClick={() => session.cancel()}>Cancel</button>
        </>
      )}
      {state.status === 'transcribing' && (
        <>
          <span className="voice-note">Turning your speech into text{state.pending > 1 ? ` (${state.pending} parts)` : ''}…</span>
          <button className="link" data-testid="voice-cancel" onClick={() => session.cancel()}>Cancel</button>
        </>
      )}
      {(state.status === 'idle' || state.status === 'ready' || state.status === 'paused' || state.status === 'error') && (
        <>
          <button className="vb-btn mic" data-testid="voice-mic" aria-label={has ? 'Continue speaking (adds to the text)' : 'Speak'} onClick={() => void session.start()}>
            <Icon.mic /> {state.status === 'paused' ? 'Resume' : has ? 'Speak more' : 'Speak'}
          </button>
          {has && <button className="link" data-testid="voice-clear" onClick={() => session.clear()}>Clear</button>}
          {state.status === 'paused' && <span className="voice-note">Paused — your words are kept.</span>}
          {state.status === 'ready' && has && state.spoken && <span className="voice-note">Check the words (fix any by typing), {sendHint}.</span>}
          {state.failed > 0 && <button className="vb-btn" data-testid="voice-retry" onClick={() => void session.retry()}>Retry transcription</button>}
        </>
      )}
      {state.error && <div className="voice-error" role="alert" data-testid="voice-error">{state.error}</div>}
      {engine && state.status === 'listening' && <span className="voice-engine">via {engine}</span>}
    </div>
  )
}
