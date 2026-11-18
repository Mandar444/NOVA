// Gate B: the real 4-page paper (CBSE 2018 Class X SQP, pages 1-4). One browser, contexts one after another.
// Paper AI analysis (/paper/analyze) is held open (EMULATED: never answers) in every run except the one marked real,
// which both proves drawing does not wait for the AI and avoids loading the provider.
// usage: node c_pdf.cjs [T|W|F|X|R|Q ...]   (default: all)
const L = require('./lib.cjs')
const path = require('node:path')
const fs = require('node:fs')
const PDF = path.join(__dirname, '..', 'real4.pdf')
const which = process.argv.slice(2).length ? process.argv.slice(2) : ['T', 'W', 'F', 'X', 'R', 'Q']
const res = { pdf: 'real4.pdf (CBSE 2018 Class X Maths SQP p1-4, pages 3-4 contain figures)', runs: {} }
const save = () => fs.writeFileSync(path.join(L.OUT, 'c_pdf.json'), JSON.stringify(res, null, 1))

const readyCount = (page) => page.evaluate(() => { const d = document.documentElement; const t0 = Number(d.dataset.t0 || 0); return JSON.parse(d.dataset.marks || '[]').filter((m) => m.t >= t0 && (m.name === 'nova-page-ready' || m.name === 'nova-page-failed')).length })
const transform = (page) => page.evaluate(() => document.querySelector('.page-transform')?.style.transform || null)
const sheetShown = (page) => page.evaluate(() => { const i = document.querySelector('img.sheet-img'); return !!(i && i.complete && i.naturalWidth) })
const chip = (page) => page.locator('.prep-chip').first().innerText({ timeout: 500 }).catch(() => null)

async function start(browser, { cpu = 1, realAI = false } = {}) {
  const s = await L.open(browser, { cpu, viewport: { width: 1366, height: 860 } })
  if (!realAI) await s.page.route('**/api/v1/paper/analyze', () => { /* held open: emulated AI that never answers */ })
  await L.newNotebook(s.page)
  return s
}
async function importPdf(page) {
  await page.evaluate(() => { document.documentElement.dataset.t0 = String(performance.now()) })
  const t0 = Date.now()
  await page.locator('input[type=file][accept*=pdf]').last().setInputFiles(PDF)
  return t0
}
async function scribble(page, x, y, n = 12) {
  const b = await L.ws(page)
  const t = Date.now()
  await page.mouse.move(b.x + x, b.y + y); await page.mouse.down()
  for (let k = 1; k <= n; k++) await page.mouse.move(b.x + x + k * 7, b.y + y + (k % 2) * 7)
  await page.mouse.up()
  return Date.now() - t
}
const firstPaper = async (page) => {
  const d = (await L.savedDocs(page))[0]
  const paper = d.pages.filter((p) => p.bg !== 'none') // the imported pages (a sheet behind them), in notebook order
  return { last: d.last, firstPageId: paper[0]?.id, pages: paper.map((p) => ({ title: p.title, bg: p.bg, strokes: p.strokes })), notebookPages: d.pages.length }
}

