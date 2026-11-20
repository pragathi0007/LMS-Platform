const studentNotificationCache = new Map()
const studentNotificationRequests = new Map()
const studentNotificationGenerations = new Map()
const studentNotificationSubscribers = new Map()
const studentNotificationCacheTtlMs = 30_000

export function getCurrentStudentNotificationUserId() {
  try {
    const auth = JSON.parse(sessionStorage.getItem('lms.auth') || 'null')
    return auth?.user?.role === 'student' && typeof auth.user.id === 'string'
      ? auth.user.id
      : ''
  } catch {
    return ''
  }
}

export function getCachedStudentNotifications(userId) {
  return userId ? studentNotificationCache.get(userId)?.data || null : null
}

export function fetchStudentNotifications(userId, fetcher, { forceRefresh = false } = {}) {
  if (!userId) return Promise.resolve().then(fetcher)

  const cached = studentNotificationCache.get(userId)
  if (
    !forceRefresh &&
    cached &&
    Date.now() - cached.savedAt < studentNotificationCacheTtlMs
  ) {
    return Promise.resolve(cached.data)
  }

  const pendingRequest = studentNotificationRequests.get(userId)
  if (pendingRequest) return pendingRequest

  const generation = studentNotificationGenerations.get(userId) || 0
  const request = Promise.resolve()
    .then(fetcher)
    .then((data) => {
      if (generation === (studentNotificationGenerations.get(userId) || 0)) {
        setStudentNotificationCache(userId, data)
      }
      return data
    })
    .finally(() => {
      if (studentNotificationRequests.get(userId) === request) {
        studentNotificationRequests.delete(userId)
      }
    })
  studentNotificationRequests.set(userId, request)
  return request
}

export function setStudentNotificationCache(userId, data) {
  if (!userId) return
  studentNotificationCache.set(userId, { data, savedAt: Date.now() })
  for (const listener of studentNotificationSubscribers.get(userId) || []) {
    listener(data)
  }
}

export function updateStudentNotificationCache(userId, update) {
  const cached = getCachedStudentNotifications(userId)
  if (cached) setStudentNotificationCache(userId, update(cached))
}

export function subscribeToStudentNotifications(userId, listener) {
  if (!userId) return () => {}
  let subscribers = studentNotificationSubscribers.get(userId)
  if (!subscribers) {
    subscribers = new Set()
    studentNotificationSubscribers.set(userId, subscribers)
  }
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
    if (!subscribers.size) studentNotificationSubscribers.delete(userId)
  }
}

export function clearStudentNotificationCache(userId) {
  const userIds = userId
    ? [userId]
    : new Set([
      ...studentNotificationCache.keys(),
      ...studentNotificationRequests.keys(),
      ...studentNotificationSubscribers.keys(),
    ])
  for (const currentUserId of userIds) {
    studentNotificationGenerations.set(
      currentUserId,
      (studentNotificationGenerations.get(currentUserId) || 0) + 1,
    )
    studentNotificationCache.delete(currentUserId)
    studentNotificationRequests.delete(currentUserId)
    for (const listener of studentNotificationSubscribers.get(currentUserId) || []) {
      listener(null)
    }
  }
}
