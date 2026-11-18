// The hard import journeys, on the new build. usage: node import_journeys.cjs <url> <pdf4>
// CPU is slowed 6x so background work is still running while we act.
const { chromium } = require('C:/Users/smand/.vscode/extensions/danielsanmedium.dscodegpt-3.24.81/standalone/node_modules/patchright')
const path = require('node:path')
const fs = require('node:fs')

const marks = (page) => page.evaluate(() => {
  const t0 = Number(document.documentElement.dataset.t0 || 0)
  return JSON.parse(document.documentElement.dataset.marks || '[]').filter((m) => m.name.startsWith('nova-') && m.t >= t0)
    .map((m) => ({ name: m.name, at_s: +((m.t - t0) / 1000).toFixed(2), ...(m.detail || {}) }))
})

async function setup(browser, url, slow = 6) {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1366, height: 860 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  await page.addInitScript(() => {
    // mirror the app's performance marks onto <html>, which the test driver (isolated world) can read
    const orig = performance.mark.bind(performance)
    performance.mark = (name, opts) => {
      const m = orig(name, opts)
      try { const d = document.documentElement; const a = JSON.parse(d.dataset.marks || '[]'); a.push({ name, t: m.startTime, detail: (opts && opts.detail) || {} }); d.dataset.marks = JSON.stringify(a) } catch {}
      return m
    }
  })
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: slow })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)
  if (await page.getByRole('textbox').count()) {
    await page.getByRole('textbox').first().fill('Journey QA')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3000)
  }
  return { ctx, page, cdp, errors }
}

const chooseFile = async (page, file) => {
  await page.evaluate(() => { document.documentElement.dataset.t0 = String(performance.now()) })
  await page.locator('input[type=file][accept*=pdf]').first().setInputFiles(file)
}
const pageTitle = (page) => page.evaluate(() => document.title + ' | ' + (document.querySelector('.page-title, .nb-title, h1')?.textContent ?? ''))
const chip = (page) => page.locator('.prep-chip').first().innerText({ timeout: 500 }).catch(() => null)
const sheetLoaded = (page) => page.evaluate(() => { const i = document.querySelector('img.sheet-img'); return !!(i && i.complete && i.naturalWidth) })

