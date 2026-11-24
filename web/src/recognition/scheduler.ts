// Automatic reading after a pause. Up to two recognitions in flight (different lines), one latest pending region.
// idle -> dirty -> waiting_for_pause -> recognizing -> (reading stored by caller) | failed
// Each attempt carries the time its line was last changed: the end-to-end budget (pause, queue, provider, retry) starts there.
// A line that changes while it is being read has that read cancelled at once: it is obsolete and must not hold a slot.

export type ReadPhase = 'dirty' | 'waiting_for_pause' | 'recognizing' | 'failed'

/** One absolute deadline + one cancellation signal for a whole help request (Explain / Solve …): every stage uses what
 *  is left of it — queueing, joining a read already running, recognition, waits — and none restarts the clock. */
export interface HelpBudget { deadline: number; signal: AbortSignal }

export class BudgetError extends Error {
  code: 'TIMEOUT' | 'CANCELLED'
  constructor(code: 'TIMEOUT' | 'CANCELLED', message: string) { super(message); this.code = code }
}

/** Resolve with `p`, or reject when the budget's deadline passes or it is cancelled — whichever comes first. */
export function within<T>(p: Promise<T>, budget: HelpBudget | undefined, now: () => number = Date.now): Promise<T> {
  if (!budget) return p
  if (budget.signal.aborted) return Promise.reject(new BudgetError('CANCELLED', 'Stopped.'))
  const left = budget.deadline - now()
  if (left <= 0) return Promise.reject(new BudgetError('TIMEOUT', 'deadline'))
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new BudgetError('TIMEOUT', 'deadline')) }, left)
    const onAbort = () => { cleanup(); reject(new BudgetError('CANCELLED', 'Stopped.')) }
    const cleanup = () => { clearTimeout(t); budget.signal.removeEventListener('abort', onAbort) }
    budget.signal.addEventListener('abort', onAbort)
    p.then((v) => { cleanup(); resolve(v) }, (e) => { cleanup(); reject(e) })
  })
}

export interface SchedulerOptions {
  pauseMs?: number
  cooldownMs?: number
  sessionCap?: number
  maxInflight?: number
  run: (regionId: string, auto: boolean, changedAt: number, budget?: HelpBudget) => Promise<void>
  /** Cancel the in-flight read of this region (its content changed, or the student pressed Stop). */
  cancel?: (regionId: string) => void
  /** The region already has a reading of its current content: nothing to do. */
  isFresh?: (regionId: string) => boolean
  onPhase: (regionId: string, phase: ReadPhase | null, error?: string) => void
  onCapReached?: () => void
  now?: () => number
}

const mark = (key: string, stage: string, extra: Record<string, unknown> = {}) => {
  try {
    performance.mark('nova-trace', { detail: { key, stage, ...extra } })
  } catch {
    /* no detail marks */
  }
}

export class RecognitionScheduler {
  assist = false
  autoCount = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private timerRegion: string | null = null
  private inflight = new Map<string, Promise<void>>()
  private pending: string | null = null
  private changedAt = new Map<string, number>()
  private lastAutoAt = -Infinity
  private readonly o: Required<Omit<SchedulerOptions, 'onCapReached' | 'cancel' | 'isFresh'>> & Pick<SchedulerOptions, 'onCapReached' | 'cancel' | 'isFresh'>

  constructor(opts: SchedulerOptions) {
    this.o = { pauseMs: 2000, cooldownMs: 1000, sessionCap: 60, maxInflight: 2, now: () => Date.now(), ...opts }
  }

  /** A stroke was committed into (or removed from) a region. */
  contentChanged(regionId: string) {
    this.changedAt.set(regionId, this.o.now())
    // a read of the old content is obsolete: free its slot now instead of waiting for the provider
    if (this.inflight.has(regionId)) this.o.cancel?.(regionId)
    this.o.onPhase(regionId, 'dirty')
    if (!this.assist) return
    this.clearTimer()
    this.timerRegion = regionId
    this.o.onPhase(regionId, 'waiting_for_pause')
    this.timer = setTimeout(() => this.fireAuto(regionId), this.o.pauseMs)
  }

