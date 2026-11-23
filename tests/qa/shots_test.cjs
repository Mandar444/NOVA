// UI screenshots of the question paper + Test panel. Question finding is SIMULATED (fixed JSON) so no AI is needed.
const L = require('./lib.cjs')
const path = require('node:path')
const Q = { pageIndex: 0, latencyMs: 5, questions: [
  { number: '1', text: 'Write whether the rational number 7/75 will have a terminating decimal expansion or a non-terminating repeating decimal expansion.', lineIds: [], bbox: [60, 600, 940, 640], kind: 'other', options: [], answer: 'non-terminating repeating', answerVerified: false, corrected: false },
  { number: '2', text: 'Find the value(s) of k, if the quadratic equation 3x² − k√3x + 4 = 0 has equal roots.', lineIds: [], bbox: [60, 660, 940, 700], kind: 'numeric', options: [], answer: 'k = ±4', answerVerified: false, corrected: false },
  { number: '3', text: 'Find the eleventh term from the last term of the AP: 27, 23, 19, ..., −65.', lineIds: [], bbox: [60, 720, 940, 760], kind: 'numeric', options: [], answer: '−25', answerVerified: true, corrected: false },
] }
;(async () => {
  const b = await L.launch()
  for (const [name, vp, theme] of [['laptop', { width: 1440, height: 900 }, 'light'], ['tablet', { width: 1194, height: 834 }, 'dark']]) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: theme, hasTouch: name === 'tablet' })
    const page = await ctx.newPage()
    await page.route('**/api/v1/paper/analyze', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Q) }))
    await page.goto(L.URL); await page.waitForTimeout(2000)
    if (await page.getByRole('textbox').count() && !(await page.locator('[data-testid=workspace]').count())) { await page.getByRole('textbox').first().fill('Aarav'); await page.keyboard.press('Enter'); await page.waitForTimeout(2000) }
    const dismiss = async () => { const c = page.getByRole('button', { name: /start writing/i }).first(); if (await c.count()) { await c.click().catch(() => {}); await page.waitForTimeout(400) } }
    await dismiss(); await L.newNotebook(page); await dismiss()
    await page.locator('input[type=file][accept*=pdf]').last().setInputFiles(path.join(__dirname, '..', 'real4.pdf'))
    await L.waitFor(page, () => /NOVA found|found no questions/i.test(document.body.innerText), null, 60000)
    await page.waitForTimeout(1500)
    await page.locator('.tp-q-main').nth(2).click().catch(() => {})
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${L.OUT}/orbit4_test_${name}_${theme}.png` })
    await ctx.close()
  }
  await b.close(); console.log('done')
})()
