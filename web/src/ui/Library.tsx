import { useEffect, useMemo, useRef, useState } from 'react'
import type { NotebookDoc, NotebookSummary } from '../notebook/types'
import { BackupError, parseBackup } from '../storage/backup'
import { deleteNotebook, listNotebooks, loadNotebook, saveImported } from '../storage/db'
import { Icon } from './icons'
import { PageThumb } from './PageThumb'
import { readingText } from '../notebook/doc'
import { isWeak, notebookTopics, progress } from '../tutor/topics'
import { PracticeDialog } from './PracticeDialog'
import { effectiveTheme, onThemeChange, setThemePref } from './theme'

interface Props {
  tester?: { name: string }
  onSwitchTester?: () => void
  onOpen: (id: string) => void
  onCreate: () => void
  onImportPaper: (file: File) => void
  onPractice: (topic: string) => void
  onTry: (what: 'graph' | 'diagram' | 'ask') => void
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

export function Library({ tester, onSwitchTester, onOpen, onCreate, onImportPaper, onPractice, onTry, notify }: Props) {
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
  const latestTest = latestDoc ? Object.values(latestDoc.tests ?? {})[0] : undefined
  const st = stats(latestDoc)
  const lines = firstLines(latestDoc)
  const prog = useMemo(() => progress(Object.values(docs)), [docs])
  const weak = prog.topics.filter(isWeak)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'oldest' | 'name'>('recent')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (items ?? []).filter((n) => {
      if (!q) return true
      const d = docs[n.id]
      return n.title.toLowerCase().includes(q) || notebookTopics(d, 4).some((t) => t.toLowerCase().includes(q)) || firstLines(d, 6).some((l) => l.toLowerCase().includes(q))
    })
    if (sort === 'name') return [...list].sort((a, b) => a.title.localeCompare(b.title))
    if (sort === 'oldest') return [...list].sort((a, b) => a.updatedAt - b.updatedAt)
    return list
  }, [items, docs, query, sort])
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
  const [menu, setMenu] = useState(false)

  return (
    <div className="library home ob-home" onPointerDown={() => menu && setMenu(false)}>
      <header className="ob-home-bar">
        <img className="brand-logo" src="/nova-logo.png" alt="NOVA" />
        <span className="spacer" />
        <label className="ob-search hide-phone">
          <Icon.search />
          <input type="search" placeholder="Search notebooks" aria-label="Search notebooks" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="ob-icon" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setThemePref(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Icon.sun /> : <Icon.moon />}</button>
        <div className="anchor-rel">
          <button className="ob-icon" aria-label="More" onClick={(e) => { e.stopPropagation(); setMenu((v) => !v) }}><Icon.more /></button>
          {menu && (
            <div className="popover menu ob-home-menu" onPointerDown={(e) => e.stopPropagation()}>
              <button className="menu-item" onClick={() => { fileRef.current?.click(); setMenu(false) }}>Restore a backup…</button>
              {tester && <button className="menu-item" onClick={() => { setMenu(false); if (confirm('Switch to another tester? Your notebooks stay saved under your name on this device.')) onSwitchTester?.() }}>Switch tester</button>}
            </div>
          )}
        </div>
        {tester && <span className="ob-avatar" title={tester.name} aria-label={`Signed in as ${tester.name}`}>{tester.name.trim().charAt(0).toUpperCase() || '·'}</span>}
        <input ref={fileRef} type="file" accept=".json,.nova.json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importBackup(f) }} />
        <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportPaper(f) }} />
      </header>
      <main className="library-main ob-home-main">
        <div className="ob-greet">
          <span className="ob-date">{today}</span>
          <h1>{greeting}{tester ? `, ${tester.name.trim().split(/\s+/)[0]}` : ''}.</h1>
        </div>
        {items === null && <p className="muted">Loading…</p>}

        <div className="ob-home-top">
          {latest ? (
            <section className="ob-continue">
              <button className="ob-continue-sheet" onClick={() => onOpen(latest.id)} aria-label={`Continue ${latest.title}`}>
                <PageThumb page={pageOf(latestDoc)} aspect={3 / 4} />
              </button>
              <div className="ob-continue-body">
                <span className="ob-kicker">Continue where you left off</span>
                <h2>{latest.title}</h2>
                <span className="ob-meta">{latest.pageCount} {latest.pageCount === 1 ? 'page' : 'pages'} · edited {when(latest.updatedAt)}</span>
                {lines.length > 0 && (
                  <ul className="ob-lines">
                    {lines.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                )}
                <div className="ob-facts">
                  <span><b>{st.lines}</b> lines</span>
                  {st.right > 0 && <span className="ok"><b>{st.right}</b> right</span>}
                  {st.wrong > 0 && <span className="bad"><b>{st.wrong}</b> to fix</span>}
                  {latestTest?.score && <span><b>{latestTest.score.correct}/{latestTest.score.total}</b> on the test</span>}
                </div>
                <div className="ob-continue-foot">
                  <button className="btn primary" onClick={() => onOpen(latest.id)}><Icon.pen /> Continue writing</button>
                  {prog.lastTopic && <button className="btn" onClick={() => onPractice(prog.lastTopic!)}>Practise {prog.lastTopic}</button>}
                </div>
              </div>
            </section>
          ) : (
            items !== null && (
              <section className="ob-continue empty">
                <div className="ob-continue-body">
                  <span className="ob-kicker">Your first notebook</span>
                  <h2>Write maths by hand. NOVA reads it and helps.</h2>
                  <div className="ob-continue-foot"><button className="btn primary" onClick={onCreate}><Icon.plus /> New notebook</button></div>
                </div>
              </section>
            )
          )}
          <div className="ob-tiles">
            <button className="ob-tile" onClick={onCreate}><span className="ob-tile-icon accent"><Icon.plus /></span><b>New notebook</b><span>Blank squared page</span></button>
            <button className="ob-tile" onClick={() => pdfRef.current?.click()}><span className="ob-tile-icon"><Icon.upload /></span><b>Import question paper</b><span>PDF, with answer space beside each question</span></button>
            <button className="ob-tile" onClick={() => setPracticeOpen(true)}><span className="ob-tile-icon warm"><Icon.target /></span><b>Practice sets</b><span>Questions NOVA writes and marks</span></button>
            <div className="ob-try">
              Try: <button className="link" onClick={() => onTry('graph')}>graph a function</button> · <button className="link" onClick={() => onTry('diagram')}>read a diagram</button> · <button className="link" onClick={() => onTry('ask')}>simplify an expression</button>
            </div>
          </div>
        </div>

        <section className="lib-section ob-shelf">
          <div className="ob-shelf-head">
            <h2>Your notebooks</h2>
            {items && items.length > 0 && <span className="ob-count">{items.length}</span>}
            <span className="spacer" />
            <label className="ob-search show-phone">
              <Icon.search />
              <input type="search" placeholder="Search" aria-label="Search notebooks" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="ob-sort">
              <span className="sr-only">Sort notebooks</span>
              <select value={sort} aria-label="Sort notebooks" onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="recent">Recent</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
          {weak.length > 0 && (
            <div className="ob-weak">
              <span>Needs practice</span>
              {weak.slice(0, 4).map((t) => (
                <button key={t.topic} className="chip" onClick={() => onPractice(t.topic)} title={`Practise ${t.topic}`}>
                  {t.topic} · {Math.round((t.right / (t.right + t.wrong)) * 100)}%
                </button>
              ))}
            </div>
          )}
          {items && items.length > 0 && shown.length === 0 && <p className="muted">No notebooks match “{query}”.</p>}
          <div className="ob-grid">
            {shown.map((n) => {
              const d = docs[n.id]
              const badge = coverBadge(d)
              return (
                <div key={n.id} className="ob-card">
                  <button className="ob-card-open" onClick={() => onOpen(n.id)} aria-label={`Open ${n.title}`}>
                    <span className="ob-card-sheet"><PageThumb page={pageOf(d)} aspect={3 / 4} /></span>
                    <span className="ob-card-info">
                      <b>{n.title}</b>
                      <span>{n.pageCount} {n.pageCount === 1 ? 'page' : 'pages'} · {when(n.updatedAt)}{badge && badge.kind !== 'draft' ? ` · ${badge.text}` : ''}</span>
                    </span>
                  </button>
                  <button className="ob-card-del" aria-label={`Delete ${n.title}`} onClick={() => void remove(n)}><Icon.trash /></button>
                </div>
              )
            })}
          </div>
        </section>
        <footer className="library-foot">NOVA keeps your notebooks on this device.</footer>
      </main>
      {practiceOpen && (
        <PracticeDialog suggested={weak.map((t) => t.topic)} onStart={(p) => { setPracticeOpen(false); if (p.topic) onPractice(p.topic) }} onClose={() => setPracticeOpen(false)} />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ notebook covers

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
