const L = require('./lib.cjs')
;(async () => {
  const b = await L.launch()
  const { page } = await L.open(b, { viewport: { width: 1440, height: 900 } })
  const dismiss = async () => { const c = page.getByRole('button', { name: /start writing/i }).first(); if (await c.count()) { await c.click().catch(() => {}); await page.waitForTimeout(400) } }
  await dismiss()
  await L.newNotebook(page)
  await dismiss()
  await L.assist(page, true)
  await L.draw(page, '2x + 5 = 13', 160, 220, 54, 3)
  const ok = await L.waitReadback(page, null, 90000) || await L.waitFor(page, () => !!document.querySelector('.rb-chip'), null, 90000)
  await page.mouse.move(300, 260); await page.waitForTimeout(800)
  await page.screenshot({ path: `${L.OUT}/orbit2_chip.png` })
  const chip = page.locator('.rb-chip').first()
  if (await chip.count()) { await chip.click(); await page.waitForTimeout(500) }
  await page.screenshot({ path: `${L.OUT}/orbit2_card.png` })
  console.log('read', ok, 'chip', await page.locator('.rb-chip, .rb-card').count())
  await b.close()
})()
