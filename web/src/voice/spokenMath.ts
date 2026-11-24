// Spoken maths → notebook maths, deterministically. "integral of x squared from zero to two" → ∫_0^2 x^2 dx.
// Never guesses: a missing bound, an unknown variable of integration or an ambiguous "over" becomes a question.
// Two outputs: `text` (NOVA's exact-engine notation, what the page "reads") and `display` (pretty, for the page).

export interface Clarify { id: string; question: string; options: { label: string; value: string }[] }
export interface Interpretation {
  text: string // canonical, '' when nothing could be built
  display: string
  unknown: string[] // words that were not understood (→ BharatCode may interpret, the student confirms)
  clarify: Clarify | null // the first open question; answer it and interpret again
  complete: boolean // nothing unknown, nothing to ask
}
export type Choices = Record<string, string>

// ---------------------------------------------------------------- tokens
type Tok = { k: 'num'; v: string } | { k: 'var'; v: string } | { k: 'op'; v: string } | { k: 'w'; v: string }

const ONES: Record<string, number> = { zero: 0, oh: 0, nought: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const GREEK: Record<string, string> = { theta: 'θ', alpha: 'α', beta: 'β', pi: 'π', lambda: 'λ', phi: 'φ' }
const LETTER_WORDS: Record<string, string> = { ex: 'x', why: 'y', wye: 'y', zed: 'z', zee: 'z', see: 'c', bee: 'b', tee: 't', en: 'n', em: 'm', kay: 'k' }
const FILLER = new Set(['the', 'please', 'um', 'uh', 'so', 'okay', 'ok', 'and', 'then', 'what', 'is', 'value', 'answer', 'me', 'can', 'you', 'could', 'write', 'down', 'question'])
const COMMANDS = ['solve', 'find', 'simplify', 'factorise', 'factorize', 'expand', 'evaluate', 'calculate', 'work out']

function wordsOf(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[“”"!?;:,]/g, ' ')
    .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/([+\-−*/×÷=^()²³])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean)
}

function tokenize(s: string): Tok[] {
  const w = wordsOf(s)
  const out: Tok[] = []
  let i = 0
  const peek = (n = 0) => w[i + n]
  const numberWords = (): string | null => {
    // "twenty five", "one hundred and five", "two point five", "three thousand"
    let total = 0, cur = 0, seen = false
    const start = i
    while (i < w.length) {
      const x = w[i]
      if (x in ONES) { cur += ONES[x]; seen = true; i++ }
      else if (x in TENS) { cur += TENS[x]; seen = true; i++ }
      else if (x === 'hundred' && seen) { cur *= 100; i++ }
      else if (x === 'thousand' && seen) { total += cur * 1000; cur = 0; i++ }
      else if (x === 'and' && seen && (w[i + 1] in ONES || w[i + 1] in TENS)) i++
      else break
    }
    if (!seen) { i = start; return null }
    let v = String(total + cur)
    if (w[i] === 'point' && (w[i + 1] in ONES || /^\d$/.test(w[i + 1] ?? ''))) {
      i++
      let frac = ''
      while (i < w.length && (w[i] in ONES || /^\d$/.test(w[i]))) { frac += w[i] in ONES ? String(ONES[w[i]] % 10) : w[i]; i++ }
      v += '.' + frac
    }
    return v
  }
  while (i < w.length) {
    const x = w[i]
    const nw = numberWords()
    if (nw !== null) { out.push({ k: 'num', v: nw }); continue }
    if (/^\d+(\.\d+)?$/.test(x)) { out.push({ k: 'num', v: x }); i++; continue }
    const m = x.match(/^(\d+(?:\.\d+)?)([a-z])$/) // "3x"
    if (m) { out.push({ k: 'num', v: m[1] }, { k: 'var', v: m[2] }); i++; continue }
    if ('+-−*/×÷=^()²³'.includes(x)) {
      const map: Record<string, string> = { '−': '-', '*': '×', '÷': '/', '²': 'sq', '³': 'cube' }
      out.push({ k: 'op', v: map[x] ?? x })
      i++
      continue
    }
    if (x in GREEK) { out.push({ k: 'var', v: GREEK[x] }); i++; continue }
    if (x in LETTER_WORDS && (peek(1) === undefined || /^(squared|cubed|plus|minus|times|over|equals|to|from|dx|d|with)$/.test(peek(1)!))) { out.push({ k: 'var', v: LETTER_WORDS[x] }); i++; continue }
    if (/^[a-z]$/.test(x) && x !== 'a' && x !== 'i') { out.push({ k: 'var', v: x }); i++; continue }
    if (x === 'a') {
      // "a" is a variable only next to maths ("a squared plus b"), otherwise an article
      const prev = out[out.length - 1]
      const nxt = peek(1)
      if ((prev && prev.k === 'op') || (nxt && /^(squared|cubed|plus|minus|times|over|equals|\+|-|=)$/.test(nxt))) { out.push({ k: 'var', v: 'a' }); i++; continue }
      i++
      continue
    }
    if (/^d[a-z]$/.test(x) && x !== 'do') { out.push({ k: 'w', v: 'd' }, { k: 'var', v: x[1] }); i++; continue } // "dx"
    out.push({ k: 'w', v: x })
    i++
  }
  return out
}

// ---------------------------------------------------------------- AST
type N =
  | { t: 'num'; v: string }
  | { t: 'var'; v: string }
  | { t: 'neg'; a: N }
  | { t: 'bin'; op: '+' | '-' | '×' | '/'; a: N; b: N; implicit?: boolean }
  | { t: 'pow'; a: N; b: N }
  | { t: 'fn'; f: string; a: N }
  | { t: 'sqrt'; a: N }
  | { t: 'grp'; a: N }
  | { t: 'int'; body: N; v: string; lo?: N; hi?: N }
  | { t: 'der'; body: N; v: string }
  | { t: 'eq'; a: N; b: N; rel: string }

class Need extends Error {
  readonly c: Clarify
  constructor(c: Clarify) { super(c.question); this.c = c }
}

const FUN: Record<string, string> = { sine: 'sin', sin: 'sin', cosine: 'cos', cos: 'cos', tangent: 'tan', tan: 'tan', tan_: 'tan', log: 'log', ln: 'ln', exp: 'exp' }

class Parser {
  i = 0
  unknown: string[] = []
  overN = 0
  readonly toks: Tok[]
  readonly choices: Choices
  constructor(toks: Tok[], choices: Choices) { this.toks = toks; this.choices = choices }
  peek(n = 0) { return this.toks[this.i + n] }
  isW(...ws: string[]) { const t = this.peek(); return !!t && t.k === 'w' && ws.includes(t.v) }
  isOp(...os: string[]) { const t = this.peek(); return !!t && t.k === 'op' && os.includes(t.v) }
  eatW(...ws: string[]) { if (this.isW(...ws)) { this.i++; return true } return false }
  eatPhrase(p: string) {
    const ws = p.split(' ')
    for (let k = 0; k < ws.length; k++) { const t = this.peek(k); if (!t || t.k !== 'w' || t.v !== ws[k]) return false }
    this.i += ws.length
    return true
  }
  stopSet: Set<string> = new Set()
  skipFiller(stop: Set<string> = new Set()) { while (this.isW(...FILLER) && !stop.has(this.peek()!.v)) this.i++ }

  line(): N {
    const a = this.expr(new Set())
    if (this.eatW('equals', 'equal') || this.eatPhrase('is equal to') || this.eatOp('=')) {
      this.eatW('to')
      const b = this.expr(new Set())
      return { t: 'eq', a, b, rel: '=' }
    }
    if (this.eatPhrase('is greater than') || this.eatPhrase('greater than')) return { t: 'eq', a, b: this.expr(new Set()), rel: '>' }
    if (this.eatPhrase('is less than') || this.eatPhrase('less than')) return { t: 'eq', a, b: this.expr(new Set()), rel: '<' }
    return a
  }
  eatOp(o: string) { if (this.isOp(o)) { this.i++; return true } return false }

  expr(stop: Set<string>): N {
    this.skipFiller(stop)
    let a = this.term(stop)
    const terms = 1
    for (;;) {
      this.skipFiller(stop)
      if (this.stopped(stop)) break
      let op: '+' | '-' | null = null
      if (this.eatW('plus', 'add') || this.eatOp('+')) op = '+'
      else if (this.eatW('minus', 'subtract') || this.eatOp('-')) op = '-'
      else if (this.isW('take') && this.peek(1)?.v === 'away') { this.i += 2; op = '-' }
      if (!op) break
      const before = a
      const overBefore = this.overN
      const b = this.term(stop)
      a = { t: 'bin', op, a, b }
      // "x plus one all over two": everything said so far is the numerator
      if (b.t === 'bin' && b.op === '/' && (b as { all?: boolean }).all) {
        a = { t: 'bin', op: '/', a: { t: 'grp', a: { t: 'bin', op, a: before, b: b.a } }, b: b.b }
        continue
      }
      // "x plus one over two": (x + 1)/2 or x + 1/2?  ask, unless "all over" made it explicit
      if (this.overN > overBefore && b.t === 'bin' && b.op === '/' && !(b as { all?: boolean }).all && terms >= 1) {
        const id = `over${overBefore}`
        const whole: N = { t: 'bin', op: '/', a: { t: 'grp', a: { t: 'bin', op, a: before, b: b.a } }, b: b.b }
        const asIs: N = a
        const pick = this.choices[id]
        if (pick === 'whole') a = whole
        else if (pick !== 'part') throw new Need({ id, question: 'Which did you mean?', options: [{ label: show(whole), value: 'whole' }, { label: show(asIs), value: 'part' }] })
      }
    }
    return a
  }
  stopped(stop: Set<string>) {
    const t = this.peek()
    if (!t) return true
    if (t.k === 'w' && stop.has(t.v)) return true
    if (t.k === 'op' && t.v === ')' ) return true
    if (t.k === 'w' && (t.v === 'equals' || t.v === 'equal')) return true
    if (t.k === 'op' && t.v === '=') return true
    if (t.k === 'w' && t.v === 'is' && this.peek(1)?.v === 'equal') return true
    return false
  }
  term(stop: Set<string>): N {
    let a = this.power(stop)
    for (;;) {
      this.skipFiller(stop)
      if (this.stopped(stop)) break
      if (this.eatW('times', 'multiplied') || this.eatOp('×')) { this.eatW('by'); a = { t: 'bin', op: '×', a, b: this.power(stop) }; continue }
      if (this.eatOp('/') || this.eatPhrase('divided by')) { a = { t: 'bin', op: '/', a, b: this.power(stop) }; continue }
      if (this.isW('all') && this.peek(1)?.v === 'over') { this.i += 2; const d: N = { t: 'bin', op: '/', a, b: this.power(stop) }; (d as { all?: boolean }).all = true; a = d; continue }
      if (this.eatW('over')) { this.overN++; a = { t: 'bin', op: '/', a, b: this.power(stop) }; continue }
      // implicit product: "3 x", "2 sine x", "x y"
      const t = this.peek()
      if (t && (t.k === 'var' || (t.k === 'op' && t.v === '(') || (t.k === 'w' && (t.v in FUN || t.v === 'square' || t.v === 'root' || t.v === 'open' || t.v === 'bracket')))) {
        a = { t: 'bin', op: '×', a, b: this.power(stop), implicit: true }
        continue
      }
      break
    }
    return a
  }
  power(stop: Set<string>): N {
    let a = this.unary(stop)
    for (;;) {
      if (this.eatW('squared') || this.eatOp('sq')) { a = { t: 'pow', a, b: { t: 'num', v: '2' } }; continue }
      if (this.eatW('cubed') || this.eatOp('cube')) { a = { t: 'pow', a, b: { t: 'num', v: '3' } }; continue }
      if (this.eatPhrase('to the power of') || this.eatPhrase('to the power') || this.eatPhrase('raised to the power of') || this.eatPhrase('raised to') || this.eatOp('^')) {
        this.eatW('the')
        const b = this.unary(stop)
        a = { t: 'pow', a, b }
        continue
      }
      if (this.isW('to') && this.peek(1)?.k === 'w' && /^(fourth|fifth|sixth|seventh|eighth|ninth|tenth)$/.test(this.peek(1)!.v)) {
        const ord: Record<string, string> = { fourth: '4', fifth: '5', sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10' }
        this.i += 2
        a = { t: 'pow', a, b: { t: 'num', v: ord[this.toks[this.i - 1].v] } }
        continue
      }
      break
    }
    return a
  }
  unary(stop: Set<string>): N {
    this.skipFiller(stop)
    if (this.eatW('negative', 'minus') || this.eatOp('-')) return { t: 'neg', a: this.power(stop) }
    return this.primary(stop)
  }
  variableAfterBody(body: N): string {
    // "with respect to t" / "d t" / "dt"
    if (this.eatPhrase('with respect to')) { const t = this.peek(); if (t?.k === 'var') { this.i++; return t.v } }
    if (this.isW('d') && this.peek(1)?.k === 'var') { this.i++; const v = this.peek()!.v; this.i++; return v }
    const vs = [...varsOf(body)]
    if (vs.length === 1) return vs[0]
    const pick = this.choices.var
    if (pick) return pick
    throw new Need({ id: 'var', question: vs.length ? 'With respect to which variable?' : 'With respect to which variable? (none was said)', options: (vs.length ? vs : ['x', 't']).map((v) => ({ label: v, value: v })) })
  }
  primary(stop: Set<string>): N {
    this.skipFiller(stop)
    const t = this.peek()
    if (!t) throw new Need({ id: 'end', question: 'The maths stops short — what comes next?', options: [] })
    if (t.k === 'num') { this.i++; return { t: 'num', v: t.v } }
    if (t.k === 'var') { this.i++; return { t: 'var', v: t.v } }
    if (t.k === 'op' && t.v === '(') {
      this.i++
      const a = this.expr(stop)
      this.eatOp(')')
      return { t: 'grp', a }
    }
    if (this.eatPhrase('open bracket') || this.eatPhrase('open brackets') || this.eatPhrase('bracket') || this.eatPhrase('the quantity')) {
      const a = this.expr(new Set([...stop, 'close']))
      this.eatPhrase('close bracket') || this.eatPhrase('close brackets')
      return { t: 'grp', a }
    }
    if (this.eatPhrase('square root of') || this.eatPhrase('root of') || this.eatPhrase('square root')) return { t: 'sqrt', a: this.power(stop) }
    if (t.k === 'w' && t.v in FUN) {
      this.i++
      this.eatW('of')
      return { t: 'fn', f: FUN[t.v], a: this.power(stop) }
    }
    if (this.eatPhrase('natural log of') || this.eatPhrase('natural log')) return { t: 'fn', f: 'ln', a: this.power(stop) }
    // calculus
    if (this.eatPhrase('the integral of') || this.eatPhrase('integral of') || this.eatPhrase('integrate') || this.eatPhrase('integral')) {
      const body = this.expr(new Set([...stop, 'from', 'between', 'with', 'd']))
      let lo: N | undefined, hi: N | undefined
      let saidFrom = false
      if (this.eatW('from') || this.eatW('between')) {
        saidFrom = true
        lo = this.expr(new Set([...stop, 'to', 'and', 'with', 'd']))
        if (this.eatW('to') || this.eatW('and')) hi = this.expr(new Set([...stop, 'with', 'd']))
      }
      const v = this.variableAfterBody(body)
      if (!saidFrom && (this.eatW('from') || this.eatW('between'))) {
        saidFrom = true
        lo = this.expr(new Set([...stop, 'to', 'and']))
        if (this.eatW('to') || this.eatW('and')) hi = this.expr(new Set(stop))
      }
      if (saidFrom && (!lo || !hi)) throw new Need({ id: 'bound', question: 'Only one limit was said. Say or type the other limit — NOVA won\'t guess it.', options: [] })
      return { t: 'int', body, v, lo, hi }
    }
    if (this.eatPhrase('differentiate') || this.eatPhrase('the derivative of') || this.eatPhrase('derivative of') || this.eatPhrase('d by d') || this.eatPhrase('d over d')) {
      let v = ''
      const prev = this.toks[this.i - 1]
      if (prev && prev.k === 'w' && prev.v === 'd' && this.peek()?.k === 'var') { v = this.peek()!.v; this.i++; this.eatW('of') }
      const body = this.expr(new Set([...stop, 'with']))
      if (!v) v = this.variableAfterBody(body)
      return { t: 'der', body, v }
    }
    // a word we do not know: remember it and move on
    this.i++
    if (t.k === 'w') this.unknown.push(t.v)
    return this.primary(stop)
  }
}

function varsOf(n: N, out = new Set<string>()): Set<string> {
  switch (n.t) {
    case 'var': out.add(n.v); break
    case 'num': break
    case 'neg': case 'fn': case 'sqrt': case 'grp': varsOf(n.a, out); break
    case 'bin': case 'pow': case 'eq': varsOf(n.a, out); varsOf(n.b, out); break
    case 'int': case 'der': varsOf(n.body, out); out.delete(n.v); break
  }
  return out
}

// ---------------------------------------------------------------- printing
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', n: 'ⁿ', x: 'ˣ' }
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '-': '₋' }
const simple = (n: N) => n.t === 'num' || n.t === 'var'
const prec = (n: N): number => (n.t === 'bin' ? (n.op === '+' || n.op === '-' ? 1 : 2) : n.t === 'neg' ? 1.5 : n.t === 'eq' ? 0 : 3)

function canon(n: N): string {
  switch (n.t) {
    case 'num': return n.v
    case 'var': return n.v
    case 'neg': return '-' + wrap(n.a, 2, canon)
    case 'grp': return `(${canon(n.a)})`
    case 'bin': {
      if (n.op === '×' && n.implicit && (n.a.t === 'num' || n.a.t === 'var') && n.b.t !== 'num') return `${canon(n.a)}${needsSpace(n.b) ? ' ' : ''}${wrap(n.b, 2, canon)}`
      const o = n.op === '×' ? ' * ' : n.op === '/' ? '/' : ` ${n.op} `
      return `${wrap(n.a, prec(n), canon)}${o}${wrap(n.b, prec(n) + (n.op === '-' || n.op === '/' ? 0.5 : 0), canon)}`
    }
    case 'pow': return `${wrap(n.a, 3, canon)}^${simple(n.b) ? canon(n.b) : `(${canon(n.b)})`}`
    case 'fn': return `${n.f}${simple(n.a) ? ' ' + canon(n.a) : `(${canon(n.a)})`}`
    case 'sqrt': return `sqrt(${canon(n.a)})`
    case 'int': return n.lo && n.hi ? `∫_${bound(n.lo)}^${bound(n.hi)} ${canon(n.body)} d${n.v}` : `∫ ${canon(n.body)} d${n.v}`
    case 'der': return `d/d${n.v}(${canon(n.body)})`
    case 'eq': return `${canon(n.a)} ${n.rel} ${canon(n.b)}`
  }
}
const needsSpace = (b: N) => b.t === 'fn' || b.t === 'sqrt'
const bound = (b: N) => (simple(b) && !String((b as { v: string }).v).includes('.') ? canon(b) : `{${canon(b)}}`)
function wrap(n: N, p: number, f: (n: N) => string) {
  return prec(n) < p ? `(${f(n)})` : f(n)
}

export function show(n: N): string {
  const sup = (s: string) => ([...s].every((c) => c in SUP) ? [...s].map((c) => SUP[c]).join('') : `^(${s})`)
  const sub = (s: string) => ([...s].every((c) => c in SUB) ? [...s].map((c) => SUB[c]).join('') : `_(${s})`)
  switch (n.t) {
    case 'num': return n.v
    case 'var': return n.v
    case 'neg': return '−' + wrap(n.a, 2, show)
    case 'grp': return `(${show(n.a)})`
    case 'bin': {
      if (n.op === '×' && n.implicit && (n.a.t === 'num' || n.a.t === 'var')) return `${show(n.a)}${needsSpace(n.b) ? ' ' : ''}${wrap(n.b, 2, show)}`
      const o = n.op === '×' ? ' × ' : n.op === '/' ? '/' : n.op === '-' ? ' − ' : ' + '
      return `${wrap(n.a, prec(n), show)}${o}${wrap(n.b, prec(n) + (n.op === '-' || n.op === '/' ? 0.5 : 0), show)}`
    }
    case 'pow': return `${wrap(n.a, 3, show)}${simple(n.b) ? sup(canon(n.b)) : `^(${show(n.b)})`}`
    case 'fn': return `${n.f}${simple(n.a) ? ' ' + show(n.a) : `(${show(n.a)})`}`
    case 'sqrt': return simple(n.a) ? `√${show(n.a)}` : `√(${show(n.a)})`
    case 'int': return n.lo && n.hi ? `∫${sub(canon(n.lo))}${sup(canon(n.hi))} ${show(n.body)} d${n.v}` : `∫ ${show(n.body)} d${n.v}`
    case 'der': return `d/d${n.v}(${show(n.body)})`
    case 'eq': return `${show(n.a)} ${n.rel} ${show(n.b)}`
  }
}

// ---------------------------------------------------------------- entry points
export function interpretSpokenMath(transcript: string, choices: Choices = {}): Interpretation {
  const raw = transcript.trim()
  if (!raw) return { text: '', display: '', unknown: [], clarify: null, complete: false }
  let lower = raw.toLowerCase()
  let command = ''
  for (const c of COMMANDS) {
    const m = lower.match(new RegExp(`^\\s*(?:please\\s+)?${c}\\b\\s*(?:the\\s+)?`))
    if (m) { command = c === 'factorize' ? 'factorise' : c; lower = lower.slice(m[0].length); break }
  }
  const toks = tokenize(lower)
  const p = new Parser(toks, choices)
  try {
    const n = p.line()
    while (p.i < toks.length) {
      const t = toks[p.i++]
      if (t.k === 'w' && !FILLER.has(t.v)) p.unknown.push(t.v)
      else if (t.k !== 'w') p.unknown.push(t.v)
    }
    const cap = command ? command[0].toUpperCase() + command.slice(1) + ' ' : ''
    const text = cap + canon(n)
    const display = cap + show(n)
    return { text, display, unknown: p.unknown, clarify: null, complete: p.unknown.length === 0 }
  } catch (e) {
    if (e instanceof Need) return { text: '', display: '', unknown: p.unknown, clarify: e.c, complete: false }
    return { text: '', display: '', unknown: [...p.unknown, '…'], clarify: null, complete: false }
  }
}

/** Pretty form of NOVA's canonical notation (for text the student typed or edited by hand). */
export function prettyMath(text: string): string {
  return text
    .replace(/∫_\{?([^}\s^]+)\}?\^\{?([^}\s]+)\}?/g, (_, a: string, b: string) => `∫${[...a].map((c) => SUB[c] ?? c).join('')}${[...b].map((c) => SUP[c] ?? c).join('')}`)
    .replace(/\^(\d+|[nx])/g, (_, e: string) => [...e].map((c) => SUP[c] ?? c).join(''))
    .replace(/\s\*\s/g, ' × ')
    .replace(/(\s)-(\s)/g, '$1−$2')
    .replace(/sqrt\(([^()]*)\)/g, '√($1)')
}

