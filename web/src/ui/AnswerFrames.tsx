// Answer space for printed papers: a faint frame in the grid margin beside each question, the same band that
// answerRegions() reads as that question's answer. Printed papers leave no room under a question; this does.
import type { Page, PaperTest } from '../notebook/types'

export function AnswerFrames({ page, test, current }: { page: Page; test: PaperTest; current?: string | null }) {
  if (!page.bg || test.status === 'finished') return null
  const qs = test.questions.filter((q) => q.pageId === page.id).sort((a, b) => a.bounds.y - b.bounds.y)
  if (!qs.length) return null
  const x = page.bg.w + 40
  const w = Math.max(320, Math.min(760, page.width - x - 40))
  return (
    <>
      {qs.map((q, i) => {
        const top = q.bounds.y - 16
        const bottom = (qs[i + 1]?.bounds.y ?? page.bg!.h) - 4
        const h = Math.max(48, bottom - top - 8) // never reaches into the next question's band
        return (
          <div key={q.id} className={`answer-frame ${current === q.id ? 'current' : ''}`} style={{ left: x, top, width: w, height: h }} aria-hidden="true">
            <span className="answer-frame-label">{current === q.id ? 'Answering' : `Q${q.number.replace(/^Q/i, '')} · answer here`}</span>
          </div>
        )
      })}
    </>
  )
}
