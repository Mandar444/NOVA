// One voice session per purpose ("ask" = a question to NOVA, "dictate" = maths written onto the page).
// The draft lives here, not in a panel: closing a panel, a pause, a failed transcription or a restart never loses it.
//
//   idle ──start──▶ listening ──pause──▶ (transcribing) ──▶ paused ──start──▶ listening …   (Resume appends)
//                        │ stop ──────────▶ (transcribing) ──▶ ready
//                        │ cancel ────────▶ the words of THIS capture go; the earlier draft stays
//                        └ error ─────────▶ error (draft kept; recoverable audio kept for Retry)
//
// Nothing is ever sent automatically: the student sends or inserts.

import { useSyncExternalStore } from 'react'
import { uuid } from '../notebook/ids'
import { ApiFailure, api } from '../tutor/api'
import { speechLang } from './browserSpeech'
import { browserEngine, browserSpeechKnownBroken, browserSpeechPresent, deniedMessage, localEngine, micPermission, recordingSupported, type Engine, type EngineErrorCode } from './engines'
import { setMicBusy, stopSpeaking } from './speech'

export type VoiceStatus = 'idle' | 'listening' | 'paused' | 'transcribing' | 'ready' | 'error'
export interface VoiceState {
  status: VoiceStatus
  draft: string // finalized text, including the student's own edits
  interim: string // live words not yet final (never saved)
  pending: number // audio segments being transcribed
  error: string | null
  engine: 'local' | 'browser' | null
  startedAt: number | null
  level: number
  spoken: boolean // some of the draft came from the microphone
  failed: number // audio segments that could not be transcribed yet (Retry keeps them)
}

export type Speech = { local: boolean; localReason: string | null }
let speechCaps: Promise<Speech> | null = null
/** What the server can do with audio (faster-whisper installed AND its model present). Cached; refreshed on failure. */
export function serverSpeech(refresh = false): Promise<Speech> {
  if (!speechCaps || refresh)
    speechCaps = api
      .capabilities()
      .then((c) => {
        const sp = (c as unknown as { speech?: { usable?: boolean; reason?: string | null } }).speech
        return { local: !!c.features?.transcribe, localReason: sp?.reason ?? (c.features?.transcribe ? null : 'Speech recognition is not set up on this computer.') }
      })
      .catch(() => ({ local: false, localReason: "NOVA's server could not be reached." }))
  return speechCaps
}

const SETUP_HINT = 'To use voice here, set up NOVA\'s free offline speech once: in the server folder run  python scripts/setup_speech.py  and restart NOVA.'

const sessions = new Map<string, VoiceSession>()
export function voiceSession(key: 'ask' | 'dictate'): VoiceSession {
  let s = sessions.get(key)
  if (!s) sessions.set(key, (s = new VoiceSession(key)))
  return s
}

function joinText(a: string, b: string): string {
  const x = a.trimEnd(), y = b.trim()
  if (!y) return a
  if (!x) return y
  // the same words arriving twice (a repeated final, a restarted session): keep one copy
  if (x.toLowerCase().endsWith(y.toLowerCase()) && y.length > 2) return x
  return `${x} ${y}`
}

export class VoiceSession {
  private state: VoiceState
  private subs = new Set<() => void>()
  private engine: Engine | null = null
  private base = '' // the draft before the current capture: Cancel goes back to exactly this
  private capture = 0 // capture generation: results of a cancelled capture are ignored
  private seq = 0 // order of audio segments within a capture
  private ready = new Map<number, string>() // transcribed segments waiting for earlier ones
  private next = 0 // next segment index to append
  private failedAudio: { blob: Blob; capture: number; index: number }[] = []
  private aborts = new Set<AbortController>()
  private after: 'paused' | 'ready' = 'ready'
  private preferBrowser = false
  private triedFallback = false

