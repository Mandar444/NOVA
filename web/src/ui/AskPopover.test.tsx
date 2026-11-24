// The real Ask panel and its real "Done & Ask" button (React state handling included), with fake capture engines and a
// controllable transcription API. No microphone.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineEvents } from '../voice/engines'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollTo = function () {} // jsdom has no layout

const h = vi.hoisted(() => ({ engines: [] as { ev: EngineEvents }[], pending: [] as { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] }))

vi.mock('../voice/engines', () => ({
  localEngine: (ev: EngineEvents) => {
    h.engines.push({ ev })
    return { kind: 'local', start: async () => undefined, stop: () => setTimeout(() => ev.onEnd()), cancel: () => ev.onEnd() }
  },
  browserEngine: () => { throw new Error('not used') },
  browserSpeechPresent: () => false,
  browserSpeechKnownBroken: () => false,
  recordingSupported: () => true,
  micPermission: async () => 'granted',
  deniedMessage: () => 'Microphone is blocked.',
}))
vi.mock('../tutor/api', () => {
  class ApiFailure extends Error {
    code: string
    constructor(code: string, message: string) { super(message); this.code = code }
  }
  return {
    ApiFailure,
    api: {
      capabilities: async () => ({ features: { transcribe: true }, speech: { usable: true, reason: null } }),
      transcribe: (_id: string, _b: Blob, signal?: AbortSignal) =>
        new Promise((resolve, reject) => {
          h.pending.push({ resolve, reject })
          signal?.addEventListener('abort', () => reject(new ApiFailure('CANCELLED', 'cancelled')))
        }),
    },
  }
})

type Props = Parameters<typeof import('./AskPopover')['AskPanel']>[0]
let root: Root | null = null
let div: HTMLDivElement

async function setup(over: Partial<Props> = {}) {
  vi.resetModules()
  localStorage.clear()
  h.engines.length = 0
  h.pending.length = 0
  const { AskPanel } = await import('./AskPopover')
  const { voiceSession, serverSpeech } = await import('../voice/session')
  await serverSpeech(true)
  const onSend = vi.fn()
  const props: Props = { docked: true, startWithMic: false, turns: [], status: { state: 'idle' }, about: null, onClearAbout: () => {}, onSend, onClose: () => {}, ...over }
  div = document.createElement('div')
  document.body.appendChild(div)
  root = createRoot(div)
  await act(async () => root!.render(<AskPanel {...props} />))
  const render = async (p: Partial<Props>) => act(async () => root!.render(<AskPanel {...props} {...p} />))
  return { onSend, session: voiceSession('ask'), render, props }
}
const $ = (id: string) => div.querySelector(`[data-testid=${id}]`) as HTMLElement | null
const click = async (id: string) => act(async () => { $(id)!.click() })
const flush = async (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const box = () => (div.querySelector('[data-testid=ask-input]') as HTMLTextAreaElement)

/** Start a capture, deliver one spoken segment whose transcription is held until the test resolves it. */
async function speakOneSegment() {
  await click('voice-mic')
  await flush(10)
  h.engines[h.engines.length - 1].ev.onSegment(new Blob(['audio']))
  await flush(10)
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  div?.remove()
  vi.useRealTimers()
})

describe('Done & Ask (real button)', () => {
  it('delayed final transcription → exactly one send, with the final words and voice provenance', async () => {
    const { onSend } = await setup()
    await speakOneSegment()
    await click('voice-done-ask')
    await flush(2000) // the last words are still being transcribed
    expect(onSend).not.toHaveBeenCalled()
    await act(async () => h.pending[0].resolve({ transcript: 'integral of x squared' }))
    await flush(300)
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('ask', 'integral of x squared', { voice: true })
    expect(box().value).toBe('') // sent: the box is ready for the next question
  })

  it('double click sends once', async () => {
    const { onSend } = await setup()
    await speakOneSegment()
    await click('voice-done-ask')
    await act(async () => { $('voice-done-ask')?.click(); $('voice-done-ask')?.click() })
    await act(async () => h.pending[0].resolve({ transcript: 'x squared plus one' }))
    await flush(300)
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('timeout → the words so far stay, the box unlocks, nothing is sent; a late result never overwrites edits', async () => {
    const { onSend, session } = await setup()
    session.setDraft('Solve')
    await speakOneSegment()
    await click('voice-done-ask')
    await flush(16_000)
    expect(onSend).not.toHaveBeenCalled()
    expect(box().readOnly).toBe(false)
    expect(box().value).toBe('Solve')
    expect($('voice-error')?.textContent).toMatch(/still being transcribed/)
    expect($('voice-retry')).not.toBeNull() // the unfinished audio is kept for an explicit retry
    // the student edits and could send by hand
    await act(async () => session.setDraft('Solve x squared = 4'))
    // the expired transcription arrives late: ignored
    await act(async () => h.pending[0].resolve({ transcript: 'LATE WORDS' }))
    await flush(500)
    expect(box().value).toBe('Solve x squared = 4')
    expect(onSend).not.toHaveBeenCalled()
    const send = div.querySelector('button[aria-label=Send]') as HTMLButtonElement
    expect(send.disabled).toBe(false)
  })

  it('Cancel while finishing → no late send; the earlier draft is kept', async () => {
    const { onSend } = await setup()
    await act(async () => voiceSessionDraft('What is'))
    await speakOneSegment()
    await click('voice-done-ask')
    await flush(200)
    await click('voice-cancel')
    await act(async () => h.pending[0]?.resolve({ transcript: 'the integral' }))
    await flush(500)
    expect(onSend).not.toHaveBeenCalled()
    expect(box().value).toBe('What is')
  })

  it('closing the panel while finishing → no late send; the words are kept for next time', async () => {
    const { onSend, session } = await setup()
    await speakOneSegment()
    await click('voice-done-ask')
    await flush(200)
    await act(async () => root!.unmount())
    root = null
    await act(async () => h.pending[0].resolve({ transcript: 'integral of x squared' }))
    await flush(500)
    expect(onSend).not.toHaveBeenCalled()
    expect(session.get().draft).toBe('integral of x squared')
  })

  it('a failed request puts the question back in the box and offers Retry', async () => {
    const retry = vi.fn()
    const { onSend, render } = await setup()
    await speakOneSegment()
    await click('voice-done-ask')
    await act(async () => h.pending[0].resolve({ transcript: 'explain this integral' }))
    await flush(300)
    expect(onSend).toHaveBeenCalledTimes(1)
    expect($('sent-pending')?.textContent).toBe('explain this integral') // shown at once
    await render({ status: { state: 'error', message: 'Cannot reach the NOVA server.', retryable: true, retry } })
    expect(box().value).toBe('explain this integral')
    const retryBtn = [...div.querySelectorAll('button')].find((b) => b.textContent === 'Retry') as HTMLButtonElement
    expect(retryBtn).toBeTruthy()
    await act(async () => retryBtn.click())
    expect(retry).toHaveBeenCalledTimes(1)
  })
})

async function voiceSessionDraft(t: string) {
  const { voiceSession } = await import('../voice/session')
  voiceSession('ask').setDraft(t)
}
