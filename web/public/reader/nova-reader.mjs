// NOVA handwriting reader — PROTOTYPE (not wired into NOVA). One file used by the browser test page AND the Node
// evaluation scripts, so what is measured is what runs.
// pen strokes → grouping → per-symbol classifier → literal expression → exact arithmetic (no eval).
// It never repairs what was written: low confidence → ask; layouts it does not handle → reject.

export const SIZE = 32
const BOX = 26
const MAX_PTS = 64
export const PEN = 2.0

// ---------------------------------------------------------------- rendering (mirrors proto/render.py exactly)
function thin(points) {
  const n = points.length
  if (n <= MAX_PTS) return points
  const step = Math.ceil(n / (MAX_PTS - 1))
  const out = []
  for (let i = 0; i < n - 1; i += step) out.push(points[i])
  out.push(points[n - 1])
  return out
}

export function renderSymbol(strokes, pen = PEN) {
  const sts = strokes.map((s) => thin(s).map((p) => [+p.x, +p.y])).filter((s) => s.length)
  const img = new Float32Array(SIZE * SIZE)
  if (!sts.length) return { img, aspect: 0 }
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
  for (const s of sts) for (const [x, y] of s) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y }
  const w = maxx - minx, h = maxy - miny, span = Math.max(w, h)
  const scale = span > 1e-9 ? BOX / span : 1
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2
  const A = [], B = []
  for (const s of sts) {
    const q = s.map(([x, y]) => [16 + (x - cx) * scale, 16 + (y - cy) * scale])
    if (q.length === 1) { A.push(q[0]); B.push(q[0]) }
    for (let i = 0; i < q.length - 1; i++) { A.push(q[i]); B.push(q[i + 1]) }
  }
  const r = pen / 2 + 0.5
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const px = i + 0.5, py = j + 0.5
      let best = Infinity
      for (let k = 0; k < A.length; k++) {
        const ax = A[k][0], ay = A[k][1], vx = B[k][0] - ax, vy = B[k][1] - ay
        const L2 = vx * vx + vy * vy
        const pax = px - ax, pay = py - ay
        let t = L2 > 1e-12 ? (pax * vx + pay * vy) / L2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const dx = pax - t * vx, dy = pay - t * vy
        const d2 = dx * dx + dy * dy
        if (d2 < best) best = d2
      }
      const v = r - Math.sqrt(best)
      img[j * SIZE + i] = v < 0 ? 0 : v > 1 ? 1 : v
    }
  }
  const e = 0.05 * span + 1e-9
  const aspect = Math.max(-3, Math.min(3, Math.log((w + e) / (h + e)))) / 3
  return { img, aspect }
}

// ---------------------------------------------------------------- model: conv(16)-pool-conv(32)-pool-conv(64)-pool-fc(64)-fc(K)
export function loadModel(meta, buffer) {
  const f = new Float32Array(buffer)
  const W = {}
  for (const l of meta.tensors) W[l.name] = f.subarray(l.offset, l.offset + l.length)
  const conv = (x, C, H, Wd, w, b, O) => {
    const y = new Float32Array(O * H * Wd)
    for (let o = 0; o < O; o++) {
      const bo = b[o]
      for (let r = 0; r < H; r++) for (let c = 0; c < Wd; c++) {
        let s = bo
        for (let ci = 0; ci < C; ci++) {
          const wb = ((o * C + ci) * 9), xb = ci * H * Wd
          for (let kr = 0; kr < 3; kr++) {
            const rr = r + kr - 1
            if (rr < 0 || rr >= H) continue
            for (let kc = 0; kc < 3; kc++) {
              const cc = c + kc - 1
              if (cc < 0 || cc >= Wd) continue
              s += w[wb + kr * 3 + kc] * x[xb + rr * Wd + cc]
            }
          }
        }
        y[(o * H + r) * Wd + c] = s > 0 ? s : 0 // ReLU
      }
    }
    return y
  }
  const pool = (x, C, H, Wd) => {
    const h2 = H >> 1, w2 = Wd >> 1, y = new Float32Array(C * h2 * w2)
    for (let c = 0; c < C; c++) for (let r = 0; r < h2; r++) for (let k = 0; k < w2; k++) {
      const b = c * H * Wd, i = b + 2 * r * Wd + 2 * k
      y[(c * h2 + r) * w2 + k] = Math.max(x[i], x[i + 1], x[i + Wd], x[i + Wd + 1])
    }
    return y
  }
  const K = meta.classes.length
  function forward(img, aspect) {
    let x = pool(conv(img, 1, 32, 32, W['c1.weight'], W['c1.bias'], 16), 16, 32, 32)
    x = pool(conv(x, 16, 16, 16, W['c2.weight'], W['c2.bias'], 32), 32, 16, 16)
    x = pool(conv(x, 32, 8, 8, W['c3.weight'], W['c3.bias'], 64), 64, 8, 8)
    const inp = new Float32Array(1025); inp.set(x); inp[1024] = aspect
    const h = new Float32Array(64), w1 = W['f1.weight'], b1 = W['f1.bias']
    for (let o = 0; o < 64; o++) { let s = b1[o]; for (let i = 0; i < 1025; i++) s += w1[o * 1025 + i] * inp[i]; h[o] = s > 0 ? s : 0 }
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

export function classify(model, strokes) {
  const { img, aspect } = renderSymbol(strokes)
  const { probs } = model.forward(img, aspect)
  const ranked = [...probs].map((p, i) => ({ label: model.classes[i], p })).sort((a, b) => b.p - a.p)
  return { ranked, img, aspect }
}

// ---------------------------------------------------------------- grouping strokes into symbols
const bboxOf = (strokes) => {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
  for (const s of strokes) for (const p of s) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y) }
  return { minx, maxx, miny, maxy, w: maxx - minx, h: maxy - miny }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }

