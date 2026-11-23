// NOVA handwriting reader v2 — PROTOTYPE (isolated; baseline v1 stays in nova-reader.mjs).
// strokes → grouping (touch/cross + overlap, small marks, stacked bars; order-independent) → per-group classifier
// (image + aspect + LINE-RELATIVE geometry) → literal tokens → parser (parentheses, decimals, unary minus, exact) → result.
// Never repairs what was written: uncertain → ask; unknown symbols / commas / unsupported layouts → reject with a reason.
import { renderSymbol, SIZE, PEN } from './nova-reader.mjs'
export { renderSymbol, SIZE, PEN }

// ---------------------------------------------------------------- geometry helpers
const bboxOf = (strokes) => {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
  for (const s of strokes) for (const p of s) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y }
  return { minx, maxx, miny, maxy, w: maxx - minx, h: maxy - miny }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }
const thinPts = (s, max = 48) => { if (s.length <= max) return s; const st = Math.ceil(s.length / (max - 1)), o = []; for (let i = 0; i < s.length - 1; i += st) o.push(s[i]); o.push(s[s.length - 1]); return o }
function segDist(a, b, c, d) { // min distance between segments ab and cd
  const pd = (p, q, r) => { const vx = r.x - q.x, vy = r.y - q.y, L = vx * vx + vy * vy; let t = L ? ((p.x - q.x) * vx + (p.y - q.y) * vy) / L : 0; t = Math.max(0, Math.min(1, t)); const dx = p.x - q.x - t * vx, dy = p.y - q.y - t * vy; return Math.hypot(dx, dy) }
  const cr = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = cr(a, b, c), d2 = cr(a, b, d), d3 = cr(c, d, a), d4 = cr(c, d, b)
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0
  return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b))
}
function strokeDist(s1, s2) {
  const a = thinPts(s1), b = thinPts(s2)
  if (a.length === 1 && b.length === 1) return Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y)
  let m = Infinity
  const A = a.length === 1 ? [a[0], a[0]] : a, B = b.length === 1 ? [b[0], b[0]] : b
  for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) { const d = segDist(A[i], A[i + 1], B[j], B[j + 1]); if (d < m) m = d; if (m === 0) return 0 }
  return m
}

// ---------------------------------------------------------------- grouping v2 (parameters tuned on MathWriting TRAIN lines)
export const GROUP_DEFAULTS = { overlap: 0.35, touch: 0.08, small: 0.3, smallTol: 0.15, barGap: 0.7, barOverlap: 0.5 }
export function lineScale(strokes) {
  const hs = strokes.map((s) => bboxOf([s])).map((b) => Math.max(b.h, b.w * 0.25)).sort((x, y) => x - y)
  return Math.max(1e-6, hs[Math.floor(hs.length * 0.75)] || 1) // 75th percentile stroke height ≈ digit height
}
export function groupStrokes(strokes, prm = {}) {
  const P = { ...GROUP_DEFAULTS, ...prm }
  const n = strokes.length, bb = strokes.map((s) => bboxOf([s])), H0 = lineScale(strokes)
  const parent = strokes.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const isSmall = (b) => Math.max(b.w, b.h) < P.small * H0
  const isBar = (b) => b.h < 0.3 * H0 && b.w > 1.5 * b.h
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = bb[i], b = bb[j]
    const ov = Math.min(a.maxx, b.maxx) - Math.max(a.minx, b.minx)
    const narrow = Math.max(1e-6, Math.min(a.w, b.w))
    let join = false
    // 1. a small mark (dot of i/÷, flag) whose centre sits within the other's horizontal span
    if ((isSmall(a) && !isSmall(b)) || (isSmall(b) && !isSmall(a))) {
      const [s, o] = isSmall(a) ? [a, b] : [b, a]
      const cx = (s.minx + s.maxx) / 2
      // above/below the other stroke (dot of i, ÷ dots): a little horizontal tolerance; beside it at the same height
      // (decimal point, comma after a digit): must lie strictly inside its span, so "0.5" never becomes one symbol
      const stacked = s.maxy < o.miny || s.miny > o.maxy
      const tol = stacked ? P.smallTol * H0 : 0
      join = cx > o.minx - tol && cx < o.maxx + tol && strokeDist(strokes[i], strokes[j]) < 0.6 * H0
    }
    // 2. two stacked bars (=): both flat, overlapping horizontally, close vertically
    const tolOv = 0.02 * H0 // a perfectly vertical/horizontal stroke has zero width: compare with a small tolerance
    if (!join && isBar(a) && isBar(b) && ov >= P.barOverlap * narrow - tolOv) {
      const gap = Math.max(a.miny, b.miny) - Math.min(a.maxy, b.maxy)
      join = gap < P.barGap * H0
    }
    // 3. strokes of one glyph overlap horizontally AND touch/cross (+, ×, 4, 5, t …); side-by-side glyphs that merely overlap don't
    if (!join && ov >= P.overlap * narrow - tolOv) join = strokeDist(strokes[i], strokes[j]) <= P.touch * H0
    if (join) parent[find(i)] = find(j)
  }
  const m = new Map()
  strokes.forEach((_, i) => { const r = find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(i) })
  return [...m.values()].map((idx) => ({ strokeIdx: idx, strokes: idx.map((i) => strokes[i]), bbox: bboxOf(idx.map((i) => strokes[i])) }))
    .sort((a, b) => (a.bbox.minx + a.bbox.maxx) / 2 - (b.bbox.minx + b.bbox.maxx) / 2)
}

