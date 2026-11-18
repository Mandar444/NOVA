// Journey B in detail: open page 3 while page 1 is still being drawn; which page is drawn next?
const { chromium } = require('C:/Users/smand/.vscode/extensions/danielsanmedium.dscodegpt-3.24.81/standalone/node_modules/patchright')

;(async () => {
  const [url, pdf] = process.argv.slice(2)
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1366, height: 860 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    const orig = performance.mark.bind(performance)
    performance.mark = (name, opts) => {
      const m = orig(name, opts)
      const d = document.documentElement; const a = JSON.parse(d.dataset.marks || '[]'); a.push({ name, t: Math.round(m.startTime), detail: (opts && opts.detail) || {} }); d.dataset.marks = JSON.stringify(a)
      return m
    }
  })
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  if (await page.getByRole('textbox').count()) { await page.getByRole('textbox').first().fill('B QA'); await page.keyboard.press('Enter'); await page.waitForTimeout(3000) }
  const marks = () => page.evaluate(() => JSON.parse(document.documentElement.dataset.marks || '[]'))
  const nb = page.locator('.nb-card.add').first()
  if (!(await page.locator('[data-testid=workspace]').count())) await page.getByRole('button', { name: /New notebook/ }).first().click()
  await page.waitForSelector('[data-testid=workspace]', { timeout: 30000 })
  const pb = page.getByRole('button', { name: /^Pages$/i }).first()
  if (await pb.count()) await pb.click()
  await page.waitForTimeout(500)
  await page.locator('input[type=file][accept*=pdf]').last().setInputFiles(pdf)
  await page.locator('[class*=rail] button', { hasText: '· 3' }).first().waitFor({ timeout: 60000 })
  const out = {}
  // what can open a page? list the page-rail controls
  out.pagesButton = await page.getByRole('button', { name: /pages/i }).count()
  out.railItems = await page.evaluate(() => [...document.querySelectorAll('.pages-rail button, .rail button, [class*=rail] button')].map((b) => b.textContent.trim().slice(0, 30)).slice(0, 8))
  const target = page.locator('[class*=rail] button', { hasText: '· 3' }).first()
  out.targetFound = await target.count()
  if (out.targetFound) await target.click()
  out.clickedAt = (await marks()).length
  await page.waitForTimeout(400)
  out.headerAfterClick = await page.evaluate(() => (document.querySelector('header')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 120))
  await page.waitForFunction(() => (JSON.parse(document.documentElement.dataset.marks || '[]').filter((m) => m.name === 'nova-page-ready').length >= 4), null, { timeout: 60000 }).catch(() => {})
  out.readyOrder = (await marks()).filter((m) => m.name === 'nova-page-ready').map((m) => m.detail.index + 1)
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
})()
