// Shared helpers for the NOVA journeys. Real app (local preview build), real backend, real GLM model unless a test
// explicitly delays or fails a request (that is emulation and is reported as such).
const { chromium } = require('C:/Users/smand/.vscode/extensions/danielsanmedium.dscodegpt-3.24.81/standalone/node_modules/patchright')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const URL = process.env.NOVA_URL || 'http://127.0.0.1:5190/'
const OUT = path.join(__dirname, 'out')
require('node:fs').mkdirSync(OUT, { recursive: true })

async function launch() {
  return chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] })
}

/** A fresh browser profile (disposable notebooks), with request logging and app perf marks mirrored to <html>. */
async function open(browser, { cpu = 1, viewport = { width: 1440, height: 900 }, name = 'QA student' } = {}) {
  const ctx = await browser.newContext({ locale: 'en-US', viewport })
  const page = await ctx.newPage()
  const log = { requests: [], errors: [], console: [] }
  await page.addInitScript(() => {
    const orig = performance.mark.bind(performance)
    performance.mark = (n, o) => {
      const m = orig(n, o)
      try { const d = document.documentElement; const a = JSON.parse(d.dataset.marks || '[]'); a.push({ name: n, t: Math.round(m.startTime), detail: (o && o.detail) || {} }); d.dataset.marks = JSON.stringify(a) } catch {}
      return m
    }
    const d = () => document.documentElement
    d().dataset && 0
    new PerformanceObserver((l) => {
      try { const a = JSON.parse(d().dataset.lt || '[]'); for (const e of l.getEntries()) a.push([Math.round(e.startTime), Math.round(e.duration)]); d().dataset.lt = JSON.stringify(a) } catch {}
    }).observe({ type: 'longtask', buffered: true })
  })
  page.on('pageerror', (e) => log.errors.push(String(e).slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error') log.console.push(m.text().slice(0, 200)) })
  const t0 = Date.now()
  page.on('request', (r) => {
    const u = r.url()
    if (!u.includes('/api/v1/')) return
    let body = {}
    try { body = JSON.parse(r.postData() || '{}') } catch {}
    const e = { path: u.split('/api/v1/')[1], at: Date.now() - t0, region: body.context?.regionId, hash: body.context?.sourceHash, rid: body.context?.requestId, question: body.question, intent: body.intent, text: body.text, problem: body.problem?.text, problemOk: body.problem?.accepted, current: body.current?.text, currentOk: body.current?.accepted, exam: body.exam ? body.exam.number + ':' + (body.exam.text || '').slice(0, 60) : undefined, history: body.history?.length }
    r._qa = e
    log.requests.push(e)
  })
  page.on('response', (r) => { const e = r.request()._qa; if (e) { e.status = r.status(); e.doneAt = Date.now() - t0 } })
  page.on('requestfailed', (r) => { const e = r._qa; if (e) { e.failed = r.failure()?.errorText; e.doneAt = Date.now() - t0 } })
  if (cpu > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu }) }
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  if (await page.getByRole('textbox').count() && !(await page.locator('[data-testid=workspace]').count())) {
    await page.getByRole('textbox').first().fill(name)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2500)
  }
  return { ctx, page, log, t0 }
}

async function newNotebook(page) {
  const nb = page.getByRole('button', { name: 'Notebooks' })
  if (await nb.count()) { await nb.first().click(); await page.waitForTimeout(600) }
  await page.getByRole('button', { name: /New notebook/ }).first().click()
  await page.waitForSelector('[data-testid=workspace]')
  await page.waitForTimeout(600)
}

async function assist(page, on = true) {
  const t = page.locator('.assist-toggle').first()
  const isOn = (await t.getAttribute('aria-pressed')) === 'true'
  if (isOn !== on) {
    await t.click()
    const c = page.getByRole('button', { name: 'Turn on Assist', exact: true })
    if (await c.count()) await c.click()
    await page.waitForTimeout(300)
  }
}

async function ws(page) { return page.locator('[data-testid=workspace]').boundingBox() }

let glyphs
async function draw(page, text, x, y, size = 50, seed = 7) {
  glyphs ??= await import(pathToFileURL('C:/Users/smand/OneDrive/Desktop/Nova/tests/e2e/glyphs.mjs').href)
  const b = await ws(page)
  await glyphs.drawText(page, text, b.x + x, b.y + y, size, seed)
}

async function stroke(page, pts) {
  const b = await ws(page)
  await page.mouse.move(b.x + pts[0][0], b.y + pts[0][1])
  await page.mouse.down()
  for (const [x, y] of pts.slice(1)) await page.mouse.move(b.x + x, b.y + y)
  await page.mouse.up()
}

const readbacks = (page) => page.evaluate(() => [...document.querySelectorAll('.readback')].map((e) => ({ cls: e.className.replace('readback', '').trim(), text: e.textContent.trim().slice(0, 80) })))
const novaInks = (page) => page.evaluate(() => [...document.querySelectorAll('.nova-ink')].map((g) => g.getAttribute('class')))
const strokesOnPage = (page) => page.evaluate(() => document.querySelectorAll('[data-testid=workspace]').length)

async function waitFor(page, fn, arg, ms = 60000) {
  return page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true).catch(() => false)
}

/** Wait until NOVA shows a readback containing `want` (or any accepted readback if want is null). */
async function waitReadback(page, want, ms = 60000) {
  return waitFor(page, (w) => [...document.querySelectorAll('.readback')].some((e) => !e.className.includes('pending') && (!w || e.textContent.replace(/\s+/g, '').includes(w.replace(/\s+/g, '')))), want, ms)
}

