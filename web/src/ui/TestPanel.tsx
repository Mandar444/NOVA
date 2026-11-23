// The test sheet beside the paper (design board "Question paper + Test panel"): progress ring, questions, the open one
// with Hint / Explain / Full solution. During a test NOVA only gives hints; Explain and Full solution open after Finish.

import type { Page, PaperQuestion, PaperTest } from '../notebook/types'
import { answerRegions } from '../tutor/usePaper'
import { Icon } from './icons'

interface Props {
  test: PaperTest
  pages: Record<string, Page>
  busy: string | null
  current?: string | null
  onGoto: (q: PaperQuestion) => void
  onHelp: (q: PaperQuestion) => void
  onReview: (q: PaperQuestion) => void
  onFinish: () => void
  onRetry: () => void
  onClose: () => void
  onPracticeMore?: () => void
}

const Tick = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
)

export function TestPanel({ test, pages, busy, current, onGoto, onHelp, onReview, onFinish, onRetry, onPracticeMore }: Props) {
  const practice = test.kind === 'practice'
  const finished = test.status === 'finished'
  const answered = (q: PaperQuestion) => {
    const page = pages[q.pageId]
    return page ? answerRegions(page, test, q).length > 0 : false
  }
  const nAnswered = test.questions.filter(answered).length
  const total = test.questions.length
  const ringN = finished && test.score ? test.score.correct : nAnswered
  const ringD = finished && test.score ? test.score.total : total
  const pct = ringD ? Math.round((ringN / ringD) * 100) : 0
  const idx = test.questions.findIndex((q) => q.id === current)
  const next = test.questions.find((q, i) => i > idx && !answered(q)) ?? test.questions.find((q) => !answered(q))
  const ready = test.status === 'ready'
  return (
    <aside className="test-panel tq" aria-label="Test" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tq-head">
        <div className="tq-ring" style={{ background: `conic-gradient(var(--tq-ring) 0 ${pct}%, var(--tq-ring-off) ${pct}% 100%)` }}>
          <div>{ringN}/{ringD}</div>
        </div>
        <div className="tq-heading">
          <b>{test.title}</b>
          <span>{finished ? (practice ? 'Practice · marked' : 'Marked') : `${total} questions · ${nAnswered} answered`}</span>
        </div>
      </div>

      {(test.status === 'reading' || busy) && (
        <div className="tq-note" role="status">
          <span className="ob-pill-track tq-track" aria-hidden="true"><span /></span>
          {busy ?? `Reading page ${test.progress.done + 1} of ${test.progress.total}…`}
        </div>
      )}
      {test.error && (
        <div className="tq-note bad">
          {test.error}
          {!!test.failedPages?.length && test.status !== 'reading' && <button className="link strong" onClick={onRetry}>Retry</button>}
        </div>
      )}
      {!finished && test.readPageIds && test.readPageIds.length < test.pageIds.length && test.status !== 'reading' && (
        <div className="tq-note">NOVA reads each page's questions when you open that page.</div>
      )}

      <ol className="tq-list">
        {test.questions.map((q) => {
          const has = answered(q)
          const open = current === q.id
          const label = `Q${q.number.replace(/^Q/i, '')}`
          const mark = finished ? q.verdict ?? 'unanswered' : has ? 'done' : 'todo'
          const box = (
            <span className={`tq-box ${open && !finished ? 'cur' : mark}`} aria-hidden="true">
              {mark === 'done' || mark === 'correct' ? <Tick /> : mark === 'incorrect' ? '✗' : q.number.replace(/^Q/i, '')}
            </span>
          )
          if (!open) {
            return (
              <li key={q.id} className="tq-q q-row" data-page={q.pageId} data-bounds={`${q.bounds.x},${q.bounds.y},${q.bounds.w},${q.bounds.h}`}>
                <button className="tq-row" onClick={() => onGoto(q)} title="Show on the page">
                  {box}
                  <span className="tq-text"><b>{label}</b> · {q.text}</span>
                  {finished && q.verdict === 'incorrect' && <span className="tq-side bad">fix</span>}
                </button>
              </li>
            )
          }
          return (
            <li key={q.id} className="tq-q q-row open" data-page={q.pageId} data-bounds={`${q.bounds.x},${q.bounds.y},${q.bounds.w},${q.bounds.h}`}>
              <button className="tq-row" onClick={() => onGoto(q)} title="Show on the page">
                {box}
                <span className="tq-text full"><b>{label}</b> · {q.text}</span>
              </button>
              {finished && (
                <div className="tq-verdict">
                  <span className={q.verdict}>{q.verdict === 'correct' ? 'Correct' : q.verdict === 'incorrect' ? 'Not right yet' : 'Not answered'}</span>
                  {q.verdict !== 'correct' && <span>Answer: <b>{q.answer}</b></span>}
                </div>
              )}
              <div className="tq-help">
                <button className="hint" aria-label={`Hint for ${label}`} disabled={!ready || finished} onClick={() => onHelp(q)}>Hint</button>
                <button className="explain" aria-label={`Explain ${label}`} disabled={!finished} title={finished ? undefined : 'Opens after you finish'} onClick={() => onReview(q)}>Explain</button>
                <button className="solution" aria-label={`Full solution for ${label}`} disabled={!finished} title={finished ? undefined : 'Opens after you finish'} onClick={() => onReview(q)}>Full solution</button>
              </div>
              <span className="tq-fine">{finished ? 'Explain shows where your reasoning went wrong.' : `Using help is fine — it's shown in your review.${q.helpCount ? ` (${q.helpCount} ${q.helpCount === 1 ? 'hint' : 'hints'} so far)` : ''} Write in the frame beside the question.`}</span>
            </li>
          )
        })}
      </ol>

      {!finished && (
        <div className="tq-foot">
          <button className="tq-next" disabled={!next || next.id === current} onClick={() => next && onGoto(next)}>Next question</button>
          <button className="tq-finish" disabled={!ready || !total} onClick={onFinish}>{practice ? 'Finish & mark' : 'Finish'}</button>
        </div>
      )}
      {finished && practice && onPracticeMore && (
        <div className="tq-foot">
          <button className="tq-finish" disabled={!!busy} onClick={onPracticeMore}><Icon.target /> 5 more like this</button>
        </div>
      )}
    </aside>
  )
}
