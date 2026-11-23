// NOVA handwriting reader v3g — correction CANDIDATE (no retraining): v3 weights + temperature, v2 grouping/geometry,
// and a reworked reading step. Every change asks or refuses; nothing is ever silently converted.
//  G1 position guard: a "/" that is not between two operands (… "/ ×", "= / 26", "9 / − 23") → ask "1 or /"
//  G2 evidence guard: "/" with P(1) ≥ 0.05, or a "1" inside a number with P(/) ≥ 0.05 → ask "1 or /"
//  G3 options always include the known confusable of the top label (1↔/, 1↔7, ,↔.↔1, ×↔x, −↔=) and "something else"
//  G4 "unfinished" only when what precedes the trailing operator is well-formed; otherwise refused
//  G5 a confident comma or unknown symbol refuses the line at once (no taps spent on its other symbols)
//  G6 "two numbers" is a recordable answer (answers.twoNumbers); the v2 page/reader could not record it
// Spacing is NOT used as a trigger: in MathWriting TRAIN lines a "/" sits tighter to digits (median gap 0.14 H) than
// digits inside one number (0.23 H), so tight spacing does not indicate "1" (stage1v3g/spacing_train.json).
import { groupStrokes, lineGeometry, classifyGroup, renderSymbol, SIZE, PEN, contextFeatures, lineScale } from './nova-reader-v2.mjs'
import { loadModel } from './nova-reader-v3.mjs'
export { loadModel, groupStrokes, lineGeometry, classifyGroup, renderSymbol, SIZE, PEN, contextFeatures, lineScale }

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a }
const Q = (n, d = 1n) => { if (d === 0n) throw new Error('division by zero'); if (d < 0n) { n = -n; d = -d } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g } }
const qnum = (s) => { const [i, f = ''] = s.split('.'); return Q(BigInt(i + f || '0'), 10n ** BigInt(f.length)) }
const qadd = (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d), qsub = (a, b) => Q(a.n * b.d - b.n * a.d, a.d * b.d)
const qmul = (a, b) => Q(a.n * b.n, a.d * b.d), qdiv = (a, b) => Q(a.n * b.d, a.d * b.n)
export const fmtQ = (q) => (q.d === 1n ? `${q.n}` : `${q.n}/${q.d}`)
function parseExpr(items) {
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

const DIGITS = '0123456789'
const OPS = ['+', '-', '×', '÷', '/']
export const CONF = 0.75
export const GUARD = { pConfusable: 0.05 } // fixed a priori (not tuned on any evaluation set)
const CONFUSABLE = { '/': ['1'], '1': ['/', '7'], ',': ['.', '1'], '.': [','], '7': ['1'], '×': ['x'], 'x': ['×'], '-': ['='], '=': ['-'] }
const bboxOf = (strokes) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const s of strokes) for (const p of s) { a = Math.min(a, p.x); b = Math.max(b, p.x); c = Math.min(c, p.y); d = Math.max(d, p.y) } return { minx: a, maxx: b, miny: c, maxy: d, w: b - a, h: d - c } }
const shown = (l) => (l === 'unk' ? 'something else' : l)
const optionsFor = (t) => {
  const o = []
  for (const a of t.alternatives) if (!o.includes(shown(a.label))) o.push(shown(a.label))
  for (const c of CONFUSABLE[t.label] ?? []) if (!o.includes(c)) o.push(c)
  if (!o.includes('something else')) o.push('something else')
  return o
}

function buildItems(tokens, answers, H, gapH, clarify) {
  const items = []
  tokens.forEach((t, i) => {
    const last = items[items.length - 1], prevT = tokens[i - 1]
    const gap = prevT ? t.bbox.minx - prevT.bbox.maxx : 0
    const two = (answers.twoNumbers || []).includes(i)
    if (DIGITS.includes(t.label) && last && last.kind === 'num' && !two) {
      if (clarify && gap > gapH * H && !(answers.oneNumber || []).includes(i)) clarify.push({ index: i, question: 'Is this one number or two?', options: [last.text + t.label, `${last.text} ${t.label}`] })
      last.text += t.label
    } else if (t.label === '.' && last && last.kind === 'num' && !last.text.includes('.') && tokens[i + 1] && DIGITS.includes(tokens[i + 1].label)) last.text += '.'
    else items.push({ kind: DIGITS.includes(t.label) ? 'num' : t.label === '=' ? 'eq' : OPS.includes(t.label) ? 'op' : t.label === '(' ? 'lp' : t.label === ')' ? 'rp' : t.label === '?' ? 'q' : t.label === ',' ? 'comma' : t.label === '.' ? 'dot' : 'unk', text: t.label === 'unk' || t.label === 'something else' ? '□' : t.label })
  })
  return items
}