async function openAsk(page) {
  if (!(await page.locator('.ask-panel').count())) {
    await page.getByRole('button', { name: 'Ask NOVA' }).first().click()
    await page.waitForSelector('.ask-panel textarea')
  }
}

async function ask(page, q) {
  await openAsk(page)
  const box = page.locator('.ask-panel textarea')
  await box.fill(q)
  await box.press('Enter')
}

async function lastTutor(page, before, ms = 130000) {
  await waitFor(page, (n) => document.querySelectorAll('.bubble.tutor:not(.thinking):not(.notice):not(.error)').length > n && !document.querySelector('.bubble.thinking'), before, ms)
  return page.evaluate(() => {
    const b = [...document.querySelectorAll('.bubble.tutor')].filter((x) => !x.classList.contains('thinking'))
    const last = b[b.length - 1]
    if (!last) return null
    const det = last.querySelector('details > div')
    return { cls: last.className, text: (last.firstChild?.textContent ?? last.textContent).trim(), detail: det ? det.textContent.trim() : null }
  })
}
const tutorCount = (page) => page.evaluate(() => document.querySelectorAll('.bubble.tutor:not(.thinking):not(.notice):not(.error)').length)

/** Every NOVA annotation on the page vs every student stroke box: overlaps (NOVA covering the student's writing). */
async function overlap(page) {
  return page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect()
    const nova = [...document.querySelectorAll('[data-testid=tutor-card], .nova-ink, .tutor-note, .ann-note')].map(r).filter((b) => b.width && b.height)
    const rb = [...document.querySelectorAll('.readback')].map(r)
    return { novaBoxes: nova.length, novaArea: Math.round(nova.reduce((a, b) => a + b.width * b.height, 0)), readbacks: rb.length }
  })
}

async function pageTitle(page) { return page.evaluate(() => (document.body.innerText.match(/Page \d+ of \d+/) || [''])[0]) }
async function longTasks(page, since = 0) {
  return page.evaluate((s) => JSON.parse(document.documentElement.dataset.lt || '[]').filter(([t]) => t >= s).map(([, d]) => d), since)
}
const now = (page) => page.evaluate(() => performance.now())
const marks = (page) => page.evaluate(() => JSON.parse(document.documentElement.dataset.marks || '[]'))
async function shot(page, name) { await page.screenshot({ path: path.join(OUT, name + '.png') }) }

module.exports = { launch, open, newNotebook, assist, ws, draw, stroke, readbacks, novaInks, waitFor, waitReadback, openAsk, ask, lastTutor, tutorCount, overlap, pageTitle, longTasks, now, marks, shot, OUT, URL }

/** The saved notebook (IndexedDB), newest first: what NOVA actually stored, after the debounced autosave. */
async function savedDocs(page) {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases()
    const out = []
    for (const { name } of dbs) {
      if (!name || !name.startsWith('nova')) continue
      const db = await new Promise((r, j) => { const q = indexedDB.open(name); q.onsuccess = () => r(q.result); q.onerror = j })
      if (![...db.objectStoreNames].includes('notebooks')) continue
      const all = await new Promise((r) => { const q = db.transaction('notebooks').objectStore('notebooks').getAll(); q.onsuccess = () => r(q.result) })
      out.push(...all)
    }
    return out.sort((a, b) => (b.notebook?.updatedAt ?? 0) - (a.notebook?.updatedAt ?? 0)).map((d) => ({
      id: d.notebook.id, title: d.notebook.title, order: d.notebook.orderedPageIds, last: d.notebook.lastPageId,
      tests: Object.values(d.tests || {}).map((t) => ({ status: t.status, questions: t.questions.length, read: (t.readPageIds || []).length, pages: t.pageIds.length })),
      pages: d.notebook.orderedPageIds.map((id) => d.pages[id]).map((p) => ({
        id: p.id, title: p.title, bg: p.bgState || (p.backgroundAssetId ? 'ready' : 'none'), strokes: p.strokes.length,
        regions: p.regions.map((r) => ({ id: r.id, box: r.bounds, hash: r.sourceHash, strokes: r.strokeIds?.length ?? r.sourceStrokeIds?.length, reading: p.readings[r.id] ? { text: p.readings[r.id].acceptedText || p.readings[r.id].rawText, state: p.readings[r.id].state, fresh: p.readings[r.id].sourceHash === r.sourceHash } : null })),
        tutor: p.tutorObjects.filter((o) => o.status === 'active').map((o) => o.action.type + ':' + (o.action.text || o.action.expression || (o.action.lines || []).join(' / ') || (o.action.groups || []).join(',') || o.action.reason || '').slice(0, 160)),
        tutorBoxes: p.tutorObjects.filter((o) => o.status === 'active' && o.layout).map((o) => ({ id: o.id, type: o.action.type, x: o.layout.x, y: o.layout.y, w: o.layout.w, h: o.layout.h })),
        history: p.history.map((t) => t.role[0] + ': ' + t.text.slice(0, 80)),
      })),
    }))
  })
}
module.exports.savedDocs = savedDocs

/** NOVA objects whose box covers a student's line (intersection area > 15% of the line's box). */
function covering(pageDoc) {
  const hits = []
  for (const t of pageDoc.tutorBoxes || []) for (const r of pageDoc.regions) {
    const b = r.box; if (!b) continue
    const ix = Math.max(0, Math.min(t.x + t.w, b.x + b.w) - Math.max(t.x, b.x)), iy = Math.max(0, Math.min(t.y + t.h, b.y + b.h) - Math.max(t.y, b.y))
    if (ix * iy > 0.15 * b.w * b.h) hits.push(`${t.type} covers "${r.reading?.text ?? r.id}" (${Math.round(100 * ix * iy / (b.w * b.h))}%)`)
  }
  return hits
}
module.exports.covering = covering
