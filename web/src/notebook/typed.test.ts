import { describe, expect, it } from 'vitest'
import { migrateDoc } from '../storage/migrate'
import { docReducer, initialState, isTinyRegion, newNotebook, readingText, type DocState } from './doc'
import type { TypedBlock } from './types'

const block = (over: Partial<TypedBlock> = {}): TypedBlock => ({ id: 'tb1', text: '∫_0^2 x^2 dx', display: '∫₀² x² dx', x: 80, y: 120, w: 160, h: 45, fontSize: 30, createdAt: 1, source: 'dictation', transcript: 'integral of x squared from zero to two', ...over })

function setup() {
  let s: DocState = initialState(newNotebook('t'))
  const pageId = s.doc.notebook.orderedPageIds[0]
  const run = (a: Parameters<typeof docReducer>[1]) => (s = docReducer(s, a))
  const page = () => s.doc.pages[pageId]
  return { run, page, pageId, get: () => s }
}

describe('dictated maths on the page', () => {
  it('is inserted once, as the student’s own content with an accepted reading (no OCR)', () => {
    const { run, page, pageId } = setup()
    run({ type: 'addTyped', pageId, block: block(), regionId: 'r1', asProblem: true })
    run({ type: 'addTyped', pageId, block: block(), regionId: 'r2', asProblem: true }) // dispatched twice: still once
    expect(page().typed).toHaveLength(1)
    expect(page().regions).toHaveLength(1)
    const r = page().regions[0]
    expect(r).toMatchObject({ id: 'r1', typedId: 'tb1', sourceStrokeIds: [] })
    expect(page().readings.r1).toMatchObject({ state: 'accepted', acceptedText: '∫_0^2 x^2 dx', model: 'dictation' })
    expect(readingText(page().readings.r1)).toBe('∫_0^2 x^2 dx')
    expect(page().problemRegionId).toBe('r1')
    expect(page().strokes).toHaveLength(0) // not pretend pen strokes
    expect(page().tutorObjects).toHaveLength(0) // not a tutor answer
    expect(isTinyRegion(page(), r)).toBe(false)
  })

  it('undo / redo restore the block and its reading', () => {
    const { run, page, pageId } = setup()
    run({ type: 'addTyped', pageId, block: block(), regionId: 'r1' })
    run({ type: 'editTyped', pageId, id: 'tb1', text: '∫_0^3 x^2 dx', display: '∫₀³ x² dx', w: 160 })
    expect(page().readings.r1.acceptedText).toBe('∫_0^3 x^2 dx')
    run({ type: 'undo', pageId })
    expect(page().typed?.[0].text).toBe('∫_0^2 x^2 dx')
    expect(page().readings.r1.acceptedText).toBe('∫_0^2 x^2 dx')
    run({ type: 'undo', pageId })
    expect(page().typed).toHaveLength(0)
    expect(page().regions).toHaveLength(0)
    run({ type: 'redo', pageId })
    expect(page().typed).toHaveLength(1)
    expect(page().readings[page().regions[0].id]?.acceptedText).toBe('∫_0^2 x^2 dx')
  })

  it('ink written next to it never joins it, and selecting strokes keeps it', () => {
    const { run, page, pageId } = setup()
    run({ type: 'addTyped', pageId, block: block(), regionId: 'r1' })
    const pts = Array.from({ length: 12 }, (_, i) => ({ x: 250 + i * 3, y: 130 + i }))
    run({ type: 'addStroke', pageId, stroke: { id: 's1', points: pts, colour: '#000', width: 3, createdAt: 2, author: 'student' }, newRegionId: 'r2' })
    expect(page().regions.find((r) => r.id === 'r1')?.sourceStrokeIds).toEqual([])
    expect(page().regions.find((r) => r.id === 'r2')?.sourceStrokeIds).toEqual(['s1'])
    run({ type: 'selectRegion', pageId, strokeIds: ['s1'], regionId: 'r3' })
    expect(page().regions.some((r) => r.typedId === 'tb1')).toBe(true)
  })

  it('survives save/reload (plain JSON) and delete is undoable', () => {
    const { run, page, pageId, get } = setup()
    run({ type: 'addTyped', pageId, block: block(), regionId: 'r1' })
    const reloaded = migrateDoc(JSON.parse(JSON.stringify(get().doc)))
    expect(reloaded.pages[pageId].typed?.[0].display).toBe('∫₀² x² dx')
    expect(reloaded.pages[pageId].readings.r1.acceptedText).toBe('∫_0^2 x^2 dx')
    run({ type: 'deleteTyped', pageId, id: 'tb1' })
    expect(page().typed).toHaveLength(0)
    expect(page().readings.r1).toBeUndefined()
    run({ type: 'undo', pageId })
    expect(page().typed).toHaveLength(1)
  })
})

describe('moving dictated maths', () => {
  it('is geometry only: reading and revision kept, anchored answers follow, one undo step', () => {
    const { run, page, pageId } = setup()
    run({ type: 'addTyped', pageId, block: block(), regionId: 'r1' })
    const rev = page().contentRevision
    const reading = page().readings.r1
    run({ type: 'applyTutorBatch', pageId, contentRevision: rev, batchId: 'b', turns: [], objects: [{ id: 'sol', requestId: 'b', batchId: 'b', anchorRegionId: 'r1', sourceHash: page().regions[0].sourceHash, createdAt: 1, author: 'tutor', status: 'active', layout: { x: 80, y: 200, w: 100, h: 60, leader: false }, action: { id: 'sol', type: 'write_ink', anchorRegionId: 'r1', text: '= 8/3', strokes: [[[80, 200], [90, 210]]], width: 2, purpose: 'content', verified: true, tone: 'nova' } }] })
    run({ type: 'moveTyped', pageId, id: 'tb1', x: 300, y: 400 })
    expect(page().typed?.[0]).toMatchObject({ x: 300, y: 400 })
    expect(page().regions[0].bounds).toMatchObject({ x: 300, y: 400 })
    expect(page().contentRevision).toBe(rev) // answers in flight still apply
    expect(page().readings.r1).toBe(reading) // no re-reading, nothing stale
    const sol = page().tutorObjects.find((t) => t.id === 'sol')!
    expect(sol.status).toBe('active')
    expect(sol.layout).toMatchObject({ x: 300, y: 480 })
    run({ type: 'undo', pageId })
    expect(page().typed?.[0]).toMatchObject({ x: 80, y: 120 })
    expect(page().tutorObjects.find((t) => t.id === 'sol')!.layout).toMatchObject({ x: 80, y: 200 })
  })
})