// ---------------------------------------------------------------- line-relative geometry (same code path for training pools and inference)
export function lineGeometry(groups) {
  const hs = groups.map((g) => g.bbox.h), hmax = Math.max(...hs, 1e-6)
  const tall = groups.filter((g) => g.bbox.h >= 0.5 * hmax)
  const H = Math.max(1e-6, median(tall.map((g) => g.bbox.h)))
  const base = median(tall.map((g) => g.bbox.maxy))
  return { H, base, mid: base - H / 2 }
}
export function contextFeatures(g, geo, single = false) {
  if (single) return [0, 0, 0, 0] // one symbol alone: no line to compare with (training uses the same zeros)
  const b = g.bbox, c = (b.miny + b.maxy) / 2
  const clip = (v) => Math.max(-3, Math.min(3, v))
  return [clip(Math.log((b.h + 0.02 * geo.H) / geo.H)), clip(Math.log((b.w + 0.02 * geo.H) / geo.H)), clip((c - geo.mid) / geo.H), clip((b.maxy - geo.base) / geo.H)]
}

// ---------------------------------------------------------------- model v2: conv16-conv32-conv64 → fc64(1024 + aspect + 4 context) → K
export function loadModel(meta, buffer) {
  const f = new Float32Array(buffer)
  const W = {}
  for (const l of meta.tensors) W[l.name] = f.subarray(l.offset, l.offset + l.length)
  const NX = meta.extraInputs ?? 5
  const conv = (x, C, H, Wd, w, b, O) => {
    const y = new Float32Array(O * H * Wd)
    for (let o = 0; o < O; o++) for (let r = 0; r < H; r++) for (let c = 0; c < Wd; c++) {
      let s = b[o]
      for (let ci = 0; ci < C; ci++) {
        const wb = (o * C + ci) * 9, xb = ci * H * Wd
        for (let kr = 0; kr < 3; kr++) { const rr = r + kr - 1; if (rr < 0 || rr >= H) continue; for (let kc = 0; kc < 3; kc++) { const cc = c + kc - 1; if (cc < 0 || cc >= Wd) continue; s += w[wb + kr * 3 + kc] * x[xb + rr * Wd + cc] } }
      }
      y[(o * H + r) * Wd + c] = s > 0 ? s : 0
    }
    return y
  }
  const pool = (x, C, H, Wd) => {
    const h2 = H >> 1, w2 = Wd >> 1, y = new Float32Array(C * h2 * w2)
    for (let c = 0; c < C; c++) for (let r = 0; r < h2; r++) for (let k = 0; k < w2; k++) { const i = c * H * Wd + 2 * r * Wd + 2 * k; y[(c * h2 + r) * w2 + k] = Math.max(x[i], x[i + 1], x[i + Wd], x[i + Wd + 1]) }
    return y
  }
  const K = meta.classes.length, IN = 1024 + NX
  function forward(img, extra) {
    let x = pool(conv(img, 1, 32, 32, W['c1.weight'], W['c1.bias'], 16), 16, 32, 32)
    x = pool(conv(x, 16, 16, 16, W['c2.weight'], W['c2.bias'], 32), 32, 16, 16)
    x = pool(conv(x, 32, 8, 8, W['c3.weight'], W['c3.bias'], 64), 64, 8, 8)
    const inp = new Float32Array(IN); inp.set(x); for (let i = 0; i < NX; i++) inp[1024 + i] = extra[i]
    const h = new Float32Array(64), w1 = W['f1.weight'], b1 = W['f1.bias']
    for (let o = 0; o < 64; o++) { let s = b1[o]; for (let i = 0; i < IN; i++) s += w1[o * IN + i] * inp[i]; h[o] = s > 0 ? s : 0 }
    const z = new Float32Array(K), w2 = W['f2.weight'], b2 = W['f2.bias']
    for (let o = 0; o < K; o++) { let s = b2[o]; for (let i = 0; i < 64; i++) s += w2[o * 64 + i] * h[i]; z[o] = s }
    let m = -Infinity; for (const v of z) m = Math.max(m, v)
    let sum = 0; const p = new Float32Array(K)
    for (let o = 0; o < K; o++) { p[o] = Math.exp(z[o] - m); sum += p[o] }
    for (let o = 0; o < K; o++) p[o] /= sum
    return { logits: z, probs: p }
  }
  return { meta, classes: meta.classes, forward }
}

