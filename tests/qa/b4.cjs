// B4: erase the last character of a line -> NOVA reads it again. Checked in the saved notebook.
const L = require('./lib.cjs')
;(async () => {
  const browser = await L.launch()
  const { page, log } = await L.open(browser)
  await L.newNotebook(page); await L.assist(page, true)
  await L.draw(page, '5 + 1 = 6', 140, 120, 52, 5)
  await L.waitReadback(page, '5+1=6', 90000); await page.waitForTimeout(5000)
  const before = (await L.savedDocs(page))[0].pages[0]
  // where is the last stroke ("6") on screen? page coords from IndexedDB, view transform from the overlay layer
  const box = await page.evaluate(async () => {
    const dbs = await indexedDB.databases(); const name = dbs.map((d) => d.name).find((n) => n && n.startsWith('nova'))
    const db = await new Promise((r) => { const q = indexedDB.open(name); q.onsuccess = () => r(q.result) })
    const all = await new Promise((r) => { const q = db.transaction('notebooks').objectStore('notebooks').getAll(); q.onsuccess = () => r(q.result) })
    const d = all.sort((a, b) => b.notebook.updatedAt - a.notebook.updatedAt)[0]
    const p = d.pages[d.notebook.lastPageId]
    const s = p.strokes[p.strokes.length - 1]
    const xs = s.points.map((q) => q[0] ?? q.x), ys = s.points.map((q) => q[1] ?? q.y)
    const m = (document.querySelector('.page-transform').style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/) || []).slice(1).map(Number)
    const ws = document.querySelector('[data-testid=workspace]').getBoundingClientRect()
    return { x0: Math.min(...xs) * m[2] + m[0], x1: Math.max(...xs) * m[2] + m[0], y0: Math.min(...ys) * m[2] + m[1], y1: Math.max(...ys) * m[2] + m[1], wsx: ws.x, wsy: ws.y }
  })
  const n = log.requests.filter((r) => r.path === 'recognize').length
  await page.getByRole('button', { name: 'Eraser' }).first().click()
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2
  await L.stroke(page, [[cx - 8, cy - 12], [cx, cy], [cx + 8, cy + 12], [cx, cy + 4], [cx - 4, cy - 4]])
  const erasedAt = Date.now()
  await page.getByRole('button', { name: /^Pen$/ }).first().click().catch(() => {})
  let after
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000)
    after = (await L.savedDocs(page))[0].pages[0]
    if (after.regions[0]?.reading?.fresh && after.strokes < before.strokes) break
  }
  console.log(JSON.stringify({ eraseTarget: box, strokesBefore: before.strokes, strokesAfter: after.strokes, readingAfter: after.regions, secondsToFreshReading: (Date.now() - erasedAt) / 1000, newCalls: log.requests.filter((r) => r.path === 'recognize').slice(n).map((r) => r.region + ':' + r.status), tutor: after.tutor }, null, 1))
  await L.shot(page, 'b4_erase')
  await browser.close()
})()