  readonly key: string
  constructor(key: string) {
    this.key = key
    let draft = ''
    try { draft = localStorage.getItem(`nova.voiceDraft.${key}`) ?? '' } catch { /* private mode */ }
    this.state = { status: draft ? 'ready' : 'idle', draft, interim: '', pending: 0, error: null, engine: null, startedAt: null, level: 0, spoken: false, failed: 0 }
  }

  // ------------------------------------------------------------ store
  get = () => this.state
  subscribe = (f: () => void) => { this.subs.add(f); return () => this.subs.delete(f) }
  private set(p: Partial<VoiceState>) {
    this.state = { ...this.state, ...p }
    if ('draft' in p) {
      try {
        if (this.state.draft) localStorage.setItem(`nova.voiceDraft.${this.key}`, this.state.draft)
        else localStorage.removeItem(`nova.voiceDraft.${this.key}`)
      } catch { /* private mode: this visit only */ }
    }
    this.subs.forEach((f) => f())
  }
  get listening() { return this.state.status === 'listening' }

  // ------------------------------------------------------------ editing (explicit actions only)
  setDraft(text: string) {
    if (this.state.status === 'listening') return // the box is read-only while words are arriving
    this.set({ draft: text, spoken: text.trim() ? this.state.spoken : false, ...(this.state.status === 'idle' && text ? { status: 'ready' as const } : {}) })
  }
  clear() {
    if (this.state.status === 'listening') this.cancel()
    this.failedAudio = []
    this.set({ draft: '', interim: '', spoken: false, error: null, failed: 0, status: 'idle' })
  }
  /** The text is being sent / inserted: hand it over and start fresh. */
  consume(): string {
    const t = this.state.draft.trim()
    this.failedAudio = []
    this.set({ draft: '', interim: '', spoken: false, error: null, failed: 0, status: 'idle' })
    return t
  }

  // ------------------------------------------------------------ capture
  async start(opts: { replace?: boolean } = {}) {
    if (this.state.status === 'listening') return
    for (const [k, s] of sessions) if (k !== this.key && s.listening) s.pause() // one microphone listener at a time
    stopSpeaking() // never record NOVA's own voice
    if (opts.replace) this.set({ draft: '', spoken: false })
    this.base = this.state.draft
    const cap = ++this.capture
    this.seq = 0
    this.next = 0
    this.ready.clear()
    this.triedFallback = false
    this.set({ status: 'listening', interim: '', error: null, startedAt: Date.now(), level: 0 })
    const choice = await this.choose()
    if (cap !== this.capture) return
    if (choice !== 'local' && choice !== 'browser') return this.fail(choice)
    this.run(choice, cap)
  }

  /** Which path to use: NOVA's own offline speech when the server has it (reliable everywhere, Brave included);
   *  else the browser's recognizer, unless it is known to be blocked. Hindi prefers the browser (the local model is English). */
  private async choose(): Promise<'local' | 'browser' | string> {
    const perm = await micPermission()
    if (perm === 'denied') return deniedMessage()
    const sp = await serverSpeech()
    const browserOk = browserSpeechPresent() && !browserSpeechKnownBroken()
    const hindi = speechLang().startsWith('hi')
    if ((hindi || this.preferBrowser) && browserOk) return 'browser'
    if (sp.local && recordingSupported()) return 'local'
    if (browserOk) return 'browser'
    if (browserSpeechPresent()) return `This browser's speech service is blocked (Brave blocks it), and ${sp.localReason ? sp.localReason.charAt(0).toLowerCase() + sp.localReason.slice(1) : "NOVA's offline speech is not available"} ${SETUP_HINT} You can type meanwhile.`
    return `${sp.localReason ?? 'Voice input is not available.'} ${SETUP_HINT} You can type meanwhile.`
  }