export function classifyGroup(model, g, geo, single) {
  const { img, aspect } = renderSymbol(g.strokes)
  const ctx = contextFeatures(g, geo, single)
  const { probs } = model.forward(img, [aspect, ...ctx])
  return [...probs].map((p, i) => ({ label: model.classes[i], p })).sort((a, b) => b.p - a.p)
}

// ---------------------------------------------------------------- exact decimals/rationals (BigInt) and the literal parser
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a }
const Q = (n, d = 1n) => { if (d === 0n) throw new Error('division by zero'); if (d < 0n) { n = -n; d = -d } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g } }
const qnum = (s) => { const [i, f = ''] = s.split('.'); return Q(BigInt(i + f || '0'), 10n ** BigInt(f.length)) }
const qadd = (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d), qsub = (a, b) => Q(a.n * b.d - b.n * a.d, a.d * b.d)
const qmul = (a, b) => Q(a.n * b.n, a.d * b.d), qdiv = (a, b) => Q(a.n * b.d, a.d * b.n)
export const fmtQ = (q) => (q.d === 1n ? `${q.n}` : `${q.n}/${q.d}`)
function parseExpr(items) { // items: {kind:'num'|'op'|'lp'|'rp', text}
  let i = 0
  const peek = () => items[i], take = () => items[i++]
  const factor = () => {
    const t = peek()
    if (t && t.kind === 'op' && t.text === '-') { take(); const v = factor(); return Q(-v.n, v.d) }
    if (t && t.kind === 'lp') { take(); const v = expr(); if (!peek() || peek().kind !== 'rp') throw new Error('unbalanced parentheses'); take(); return v }
    if (t && t.kind === 'num') { take(); return qnum(t.text) }
    throw new Error('unexpected ' + (t ? t.text : 'end'))
  }
  const term = () => { let v = factor(); while (peek() && peek().kind === 'op' && '×÷/'.includes(peek().text)) { const op = take().text; const w = factor(); v = op === '×' ? qmul(v, w) : qdiv(v, w) } return v }
  const expr = () => { let v = term(); while (peek() && peek().kind === 'op' && '+-'.includes(peek().text)) { const op = take().text; const w = term(); v = op === '+' ? qadd(v, w) : qsub(v, w) } return v }
  const v = expr()
  if (i !== items.length) throw new Error('unexpected ' + items[i].text)
  return v
}

// ---------------------------------------------------------------- reading a line
const DIGITS = '0123456789'
const OPS = ['+', '-', '×', '÷', '/']
export const CONF = 0.75