  /** New pen contact cancels the pause timer; the region remains dirty. */
  penDown() {
    if (this.timer && this.timerRegion) this.o.onPhase(this.timerRegion, 'dirty')
    this.clearTimer()
  }

  /** Re-arm after pen up if a region is still waiting (e.g. a tap that produced no stroke). Never re-reads fresh content. */
  penUp(lastRegionId: string | null) {
    if (!this.assist || !lastRegionId || this.timer || this.inflight.has(lastRegionId)) return
    if (this.o.isFresh?.(lastRegionId)) return
    this.contentChanged(lastRegionId)
  }

  /** Explicit Read now / help flush: bypasses pause, cooldown and the automatic cap. With a help budget, joining a read
   *  already running and waiting for a free slot are both bounded by it, and the read itself gets only what is left. */
  async readNow(regionId: string, budget?: HelpBudget): Promise<void> {
    if (this.timerRegion === regionId) this.clearTimer()
    if (this.pending === regionId) this.pending = null
    const running = this.inflight.get(regionId)
    if (running) return within(running, budget, this.o.now)
    while (this.inflight.size >= this.o.maxInflight) await within(Promise.race([...this.inflight.values()]).catch(() => undefined), budget, this.o.now)
    if (budget?.signal.aborted) throw new BudgetError('CANCELLED', 'Stopped.')
    if (budget && budget.deadline <= this.o.now()) throw new BudgetError('TIMEOUT', 'deadline')
    return this.start(regionId, false, this.o.now(), budget)
  }

  isBusy() {
    return this.inflight.size > 0
  }

  /** Stop: cancel every read in flight and anything waiting. */
  cancelAll() {
    this.clearTimer()
    this.pending = null
    for (const id of [...this.inflight.keys()]) this.o.cancel?.(id)
  }

  dispose() {
    this.clearTimer()
    this.pending = null
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.timerRegion = null
  }

  private fireAuto(regionId: string) {
    this.timer = null
    this.timerRegion = null
    if (!this.assist) return
    if (this.autoCount >= this.o.sessionCap) {
      this.o.onPhase(regionId, 'dirty')
      this.o.onCapReached?.()
      return
    }
    if (this.inflight.has(regionId) || this.inflight.size >= this.o.maxInflight) {
      // still winding down a cancelled read of this line, or both slots busy: read it as soon as one frees
      this.pending = regionId // keep only the latest
      mark(regionId, 'queued', { inflight: this.inflight.size })
      return
    }
    const wait = this.lastAutoAt + this.o.cooldownMs - this.o.now()
    if (wait > 0) {
      mark(regionId, 'cooldown', { ms: wait })
      this.timerRegion = regionId
      this.timer = setTimeout(() => this.fireAuto(regionId), wait)
      return
    }
    this.lastAutoAt = this.o.now()
    this.autoCount++
    void this.start(regionId, true, this.changedAt.get(regionId) ?? this.o.now()).catch(() => undefined)
  }

  private start(regionId: string, auto: boolean, changedAt: number, budget?: HelpBudget): Promise<void> {
    this.o.onPhase(regionId, 'recognizing')
    const promise: Promise<void> = this.o
      .run(regionId, auto, changedAt, budget)
      .then(() => this.o.onPhase(regionId, null))
      .catch((e: unknown) => {
        const code = (e as { code?: string })?.code
        // cancelled because the line changed (a new read is coming) or Stop: not a failure to show
        if (code === 'CANCELLED') this.o.onPhase(regionId, 'dirty')
        else this.o.onPhase(regionId, 'failed', (e as Error)?.message ?? 'Reading failed')
        throw e
      })
      .finally(() => {
        if (this.inflight.get(regionId) === promise) this.inflight.delete(regionId)
        const next = this.pending
        this.pending = null
        if (next && this.assist && !this.timer) this.fireAuto(next)
      })
    this.inflight.set(regionId, promise)
    return promise
  }
}
