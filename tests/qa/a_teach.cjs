// A. Teaching quality through the real UI with the real model. usage: node a_teach.cjs [label]
const L = require('./lib.cjs')
const path = require('node:path')
const fs = require('node:fs')
const PDF = path.join(__dirname, '..', 'real4.pdf')

;(async () => {
  const label = process.argv[2] || 'run'
  const browser = await L.launch()
  const { page, log } = await L.open(browser)
  const ex = []
  const tutorReqs = () => log.requests.filter((r) => r.path === 'tutor')

  async function exchange(name, question, opts = {}) {
    const n = await L.tutorCount(page)
    const k = tutorReqs().length
    const docBefore = (await L.savedDocs(page))[0]
    const pid = docBefore.last
    const tBefore = new Set((docBefore.pages.find((p) => p.id === pid)?.tutor) || [])
    const t = Date.now()
    if (opts.help) await opts.help()
    else await L.ask(page, question)
    const reply = await L.lastTutor(page, n, 130000)
    const secs = (Date.now() - t) / 1000
    await page.waitForTimeout(2500) // annotations placed + autosave
    const doc = (await L.savedDocs(page))[0]
    const pg = doc.pages.find((p) => p.id === pid)
    const req = tutorReqs()[k] || {}
    ex.push({
      case: name, asked: question, seconds: secs,
      sentContext: { intent: req.intent, problem: req.problem, problemConfirmed: req.problemOk, current: req.current, currentConfirmed: req.currentOk, exam: req.exam, historyTurns: req.history },
      reply: reply?.text, detail: reply?.detail,
      newOnPage: (pg?.tutor || []).filter((x) => !tBefore.has(x)),
      covers: L.covering(pg || { regions: [] }),
    })
    console.error(`[${name}] ${secs}s :: ${reply?.text}`)
  }

  async function writeAndRead(text, x, y, seed) {
    await L.draw(page, text, x, y, 50, seed)
    const ok = await L.waitReadback(page, text.replace(/\s+/g, ''), 90000)
    await page.waitForTimeout(7000) // NOVA's own reaction (mark / answer) + autosave
    return ok
  }

  let paperInfo = null
  if (!process.env.SKIP_PAPER) {
  // ---------- part 1: an imported question paper (real CBSE paper, 4 pages)
  await L.newNotebook(page)
  await L.assist(page, true)
  await page.locator('input[type=file][accept*=pdf]').last().setInputFiles(PDF)
  await L.waitFor(page, () => /NOVA found|found no questions|could not read/i.test(document.body.innerText), null, 150000)
  await page.waitForTimeout(3000)
  const paperDoc = (await L.savedDocs(page))[0]
  const q3 = await page.evaluate(async () => {
    const dbs = await indexedDB.databases(); const name = dbs.map((d) => d.name).find((n) => n && n.startsWith('nova'))
    const db = await new Promise((r) => { const q = indexedDB.open(name); q.onsuccess = () => r(q.result) })
    const all = await new Promise((r) => { const q = db.transaction('notebooks').objectStore('notebooks').getAll(); q.onsuccess = () => r(q.result) })
    const d = all.sort((a, b) => b.notebook.updatedAt - a.notebook.updatedAt)[0]
    const t = Object.values(d.tests || {})[0]
    const q = t?.questions.find((x) => /eleventh|AP/i.test(x.text))
    return q ? { number: q.number, text: q.text, bounds: q.bounds, all: t.questions.map((x) => x.number + ': ' + x.text.slice(0, 50)) } : { all: (t?.questions || []).map((x) => x.number) }
  })
  paperInfo = { tests: paperDoc.tests, q3 }

  await exchange('A1 imported question, no working (Ask panel)', 'How do I start?')
  // Help button on that question in the test panel
  const helpQ3 = async () => {
    const row = page.locator('.q-row', { hasText: /eleventh/i }).first()
    if (await page.locator('.ask-panel').count()) await page.locator('.ask-panel button[aria-label*="Close" i]').first().click().catch(() => {})
    await row.locator('button', { hasText: 'Help' }).click()
  }
  if (q3?.bounds) await exchange('A1 imported question, no working (Help on Q' + q3.number + ')', '(Help button)', { help: helpQ3 })

  // the student writes a wrong first step under the question, then asks
  if (q3?.bounds) {
    const m = await page.evaluate(() => (document.querySelector('.page-transform').style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/) || []).slice(1).map(Number))
    const y = (q3.bounds.y + q3.bounds.h + 6) * m[2] + m[1]
    const x = (q3.bounds.x + 40) * m[2] + m[0]
    if (y > 60 && y < 820) {
      await writeAndRead('23 - 27 = 4', x, y, 31)
      await exchange('A2 imported question, wrong step', 'Where did I go wrong?')
    } else ex.push({ case: 'A2 imported (skipped: question off screen)', y })
  }

  }
  // ---------- part 2: handwritten problem and working (fresh notebook)
  await L.newNotebook(page)
  await L.assist(page, true)
  await writeAndRead('2(x + 3) = 14', 120, 90, 3)
  const afterProblem = (await L.savedDocs(page))[0].pages[0]
  await writeAndRead('2x + 3 = 14', 120, 330, 5)
  const afterStep = (await L.savedDocs(page))[0].pages[0]
  await exchange('A2 wrong handwritten step', 'Where did I go wrong?')
  await exchange('A4 still confused', "I still don't understand.")
  await exchange('A5 explain why', 'Explain why, not just what to do.')
  await writeAndRead('2x + 6 = 14', 120, 470, 7)
  await exchange('A3 correct step', 'What next?')
  await exchange('A6 explicit full solution', 'Show me the full worked solution.')
  await writeAndRead('5x - 7 = 18', 120, 760, 9)
  await exchange('A8 switched to another question', 'How do I start this one?')
  await L.shot(page, `a_teach_${label}`)

  const out = { label, paperInfo, autoReactions: { afterProblem: afterProblem.tutor, afterWrongStep: afterStep.tutor }, exchanges: ex, errors: log.errors }
  fs.writeFileSync(path.join(L.OUT, `a_teach_${label}.json`), JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
})()