export function readLine(model, strokes, answers = {}, cfg = {}) {
  const conf = cfg.conf ?? model.meta?.thresholds?.conf ?? CONF
  const unkAsk = cfg.unkAsk ?? model.meta?.thresholds?.unkAsk ?? 0.25
  const gapH = cfg.gapH ?? model.meta?.thresholds?.gapH ?? 0.9
  const res = { status: 'unsupported', literal: '', tokens: [], clarify: [], reason: '' }
  if (!strokes.length) { res.reason = 'no ink'; return res }
  const groups = groupStrokes(strokes, cfg.group ?? model.meta?.grouping)
  const geo = lineGeometry(groups), H = geo.H
  const all = bboxOf(strokes)
  if (all.h > 2.4 * H && groups.length > 1) { res.reason = 'more than one line, or a stacked layout'; return res }
  const single = groups.length === 1
  for (const g of groups) {
    const ranked = classifyGroup(model, g, geo, single)
    const top = ranked[0]
    const pCross = ranked.filter((r) => r.label === '×' || r.label === 'x').reduce((s, r) => s + r.p, 0)
    const pUnk = ranked.find((r) => r.label === 'unk')?.p ?? 0
    res.tokens.push({ label: top.label, p: top.p, alternatives: ranked.filter((r) => r.p >= 0.1).slice(0, 3), bbox: g.bbox, strokeIdx: g.strokeIdx, pCross, pUnk })
  }
  for (const t of res.tokens) {
    if (t.bbox.h > 1.9 * H && !['(', ')', '/'].includes(t.label)) { res.reason = 'a symbol is much taller than the line (stacked fraction?)'; return res }
    if (DIGITS.includes(t.label) && t.bbox.h < 0.65 * H && t.bbox.maxy < geo.base - 0.45 * H) { res.reason = 'a small raised digit (a power?) — not supported'; return res }
  }
  for (const [i, lab] of Object.entries(answers.labels || {})) { const t = res.tokens[+i]; if (t) { t.label = lab; t.p = 1; t.pUnk = 0; t.resolvedBy = 'student' } }
  res.tokens.forEach((t, i) => {
    if (t.resolvedBy === 'student') return
    if ((t.label === '×' || t.label === 'x') && t.pCross >= conf) {
      const prev = res.tokens[i - 1], next = res.tokens[i + 1]
      const numL = prev && (DIGITS.includes(prev.label) || prev.label === ')'), numR = next && (DIGITS.includes(next.label) || next.label === '(')
      if (numL && numR) { t.label = '×'; t.resolvedBy = 'context: between two numbers'; t.p = t.pCross } else t.crossAmbiguous = true
    }
  })
  for (const [i, t] of res.tokens.entries()) {
    if (t.resolvedBy === 'student') continue
    if (t.label === 'unk' && t.p >= conf) continue // confidently a symbol the reader doesn't support → rejection below
    if (t.crossAmbiguous) res.clarify.push({ index: i, question: 'Is this × (times) or the letter x?', options: ['×', 'x'] })
    else if (t.p < conf || (t.label !== 'unk' && t.pUnk >= unkAsk)) res.clarify.push({ index: i, question: 'Which did you write?', options: [...t.alternatives.map((a) => (a.label === 'unk' ? 'something else' : a.label))] })
  }
  // literal items: numbers (digits with decimal point inside), operators, parentheses, =, ?, , and unknown — never reinterpreted
  const items = []
  res.tokens.forEach((t, i) => {
    const last = items[items.length - 1], prevT = res.tokens[i - 1]
    const gap = prevT ? t.bbox.minx - prevT.bbox.maxx : 0
    if (DIGITS.includes(t.label) && last && last.kind === 'num') {
      if (gap > gapH * H && !(answers.oneNumber || []).includes(i)) res.clarify.push({ index: i, question: 'Is this one number or two?', options: [last.text + t.label, `${last.text} ${t.label}`] })
      last.text += t.label
    } else if (t.label === '.' && last && last.kind === 'num' && !last.text.includes('.') && res.tokens[i + 1] && DIGITS.includes(res.tokens[i + 1].label)) last.text += '.'
    else items.push({ kind: DIGITS.includes(t.label) ? 'num' : t.label === '=' ? 'eq' : OPS.includes(t.label) ? 'op' : t.label === '(' ? 'lp' : t.label === ')' ? 'rp' : t.label === '?' ? 'q' : t.label === ',' ? 'comma' : t.label === '.' ? 'dot' : 'unk', text: t.label === 'unk' ? '□' : t.label })
  })
  res.literal = items.map((x) => x.text).join(' ')
  if (res.clarify.length) { res.status = 'clarify'; res.reason = 'NOVA is not sure about part of this line'; return res }
  if (items.some((x) => x.kind === 'unk')) { res.reason = 'a symbol NOVA cannot read yet (shown as □)'; return res }
  if (items.some((x) => x.kind === 'comma')) { res.reason = 'commas (lists) are not arithmetic NOVA evaluates'; return res }
  if (items.some((x) => x.kind === 'dot')) { res.reason = 'a dot that is not a decimal point between digits'; return res }
  const eqs = items.filter((x) => x.kind === 'eq').length
  if (eqs > 1) { res.reason = 'more than one "="'; return res }
  const eqAt = items.findIndex((x) => x.kind === 'eq')
  const lhs = eqAt < 0 ? items : items.slice(0, eqAt), rhs = eqAt < 0 ? null : items.slice(eqAt + 1)
  if (!lhs.length) { res.reason = 'nothing before "="'; return res }
  if (lhs.some((x) => x.kind === 'q')) { res.reason = '"?" is only supported as the answer ("3 + 2 = ?")'; return res }
  if (eqAt < 0 && lhs[lhs.length - 1].kind === 'op') { res.status = 'unfinished'; res.reason = 'the line ends with an operator'; return res }
  let value
  try { value = parseExpr(lhs) } catch (e) {
    if (/division by zero/.test(e.message)) { res.status = 'checked'; res.result = 'undefined'; res.reason = 'division by zero'; return res }
    res.reason = 'not a well-formed arithmetic expression (' + e.message + ')'; return res
  }
  res.result = fmtQ(value)
  if (eqAt < 0) { res.status = lhs.length === 1 || (lhs.length === 2 && lhs[0].text === '-') ? 'number' : 'expression'; return res }
  if (!rhs.length || (rhs.length === 1 && rhs[0].kind === 'q')) { res.status = 'answer'; return res }
  let written
  try { written = parseExpr(rhs) } catch { res.reason = 'the answer is not a number'; return res }
  res.status = 'checked'
  res.verdict = written.n === value.n && written.d === value.d ? 'correct' : 'incorrect'
  return res
}
