// Pen responsiveness: every pointermove -> next rendered frame, plus scripted gesture wall time (what "319 ms" was).
// Headless Chrome with synthetic mouse input (EMULATED device); the recognize delay below is EMULATED (route holds 8 s).
const L = require('./lib.cjs')
const fs = require('node:fs'); const path = require('node:path')
;(async () => {
  const b = await L.launch(); const out = {}
  for (const cpu of [1, 4]) {
    const { ctx, page } = await L.open(b, { cpu })
    await L.newNotebook(page); await L.assist(page, true)
    const stroke = async (y) => { const s0 = await L.now(page); const g = Date.now(); await L.stroke(page, Array.from({ length: 40 }, (_, k) => [700 + k * 6, y + (k % 2) * 4])); const gesture = Date.now() - g; await page.waitForTimeout(400); return { gesture_ms: gesture, ...(await L.inputLatency(page, s0)) } }
    const idle = []; for (let i = 0; i < 3; i++) idle.push(await stroke(500 + i * 40))
    await page.route('**/api/v1/recognize', async (route) => { await new Promise((r) => setTimeout(r, 8000)); return route.continue() })
    await L.draw(page, '2 + 2 =', 140, 160, 52, 15)
    await page.waitForTimeout(2500)
    const inflight = await page.evaluate(() => !!document.querySelector('.readback.pending, .reading, [data-reading=pending]'))
    const during = []; for (let i = 0; i < 3; i++) during.push(await stroke(700 + i * 40))
    await page.unroute('**/api/v1/recognize')
    out['cpu' + cpu] = { idle, duringRecognizeRequest: during, requestStillPendingWhenDrawing: inflight }
    console.error(cpu, JSON.stringify(out['cpu' + cpu]))
    await ctx.close()
  }
  fs.writeFileSync(path.join(L.OUT, 'e_input.json'), JSON.stringify(out, null, 1))
  await b.close()
})()
