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
await new Promise((resolve) => server.listen(4173, resolve))

const now = new Date().toISOString()
const iso = (offsetMin = 0) => new Date(Date.now() - offsetMin * 60000).toISOString()
const state = {
  schemaVersion: 6,
  revision: 1,
  clientId: 'verify-client',
  updatedAt: now,
  projects: {
    'p-ai': { id: 'p-ai', name: 'AIC', description: 'workspace AI Control', color: 'project-work', parentId: null, layout: 'board', order: 0, isFavorite: false, isArchived: false, createdAt: now, updatedAt: now },
  },
  sections: {
    's-todo': { id: 's-todo', projectId: 'p-ai', name: 'To do', order: 0, isCollapsed: false, createdAt: now, updatedAt: now },
    's-wip': { id: 's-wip', projectId: 'p-ai', name: 'In Progress', order: 1, isCollapsed: false, createdAt: now, updatedAt: now },
    's-done': { id: 's-done', projectId: 'p-ai', name: 'Finished', order: 2, isCollapsed: false, createdAt: now, updatedAt: now },
  },
  filters: {},
  tasks: {
    't-press': { id: 't-press', content: 'press', description: 'press line\n— update 09:10 — build green', projectId: 'p-ai', sectionId: 's-todo', parentId: null, priority: 2, due: null, completedAt: null, completionContext: null, order: 0, createdAt: now, updatedAt: iso(30) },
    't-work': { id: 't-work', content: 'work', description: 'work line', projectId: 'p-ai', sectionId: 's-todo', parentId: null, priority: 2, due: null, completedAt: null, completionContext: null, order: 1, createdAt: now, updatedAt: iso(40) },
    't-wip': { id: 't-wip', content: 'Big session in flight', description: 'long running session\n— update 10:00 — step done', projectId: 'p-ai', sectionId: 's-wip', parentId: null, priority: 1, due: null, completedAt: null, completionContext: null, order: 0, createdAt: now, updatedAt: iso(5) },
    't-ccz': { id: 't-ccz', content: 'ccz', description: 'done', projectId: 'p-ai', sectionId: 's-done', parentId: null, priority: 3, due: null, completedAt: now, completionContext: null, order: 0, createdAt: now, updatedAt: iso(60) },
    't-ins': { id: 't-ins', content: 'Ins', description: 'done too', projectId: 'p-ai', sectionId: 's-done', parentId: null, priority: 3, due: null, completedAt: now, completionContext: null, order: 1, createdAt: now, updatedAt: iso(70) },
  },
  orderItems: {},
  notes: {},
  diaryEntries: {},
  reminders: {},
  preferences: { inboxProjectId: 'p-inbox', activeProjectId: null, onboardingDismissed: true, theme: 'system', showCompleted: true },
  undoStack: [],
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1320, height: 900 } })
await page.addInitScript(([key, value]) => localStorage.setItem(key, value), ['todoist-replica.state', JSON.stringify(state)])
const errors = []
page.on('pageerror', (err) => errors.push(String(err)))
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

await page.goto('http://localhost:4173/')
await page.getByRole('button', { name: /Control Panel/ }).first().click()
await page.waitForSelector('.control-board')
await page.screenshot({ path: 'verify-layout-control-board.png', fullPage: true })

// Bounding-box proof: every action button inside its row card.
const rows = await page.$$eval('.control-board__row', (els) => els.map((el) => {
  const rowRect = el.getBoundingClientRect()
  const buttons = [...el.querySelectorAll('.control-board__row-actions .control-card__action')].map((b) => {
    const r = b.getBoundingClientRect()
    return { text: b.textContent.trim(), x: r.x, y: r.y, right: r.right, bottom: r.bottom }
  })
  return { row: { x: rowRect.x, y: rowRect.y, right: rowRect.right, bottom: rowRect.bottom }, buttons }
}))
let failures = []
for (const row of rows) {
  for (const b of row.buttons) {
    if (b.x < row.row.x || b.right > row.row.right || b.y < row.row.y || b.bottom > row.row.bottom + 0.5) {
      failures.push(`button "${b.text}" outside row: btn(${b.x},${b.y},${b.right},${b.bottom}) row(${row.row.x},${row.row.y},${row.row.right},${row.row.bottom})`)
    }
  }
}
const cols = await page.$$eval('.control-board__column', (els) => els.map((el) => Math.round(el.getBoundingClientRect().width)))
console.log('COLUMNS:', cols.join(', '))

