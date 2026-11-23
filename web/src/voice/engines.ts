// The two ways NOVA can turn speech into text. Exactly one runs at a time (one microphone listener).
//  - local:   MediaRecorder → /api/v1/transcribe → faster-whisper on this computer (₹0, works in Brave).
//             Audio is cut into segments at natural pauses (and at the length limit), each transcribed on its own,
//             so a pause never loses words and a long answer never hits the server limit.
//  - browser: the browser's own SpeechRecognition (Chrome/Edge/Safari). Live words; restarts itself when the browser
//             ends a session on a pause; final results are de-duplicated per result index.

export interface EngineEvents {
  onFinal(text: string): void // a finished piece of speech (browser engine)
  onInterim(text: string): void // live, not yet final (browser engine)
  onSegment(audio: Blob): void // a finished piece of audio to transcribe (local engine)
  onLevel?(level: number): void // 0..1 microphone level
  onEnd(): void // capture has fully stopped and the microphone is released
  onError(code: EngineErrorCode, message: string): void // fatal for this capture
}
export type EngineErrorCode = 'denied' | 'no-mic' | 'insecure' | 'unsupported' | 'service' | 'failed'
export interface Engine {
  readonly kind: 'local' | 'browser'
  start(): Promise<void>
  stop(): void // finish: deliver what was heard, then onEnd
  cancel(): void // discard: no more events except onEnd
}

export const SEGMENT_MAX_MS = 18_000 // under the server's 20 s limit: a long answer becomes several segments
const SILENCE_MS = 900 // a pause this long after speech closes the segment (the words are transcribed meanwhile)
const SPEECH_RMS = 0.02

export function deniedMessage(): string {
  const brave = (navigator as { brave?: unknown }).brave !== undefined
  return brave
    ? 'Microphone is blocked for this site. In Brave, click the icon at the left of the address bar → Site settings → Microphone → Allow, then press the mic again.'
    : 'Microphone is blocked for this site. Click the icon at the left of the address bar, allow the microphone, then press the mic again.'
}

export async function micPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const st = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
    return (st?.state as 'granted' | 'denied' | 'prompt') ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

// ---------------------------------------------------------------- local (recorder + faster-whisper)
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
export function recordingSupported(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function localEngine(ev: EngineEvents): Engine {
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let rec: MediaRecorder | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let cancelled = false
  let stopping = false
  let ended = false
  let segStart = 0, speechMs = 0, silenceMs = 0, lastTick = 0
  const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m))
  const release = () => {
    clearInterval(timer)
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    void ctx?.close().catch(() => undefined)
    ctx = null
  }
  const end = () => {
    if (ended) return
    ended = true
    release()
    ev.onEnd()
  }
  const newSegment = () => {
    if (!stream) return
    const chunks: Blob[] = []
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const hadSpeech = { v: false }
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    r.onstop = () => {
      if (!cancelled && hadSpeech.v && chunks.length) ev.onSegment(new Blob(chunks, { type: r.mimeType || mime || 'audio/webm' }))
      if (stopping && r === rec) end()
    }
    r.onerror = () => {
      if (!cancelled) ev.onError('failed', 'Recording stopped unexpectedly. What was already heard is kept.')
      end()
    }
    r.start(250)
    rec = r
    ;(r as unknown as { _speech: { v: boolean } })._speech = hadSpeech
    segStart = performance.now()
    speechMs = 0
    silenceMs = 0
  }
  const rotate = () => {
    const old = rec
    newSegment()
    if (old && old.state !== 'inactive') old.stop()
  }
  return {
    kind: 'local',
    async start() {
      if (!window.isSecureContext) { ev.onError('insecure', 'The microphone needs a secure page (https or localhost).'); end(); return }
      if (!recordingSupported()) { ev.onError('unsupported', 'This browser cannot record audio.'); end(); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      } catch (e) {
        const name = (e as DOMException)?.name
        if (name === 'NotAllowedError' || name === 'SecurityError') ev.onError('denied', deniedMessage())
        else ev.onError('no-mic', 'No microphone was found. Plug one in (or check Windows sound settings), then try again.')
        end()
        return
      }
      if (cancelled) { end(); return }
      try {
        ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(stream)
        const an = ctx.createAnalyser()
        an.fftSize = 1024
        src.connect(an)
        const buf = new Float32Array(an.fftSize)
        lastTick = performance.now()
        timer = setInterval(() => {
          if (!rec || stopping) return
          an.getFloatTimeDomainData(buf)
          let sum = 0
          for (const v of buf) sum += v * v
          const rms = Math.sqrt(sum / buf.length)
          ev.onLevel?.(Math.min(1, rms * 8))
          const now = performance.now(), dt = now - lastTick
          lastTick = now
          const speaking = rms > SPEECH_RMS
          if (speaking) { speechMs += dt; silenceMs = 0; if (speechMs > 150) (rec as unknown as { _speech: { v: boolean } })._speech.v = true }
          else silenceMs += dt
          const seg = now - segStart
          // a natural pause after speech, or the length limit: close this segment and keep listening
          if ((speechMs > 300 && silenceMs > SILENCE_MS) || seg > SEGMENT_MAX_MS) rotate()
        }, 80)
      } catch {
        // no analyser (very old browser): one segment per capture, still capped by the limit
        timer = setInterval(() => { if (rec && performance.now() - segStart > SEGMENT_MAX_MS) rotate() }, 500)
      }
      newSegment()
      if (!ctx) (rec as unknown as { _speech: { v: boolean } })._speech.v = true
    },
    stop() {
      if (stopping || ended) return
      stopping = true
      if (rec && rec.state !== 'inactive') rec.stop()
      else end()
    },
    cancel() {
      cancelled = true
      stopping = true
      if (rec && rec.state !== 'inactive') rec.stop()
      else end()
    },
  }
}

