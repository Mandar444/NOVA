// NOVA handwriting reader v3 — PROTOTYPE. Identical reading logic to v2 (nova-reader-v2.mjs, unchanged); the only
// difference is confidence calibration: probabilities = softmax(logits / T), T from model.json ("temperature", fitted on
// validation). T never changes which class ranks first — it only changes how confident the reader is.
import * as V2 from './nova-reader-v2.mjs'
export { renderSymbol, SIZE, PEN, groupStrokes, lineGeometry, contextFeatures, lineScale, fmtQ, CONF } from './nova-reader-v2.mjs'

export function loadModel(meta, buffer) {
  const base = V2.loadModel(meta, buffer)
  const T = meta.temperature ?? 1
  const forward = (img, extra) => {
    const { logits } = base.forward(img, extra)
    const K = logits.length, z = new Float32Array(K)
    let m = -Infinity
    for (let i = 0; i < K; i++) { z[i] = logits[i] / T; if (z[i] > m) m = z[i] }
    let s = 0; const p = new Float32Array(K)
    for (let i = 0; i < K; i++) { p[i] = Math.exp(z[i] - m); s += p[i] }
    for (let i = 0; i < K; i++) p[i] /= s
    return { logits, probs: p }
  }
  return { ...base, forward }
}
export const classifyGroup = V2.classifyGroup
export const readLine = V2.readLine
