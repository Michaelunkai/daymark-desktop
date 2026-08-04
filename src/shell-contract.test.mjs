import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('./styles/app-shell.css', import.meta.url), 'utf8')

test('global shell exposes the required settings and repository affordances', () => {
  assert.match(app, /SettingsPanel/)
  assert.match(app, /aria-label="Open Daymark on GitHub"/)
  assert.match(app, /https:\/\/github\.com\/Michaelunkai\/daymark-desktop/)
  assert.match(app, /onImport={importBackup}/)
  assert.match(app, /onReset={resetWorkspace}/)
})

test('shell styles include keyboard focus, mobile layout, and dark theme coverage', () => {
  assert.match(styles, /button:focus-visible/)
  assert.match(styles, /\[data-theme="dark"\]/)
  assert.match(styles, /@media \(max-width: 720px\)/)
  assert.match(styles, /\.settings-grid/)
  assert.match(styles, /\.visually-hidden/)
})