// Hover proof: card surfaces must stay BLACK (the --surface family), never a
// grey like #1f2937/#2x/#3x. Evidence shots: hover-grey-before.png (pre-fix)
// / hover-black-after.png (post-fix), selected via HOVER_SHOT env.
// Reproducing the user-visible regression: the shipped release bundle
// (app.asar, older CSS) lacks both the dark "[data-theme] .app-shell *:hover
// -> #000" guard and any .control-board hover rule, and its light-theme
// hover fills paint var(--surface-hover) on hover. Emulate that world: strip
// data-theme (no guard rules) and inject the legacy light-token hover fill.
await page.addStyleTag({ content: ':root { --surface: #1f2937 !important; --surface-hover: #1f2937 !important; } .control-board__row:hover, .control-card:hover { background: var(--surface-hover) !important; }' })
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
const hoverShot = process.env.HOVER_SHOT || 'verify/hover-black-after.png'
const isBlackSurface = (rgb) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb)
  if (!m) return false
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return r <= 24 && g <= 24 && b <= 32
}
const hoverFailures = []
const hoverTargets = ['.control-board__row', '.control-card']
for (const selector of hoverTargets) {
  const el = page.locator(selector).first()
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"))
  await el.scrollIntoViewIfNeeded()
  await el.hover()
  await page.waitForTimeout(250)
  const bg = await el.evaluate((node) => getComputedStyle(node).backgroundColor)
  const ok = isBlackSurface(bg)
  console.log(`HOVER ${selector}: background ${bg} -> ${ok ? 'PASS (black)' : 'FAIL (grey)'}`)
  if (!ok) hoverFailures.push(`${selector} hover background ${bg} is not a black surface`)
}
await page.locator(hoverTargets[0]).first().hover()
await page.waitForTimeout(250)
await page.screenshot({ path: hoverShot, fullPage: false })

// Per-column "+ Add task" flow: create a task inside the To do column.
const addTriggersBefore = await page.$$eval('.control-board__add-trigger', (els) => els.length)
console.log('ADD TRIGGERS PER BOARD:', addTriggersBefore, addTriggersBefore === 3 ? 'PASS' : 'FAIL')
if (addTriggersBefore !== 3) hoverFailures.push(`expected 3 add-task triggers, found ${addTriggersBefore}`)
await page.locator('.control-board__column--todo .control-board__add-trigger').click()
await page.locator('.control-board__column--todo .control-board__add-input').fill('Harness per-column task')
await page.locator('.control-board__column--todo .control-board__add-input').press('Enter')
await page.waitForTimeout(300)
const todoText = await page.locator('.control-board__column--todo').innerText()
const addFlowOk = todoText.includes('Harness per-column task')
console.log('ADD TASK IN TO DO:', addFlowOk ? 'PASS' : 'FAIL')
if (!addFlowOk) hoverFailures.push('created task did not appear in the To do column')
const addTriggersAfter = await page.$$eval('.control-board__add-trigger', (els) => els.length)
console.log('COMPOSER COLLAPSED AFTER ADD:', addTriggersAfter, addTriggersAfter === 3 ? 'PASS' : 'FAIL')
if (addTriggersAfter !== 3) hoverFailures.push(`composer did not collapse (triggers after add: ${addTriggersAfter})`)

failures.push(...hoverFailures)
console.log('ROW BUTTONS CHECK:', failures.length ? 'FAIL' : 'PASS')
for (const f of failures) console.log(' -', f)
console.log('PAGE ERRORS:', errors.length ? errors.join(' | ') : 'none')
mkdirSync('verify', { recursive: true })
writeFileSync('verify/layout-verify-result.json', JSON.stringify({ cols, failures, errors }, null, 2))
await browser.close()
server.close()