  private run(kind: 'local' | 'browser', cap: number) {
    const live = () => cap === this.capture
    const ev = {
      onFinal: (t: string) => live() && this.set({ draft: joinText(this.state.draft, t), spoken: true }),
      onInterim: (t: string) => live() && this.set({ interim: t }),
      onSegment: (blob: Blob) => live() && void this.transcribe(blob, cap, this.seq++),
      onLevel: (l: number) => live() && this.state.status === 'listening' && Math.abs(l - this.state.level) > 0.05 && this.set({ level: l }),
      onEnd: () => {
        if (!live()) return
        setMicBusy(false)
        this.engine = null
        if (this.state.status === 'listening') this.set({ status: 'transcribing', interim: '', level: 0 })
        this.settle()
      },
      onError: (code: EngineErrorCode, msg: string) => {
        if (!live()) return
        // Brave: the browser recognizer exists but its service is blocked → switch to the local path once, same draft
        if (code === 'service' && kind === 'browser' && !this.triedFallback) {
          this.triedFallback = true
          void serverSpeech().then((sp) => {
            if (!live()) return
            if (sp.local && recordingSupported()) {
              this.engine?.cancel()
              this.preferBrowser = false
              this.set({ status: 'listening', error: null })
              this.run('local', cap)
            } else this.fail(`${msg} ${sp.localReason ?? ''} ${SETUP_HINT}`.replace(/\s+/g, ' '))
          })
          return
        }
        this.fail(msg)
      },
    }
    this.engine = kind === 'local' ? localEngine(ev) : browserEngine(ev, speechLang())
    this.set({ engine: kind })
    setMicBusy(true)
    void this.engine.start()
  }

  private inflight = new Map<AbortController, { blob: Blob; capture: number; index: number }>()
  /** Which capture is current: changes on start, cancel, retry and expiry (a caller holding an older one must stop). */
  get captureId() { return this.capture }

  private async transcribe(blob: Blob, cap: number, index: number) {
    this.set({ pending: this.state.pending + 1 })
    const ctl = new AbortController()
    this.aborts.add(ctl)
    this.inflight.set(ctl, { blob, capture: cap, index })
    try {
      const res = await api.transcribe(uuid(), blob, ctl.signal)
      if (cap !== this.capture) return
      this.ready.set(index, res.transcript ?? '')
    } catch (e) {
      if (cap !== this.capture || (e instanceof ApiFailure && e.code === 'CANCELLED')) return
      // keep the audio: nothing the student said is thrown away; Retry transcribes it again
      this.failedAudio.push({ blob, capture: cap, index })
      this.ready.set(index, '')
      const why = e instanceof ApiFailure ? (e.code === 'FEATURE_UNAVAILABLE' ? `${e.message} ${SETUP_HINT}` : e.message) : 'Transcription failed.'
      this.set({ error: `Part of what you said could not be turned into text yet: ${why}`, failed: this.failedAudio.length })
      if (e instanceof ApiFailure && e.code === 'FEATURE_UNAVAILABLE') void serverSpeech(true)
    } finally {
      this.aborts.delete(ctl)
      this.inflight.delete(ctl)
      if (cap === this.capture) {
        // append in the order the words were spoken, even if transcriptions finish out of order
        let d = this.state.draft
        let added = false
        while (this.ready.has(this.next)) {
          const t = this.ready.get(this.next)!
          this.ready.delete(this.next)
          this.next++
          if (t) { d = joinText(d, t); added = true }
        }
        this.set({ pending: Math.max(0, this.state.pending - 1), ...(added ? { draft: d, spoken: true } : {}) })
        this.settle()
      }
    }
  }

  /** Capture over and nothing pending: land in paused / ready (or error when audio is waiting for Retry). */
  private settle() {
    if (this.state.status !== 'transcribing' || this.state.pending > 0) return
    this.set({ status: this.failedAudio.length ? 'error' : this.after, startedAt: null })
  }

  private fail(msg: string) {
    setMicBusy(false)
    this.engine?.cancel()
    this.engine = null
    this.set({ status: 'error', error: msg, interim: '', level: 0, startedAt: null })
  }

