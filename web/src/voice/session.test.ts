// The voice session's promises, with fake capture engines (no microphone): words survive pauses, Resume appends,
// Cancel drops only the current capture, failures keep words and audio, nothing is sent by itself.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineEvents } from './engines'

const h = vi.hoisted(() => ({
  engines: [] as { kind: string; ev: EngineEvents; stopped: boolean; cancelled: boolean }[],
  transcribe: vi.fn(),
  caps: { local: true, browser: true },
}))

vi.mock('./engines', () => {
  const make = (kind: string) => (ev: EngineEvents) => {
    const e = { kind, ev, stopped: false, cancelled: false }
    h.engines.push(e)
    return {
      kind,
      start: async () => undefined,
      stop: () => { e.stopped = true; setTimeout(() => ev.onEnd()) },
      cancel: () => { e.cancelled = true; ev.onEnd() },
    }
  }
  return {
    localEngine: make('local'),
    browserEngine: (ev: EngineEvents) => make('browser')(ev),
    browserSpeechPresent: () => h.caps.browser,
    browserSpeechKnownBroken: () => false,
    recordingSupported: () => true,
    micPermission: async () => 'granted',
    deniedMessage: () => 'Microphone is blocked.',
  }
})
vi.mock('../tutor/api', () => {
  class ApiFailure extends Error {
    code: string
    retryable: boolean
    constructor(code: string, message: string, retryable = false) { super(message); this.code = code; this.retryable = retryable }
  }
  return {
    ApiFailure,
    api: {
      capabilities: async () => ({ features: { transcribe: h.caps.local }, speech: { usable: h.caps.local, reason: h.caps.local ? null : "The speech model 'base.en' is not downloaded." } }),
      transcribe: (...a: unknown[]) => h.transcribe(...a),
    },
  }
})

const tick = () => new Promise((r) => setTimeout(r, 0))
const flush = async () => { for (let i = 0; i < 6; i++) await tick() }

async function fresh(key: 'ask' | 'dictate' = 'ask') {
  vi.resetModules()
  localStorage.clear()
  const m = await import('./session')
  await m.serverSpeech(true)
  return m.voiceSession(key)
}

beforeEach(() => {
  h.engines.length = 0
  h.transcribe.mockReset()
  h.caps.local = true
  h.caps.browser = true
})

describe('voice session — local (offline speech) path', () => {
  it('a pause between phrases loses nothing; segments append in spoken order', async () => {
    const s = await fresh()
    let resolveFirst!: (v: unknown) => void
    h.transcribe.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r))).mockResolvedValueOnce({ transcript: 'from zero to two' })
    await s.start()
    await flush()
    expect(s.get().status).toBe("listening")
    const e = h.engines[0]
    e.ev.onSegment(new Blob(['a'])) // first phrase, then a natural pause
    e.ev.onSegment(new Blob(['b'])) // speaking again after the pause
    await flush()
    expect(s.get().draft).toBe('') // the second can't jump ahead of the first
    resolveFirst({ transcript: 'integral of x squared' })
    await flush()
    expect(s.get().draft).toBe('integral of x squared from zero to two')
    expect(s.get().status).toBe('listening') // still listening: a pause never ends the capture or sends anything
  })

  it('Pause/Resume keeps one draft and appends; Stop keeps the transcript', async () => {
    const s = await fresh()
    h.transcribe.mockResolvedValueOnce({ transcript: 'x squared' }).mockResolvedValueOnce({ transcript: 'plus three x' })
    await s.start(); await flush()
    h.engines[0].ev.onSegment(new Blob(['a']))
    s.pause(); await flush()
    expect(s.get()).toMatchObject({ status: 'paused', draft: 'x squared' })
    await s.start(); await flush()
    h.engines[1].ev.onSegment(new Blob(['b']))
    s.stop(); await flush()
    expect(s.get()).toMatchObject({ status: 'ready', draft: 'x squared plus three x', spoken: true })
  })

  it('Cancel discards only the current capture, keeping earlier text and the student’s edits', async () => {
    const s = await fresh()
    s.setDraft('Solve')
    h.transcribe.mockResolvedValueOnce({ transcript: 'x plus one' })
    await s.start(); await flush()
    h.engines[0].ev.onSegment(new Blob(['a'])); await flush()
    expect(s.get().draft).toBe('Solve x plus one')
    s.cancel(); await flush()
    expect(s.get()).toMatchObject({ draft: 'Solve', status: 'ready' })
    expect(h.engines[0].cancelled).toBe(true)
  })

  it('a failed transcription keeps the earlier words and the audio for Retry', async () => {
    const s = await fresh()
    const { ApiFailure } = await import('../tutor/api')
    h.transcribe.mockResolvedValueOnce({ transcript: 'x squared' }).mockRejectedValueOnce(new ApiFailure('MODEL_BUSY', 'busy', true)).mockResolvedValueOnce({ transcript: 'minus four' })
    await s.start(); await flush()
    h.engines[0].ev.onSegment(new Blob(['a']))
    h.engines[0].ev.onSegment(new Blob(['b']))
    s.stop(); await flush()
    expect(s.get()).toMatchObject({ status: 'error', draft: 'x squared', failed: 1 })
    expect(s.get().error).toMatch(/could not be turned into text/)
    await s.retry(); await flush()
    expect(s.get()).toMatchObject({ status: 'ready', draft: 'x squared minus four', failed: 0 })
  })

  it('the draft survives the panel closing (persisted) and is only cleared explicitly', async () => {
    const s = await fresh()
    s.setDraft('integral of x squared')
    vi.resetModules()
    const m = await import('./session') // a new panel / a reload
    expect(m.voiceSession('ask').get().draft).toBe('integral of x squared')
    m.voiceSession('ask').clear()
    expect(m.voiceSession('ask').get().draft).toBe('')
  })
})

describe('voice session — browser recognizer path', () => {
  it('uses the browser when offline speech is unavailable; repeated finals are not duplicated', async () => {
    h.caps.local = false
    const s = await fresh()
    await s.start(); await flush()
    const e = h.engines[0]
    expect(e.kind).toBe('browser')
    e.ev.onFinal('x squared plus')
    e.ev.onFinal('x squared plus') // the same result delivered again (a restarted session)
    e.ev.onInterim('three x')
    expect(s.get()).toMatchObject({ draft: 'x squared plus', interim: 'three x' })
    s.stop(); await flush()
    expect(s.get().draft).toBe('x squared plus three x') // live words at Stop are kept
  })

  it('Brave: a blocked browser service switches to offline speech once, same draft', async () => {
    const s = await fresh()
    // force the browser path first, as when a Hindi voice is chosen
    ;(s as unknown as { preferBrowser: boolean }).preferBrowser = true
    s.setDraft('Solve')
    await s.start(); await flush()
    expect(h.engines[0].kind).toBe('browser')
    h.engines[0].ev.onError('service', "This browser's speech service is not reachable (Brave blocks it).")
    await flush()
    expect(h.engines[1].kind).toBe('local')
    expect(s.get()).toMatchObject({ status: 'listening', draft: 'Solve', error: null })
  })

  it('neither path usable: a specific, actionable error and the text stays editable', async () => {
    h.caps.local = false
    h.caps.browser = false
    const s = await fresh()
    s.setDraft('my question')
    await s.start(); await flush()
    expect(s.get().status).toBe('error')
    expect(s.get().error).toMatch(/setup_speech\.py/)
    expect(s.get().draft).toBe('my question')
    s.setDraft('my question, typed')
    expect(s.get().draft).toBe('my question, typed')
  })
})
