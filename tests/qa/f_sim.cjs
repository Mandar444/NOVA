// SIMULATED failure / control-flow tests. The real app build (preview :5190) talks to a backend (:8012) whose provider is
// fake_provider.py (:8013): readings, paper questions and tutor replies are scripted. No live model.
// One case per run: node f_sim.cjs <session|busy|unreachable|timeout|stop|supersede|edit|pageswitch|dupes>
const L = require('./lib.cjs')
const path = require('node:path')
const fs = require('node:fs')
const PDF = path.join(__dirname, '..', 'real4.pdf')
const FAKE = 'http://127.0.0.1:8013'
const which = process.argv[2]

const control = (body) => fetch(FAKE + '/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
const fakeLog = () => fetch(FAKE + '/log').then((r) => r.json())
const bubbles = (page) => page.evaluate(() => [...document.querySelectorAll('.ask-panel .bubble')].map((b) => ({ cls: b.className.replace('bubble', '').trim(), text: (b.firstChild?.textContent ?? b.textContent).trim().slice(0, 160) })))
const thinking = (page) => page.evaluate(() => !!document.querySelector('.bubble.thinking'))
const curPage = async (page) => { const d = (await L.savedDocs(page))[0]; return d.pages.find((x) => x.id === d.last) }
const simReplies = async (page, re) => (await bubbles(page)).filter((b) => re.test(b.text)).length
const onPage = async (page, re) => { const d = (await L.savedDocs(page))[0]; return d.pages.flatMap((p) => p.tutor).filter((t) => re.test(t)) }

async function setup(browser) {
  const s = await L.open(browser)
  await s.page.route('**/api/v1/**', async (route) => {
    const u = new URL(route.request().url())
    try {
      const resp = await route.fetch({ url: 'http://127.0.0.1:8012' + u.pathname + u.search, timeout: 0 })
      await route.fulfill({ response: resp })
    } catch { /* the app aborted the request (Stop / superseded / page changed) */ }
  })
  await control({ readings: [], clearLog: true })
  return s
}
async function problemPage(page, reading = '3x + 2 = 11') {
  await L.newNotebook(page)
  await L.assist(page, true)
  await control({ readings: [reading] })
  await L.draw(page, '3x + 2 = 11', 120, 90, 50, 3)
  const ok = await L.waitReadback(page, reading.replace(/\s+/g, ''), 30000)
  await page.waitForTimeout(2500)
  return ok
}
async function askAndWait(page, q, ms) {
  const n = await L.tutorCount(page)
  const t = Date.now()
  await L.ask(page, q)
  await L.waitFor(page, (k) => document.querySelectorAll('.ask-panel .bubble.tutor:not(.thinking)').length > k && !document.querySelector('.bubble.thinking'), n, ms)
  return (Date.now() - t) / 1000
}
async function stopNova(page) {
  const link = page.locator('button.link', { hasText: /^Stop$/ }).first()
  if (await link.count() && await link.isVisible()) return link.click()
  return page.getByRole('button', { name: 'Stop NOVA' }).first().click()
}

async function underQuestion(page, number, dyPage) {
  // screen position just under a printed question (its bounds are saved with the test), in workspace coordinates
  const q = await page.evaluate(async (n) => {
    const dbs = await indexedDB.databases(); const name = dbs.map((d) => d.name).find((x) => x && x.startsWith('nova'))
    const db = await new Promise((r) => { const o = indexedDB.open(name); o.onsuccess = () => r(o.result) })
    const all = await new Promise((r) => { const o = db.transaction('notebooks').objectStore('notebooks').getAll(); o.onsuccess = () => r(o.result) })
    const d = all.sort((a, b) => b.notebook.updatedAt - a.notebook.updatedAt)[0]
    const t = Object.values(d.tests || {})[0]
    return t?.questions.find((x) => x.number === n)?.bounds ?? null
  }, number)
  const m = await page.evaluate(() => (document.querySelector('.page-transform').style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/) || []).slice(1).map(Number))
  return q ? { x: (q.x + 40) * m[2] + m[0], y: (q.y + q.h + dyPage) * m[2] + m[1], q } : null
}
;(async () => {
  const browser = await L.launch()
  const { page, log } = await setup(browser)
  const r = { case: which, label: 'SIMULATED provider (fake_provider.py); real app, real backend code', at: new Date().toISOString() }
  try {
    if (which === 'session') {
      await L.newNotebook(page)
      await L.assist(page, true)
      const nb = (await L.savedDocs(page))[0].id
      let t = Date.now()
      await page.locator('input[type=file][accept*=pdf]').last().setInputFiles(PDF)
      r.importVisible = await L.waitFor(page, () => { const i = document.querySelector('img.sheet-img'); return i && i.complete && i.naturalWidth > 0 }, null, 60000)
      r.questionsFound = await L.waitFor(page, () => /NOVA found|found no questions|could not read/i.test(document.body.innerText), null, 60000)
      r.import_s = (Date.now() - t) / 1000
      r.toast = await page.evaluate(() => (document.body.innerText.match(/NOVA (found|could not)[^\n]*/i) || [''])[0].slice(0, 100))
      // write: one line in the right margin beside question 1
      await control({ readings: ['7/75 = 7/(3 × 5²)'] })
      await page.waitForTimeout(3000) // autosave of the found questions
      let at1 = await underQuestion(page, '1', 8)
      for (let k = 0; k < 6 && at1 && at1.y > 520; k++) { // bring question 1 into view
        const b = await L.ws(page); await page.mouse.move(b.x + 500, b.y + 400); await page.mouse.wheel(0, Math.min(400, at1.y - 300)); await page.waitForTimeout(400)
        at1 = await underQuestion(page, '1', 8)
      }
      r.q1Screen = at1 && { x: Math.round(at1.x), y: Math.round(at1.y) }
      r.q1Bounds = at1?.q
      await L.draw(page, '7 / 75', at1.x, at1.y, 40, 3)
      r.write1 = await L.waitReadback(page, '7/75=7/(3*5^2)', 30000)
      await page.waitForTimeout(2500)
      r.ask1_s = await askAndWait(page, 'How do I start?', 30000)
      r.ask1 = { reply: (await bubbles(page)).slice(-1)[0], sent: log.requests.filter((q) => q.path === 'tutor').slice(-1)[0] }
      // revise: a second line, ask again
      await control({ readings: ['75 = 3 × 5 × 5'] })
      const at2 = await underQuestion(page, '1', 8) // the revision goes on the same answer line, to the right
      await L.draw(page, '75 = 3 x 25', at2.x + 420, at2.y, 40, 5)
      r.write2 = await L.waitReadback(page, '75=3*5*5', 30000)
      await page.waitForTimeout(2500)
      r.ask2_s = await askAndWait(page, 'What next?', 30000)
      r.ask2 = { reply: (await bubbles(page)).slice(-1)[0], sent: log.requests.filter((q) => q.path === 'tutor').slice(-1)[0] }
      await page.waitForTimeout(2500) // debounced autosave
      const snap = (d) => ({ pages: d.pages.length, bg: d.pages.map((p) => p.bg).join(','), strokes: d.pages.map((p) => p.strokes), readings: d.pages.flatMap((p) => p.regions.map((x) => x.reading?.text)).filter(Boolean), history: d.pages.map((p) => p.history.length), tutor: d.pages.map((p) => p.tutor.length), tests: d.tests, last: d.last })
      r.beforeClose = snap((await L.savedDocs(page)).find((d) => d.id === nb))
      const dupes = (await L.savedDocs(page)).find((d) => d.id === nb).pages.flatMap((p) => p.tutor)
      r.duplicateAnnotations = dupes.filter((x, i) => dupes.indexOf(x) !== i)
      // close, reload the app, reopen
      await page.getByRole('button', { name: 'Notebooks' }).first().click()
      await page.waitForTimeout(1500)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      r.reopenedDirectly = (await page.locator('[data-testid=workspace]').count()) > 0 // the app reopens the last notebook
      if (!r.reopenedDirectly) await page.locator('.nb-card:not(.add)').first().click()
      await page.waitForSelector('[data-testid=workspace]')
      await page.waitForTimeout(3000)
      r.afterReopen = snap((await L.savedDocs(page)).find((d) => d.id === nb))
      r.identicalAfterReopen = JSON.stringify(r.beforeClose) === JSON.stringify(r.afterReopen)
      r.readbacksShown = (await L.readbacks(page)).map((x) => x.text)
      r.sheetShown = await page.evaluate(() => { const i = document.querySelector('img.sheet-img'); return !!(i && i.complete && i.naturalWidth) })
      await L.shot(page, 'sim_session')
    } else {
      r.problemRead = await problemPage(page)
      const strokes0 = (await curPage(page)).strokes
      if (which === 'busy' || which === 'unreachable') {
        const q = which === 'busy' ? 'FAIL503 help me' : 'CUT help me'
        const t = Date.now()
        await L.ask(page, q)
        await L.waitFor(page, () => !document.querySelector('.bubble.thinking') && !!document.querySelector('.ask-panel .bubble.error, .ask-panel .bubble.notice'), null, 30000)
        r.secondsToMessage = (Date.now() - t) / 1000
        r.shown = (await bubbles(page)).slice(-1)[0]
        r.retryButton = await page.locator('.ask-panel button', { hasText: /retry|try again/i }).count()
        await L.stroke(page, [[700, 600], [740, 610], [780, 600]])
        await page.waitForTimeout(1500)
        r.inkKept = (await curPage(page)).strokes === strokes0 + 1
      }
      if (which === 'timeout') {
        const t = Date.now()
        const lt0 = await L.now(page)
        await L.ask(page, 'SLOW200 help me')
        // the notebook stays usable during the wait: pointer moves over the page (no ink: ink would stop the question by
        // design, tested in 'edit'), and Stop is offered
        r.duringWait = []
        const b = await L.ws(page)
        for (const at of [5, 40, 80]) {
          while ((Date.now() - t) / 1000 < at) await page.waitForTimeout(500)
          for (let k = 0; k < 20; k++) await page.mouse.move(b.x + 600 + k * 8, b.y + 500 + (k % 2) * 6)
          r.duringWait.push({ at, waiting: await thinking(page), stopOffered: await page.getByRole('button', { name: 'Stop NOVA' }).count() + await page.locator('button.link', { hasText: /^Stop$/ }).count() })
        }
        r.inputDuringWait = await L.inputLatency(page, lt0)
        await L.waitFor(page, () => !document.querySelector('.bubble.thinking'), null, 130000)
        r.secondsToMessage = (Date.now() - t) / 1000
        r.shown = (await bubbles(page)).slice(-1)[0]
        await L.stroke(page, [[700, 600], [740, 610], [780, 600]])
        r.inkAfter = (await curPage(page)).strokes === strokes0 + 1
        while ((Date.now() - t) / 1000 < 205) await page.waitForTimeout(1000) // the provider's late answer arrives at 200 s
        r.lateReplyShown = await simReplies(page, /SIM-REPLY to: SLOW200/)
        r.lateNoteOnPage = (await onPage(page, /SLOW200/)).length
      }
      if (which === 'stop') {
        await L.ask(page, 'SLOW30 help me')
        await page.waitForTimeout(3000)
        const t = Date.now()
        await stopNova(page)
        r.idleAfterStop = await L.waitFor(page, () => !document.querySelector('.bubble.thinking'), null, 10000)
        r.msToIdle = Date.now() - t
        await L.stroke(page, [[700, 600], [740, 610], [780, 600]])
        await page.waitForTimeout(1500)
        r.writableAfterStop = (await curPage(page)).strokes === strokes0 + 1
        await page.waitForTimeout(32000)
        r.lateReplyShown = await simReplies(page, /SIM-REPLY to: SLOW30/)
        r.lateNoteOnPage = (await onPage(page, /SLOW30/)).length
      }
      if (which === 'supersede') {
        await L.ask(page, 'first SLOW30 question')
        await page.waitForTimeout(3000)
        r.sendEnabledWhileBusy = await page.locator('.ask-panel button[aria-label=Send]').isEnabled().catch(() => null)
        await L.ask(page, 'second question')
        r.secondShown = await L.waitFor(page, () => [...document.querySelectorAll('.ask-panel .bubble.tutor')].some((b) => /SIM-REPLY to: second/.test(b.textContent)), null, 20000)
        await page.waitForTimeout(32000)
        r.firstReplyShown = await simReplies(page, /SIM-REPLY to: first/)
        r.firstNoteOnPage = (await onPage(page, /first/)).length
        r.chat = (await bubbles(page)).map((b) => b.cls + ': ' + b.text.slice(0, 60))
      }
      if (which === 'edit') {
        await L.ask(page, 'SLOW30 help me')
        await page.waitForTimeout(3000)
        await L.stroke(page, [[700, 600], [740, 610], [780, 600]])
        await page.waitForTimeout(800)
        r.notice = await page.evaluate(() => document.body.innerText.match(/Your page changed[^\n]*/)?.[0] || null)
        r.stillThinking = await thinking(page)
        await page.waitForTimeout(32000)
        r.lateReplyShown = await simReplies(page, /SIM-REPLY to: SLOW30/)
        r.lateNoteOnPage = (await onPage(page, /SLOW30/)).length
        r.inkKept = (await curPage(page)).strokes >= strokes0 + 1
      }
      if (which === 'pageswitch') {
        const first = (await L.savedDocs(page))[0].last
        await L.ask(page, 'SLOW30 help me')
        await page.waitForTimeout(3000)
        // go to a new page while the reply is pending
        const add = page.getByRole('button', { name: /Add page|New page/i }).first()
        if (await add.count()) await add.click()
        else { await page.getByRole('button', { name: /^Pages$/ }).first().click(); await page.waitForTimeout(300); await page.getByRole('button', { name: /Add page|New page/i }).first().click() }
        await page.waitForTimeout(1000)
        r.switched = (await L.savedDocs(page))[0].last !== first
        await page.waitForTimeout(32000)
        r.lateReplyShown = await simReplies(page, /SIM-REPLY to: SLOW30/)
        r.lateNoteOnAnyPage = (await onPage(page, /SLOW30/)).length
        const d = (await L.savedDocs(page))[0]
        r.firstPageStrokes = d.pages.find((p) => p.id === first).strokes
        r.firstPageHistory = d.pages.find((p) => p.id === first).history
      }
      if (which === 'dupes') {
        for (const q of ['How do I start?', 'And then?', 'Explain why']) await askAndWait(page, q, 20000)
        await page.waitForTimeout(2500)
        const p = await curPage(page)
        r.activeNovaObjects = p.tutor
        r.liveReplyCards = p.tutor.filter((x) => /SIM-NOTE|SIM-REPLY/.test(x)).length
        r.chatReplies = await simReplies(page, /SIM-REPLY/)
        r.covers = L.covering(p)
      }
    }
  } catch (e) {
    r.error = String(e).slice(0, 300)
  }
  r.fakeProviderLog = (await fakeLog()).slice(-8)
  r.pageErrors = log.errors
  fs.writeFileSync(path.join(L.OUT, `sim_${which}.json`), JSON.stringify(r, null, 1))
  console.log(JSON.stringify(r, null, 1))
  await browser.close()
})()
