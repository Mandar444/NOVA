// The one place NOVA's state is shown: ready, working (with seconds and Stop), error (plain words, Retry), notice.
import { useEffect, useState } from 'react'
import type { TutorStatus } from '../tutor/useNova'
import { Icon } from './icons'

/** Provider and transport errors in words a student understands; no codes, no provider names. */
export function plainMessage(msg: string | undefined): string {
  const m = (msg ?? '').replace(/\s*\(provider request [^)]*\)/i, '').trim()
  if (/could not reach|cannot reach|remoteprotocol|connecterror|network|failed to fetch/i.test(m)) return "Couldn't reach NOVA. Check your internet and try again."
  if (/busy|quota|rate limit/i.test(m)) return 'NOVA is busy with lots of students. Try again in a moment.'
  if (/took too long|timeout|timed out/i.test(m)) return 'NOVA took too long, so it stopped. Your work is safe.'
  if (/^server error|http_5\d\d|server error \d+/i.test(m)) return 'Something went wrong on our side. Try again.'
  return m.replace(/BharatCode/g, 'NOVA')
}

interface Props {
  status: TutorStatus
  onStop: () => void
  onDismiss: () => void
  onIdleClick?: () => void
  compact?: boolean // phone: lives inside the top capsule
}

export function StatusPill({ status, onStop, onDismiss, onIdleClick, compact }: Props) {
  const working = status.state === 'working'
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!working) return
    const t0 = Date.now()
    setStartedAt(t0)
    setNow(t0)
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [working])
  const secs = working && startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0

  if (status.state === 'idle') {
    if (compact) return null
    return (
      <button data-testid="nova-status" className="ob-pill idle" onClick={onIdleClick} aria-label="NOVA ready. Show NOVA history">
        <span className="ob-dot ok" aria-hidden="true" />
        NOVA ready
      </button>
    )
  }
  if (working) {
    return (
      <div data-testid="nova-status" className={`ob-pill working ${compact ? 'compact' : ''}`} role="status" aria-live="polite">
        <span className="ob-pill-mark" aria-hidden="true"><Icon.ask /></span>
        <span className="ob-pill-body">
          <span className="ob-pill-text">{status.message || 'Working…'}</span>
          {!compact && <span className="ob-pill-track" aria-hidden="true"><span /></span>}
        </span>
        {secs >= 2 && <span className="ob-pill-secs">{secs} s</span>}
        <button className="ob-pill-stop" onClick={onStop} aria-label="Stop NOVA"><Icon.stop />{!compact && 'Stop'}</button>
      </div>
    )
  }
  const text = status.state === 'error' ? plainMessage(status.message) : status.message
  return (
    <div data-testid="nova-status" className={`ob-pill ${status.state} ${compact ? 'compact' : ''}`} role="status" aria-live="polite">
      <span className={`ob-dot ${status.state === 'error' ? 'bad' : 'warn'}`} aria-hidden="true" />
      <span className="ob-pill-text">{text}</span>
      {status.retry && <button className="ob-pill-action" onClick={status.retry}>Retry</button>}
      <button className="ob-pill-x" aria-label="Dismiss" onClick={onDismiss}><Icon.close /></button>
    </div>
  )
}
