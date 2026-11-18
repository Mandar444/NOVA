// B. Automatic handwriting: write -> pause -> read -> readback, with Assist on and no Read clicks. Real model.
const L = require('./lib.cjs')

;(async () => {
  const browser = await L.launch()
  const { page, log, ctx } = await L.open(browser)
  const res = {}
  await L.newNotebook(page)
  await L.assist(page, true)
  const recog = (from = 0) => log.requests.filter((r) => r.path === 'recognize' && r.at >= from)

  // B1 wrong maths, literal; no clicks
  let t = Date.now()
  await L.draw(page, '4 + 2 = 7', 140, 100, 52, 3)
  const penUp = Date.now()
  res.B1_readback = await L.waitReadback(page, '4+2=7', 90000)
  res.B1_penUpToReadback_s = (Date.now() - penUp) / 1000
  await page.waitForTimeout(6000)
  res.B1_readbacks = await L.readbacks(page)
  res.B1_novaMarks = await L.novaInks(page)
  res.B1_recognizeCalls = recog().map((r) => `${r.region}:${r.status ?? 'pending'}:${r.doneAt - r.at}ms`)

  // B2 a second line elsewhere; line 1 must not be read again
  const mark2 = Date.now() - 0
  const n1 = recog().length
  await L.draw(page, '5 + 1 =', 140, 330, 52, 5)
  const penUp2 = Date.now()
  res.B2_readback = await L.waitReadback(page, '5+1=', 90000)
  res.B2_penUpToReadback_s = (Date.now() - penUp2) / 1000
  await page.waitForTimeout(8000)
  const after2 = recog().slice(n1)
  res.B2_newRecognizeCalls = after2.map((r) => r.region)
  res.B2_line1ReadAgain = after2.some((r) => r.region === recog()[0].region)
  res.B2_inks = await L.novaInks(page)

  // B3 edit line 2: extend it with "6" after NOVA's answer area -> read again
  const n2 = recog().length
  await L.draw(page, '6', 470, 330, 52, 9)
  const penUp3 = Date.now()
  await page.waitForTimeout(500)
  res.B3_reread = await L.waitFor(page, (n) => 0, null, 1) // placeholder
  const ok3 = await L.waitReadback(page, '5+1=6', 90000)
  res.B3_readback_5plus1eq6 = ok3
  res.B3_penUpToReadback_s = (Date.now() - penUp3) / 1000
  res.B3_newRecognizeCalls = recog().slice(n2).map((r) => r.region)

  // B4 erase the "6" -> read again
  const n3 = recog().length
  await page.getByRole('button', { name: 'Eraser' }).first().click()
  await L.stroke(page, [[455, 320], [475, 345], [495, 370], [515, 395], [470, 360], [500, 330]])
  await page.getByRole('button', { name: /^Pen$/ }).first().click().catch(() => {})
  const erased = Date.now()
  res.B4_readback_after_erase = await L.waitFor(page, () => [...document.querySelectorAll('.readback')].some((e) => /5\s*\+\s*1\s*=\s*$/.test(e.textContent.trim()) || /5\+1=$/.test(e.textContent.replace(/\s+/g, ''))), null, 90000)
  res.B4_eraseToReadback_s = (Date.now() - erased) / 1000
  res.B4_newRecognizeCalls = recog().slice(n3).map((r) => r.region)
  res.B4_readbacks = await L.readbacks(page)

  // B5 stale: hold the next reading's response 8 s; edit that same line meanwhile; the old reading must not show
  let held = 0
  await page.route('**/api/v1/recognize', async (route) => {
    held++
    if (held === 1) {
      const resp = await route.fetch()
      const body = await resp.text()
      await new Promise((r) => setTimeout(r, 8000))
      return route.fulfill({ response: resp, body })
    }
    return route.continue()
  })
  await page.getByRole('button', { name: /^Pen$/ }).first().click().catch(() => {})
  await L.draw(page, '9 - 3 =', 140, 560, 52, 11)
  await page.waitForTimeout(2500) // pause: reading starts (held)
  const firstHash = recog().slice(-1)[0]?.hash
  await L.draw(page, '1', 430, 560, 52, 13) // edit the same line before the held reply returns -> "9 - 3 = 1"
  const ok5 = await L.waitReadback(page, '9-3=1', 90000)
  await page.waitForTimeout(9000) // the held (stale) reply has now arrived
  res.B5_finalReadbacks = (await L.readbacks(page)).map((r) => r.text)
  res.B5_newReadingShown = ok5
  res.B5_staleShown = res.B5_finalReadbacks.some((t) => /9\s*-\s*3\s*=\s*(6)?$/.test(t))
  res.B5_calls = recog().slice(-3).map((r) => `${r.hash === firstHash ? 'held-old' : 'new'}:${r.status}`)
  await page.unroute('**/api/v1/recognize')

  // B6 responsiveness while a request is in flight: draw a 40-point stroke and time it, vs. idle
  const timeStroke = async (y) => { const s = Date.now(); await L.stroke(page, Array.from({ length: 40 }, (_, k) => [700 + k * 6, y + (k % 2) * 4])); return Date.now() - s }
  res.B6_strokeIdle_ms = await timeStroke(700)
  await page.waitForTimeout(4000)
  await page.route('**/api/v1/recognize', async (route) => { await new Promise((r) => setTimeout(r, 6000)); return route.continue() })
  await L.draw(page, '2 + 2 =', 140, 760, 52, 15)
  await page.waitForTimeout(2200) // reading in flight
  const lt0 = await L.now(page)
  res.B6_strokeDuringRequest_ms = await timeStroke(760)
  res.B6_longTasksDuring = await L.longTasks(page, lt0)
  await page.unroute('**/api/v1/recognize')
  await L.waitReadback(page, '2+2=', 60000)

  res.errors = log.errors
  res.allRecognize = recog().map((r) => ({ region: r.region, ms: r.doneAt - r.at, status: r.status }))
  await L.shot(page, 'b_auto')
  console.log(JSON.stringify(res, null, 1))
  await browser.close()
})()
