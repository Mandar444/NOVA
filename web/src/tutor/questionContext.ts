// One question context for every help request: which question (handwritten line, dictated block, or printed question on
// an imported paper) the student means, what they wrote for it, and where NOVA's answer belongs.
// Printed questions are identified by their test/question ids — never by number (numbers repeat across pages) and never
// re-guessed from position once an answer has been attributed.

import { isTinyRegion } from '../notebook/doc'
import type { NotebookDoc, Page, PaperQuestion, PaperTest, Region } from '../notebook/types'

export interface ExamContext { id: string; number: string; text: string; answer: string; reveal: boolean }
export interface QuestionContext { test: PaperTest; question: PaperQuestion; exam: ExamContext; historyKey: string }

/** History of a printed question is its own: keyed by its stable id. */
export const questionKey = (q: Pick<PaperQuestion, 'id'>) => `q:${q.id}`

export function examOf(test: PaperTest, q: PaperQuestion): ExamContext {
  return { id: q.id, number: q.number, text: q.text, answer: q.answer, reveal: test.status === 'finished' }
}

function testsOn(doc: NotebookDoc, pageId: string): PaperTest[] {
  return Object.values(doc.tests ?? {}).filter((t) => t.pageIds.includes(pageId) && t.questions.some((q) => q.pageId === pageId))
}

/** The question whose answer area holds this region, by position (used only the first time a piece of work is seen). */
export function positionalOwner(page: Page, test: PaperTest, region: Region): PaperQuestion | undefined {
  const same = test.questions.filter((x) => x.pageId === page.id).sort((a, b) => a.bounds.y - b.bounds.y)
  const cy = region.bounds.y + region.bounds.h / 2
  let owner: PaperQuestion | undefined
  for (let i = 0; i < same.length; i++) {
    const top = same[i].bounds.y - 16
    const bottom = same[i + 1] ? same[i + 1].bounds.y - 4 : Number.POSITIVE_INFINITY
    if (cy >= top && cy < bottom) owner = same[i]
  }
  return owner
}

/** The question a piece of the student's work belongs to: its recorded owner first (stable through scrolling, edits and
 *  moves), then position. */
export function questionForRegion(doc: NotebookDoc, page: Page, regionId: string | null | undefined): QuestionContext | null {
  if (!regionId) return null
  const region = page.regions.find((r) => r.id === regionId)
  if (!region) return null
  for (const test of testsOn(doc, page.id)) {
    const ownerId = test.answerOwners?.[regionId]
    const q = (ownerId && test.questions.find((x) => x.id === ownerId)) || positionalOwner(page, test, region)
    if (q) return { test, question: q, exam: examOf(test, q), historyKey: questionKey(q) }
  }
  return null
}

export function questionById(doc: NotebookDoc, questionId: string | null | undefined): QuestionContext | null {
  if (!questionId) return null
  for (const test of Object.values(doc.tests ?? {})) {
    const q = test.questions.find((x) => x.id === questionId)
    if (q) return { test, question: q, exam: examOf(test, q), historyKey: questionKey(q) }
  }
  return null
}

/** The student's work for a question: regions recorded as its answers (plus unattributed ones in its area). */
export function workFor(page: Page, ctx: QuestionContext): Region[] {
  const owners = ctx.test.answerOwners ?? {}
  return page.regions
    .filter((r) => !isTinyRegion(page, r))
    .filter((r) => (owners[r.id] ? owners[r.id] === ctx.question.id : positionalOwner(page, ctx.test, r)?.id === ctx.question.id))
    .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
}

/** New pieces of work on a paper page that have no recorded owner yet: attribute them once (by position at creation). */
export function unattributed(doc: NotebookDoc, page: Page): { testId: string; regionId: string; questionId: string }[] {
  const out: { testId: string; regionId: string; questionId: string }[] = []
  for (const test of testsOn(doc, page.id)) {
    for (const r of page.regions) {
      if (test.answerOwners?.[r.id] || isTinyRegion(page, r)) continue
      const q = positionalOwner(page, test, r)
      if (q) out.push({ testId: test.id, regionId: r.id, questionId: q.id })
    }
  }
  return out
}