// ---------------------------------------------------------------- browser SpeechRecognition
interface SRResult { isFinal: boolean; 0?: { transcript: string } }
interface SR {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<SRResult> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onaudiostart: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
function srCtor(): (new () => SR) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}
export const browserSpeechPresent = () => typeof window !== 'undefined' && srCtor() !== null
const mobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

// a browser whose speech service failed (Brave blocks Google's) is remembered for a day, so the next tap goes local
const BROKEN_KEY = 'nova.browserSpeechBroken'
export function browserSpeechKnownBroken(): boolean {
  try {
    const t = Number(localStorage.getItem(BROKEN_KEY) || 0)
    return Date.now() - t < 86_400_000
  } catch {
    return false
  }
}
function markBrowserSpeechBroken() {
  try { localStorage.setItem(BROKEN_KEY, String(Date.now())) } catch { /* private mode */ }
}

/** Final pieces after the ones already delivered: Android repeats the whole phrase in each new final result. */
export function newPart(prev: string, next: string): string {
  const p = prev.trim().toLowerCase(), n = next.trim()
  if (p && n.toLowerCase().startsWith(p)) return n.slice(p.length).trim()
  return n
}

export function browserEngine(ev: EngineEvents, lang: string): Engine {
  const C = srCtor()
  let r: SR | null = null
  let wanted = true
  let cancelled = false
  let ended = false
  let heardAnything = false
  let quickEnds = 0
  let sessionStart = 0
  let interim = ''
  const end = () => { if (!ended) { ended = true; ev.onEnd() } }
  const run = () => {
    if (!C) return
    const s = new C()
    r = s
    s.lang = lang
    s.interimResults = true
    s.continuous = !mobile() // Android repeats words in continuous mode: there, each phrase is its own session
    const delivered = new Map<number, string>()
    let lastFinal = ''
    sessionStart = performance.now()
    s.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const txt = (res[0]?.transcript ?? '').replace(/\s+/g, ' ').trim()
        if (!txt) continue
        heardAnything = true
        if (res.isFinal) {
          if (delivered.has(i)) continue // the same final result delivered twice
          delivered.set(i, txt)
          const part = newPart(lastFinal, txt)
          lastFinal = txt
          if (part && !cancelled) ev.onFinal(part)
        } else live += (live ? ' ' : '') + txt
      }
      interim = live
      if (!cancelled) ev.onInterim(live)
    }
    s.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return // a quiet moment: the session restarts
      wanted = false
      if (e.error === 'not-allowed') ev.onError('denied', deniedMessage())
      else if (e.error === 'audio-capture') ev.onError('no-mic', 'No microphone was found. Plug one in, then try again.')
      else if (e.error === 'network' || e.error === 'service-not-allowed') {
        if (!heardAnything) markBrowserSpeechBroken()
        ev.onError('service', "This browser's speech service is not reachable (Brave blocks it).")
      } else ev.onError('failed', `Speech recognition stopped (${e.error}).`)
    }
    s.onend = () => {
      // words still showing as "live" when the session ends are kept, not dropped
      if (interim && !cancelled) ev.onFinal(interim)
      interim = ''
      if (!cancelled) ev.onInterim('')
      if (wanted && !cancelled) {
        // the browser ends a session on a pause: start a new one (but not in a tight loop)
        quickEnds = performance.now() - sessionStart < 400 ? quickEnds + 1 : 0
        if (quickEnds >= 5) { ev.onError('failed', 'Speech recognition keeps stopping. What was heard is kept.'); return end() }
        try { run(); return } catch { /* fall through */ }
      }
      end()
    }
    s.start()
  }
  return {
    kind: 'browser',
    async start() {
      if (!C) { ev.onError('unsupported', 'This browser has no speech recognition.'); end(); return }
      try { run() } catch { ev.onError('failed', 'Speech recognition could not start.'); end() }
    },
    stop() { wanted = false; try { r?.stop() } catch { end() } },
    cancel() { cancelled = true; wanted = false; try { r?.abort() } catch { /* */ } end() },
  }
}
