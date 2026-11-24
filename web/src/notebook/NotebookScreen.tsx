import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import { newPage, type DocAction, type DocState } from './doc'
import { strokeHit, strokeInSelection, containsPoint, inflate } from './geometry'
import { shortId } from './ids'
import { INK_COLOURS, INK_WIDTHS, type View } from './ink'
import type { Paper, Point, Rect, Stroke, Tool, TutorObject } from './types'
import { clampView, isInfinite, Workspace } from './Workspace'
import { TutorLayer } from '../tutor/Annotations'
import { useNova, type Intent } from '../tutor/useNova'
import { AskPanel } from '../ui/AskPopover'
import { DictatePanel } from '../ui/DictatePanel'
import { TypedLayer, TYPED_FONT, measureTyped } from './TypedLayer'
import { prettyMath } from '../voice/spokenMath'
import { questionById, questionForRegion, unattributed, workFor, type QuestionContext } from '../tutor/questionContext'
import { TestPanel } from '../ui/TestPanel'
import { StatusPill } from '../ui/StatusPill'
import { AnswerFrames } from '../ui/AnswerFrames'
import { activeTestFor, answerRegions } from '../tutor/usePaper'
import { HandwritingSetup } from '../ui/HandwritingSetup'
import type { StartAction } from '../ui/Home'
import { Shelf } from '../ui/Shelf'
import { usePaper } from '../tutor/usePaper'
import { readingText } from './doc'
import { Icon } from '../ui/icons'
import { HistoryDrawer, ObjectSheet, PagesRail } from '../ui/Panels'
import { ReadbackLayer, RegionMenu, type RegionMenuAction } from '../ui/Readback'
import { AssistConsent, SettingsDialog, type AppSettings } from '../ui/Settings'
import { getAsset, putAsset } from '../storage/db'
import { buildBackup, checksumBytes, downloadJson } from '../storage/backup'
import { speak, stopSpeaking } from '../voice/speech'
import { PracticeDialog } from '../ui/PracticeDialog'
import { FirstRun } from '../ui/FirstRun'
import { downloadBlob, pageHasContent, printPng, renderPagePng, safeName, sharePng } from '../storage/share'
import { isWeak, progress } from '../tutor/topics'

export type SaveStatus = 'saved' | 'saving' | 'error'

interface Props {
  state: DocState
  dispatch: Dispatch<DocAction>
  settings: AppSettings
  setSettings: (s: AppSettings) => void
  saveStatus: SaveStatus
  saveError: string | null
  onRetrySave: () => void
  onBack: () => void
  startAction?: StartAction | null
  onStartConsumed?: () => void
  /** first visit: show what NOVA can do */
  showWelcome?: boolean
  onWelcomeDone?: () => void
  /** Home: this notebook is the scratch page; notebooks are pinned onto its grid */
  home?: { onOpen: (id: string) => void; onNew: () => void; onImportPaper: (file: File) => void; onRestore: (file: File) => void }
}

interface Toast {
  id: string
  text: string
  action?: { label: string; fn: () => void }
}

function useViewport() {
  const [size, setSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1200,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }))
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

