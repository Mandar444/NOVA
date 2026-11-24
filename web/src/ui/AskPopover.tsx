// Ask NOVA: a docked conversation beside the page. Stays open while you write, keeps the thread,
// and lets you reply to NOVA. Push-to-talk fills the reply box with an editable transcript.

import { useEffect, useRef, useState } from 'react'
import type { Turn } from '../notebook/types'
import type { Intent, TutorStatus } from '../tutor/useNova'
import { useVoice } from '../voice/session'
import { setVoiceReplies, speak, stopSpeaking, useSpeakState, voiceRepliesOn } from '../voice/speech'
import { Icon } from './icons'
import { plainMessage } from './StatusPill'
import { VoiceControls } from './VoiceControls'

interface Props {
  docked: boolean // false = phone bottom sheet
  startWithMic: boolean
  initialText?: string // a question ready to send (from "Try this")
  turns: Turn[]
  status: TutorStatus
  about: string | null // text of the selected line, or null for the whole page
  onClearAbout: () => void
  onSend: (intent: Intent, question: string, opts?: { voice?: boolean }) => void
  onClose: () => void
  offsetRight?: number // keep clear of a panel on the right (the test panel)
  onStop?: () => void // stop the answer NOVA is working on
  onShow?: (regionId: string) => void // bring the line a reply is about into view
}

// the three kinds of help, always separate (plus a check of the line)
const QUICK_LINE: { label: string; intent: Intent; q: string; tone: string }[] = [
  { label: 'Hint', intent: 'hint', q: '', tone: 'hint' },
  { label: 'Next step', intent: 'complete', q: '', tone: '' },
  { label: 'Explain', intent: 'explain', q: 'Explain why.', tone: 'explain' },
  { label: 'Full solution', intent: 'ask', q: 'Show me the full worked solution.', tone: 'solution' },
  { label: 'Check', intent: 'check', q: '', tone: '' },
]
const QUICK_PAGE: string[] = ['Add a trigonometry table', 'Write the algebraic identities', 'Explain what I did on this page', 'Give me a similar question to practise']
// no line selected: the same three kinds of help, about the problem on the page
const HELP_PAGE: { label: string; q: string; tone: string }[] = [
  { label: 'Hint', q: 'Give me a hint for this, not the answer.', tone: 'hint' },
  { label: 'Explain', q: 'Explain the idea behind this.', tone: 'explain' },
  { label: 'Full solution', q: 'Show me the full worked solution.', tone: 'solution' },
]

