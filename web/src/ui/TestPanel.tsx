// The test sheet beside the paper: questions, progress, help, and — after marking — the score and review.
// During a test, help is hints only (the server never gives an unrevealed answer); Explain comes after Finish.

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

export function TestPanel({ test, pages, busy, current, onGoto, onHelp, onReview, onFinish, onRetry, onClose, onPracticeMore }: Props) {
  const practice = test.kind === 'practice'
  const finished = test.status === 'finished'
  const answered = (q: PaperQuestion) => {
    const page = pages[q.pageId]
    return page ? answerRegions(page, test, q).length > 0 : false
  }
  const nAnswered = test.questions.filter(answered).length
  const total = test.questions.length
  const idx = test.questions.findIndex((q) => q.id === current)
  const next = test.questions.find((q, i) => i > idx && !answered(q)) ?? test.questions.find((q) => !answered(q))
  return (
    <aside className="test-panel" aria-label="Test" onPointerDown={(e) => e.stopPropagation()}>
      <header className="tp-head">
        <div className="tp-heading">
          <span className="tp-kicker">{finished ? 'Marked' : test.status === 'reading' ? 'Reading the paper' : practice ? 'Practice' : 'Test'}</span>
          <h2 className="tp-title">{test.title}</h2>
          {!finished && total > 0 && <span className="tp-meta">{total} questions · {nAnswered} answered</span>}
        </div>
        <button className="ask-close" aria-label="Close test panel" onClick={onClose}><Icon.close /></button>
      </header>
      {!finished && total > 0 && (
        <div className="tp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={nAnswered} aria-label="Questions answered">
          <i style={{ width: `${Math.round((nAnswered / total) * 100)}%` }} />
        </div>
      )}

      {finished && test.score && (
        <div className="tp-score">
          <span className="tp-score-num">{test.score.correct}<small>/{test.score.total}</small></span>
          <span className="tp-score-note">{test.score.correct === test.score.total ? 'Every answer is right.' : 'Tap Explain on a question to see what went wrong.'}</span>
        </div>
      )}

      {(test.status === 'reading' || busy) && (
        <div className="tp-status" role="status">
          <span className="ob-pill-track" aria-hidden="true"><span /></span>
          <span>{busy ?? `Reading page ${test.progress.done + 1} of ${test.progress.total}…`}</span>
        </div>
      )}
      {test.error && (
        <div className="tp-error">
          {test.error}
          {!!test.failedPages?.length && test.status !== 'reading' && <button className="link strong" onClick={onRetry}>Retry</button>}
        </div>
      )}
      {!finished && test.readPageIds && test.readPageIds.length < test.pageIds.length && test.status !== 'reading' && (
        <div className="tp-note">NOVA reads each page's questions when you open that page.</div>
      )}

      <ol className="tp-list">
        {test.questions.map((q) => {
          const has = answered(q)
          const open = current === q.id
          const mark = finished ? q.verdict ?? 'unanswered' : has ? 'done' : 'todo'
          return (
            <li key={q.id} className={`tp-q q-row ${open ? 'open' : ''} ${mark}`} data-page={q.pageId} data-bounds={`${q.bounds.x},${q.bounds.y},${q.bounds.w},${q.bounds.h}`}>
              <button className="tp-q-main" onClick={() => onGoto(q)} aria-expanded={open} title="Show on the page">
                <span className={`tp-num ${mark}`} aria-hidden="true">{mark === 'done' || mark === 'correct' ? <Icon.check /> : mark === 'incorrect' ? '✗' : q.number}</span>
                <span className="tp-q-text">
                  <span className="tp-q-label">Q{q.number.replace(/^Q/i, '')}</span> {q.text}
                </span>
              </button>
              {(open || finished) && (
                <div className="tp-q-foot">
                  {finished ? (
                    <>
                      <span className={`tp-verdict ${q.verdict}`}>{q.verdict === 'correct' ? 'Correct' : q.verdict === 'incorrect' ? 'Not right yet' : 'Not answered'}</span>
                      {q.verdict !== 'correct' && <span className="tp-key">Answer: <b>{q.answer}</b></span>}
                      <span className="spacer" />
                      <button className="tp-help" onClick={() => onReview(q)}>Explain</button>
                    </>
                  ) : (
                    <>
                      <span className="tp-state">{has ? 'Answered on the page' : 'Write in the frame beside the question'}{q.helpCount > 0 ? ` · ${q.helpCount} hint${q.helpCount > 1 ? 's' : ''}` : ''}</span>
                      <span className="spacer" />
                      <button className="tp-help hint" disabled={test.status !== 'ready'} onClick={() => onHelp(q)}>Hint</button>
                    </>
                  )}
                </div>
              )}
              {open && !finished && <p className="tp-fine">Using help is fine — it's shown in your review.</p>}
            </li>
          )
        })}
      </ol>

      {!finished && (
        <footer className="tp-foot">
          {next && next.id !== current && <button className="btn" onClick={() => onGoto(next)}>Next question</button>}
          <span className="spacer" />
          <button className="btn primary" disabled={test.status !== 'ready' || !total} onClick={onFinish}>{practice ? 'Finish & mark' : 'Finish'}</button>
        </footer>
      )}
      {finished && practice && onPracticeMore && (
        <footer className="tp-foot">
          <span className="muted">{test.score && test.score.correct === test.score.total ? 'All right. Try a few more?' : 'Practice makes it stick.'}</span>
          <span className="spacer" />
          <button className="btn primary" disabled={!!busy} onClick={onPracticeMore}><Icon.target /> 5 more like this</button>
        </footer>
      )}
    </aside>
  )
}