/** Strokes whose horizontal extents overlap (by ≥35% of the narrower one; a dot inside another's span counts) form one
 *  symbol: "=", "+", "×", "÷", a two-stroke "4" or "5". Returns groups left to right. */
export function groupStrokes(strokes) {
  const bb = strokes.map((s) => bboxOf([s]))
  const scale = Math.max(1, median(bb.map((b) => Math.max(b.w, b.h))))
  const tol = 0.04 * scale
  const parent = strokes.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < strokes.length; i++) for (let j = i + 1; j < strokes.length; j++) {
    const a = bb[i], b = bb[j]
    const overlap = Math.min(a.maxx, b.maxx) - Math.max(a.minx, b.minx)
    if (overlap >= 0.35 * Math.min(a.w, b.w) - tol) parent[find(i)] = find(j)
  }
  const m = new Map()
  strokes.forEach((_, i) => { const r = find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(i) })
  return [...m.values()].map((idx) => ({ strokeIdx: idx, strokes: idx.map((i) => strokes[i]), bbox: bboxOf(idx.map((i) => strokes[i])) }))
    .sort((a, b) => a.bbox.minx - b.bbox.minx)
}

// ---------------------------------------------------------------- exact rational arithmetic (BigInt), no eval
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a }
const Q = (n, d = 1n) => { if (d === 0n) throw new Error('division by zero'); if (d < 0n) { n = -n; d = -d } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g } }
const qop = { '+': (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d), '-': (a, b) => Q(a.n * b.d - b.n * a.d, a.d * b.d), '×': (a, b) => Q(a.n * b.n, a.d * b.d), '÷': (a, b) => Q(a.n * b.d, a.d * b.n) }
qop['/'] = qop['÷']
export const fmtQ = (q) => (q.d === 1n ? `${q.n}` : `${q.n}/${q.d}`)
export function evaluate(nums, ops) {
  // × ÷ / bind tighter than + −
  const vs = [Q(BigInt(nums[0]))], os = []
  for (let i = 0; i < ops.length; i++) {
    const b = Q(BigInt(nums[i + 1]))
    if ('×÷/'.includes(ops[i])) vs.push(qop[ops[i]](vs.pop(), b))
    else { os.push(ops[i]); vs.push(b) }
  }
  let acc = vs[0]
  for (let i = 0; i < os.length; i++) acc = qop[os[i]](acc, vs[i + 1])
  return acc
}

// ---------------------------------------------------------------- reading a line
const DIGITS = '0123456789'
const OPS = ['+', '-', '×', '÷', '/']
export const CONF = 0.75

/** strokes: [[{x, y, t?}, ...], ...] in screen units (y down). Never repairs: uncertain → status "clarify".
 *  answers: what the STUDENT chose for earlier questions — { labels: {tokenIndex: label}, oneNumber: [tokenIndex] }.
 *  cfg: thresholds; default = the model's frozen `thresholds` (tuned on VALIDATION data only), else built-in defaults. */
