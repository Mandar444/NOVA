// NOVA local handwriting reader — Web Worker (keeps recognition off the drawing thread). The model loads ONCE per page.
// Messages in:  {type:'init'} · {type:'read', id, strokes:[[{x,y}]], answers}
// Messages out: {type:'ready', ms, model} · {type:'error', message} · {type:'result', id, ms, result}
// result = v3g readLine output + a RELIABILITY GATE deciding whether NOVA may handle the line locally (no cloud).
import { loadModel, readLine, groupStrokes, lineGeometry } from './nova-reader-v3g.mjs'

let model = null, loading = null, modelInfo = null
async function init() {
  if (model) return model
  loading ??= (async () => {
    const t0 = performance.now()
    const [meta, buf] = await Promise.all([fetch('./model/model.json').then((r) => { if (!r.ok) throw new Error('model.json ' + r.status); return r.json() }), fetch('./model/weights.bin').then((r) => { if (!r.ok) throw new Error('weights ' + r.status); return r.arrayBuffer() })])
    model = loadModel(meta, buf)
    modelInfo = { run: meta.run, candidate: meta.candidate?.name ?? null, temperature: meta.temperature ?? 1, thresholds: meta.thresholds, bytes: buf.byteLength }
    postMessage({ type: 'ready', ms: Math.round(performance.now() - t0), model: modelInfo })
    return model
  })().catch((e) => { loading = null; postMessage({ type: 'error', message: String(e && e.message || e) }); throw e })
  return loading
}

// Automatic local handling only where reliability was demonstrated (stage-1 reports): digits with + − × = on one line,
// every symbol ≥ 0.9, no guard/question, no "small digit" (a "." or "," read as a digit), no merged-looking group.
const LOCAL_OK = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', '×', '='])
const CONFIDENT = new Set(['answer', 'checked', 'expression', 'number', 'unfinished'])
function gate(r, strokes, meta) {
  const why = []
  if (!CONFIDENT.has(r.status)) why.push(`status ${r.status}`)
  if (r.clarify?.length) why.push('has questions')
  if (r.guards?.length) why.push('1-vs-/ guard')
  const groups = groupStrokes(strokes, meta?.grouping)
  const H = lineGeometry(groups).H
  for (const t of r.tokens) {
    if (!LOCAL_OK.has(t.label)) { why.push(`symbol "${t.label}" not in the reliable set`); break }
    if (t.p < 0.9) { why.push(`symbol "${t.label}" at ${t.p.toFixed(2)} < 0.90`); break }
    if (/[0-9]/.test(t.label) && t.bbox.h < 0.5 * H) { why.push('a digit much smaller than the line (could be . or ,)'); break }
    if (t.bbox.w > 1.6 * H || t.strokeIdx.length > 3) { why.push('a group that may be several symbols merged'); break }
  }
  return { reliable: why.length === 0, why }
}

onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'init') { await init(); return }
    if (m.type === 'read') {
      await init()
      const t0 = performance.now()
      const r = readLine(model, m.strokes, m.answers || {})
      const g = gate(r, m.strokes, model.meta)
      postMessage({ type: 'result', id: m.id, ms: +(performance.now() - t0).toFixed(1), model: modelInfo,
        result: { status: r.status, literal: r.literal, result: r.result ?? null, verdict: r.verdict ?? null, reason: r.reason, clarify: r.clarify, guards: r.guards ?? [],
          tokens: r.tokens.map((t) => ({ label: t.label, p: +t.p.toFixed(3), alternatives: t.alternatives.map((a) => ({ label: a.label, p: +a.p.toFixed(3) })), bbox: t.bbox, strokeIdx: t.strokeIdx })),
          reliable: g.reliable, gate: g.why } })
    }
  } catch (err) {
    postMessage({ type: 'result', id: m.id, error: String(err && err.message || err) })
  }
}
