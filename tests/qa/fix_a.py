"""Teaching fixes found in the journeys: no unprompted solutions, cards never in the writing lane, one live reply card,
short page note, imported questions grounded, Ask panel beside the test panel."""
import sys
from pathlib import Path

root = Path(sys.argv[1])


def edit(rel, pairs):
    p = root / rel
    s = p.read_bytes().decode("utf-8")
    crlf = "\r\n" in s
    s = s.replace("\r\n", "\n")
    for old, new in pairs:
        assert s.count(old) == 1, (rel, old[:100])
        s = s.replace(old, new)
    p.write_bytes((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))


# ---- server: the focused point is returned separately, for the page note
edit("server/app/services.py", [
    ('_DETAIL: contextvars.ContextVar[str | None] = contextvars.ContextVar("tutor_detail", default=None)\n',
     '_DETAIL: contextvars.ContextVar[str | None] = contextvars.ContextVar("tutor_detail", default=None)\n'
     '_NOTE: contextvars.ContextVar[str | None] = contextvars.ContextVar("tutor_note", default=None)\n'),
    ('    _DETAIL.set(clean_text(obj.get("detail"), 900) or None)\n',
     '    _DETAIL.set(clean_text(obj.get("detail"), 900) or None)\n'
     '    _NOTE.set(say if say and nxt else None)  # the page shows the focused point; the chat also has the next step\n'),
    ("            context=ctx, explanation=explanation, detail=detail, actions=actions,",
     "            context=ctx, explanation=explanation, detail=detail, note=_redact_answer(_NOTE.get() or \"\", None) or None if _NOTE.get() and explanation.startswith(_NOTE.get() or \"\") else None, actions=actions,"),
])
edit("server/app/schemas/models.py", [(
    "    detail: str | None = None  # a longer explanation, shown only when the student opens it\n",
    "    detail: str | None = None  # a longer explanation, shown only when the student opens it\n"
    "    note: str | None = None  # the focused point alone, for the note on the page (explanation adds the next step)\n",
)])

# ---- client: types
edit("web/src/tutor/api.ts", [("  detail?: string | null\n", "  detail?: string | null\n  note?: string | null\n")])

# ---- useNova: hold back unprompted worked solutions; grounded exam help with the student's work; one live reply card
edit("web/src/tutor/useNova.ts", [
    (
        "    if (res.kind === 'solution' && res.steps?.length) {\n      // the whole worked solution",
        "    // An equation the student has written is theirs to solve: NOVA marks and offers Solve, but does not write the\n"
        "    // solution unasked. Lines that ask (\"x = ?\", \"4 + 2 =\", \"find …\") and the Solve button (force) are answered.\n"
        "    if (!force && res.kind === 'solution' && /=/.test(text) && !/=\\s*$/.test(text) && !isQuestion(text)) return false\n"
        "    if (res.kind === 'solution' && res.steps?.length) {\n      // the whole worked solution",
    ),
    (
        "extra?: { exam?: NonNullable<TutorPayload['exam']>; anchorRect?: Rect; speak?: boolean }) => {",
        "extra?: { exam?: NonNullable<TutorPayload['exam']>; anchorRect?: Rect; speak?: boolean; workRegionId?: string }) => {",
    ),
    (
        """      if (extra?.exam) {
        // exam help is about the printed question, not a written line
      } else if""",
        """      if (extra?.exam) {
        // a printed question: the student's latest working under it (if any) is the current step
        if (extra.workRegionId && p1.regions.some((r) => r.id === extra.workRegionId)) currentId = extra.workRegionId
      } else if""",
    ),
    (
        "    if (res.explanation && !hasNote && !visual && !pageLevel && !actions.some((a) => a.type === 'write_lines' || a.type === 'write_table')) actions.unshift({ id: `${ctx.requestId}:x`, type: 'add_note', anchorRegionId: ctx.regionId, text: res.explanation })\n",
        "    // the page gets the focused point; the next step and the longer explanation live in the chat\n"
        "    const noteText = res.note || res.explanation\n"
        "    if (noteText && !hasNote && !visual && !pageLevel && !actions.some((a) => a.type === 'write_lines' || a.type === 'write_table')) actions.unshift({ id: `${ctx.requestId}:x`, type: 'add_note', anchorRegionId: ctx.regionId, text: noteText })\n",
    ),
    (
        "    const pending = { ...p, tutorObjects: [...p.tutorObjects] }\n    const replaced: string[] = []\n",
        "    // one live reply: the cards of NOVA's earlier replies give way to this one (the chat keeps them all);\n"
        "    // handwriting NOVA wrote (answers, marks, solutions, tables) stays\n"
        "    const CARD = new Set(['add_note', 'speak', 'draw_groups', 'highlight_region', 'write_equation'])\n"
        "    const replyCards = (t: TutorObject) => t.status === 'active' && CARD.has(t.action.type) && !(t.action.type === 'write_equation' && t.action.purpose === 'completion') && !t.id.startsWith('auto:') && !t.id.startsWith('mark:')\n"
        "    const retiring = fresh.some((a) => CARD.has(a.type)) ? p.tutorObjects.filter(replyCards).map((t) => t.id) : []\n"
        "    const pending = { ...p, tutorObjects: p.tutorObjects.filter((t) => !retiring.includes(t.id)) }\n"
        "    const replaced: string[] = [...retiring]\n",
    ),
    (
        "        caption: a === visual && !hasNote && a.type !== 'plot_function' ? res.explanation.slice(0, 400) : undefined,\n",
        "        caption: a === visual && !hasNote && a.type !== 'plot_function' ? noteText : undefined,\n",
    ),
])

