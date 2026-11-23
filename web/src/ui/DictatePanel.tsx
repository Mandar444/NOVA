// "Write on page": say a question or equation, check the words and the maths preview, then Insert.
// The maths comes from NOVA's own rules; BharatCode is asked only when words were not understood, and the student
// confirms whatever is proposed. Nothing is solved here.

import { useEffect, useMemo, useRef, useState } from 'react'
import { uuid } from '../notebook/ids'
import { ApiFailure, api } from '../tutor/api'
import { useVoice } from '../voice/session'
import { interpretSpokenMath, prettyMath, type Choices } from '../voice/spokenMath'
import { Icon } from './icons'
import { VoiceControls } from './VoiceControls'

interface Props {
  docked: boolean
  startWithMic: boolean
  onInsert: (text: string, display: string, transcript: string) => void
  onClose: () => void
}

export function DictatePanel({ docked, startWithMic, onInsert, onClose }: Props) {
  const [voice, session] = useVoice('dictate')
  const [choices, setChoices] = useState<Choices>({})
  const [model, setModel] = useState<{ for: string; text: string } | null>(null) // BharatCode's proposal for this transcript
  const [asking, setAsking] = useState(false)
  const [modelNote, setModelNote] = useState<string | null>(null)
  const [manual, setManual] = useState<string | null>(null) // the maths, edited by hand
  const ctl = useRef<AbortController | null>(null)
  const capturing = voice.status === 'listening' || voice.status === 'transcribing'

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    if (startWithMic) t = setTimeout(() => void session.start())
    return () => {
      clearTimeout(t)
      ctl.current?.abort()
      session.release() // closing keeps the words
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const transcript = voice.draft.trim()
  // new words: earlier answers to questions and earlier proposals no longer apply
  useEffect(() => { setChoices({}); setManual(null); setModelNote(null) }, [transcript])
  const rules = useMemo(() => interpretSpokenMath(transcript, choices), [transcript, choices])
  const proposal = model && model.for === transcript ? model.text : null
  const text = manual ?? (rules.complete ? rules.text : proposal ?? '')
  const display = manual !== null ? prettyMath(manual) : rules.complete ? rules.display : proposal ? prettyMath(proposal) : ''
  const needsModel = !!transcript && !rules.complete && !rules.clarify && !proposal && manual === null

  const askNova = async () => {
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    setAsking(true)
    setModelNote(null)
    try {
      const r = await api.interpretMath({ requestId: uuid(), transcript, attempt: rules.text }, c.signal)
      if (r.question) setModelNote(r.question + (r.options.length ? ` (${r.options.join(' · ')})` : ''))
      else setModel({ for: transcript, text: r.text })
    } catch (e) {
      if (!(e instanceof ApiFailure && e.code === 'CANCELLED')) setModelNote(e instanceof ApiFailure ? e.message : 'NOVA could not interpret that. Edit the words or type the maths.')
    } finally {
      if (ctl.current === c) setAsking(false)
    }
  }

  const insert = () => {
    if (!text || capturing) return
    const said = session.consume()
    onInsert(text, display || prettyMath(text), said)
    setManual(null)
    setModel(null)
  }

  return (
    <aside className={docked ? 'ask-panel dictate-panel' : 'ask-panel sheet-mode dictate-panel'} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Write on page by voice" data-testid="dictate-panel">
      {!docked && <span className="sheet-grip" aria-hidden="true" />}
      <header className="ask-head">
        <span className="ask-badge" aria-hidden="true"><Icon.mic /></span>
        <span className="ask-heading">
          <b className="ask-title">Write on page</b>
          <span className="ask-about">Say a question or equation. It goes on the page as your work — NOVA doesn't solve it.</span>
        </span>
        <button className="ask-close" aria-label="Close Write on page" onClick={onClose}><Icon.close /></button>
      </header>
      <div className="dictate-body">
        <label className="dictate-label" htmlFor="dictate-words">What you said</label>
        <textarea
          id="dictate-words"
          data-testid="dictate-words"
          className={capturing ? 'hearing' : undefined}
          value={voice.interim ? `${voice.draft} ${voice.interim}`.trim() : voice.draft}
          readOnly={capturing}
          rows={3}
          maxLength={600}
          placeholder="e.g. integral of x squared from zero to two"
          onChange={(e) => session.setDraft(e.target.value)}
        />
        <VoiceControls state={voice} session={session} sendHint="then Insert" />
        {transcript && !capturing && (
          <div className="dictate-preview" data-testid="dictate-preview">
            {rules.clarify && manual === null ? (
              <div className="dictate-q" data-testid="dictate-question">
                <span>{rules.clarify.question}</span>
                {rules.clarify.options.map((o) => (
                  <button key={o.value} className="vb-btn" onClick={() => setChoices({ ...choices, [rules.clarify!.id]: o.value })}>{o.label}</button>
                ))}
              </div>
            ) : null}
            {display && <div className="dictate-math" data-testid="dictate-math" aria-label={`Will be written as ${display}`}>{display}</div>}
            {needsModel && (
              <div className="dictate-q">
                <span>Not all words were understood{rules.unknown.length ? ` (“${rules.unknown.slice(0, 3).join('”, “')}”)` : ''}.</span>
                <button className="vb-btn" data-testid="dictate-ask-nova" disabled={asking} onClick={() => void askNova()}>{asking ? 'Asking NOVA…' : 'Let NOVA interpret'}</button>
              </div>
            )}
            {proposal && manual === null && !rules.complete && <div className="voice-note">NOVA's interpretation — check it before inserting.</div>}
            {modelNote && <div className="voice-error">{modelNote}</div>}
            <label className="dictate-label" htmlFor="dictate-maths">Maths to insert (you can edit it)</label>
            <input id="dictate-maths" data-testid="dictate-maths" className="dictate-input" value={text} placeholder="type the maths if needed" onChange={(e) => setManual(e.target.value)} />
          </div>
        )}
      </div>
      <div className="dictate-actions">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn primary" data-testid="dictate-insert" disabled={!text.trim() || capturing} onClick={insert}>Insert on page</button>
      </div>
    </aside>
  )
}