export function readLine(model, strokes, answers = {}, cfg = {}) {
  const conf = cfg.conf ?? model.meta?.thresholds?.conf ?? CONF
  const unkAsk = cfg.unkAsk ?? model.meta?.thresholds?.unkAsk ?? 0.25
  const gapH = cfg.gapH ?? model.meta?.thresholds?.gapH ?? 0.9
  const pc = cfg.pConfusable ?? GUARD.pConfusable
  const res = { status: 'unsupported', literal: '', tokens: [], clarify: [], reason: '', guards: [] }
  if (!strokes.length) { res.reason = 'no ink'; return res }
  const groups = groupStrokes(strokes, cfg.group ?? model.meta?.grouping)
  const geo = lineGeometry(groups), H = geo.H
  if (bboxOf(strokes).h > 2.4 * H && groups.length > 1) { res.reason = 'more than one line, or a stacked layout'; return res }
  const single = groups.length === 1
  for (const g of groups) {
    const ranked = classifyGroup(model, g, geo, single)
    const pOf = (l) => ranked.find((r) => r.label === l)?.p ?? 0
    res.tokens.push({ label: ranked[0].label, p: ranked[0].p, alternatives: ranked.filter((r) => r.p >= 0.1).slice(0, 3), bbox: g.bbox, strokeIdx: g.strokeIdx,
      pCross: pOf('×') + pOf('x'), pUnk: pOf('unk'), p1: pOf('1'), pSlash: pOf('/') })
  }
  for (const t of res.tokens) {
    if (t.bbox.h > 1.9 * H && !['(', ')', '/'].includes(t.label)) { res.reason = 'a symbol is much taller than the line (stacked fraction?)'; return res }
    if (DIGITS.includes(t.label) && t.bbox.h < 0.65 * H && t.bbox.maxy < geo.base - 0.45 * H) { res.reason = 'a small raised digit (a power?) — not supported'; return res }
  }
  for (const [i, lab] of Object.entries(answers.labels || {})) { const t = res.tokens[+i]; if (t) { t.label = lab; t.p = 1; t.pUnk = 0; t.resolvedBy = 'student' } }
  // G5: a confident comma / unknown symbol (or the student's "something else") refuses the line before any other question
  const refuse = res.tokens.find((t) => (t.label === ',' || t.label === 'unk' || t.label === 'something else') && (t.p >= conf || t.resolvedBy === 'student'))
  if (refuse) {
    res.literal = buildItems(res.tokens, answers, H, gapH, null).map((x) => x.text).join(' ')
    res.reason = refuse.label === ',' ? 'commas (lists) are not arithmetic NOVA evaluates' : 'a symbol NOVA cannot read yet (shown as □)'
    return res
  }
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
    const prev = res.tokens[i - 1], next = res.tokens[i + 1]
    const operandL = prev && (DIGITS.includes(prev.label) || prev.label === ')')
    const operandR = next && (DIGITS.includes(next.label) || next.label === '(')
    if (t.label === '/' && !(operandL && operandR)) { res.guards.push({ index: i, guard: 'G1 position' }); res.clarify.push({ index: i, question: 'Is this 1 or / ?', options: ['1', '/', 'something else'] }); continue }
    if (t.label === '/' && t.p1 >= pc) { res.guards.push({ index: i, guard: 'G2 P(1)' }); res.clarify.push({ index: i, question: 'Is this 1 or / ?', options: ['1', '/', 'something else'] }); continue }
    const inNumber = (prev && DIGITS.includes(prev.label)) || (next && DIGITS.includes(next.label))
    if (t.label === '1' && inNumber && t.pSlash >= pc) { res.guards.push({ index: i, guard: 'G2 P(/)' }); res.clarify.push({ index: i, question: 'Is this 1 or / ?', options: ['1', '/', 'something else'] }); continue }
    if (t.crossAmbiguous) res.clarify.push({ index: i, question: 'Is this × (times) or the letter x?', options: ['×', 'x'] })
    else if (t.p < conf || (t.label !== 'unk' && t.pUnk >= unkAsk)) res.clarify.push({ index: i, question: 'Which did you write?', options: optionsFor(t) })
  }
  const items = buildItems(res.tokens, answers, H, gapH, res.clarify)
  res.literal = items.map((x) => x.text).join(' ')
  if (res.clarify.length) { res.status = 'clarify'; res.reason = 'NOVA is not sure about part of this line'; return res }
  if (items.some((x) => x.kind === 'unk')) { res.reason = 'a symbol NOVA cannot read yet (shown as □)'; return res }
  if (items.some((x) => x.kind === 'comma')) { res.reason = 'commas (lists) are not arithmetic NOVA evaluates'; return res }
  if (items.some((x) => x.kind === 'dot')) { res.reason = 'a dot that is not a decimal point between digits'; return res }
  if (items.filter((x) => x.kind === 'eq').length > 1) { res.reason = 'more than one "="'; return res }
  const eqAt = items.findIndex((x) => x.kind === 'eq')
  const lhs = eqAt < 0 ? items : items.slice(0, eqAt), rhs = eqAt < 0 ? null : items.slice(eqAt + 1)
  if (!lhs.length) { res.reason = 'nothing before "="'; return res }
  if (lhs.some((x) => x.kind === 'q')) { res.reason = '"?" is only supported as the answer ("3 + 2 = ?")'; return res }
  if (eqAt < 0 && lhs[lhs.length - 1].kind === 'op') {
    // G4: only a well-formed start counts as "unfinished"
    try { parseExpr(lhs.slice(0, -1)) } catch (e) { if (!/division by zero/.test(e.message)) { res.reason = 'not a well-formed arithmetic expression (' + e.message + ')'; return res } }
    res.status = 'unfinished'; res.reason = 'the line ends with an operator'; return res
  }
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