export function AskPanel({ docked, startWithMic, initialText, turns, status, about, onClearAbout, onSend, onClose, offsetRight, onStop, onShow }: Props) {
  // the draft belongs to the voice session, not to this panel: closing the panel keeps it (typed or spoken)
  const [voice, session] = useVoice('ask')
  const speech = useSpeakState()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (initialText) {
      const d = session.get().draft.trim()
      session.setDraft(d ? `${d} ${initialText}` : initialText) // "Try this": an explicit action, appended
    }
    let micTimer: ReturnType<typeof setTimeout> | undefined
    if (startWithMic) micTimer = setTimeout(() => void session.start()) // appends to any draft; after StrictMode's trial mount
    else inputRef.current?.focus()
    return () => {
      clearTimeout(micTimer)
      session.release() // closing the panel: the microphone stops, the words stay
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const listening = voice.status === 'listening' || voice.status === 'transcribing'
  // keep the newest words in view while they are being written
  useEffect(() => {
    const t = inputRef.current
    if (t && listening) t.scrollTop = t.scrollHeight
  }, [voice.draft, voice.interim, listening])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, status.state])

  // the question just sent: shown at once; if the request fails, it goes back into the box (never lost)
  const [sent, setSent] = useState<{ text: string; turns: number; restored: boolean } | null>(null)
  const sending = useRef(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  // reads the LIVE session (never a value captured by an older render), so a send after an await sees the truth
  const send = (intent: Intent, q: string, spokenOverride?: boolean) => {
    const live = session.get()
    if (live.status === 'listening' || live.status === 'transcribing' || sending.current) return // words still arriving / already sending
    sending.current = true
    const own = q.trim() === live.draft.trim()
    const spoken = spokenOverride ?? (own && live.spoken)
    stopSpeaking()
    if (own) session.consume()
    if (q.trim()) setSent({ text: q.trim(), turns: turns.length, restored: false })
    onSend(intent, q, { voice: spoken })
    setTimeout(() => (sending.current = false), 400)
  }
  /** Done & Ask: finish the capture, wait (bounded) for the final words, then send exactly once.
   *  An operation token makes a second click, Cancel, a new capture or closing the panel void this send. */
  const doneOp = useRef<{ token: number; capture: number } | null>(null)
  const opSeq = useRef(0)
  const [finishing, setFinishing] = useState(false)
  const doneAndAsk = async () => {
    if (doneOp.current) return // already finishing: a second click does nothing
    const op = { token: ++opSeq.current, capture: session.captureId }
    doneOp.current = op
    setFinishing(true)
    try {
      const final = await session.finishAndWait(15_000)
      const still = alive.current && doneOp.current === op && session.captureId === op.capture
      if (still && final && final === session.get().draft.trim()) send('ask', final, true) // voice provenance kept
    } finally {
      if (doneOp.current === op) doneOp.current = null
      if (alive.current) setFinishing(false)
    }
  }
  useEffect(() => () => { doneOp.current = null }, []) // closing the panel voids a pending Done & Ask
  useEffect(() => {
    if (!sent) return
    if (turns.length > sent.turns) return setSent(null) // the reply (and the question) are in the thread now
    if (status.state === 'error' && !sent.restored) {
      if (!session.get().draft.trim()) session.setDraft(sent.text) // failed: the question is back in the box for Retry/Send
      setSent({ ...sent, restored: true })
    }
  }, [turns.length, status.state, sent, session])
  const text = voice.draft
  const repliesOn = voiceRepliesOn()

  const busy = status.state === 'working'
  const shown = turns.slice(-24)
  const boxText = voice.interim ? `${text} ${voice.interim}`.trim() : text
  return (
    <aside className={docked ? 'ask-panel' : 'ask-panel sheet-mode'} style={docked && offsetRight ? { right: offsetRight } : undefined} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Ask NOVA">
      {!docked && <span className="sheet-grip" aria-hidden="true" />}
      <header className="ask-head">
        <span className="ask-badge" aria-hidden="true"><img src="/nova-icon.png" alt="" /></span>
        <span className="ask-heading">
          <b className="ask-title">Ask NOVA</b>
          <span className="ask-about">
            {about ? (
              <>About <b>{about}</b> <button className="link" aria-label="Ask about the whole page instead" onClick={onClearAbout}>Whole page</button></>
            ) : (
              'About the whole page'
            )}
          </span>
        </span>
        <button className={`ask-close voice-toggle ${repliesOn ? 'on' : ''}`} aria-pressed={repliesOn} data-testid="voice-replies" aria-label={repliesOn ? 'Spoken replies on (tap to mute)' : 'Spoken replies muted (tap to turn on)'} title={repliesOn ? 'NOVA reads replies aloud when you ask by voice' : 'Spoken replies are muted'} onClick={() => setVoiceReplies(!repliesOn)}>{repliesOn ? '🔊' : '🔇'}</button>
        <button className="ask-close" aria-label="Close Ask NOVA" onClick={onClose}><Icon.close /></button>
      </header>
      <div className="thread" ref={threadRef}>
        {shown.length === 0 && !busy && (
          <div className="thread-empty">
            <p>Ask anything — about a line you select, or about maths in general. NOVA can also write tables and formulas onto your page.</p>
            <div className="thread-try">
              {QUICK_PAGE.map((q) => <button key={q} onClick={() => send('ask', q)}>{q}</button>)}
            </div>
          </div>
        )}
        {shown.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            <span className="bubble-text">{t.text}</span>
            {t.detail && (
              <details className="bubble-more">
                <summary>Explain more</summary>
                <div>{t.detail}</div>
              </details>
            )}
            {t.role === 'tutor' && (
              <span className="bubble-actions">
                {t.problemId && onShow && <button onClick={() => onShow(t.problemId!)}>Show on page</button>}
                {speech.key === `turn:${t.at}` && (speech.status === 'speaking' || speech.status === 'loading')
                  ? <button data-testid="speak-stop" onClick={() => stopSpeaking()}>■ Stop</button>
                  : <button data-testid="speak-play" onClick={() => void speak(t.text, `turn:${t.at}`)}>{speech.key === `turn:${t.at}` ? '▶ Play' : '▶ Replay'}</button>}
                <button onClick={() => void navigator.clipboard?.writeText(t.detail ? `${t.text}\n\n${t.detail}` : t.text).catch(() => undefined)}>Copy</button>
              </span>
            )}
            {t.role === 'tutor' && speech.key === `turn:${t.at}` && speech.message && <div className="speak-msg" data-testid="speak-msg" role="status">{speech.message}</div>}
          </div>
        ))}
        {sent && !sent.restored && <div className="bubble student pending" data-testid="sent-pending">{sent.text}</div>}
        {busy && (
          <div className="bubble tutor thinking" aria-label="NOVA is answering">
            <span className="skel" /><span className="skel" /><span className="skel short" />
            <span className="thinking-note">{status.message || 'Working…'} Keep writing, the answer appears beside your work.</span>
            {onStop && <button className="ask-stop" aria-label="Stop NOVA" onClick={onStop}><Icon.stop /> Stop</button>}
          </div>
        )}
        {status.state === 'error' && (
          <div className="bubble tutor error">
            {plainMessage(status.message)} {status.retry && <button className="link strong" onClick={status.retry}>Retry</button>}
          </div>
        )}
        {status.state === 'notice' && status.message && <div className="bubble tutor notice">{status.message}</div>}
      </div>
      <div className="chips">
        {about
          ? QUICK_LINE.map((q) => <button key={q.label} className={`chip ${q.tone}`} onClick={() => send(q.intent, q.q)}>{q.label}</button>)
          : HELP_PAGE.map((h) => <button key={h.label} className={`chip ${h.tone}`} onClick={() => send('ask', h.q)}>{h.label}</button>)}
      </div>
      <div className="ask-row">
        <textarea
          ref={inputRef}
          className={listening ? 'hearing' : undefined}
          value={boxText}
          readOnly={listening}
          aria-live={listening ? 'polite' : undefined}
          maxLength={1200}
          rows={boxText.length > 60 ? 3 : 2}
          data-testid="ask-input"
          placeholder={voice.status === 'listening' ? 'Listening… pause whenever you like, your words stay here' : turns.length ? 'Reply to NOVA…' : 'Ask NOVA anything…'}
          onChange={(e) => session.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && text.trim() && !listening) {
              e.preventDefault()
              send('ask', text.trim())
            }
            if (e.key === 'Escape') onClose()
          }}
        />
        <button className="icon-btn send" aria-label="Send" disabled={!text.trim() || listening} onClick={() => send('ask', text.trim())}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button>
      </div>
      {(voice.status === 'listening' || finishing) && <div className="voice-done"><button className="vb-btn strong" data-testid="voice-done-ask" disabled={finishing} onClick={() => void doneAndAsk()}>{finishing ? 'Finishing…' : '✓ Done & Ask'}</button><span className="voice-note">{finishing ? 'sending when the last words are in' : 'or Stop to review first'}</span></div>}
      <VoiceControls state={voice} session={session} sendHint="then press Send — nothing is sent by itself" />
    </aside>
  )
}
