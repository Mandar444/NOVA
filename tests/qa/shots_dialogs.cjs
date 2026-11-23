const L = require('./lib.cjs')
;(async () => {
  const b = await L.launch()
  for (const [name, vp, theme] of [['laptop', { width: 1440, height: 900 }, 'light'], ['phone', { width: 390, height: 844 }, 'dark']]) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: theme, hasTouch: name === 'phone' })
    const page = await ctx.newPage()
    await page.goto(L.URL); await page.waitForTimeout(2000)
    await page.screenshot({ path: `${L.OUT}/orbit6_welcome_${name}_${theme}.png` })
    if (await page.getByRole('textbox').count() && !(await page.locator('[data-testid=workspace]').count())) { await page.getByRole('textbox').first().fill('Aarav'); await page.keyboard.press('Enter'); await page.waitForTimeout(2000) }
    await page.screenshot({ path: `${L.OUT}/orbit6_firstrun_${name}_${theme}.png` })
    const c = page.getByRole('button', { name: /start writing/i }).first(); if (await c.count()) { await c.click(); await page.waitForTimeout(400) }
    if (name === 'laptop') { await page.getByRole('button', { name: 'More', exact: true }).first().click(); await page.getByRole('button', { name: /Settings/ }).first().click() }
    else { await page.getByRole('button', { name: 'More tools' }).click(); await page.getByRole('button', { name: 'Settings', exact: true }).click() }
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${L.OUT}/orbit6_settings_${name}_${theme}.png` })
    await ctx.close()
  }
  await b.close(); console.log('done')
})()
