// Gate C: a complete session, then provider failure / long wait / cancel / stale replies.
// Part 1 uses the REAL model end to end. Part 2 routes only /api/v1/tutor to a second backend (:8012) whose provider is
// the EMULATED fake_provider.py (:8013); reading handwriting still uses the real model.
// usage: node d_session.cjs [1] [2]
const L = require('./lib.cjs')
const path = require('node:path')
const fs = require('node:fs')
const PDF = path.join(__dirname, '..', 'real4.pdf')
const parts = process.argv.slice(2).length ? process.argv.slice(2) : ['1', '2']
const res = {}
const save = () => fs.writeFileSync(path.join(L.OUT, 'd_session.json'), JSON.stringify(res, null, 1))
const bubbles = (page) => page.evaluate(() => [...document.querySelectorAll('.bubble')].map((b) => ({ cls: b.className.replace('bubble', '').trim(), text: (b.firstChild?.textContent ?? b.textContent).trim().slice(0, 140) })))
const busy = (page) => page.evaluate(() => !!document.querySelector('.bubble.thinking'))
const pageStrokes = async (page) => { const d = (await L.savedDocs(page))[0]; const p = d.pages.find((x) => x.id === d.last); return p.strokes }

;(async () => {
  const browser = await L.launch()
  const { page, log } = await L.open(browser)
  const tutorReqs = () => log.requests.filter((r) => r.path === 'tutor')

  if (parts.includes('1')) {
    const r = (res.session = { mode: 'REAL model throughout' })
    await L.newNotebook(page)
    await L.assist(page, true)
    const nbTitle = (await L.savedDocs(page))[0].id
    // import
    let t = Date.now()
    await page.locator('input[type=file][accept*=pdf]').last().setInputFiles(PDF)
    r.import_visible = await L.waitFor(page, () => { const i = document.querySelector('img.sheet-img'); return i && i.complete && i.naturalWidth > 0 }, null, 60000)
    r.import_questions = await L.waitFor(page, () => /NOVA found|found no questions|could not read/i.test(document.body.innerText), null, 150000)
    r.import_s = (Date.now() - t) / 1000
    r.import_toast = await page.evaluate(() => (document.body.innerText.match(/NOVA (found|could not)[^\n]*/i) || [''])[0].slice(0, 100))
    // write under the first question, in the free space at the right of the sheet
    await L.draw(page, '7 / 75', 980, 160, 44, 3)
    r.write1_read = await L.waitReadback(page, '7/75', 90000)
    await page.waitForTimeout(4000)
    // ask
    let n = await L.tutorCount(page)
    t = Date.now()
    await L.ask(page, 'How do I start?')
    const a1 = await L.lastTutor(page, n, 130000)
    r.ask1 = { s: (Date.now() - t) / 1000, reply: a1?.text, exam: tutorReqs().slice(-1)[0]?.exam }
    // revise: a second line, then ask again
    await L.draw(page, '75 = 3 x 25', 980, 260, 44, 5)
    r.write2_read = await L.waitReadback(page, '75=3', 90000)
    await page.waitForTimeout(4000)
    n = await L.tutorCount(page)
    t = Date.now()
    await L.ask(page, 'What next?')
    const a2 = await L.lastTutor(page, n, 130000)
    r.ask2 = { s: (Date.now() - t) / 1000, reply: a2?.text, current: tutorReqs().slice(-1)[0]?.current }
    await page.waitForTimeout(3000)
    const before = (await L.savedDocs(page)).find((d) => d.id === nbTitle)
    const snap = (d) => ({ pages: d.pages.length, strokes: d.pages.map((p) => p.strokes), readings: d.pages.flatMap((p) => p.regions.map((x) => x.reading?.text)).filter(Boolean), history: d.pages.reduce((a, p) => a + p.history.length, 0), tests: d.tests, last: d.last })
    r.beforeClose = snap(before)
    // close and reopen
    await page.getByRole('button', { name: 'Notebooks' }).first().click()
    await page.waitForTimeout(1500)
    await page.reload({ waitUntil: 'domcontentloaded' }) // a fresh app load, as after closing the tab
    await page.waitForTimeout(3000)
    await page.locator('.nb-card:not(.add)').first().click()
    await page.waitForSelector('[data-testid=workspace]')
    await page.waitForTimeout(3000)
    const after = (await L.savedDocs(page)).find((d) => d.id === nbTitle)
    r.afterReopen = snap(after)
    r.same = JSON.stringify(r.beforeClose) === JSON.stringify(r.afterReopen)
    r.readbacksShown = (await L.readbacks(page)).map((x) => x.text)
    r.sheetShown = await page.evaluate(() => { const i = document.querySelector('img.sheet-img'); return !!(i && i.complete && i.naturalWidth) })
    r.errors = log.errors.slice()
    await L.shot(page, 'd_session_reopened')
    console.error('session', JSON.stringify(r)); save()
  }

  if (parts.includes('2')) {
    const r = (res.failures = { mode: 'EMULATED provider (fake_provider.py) for the tutor; real model reads the handwriting' })
    await page.route('**/api/v1/tutor', async (route) => {
      try {
        const resp = await route.fetch({ url: 'http://127.0.0.1:8012/api/v1/tutor', timeout: 0 })
        await route.fulfill({ response: resp })
      } catch { /* the app aborted the request */ }
    })
    if (await page.locator('.ask-panel').count()) await page.locator('.ask-panel button[aria-label*="Close" i]').first().click().catch(() => {})
    await page.getByRole('button', { name: 'Notebooks' }).first().click().catch(() => {})
    await page.waitForTimeout(500)
    await L.newNotebook(page)
    await L.assist(page, true)
    await L.draw(page, '3x + 2 = 11', 120, 90, 50, 3)
    r.problemRead = await L.waitReadback(page, '3x+2=11', 90000)
    await page.waitForTimeout(6000)
    const askAndWait = async (q, ms) => { const n = await L.tutorCount(page); await L.ask(page, q); return L.waitFor(page, (k) => document.querySelectorAll('.bubble.tutor:not(.thinking)').length > k && !document.querySelector('.bubble.thinking'), n, ms) }

    // a) provider says busy (503)
    let t = Date.now()
    await askAndWait('FAIL503 help', 30000)
    r.a_busy = { s: (Date.now() - t) / 1000, last: (await bubbles(page)).slice(-1)[0], retryButton: await page.locator('.ask-panel button', { hasText: /retry|try again/i }).count(), strokes: await pageStrokes(page) }

    // b) a newer question supersedes an older pending one
    const nB = await L.tutorCount(page)
    await L.ask(page, 'first SLOW30 question')
    await page.waitForTimeout(3000)
    await L.ask(page, 'second question')
    await L.waitFor(page, (k) => [...document.querySelectorAll('.bubble.tutor')].some((b) => /FAKE-REPLY to: second/.test(b.textContent)), nB, 30000)
    await page.waitForTimeout(32000) // the first reply has now come back from the provider
    const bb = (await bubbles(page)).map((x) => x.text)
    r.b_supersede = { secondShown: bb.some((x) => /FAKE-REPLY to: second/.test(x)), firstShown: bb.some((x) => /FAKE-REPLY to: first/.test(x)) }

    // c) the page changes while a reply is pending: the stale reply is not applied
    await L.ask(page, 'third SLOW30 question')
    await page.waitForTimeout(3000)
    await L.stroke(page, [[700, 600], [740, 610], [780, 600]])
    await page.waitForTimeout(800)
    const notice = await page.evaluate(() => document.body.innerText.match(/Your page changed[^\n]*/)?.[0] || null)
    await page.waitForTimeout(34000)
    const bc = (await bubbles(page)).map((x) => x.text)
    const objs = (await L.savedDocs(page))[0].pages[0].tutor
    r.c_stale = { notice, thirdShown: bc.some((x) => /FAKE-REPLY to: third/.test(x)), thirdOnPage: objs.some((x) => /third/.test(x)) }

    // d) Stop during a long wait
    await L.ask(page, 'fourth SLOW200 question')
    await page.waitForTimeout(5000)
    const stop = page.getByRole('button', { name: 'Stop NOVA' }).first()
    const stopLink = page.locator('button.link', { hasText: 'Stop' }).first()
    t = Date.now()
    if (await stopLink.count()) await stopLink.click(); else await stop.click()
    const idle = await L.waitFor(page, () => !document.querySelector('.bubble.thinking'), null, 10000)
    r.d_stop = { idle, ms: Date.now() - t }
    const s0 = await pageStrokes(page)
    await L.stroke(page, [[700, 700], [740, 710], [780, 700]])
    await page.waitForTimeout(1500)
    r.d_stop.writableAfterStop = (await pageStrokes(page)) === s0 + 1

    // e) the full long wait: the server gives up at 110 s; the student keeps writing; nothing is lost
    const lt0 = await L.now(page)
    const s1 = await pageStrokes(page)
    t = Date.now()
    const nE = await L.tutorCount(page)
    await L.ask(page, 'fifth SLOW200 question')
    const strokeTimes = []
    for (const at of [10, 60, 100]) {
      while ((Date.now() - t) / 1000 < at) await page.waitForTimeout(500)
      strokeTimes.push({ at, stillWaiting: await busy(page), gesture_ms: await (async () => { const g = Date.now(); await L.stroke(page, [[900, 300 + at], [930, 305 + at], [960, 300 + at]]); return Date.now() - g })() })
    }
    // a stroke edits the page, which (by design) stops the pending answer: record what the student sees
    await page.waitForTimeout(1500)
    r.e_longWait = { strokeTimes, afterStrokes: (await bubbles(page)).slice(-2), input: await L.inputLatency(page, lt0) }
    // and once more without touching the page, to see the server-side timeout reach the student
    t = Date.now()
    await askAndWait('sixth SLOW200 question', 125000)
    r.e_timeout = { s: (Date.now() - t) / 1000, last: (await bubbles(page)).slice(-1)[0], busyAfter: await busy(page) }
    await page.waitForTimeout(2000)
    r.e_strokesKept = (await pageStrokes(page)) - s1
    r.tutorRequests = tutorReqs().slice(-8).map((q) => ({ q: q.question, status: q.status, failed: q.failed, ms: q.doneAt - q.at }))
    r.errors = log.errors
    await L.shot(page, 'd_failures')
    console.error('failures', JSON.stringify(r)); save()
  }
  save()
  console.log(JSON.stringify(res, null, 1))
  await browser.close()
})()
