// Browser-side handwriting reader (public/reader/worker.mjs). Feature-flagged; any failure falls back to the cloud path.
// Flag: on by default. Turn OFF with ?localReader=0 or localStorage["nova.localReader"]="off" (instant rollback).
import type { Point } from '../notebook/types'

export interface LocalToken { label: string; p: number; alternatives: { label: string; p: number }[]; bbox: { minx: number; maxx: number; miny: number; maxy: number; w: number; h: number }; strokeIdx: number[] }
export interface LocalQuestion { index: number; question: string; options: string[] }
export interface LocalResult {
  status: 'answer' | 'checked' | 'expression' | 'number' | 'unfinished' | 'clarify' | 'unsupported'
  literal: string; result: string | null; verdict: 'correct' | 'incorrect' | null; reason: string
  clarify: LocalQuestion[]; guards: { index: number; guard: string }[]; tokens: LocalToken[]
  reliable: boolean; gate: string[]
}
export interface LocalAnswers { labels?: Record<number, string>; oneNumber?: number[]; twoNumbers?: number[] }
export interface LocalRead { result: LocalResult; ms: number; model: { run?: string; candidate?: string | null } | null }

export function localReaderEnabled(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('localReader')
    if (q === '0' || q === 'off') return false
    if (q === '1' || q === 'on') return true
    return localStorage.getItem('nova.localReader') !== 'off'
  } catch {
    return true
  }
}

let worker: Worker | null = null
let ready: Promise<void> | null = null
let broken: string | null = null
let seq = 0
const waiting = new Map<number, { resolve: (r: LocalRead) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
export const localStats = { loadMs: null as number | null, reads: 0, lastMs: null as number | null, model: null as unknown }

function start(): Promise<void> {
  if (broken) return Promise.reject(new Error(broken))
  if (ready) return ready
  ready = new Promise<void>((resolve, reject) => {
    try {
      worker = new Worker(new URL('/reader/worker.mjs', location.href), { type: 'module' })
    } catch (e) {
      broken = 'local reader unavailable: ' + (e as Error).message
      return reject(new Error(broken))
    }
    const t = setTimeout(() => { broken = 'local reader did not load in 15 s'; reject(new Error(broken)) }, 15000)
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data
      if (m.type === 'ready') { clearTimeout(t); localStats.loadMs = m.ms; localStats.model = m.model; try { performance.mark('nova-trace', { detail: { key: 'local-model', stage: 'local-ready', ms: m.ms } }) } catch { /* */ } resolve() }
      else if (m.type === 'error') { clearTimeout(t); broken = 'local reader failed to load: ' + m.message; reject(new Error(broken)) }
      else if (m.type === 'result') {
        const w = waiting.get(m.id)
        if (!w) return // superseded / timed out: stale result ignored
        waiting.delete(m.id); clearTimeout(w.timer)
        if (m.error) w.reject(new Error(m.error))
        else { localStats.reads++; localStats.lastMs = m.ms; w.resolve({ result: m.result, ms: m.ms, model: m.model }) }
      }
    }
    worker.onerror = (e) => { clearTimeout(t); broken = 'local reader crashed: ' + (e.message || 'worker error'); reject(new Error(broken)); for (const [, w] of waiting) w.reject(new Error(broken)); waiting.clear() }
    worker.postMessage({ type: 'init' })
  })
  return ready
}

/** Warm the model in the background (e.g. when a notebook opens). Never throws. */
export function warmLocalReader() { if (localReaderEnabled()) start().catch(() => undefined) }

/** Read one line of strokes locally. Rejects (→ caller uses the cloud path) on load failure or after `timeoutMs`. */
export async function readLocally(strokes: Point[][], answers: LocalAnswers = {}, timeoutMs = 3000): Promise<LocalRead> {
  await start()
  const id = ++seq
  return new Promise<LocalRead>((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('local reader timed out')) }, timeoutMs)
    waiting.set(id, { resolve, reject, timer })
    worker!.postMessage({ type: 'read', id, strokes: strokes.map((s) => s.map((p) => ({ x: p.x, y: p.y }))), answers })
  })
}

/** The local literal in the exact engine's notation (same text the cloud reader would give). */
export const engineText = (literal: string) => literal.replace(/\s+/g, ' ').trim()
