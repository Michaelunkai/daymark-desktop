import assert from 'node:assert/strict'
import { test } from 'node:test'

export function runReminderHarness() {
  const schedules = [
    { id: 'reminder:second', fingerprint: 'second-v1', alertAt: 2_000 },
    { id: 'reminder:first', fingerprint: 'first-v1', alertAt: 1_000 },
  ].sort((left, right) => left.alertAt - right.alertAt)
  const delivered = new Map()
  const accepted = []

  for (const schedule of schedules) {
    if (delivered.get(schedule.id) === schedule.fingerprint) continue
    delivered.set(schedule.id, schedule.fingerprint)
    accepted.push(schedule.id)
  }

  const duplicate = schedules[0]
  if (delivered.get(duplicate.id) !== duplicate.fingerprint) {
    delivered.set(duplicate.id, duplicate.fingerprint)
    accepted.push(duplicate.id)
  }

  return {
    order: schedules.map((schedule) => schedule.id),
    accepted,
    delivered: [...delivered.keys()],
  }
}

test('reminder harness delivers schedules in alert order and accepts each fingerprint once', () => {
  const result = runReminderHarness()
  assert.deepEqual(result.order, ['reminder:first', 'reminder:second'])
  assert.deepEqual(result.accepted, ['reminder:first', 'reminder:second'])
  assert.deepEqual(result.delivered, ['reminder:first', 'reminder:second'])
})

test('reminder harness permits a changed fingerprint to be delivered again', () => {
  const delivered = new Map([['reminder:first', 'first-v1']])
  const next = { id: 'reminder:first', fingerprint: 'first-v2' }
  const accepted = []
  if (delivered.get(next.id) !== next.fingerprint) {
    delivered.set(next.id, next.fingerprint)
    accepted.push(next.id)
  }
  assert.deepEqual(accepted, ['reminder:first'])
  assert.equal(delivered.get(next.id), 'first-v2')
})