export function readLine(model, strokes, answers = {}, cfg = {}) {
  const conf = cfg.conf ?? model.meta?.thresholds?.conf ?? CONF
  const gapH = cfg.gapH ?? model.meta?.thresholds?.gapH ?? 0.9
  const res = { status: 'unsupported', literal: '', tokens: [], clarify: [], reason: '' }
  if (!strokes.length) { res.reason = 'no ink'; return res }
  const groups = groupStrokes(strokes)
  const H = median(groups.map((g) => g.bbox.h).filter((h, _, a) => h >= 0.5 * Math.max(...a))) || 1
  const all = bboxOf(strokes)
  if (all.h > 2.2 * H) { res.reason = 'more than one line, or a stacked layout'; return res }
  const tall = groups.filter((g) => g.bbox.h >= 0.5 * H)
  const baseline = median(tall.map((g) => g.bbox.maxy))
  for (const g of groups) {
    const c = classify(model, g.strokes)
    const top = c.ranked[0]
    const pCross = c.ranked.filter((r) => r.label === '×' || r.label === 'x').reduce((s, r) => s + r.p, 0)
    res.tokens.push({ label: top.label, p: top.p, alternatives: c.ranked.filter((r) => r.p >= 0.1).slice(0, 3), bbox: g.bbox, strokeIdx: g.strokeIdx, pCross })
  }
  for (const t of res.tokens) {
    if (t.bbox.h > 1.7 * H) { res.reason = 'a symbol is much taller than the line (stacked fraction?)'; return res }
    if (DIGITS.includes(t.label) && t.bbox.h < 0.65 * H && t.bbox.maxy < baseline - 0.45 * H) { res.reason = 'a small raised digit (a power?) — not supported'; return res }
  }
  for (const [i, lab] of Object.entries(answers.labels || {})) {
    const t = res.tokens[+i]
    if (t) { t.label = lab; t.p = 1; t.resolvedBy = 'student' }
  }
  // the times cross and the letter x look alike: decide only from context, otherwise ask
  res.tokens.forEach((t, i) => {
    if (t.resolvedBy === 'student') return
    const cross = t.label === '×' || t.label === 'x'
    if (!cross || t.pCross < conf) return
    const prev = res.tokens[i - 1], next = res.tokens[i + 1]
    const between = prev && next && DIGITS.includes(prev.label) && DIGITS.includes(next.label)
    if (between) { t.label = '×'; t.resolvedBy = 'context: between two numbers'; t.p = t.pCross }
    else { t.crossAmbiguous = true }
  })
  for (const [i, t] of res.tokens.entries()) {
    if (t.crossAmbiguous) res.clarify.push({ index: i, question: 'Is this × (times) or the letter x?', options: ['×', 'x'] })
    else if (t.p < conf) res.clarify.push({ index: i, question: 'Which did you write?', options: t.alternatives.map((a) => a.label) })
  }
  // numbers: neighbouring digits; a wide gap between digits is a question, not a guess
  const items = []
  res.tokens.forEach((t, i) => {
    const last = items[items.length - 1]
    if (DIGITS.includes(t.label) && last && last.kind === 'num') {
      const gap = t.bbox.minx - res.tokens[i - 1].bbox.maxx
      if (gap > gapH * H && !(answers.oneNumber || []).includes(i)) res.clarify.push({ index: i, question: 'Is this one number or two?', options: [last.text + t.label, `${last.text} ${t.label}`] })
      last.text += t.label
    } else items.push({ kind: DIGITS.includes(t.label) ? 'num' : t.label === '=' ? 'eq' : OPS.includes(t.label) ? 'op' : 'other', text: t.label })
  })
  res.literal = items.map((x) => x.text).join(' ')
  if (res.clarify.length) { res.status = 'clarify'; res.reason = 'NOVA is not sure about part of this line'; return res }
  const other = items.find((x) => x.kind === 'other')
  if (other) { res.reason = `"${other.text}" is not supported in arithmetic lines yet`; return res }
  // grammar: NUM (OP NUM)* [= [NUM]]
  const eqAt = items.findIndex((x) => x.kind === 'eq')
  if (items.filter((x) => x.kind === 'eq').length > 1) { res.reason = 'more than one "="'; return res }
  const lhs = eqAt < 0 ? items : items.slice(0, eqAt)
  const rhs = eqAt < 0 ? null : items.slice(eqAt + 1)
  if (!lhs.length || lhs[0].kind !== 'num') { res.reason = 'the line does not start with a number'; return res }
  for (let i = 0; i < lhs.length; i++) if (lhs[i].kind !== (i % 2 ? 'op' : 'num')) { res.reason = 'two operators or two numbers in a row'; return res }
  if (lhs[lhs.length - 1].kind === 'op') {
    if (eqAt < 0) { res.status = 'unfinished'; res.reason = 'the line ends with an operator'; return res }
    res.reason = 'an operator right before "="'; return res
  }
  const nums = lhs.filter((_, i) => i % 2 === 0).map((x) => x.text), ops = lhs.filter((_, i) => i % 2).map((x) => x.text)
  if (rhs && rhs.length > 1) { res.reason = 'more than one thing after "="'; return res }
  if (rhs && rhs.length === 1 && rhs[0].kind !== 'num') { res.reason = 'the answer is not a number'; return res }
  let value
  try { value = evaluate(nums, ops) } catch { res.status = 'checked'; res.reason = 'division by zero'; res.result = 'undefined'; return res }
  res.result = fmtQ(value)
  if (eqAt < 0) { res.status = ops.length ? 'expression' : 'number'; return res }
  if (!rhs.length) { res.status = 'answer'; return res }
  const written = Q(BigInt(rhs[0].text))
  res.status = 'checked'
  res.verdict = written.n === value.n && written.d === value.d ? 'correct' : 'incorrect' // the written answer is kept as written
  return res
}
