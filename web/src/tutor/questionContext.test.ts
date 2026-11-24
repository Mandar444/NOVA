import { describe, expect, it } from 'vitest'
import { docReducer, initialState, newNotebook, newPage, type DocState } from '../notebook/doc'
import type { PaperQuestion, PaperTest, Stroke } from '../notebook/types'
import { questionById, questionForRegion, questionKey, unattributed, workFor } from './questionContext'

const q = (id: string, number: string, pageId: string, y: number): PaperQuestion => ({ id, number, pageId, text: `Question ${number} on ${pageId}`, bounds: { x: 40, y, w: 600, h: 40 }, kind: 'short', options: [], answer: '?', answerVerified: true, corrected: false, helpCount: 0 })
const stroke = (id: string, y: number): Stroke => ({ id, points: Array.from({ length: 12 }, (_, i) => ({ x: 60 + i * 8, y: y + (i % 3) * 4 })), colour: '#000', width: 3, createdAt: Number(id.slice(1)) * 10_000, author: 'student' })

function setup() {
  let s: DocState = initialState(newNotebook('paper'))
  const nb = s.doc.notebook.id
  const p1 = newPage(nb, 'paper · 1'), p2 = newPage(nb, 'paper · 2')
  s = docReducer(s, { type: 'addPage', page: p1 })
  s = docReducer(s, { type: 'addPage', page: p2 })
  // five questions; numbers 1 and 2 repeat on page 2
  const test: PaperTest = { id: 't1', title: 'paper', status: 'ready', pageIds: [p1.id, p2.id], progress: { done: 2, total: 2 }, createdAt: 1,
    questions: [q('qa', '1', p1.id, 100), q('qb', '2', p1.id, 400), q('qc', '3', p1.id, 700), q('qd', '1', p2.id, 100), q('qe', '2', p2.id, 400)] }
  s = docReducer(s, { type: 'setTest', test })
  const run = (a: Parameters<typeof docReducer>[1]) => (s = docReducer(s, a))
  return { run, get: () => s, p1: p1.id, p2: p2.id }
}

describe('question context on imported papers', () => {
  it('answers are attributed once and keep their question (even if they move into another area)', () => {
    const { run, get, p1 } = setup()
    run({ type: 'addStroke', pageId: p1, stroke: stroke('s1', 180), newRegionId: 'a1' }) // under Q1
    run({ type: 'addStroke', pageId: p1, stroke: stroke('s2', 480), newRegionId: 'a2' }) // under Q2
    run({ type: 'addStroke', pageId: p1, stroke: stroke('s3', 780), newRegionId: 'a3' }) // under Q3
    run({ type: 'ownAnswers', owners: unattributed(get().doc, get().doc.pages[p1]) })
    const page = () => get().doc.pages[p1]
    expect(questionForRegion(get().doc, page(), 'a3')?.question.id).toBe('qc')
    expect(questionForRegion(get().doc, page(), 'a2')?.question.id).toBe('qb')
    // the Q3 answer region is later edited so that its centre sits in Q2's area: it still answers Q3
    const moved = { ...page(), regions: page().regions.map((r) => (r.id === 'a3' ? { ...r, bounds: { ...r.bounds, y: 470 } } : r)) }
    expect(questionForRegion(get().doc, moved, 'a3')?.question.id).toBe('qc')
    // a second attribution never overwrites the first
    run({ type: 'ownAnswers', owners: [{ testId: 't1', regionId: 'a3', questionId: 'qb' }] })
    expect(get().doc.tests!.t1.answerOwners!.a3).toBe('qc')
  })

  it('repeated numbers on different pages are different questions with separate history keys', () => {
    const { run, get, p2 } = setup()
    run({ type: 'addStroke', pageId: p2, stroke: stroke('s9', 180), newRegionId: 'b1' })
    const c = questionForRegion(get().doc, get().doc.pages[p2], 'b1')!
    expect(c.question.id).toBe('qd')
    expect(c.question.number).toBe('1')
    expect(c.historyKey).toBe('q:qd')
    expect(questionKey(questionById(get().doc, 'qa')!.question)).toBe('q:qa')
    expect(c.exam).toMatchObject({ id: 'qd', number: '1', reveal: false })
  })

  it('the work for a question is only its own answers', () => {
    const { run, get, p1 } = setup()
    run({ type: 'addStroke', pageId: p1, stroke: stroke('s1', 480), newRegionId: 'a2' })
    run({ type: 'addStroke', pageId: p1, stroke: stroke('s2', 780), newRegionId: 'a3' })
    run({ type: 'ownAnswers', owners: unattributed(get().doc, get().doc.pages[p1]) })
    const q3 = questionById(get().doc, 'qc')!
    expect(workFor(get().doc.pages[p1], { ...q3, test: get().doc.tests!.t1 }).map((r) => r.id)).toEqual(['a3'])
  })
})
