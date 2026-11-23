// "Start a practice set" (design board "Practice dialog"): class, chapter, how many, level, whether help is allowed.
// It can also start from a line on the page ("more like this").

import { useState } from 'react'
import { Icon } from './icons'

export interface PracticeStart {
  topic?: string
  example?: string
  count: number
  allowHelp?: boolean
}

interface Props {
  example?: string | null // the selected line, if practice starts from one
  suggested?: string[] // weak topics first
  onStart: (p: PracticeStart) => void
  onClose: () => void
}

// NCERT mathematics chapters (rationalised syllabus)
const CHAPTERS: Record<8 | 9 | 10, string[]> = {
  8: ['Rational numbers', 'Linear equations in one variable', 'Quadrilaterals', 'Squares and square roots', 'Cubes and cube roots', 'Comparing quantities', 'Algebraic expressions and identities', 'Mensuration', 'Exponents and powers', 'Direct and inverse proportions', 'Factorisation', 'Introduction to graphs'],
  9: ['Linear equations', 'Polynomials', 'Coordinate geometry', 'Triangles', 'Surface areas', 'Statistics', 'Number systems', 'Lines and angles', 'Quadrilaterals', 'Circles', "Heron's formula"],
  10: ['Real numbers', 'Polynomials', 'Pair of linear equations', 'Quadratic equations', 'Arithmetic progressions', 'Triangles', 'Coordinate geometry', 'Trigonometry', 'Applications of trigonometry', 'Circles', 'Areas related to circles', 'Surface areas and volumes', 'Statistics', 'Probability'],
}
const LEVELS = [
  { id: 'warm', label: 'Warm-up', say: 'warm-up (easy)' },
  { id: 'board', label: 'Board', say: 'board-exam level' },
  { id: 'challenge', label: 'Challenge', say: 'challenge (harder)' },
] as const

export function PracticeDialog({ example, suggested = [], onStart, onClose }: Props) {
  const [cls, setCls] = useState<8 | 9 | 10>(9)
  const [chapter, setChapter] = useState<string | null>(example ? null : suggested[0] ?? CHAPTERS[9][0])
  const [likeLine, setLikeLine] = useState(!!example)
  const [count, setCount] = useState(10)
  const [level, setLevel] = useState<(typeof LEVELS)[number]['id']>('board')
  const [allowHelp, setAllowHelp] = useState(true)
  const chapters = [...new Set([...suggested.filter((s) => !CHAPTERS[cls].includes(s)).slice(0, 2), ...CHAPTERS[cls]])]
  const ready = (likeLine && !!example) || !!chapter
  const start = () => {
    if (!ready) return
    const lvl = LEVELS.find((l) => l.id === level)!.say
    const topic = chapter ? `${chapter} · Class ${cls} · ${lvl}` : `Class ${cls} · ${lvl}`
    onStart(likeLine && example ? { example, topic, count, allowHelp } : { topic, count, allowHelp })
  }
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form className="pr" role="dialog" aria-label="Start a practice set" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); start() }}>
        <div className="pr-head">
          <div>
            <h2>Start a practice set</h2>
            <p>NOVA writes the questions. You answer them by hand.</p>
          </div>
          <button type="button" className="pr-x" aria-label="Close" onClick={onClose}><Icon.close /></button>
        </div>

        <span className="pr-label">Class</span>
        <div className="pr-seg" role="radiogroup" aria-label="Class">
          {([8, 9, 10] as const).map((c) => (
            <button type="button" key={c} role="radio" aria-checked={cls === c} className={cls === c ? 'on' : ''} onClick={() => { setCls(c); if (chapter && !CHAPTERS[c].includes(chapter) && !suggested.includes(chapter)) setChapter(CHAPTERS[c][0]) }}>Class {c}</button>
          ))}
        </div>

        <span className="pr-label">Chapter</span>
        <div className="pr-chips" role="radiogroup" aria-label="Chapter">
          {example && (
            <button type="button" role="radio" aria-checked={likeLine} className={likeLine ? 'on' : ''} onClick={() => { setLikeLine(true); setChapter(null) }}>Like “{example.length > 24 ? example.slice(0, 24) + '…' : example}”</button>
          )}
          {chapters.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={!likeLine && chapter === c} className={!likeLine && chapter === c ? 'on' : ''} onClick={() => { setChapter(c); setLikeLine(false) }}>{c}</button>
          ))}
        </div>

        <div className="pr-two">
          <div>
            <span className="pr-label">Questions</span>
            <div className="pr-boxes" role="radiogroup" aria-label="How many questions">
              {[5, 10, 15].map((n) => (
                <button type="button" key={n} role="radio" aria-checked={count === n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>{n}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="pr-label">Level</span>
            <div className="pr-boxes" role="radiogroup" aria-label="Level">
              {LEVELS.map((l) => (
                <button type="button" key={l.id} role="radio" aria-checked={level === l.id} className={level === l.id ? 'on' : ''} onClick={() => setLevel(l.id)}>{l.label}</button>
              ))}
            </div>
          </div>
        </div>

        <label className="pr-allow">
          <span><b>Allow Hint, Explain and Full solution</b><span>Help you use is shown in your review</span></span>
          <input type="checkbox" className="st-check" checked={allowHelp} onChange={(e) => setAllowHelp(e.target.checked)} />
        </label>

        <div className="pr-foot">
          <button type="button" className="pr-cancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="pr-start" disabled={!ready}>Start · {count} questions</button>
        </div>
      </form>
    </div>
  )
}