/** NOVA's canonical notation → safe TeX for KaTeX (display only; the canonical text stays the source of truth). */
export function canonToTex(text: string): string {
  let s = text.replace(/[\\$#%&~]/g, ' ')
  const group = (t: string) => t.replace(/^\{(.*)\}$/, '$1')
  s = s.replace(/∫\s*_\{?([^}\s^]+)\}?\s*\^\{?([^}\s]+)\}?/g, (_, a: string, b: string) => `\\int_{${group(a)}}^{${group(b)}} `)
    .replace(/∫/g, '\\int ')
    .replace(/\bd([a-zθ])\b(?=\s*(=|$|\)))/g, '\\,d$1')
    .replace(/\bd\/d([a-z])\s*\(/g, '\\frac{d}{d$1}\\left(').replace(/\bd([a-z])\/d([a-z])\b/g, '\\frac{d$1}{d$2}')
    .replace(/\blim\s*_?\(?\s*([a-z])\s*(?:->|→)\s*([^\s)]+)\)?/g, '\\lim_{$1 \\to $2}')
    .replace(/sqrt\(([^()]*)\)/g, '\\sqrt{$1}')
    .replace(/\^\(([^()]*)\)/g, '^{$1}').replace(/\^(-?[\w.]+)/g, '^{$1}')
    .replace(/(?<![\w)])(\d+|[a-z])\s*\/\s*(\d+|[a-z])(?![\w(])/g, '\\frac{$1}{$2}')
    .replace(/\s\*\s/g, ' \\times ').replace(/−/g, '-')
    .replace(/\b(sin|cos|tan|ln|log|exp)\b/g, '\\$1 ').replace(/θ/g, '\\theta ').replace(/π/g, '\\pi ')
    .replace(/≤/g, '\\le ').replace(/≥/g, '\\ge ')
  // balance \left( with \right)
  const opens = (s.match(/\\left\(/g) ?? []).length
  let k = 0
  s = s.replace(/\)/g, (m) => (k < opens && ++k ? '\\right)' : m))
  return s.replace(/\s+/g, ' ').trim()
}
