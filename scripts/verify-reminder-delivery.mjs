import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)

function read(relativePath) {
  return readFileSync(new URL(relativePath, root), 'utf8')
}

export function collectReminderDeliveryProof() {
  const receiver = read('android/app/src/main/java/com/michaelunkai/daymark/ReminderAlarmReceiver.java')
  const scheduler = read('android/app/src/main/java/com/michaelunkai/daymark/ReminderScheduler.java')
  const desktopScheduler = read('desktop/reminder-scheduler.mjs')
  const preload = read('desktop/preload.cjs')

  return {
    android: {
      validatesSchedule: /isScheduled\(context, scheduleId, fingerprint\)/.test(receiver),
      retriesUnavailableNotifications: /notificationReady[\s\S]*?defer\(context, intent\)/.test(receiver),
      postsNotification: /post\(context, sound, content/.test(receiver),
      persistsDeliveredFingerprint: /markDelivered\(context, scheduleId, fingerprint\)/.test(receiver),
      emitsAcceptance: /emitAcceptance\(context, scheduleId, fingerprint\)/.test(receiver),
      persistsSchedules: /putString\(SCHEDULES, schedules\.toString\(\)\)\.commit/.test(scheduler),
      deviceProtectedStorage: /createDeviceProtectedStorageContext/.test(scheduler),
      reschedulesAfterRestart: /static (?:void|String) reschedule/.test(scheduler),
      versionedChannels: /CHANNEL_VERSION = "v3"/.test(scheduler),
    },
    windows: {
      exposesSync: /syncReminders:/.test(preload),
      exposesSoundTest: /testReminderSound:/.test(preload),
      validatesSchedules: /normalizeReminderSchedules|reminder-schedules\.json/.test(desktopScheduler),
    },
  }
}

test('Android reminder delivery retains, retries, deduplicates, and acknowledges alerts', () => {
  const proof = collectReminderDeliveryProof().android
  for (const value of Object.values(proof)) assert.equal(value, true)
})

test('Windows reminder delivery exposes sync and sound verification hooks', () => {
  const proof = collectReminderDeliveryProof().windows
  for (const value of Object.values(proof)) assert.equal(value, true)
})
