import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCompanionContext } from './companion-context.js'

test('buildCompanionContext preserves workspace names and task state', () => {
  const context = buildCompanionContext({
    bridgeVersion: 2,
    projects: [{ name: 'Daymark' }],
    tasks: [
      { title: 'Ship release', projectName: 'Daymark', completed: false, due: '2026-08-05' },
      { title: 'Old task', projectName: 'Inbox', completed: true, due: '' },
    ],
  })

  assert.match(context, /DaymarkAI bridge: v2/)
  assert.match(context, /- Daymark/)
  assert.match(context, /- \[ \] Ship release \| Daymark \| 2026-08-05/)
  assert.match(context, /- \[x\] Old task \| Inbox \| No due date/)
})
