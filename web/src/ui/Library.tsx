import { useEffect, useMemo, useRef, useState } from 'react'
import type { NotebookDoc, NotebookSummary } from '../notebook/types'
import { BackupError, parseBackup } from '../storage/backup'
import { deleteNotebook, listNotebooks, loadNotebook, saveImported } from '../storage/db'
import { Icon } from './icons'
import { PageThumb } from './PageThumb'
import { readingText } from '../notebook/doc'
import { isWeak, notebookTopics, progress } from '../tutor/topics'
import { PracticeDialog } from './PracticeDialog'
import { answerRegions } from '../tutor/usePaper'
import { effectiveTheme, onThemeChange, setThemePref } from './theme'

interface Props {
  tester?: { name: string }
  onSwitchTester?: () => void
  onOpen: (id: string) => void
  onCreate: () => void
  onImportPaper: (file: File) => void
  onPractice: (topic: string, opts?: { count?: number; allowHelp?: boolean }) => void
  onTry: (what: 'graph' | 'diagram' | 'ask') => void
  onSettings?: () => void
  notify: (msg: string) => void
}

function when(t: number): string {
  const d = new Date(t)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** What the notebook is about, from what NOVA read on its pages. */
function firstLines(doc?: NotebookDoc, n = 3): string[] {
  if (!doc) return []
  const out: string[] = []
  for (const pid of doc.notebook.orderedPageIds) {
    const p = doc.pages[pid]
    if (!p) continue
    const regions = [...p.regions].sort((a, b) => a.bounds.y - b.bounds.y)
    for (const r of regions) {
      const rd = p.readings[r.id]
      const t = readingText(rd)
      if (t) out.push(t)
      if (out.length >= n) return out
    }
  }
  return out
}

function stats(doc?: NotebookDoc) {
  if (!doc) return { lines: 0, right: 0, wrong: 0 }
  let lines = 0, right = 0, wrong = 0
  for (const p of Object.values(doc.pages)) {
    lines += p.regions.length
    for (const t of p.tutorObjects) {
      if (t.status === 'dismissed' || t.action.type !== 'write_ink' || t.action.purpose !== 'mark') continue
      if (t.action.tone === 'correct') right++
      else if (t.action.tone === 'wrong') wrong++
    }
  }
  return { lines, right, wrong }
}

export function Library({ tester, onSwitchTester, onOpen, onCreate, onImportPaper, onPractice, onTry, onSettings, notify }: Props) {
  const [items, setItems] = useState<NotebookSummary[] | null>(null)
  const [docs, setDocs] = useState<Record<string, NotebookDoc>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const [theme, setTheme] = useState(effectiveTheme)
  useEffect(() => onThemeChange(() => setTheme(effectiveTheme())), [])
  const pdfRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    try {
      const list = (await listNotebooks()).filter((n) => n.id !== 'nb_scratch').sort((a, b) => b.updatedAt - a.updatedAt)
      setItems(list)
      const loaded: Record<string, NotebookDoc> = {}
      for (const n of list.slice(0, 60)) {
        const d = await loadNotebook(n.id).catch(() => undefined)
        if (d) loaded[n.id] = d
      }
      setDocs(loaded)
    } catch (e) {
      notify((e as Error).message)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void refresh(), [])

  const importBackup = async (file: File) => {
    try {
      const { doc, assets } = parseBackup(await file.text(), file.size)
      await saveImported(doc, assets)
      notify(`Restored “${doc.notebook.title}”.`)
      void refresh()
    } catch (e) {
      notify(e instanceof BackupError ? e.message : `Import failed: ${(e as Error).message}`)
    }
  }

  const remove = async (n: NotebookSummary) => {
    if (!confirm(`Delete “${n.title}”? This cannot be undone. Export a backup first if you need it.`)) return
    await deleteNotebook(n.id)
    void refresh()
  }

  const pageOf = (d?: NotebookDoc) => (d ? d.pages[d.notebook.lastPageId ?? d.notebook.orderedPageIds[0]] : undefined)
  const latest = items?.[0]
  const latestDoc = latest ? docs[latest.id] : undefined
  const st = stats(latestDoc)
  const prog = useMemo(() => progress(Object.values(docs)), [docs])
  const weak = prog.topics.filter(isWeak)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'chapter'>('recent')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (items ?? []).filter((n) => {
      if (!q) return true
      const d = docs[n.id]
      return n.title.toLowerCase().includes(q) || notebookTopics(d, 4).some((t) => t.toLowerCase().includes(q)) || firstLines(d, 6).some((l) => l.toLowerCase().includes(q))
    })
    if (sort === 'chapter') return [...list].sort((a, b) => (notebookTopics(docs[a.id], 1)[0] ?? '~').localeCompare(notebookTopics(docs[b.id], 1)[0] ?? '~') || b.updatedAt - a.updatedAt)
    return list
  }, [items, docs, query, sort])
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  const first = tester?.name.trim().split(/\s+/)[0]
  const [menu, setMenu] = useState(false)
  const wk = prog.week
  const marked = wk.right + wk.wrong
  const pct = marked ? Math.round((wk.right / marked) * 100) : null
  const maxDay = Math.max(1, ...wk.days.map((d) => d.lines))
  const pageNo = (d?: NotebookDoc) => (d ? d.notebook.orderedPageIds.indexOf(d.notebook.lastPageId ?? d.notebook.orderedPageIds[0]) + 1 : 1)
  // question papers and practice sets: unfinished first, then the latest finished ones
  const sets = useMemo(() => {
    const out: { docId: string; title: string; kind: string; done: number; total: number; finished: boolean; score?: { correct: number; total: number }; at: number }[] = []
    for (const [docId, d] of Object.entries(docs)) {
      for (const t of Object.values(d.tests ?? {})) {
        const total = t.questions.length
        if (!total) continue
        const done = t.questions.filter((q) => d.pages[q.pageId] && answerRegions(d.pages[q.pageId], t, q).length > 0).length
        out.push({ docId, title: t.title, kind: t.kind === 'practice' ? 'Practice' : 'PDF', done, total, finished: t.status === 'finished', score: t.score, at: t.finishedAt ?? t.createdAt })
      }
    }
    return out.sort((a, b) => Number(a.finished) - Number(b.finished) || b.at - a.at).slice(0, 3)
  }, [docs])

  return (
    <div className="library hm" onPointerDown={() => menu && setMenu(false)}>
      <div className="hm-wrap">
        <header className="hm-head">
          <div className="hm-brand"><img className="hm-logo" src="/nova-logo.png" alt="NOVA" /></div>
          <label className="hm-search">
            <Icon.search />
            <span className="sr-only">Search notebooks</span>
            <input placeholder="Search notebooks and practice sets" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <span className="spacer" />
          {prog.streak > 0 && <span className="hm-streak"><Icon.flame /><span className="hm-streak-long">{prog.streak}-day streak</span><span className="hm-streak-short">{prog.streak} {prog.streak === 1 ? 'day' : 'days'}</span></span>}
          <button className="hm-square" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setThemePref(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Icon.sun /> : <Icon.moon />}</button>
          <div className="anchor-rel hm-only-wide">
            <button className="hm-square" aria-label="Settings" onClick={(e) => { e.stopPropagation(); setMenu((v) => !v) }}><Sliders /></button>
            {menu && (
              <div className="popover menu hm-menu" onPointerDown={(e) => e.stopPropagation()}>
                {onSettings && <button className="menu-item" onClick={() => { setMenu(false); onSettings() }}>Settings</button>}
                <button className="menu-item" onClick={() => { fileRef.current?.click(); setMenu(false) }}>Restore a backup…</button>
                {tester && <button className="menu-item" onClick={() => { setMenu(false); if (confirm('Switch to another tester? Your notebooks stay saved under your name on this device.')) onSwitchTester?.() }}>Switch tester</button>}
              </div>
            )}
          </div>
          {tester && <span className="hm-avatar" title={tester.name} aria-label={`Profile: ${tester.name}`}>{tester.name.trim().charAt(0).toUpperCase()}</span>}
          <input ref={fileRef} type="file" accept=".json,.nova.json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importBackup(f) }} />
          <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportPaper(f) }} />
        </header>

        <div className="hm-greet">
          <span className="hm-date">{today}</span>
          <h1>{greeting}{first ? `, ${first}` : ''}.</h1>
        </div>
        {items === null && <p className="muted">Loading…</p>}

        <section className="hm-top">
          {latest ? (
            <button className="hm-continue" onClick={() => onOpen(latest.id)} aria-label={`Continue ${latest.title}`}>
              <span className="hm-continue-sheet"><PageThumb page={pageOf(latestDoc)} aspect={0.62} /></span>
              <span className="hm-continue-body">
                <span className="hm-kicker"><span className="hm-wide-only">Continue where you left off</span><span className="hm-narrow-only">Continue</span></span>
                <span className="hm-continue-title">{latest.title}</span>
                <span className="hm-continue-meta">{notebookTopics(latestDoc, 1)[0] ? `${notebookTopics(latestDoc, 1)[0]} · ` : ''}Page {pageNo(latestDoc)} of {latest.pageCount} · edited {when(latest.updatedAt)}</span>
                {(st.right + st.wrong > 0 || st.wrong > 0) && (
                  <span className="hm-pills">
                    {st.right + st.wrong > 0 && <span className="hm-pill ok">{st.right + st.wrong} lines checked</span>}
                    {st.wrong > 0 && <span className="hm-pill warn">{st.wrong} to fix</span>}
                  </span>
                )}
                <span className="hm-grow" />
                <span className="hm-continue-btn"><span className="hm-wide-only">Continue writing</span><Arrow /></span>
              </span>
            </button>
          ) : (
            items !== null && (
              <button className="hm-continue empty" onClick={onCreate}>
                <span className="hm-continue-body">
                  <span className="hm-kicker">Start here</span>
                  <span className="hm-continue-title">Your first notebook</span>
                  <span className="hm-continue-meta">Write maths by hand. NOVA reads each line and helps.</span>
                  <span className="hm-grow" />
                  <span className="hm-continue-btn">New notebook<Arrow /></span>
                </span>
              </button>
            )
          )}
          <div className="hm-week">
            <div className="hm-week-head"><h2>This week</h2><button className="hm-week-link" onClick={() => setPracticeOpen(true)}>Practise</button></div>
            <div className="hm-week-mid">
              <div className="hm-ring" style={{ background: `conic-gradient(var(--hm-ring) 0 ${pct ?? 0}%, var(--hm-ring-off) ${pct ?? 0}% 100%)` }}>
                <div><b>{pct === null ? '–' : `${pct}%`}</b><span>correct</span></div>
              </div>
              <div className="hm-week-nums">
                <div><b>{wk.checked}</b><span> lines checked</span></div>
                <div><b>{wk.practiceDone}</b><span> practice {wk.practiceDone === 1 ? 'set' : 'sets'} done</span></div>
              </div>
            </div>
            <div className="hm-bars" aria-label="Lines written each day this week">
              {wk.days.map((d) => (
                <div key={d.key} className={d.label === 'Today' ? 'today' : ''}>
                  <i style={{ height: Math.max(6, Math.round((d.lines / maxDay) * 54)) }} title={`${d.lines} lines`} />
                  <span>{d.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="hm-tiles">
          <button className="hm-tile primary hm-wide-only-flex" onClick={onCreate}><span className="hm-tile-icon"><Icon.plus /></span><span><b>New notebook</b><span>Blank squared page</span></span></button>
          <button className="hm-tile" onClick={() => pdfRef.current?.click()}><span className="hm-tile-icon iris"><PaperUp /></span><span><b><span className="hm-wide-only">Import question paper</span><span className="hm-narrow-only">Import paper</span></b><span>PDF · answer space added</span></span></button>
          <button className="hm-tile" onClick={() => setPracticeOpen(true)}><span className="hm-tile-icon amber"><Clipboard /></span><span><b><span className="hm-wide-only">Practice sets</span><span className="hm-narrow-only">Practice</span></b><span>By chapter, Classes 8–10</span></span></button>
          <button className="hm-tile hm-narrow-only-flex" onClick={() => setPracticeOpen(true)}><span className="hm-tile-num">{pct === null ? '–' : `${pct}%`}</span><span><b>This week</b></span></button>
        </section>

        <section className="hm-section">
          <div className="hm-section-head">
            <h2>Your notebooks</h2>
            {items && items.length > 0 && <span className="hm-count">{items.length}</span>}
            <span className="spacer" />
            <div className="hm-seg" role="tablist" aria-label="Sort notebooks">
              <button role="tab" aria-selected={sort === 'recent'} className={sort === 'recent' ? 'on' : ''} onClick={() => setSort('recent')}>Recent</button>
              <button role="tab" aria-selected={sort === 'chapter'} className={sort === 'chapter' ? 'on' : ''} onClick={() => setSort('chapter')}>Chapter</button>
            </div>
          </div>
          {weak.length > 0 && (
            <div className="hm-weak">
              <span>Needs practice</span>
              {weak.slice(0, 4).map((t) => (
                <button key={t.topic} className="hm-weak-chip" onClick={() => onPractice(t.topic)}>{t.topic} · {Math.round((t.right / (t.right + t.wrong)) * 100)}%</button>
              ))}
            </div>
          )}
          {items && items.length > 0 && shown.length === 0 && <p className="muted">No notebooks match “{query}”.</p>}
          <div className="hm-grid">
            {shown.map((n) => {
              const d = docs[n.id]
              const topic = notebookTopics(d, 1)[0]
              const badge = coverBadge(d)
              return (
                <div key={n.id} className="hm-card">
                  <button className="hm-card-open" onClick={() => onOpen(n.id)} aria-label={`Open ${n.title}`}>
                    <span className="hm-card-sheet"><PageThumb page={pageOf(d)} aspect={0.66} /></span>
                    <span className="hm-card-info">
                      <b>{n.title}</b>
                      <span>{topic ? `${topic} · ` : ''}{n.pageCount} {n.pageCount === 1 ? 'page' : 'pages'} · {when(n.updatedAt)}{badge && badge.kind !== 'draft' ? ` · ${badge.text}` : ''}</span>
                    </span>
                  </button>
                  <button className="hm-card-del" aria-label={`Delete ${n.title}`} onClick={() => void remove(n)}><Icon.trash /></button>
                </div>
              )
            })}
          </div>
        </section>

        {sets.length > 0 && (
          <section className="hm-section">
            <div className="hm-section-head"><h2>Practice sets in progress</h2></div>
            <div className="hm-sets">
              {sets.map((t, i) => (
                <button key={i} className="hm-set" onClick={() => onOpen(t.docId)}>
                  <span className="hm-set-top"><b>{t.title}</b>{t.finished && t.score ? <span className="ok">{t.score.correct} / {t.score.total}</span> : <span>{t.kind}</span>}</span>
                  <span className={`hm-bar ${t.finished ? 'done' : ''}`}><i style={{ width: `${t.finished ? 100 : Math.round((t.done / t.total) * 100)}%` }} /></span>
                  <span className="hm-set-meta">{t.finished ? (t.score && t.score.correct < t.score.total ? `Finished · review ${t.score.total - t.score.correct} ${t.score.total - t.score.correct === 1 ? 'mistake' : 'mistakes'}` : 'Finished') : `${t.done} of ${t.total} answered`}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <p className="hm-foot">NOVA keeps your notebooks on this device. Try: <button className="link" onClick={() => onTry('graph')}>graph a function</button> · <button className="link" onClick={() => onTry('diagram')}>read a diagram</button> · <button className="link" onClick={() => onTry('ask')}>simplify an expression</button></p>
      </div>

      <nav className="hm-tabbar" aria-label="Main">
        <button className="on" aria-current="page"><Icon.pages /><span>Library</span></button>
        <button onClick={() => setPracticeOpen(true)}><Clipboard /><span>Practice</span></button>
        <button className="hm-tab-new" aria-label="New notebook" onClick={onCreate}><Icon.plus /></button>
        <button onClick={() => pdfRef.current?.click()}><PaperUp /><span>Import</span></button>
        <button onClick={() => onSettings?.()}><Sliders /><span>Settings</span></button>
      </nav>
      {practiceOpen && (
        <PracticeDialog suggested={weak.map((t) => t.topic)} onStart={(p) => { setPracticeOpen(false); if (p.topic) onPractice(p.topic, { count: p.count, allowHelp: p.allowHelp }) }} onClose={() => setPracticeOpen(false)} />
      )}
    </div>
  )
}

// Orbit glyphs used on Home (24 grid, 1.8 stroke, round caps)
const G = ({ children, fill }: { children: React.ReactNode; fill?: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const Sliders = () => <G><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></G>
const Arrow = () => <G><path d="M5 12h14M13 6l6 6-6 6" /></G>
const PaperUp = () => <G><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M12 17v-6M9 13l3-3 3 3" /></G>
const Clipboard = () => <G><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 3.5h6v3H9zM9 12.5l2 2 4-4M9 17.5h6" /></G>

/** What the notebook's status is, said honestly: a test score, how much NOVA marked right, or a draft. */
function coverBadge(doc?: NotebookDoc): { text: string; kind: 'good' | 'mid' | 'draft' } | null {
  if (!doc) return null
  const test = Object.values(doc.tests ?? {}).find((t) => t.score)
  if (test?.score) return { text: `${test.score.correct}/${test.score.total}`, kind: test.score.correct / Math.max(1, test.score.total) >= 0.6 ? 'good' : 'mid' }
  const s = stats(doc)
  if (s.right + s.wrong >= 2) {
    const pct = Math.round((s.right / (s.right + s.wrong)) * 100)
    return { text: `${pct}% right`, kind: pct >= 60 ? 'good' : 'mid' }
  }
  if (s.lines < 3) return { text: 'Draft', kind: 'draft' }
  return null
}
