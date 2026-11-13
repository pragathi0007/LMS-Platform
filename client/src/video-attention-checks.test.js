import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAttentionCheckSchedule } from './video-attention-checks.js'

test('attention check intervals between questions stay within configured bounds', () => {
  const duration = 180
  const schedule = createAttentionCheckSchedule(duration, 3, 30, 60, () => 0.5)
  const intervals = [schedule[0], ...schedule.slice(1).map((position, index) => position - schedule[index])]

  assert.equal(schedule.length, 3)
  assert.ok(intervals.every((interval) => interval >= 30 && interval <= 60))
})

test('a single attention check fits in a longer video when its first interval is valid', () => {
  const schedule = createAttentionCheckSchedule(190, 1, 30, 75, () => 0.5)

  assert.deepEqual(schedule, [52.5])
})

test('attention check scheduling rejects video durations that cannot fit all intervals', () => {
  assert.throws(
    () => createAttentionCheckSchedule(39, 2, 20, 40),
    /cannot fit the configured attention checks/i,
  )
})
