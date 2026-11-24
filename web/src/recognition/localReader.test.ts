// Bounded recovery of the browser reader after a failed load (fake Worker; no model).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Msg = { type: string; [k: string]: unknown }
const workers: FakeWorker[] = []
let behaviour: 'fail' | 'ok' | 'silent' = 'fail'
class FakeWorker {
  onmessage: ((e: { data: Msg }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  terminated = false
  mode = behaviour
  constructor() { workers.push(this) }
  postMessage(m: Msg) {
    if (m.type === 'init') {
      if (this.mode === 'fail') setTimeout(() => this.onmessage?.({ data: { type: 'error', message: 'weights 404' } }))
      if (this.mode === 'ok') setTimeout(() => this.onmessage?.({ data: { type: 'ready', ms: 40, model: { run: 'v3g' } } }))
    }
    if (m.type === 'read') setTimeout(() => this.onmessage?.({ data: { type: 'result', id: m.id, ms: 5, model: null, result: { status: 'answer', literal: '3 + 2 =', reliable: true } } }))
  }
  terminate() { this.terminated = true }
  lateReady() { this.onmessage?.({ data: { type: 'ready', ms: 99, model: null } }) }
}

async function fresh() {
  vi.resetModules()
  const m = await import('./localReader')
  m._resetLocalReaderForTests()
  return m
}
// the result is captured at once (a rejection is never left unhandled while fake time advances)
const read = (m: Awaited<ReturnType<typeof fresh>>) => m.readLocally([[{ x: 0, y: 0 }, { x: 5, y: 5 }]]).then((v) => ({ ok: v }), (e: Error) => ({ err: e.message }))

beforeEach(() => { vi.useFakeTimers(); workers.length = 0; vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('browser reader: bounded recovery after a failed load', () => {
  it('a failed load is not permanent: after the pause a fresh worker loads and reads', async () => {
    const m = await fresh()
    behaviour = 'fail'
    const p1 = read(m); await vi.advanceTimersByTimeAsync(1)
    expect(await p1).toMatchObject({ err: expect.stringMatching(/failed to load/) })
    expect(workers[0].terminated).toBe(true) // the failed worker is cleaned up
    // immediately again: no retry storm, no new worker
    expect(await read(m)).toMatchObject({ err: expect.stringMatching(/failed to load/) })
    expect(workers).toHaveLength(1)
    // after the pause: one new worker, it loads, the read works
    behaviour = 'ok'
    await vi.advanceTimersByTimeAsync(20_000)
    const p3 = read(m); await vi.advanceTimersByTimeAsync(5)
    expect(await p3).toMatchObject({ ok: { result: { literal: '3 + 2 =' } } })
    expect(workers).toHaveLength(2)
  })

  it('a worker that timed out cannot resolve anything later (no stale success, no duplicate workers)', async () => {
    const m = await fresh()
    behaviour = 'silent'
    const p1 = read(m); await vi.advanceTimersByTimeAsync(15_001)
    expect(await p1).toMatchObject({ err: expect.stringMatching(/did not load in 15 s/) })
    workers[0].lateReady() // arrives after it was given up on
    expect(await read(m)).toHaveProperty('err') // still in the pause: not silently "ready" again
    expect(workers).toHaveLength(1)
  })

  it('gives up after 3 attempts per visit (no endless retries)', async () => {
    const m = await fresh()
    behaviour = 'fail'
    for (let i = 0; i < 5; i++) { const p = read(m); await vi.advanceTimersByTimeAsync(1); await p; await vi.advanceTimersByTimeAsync(20_000) }
    expect(workers).toHaveLength(3)
  })
})