const allSavedReady = async (page, ms = 120000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const d = await firstPaper(page).catch(() => null)
    if (d && d.pages.length === 4 && d.pages.every((p) => p.bg === 'ready')) return (Date.now() - t) / 1000
    await page.waitForTimeout(1000)
  }
  return false
}
;(async () => {
  const browser = await L.launch()

  // T: timings. 5 samples unthrottled + 3 samples with the CPU slowed 4x. AI held open.
  if (which.includes('T')) {
    res.runs.T = []
    for (const [cpu, n] of [[1, 5], [4, 3]]) for (let i = 0; i < n; i++) {
      const { ctx, page, log } = await start(browser, { cpu })
      const lt0 = await L.now(page)
      const t0 = await importPdf(page)
      const r = { cpu }
      await L.waitFor(page, () => { const i = document.querySelector('img.sheet-img'); return i && i.complete && i.naturalWidth > 0 }, null, 120000)
      r.visible_s = (Date.now() - t0) / 1000
      const readyAtStroke = await readyCount(page)
      await scribble(page, 1000, 300)
      r.writable_s = (Date.now() - t0) / 1000 // pen-up of a stroke started the moment the sheet showed
      r.pagesReadyWhenStrokeStarted = readyAtStroke
      await L.waitFor(page, () => { const d = document.documentElement; const t0 = Number(d.dataset.t0 || 0); return JSON.parse(d.dataset.marks || '[]').filter((m) => m.t >= t0 && (m.name === 'nova-page-ready' || m.name === 'nova-page-failed')).length >= 4 }, null, 180000)
      r.allReady_s = (Date.now() - t0) / 1000
      r.ready = await readyCount(page)
      await page.waitForTimeout(1500)
      const doc = await firstPaper(page)
      r.strokeKeptOnPage1 = doc.pages[0].strokes >= 1
      r.pages = doc.pages.map((p) => p.bg).join(',')
      const lt = await L.longTasks(page, lt0)
      r.longTasks = { n: lt.length, max_ms: lt.length ? Math.max(...lt) : 0, total_ms: lt.reduce((a, b) => a + b, 0) }
      r.input = await L.inputLatency(page, lt0)
      r.analyzeRequests = log.requests.filter((q) => q.path === 'paper/analyze').length
      r.errors = log.errors
      res.runs.T.push(r)
      console.error('T', JSON.stringify(r))
      save()
      await ctx.close()
    }
  }

  // W: write while the rest prepare (CPU 6x): zoom in, write 3 strokes, then check ink, zoom and active page after all pages are ready.
  if (which.includes('W')) {
    const { ctx, page, log } = await start(browser, { cpu: 6 })
    const t0 = await importPdf(page)
    await L.waitFor(page, () => { const i = document.querySelector('img.sheet-img'); return i && i.complete && i.naturalWidth > 0 }, null, 120000)
    const r = { cpu: 6, visible_s: (Date.now() - t0) / 1000 }
    const b = await L.ws(page)
    await page.mouse.move(b.x + 600, b.y + 400)
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -240); await page.keyboard.up('Control')
    await page.waitForTimeout(400)
    r.zoomAfterUserZoom = await transform(page)
    r.readyBeforeWriting = await readyCount(page)
    const lt0 = await L.now(page)
    for (let k = 0; k < 3; k++) await scribble(page, 700, 250 + k * 70)
    r.readyAfterWriting = await readyCount(page)
    r.inputWhilePreparing = await L.inputLatency(page, lt0)
    r.chipWhileWriting = await chip(page)
    await L.waitFor(page, () => { const d = document.documentElement; const t0 = Number(d.dataset.t0 || 0); return JSON.parse(d.dataset.marks || '[]').filter((m) => m.t >= t0 && (m.name === 'nova-page-ready' || m.name === 'nova-page-failed')).length >= 4 }, null, 180000)
    r.allReady_s = (Date.now() - t0) / 1000
    await page.waitForTimeout(2000)
    r.zoomAfterAllReady = await transform(page)
    r.zoomKept = r.zoomAfterAllReady === r.zoomAfterUserZoom
    r.pageLabel = await L.pageTitle(page)
    const doc = await firstPaper(page)
    r.activePageIsPage1 = doc.last === doc.firstPageId
    r.page1Strokes = doc.pages[0].strokes
    r.pages = doc.pages.map((p) => p.bg).join(',')
    r.errors = log.errors
    await L.shot(page, 'c_pdf_W')
    res.runs.W = r; console.error('W', JSON.stringify(r)); save()
    await ctx.close()
  }

  // F: page 2's sheet fails to save (EMULATED: IndexedDB put throws once). Retry shown, others continue, Retry draws it, ink kept.
  if (which.includes('F')) {
    const { ctx, page, log } = await start(browser, { cpu: 1 })
    await page.addInitScript(() => {
      const orig = IDBObjectStore.prototype.put
      let failed = false
      IDBObjectStore.prototype.put = function (v, ...rest) {
        if (!failed && v && v.mime === 'image/png' && JSON.parse(document.documentElement.dataset.marks || '[]').filter((x) => x.name === 'nova-page-ready').length === 1) { failed = true; throw new DOMException('injected failure', 'QuotaExceededError') }
        return orig.call(this, v, ...rest)
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500)
    const card = page.locator('.nb-card:not(.add)').first()
    if (!(await page.locator('[data-testid=workspace]').count()) && (await card.count())) { await card.click(); await page.waitForTimeout(1500) }
    await importPdf(page)
    await L.waitFor(page, () => { const i = document.querySelector('img.sheet-img'); return i && i.complete && i.naturalWidth > 0 }, null, 120000)
    await scribble(page, 1000, 300)
    await L.waitFor(page, () => JSON.parse(document.documentElement.dataset.marks || '[]').filter((m) => m.name === 'nova-page-ready' || m.name === 'nova-page-failed').length >= 4, null, 120000)
    const m = await L.marks(page)
    const r = { marks: m.filter((x) => /nova-page-/.test(x.name)).map((x) => x.name.replace('nova-page-', '') + ':' + (x.detail.index + 1)) }
    const failedIdx = m.find((x) => x.name === 'nova-page-failed')?.detail.index
    if (failedIdx !== undefined) {
      const pagesBtn = page.getByRole('button', { name: /^Pages$/ }).first()
      if (await pagesBtn.count()) { await pagesBtn.click(); await page.waitForTimeout(300) }
      await page.evaluate((n) => { const it = [...document.querySelectorAll('button, [role=button], a, li')].find((b) => new RegExp(`· ${n}\\b`).test(b.textContent || '')); it?.click() }, failedIdx + 1)
      await page.waitForTimeout(600)
      r.chipOnFailedPage = await chip(page)
      await page.locator('.prep-chip button').click({ timeout: 3000 }).catch(() => {})
      r.retried = await L.waitFor(page, (n) => JSON.parse(document.documentElement.dataset.marks || '[]').filter((m) => m.name === 'nova-page-ready' && m.detail.index === n).length > 0, failedIdx, 60000)
      await page.waitForTimeout(1500)
      r.sheetAfterRetry = await sheetShown(page)
      r.chipAfterRetry = await chip(page)
    }
    const doc = await firstPaper(page)
    r.pages = doc.pages.map((p) => p.bg).join(','); r.page1Strokes = doc.pages[0].strokes
    r.errors = log.errors
    res.runs.F = r; console.error('F', JSON.stringify(r)); save()
    await ctx.close()
  }

  // X: cancel mid-import by closing the notebook (CPU 6x): drawing stops; reopening resumes; ink kept.
  if (which.includes('X')) {
    const { ctx, page, log } = await start(browser, { cpu: 6 })
    await importPdf(page)
    await L.waitFor(page, () => { const i = document.querySelector('img.sheet-img'); return i && i.complete && i.naturalWidth > 0 }, null, 120000)
    await scribble(page, 1000, 300)
    await page.waitForTimeout(400)
    const r = { readyAtClose: await readyCount(page) }
    await page.getByRole('button', { name: 'Notebooks' }).first().click()
    await page.waitForTimeout(5000)
    r.readyFiveSecondsAfterClose = await readyCount(page)
    r.savedWhileClosed = (await firstPaper(page)).pages.map((p) => p.bg).join(',')
    await page.locator('.nb-card:not(.add)').first().click()
    await page.waitForSelector('[data-testid=workspace]')
    r.allReadyAfterReopen_s = await allSavedReady(page)
    const doc = await firstPaper(page)
    r.pagesAfterReopen = doc.pages.map((p) => p.bg).join(','); r.page1Strokes = doc.pages[0].strokes
    r.errors = log.errors
    res.runs.X = r; console.error('X', JSON.stringify(r)); save()
    await ctx.close()
  }

  // R: reload mid-import (CPU 6x): ink kept, every page comes back ready, none stuck on Preparing.
  if (which.includes('R')) {
    const { ctx, page, log } = await start(browser, { cpu: 6 })
    await importPdf(page)
    await L.waitFor(page, () => { const i = document.querySelector('img.sheet-img'); return i && i.complete && i.naturalWidth > 0 }, null, 120000)
    await scribble(page, 1000, 300)
    await page.waitForTimeout(1500)
    const r = { readyBeforeReload: await readyCount(page), savedBeforeReload: (await firstPaper(page)).pages.map((p) => p.bg).join(',') }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    const card = page.locator('.nb-card:not(.add)').first()
    if (!(await page.locator('[data-testid=workspace]').count()) && (await card.count())) { await card.click(); await page.waitForTimeout(1500) }
    r.allReadyAfterReload_s = await allSavedReady(page)
    const doc = await firstPaper(page)
    r.pagesAfterReload = doc.pages.map((p) => p.bg).join(','); r.page1Strokes = doc.pages[0].strokes
    r.errors = log.errors
    res.runs.R = r; console.error('R', JSON.stringify(r)); save()
    await ctx.close()
  }

  // Q: one run with the REAL model: page 1 questions found, while drawing proceeds independently.
  if (which.includes('Q')) {
    const { ctx, page, log } = await start(browser, { cpu: 1, realAI: true })
    const t0 = await importPdf(page)
    const r = {}
    await L.waitFor(page, () => { const i = document.querySelector('img.sheet-img'); return i && i.complete && i.naturalWidth > 0 }, null, 120000)
    r.visible_s = (Date.now() - t0) / 1000
    await L.waitFor(page, () => { const d = document.documentElement; const t0 = Number(d.dataset.t0 || 0); return JSON.parse(d.dataset.marks || '[]').filter((m) => m.t >= t0 && (m.name === 'nova-page-ready' || m.name === 'nova-page-failed')).length >= 4 }, null, 180000)
    r.allReady_s = (Date.now() - t0) / 1000
    r.questionsShown = await L.waitFor(page, () => /NOVA found|found no questions|could not read/i.test(document.body.innerText), null, 130000)
    r.questions_s = (Date.now() - t0) / 1000
    r.toast = await page.evaluate(() => (document.body.innerText.match(/NOVA (found|could not)[^\n]*/i) || [''])[0].slice(0, 120))
    r.analyze = log.requests.filter((q) => q.path === 'paper/analyze').map((q) => ({ ms: q.doneAt - q.at, status: q.status, failed: q.failed }))
    await page.waitForTimeout(2000)
    r.tests = (await L.savedDocs(page))[0].tests
    r.errors = log.errors
    res.runs.Q = r; console.error('Q', JSON.stringify(r)); save()
    await ctx.close()
  }

  save()
  console.log(JSON.stringify(res, null, 1))
  await browser.close()
})()
