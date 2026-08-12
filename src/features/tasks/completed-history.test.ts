import assert from 'node:assert/strict'
import test from 'node:test'

import { sortCompletedHistoryNewestFirst } from './completed-history'

test('sorts every completed item newest-first with a deterministic tie-breaker', () => {
  const sorted = sortCompletedHistoryNewestFirst([
    { id: 'first', completedAt: '2026-08-12T10:00:00.000Z' },
    { id: 'latest-b', completedAt: '2026-08-12T12:00:00.000Z' },
    { id: 'latest-a', completedAt: '2026-08-12T12:00:00.000Z' },
    { id: 'legacy', completedAt: null },
  ])

  assert.deepEqual(sorted.map((item) => item.id), ['latest-b', 'latest-a', 'first', 'legacy'])
})
