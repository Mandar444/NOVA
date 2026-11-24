// Latency trace for one handwritten line: pen-up → schedule → image → recognise → exact maths → ink on the page.
// Stages are performance marks named "nova-trace" (detail: key = regionId:sourceHash, stage, extra numbers), so a test can
// read elapsed times within the browser alone. No effect on behaviour.

export type TraceStage =
  | 'pen-up' | 'queued' | 'cooldown' | 'read-start' | 'img' | 'rec-end' | 'rec-fail' | 'stale-drop'
  | 'auto-start' | 'auto-end' | 'auto-fail' | 'ink' | 'aborted' | 'deadline' | 'local' | 'local-fail' | 'cross-check' | 'help-start' | 'help-reply' | 'help-applied' | 'clarify'

export function trace(key: string, stage: TraceStage, extra: Record<string, unknown> = {}) {
  try {
    performance.mark('nova-trace', { detail: { key, stage, ...extra } })
  } catch {
    /* old browsers: no detail marks */
  }
}

/** "total=812;provider=790;calls=1" from the server's X-Nova-Timing header. */
export function parseTiming(h: string | null): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of (h ?? '').split(';')) {
    const [k, v] = part.split('=')
    if (k && v && !Number.isNaN(Number(v))) out[k.trim()] = Number(v)
  }
  return out
}
