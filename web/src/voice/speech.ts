// NOVA's spoken replies (the device's own speech synthesis, ₹0). The text and the page always carry the same content,
// so nothing is lost when audio can't play. Never speaks while the microphone is listening (no recording itself).

import { useSyncExternalStore } from 'react'

export type SpeakStatus = 'idle' | 'loading' | 'speaking' | 'blocked' | 'error'
export interface SpeakState { key: string | null; status: SpeakStatus; message: string | null }

let state: SpeakState = { key: null, status: 'idle', message: null }
const subs = new Set<() => void>()
const set = (p: Partial<SpeakState>) => { state = { ...state, ...p }; subs.forEach((f) => f()) }
export const speakState = () => state
export function useSpeakState(): SpeakState {
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), speakState)
}

let micBusy = false
/** Set by the voice session while the microphone is open. */
export function setMicBusy(v: boolean) {
  micBusy = v
  if (v) stopSpeaking()
}

export function speechOutputSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// ---------------------------------------------------------------- spoken-reply preference (on unless muted)
export function voiceRepliesOn(): boolean {
  try { return localStorage.getItem('nova.voiceReplies') !== 'off' } catch { return true }
}
export function setVoiceReplies(on: boolean) {
  try { localStorage.setItem('nova.voiceReplies', on ? 'on' : 'off') } catch { /* private mode */ }
  if (!on) stopSpeaking()
  set({})
}

// ---------------------------------------------------------------- voices
let voicesP: Promise<SpeechSynthesisVoice[]> | null = null
/** Voices load asynchronously in Chromium (Brave/Chrome/Edge): wait for voiceschanged, briefly. */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechOutputSupported()) return Promise.resolve([])
  const now = window.speechSynthesis.getVoices()
  if (now.length) return Promise.resolve(now)
  return (voicesP ??= new Promise((resolve) => {
    const done = () => {
      const v = window.speechSynthesis.getVoices()
      if (v.length) { window.speechSynthesis.removeEventListener?.('voiceschanged', done); resolve(v) }
    }
    window.speechSynthesis.addEventListener?.('voiceschanged', done)
    setTimeout(() => { voicesP = null; resolve(window.speechSynthesis.getVoices()) }, 2000)
  }))
}

/** Best voice for the language: exact match (local voices first), then the same language, then any English, then default. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const l = lang.toLowerCase(), base = l.split('-')[0]
  const rank = (v: SpeechSynthesisVoice) => (v.localService ? 0 : 1)
  const by = (f: (v: SpeechSynthesisVoice) => boolean) => voices.filter(f).sort((a, b) => rank(a) - rank(b))[0]
  return by((v) => v.lang.toLowerCase().replace('_', '-') === l) ?? by((v) => v.lang.toLowerCase().startsWith(base)) ?? by((v) => v.lang.toLowerCase().startsWith('en')) ?? voices.find((v) => v.default)
}

export function replyLang(): string {
  try {
    if (localStorage.getItem('nova.voiceLang') === 'hi') return 'hi-IN'
  } catch { /* */ }
  return 'en-IN'
}

// ---------------------------------------------------------------- maths read aloud
const SUPS: Record<string, string> = { '²': '^2', '³': '^3', '⁴': '^4', '⁵': '^5', '⁰': '^0', '¹': '^1', 'ⁿ': '^n' }
const SUBS: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' }
const POW_WORD: Record<string, string> = { '2': 'squared', '3': 'cubed' }

