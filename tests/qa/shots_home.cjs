const L = require('./lib.cjs')
;(async () => {
  const b = await L.launch()
  for (const [name, vp, theme] of [['laptop', { width: 1440, height: 900 }, 'light'], ['phone', { width: 390, height: 844 }, 'dark']]) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: theme, hasTouch: name === 'phone' })
    const page = await ctx.newPage()
    await page.goto(L.URL); await page.waitForTimeout(2000)
    await page.screenshot({ path: `${L.OUT}/orbit5_welcome_${name}_${theme}.png` })
    if (await page.getByRole('textbox').count() && !(await page.locator('[data-testid=workspace]').count())) { await page.getByRole('textbox').first().fill('Aarav'); await page.keyboard.press('Enter'); await page.waitForTimeout(2000) }
    const c = page.getByRole('button', { name: /start writing/i }).first(); if (await c.count()) { await c.click(); await page.waitForTimeout(400) }
    await page.getByRole('button', { name: 'Notebooks' }).first().click(); await page.waitForTimeout(1200)
    await page.screenshot({ path: `${L.OUT}/orbit5_home_${name}_${theme}.png`, fullPage: false })
    await ctx.close()
  }
  await b.close(); console.log('done')
})()
