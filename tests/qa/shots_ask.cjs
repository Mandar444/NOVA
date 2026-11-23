const L = require('./lib.cjs')
;(async () => {
  const b = await L.launch()
  for (const [name, vp, theme] of (process.env.ONLY === 'phone' ? [['phone', { width: 390, height: 844 }, 'light']] : [['laptop', { width: 1440, height: 900 }, 'dark'], ['phone', { width: 390, height: 844 }, 'light']])) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: theme, hasTouch: name === 'phone' })
    const page = await ctx.newPage()
    await page.goto(L.URL); await page.waitForTimeout(2000)
    if (await page.getByRole('textbox').count() && !(await page.locator('[data-testid=workspace]').count())) { await page.getByRole('textbox').first().fill('Aarav'); await page.keyboard.press('Enter'); await page.waitForTimeout(2000) }
    const dismiss = async () => { const c = page.getByRole('button', { name: /start writing/i }).first(); if (await c.count()) { await c.click().catch(() => {}); await page.waitForTimeout(400) } }
    await dismiss(); await L.newNotebook(page).catch(async (e) => { await page.screenshot({ path: L.OUT + '/dbg_fail.png' }); console.log(await page.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.getAttribute('aria-label') || x.textContent.trim()).slice(0, 25))); throw e }); await dismiss()
    if (name === 'laptop') await L.assist(page, true)
    else { await page.getByRole('button', { name: 'More tools' }).click(); const off = page.getByRole('button', { name: /Assist: off/ }); if (await off.count()) await off.click(); else await page.keyboard.press('Escape'); const ok = page.getByRole('button', { name: 'Turn on Assist', exact: true }); if (await ok.count()) await ok.click(); await page.waitForTimeout(300) }
    await L.draw(page, '2x + 5 = 13', name === 'phone' ? 30 : 160, 200, name === 'phone' ? 34 : 54, 3)
    await L.waitFor(page, () => !!document.querySelector('.rb-chip, .readback'), null, 90000)
    await page.waitForTimeout(1500)
    await page.locator('.ob-ask').first().click()
    await page.waitForTimeout(500)
    const box = page.locator('.ask-panel textarea'); await box.fill('How do I start?'); await box.press('Enter')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${L.OUT}/orbit3_ask_${name}_${theme}_waiting.png` })
    await L.waitFor(page, () => !document.querySelector('.bubble.thinking'), null, 120000)
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${L.OUT}/orbit3_ask_${name}_${theme}.png` })
    await ctx.close()
  }
  await b.close(); console.log('done')
})()