# ---- layout: never put a card in the writing lane under the student's lines; go right of their writing (page grows)
edit("web/src/tutor/layout.ts", [(
    """    const { w, h } = estimateSize(a)
    const candidates: Rect[] = []
    for (let dy = 0; dy <= 240; dy += 24) candidates.push({ x: anchor.x + anchor.w + 32, y: anchor.y - 8 + dy, w, h })
    for (let dy = 16; dy <= 480; dy += 24) candidates.push({ x: anchor.x, y: anchor.y + anchor.h + dy, w, h })
    for (let dy = -120; dy <= 480; dy += 24) for (let x = anchor.x + anchor.w + 32; x + w <= page.width; x += 48) candidates.push({ x, y: anchor.y + dy, w, h })
    let spot = candidates.find(fits)
    let leader = false
    if (!spot) {""",
    """    const { w, h } = estimateSize(a)
    // the student writes their next lines below and beside their work: cards go to the right of everything the
    // student has written at this height (the page is endless and grows to the right), never underneath it
    const band = page.strokes.map(strokeBounds).filter((b) => b.y + b.h > anchor.y - 60 && b.y < anchor.y + Math.max(anchor.h, h) + 260)
    const clearX = Math.max(anchor.x + anchor.w, ...band.map((b) => b.x + b.w)) + 40
    const candidates: Rect[] = []
    for (let x = clearX; x <= clearX + 960; x += 48) for (let dy = -8; dy <= 240; dy += 24) candidates.push({ x, y: Math.max(8, anchor.y + dy), w, h })
    const fitsRight = (r: Rect) => r.y >= 8 && !obstacles.some((o) => intersects(o, r))
    let spot = candidates.find(fitsRight)
    let leader = false
    if (spot && Math.abs(spot.y - anchor.y) > 160) leader = true
    if (!spot) {""",
)])

# ---- paper: Help includes the student's working under the question
edit("web/src/tutor/usePaper.ts", [(
    "      void o.nova.ask('hint', `Help me with question ${q.number}. Don't tell me the answer.`, null, { exam: { number: q.number, text: q.text, answer: q.answer, reveal: false }, anchorRect: q.bounds })\n",
    "      const work = answerRegions(doc(o).pages[q.pageId], t, q)\n"
    "      void o.nova.ask('hint', `Help me with question ${q.number}. Don't tell me the answer.`, null, { exam: { number: q.number, text: q.text, answer: q.answer, reveal: false }, anchorRect: q.bounds, workRegionId: work[work.length - 1]?.id })\n",
)])

# ---- notebook: Ask on a question-paper page is about the printed question the student is working on
edit("web/src/notebook/NotebookScreen.tsx", [
    (
        """    void nova.ask(intent, question, askAbout && page.regions.some((r) => r.id === askAbout) ? askAbout : null, o?.voice ? { speak: true } : undefined)
""",
        """    const about = askAbout && page.regions.some((r) => r.id === askAbout) ? askAbout : null
    const exam = about ? undefined : paperQuestionInFocus()
    void nova.ask(intent, question, about, { ...(o?.voice ? { speak: true } : {}), ...(exam ?? {}) })
  }

  /** On a question-paper page: the printed question under which the student last wrote, else the first one in view. */
  const paperQuestionInFocus = () => {
    const t = activeTestFor(state, pageId)
    const qs = (t?.questions ?? []).filter((q) => q.pageId === pageId)
    if (!t || !qs.length) return undefined
    const latest = [...page.regions].sort((a, b) => b.createdAt - a.createdAt)[0]
    let q = latest ? qs.find((x) => answerRegions(page, t, x).some((r) => r.id === latest.id)) : undefined
    const top = -view.ty / view.scale
    q ??= qs.filter((x) => x.bounds.y + x.bounds.h >= top).sort((a, b) => a.bounds.y - b.bounds.y)[0] ?? qs[0]
    const work = answerRegions(page, t, q)
    return {
      exam: { number: q.number, text: q.text, answer: q.answer, reveal: t.status === 'finished' },
      anchorRect: q.bounds,
      workRegionId: work[work.length - 1]?.id,
    }
""",
    ),
    (
        "          onClose={() => setAsk(null)}\n        />",
        "          onClose={() => setAsk(null)}\n          offsetRight={!phone && testOpen && activeTest && !focus ? 376 : undefined}\n        />",
    ),
])
s = (root / "web/src/notebook/NotebookScreen.tsx").read_text(encoding="utf-8")
if "answerRegions" not in s.split("export function", 1)[0]:
    edit("web/src/notebook/NotebookScreen.tsx", [("import { TestPanel } from '../ui/TestPanel'\n", "import { TestPanel } from '../ui/TestPanel'\nimport { activeTestFor, answerRegions } from '../tutor/usePaper'\n")])

edit("web/src/ui/AskPopover.tsx", [
    ("  onClose: () => void\n", "  onClose: () => void\n  offsetRight?: number // keep clear of a panel on the right (the test panel)\n"),
    ("export function AskPanel({ docked, startWithMic, turns, status, about, onClearAbout, onSend, onClose }: Props) {",
     "export function AskPanel({ docked, startWithMic, turns, status, about, onClearAbout, onSend, onClose, offsetRight }: Props) {"),
    ("""<aside className={docked ? 'ask-panel' : 'ask-panel sheet-mode'} onPointerDown""",
     """<aside className={docked ? 'ask-panel' : 'ask-panel sheet-mode'} style={docked && offsetRight ? { right: offsetRight } : undefined} onPointerDown"""),
])
print("ok")
