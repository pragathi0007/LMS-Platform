import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clearStudentNotificationCache,
  fetchStudentNotifications,
  getCachedStudentNotifications,
} from './student-notifications-cache.js'

test('notification cache is user-scoped and shares an in-flight refresh', async () => {
  clearStudentNotificationCache()
  let resolveFetch
  let fetchCount = 0
  const data = { notifications: [{ id: 'notice-1' }], unreadCount: 1 }
  const fetcher = () => {
    fetchCount += 1
    return new Promise((resolve) => { resolveFetch = resolve })
  }

  const firstRequest = fetchStudentNotifications('student-1', fetcher, { forceRefresh: true })
  const secondRequest = fetchStudentNotifications('student-1', fetcher, { forceRefresh: true })
  assert.equal(firstRequest, secondRequest)
  await Promise.resolve()
  assert.equal(fetchCount, 1)

  resolveFetch(data)
  await firstRequest
  assert.deepEqual(getCachedStudentNotifications('student-1'), data)
  assert.equal(getCachedStudentNotifications('student-2'), null)
  clearStudentNotificationCache()
})

test('clearing notifications during a request prevents stale data from being cached', async () => {
  clearStudentNotificationCache()
  let resolveFetch
  const request = fetchStudentNotifications(
    'student-1',
    () => new Promise((resolve) => { resolveFetch = resolve }),
    { forceRefresh: true },
  )
  await Promise.resolve()
  clearStudentNotificationCache('student-1')
  resolveFetch({ notifications: [{ id: 'old-notice' }], unreadCount: 1 })
  await request

  assert.equal(getCachedStudentNotifications('student-1'), null)
  clearStudentNotificationCache()
})