export function NotebookScreen({ state, dispatch, settings, setSettings, saveStatus, saveError, onRetrySave, onBack, startAction, onStartConsumed, home, showWelcome, onWelcomeDone }: Props) {
  const homePdfRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLInputElement>(null)
  const { doc } = state
  const nb = doc.notebook
  const pageId = nb.lastPageId && doc.pages[nb.lastPageId] ? nb.lastPageId : nb.orderedPageIds[0]
  const page = doc.pages[pageId]
  const pageIndex = nb.orderedPageIds.indexOf(pageId)
  const { w: vw, h: vh } = useViewport()
  const phone = vw < 700 || Math.min(vw, vh) < 500 || (vw < 1000 && vh < 560)
  const desktop = vw >= 1100 && vh >= 600
  // touch screens (tablets) get the tool dock on the left edge, under the writing hand's opposite side
  const touch = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, [])
  // height of the floating bars over the page: the page's first line starts below them (Home has its own bar)
  const chromeTop = home ? 0 : phone ? 76 : 84
  // touch screens keep the tool dock on the left edge: the page starts to its right
  const chromeLeft = !home && !phone && touch ? 88 : 0

  const [tool, setTool] = useState<Tool>('pen')
  const [hovered, setHovered] = useState<string | null>(null)
  const [colour, setColour] = useState(INK_COLOURS[0].value)
  const [width, setWidth] = useState(INK_WIDTHS[1].value)
  const [lasso, setLasso] = useState(false)
  const [view, setViewRaw] = useState<View>({ scale: 1, tx: 16, ty: 16 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const [ask, setAsk] = useState<{ mic: boolean; key: number; text?: string } | null>(null)
  const [dictate, setDictate] = useState<{ mic: boolean; key: number } | null>(null) // "Write on page" by voice
  const [typedEdit, setTypedEdit] = useState<string | null>(null) // a dictated block being edited
  const [typeFor, setTypeFor] = useState<{ regionId: string; text: string } | null>(null) // "Type the expression" for a line
  const [askAbout, setAskAbout] = useState<string | null>(null) // line the conversation is about (null = whole page)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [menu, setMenu] = useState<null | 'overflow' | 'ink' | 'page' | 'dock'>(null)
  const [sheet, setSheet] = useState<TutorObject | null>(null)
  const [focus, setFocus] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [bgUrl, setBgUrl] = useState<string | undefined>()
  const [titleDraft, setTitleDraft] = useState(nb.title)
  const stylusOffered = useRef(false)

  const stateRef = useRef(state)
  stateRef.current = state
  const penActive = useRef(false)
  const bgImage = useRef<HTMLImageElement | null>(null)
  const views = useRef(new Map<string, View>())
  const fileRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const [testOpen, setTestOpen] = useState(false)
  const [currentQ, setCurrentQ] = useState<string | null>(null) // the question the student last opened
  // a new piece of work on a paper page is attributed to its question ONCE (by where it was written); afterwards the
  // recorded owner is used, so scrolling, edits and moves never change which question it answers
  useEffect(() => {
    const owners = unattributed(state.doc, page)
    if (owners.length) dispatch({ type: 'ownAnswers', owners })
  }, [page.regions, state.doc.tests]) // eslint-disable-line react-hooks/exhaustive-deps
  const [sideTab, setSideTab] = useState<'test' | 'ask'>('test') // laptop/tablet: one side area, Test and Ask as tabs
  const [hwOpen, setHwOpen] = useState(false)
  const [practiceOpen, setPracticeOpen] = useState<{ example: string | null } | null>(null)
  const [tourOpen, setTourOpen] = useState(false)

  useEffect(() => setTitleDraft(nb.title), [nb.title])

  const toast = useCallback((text: string, action?: Toast['action']) => {
    const id = shortId('t')
    setToasts((t) => [...t.slice(-2), { id, text, action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : 5000)
  }, [])

  const nova = useNova({
    stateRef,
    dispatch,
    pageId,
    assist: settings.assist,
    autoAnswer: settings.autoAnswer,
    speechEnabled: settings.speechOutput,
    background: bgImage,
    penActive,
    onCapReached: () => toast('Automatic reading paused after 60 reads this session. Use Read on a line to continue.'),
    onBatchApplied: (n, batchId) => {
      toast(`NOVA added ${n} ${n === 1 ? 'item' : 'items'}.`, { label: 'Undo', fn: () => undoBatch(batchId) })
      setTimeout(() => revealRef.current(batchId), 80) // once the new writing is on the page
    },
  })

  const undoBatch = (batchId: string) => {
    const stack = stateRef.current.tutorUndo[pageId] ?? []
    if (stack[stack.length - 1] === batchId) dispatch({ type: 'undoTutor', pageId })
    else {
      const p = stateRef.current.doc.pages[pageId]
      p.tutorObjects.filter((t) => t.batchId === batchId).forEach((t) => dispatch({ type: 'dismissTutor', pageId, id: t.id }))
    }
  }

  // ---- view
  const setView = useCallback(
    (v: View | ((v: View) => View)) => {
      setViewRaw((prev) => {
        const next = typeof v === 'function' ? v(prev) : v
        return size.w ? clampView(next, stateRef.current.doc.pages[pageId], size.w, size.h, chromeTop, chromeLeft) : next
      })
    },
    [size.w, size.h, pageId, chromeTop, chromeLeft],
  )
  /** Bring what NOVA just wrote into view: it must never land off-screen or behind the Ask panel. */
  const revealRef = useRef<(batchId: string) => void>(() => undefined)
  revealRef.current = (batchId: string) => {
    const pg = stateRef.current.doc.pages[pageId]
    const objs = pg?.tutorObjects.filter((t) => t.batchId === batchId && t.status === 'active' && t.action.type !== 'highlight_region' && t.action.type !== 'speak') ?? []
    if (!objs.length || !size.w) return
    const x0 = Math.min(...objs.map((t) => t.layout.x)), y0 = Math.min(...objs.map((t) => t.layout.y))
    const x1 = Math.max(...objs.map((t) => t.layout.x + t.layout.w)), y1 = Math.max(...objs.map((t) => t.layout.y + t.layout.h))
    // the part of the workspace nothing covers (the Ask panel sits on the right, or over the bottom on a phone)
    const visW = size.w - ((ask || dictate) && !phone ? 432 : 0)
    const visH = ask && phone ? size.h * 0.38 : size.h
    setView((v) => {
      const pad = 24
      let { tx, ty } = v
      const sx = tx + x0 * v.scale, sw = (x1 - x0) * v.scale
      const sy = ty + y0 * v.scale, sh = (y1 - y0) * v.scale
      if (sx + sw > visW - pad) tx += visW - pad - (sx + sw)
      if (tx + x0 * v.scale < pad) tx = pad - x0 * v.scale // too wide to fit: show its start
      if (sy + sh > visH - pad) ty += visH - pad - (sy + sh)
      if (ty + y0 * v.scale < pad) ty = pad - y0 * v.scale
      return tx === v.tx && ty === v.ty ? v : { ...v, tx, ty }
    })
  }

  // true while the view is NOVA's own fit (the student hasn't panned or zoomed since): then a width change refits
  const autoFit = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null) // .writing while the pen is down (a class, not state: nothing re-renders on the pen path)
  const fitWidth = useCallback(() => {
    if (!size.w) return
    autoFit.current = true
    if (page.bg) {
      // an imported sheet: fit its width, leaving the grid around it; a test paper also shows the answer column beside it
      const isTestPage = !phone && Object.values(stateRef.current.doc.tests ?? {}).some((t) => t.pageIds.includes(page.id) && t.status !== 'finished')
      const room = size.w - chromeLeft - (phone ? 16 : 120)
      const scale = Math.min(2, room / (page.bg.w + (isTestPage && room >= 900 ? 400 : 0)))
      setView({ scale, tx: chromeLeft, ty: chromeTop })
      return
    }
    if (isInfinite(page)) {
      setView({ scale: 1, tx: chromeLeft, ty: chromeTop }) // phones too: zooming out makes finger writing huge in page terms
      return
    }
    const scale = Math.min(2, (size.w - (phone ? 16 : 48)) / page.width)
    setView({ scale, tx: phone ? 8 : 24, ty: chromeTop + (phone ? 12 : 16) })
  }, [size.w, page, phone, setView, chromeTop, chromeLeft])

  useLayoutEffect(() => {
    if (!size.w) return
    const saved = views.current.get(pageId)
    if (saved) setView(saved)
    else fitWidth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, size.w > 0])
  useEffect(() => {
    views.current.set(pageId, view)
  }, [view, pageId])
  // the side panel opened or closed (or the window resized): keep a page the student hasn't moved fitted
  useEffect(() => {
    if (autoFit.current) fitWidth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w])

  // the endless grid: whatever part of it is on screen is part of the page (so NOVA can place things there too)
  useEffect(() => {
    if (!size.w || !isInfinite(page)) return
    const round = (v: number) => Math.ceil(v / 400) * 400
    const needW = round((size.w - view.tx) / view.scale + 200)
    const needH = round((size.h - view.ty) / view.scale + 200)
    if (needW > page.width || needH > page.height) dispatch({ type: 'ensureSize', pageId, width: needW, height: needH })
  }, [size.w, size.h, view, page, pageId, dispatch])

  // ---- background asset for imported pages
  useEffect(() => {
    let url: string | undefined
    let cancelled = false
    bgImage.current = null
    setBgUrl(undefined)
    if (page.backgroundAssetId) {
      void getAsset(page.backgroundAssetId).then((a) => {
        if (!a || cancelled) return
        url = URL.createObjectURL(new Blob([a.bytes], { type: a.mime }))
        const img = new Image()
        img.onload = () => (bgImage.current = img)
        img.src = url
        setBgUrl(url)
      })
    }
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [page.backgroundAssetId, page.bgState])

  // ---- content changes -> invalidate + schedule reading (covers strokes, erase, undo, redo)
  const prevHashes = useRef<Map<string, string> | null>(null)
  const prevPage = useRef(pageId)
  useEffect(() => {
    const now = new Map(page.regions.map((r) => [r.id, r.sourceHash]))
    const prev = prevHashes.current
    prevHashes.current = now
    if (!prev || prevPage.current !== pageId) {
      prevPage.current = pageId
      return
    }
    const changed = page.regions.filter((r) => prev.get(r.id) !== r.sourceHash && !page.readings[r.id])
    const removed = [...prev.keys()].some((id) => !now.has(id))
    if (changed.length) changed.forEach((r) => nova.contentChanged(r.id))
    else if (removed) nova.contentChanged(null)
    if (selected && !now.has(selected)) setSelected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.contentRevision, pageId])

  // ---- input handlers
  const commitStroke = (points: Point[]) => {
    const stroke: Stroke = { id: shortId('s'), points, colour, width, createdAt: Date.now(), author: 'student' }
    dispatch({ type: 'addStroke', pageId, stroke, newRegionId: shortId('r') })
    try { performance.mark('nova-trace', { detail: { key: '', stage: 'pen-up' } }) } catch { /* no detail marks */ }
  }

  const onSelect = (sel: { rect?: Rect; lasso?: Point[]; tap?: Point }) => {
    if (sel.tap) {
      const radius = 12 / view.scale
      const hit = page.strokes.find((s) => strokeHit(s, sel.tap!, radius))
      const region = hit ? page.regions.find((r) => r.sourceStrokeIds.includes(hit.id)) : page.regions.find((r) => containsPoint(inflate(r.bounds, 8), sel.tap!))
      setSelected(region?.id ?? null)
      return
    }
    const ids = page.strokes.filter((s) => strokeInSelection(s, sel)).map((s) => s.id)
    if (!ids.length) {
      setSelected(null)
      return
    }
    const same = page.regions.find((r) => r.sourceStrokeIds.length === ids.length && ids.every((id) => r.sourceStrokeIds.includes(id)))
    if (same) {
      setSelected(same.id)
      return
    }
    const regionId = shortId('r')
    dispatch({ type: 'selectRegion', pageId, strokeIds: ids, regionId })
    setSelected(regionId)
  }

  const regionBounds = useCallback((id: string) => page.regions.find((r) => r.id === id)?.bounds, [page.regions])

  useEffect(() => setSideTab(ask ? 'ask' : 'test'), [ask])
  /** Bring a line into view (from a reply's "Show on page"). */
  const showRegion = (regionId: string) => {
    const b = regionBounds(regionId)
    if (!b || !size.w) return
    setView((v) => ({ ...v, tx: Math.round(size.w * 0.3 - b.x * v.scale), ty: Math.round(size.h * 0.35 - b.y * v.scale) }))
  }

  const openAsk = (mic = false) => {
    setMenu(null)
    setDictate(null)
    setAskAbout(selected)
    setAsk({ mic, key: Date.now() })
  }

  const openDictate = (mic = true) => {
    setMenu(null)
    setAsk(null)
    setDictate({ mic, key: Date.now() })
  }

  /** Dictated maths goes on the page as the student's own text: below their latest work (or at the top of the view),
   *  clear of NOVA's writing, never solved. Its reading is its own text (no handwriting recognition). */
  const insertTyped = (text: string, display: string, transcript: string) => {
    const pg = stateRef.current.doc.pages[pageId]
    if (!pg) return
    void display
    const { w, h } = measureTyped(text, TYPED_FONT)
    const mine = pg.regions.filter((r) => r.bounds.w > 0)
    const taken: Rect[] = [...mine.map((r) => r.bounds), ...pg.tutorObjects.filter((t) => t.status === 'active').map((t) => t.layout)]
    const viewTop = (-view.ty + 140) / view.scale, viewBottom = (-view.ty + size.h - 120) / view.scale
    let x = Math.max(40, (-view.tx + 80) / view.scale)
    let y = Math.max(40, viewTop)
    if (mine.length) {
      const below = Math.max(...mine.map((r) => r.bounds.y + r.bounds.h)) + 40
      if (below >= viewTop && below + h <= viewBottom) { x = Math.max(24, Math.min(...mine.map((r) => r.bounds.x))); y = below }
    }
    const hits = (yy: number) => taken.some((t) => t.x < x + w && t.x + t.w > x && t.y < yy + h + 12 && t.y + t.h > yy - 12)
    for (let k = 0; k < 60 && hits(y); k++) y += 24
    const id = shortId('tb')
    const regionId = shortId('r')
    dispatch({ type: 'addTyped', pageId, regionId, asProblem: true, block: { id, text, display: prettyMath(text), x, y, w, h, fontSize: TYPED_FONT, createdAt: Date.now(), source: 'dictation', transcript: transcript.slice(0, 600) } })
    setTimeout(() => showRegion(regionId), 50)
    toast('Written on your page. Select it to ask NOVA for a hint, an explanation or the full solution.')
  }

  /** From the region menu: act on the selected line. */
  const runIntent = (intent: Intent, question: string) => helpFor(selected, intent, question)

  /** The question a selected piece of work belongs to (a printed question on an imported paper), if any. */
  const questionOf = (regionId: string | null): QuestionContext | null => questionForRegion(state.doc, page, regionId)
  const examExtra = (qc: QuestionContext, work?: string | null) => ({
    exam: qc.exam, anchorRect: qc.question.bounds, historyKey: qc.historyKey,
    workRegionId: work ?? workFor(page, qc).at(-1)?.id,
  })

  /** Hint / Next step / Explain / Full solution on a selected line. On a paper, the selected answer's OWN question is used
   *  (explicit selection beats position or "the latest line"); its question text, its answer and its history only. */
  const helpFor = (regionId: string | null, intent: Intent | 'solve', question = '') => {
    if (!regionId) return
    const qc = questionOf(regionId)
    if (qc) {
      setCurrentQ(qc.question.id)
      const q = intent === 'solve' ? 'Show me the full worked solution.' : intent === 'explain' && !question ? 'Explain why.' : question
      return void nova.ask(intent === 'solve' ? 'ask' : intent, q, null, examExtra(qc, regionId))
    }
    if (intent === 'solve') return void nova.solveHere(regionId)
    void nova.ask(intent, intent === 'explain' && !question ? 'Explain why.' : question, regionId)
  }

  /** From the Ask panel: the conversation continues; it is about askAbout (or the whole page). */
  const askFromPanel = (intent: Intent, question: string, o?: { voice?: boolean }) => {
    // asked by voice → NOVA answers out loud too (typed questions stay silent unless "always speak" is on)
    const about = askAbout && page.regions.some((r) => r.id === askAbout) ? askAbout : null
    const qc = about ? questionOf(about) : null
    if (qc) return void nova.ask(intent, question, null, { ...(o?.voice ? { speak: true } : {}), ...examExtra(qc, about) })
    const exam = about ? undefined : paperQuestionInFocus()
    void nova.ask(intent, question, about, { ...(o?.voice ? { speak: true } : {}), ...(exam ?? {}) })
  }

  /** On a question-paper page: the printed question under which the student last wrote, else the first one in view. */
  const paperQuestionInFocus = () => {
    const t = activeTestFor(state, pageId)
    const qs = (t?.questions ?? []).filter((q) => q.pageId === pageId)
    if (!t || !qs.length) return undefined
    // the question the student opened (Test panel / last helped) comes first; then the question under the latest work
    let q = currentQ ? qs.find((x) => x.id === currentQ) : undefined
    const latest = [...page.regions].sort((a, b) => b.createdAt - a.createdAt)[0]
    q ??= latest ? qs.find((x) => questionOf(latest.id)?.question.id === x.id) : undefined
    const top = -view.ty / view.scale
    q ??= qs.filter((x) => x.bounds.y + x.bounds.h >= top).sort((a, b) => a.bounds.y - b.bounds.y)[0] ?? qs[0]
    const work = answerRegions(page, t, q)
    const qc = questionById(state.doc, q.id)
    return qc ? examExtra(qc) : { exam: { id: q.id, number: q.number, text: q.text, answer: q.answer, reveal: t.status === 'finished' }, anchorRect: q.bounds, workRegionId: work[work.length - 1]?.id }
  }

  const regionAction = (a: RegionMenuAction) => {
    if (!selected) return
    if (a === 'close') return setSelected(null)
    if (a === 'ask') return openAsk()
    if (a === 'read') return void nova.readNow(selected).catch((e) => toast((e as Error).message))
    if (a === 'problem') {
      dispatch({ type: 'setProblem', pageId, regionId: selected })
      toast('This line is now the problem. Help on it is tracked separately.')
      return
    }
    if (a === 'practice') {
      setPracticeOpen({ example: readingText(page.readings[selected]) ?? null })
      setSelected(null)
      return
    }
    if (a === 'hint') { runIntent('hint', ''); return setSelected(null) }
    if (a === 'explain') { runIntent('explain', 'Explain why.'); return setSelected(null) }
    const tb = page.regions.find((r) => r.id === selected)?.typedId
    if (a === 'edit') {
      if (tb) setTypedEdit(tb)
      else setTypeFor({ regionId: selected, text: readingText(page.readings[selected]) ?? '' })
      return
    }
    if (a === 'move') return toast('Drag the ✥ Move handle above the question (or focus it and use the arrow keys).')
    if (a === 'delete') {
      if (tb) dispatch({ type: 'deleteTyped', pageId, id: tb })
      return setSelected(null)
    }
    if (a === 'solve') helpFor(selected, 'solve')
    else runIntent(a, '')
    setSelected(null) // the menu must not sit over the answer NOVA is about to place
  }

  // ---- pages
  const addPage = () => {
    const p = newPage(nb.id, `Page ${nb.orderedPageIds.length + 1}`, { paper: page.paper })
    dispatch({ type: 'addPage', page: p, after: pageId })
    setSelected(null)
  }
  const openPage = (id: string) => {
    stopSpeaking()
    setSelected(null)
    setAsk(null)
    dispatch({ type: 'setLastPage', pageId: id })
    if (phone) setPagesOpen(false)
  }

  const paper = usePaper({
    stateRef,
    dispatch,
    currentPageId: pageId,
    openPage,
    nova,
    toast,
    openAsk: () => {
      setAskAbout(null)
      setAsk((a) => a ?? { mic: false, key: Date.now() })
    },
  })
  // opened from Home with something to do straight away
  const started = useRef(false)
  useEffect(() => {
    if (!startAction || started.current) return
    started.current = true
    if (startAction.type === 'pdf') {
      setTestOpen(true)
      void paper.importPaper(startAction.file)
    } else if (startAction.type === 'practice') {
      void runPractice({ topic: startAction.topic, count: startAction.count, allowHelp: startAction.allowHelp })
    } else if (startAction.type === 'tip') {
      toast(startAction.text, { label: 'Got it', fn: () => undefined })
    } else {
      setAskAbout(null)
      setAsk({ mic: false, key: Date.now(), text: startAction.text })
    }
    onStartConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAction])
  const runPractice = async (p: { topic?: string; example?: string; count?: number; allowHelp?: boolean }) => {
    setPracticeOpen(null)
    setTestOpen(false)
    const id = await paper.startPractice(p)
    if (id) setTestOpen(true)
  }
  const weakTopics = useMemo(() => progress([doc]).topics.filter(isWeak).map((t) => t.topic), [doc])

  // ---- share the page (image to the share sheet / download, or print to PDF)
  const [sharing, setSharing] = useState(false)
  const sharePage = async (mode: 'share' | 'download' | 'pdf') => {
    setMenu(null)
    const pg = stateRef.current.doc.pages[pageId]
    if (!pageHasContent(pg)) return toast('This page is empty. Write something first.')
    const title = `${nb.title} · ${pg.title || `Page ${pageIndex + 1}`}`
    setSharing(true)
    try {
      const blob = await renderPagePng(pg, title)
      if (mode === 'pdf') await printPng(blob, title)
      else if (mode === 'download') downloadBlob(blob, `${safeName(title)}.png`)
      else if ((await sharePng(blob, title)) === 'downloaded') toast('Page saved as an image. Send it from your downloads.')
    } catch (e) {
      toast((e as Error).message || 'Could not share this page.')
    } finally {
      setSharing(false)
    }
  }

  const testsList = Object.values(doc.tests ?? {}).sort((a, b) => b.createdAt - a.createdAt)
  const activeTest = testsList.find((t) => t.pageIds.includes(pageId)) ?? testsList[0]
  const gotoQuestion = (q: { id?: string; pageId: string; bounds: Rect }) => {
    if (q.id) setCurrentQ(q.id)
    openPage(q.pageId)
    setTimeout(() => setView((v) => ({ ...v, ty: 130 - q.bounds.y * v.scale })), 60)
  }

  const importImage = async (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Choose a PNG, JPEG or WebP image.')
    if (file.size > 12_000_000) return toast('That image is larger than 12 MB.')
    try {
      const bytes = await file.arrayBuffer()
      const url = URL.createObjectURL(file)
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = () => rej(new Error('Could not open that image.'))
        i.src = url
      })
      URL.revokeObjectURL(url)
      const id = shortId('as')
      await putAsset({ id, mime: file.type, bytes, width: img.naturalWidth, height: img.naturalHeight, checksum: checksumBytes(bytes) })
      const w = 1200
      const h = Math.round((w * img.naturalHeight) / img.naturalWidth) // preserve aspect ratio
      const p = newPage(nb.id, file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Homework', { width: w, height: Math.max(200, Math.min(h, 8000)), backgroundAssetId: id, paper: 'squared', bg: { w, h: Math.max(200, Math.min(h, 8000)) } })
      dispatch({ type: 'addPage', page: p, after: pageId })
      toast('Homework imported as a new page. Write your working on it.')
    } catch (e) {
      toast((e as Error).message || 'Import failed. Your notebook is unchanged.')
    }
  }

  const exportBackup = async () => {
    try {
      const b = await buildBackup(stateRef.current.doc)
      downloadJson(`${nb.title.replace(/[^\w-]+/g, '_') || 'notebook'}.nova.json`, b)
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`)
    }
  }

  // ---- keyboard
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo', pageId })
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo', pageId })
      } else if (!mod) {
        const k = e.key.toLowerCase()
        if (k === 'p') setTool('pen')
        else if (k === 'e') setTool('eraser')
        else if (k === 's') setTool('select')
        else if (k === 'h') setTool('pan')
        else if (k === 'escape') {
          setSelected(null)
          setAsk(null)
          setMenu(null)
        }
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [dispatch, pageId])

  useEffect(() => {
    const stop = () => document.visibilityState === 'hidden' && stopSpeaking()
    document.addEventListener('visibilitychange', stop)
    return () => document.removeEventListener('visibilitychange', stop)
  }, [])

  const canUndo = (state.undo[pageId]?.length ?? 0) > 0
  const canRedo = (state.redo[pageId]?.length ?? 0) > 0
  const pageTurns = useMemo(() => page.history, [page.history])

  const toggleAssist = () => {
    if (settings.assist) setSettings({ ...settings, assist: false })
    else if (!settings.assistConsent) setConsentOpen(true)
    else setSettings({ ...settings, assist: true })
  }

  useEffect(() => {
    const st = nova.status
    if (st.state === 'idle' || st.state === 'working' || st.retry) return
    const t = setTimeout(() => nova.setStatus({ state: 'idle' }), 4000) // notices don't linger on the page
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nova.status])

  const zoomBy = (f: number) => {
    autoFit.current = false
    setView((v) => {
      const scale = Math.min(4, Math.max(0.2, Math.round(v.scale * f * 100) / 100))
      const cx = size.w / 2, cy = size.h / 2
      return { scale, tx: cx - ((cx - v.tx) * scale) / v.scale, ty: cy - ((cy - v.ty) * scale) / v.scale }
    })
  }
  const toolButton = (t: Tool, label: string, icon: React.ReactNode, extra?: string, showLabel = false) => (
    <button key={t} className={`ob-tool ${tool === t ? 'on' : ''}`} aria-pressed={tool === t} aria-label={label} title={extra ? `${label} — ${extra}` : label} onClick={() => setTool(t)}>
      {icon}
      {showLabel && <span className="ob-tool-label">{label}</span>}
    </button>
  )
  const statusPill = (compact = false) => (
    <StatusPill compact={compact} status={nova.status.state === 'idle' && Object.values(nova.phases).some((x) => x.phase === 'recognizing') ? { state: 'working', message: 'Reading your line…' } : nova.status} checked={page.regions.filter((r) => page.readings[r.id]?.state === 'accepted').length} onStop={nova.cancel} onDismiss={() => nova.setStatus({ state: 'idle' })} onIdleClick={() => setHistoryOpen((v) => !v)} />
  )
  const busyOrError = nova.status.state === 'working' || nova.status.state === 'error' || nova.status.state === 'notice'
  const pageLabel = `${pageIndex + 1} / ${nb.orderedPageIds.length}`
  const renameNotebook = () => {
    const t = prompt('Notebook name', nb.title)
    if (t !== null && t.trim()) dispatch({ type: 'renameNotebook', title: t.trim() })
  }

  const inkPopover = (
    <div className="popover ink-pop" role="dialog" aria-label="Ink colour and width" onPointerDown={(e) => e.stopPropagation()}>
      <div className="ink-row">
        {INK_COLOURS.map((c) => (
          <button key={c.value} className={`ink-swatch ${colour === c.value ? 'on' : ''}`} aria-label={`Ink: ${c.name.toLowerCase()}`} aria-pressed={colour === c.value} onClick={() => { setColour(c.value); setTool('pen') }}><span style={{ background: c.value }} /></button>
        ))}
      </div>
      <div className="ink-row">
        {INK_WIDTHS.map((w) => (
          <button key={w.value} className={`ink-width ${width === w.value ? 'on' : ''}`} aria-label={w.name} aria-pressed={width === w.value} onClick={() => { setWidth(w.value); setTool('pen') }}>
            <span style={{ height: Math.max(2, Math.round(w.value * 1.15)) }} />
          </button>
        ))}
      </div>
      <div className="pop-label">Select shape</div>
      <div className="row gap">
        <button className={`chip ${!lasso ? 'on' : ''}`} onClick={() => setLasso(false)}>Rectangle</button>
        <button className={`chip ${lasso ? 'on' : ''}`} onClick={() => setLasso(true)}>Lasso</button>
      </div>
    </div>
  )

  const pagePopover = (
    <div className="popover menu page-pop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="pop-label">Paper</div>
      {(['squared', 'ruled', 'blank'] as Paper[]).map((p) => (
        <button key={p} className={`menu-item ${page.paper === p ? 'on' : ''}`} disabled={!!page.backgroundAssetId} onClick={() => { dispatch({ type: 'setPaper', pageId, paper: p }); setMenu(null) }}>
          {p[0].toUpperCase() + p.slice(1)}
        </button>
      ))}
      <hr />
      <button className="menu-item" onClick={() => { addPage(); setMenu(null) }}>New page</button>
      <button className="menu-item" onClick={() => { pdfRef.current?.click(); setMenu(null) }}>Import question paper (PDF)…</button>
      <button className="menu-item" onClick={() => { fileRef.current?.click(); setMenu(null) }}>Import homework image…</button>
      <button className="menu-item" onClick={() => { const t = prompt('Page name', page.title); if (t !== null) dispatch({ type: 'renamePage', pageId, title: t }); setMenu(null) }}>Rename page…</button>
      <button className="menu-item" disabled={nb.orderedPageIds.length <= 1} onClick={() => { if (confirm('Delete this page?')) dispatch({ type: 'deletePage', pageId }); setMenu(null) }}>Delete page</button>
    </div>
  )

  const overflowPopover = (
    <div className="popover menu overflow-pop" onPointerDown={(e) => e.stopPropagation()}>
      <button className="menu-item" onClick={() => { setPracticeOpen({ example: null }); setMenu(null) }}>Practice a topic…</button>
      <button className="menu-item" disabled={sharing} onClick={() => void sharePage('share')}>Share page as image</button>
      <button className="menu-item" disabled={sharing} onClick={() => void sharePage('download')}>Download page image (.png)</button>
      <button className="menu-item" disabled={sharing} onClick={() => void sharePage('pdf')}>Save page as PDF…</button>
      <hr />
      <button className="menu-item" onClick={() => { setSettingsOpen(true); setMenu(null) }}>Settings & connection</button>
      <button className="menu-item" onClick={() => { void exportBackup(); setMenu(null) }}>Export backup</button>
      <button className="menu-item" onClick={() => { setFocus(true); setMenu(null) }}>Focus mode</button>
      <button className="menu-item" onClick={() => { setHistoryOpen(true); setMenu(null) }}>NOVA history</button>
      <button className="menu-item" onClick={() => { setMenu('page') }}>Paper & page options…</button>
      <button className="menu-item" onClick={() => { renameNotebook(); setMenu(null) }}>Rename notebook…</button>
      <button className="menu-item" onClick={() => { setTourOpen(true); setMenu(null) }}>What NOVA can do</button>
      <hr />
      <button className="menu-item" onClick={() => { addPage(); setMenu(null) }}>New page</button>
      <button className="menu-item" onClick={() => { pdfRef.current?.click(); setMenu(null) }}>Import question paper (PDF)…</button>
      <button className="menu-item" onClick={() => { fileRef.current?.click(); setMenu(null) }}>Import homework image…</button>
    </div>
  )

  const askPanel = (docked: boolean) =>
    ask && (
      <AskPanel
        key={ask.key}
        docked={docked}
        startWithMic={ask.mic}
        initialText={ask.text}
        turns={page.history}
        status={nova.status}
        about={askAbout ? (questionOf(askAbout) ? `Question ${questionOf(askAbout)!.question.number} — your answer: ${readingText(page.readings[askAbout]) ?? '(not read yet)'}` : readingText(page.readings[askAbout]) ?? 'the selected line') : null}
        onClearAbout={() => setAskAbout(null)}
        onSend={askFromPanel}
        onClose={() => setAsk(null)}
        onStop={nova.cancel}
        onShow={(id) => page.regions.some((r) => r.id === id) && showRegion(id)}
      />
    )

  const dictatePanel = (docked: boolean) =>
    dictate && <DictatePanel key={dictate.key} docked={docked} startWithMic={dictate.mic} onInsert={insertTyped} onClose={() => setDictate(null)} />

  const saveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Not saved' : 'Saved'

  return (
    <div
      ref={rootRef}
      className={`notebook ${phone ? 'phone' : desktop ? 'desktop' : 'tablet'} ${focus ? 'focus' : ''} ${!focus && !phone && (ask || dictate || (testOpen && activeTest)) ? 'side-open' : ''} ${pagesOpen && !focus && !phone ? 'pages-open' : ''}`}
      onPointerDown={() => menu && setMenu(null)}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return
        // which written line is the mouse over (including the strip under it where its label sits)?
        const ws = document.querySelector('[data-testid=workspace]')?.getBoundingClientRect()
        if (!ws) return
        const x = (e.clientX - ws.left - view.tx) / view.scale
        const y = (e.clientY - ws.top - view.ty) / view.scale
        const hit = page.regions.find((r) => x >= r.bounds.x - 24 && x <= r.bounds.x + Math.max(r.bounds.w, 360 / view.scale) + 24 && y >= r.bounds.y - 24 && y <= r.bounds.y + r.bounds.h + 56 / view.scale)
        const id = hit?.id ?? null
        if (id !== hovered) setHovered(id)
      }}
      onPointerLeave={() => hovered && setHovered(null)}
    >
      {!focus && home && (
        <header className="topbar home-bar">
          <img className="brand-logo" src="/nova-logo.png" alt="NOVA" />
          <span className="spacer" />
          <button className="btn" onClick={() => homePdfRef.current?.click()}><Icon.upload /> Import paper</button>
          <button className="btn primary" onClick={home.onNew}><Icon.plus /> New notebook</button>
          <div className="anchor-rel">
            <button className="icon-btn" aria-label="More" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'overflow' ? null : 'overflow') }}><Icon.more /></button>
            {menu === 'overflow' && (
              <div className="popover menu overflow-pop" onPointerDown={(e) => e.stopPropagation()}>
                <button className="menu-item" onClick={() => { setSettingsOpen(true); setMenu(null) }}>Settings</button>
                <button className="menu-item" onClick={() => { restoreRef.current?.click(); setMenu(null) }}>Restore a backup…</button>
              </div>
            )}
          </div>
          <input ref={homePdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) home.onImportPaper(f) }} />
          <input ref={restoreRef} type="file" accept=".json,.nova.json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) home.onRestore(f) }} />
        </header>
      )}
      {!focus && !home && (
        <div className={`ob-top ${phone ? 'phone' : ''}`}>
          <div className="ob-capsule ob-left" onPointerDown={(e) => e.stopPropagation()}>
            <button className="ob-icon" aria-label="Notebooks" title="Notebooks" onClick={onBack}><Icon.back /></button>
            {!phone && <img className="ob-logo" src="/nova-logo.png" alt="NOVA" />}
            {phone ? (
              busyOrError ? (
                statusPill(true)
              ) : (
                <button className="ob-title-btn" onClick={() => setPagesOpen((v) => !v)} aria-label={`${nb.title}, page ${pageIndex + 1} of ${nb.orderedPageIds.length}. Open pages`}>
                  <b>{nb.title}</b>
                  <span>Page {pageIndex + 1} of {nb.orderedPageIds.length} · {saveLabel}</span>
                </button>
              )
            ) : (
              <>
                <div className="ob-title">
                  <input
                    className="ob-title-input"
                    value={titleDraft}
                    aria-label="Notebook title"
                    size={Math.max(8, Math.min(28, titleDraft.length + 1))}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => titleDraft.trim() !== nb.title && dispatch({ type: 'renameNotebook', title: titleDraft.trim() })}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                  {saveStatus === 'error' ? (
                    <button className="ob-save bad" onClick={onRetrySave} title={saveError ?? ''}>Not saved · Retry</button>
                  ) : (
                    <span className="ob-save"><span className={`ob-save-dot ${saveStatus}`} aria-hidden="true" />{saveLabel}</span>
                  )}
                </div>
                <button className={`ob-chip-btn ${pagesOpen ? 'on' : ''}`} onClick={() => setPagesOpen((v) => !v)} aria-label={`Pages: page ${pageIndex + 1} of ${nb.orderedPageIds.length}`}><Icon.pages />{pageLabel}</button>
              </>
            )}
            {phone && saveStatus === 'error' && <button className="ob-save bad" onClick={onRetrySave}>Retry save</button>}
            {phone && !busyOrError && <span className={`ob-dot ${settings.assist ? 'ok' : 'off'}`} role="img" aria-label={settings.assist ? 'NOVA ready' : 'Assist is off'} />}
          </div>
          {!phone && <div className="ob-center">{statusPill()}</div>}
          {phone ? (
            <button className="ob-ask" onPointerDown={(e) => e.stopPropagation()} onClick={() => openAsk(false)}><Icon.chat /> Ask</button>
          ) : (
            <div className="ob-capsule ob-right" onPointerDown={(e) => e.stopPropagation()}>
              <button data-testid="assist-toggle" className={`ob-seg ob-assist ${settings.assist ? 'on' : ''}`} onClick={toggleAssist} aria-pressed={settings.assist} title="Read your writing automatically after a pause">
                Assist<span className="ob-switch" aria-hidden="true"><i /></span>
              </button>
              <span className="ob-vsep" aria-hidden="true" />
              {testsList.length > 0 && (
                <button className={`ob-seg ${testOpen ? 'on' : ''}`} aria-pressed={testOpen} onClick={() => { if (ask && testOpen && sideTab === 'ask') setSideTab('test'); else setTestOpen((v) => !v) }}><Icon.check /> Test</button>
              )}
              <button className={`ob-icon ${historyOpen ? 'on' : ''}`} aria-label="History" title="NOVA history" onClick={() => setHistoryOpen((v) => !v)}><Icon.clock /></button>
              <button className="ob-ask" onClick={() => openAsk(false)}><Icon.chat /> Ask NOVA</button>
              <div className="anchor-rel">
                <button className="ob-icon" aria-label="More" title="More" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'overflow' || menu === 'page' ? null : 'overflow') }}><Icon.more /></button>
                {menu === 'overflow' && overflowPopover}
                {menu === 'page' && pagePopover}
              </div>
            </div>
          )}
        </div>
      )}
      {!focus && home && busyOrError && <div className="ob-top home-only"><div className="ob-center">{statusPill()}</div></div>}

      {!focus && !phone && (
        <div className={`ob-dock ${desktop && !touch ? 'bottom' : 'side'}`} role="toolbar" aria-label="Writing tools" aria-orientation={desktop && !touch ? 'horizontal' : 'vertical'} onPointerDown={(e) => e.stopPropagation()}>
          {toolButton('pen', 'Pen', <Icon.pen />, undefined, desktop && !touch)}
          {toolButton('eraser', 'Eraser', <Icon.eraser />, 'touch a stroke to delete it', desktop && !touch)}
          {toolButton('select', 'Select', <Icon.select />, 'drag around a line or tap it', desktop && !touch)}
          {toolButton('pan', 'Pan', <Icon.pan />, undefined, desktop && !touch)}
          <span className="ob-sep" />
          <div className="anchor-rel">
            <button className={`ob-tool ob-inkbtn ${menu === 'ink' ? 'open' : ''}`} aria-label="Ink colour and width" aria-expanded={menu === 'ink'} title="Ink colour and width" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'ink' ? null : 'ink') }}>
              <span className="ob-ink-dot" style={{ background: colour }} />
              {desktop && !touch && <span className="ob-tool-label">Ink</span>}
            </button>
            {menu === 'ink' && inkPopover}
          </div>
          <span className="ob-sep" />
          <button className="ob-tool sm" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={() => dispatch({ type: 'undo', pageId })}><Icon.undo /></button>
          <button className="ob-tool sm" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={() => dispatch({ type: 'redo', pageId })}><Icon.redo /></button>
          <span className="ob-sep" />
          <button className={`ob-tool ob-dictate ${dictate ? 'active' : ''}`} data-testid="dictate-open" aria-label="Write on page by voice" title="Write on page by voice: say a question or equation" onClick={() => (dictate ? setDictate(null) : openDictate(true))}>
            <Icon.mic />{desktop && !touch && <span className="ob-tool-label">Write</span>}
          </button>
          {!(desktop && !touch) && (
            <>
              <span className="ob-sep" />
              <button className="ob-tool sm ob-speak-ic" aria-label="Speak a question" title="Speak a question" onClick={() => openAsk(true)}><Icon.mic /></button>
            </>
          )}
        </div>
      )}
      {!focus && !phone && desktop && !touch && (
        <>
          <button className="ob-speak" aria-label="Speak a question to NOVA" onPointerDown={(e) => e.stopPropagation()} onClick={() => openAsk(true)}><span><Icon.mic /></span>Speak</button>
          <div className="ob-zoomcap" onPointerDown={(e) => e.stopPropagation()}>
            <button aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
            <button className="ob-zoompct" aria-label={`Reset zoom, currently ${Math.round(view.scale * 100)} percent`} onClick={fitWidth}>{Math.round(view.scale * 100)}%</button>
            <button aria-label="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
          </div>
        </>
      )}
      {!focus && !phone && !home && touch && <div className="ob-gesture-hint" aria-hidden="true">Pinch to zoom · 2 fingers to pan</div>}

      <div className="body">
        {pagesOpen && !focus && <PagesRail doc={doc} currentId={pageId} drawer={!desktop} onOpen={openPage} onNew={addPage} onClose={() => setPagesOpen(false)} />}
        <Workspace
          page={page}
          tool={tool}
          colour={colour}
          width={width}
          stylusOnly={settings.stylusOnly}
          lasso={lasso}
          view={view}
          setView={(v) => { autoFit.current = false; setView(v) }}
          backgroundUrl={bgUrl}
          onSize={(w, h) => setSize({ w, h })}
          onCommitStroke={commitStroke}
          onErase={(ids) => dispatch({ type: 'eraseStrokes', pageId, ids })}
          onSelect={onSelect}
          onPenDown={() => {
            penActive.current = true
            rootRef.current?.classList.add('writing')
            nova.scheduler.penDown()
            setMenu(null)
          }}
          onPenUp={() => {
            penActive.current = false
            rootRef.current?.classList.remove('writing')
          }}
          onPenDetected={() => {
            if (settings.stylusOnly || stylusOffered.current) return
            stylusOffered.current = true
            toast('Stylus detected. Let fingers pan instead of draw?', { label: 'Stylus only', fn: () => setSettings({ ...settings, stylusOnly: true }) })
          }}
          pageLayer={
            <>
              {page.bgState && page.bg && (
                <div className={`prep-chip ${page.bgState}`} style={{ left: 24, top: 24 }} role="status">
                  {page.bgState === 'preparing' ? (
                    <><span className="spin" aria-hidden="true" /> Preparing page… you can write already.</>
                  ) : (
                    <>Couldn't prepare this page{page.bgError ? `: ${page.bgError}` : '.'} <button className="link strong" onClick={() => paper.retryPage(page.id)}>Retry</button></>
                  )}
                </div>
              )}
              {home && page.strokes.length === 0 && (
                <div className="home-hint" style={{ left: 96, top: 170 }}>
                  <span className="hint-big">Write anything here.</span>
                  <span className="hint-small">Try <b>3 + 2 =</b>, <b>x + 3 = 4</b> or <b>y = 2x + 1</b> — NOVA answers right next to it.</span>
                  {!settings.assist && <button className="btn primary hint-btn" onPointerDown={(e) => e.stopPropagation()} onClick={toggleAssist}>Turn on Assist so NOVA answers as you write</button>}
                </div>
              )}
              {home && <Shelf onOpen={home.onOpen} onCreate={home.onNew} />}
              {activeTest && activeTest.pageIds.includes(page.id) && <AnswerFrames page={page} test={activeTest} current={currentQ} />}
              <TypedLayer
                page={page}
                scale={view.scale}
                selectedRegionId={selected}
                editingId={typedEdit}
                onSelect={(id) => setSelected(id)}
                onStartEdit={setTypedEdit}
                onEditDone={() => setTypedEdit(null)}
                onEdit={(id, text, sz) => dispatch({ type: 'editTyped', pageId, id, text, display: prettyMath(text), w: sz.w, h: sz.h })}
                onMove={(id, x, y) => dispatch({ type: 'moveTyped', pageId, id, x, y })}
                onDelete={(id) => { dispatch({ type: 'deleteTyped', pageId, id }); setSelected(null) }}
              />
              <TutorLayer
                page={page}
                regionBounds={regionBounds}
                speechEnabled={settings.speechOutput}
                onDismiss={(id) => dispatch({ type: 'dismissTutor', pageId, id })}
                onPlay={(t) => (t.action.type === 'add_note' || t.action.type === 'speak') && speak(t.action.text, t.id)}
                onOpen={setSheet}
              />
            </>
          }
          screenLayer={
            <>
              <ReadbackLayer
                page={page}
                view={view}
                phases={nova.phases}
                selectedRegionId={selected}
                hoveredRegionId={hovered}
                showAccepted={settings.showReadback !== false}
                onAccept={(id, text) => dispatch({ type: 'acceptReading', pageId, regionId: id, text })}
                onRetry={(id) => void nova.readNow(id).catch((e) => toast((e as Error).message))}
                onTypeIt={(id) => setTypeFor({ regionId: id, text: readingText(page.readings[id]) ?? nova.localPending[id]?.read.literal ?? '' })}
                onLocalUse={(id) => nova.useLocal(id)}
                localPending={nova.localPending}
                onLocalAnswer={(id, q, o) => void nova.answerLocal(id, q, o)}
                onStop={nova.cancel}
                onSelect={setSelected}
                onQuick={(id, intent) => {
                  if (intent === 'ask') {
                    setAskAbout(id)
                    setAsk({ mic: false, key: Date.now() })
                  } else helpFor(id, intent)
                }}
              />
              {selected && !ask && <RegionMenu page={page} view={view} regionId={selected} viewport={size} onAction={regionAction} />}
              {[...new Set([...Object.keys(nova.clarifies), ...(typeFor ? [typeFor.regionId] : []), ...(nova.status.edit ? [nova.status.edit] : [])])].map((recoverId) => {
                const c = nova.clarifies[recoverId]
                const r = page.regions.find((x) => x.id === recoverId)
                if (!r) return null
                const left = Math.max(8, Math.min(size.w - 340, view.tx + r.bounds.x * view.scale))
                const top = Math.max(8, view.ty + (r.bounds.y + r.bounds.h) * view.scale + 10)
                const submit = (t: string) => {
                  const text = t.trim()
                  if (!text) return
                  if (typeFor?.regionId === r.id) setTypeFor(null)
                  if (c) return void nova.resolveClarify(r.id, text)
                  // a typed correction is the confirmed reading: no OCR
                  if (r.typedId) dispatch({ type: 'editTyped', pageId, id: r.typedId, text, display: prettyMath(text), ...measureTyped(text) })
                  else dispatch({ type: 'acceptReading', pageId, regionId: r.id, text })
                  if (nova.status.edit === r.id) nova.setStatus({ state: 'idle' })
                }
                const qc = questionOf(r.id)
                return (
                  <div key={r.id} className="clarify-card" data-testid="clarify-card" data-region={r.id} role="dialog" aria-label="NOVA needs one detail" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
                    <div className="cc-q">{qc ? `Question ${qc.question.number}: ` : ''}{c ? c.question : nova.status.edit === r.id && typeFor?.regionId !== r.id ? `NOVA couldn't read ${qc ? 'your answer' : 'this line'}${nova.status.message ? ` (${nova.status.message.replace(/\.$/, '')})` : ''}. Type it, so NOVA can help with it (your ink stays).` : 'Type what this line says:'}</div>
                    {c && c.options.map((o) => <button key={o.text} className="vb-btn" data-testid="clarify-option" onClick={() => submit(o.text)}>{o.label}</button>)}
                    {!c && nova.status.edit === r.id && nova.status.retry && <button className="vb-btn" data-testid="recover-retry" onClick={() => { const f = nova.status.retry!; nova.setStatus({ state: 'idle' }); f() }}>Retry reading</button>}
                    {!c && nova.status.edit === r.id && nova.status.alt && <button className="vb-btn" data-testid="recover-explain-question" title="Explains the printed question; your unreadable answer is not reviewed" onClick={() => { const f = nova.status.alt!.run; nova.setStatus({ state: 'idle' }); f() }}>{nova.status.alt.label}</button>}
                    <form className="cc-edit" onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget).get('t') as string) }}>
                      <input name="t" data-testid="clarify-input" defaultValue={typeFor?.regionId === r.id ? typeFor.text : c ? '' : readingText(page.readings[r.id]) ?? ''} placeholder={c ? 'or type it differently' : 'e.g. ∫_0^1 x^2 dx'} aria-label="Type the expression" />
                      <button className="vb-btn" type="submit" data-testid="recover-type">{!c && qc ? 'Type my answer' : 'Use this'}</button>
                      <button className="link" type="button" onClick={() => { if (typeFor?.regionId === r.id) setTypeFor(null); nova.dropClarify(r.id); if (nova.status.edit === r.id) nova.setStatus({ state: 'idle' }) }}>Cancel</button>
                    </form>
                  </div>
                )
              })}
            </>
          }
        />
        {historyOpen && !focus && <HistoryDrawer turns={pageTurns} onClose={() => setHistoryOpen(false)} />}
        {!focus && !phone && (ask || dictate || (testOpen && activeTest)) && (
          <div className="ob-side" onPointerDown={(e) => e.stopPropagation()}>
            {testOpen && activeTest && (
              <div className="ob-side-tabs" role="tablist" aria-label="Side panel">
                <button role="tab" aria-selected={!ask || sideTab === 'test'} className={!ask || sideTab === 'test' ? 'on' : ''} onClick={() => setSideTab('test')}>Test</button>
                <button role="tab" aria-selected={!!ask && sideTab === 'ask'} className={ask && sideTab === 'ask' ? 'on' : ''} onClick={() => { if (!ask) openAsk(false); setSideTab('ask') }}>Ask NOVA</button>
              </div>
            )}
            {testOpen && activeTest && (
              <div className="ob-side-pane" hidden={!!ask && sideTab !== 'test'}>
                <TestPanel
                  test={activeTest}
                  pages={doc.pages}
                  busy={paper.busy}
                  current={currentQ} onGoto={gotoQuestion}
                  onHelp={(q) => paper.help(activeTest.id, q)}
                  onReview={(q) => paper.review(activeTest.id, q)}
                  onFinish={() => void paper.finish(activeTest.id)}
                  onRetry={() => paper.retryFailed(activeTest.id)}
                  onClose={() => setTestOpen(false)}
                  onPracticeMore={activeTest.kind === 'practice' ? () => void runPractice({ topic: activeTest.topic, example: activeTest.source }) : undefined}
                />
              </div>
            )}
            {ask && <div className="ob-side-pane" hidden={!!(testOpen && activeTest) && sideTab !== 'ask'}>{askPanel(true)}</div>}
            {dictate && !ask && <div className="ob-side-pane">{dictatePanel(true)}</div>}
          </div>
        )}
        {phone && testOpen && activeTest && !focus && (
          <TestPanel
            test={activeTest}
            pages={doc.pages}
            busy={paper.busy}
            current={currentQ} onGoto={gotoQuestion}
            onHelp={(q) => paper.help(activeTest.id, q)}
            onReview={(q) => paper.review(activeTest.id, q)}
            onFinish={() => void paper.finish(activeTest.id)}
            onRetry={() => paper.retryFailed(activeTest.id)}
            onClose={() => setTestOpen(false)}
            onPracticeMore={activeTest.kind === 'practice' ? () => void runPractice({ topic: activeTest.topic, example: activeTest.source }) : undefined}
          />
        )}
      </div>

      {phone && !focus && (
        <nav className="ob-phonebar" aria-label="Writing tools" onPointerDown={(e) => e.stopPropagation()}>
          {toolButton('pen', 'Pen', <Icon.pen />, undefined, true)}
          {toolButton('eraser', 'Eraser', <Icon.eraser />, undefined, true)}
          {toolButton('pan', 'Move', <Icon.pan />, undefined, true)}
          <button className="ob-tool" aria-label="Undo" disabled={!canUndo} onClick={() => dispatch({ type: 'undo', pageId })}><Icon.undo /><span className="ob-tool-label">Undo</span></button>
          <div className="anchor-rel">
            <button className={`ob-tool ${menu === 'dock' || menu === 'page' ? 'on' : ''}`} aria-label="More tools" onClick={(e) => { e.stopPropagation(); setMenu(menu === 'dock' ? null : 'dock') }}><Icon.more /><span className="ob-tool-label">More</span></button>
            {menu === 'dock' && (
              <div className="popover menu dock-pop" onPointerDown={(e) => e.stopPropagation()}>
                <div className="row gap">
                  {/* picking a tool closes this menu, so the next tap lands on the page (not on the menu) */}
                  <span onClickCapture={() => setTimeout(() => setMenu(null))}>{toolButton('select', 'Select', <Icon.select />)}</span>
                  <button className="ob-tool" aria-label="Redo" disabled={!canRedo} onClick={() => dispatch({ type: 'redo', pageId })}><Icon.redo /></button>
                  <button className="ob-tool" aria-label="Fit width" onClick={() => { fitWidth(); setMenu(null) }}><Icon.fit /></button>
                  <button className="ob-tool" aria-label="Ask by voice" onClick={() => { openAsk(true); setMenu(null) }}><Icon.mic /></button>
                  <button className="ob-tool" aria-label="Write on page by voice" onClick={() => { openDictate(true); setMenu(null) }}><Icon.pen /></button>
                </div>
                {inkPopover.props.children}
                <hr />
                <button className="menu-item" onClick={() => { toggleAssist(); setMenu(null) }}>Assist: {settings.assist ? 'on' : 'off'}</button>
                {testsList.length > 0 && <button className="menu-item" onClick={() => { setTestOpen(true); setMenu(null) }}>Test / practice sheet</button>}
                <button className="menu-item" onClick={() => { setPagesOpen(true); setMenu(null) }}>Pages</button>
                <button className="menu-item" onClick={() => { setHistoryOpen(true); setMenu(null) }}>NOVA history</button>
                <button className="menu-item" onClick={() => { setPracticeOpen({ example: null }); setMenu(null) }}>Practice a topic…</button>
                <button className="menu-item" disabled={sharing} onClick={() => void sharePage('share')}>Share page</button>
                <button className="menu-item" onClick={() => { renameNotebook(); setMenu(null) }}>Rename notebook…</button>
                <button className="menu-item" onClick={() => { setMenu('page') }}>Paper & page options…</button>
                <button className="menu-item" onClick={() => { setSettingsOpen(true); setMenu(null) }}>Settings</button>
              </div>
            )}
            {menu === 'page' && pagePopover}
          </div>
        </nav>
      )}

      {focus && (
        <div className="focus-dock ob-dock floating" onPointerDown={(e) => e.stopPropagation()}>
          {toolButton('pen', 'Pen', <Icon.pen />)}
          {toolButton('eraser', 'Eraser', <Icon.eraser />)}
          <button className="ob-tool" aria-label="Undo" disabled={!canUndo} onClick={() => dispatch({ type: 'undo', pageId })}><Icon.undo /></button>
          <button className="ob-tool" aria-label="Stop NOVA" onClick={nova.cancel}><Icon.stop /></button>
          <button className="ob-tool" aria-label="Exit focus mode" onClick={() => setFocus(false)}><Icon.focus /></button>
        </div>
      )}

      {ask && (phone || focus) && askPanel(false)}
      {dictate && !ask && (phone || focus) && dictatePanel(false)}
      {sheet && <ObjectSheet obj={sheet} onClose={() => setSheet(null)} />}
      {paper.busy && !(testOpen && activeTest) && (
        <div className="busy-banner" role="status"><span className="spinner" />{paper.busy}</div>
      )}
      {practiceOpen && (
        <PracticeDialog example={practiceOpen.example} suggested={weakTopics} onStart={(p) => void runPractice(p)} onClose={() => setPracticeOpen(null)} />
      )}
      {(tourOpen || (showWelcome && !home)) && (
        <FirstRun onClose={() => { setTourOpen(false); onWelcomeDone?.() }} />
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
          onRequestAssist={() => setConsentOpen(true)}
          onExport={() => void exportBackup()}
          onTeachHandwriting={() => {
            setSettingsOpen(false)
            setHwOpen(true)
          }}
        />
      )}
      {hwOpen && <HandwritingSetup onClose={() => setHwOpen(false)} notify={toast} />}
      {consentOpen && (
        <AssistConsent
          onAccept={() => {
            setSettings({ ...settings, assist: true, assistConsent: true })
            setConsentOpen(false)
          }}
          onCancel={() => setConsentOpen(false)}
        />
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            {t.action && <button className="link strong" onClick={() => { t.action!.fn(); setToasts((x) => x.filter((y) => y.id !== t.id)) }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setTestOpen(true); void paper.importPaper(f) } }} />
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importImage(f) }} />
    </div>
  )
}
