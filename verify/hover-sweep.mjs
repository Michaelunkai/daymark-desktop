// Empirical hover sweep: hovers every visible element and verifies the
// painted background (element + ancestor chain up to body) stays in the
// black family. Flags mid-grey fills (the user-visible regression).
// Usage: node verify/hover-sweep.mjs   (expects dist/client build)
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'

const DIST = new URL('../dist/client', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
const server = createServer((req, res) => {
  let path = join(DIST, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0])
  if (!existsSync(path)) path = join(DIST, 'index.html')
  res.setHeader('content-type', MIME[extname(path)] ?? 'application/octet-stream')
  res.end(readFileSync(path))
})
await new Promise((resolve) => server.listen(4174, resolve))

const now = new Date().toISOString()
const iso = (m = 0) => new Date(Date.now() - m * 60000).toISOString()
const state = {
  schemaVersion: 6, revision: 1, clientId: 'verify-client', updatedAt: now,
  projects: { 'p-ai': { id: 'p-ai', name: 'AIC', description: 'workspace AI Control', color: 'project-work', parentId: null, layout: 'board', order: 0, isFavorite: false, isArchived: false, createdAt: now, updatedAt: now } },
  sections: {
    's-todo': { id: 's-todo', projectId: 'p-ai', name: 'To do', order: 0, isCollapsed: false, createdAt: now, updatedAt: now },
    's-wip': { id: 's-wip', projectId: 'p-ai', name: 'In Progress', order: 1, isCollapsed: false, createdAt: now, updatedAt: now },
    's-done': { id: 's-done', projectId: 'p-ai', name: 'Finished', order: 2, isCollapsed: false, createdAt: now, updatedAt: now },
  },
  filters: {},
  tasks: {
    't-press': { id: 't-press', content: 'press', description: 'press line', projectId: 'p-ai', sectionId: 's-todo', parentId: null, priority: 2, due: null, completedAt: null, completionContext: null, order: 0, createdAt: now, updatedAt: iso(30) },
    't-work': { id: 't-work', content: 'work', description: 'work line', projectId: 'p-ai', sectionId: 's-todo', parentId: null, priority: 2, due: null, completedAt: null, completionContext: null, order: 1, createdAt: now, updatedAt: iso(40) },
    't-wip': { id: 't-wip', content: 'Big session in flight', description: 'long running', projectId: 'p-ai', sectionId: 's-wip', parentId: null, priority: 1, due: null, completedAt: null, completionContext: null, order: 0, createdAt: now, updatedAt: iso(5) },
    't-ccz': { id: 't-ccz', content: 'ccz', description: 'done', projectId: 'p-ai', sectionId: 's-done', parentId: null, priority: 3, due: null, completedAt: now, completionContext: null, order: 0, createdAt: now, updatedAt: iso(60) },
  },
  orderItems: {}, notes: {}, diaryEntries: {}, reminders: {},
  preferences: { inboxProjectId: 'p-inbox', activeProjectId: null, onboardingDismissed: true, theme: 'system', showCompleted: true },
  undoStack: [],
}

const ALLOW = new Set(['.brand-mark span']) // deliberate light logo glyph
const isGrey = (bg) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(bg)
  if (!m) return false
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const a = m[4] === undefined ? 1 : Number(m[4])
  if (a < 0.15) return false
  const min = Math.min(r, g, b), max = Math.max(r, g, b)
  return max - min <= 28 && min >= 24 // mid/light neutral grey (incl #1f2937, #e8ecef)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const offenders = []
let hovered = 0

async function sweep(page, view, shot) {
  // Unique visible candidates inside the app shell.
  const targets = await page.evaluate(() => {
    const seen = new Set()
    const out = []
    for (const el of document.querySelectorAll('.app-shell, .app-shell *')) {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.display === 'none' || st.pointerEvents === 'none') continue
      const key = `${el.tagName}.${[...el.classList].join('.')}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, x: r.x + r.width / 2, y: r.y + r.height / 2 })
    }
    return out
  })
  for (const t of targets) {
    await page.mouse.move(t.x, t.y)
    await page.waitForTimeout(140)
    const res = await page.evaluate(({ key, x, y }) => {
      const el = document.elementFromPoint(x, y)
      if (!el) return null
      const chain = []
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const st = getComputedStyle(n)
        const sel = `${n.tagName.toLowerCase()}${[...n.classList].slice(0, 3).map((c) => `.${c}`).join('')}`
        chain.push({ sel, bg: st.backgroundColor, img: st.backgroundImage })
      }
      return { key, chain }
    }, t)
    hovered++
    if (!res) continue
    for (const c of res.chain) {
      if (!isGrey(c.bg)) continue
      const dedupe = `${view}|${c.sel}|${c.bg}`
      if (offenders.some((o) => o.id === dedupe)) break
      offenders.push({ id: dedupe, view, hoverTarget: res.key, selector: c.sel, background: c.bg, viewShot: shot })
      const el = page.locator(res.key.includes('.') ? res.key.split('.').slice(0, 2).join('.') : res.key).first()
      try { await el.screenshot({ path: `verify/hover-grey-${offenders.length}.png`, timeout: 2000 }) } catch {}
      break
    }
  }
}

for (const scheme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 }, colorScheme: scheme })
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['todoist-replica.state', JSON.stringify(state)])
  await page.goto('http://localhost:4174/')
  await page.waitForSelector('.app-shell')
  await page.getByRole('button', { name: /Control Panel/ }).first().click()
  await page.waitForSelector('.control-board')
  await page.mouse.move(0, 0)
  await sweep(page, `control-board(${scheme})`, `hover-grey-before2-${scheme}.png`)
  // General project page via sidebar project row.
  const proj = page.locator('.project-sidebar-item').first()
  if (await proj.count()) {
    await proj.click()
    await page.waitForTimeout(400)
    await page.mouse.move(0, 0)
    await sweep(page, `project-page(${scheme})`, `hover-grey-before2-${scheme}-project.png`)
  }
  // Grid view toggle, if present.
  const grid = page.getByRole('button', { name: /grid/i }).first()
  if (await grid.count()) {
    try { await grid.click(); await page.waitForTimeout(400); await page.mouse.move(0, 0); await sweep(page, `grid-view(${scheme})`, `hover-grey-before2-${scheme}-grid.png`) } catch {}
  }
  if (scheme === 'dark' && offenders.length === 0) {
    const row = page.locator('.sidebar-row').first()
    await row.hover()
    await page.waitForTimeout(200)
    await page.screenshot({ path: 'verify/hover-black-after2.png' })
  }
  if (scheme === 'light' && offenders.length > 0) {
    await page.screenshot({ path: 'verify/hover-grey-before2.png' })
  }
  await page.close()
}
mkdirSync('verify', { recursive: true })
writeFileSync('verify/hover-sweep.json', JSON.stringify({ hovered, offenderCount: offenders.length, offenders }, null, 2))
console.log(`HOVERED ${hovered} elements — OFFENDERS: ${offenders.length}`)
for (const o of offenders) console.log(` - [${o.view}] hover ${o.hoverTarget} -> ${o.selector} bg ${o.background}`)
await browser.close()
server.close()