/** "∫₀² x² dx = 8/3" → "the integral from 0 to 2 of x squared, d x, equals 8 over 3". No LaTeX commands are read aloud. */
export function mathToSpeech(input: string): string {
  let s = ` ${input} `
  // LaTeX
  s = s.replace(/\$+/g, ' ').replace(/([\^_])\{([^{}]*)\}/g, '$1($2)')
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' $1 over $2 ')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, ' the square root of $1 ')
    .replace(/\\int_?\{?([^}\s^]*)\}?\^?\{?([^}\s]*)\}?/g, (_, a: string, b: string) => (a && b ? ` the integral from ${a} to ${b} of ` : ' the integral of '))
    .replace(/\\(cdot|times)/g, ' times ').replace(/\\div/g, ' divided by ').replace(/\\pm/g, ' plus or minus ')
    .replace(/\\(le|leq)/g, ' is less than or equal to ').replace(/\\(ge|geq)/g, ' is greater than or equal to ').replace(/\\ne(q)?/g, ' is not equal to ')
    .replace(/\\(pi|theta|alpha|beta|lambda|infty)/g, (_, g: string) => ` ${g === 'infty' ? 'infinity' : g} `)
    .replace(/\\(left|right|,|;|!|quad|displaystyle|mathrm|text)/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}]/g, ' ')
  // unicode super/subscripts into ^n and plain digits
  s = s.replace(/[²³⁴⁵⁰¹ⁿ]/g, (c) => SUPS[c]).replace(/[₀₁₂₃₄₅₆₇₈₉]+/g, (m) => `_${[...m].map((c) => SUBS[c]).join('')}`)
  // calculus
  s = s.replace(/∫_\(?([^\s^)]+)\)?\^\(?([^\s)]+)\)?/g, ' the integral from $1 to $2 of ').replace(/∫/g, ' the integral of ')
    .replace(/\bd\/d([a-z])\b/g, ' d by d $1 of ').replace(/\bd([a-z])\b(?=\s*(=|$|\)|,|\.))/g, ' d $1 ')
  s = s.replace(/√\(?/g, ' the square root of ').replace(/\bsqrt\(/g, ' the square root of (')
  // powers
  s = s.replace(/\^\(?(-?[\w.]+)\)?/g, (_, e: string) => ` ${POW_WORD[e] ?? `to the power ${e}`} `)
  // operators and relations
  s = s.replace(/≤/g, ' is less than or equal to ').replace(/≥/g, ' is greater than or equal to ').replace(/≠/g, ' is not equal to ')
    .replace(/[×·]|(?<=[\d)a-z]\s*)\*(?=\s*[\d(a-z])/g, ' times ').replace(/÷/g, ' divided by ').replace(/±/g, ' plus or minus ')
    .replace(/π/g, ' pi ').replace(/θ/g, ' theta ').replace(/∞/g, ' infinity ')
    .replace(/(?<=[\w)\s])\s*=\s*/g, ' equals ').replace(/\s*<\s*/g, ' is less than ').replace(/\s*>\s*/g, ' is greater than ')
    .replace(/(?<=[\w)]\s*)\+(?=\s*[\w(])/g, ' plus ').replace(/(?<=[\w)]\s+)[−-](?=\s+[\w(])|(?<=[\d)]|\b[a-z])[−-](?=[\d(]|[a-z]\b)/g, ' minus ').replace(/(^|[\s(=])[−-](?=[\d(a-z])/g, '$1 minus ')
    .replace(/(\d)\s*\/\s*(\d)/g, '$1 over $2').replace(/(?<=[\w)])\s*\/\s*(?=[\w(])/g, ' over ')
    .replace(/\b(\d+)([a-z])\b/g, '$1 $2')
    .replace(/\bsin\b/g, 'sine').replace(/\bcos\b/g, 'cos').replace(/\btan\b/g, 'tan').replace(/\bln\b/g, 'natural log')
  return s.replace(/[_|]/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------- speaking
let queue: SpeechSynthesisUtterance[] = []
let watchdog: ReturnType<typeof setTimeout> | undefined

/** Speak `text` (the reply's key lets the UI show Stop/Replay on the right bubble). Returns false when it can't start now
 *  (microphone open, no speech support); the UI then offers Play. Long text is spoken sentence by sentence
 *  (Chromium cuts single long utterances off). */
export async function speak(text: string, key: string, onEnd?: () => void): Promise<boolean> {
  if (!speechOutputSupported()) { set({ key, status: 'error', message: "This browser can't read replies aloud. The reply is shown on screen." }); return false }
  if (micBusy) { set({ key, status: 'blocked', message: 'The microphone is on, so NOVA stayed quiet. Press Play to hear the reply.' }); return false }
  stopSpeaking()
  set({ key, status: 'loading', message: null })
  const voices = await loadVoices()
  if (state.key !== key) return false // a newer reply (or Stop) took over while voices loaded
  const lang = replyLang()
  const voice = pickVoice(voices, lang)
  const spoken = mathToSpeech(text)
  const parts = spoken.match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [spoken]
  let started = false
  queue = parts.map((p, i) => {
    const u = new SpeechSynthesisUtterance(p)
    u.lang = voice?.lang ?? lang
    if (voice) u.voice = voice
    u.rate = 1
    u.onstart = () => {
      started = true
      clearTimeout(watchdog)
      if (state.key === key) set({ status: 'speaking', message: null })
    }
    u.onend = () => {
      if (i === parts.length - 1 && state.key === key) {
        set({ key: null, status: 'idle', message: null })
        onEnd?.()
      }
    }
    u.onerror = (e) => {
      clearTimeout(watchdog)
      if (state.key !== key) return
      const err = (e as SpeechSynthesisErrorEvent).error
      if (err === 'interrupted' || err === 'canceled') return
      if (err === 'not-allowed') set({ status: 'blocked', message: 'The browser blocked automatic sound. Press Play to hear the reply.' })
      else set({ status: 'error', message: `NOVA's voice could not play (${err}). The reply is shown on screen.` })
    }
    return u
  })
  queue.forEach((u) => window.speechSynthesis.speak(u))
  // no start within a moment: the browser is holding audio until the user taps (autoplay rules)
  watchdog = setTimeout(() => {
    if (!started && state.key === key && state.status === 'loading') {
      window.speechSynthesis.cancel()
      set({ status: 'blocked', message: 'The browser did not start the voice by itself. Press Play to hear the reply.' })
    }
  }, 2500)
  return true
}

export function stopSpeaking() {
  clearTimeout(watchdog)
  queue = []
  if (speechOutputSupported()) window.speechSynthesis.cancel()
  if (state.status !== 'idle' || state.key) set({ key: null, status: 'idle', message: null })
}

export function speakingKey() {
  return state.status === 'speaking' || state.status === 'loading' ? state.key : null
}
