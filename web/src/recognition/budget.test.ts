// One help budget bounds every stage of an explicit read: joining a read already running, waiting for a free slot,
// the read itself. Stop cancels queued work; nothing starts after cancellation or expiry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecognitionScheduler, type HelpBudget } from './scheduler'

const DEADLINE = 45_000
const never = () => new Promise<void>(() => {}) // a silent provider

function sched() {
  const calls: { id: string; budget?: HelpBudget }[] = []
  const s = new RecognitionScheduler({ run: (id, _a, _c, budget) => { calls.push({ id, budget }); return never() }, onPhase: () => {} })
  return { s, calls }
}
const budget = (ms = DEADLINE) => { const c = new AbortController(); return { b: { deadline: Date.now() + ms, signal: c.signal } as HelpBudget, stop: () => c.abort() } }
async function settle<T>(p: Promise<T>) { let r: unknown = 'pending'; p.then((v) => (r = { ok: v }), (e) => (r = { err: (e as { code?: string }).code })); await vi.advanceTimersByTimeAsync(0); return () => r }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('help budget for explicit reads', () => {
  it('Explain while the same answer is already being read: joins it, but only until the help deadline', async () => {
    const { s, calls } = sched()
    void s.readNow('q3').catch(() => {}) // the read already in progress (no deadline of its own here)
    const { b } = budget()
    const r = await settle(s.readNow('q3', b))
    await vi.advanceTimersByTimeAsync(DEADLINE - 1)
    expect(r()).toBe('pending')
    await vi.advanceTimersByTimeAsync(2)
    expect(r()).toEqual({ err: 'TIMEOUT' }) // exactly at the configured total deadline, not 83 s
    expect(calls).toHaveLength(1) // joined: no second recognition was started
  })

  it('both recognition slots occupied: the wait for a slot is bounded and no read starts after expiry', async () => {
    const { s, calls } = sched()
    void s.readNow('a').catch(() => {}); void s.readNow('b').catch(() => {})
    const { b } = budget()
    const r = await settle(s.readNow('q3', b))
    await vi.advanceTimersByTimeAsync(DEADLINE + 1)
    expect(r()).toEqual({ err: 'TIMEOUT' })
    expect(calls.map((c) => c.id)).toEqual(['a', 'b']) // q3 never started
  })

  it('Stop while queued: cancelled at once, and nothing is started afterwards', async () => {
    const { s, calls } = sched()
    void s.readNow('a').catch(() => {}); void s.readNow('b').catch(() => {})
    const { b, stop } = budget()
    const r = await settle(s.readNow('q3', b))
    await vi.advanceTimersByTimeAsync(5_000)
    stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(r()).toEqual({ err: 'CANCELLED' })
    await vi.advanceTimersByTimeAsync(DEADLINE * 2)
    expect(calls.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('silent provider: the read itself receives what is LEFT of the same deadline (the clock is not restarted)', async () => {
    const { s, calls } = sched()
    const { b } = budget()
    await vi.advanceTimersByTimeAsync(12_000) // e.g. time already spent before the read
    void s.readNow('q3', b).catch(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(calls[0].budget?.deadline).toBe(b.deadline)
    expect(calls[0].budget!.deadline - Date.now()).toBe(DEADLINE - 12_000)
  })

  it('an expired or stopped budget starts no read at all', async () => {
    const { s, calls } = sched()
    const expired = { deadline: Date.now() - 1, signal: new AbortController().signal }
    await expect(s.readNow('q3', expired)).rejects.toMatchObject({ code: 'TIMEOUT' })
    const { b, stop } = budget(); stop()
    await expect(s.readNow('q4', b)).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(calls).toHaveLength(0)
  })
})
