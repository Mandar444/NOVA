// UI screenshots of the local build (no AI calls needed). usage: node shots_ui.cjs <label>
const L = require('./lib.cjs')
;(async () => {
  const label = process.argv[2] || 'ui'
  const b = await L.launch()
  for (const [name, vp] of [['laptop', { width: 1440, height: 900 }], ['tablet', { width: 1194, height: 834 }], ['phone', { width: 390, height: 844 }]]) {
    for (const theme of ['light', 'dark']) {
      const ctx = await b.newContext({ viewport: vp, colorScheme: theme, deviceScaleFactor: 1, hasTouch: name !== 'laptop' })
      const page = await ctx.newPage()
      await page.goto(L.URL, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2000)
      if (await page.getByRole('textbox').count() && !(await page.locator('[data-testid=workspace]').count())) { await page.getByRole('textbox').first().fill('Aarav'); await page.keyboard.press('Enter'); await page.waitForTimeout(2000) }
      await page.screenshot({ path: `${L.OUT}/${label}_home_${name}_${theme}.png` })
      await L.newNotebook(page).catch(() => {})
      await page.waitForTimeout(800)
      const close = page.getByRole('button', { name: /close|got it|start/i }).first(); if (await close.count()) await close.click().catch(() => {})
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${L.OUT}/${label}_nb_${name}_${theme}.png` })
      await ctx.close()
    }
  }
  await b.close(); console.log('done')
})()