;(async () => {
  const [url, pdf4] = process.argv.slice(2)
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] })
  const res = {}

  // A) timings broken down: parse vs first draw vs the rest, unthrottled and 6x slow
  for (const slow of [1, 6]) {
    const { ctx, page } = await setup(browser, url, slow)
    await chooseFile(page, pdf4)
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.marks || '[]').filter((x) => x.name === 'nova-page-ready').length >= 4, null, { timeout: 120000 }).catch(() => {})
    res[`A_breakdown_cpu${slow}`] = await marks(page)
    await ctx.close()
  }

  // B) open page 3 while pages are still preparing: it must be prepared next, before page 2/4 if still queued
  if (!process.env.ONLY_E) {
  if (!process.env.ONLY_E) {
  {
    const { ctx, page, errors } = await setup(browser, url)
    await chooseFile(page, pdf4)
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.marks || '[]').filter((x) => x.name === 'nova-pdf-parsed').length > 0, null, { timeout: 60000 })
    await page.waitForTimeout(150)
    // open page 3 from the pages rail
    const opened = await page.evaluate(() => {
      const items = [...document.querySelectorAll('button, [role=button], a')].filter((b) => /· 3\b/.test(b.textContent || ''))
      if (items[0]) { items[0].click(); return items[0].textContent.trim().slice(0, 60) }
      return null
    })
    let viaRail = opened
    if (!opened) {
      const pagesBtn = page.getByRole('button', { name: /^Pages$/ }).first()
      if (await pagesBtn.count()) { await pagesBtn.click(); await page.waitForTimeout(300) }
      viaRail = await page.evaluate(() => {
        const items = [...document.querySelectorAll('button, [role=button], a, li')].filter((b) => /· 3\b/.test(b.textContent || ''))
        if (items[0]) { items[0].click(); return items[0].textContent.trim().slice(0, 60) }
        return null
      })
    }
    res.B_opened = viaRail
    res.B_chipRightAfter = await chip(page)
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.marks || '[]').filter((x) => x.name === 'nova-page-ready').length >= 4, null, { timeout: 120000 }).catch(() => {})
    res.B_order = (await marks(page)).filter((m) => m.name === 'nova-page-ready').map((m) => m.index + 1)
    res.B_page3SheetShown = await sheetLoaded(page)
    res.B_errors = errors
    await ctx.close()
  }
  }
  }

  // C) write on page 1 while the rest prepare; reload mid-import; strokes kept, no page stuck on "Preparing"
  if (!process.env.ONLY_E) {
  {
    const { ctx, page, errors } = await setup(browser, url)
    await chooseFile(page, pdf4)
    await page.waitForFunction(() => { const i = document.querySelector('img.sheet-img'); return i && i.complete && i.naturalWidth > 0 }, null, { timeout: 60000 })
    const ws = await page.locator('[data-testid=workspace]').boundingBox()
    await page.mouse.move(ws.x + 900, ws.y + 260); await page.mouse.down()
    for (let k = 1; k <= 10; k++) await page.mouse.move(ws.x + 900 + k * 9, ws.y + 260 + (k % 2) * 8)
    await page.mouse.up()
    await page.waitForTimeout(1500) // autosave
    res.C_readyBeforeReload = (await marks(page)).filter((m) => m.name === 'nova-page-ready').length
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    // reopen the notebook from the library if the app starts there
    const card = page.locator('.nb-card:not(.add)').first()
    if (await card.count()) { await card.click(); await page.waitForTimeout(2000) }
    await page.waitForTimeout(8000)
    res.C_afterReload = await page.evaluate(async () => {
      // read the saved notebook straight from IndexedDB: page states and stroke counts
      const dbs = await indexedDB.databases()
      const name = dbs.map((d) => d.name).find((n) => n && n.startsWith('nova'))
      const db = await new Promise((r, j) => { const q = indexedDB.open(name); q.onsuccess = () => r(q.result); q.onerror = j })
      const all = await new Promise((r) => { const q = db.transaction('notebooks').objectStore('notebooks').getAll(); q.onsuccess = () => r(q.result) })
      const doc = all.sort((a, b) => (b.notebook?.updatedAt ?? 0) - (a.notebook?.updatedAt ?? 0))[0]
      return Object.values(doc.pages).filter((p) => p.source).sort((a, b) => a.source.index - b.source.index)
        .map((p) => ({ page: p.source.index + 1, state: p.bgState ?? 'ready', strokes: p.strokes.length, textLines: (p.docText || []).length }))
    })
    res.C_errors = errors
    await ctx.close()
  }
  }

  // D) a page that fails shows Retry, and Retry prepares it (fault injected: page 2's image save fails once)
  if (!process.env.ONLY_E) {
  {
    const { ctx, page, errors } = await setup(browser, url, 1)
    await page.addInitScript(() => {  // main world (the app's IndexedDB), then reload so it applies
      const orig = IDBObjectStore.prototype.put
      let failed = false
      IDBObjectStore.prototype.put = function (v, ...rest) {
        if (!failed && v && v.mime === 'image/png' && JSON.parse(document.documentElement.dataset.marks || '[]').filter((x) => x.name === 'nova-page-ready').length === 1) { failed = true; throw new DOMException('injected failure', 'QuotaExceededError') }
        return orig.call(this, v, ...rest)
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await chooseFile(page, pdf4)
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.marks || '[]').filter((x) => x.name === 'nova-page-failed').length > 0, null, { timeout: 60000 }).catch(() => {})
    res.D_marks = (await marks(page)).filter((m) => m.name !== 'nova-pdf-parsed').map((m) => `${m.name.replace('nova-page-', '')}:${m.index + 1}`)
    // go to the failed page and press Retry
    const failedIdx = (await marks(page)).find((m) => m.name === 'nova-page-failed')?.index
    if (failedIdx !== undefined) {
      const pagesBtn = page.getByRole('button', { name: /^Pages$/ }).first()
      if (await pagesBtn.count()) { await pagesBtn.click(); await page.waitForTimeout(300) }
      await page.evaluate((n) => { const it = [...document.querySelectorAll('button, [role=button], a, li')].find((b) => new RegExp(`· ${n}\\b`).test(b.textContent || '')); it?.click() }, failedIdx + 1)
      await page.waitForTimeout(500)
      res.D_chip = await chip(page)
      await page.locator('.prep-chip button').click({ timeout: 3000 }).catch(() => {})
      await page.waitForFunction((n) => JSON.parse(document.documentElement.dataset.marks || '[]').some((m) => m.name === 'nova-page-ready' && m.detail.index === n), failedIdx, { timeout: 30000 }).then(() => { res.D_retried = 'ready' }).catch(() => { res.D_retried = 'not ready' })
      await page.waitForTimeout(800)
      res.D_sheetAfterRetry = await sheetLoaded(page)
      res.D_chipAfter = await chip(page)
    }
    res.D_errors = errors
    await ctx.close()
  }
  }

  // E) a second import straight after the first: both papers complete, each page lands in its own paper
  {
    const { ctx, page, errors } = await setup(browser, url)
    const copy = path.join(path.dirname(pdf4), 'paper4_copy.pdf')
    fs.copyFileSync(pdf4, copy)
    await chooseFile(page, pdf4)
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.marks || '[]').filter((x) => x.name === 'nova-pdf-parsed').length > 0, null, { timeout: 60000 })
    await page.locator('input[type=file][accept*=pdf]').first().setInputFiles(copy).catch(async () => {
      // inside a notebook the import lives in the menu's hidden input
      await page.locator('input[type=file][accept*="pdf"]').last().setInputFiles(copy)
    })
    await page.waitForFunction(() => JSON.parse(document.documentElement.dataset.marks || '[]').filter((x) => x.name === 'nova-page-ready').length >= 8, null, { timeout: 120000 }).catch(() => {})
    await page.waitForTimeout(4000) // let the debounced autosave write the notebook
    res.E_pagesReady = (await marks(page)).filter((m) => m.name === 'nova-page-ready').length
    res.E_titles = await page.evaluate(async () => {
      const dbs = await indexedDB.databases()
      const name = dbs.map((d) => d.name).find((n) => n && n.startsWith('nova'))
      const db = await new Promise((r, j) => { const q = indexedDB.open(name); q.onsuccess = () => r(q.result); q.onerror = j })
      const all = await new Promise((r) => { const q = db.transaction('notebooks').objectStore('notebooks').getAll(); q.onsuccess = () => r(q.result) })
      return all.map((d) => Object.values(d.pages).filter((p) => p.source).map((p) => `${p.title}:${p.bgState ?? 'ready'}`).sort())
    })
    res.E_errors = errors
    await ctx.close()
  }
  console.log(JSON.stringify(res, null, 1))
  await browser.close()
})()
