import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RecognitionScheduler } from './scheduler'

// A read that only finishes when the test says so (or is cancelled), like a slow provider.
function harness() {
  const started: { id: string; changedAt: number }[] = []
  const settle = new Map<string, { resolve: () => void; reject: (e: unknown) => void }>()
  const cancelled: string[] = []
  const fresh = new Set<string>()
  let clock = 0
  const s = new RecognitionScheduler({
    pauseMs: 100,
    cooldownMs: 0,
    now: () => clock,
    run: (id, _auto, changedAt) => {
      started.push({ id, changedAt })
      return new Promise<void>((resolve, reject) => settle.set(id, { resolve, reject }))
    },
    cancel: (id) => {
      cancelled.push(id)
      settle.get(id)?.reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }))
    },
    isFresh: (id) => fresh.has(id),
    onPhase: () => undefined,
  })
  s.assist = true
  return { s, started, settle, cancelled, fresh, tick: (ms: number) => { clock += ms; vi.advanceTimersByTime(ms) } }
}

describe('recognition scheduler (latency fixes)', () => {
  beforeEach(() => vi.useFakeTimers())

  it('editing a line cancels its obsolete read at once and reads the new content', async () => {
    const h = harness()
    h.s.contentChanged('r1') // "3 + 2"
    h.tick(100)
    expect(h.started.map((x) => x.id)).toEqual(['r1'])
    h.s.contentChanged('r1') // the student adds "=" while the first read is with the provider
    expect(h.cancelled).toEqual(['r1'])
    h.tick(100)
    for (let i = 0; i < 10; i++) await Promise.resolve() // the cancelled read winds down; the new one starts
    expect(h.started.map((x) => x.id)).toEqual(['r1', 'r1']) // not queued behind the stale read
  })

  it('a second line is read while the first is still with the provider', () => {
    const h = harness()
    h.s.contentChanged('r1')
    h.tick(100)
    h.s.contentChanged('r2')
    h.tick(100)
    expect(h.started.map((x) => x.id)).toEqual(['r1', 'r2'])
  })

  it('the budget starts at the last change to the line, not when the read starts', () => {
    const h = harness()
    h.s.contentChanged('r1')
    h.tick(100)
    expect(h.started[0].changedAt).toBe(0)
  })

  it('pen-up never re-reads a line whose reading is current', () => {
    const h = harness()
    h.fresh.add('r1')
    h.s.penUp('r1')
    h.tick(500)
    expect(h.started).toEqual([])
  })

  it('Stop cancels every read in flight', () => {
    const h = harness()
    h.s.contentChanged('r1'); h.tick(100)
    h.s.contentChanged('r2'); h.tick(100)
    h.s.cancelAll()
    expect(h.cancelled.sort()).toEqual(['r1', 'r2'])
  })
})