  /** Pause: finish this capture (its words are kept); Resume continues the same draft. */
  pause() { this.finish('paused') }
  /** Stop: finish capturing and keep the transcript for checking. */
  stop() { this.finish('ready') }
  private finish(after: 'paused' | 'ready') {
    this.after = after
    if (this.state.status !== 'listening') {
      if (this.state.status === 'error' && !this.failedAudio.length) this.set({ status: this.state.draft ? after : 'idle' })
      return
    }
    // live words not yet finalized are kept
    if (this.state.interim) this.set({ draft: joinText(this.state.draft, this.state.interim), interim: '', spoken: true })
    this.set({ status: 'transcribing', level: 0 })
    if (this.engine) this.engine.stop()
    else this.settle()
  }

  /** Done: finish capturing and wait (bounded) for the last words to be transcribed. Resolves with the final draft,
   *  or null if transcription did not finish in time / failed (the draft and kept audio stay for Retry or editing). */
  async finishAndWait(ms = 15_000): Promise<string | null> {
    const cap = this.capture
    if (this.state.status === 'listening') this.stop()
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (this.capture !== cap) return null // cancelled, restarted or retried meanwhile: this wait is over
      const st = this.state.status
      if (st === 'ready' || st === 'paused' || st === 'idle') return this.state.draft.trim() || null
      if (st === 'error') return null
      await new Promise((r) => setTimeout(r, 100))
    }
    if (this.capture === cap) this.expire(ms)
    return null
  }

  /** Transcription took too long: unlock the box with the words already transcribed. The unfinished parts are stopped
   *  and their audio kept for an explicit Retry — a late result can never land on top of the student's edits. */
  private expire(ms: number) {
    this.capture++ // isolates the expired operation: anything still arriving for it is ignored
    for (const [ctl, it] of this.inflight) {
      this.failedAudio.push(it)
      ctl.abort()
    }
    this.inflight.clear()
    this.aborts.clear()
    this.engine?.cancel()
    this.engine = null
    setMicBusy(false)
    this.ready.clear()
    this.set({
      status: 'error', pending: 0, interim: '', level: 0, startedAt: null, failed: this.failedAudio.length,
      error: `The last part was still being transcribed after ${Math.round(ms / 1000)} s. The words so far are kept and editable — send them, or press Retry transcription for the rest.`,
    })
  }

  /** Cancel: discard only what this capture added; the earlier draft (and the student's edits) stay. */
  cancel() {
    const dropped = this.capture
    this.capture++
    this.engine?.cancel()
    this.engine = null
    setMicBusy(false)
    this.aborts.forEach((c) => c.abort())
    this.aborts.clear()
    this.failedAudio = this.failedAudio.filter((f) => f.capture !== dropped)
    this.set({ status: this.base ? 'ready' : 'idle', draft: this.base, interim: '', pending: 0, level: 0, startedAt: null, error: null, failed: this.failedAudio.length })
  }

  /** Transcribe the kept audio again (after the server came back or the model was set up). */
  async retry() {
    const items = this.failedAudio.splice(0)
    if (!items.length) return
    const cap = ++this.capture
    this.ready.clear()
    this.next = 0
    this.after = this.state.status === 'error' ? 'ready' : this.after
    this.set({ status: 'transcribing', error: null, failed: 0 })
    await serverSpeech(true)
    items.forEach((it, k) => void this.transcribe(it.blob, cap, k))
  }

  /** Leaving the page/app: stop the microphone (the draft stays saved). */
  release() {
    if (this.state.status === 'listening') this.finish('paused')
  }
}

export function useVoice(key: 'ask' | 'dictate'): [VoiceState, VoiceSession] {
  const s = voiceSession(key)
  return [useSyncExternalStore(s.subscribe, s.get), s]
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => sessions.forEach((s) => s.release()))
}
