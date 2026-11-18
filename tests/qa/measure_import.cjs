// Measures PDF import as a student sees it. usage: node measure_import.cjs <url> <pdf> <label> [cpuSlowdown]
// t0 = file chosen. Reports: first page visible (its printed sheet drawn), first page writable (a stroke lands on it),
// all pages ready, questions found, and main-thread long tasks while the rest prepares.
const { chromium } = require('C:/Users/smand/.vscode/extensions/danielsanmedium.dscodegpt-3.24.81/standalone/node_modules/patchright')
const path = require('node:path')

;(async () => {
  const [url, pdf, label, slow] = process.argv.slice(2)
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1366, height: 860 } })
  const page = await ctx.newPage()
  const out = { label, url }
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
  if (slow) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(slow) }); out.cpuSlowdown = Number(slow) }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2500)
  if (await page.getByRole('textbox').count()) {
    await page.getByRole('textbox').first().fill('Import QA')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2500)
  }
  // long-task recorder (main-thread blocks > 50 ms), started just before the file is chosen
  await page.evaluate(() => {
    const d = document.documentElement
    d.dataset.lt = '[]'
    new PerformanceObserver((l) => {
      const a = JSON.parse(d.dataset.lt)
      for (const e of l.getEntries()) a.push([Math.round(e.startTime), Math.round(e.duration)])
      d.dataset.lt = JSON.stringify(a)
    }).observe({ type: 'longtask', buffered: false })
    d.dataset.t0 = String(performance.now())
  })
  const t0 = Date.now()
  await page.locator('input[type=file][accept*=pdf]').first().setInputFiles(pdf)
  const since = () => (Date.now() - t0) / 1000
  // 1) first page visible: the imported sheet image has decoded
  await page.waitForFunction(() => { const i = document.querySelector('img.sheet-img'); return i && i.complete && i.naturalWidth > 0 }, null, { timeout: 120000, polling: 50 })
    .then(() => { out.firstPageVisible_s = since() }).catch(() => { out.firstPageVisible_s = 'timeout' })
  // 2) first page writable: draw a short stroke on the workspace and see it counted on the page
  const ws = await page.locator('[data-testid=workspace]').boundingBox().catch(() => null)
  if (ws) {
    const before = await page.evaluate(() => document.querySelectorAll('[data-testid=workspace]').length)
    await page.mouse.move(ws.x + ws.width * 0.75, ws.y + 300)
    await page.mouse.down()
    for (let k = 1; k <= 8; k++) await page.mouse.move(ws.x + ws.width * 0.75 + k * 8, ws.y + 300 + (k % 2) * 6)
    await page.mouse.up()
    out.firstPageWritable_s = since()
    out.workspace = before
  }
  // 3) every page prepared, 4) questions found (toast) — whichever the build reports
  const allReady = page.waitForFunction(() => {
    const marks = JSON.parse(document.documentElement.dataset.marks || '[]').filter((x) => x.name === 'nova-page-ready').length + JSON.parse(document.documentElement.dataset.marks || '[]').filter((x) => x.name === 'nova-page-failed').length
    if (marks) return marks >= 4 // new build: every page reports when prepared
    return !/Preparing page|Opening page|Opening the PDF/i.test(document.body.innerText) && !!document.querySelector('img.sheet-img')
  }, null, { timeout: 180000, polling: 100 }).then(() => { out.allPagesReady_s = since() }).catch(() => { out.allPagesReady_s = 'timeout' })
  const found = page.waitForFunction(() => /NOVA found \d+ questions|questions? on this page|NOVA could not/i.test(document.body.innerText), null, { timeout: 180000, polling: 200 })
    .then(async () => { out.questionsFound_s = since(); out.toast = (await page.evaluate(() => (document.body.innerText.match(/NOVA (found|could not)[^\n]*/i) || [''])[0])).slice(0, 120) }).catch(() => { out.questionsFound_s = 'timeout' })
  await Promise.all([allReady, found])
  const lt = await page.evaluate(() => { const t0 = Number(document.documentElement.dataset.t0); return JSON.parse(document.documentElement.dataset.lt).filter(([s]) => s >= t0).map(([s, d]) => d) })
  out.longTasks = { count: lt.length, max_ms: lt.length ? Math.max(...lt) : 0, total_ms: lt.reduce((a, b) => a + b, 0) }
  out.pagesInRail = await page.evaluate(() => (document.body.innerText.match(/· \d/g) || []).length)
  out.errors = errors
  await page.screenshot({ path: path.join(__dirname, `import_${label}.png`) })
  console.log(JSON.stringify(out))
  await browser.close()
})()
