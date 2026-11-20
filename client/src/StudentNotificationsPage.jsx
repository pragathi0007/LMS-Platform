import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from './api-base-url.js'
import { fetchWithAuth, isInvalidSessionResponse } from './auth-session.js'
import {
  getNotificationActionError,
  getStudentLink,
  NotificationIcon,
  notificationDate,
  notificationIcon,
} from './StudentNotificationBell.jsx'
import {
  fetchStudentNotifications,
  getCachedStudentNotifications,
  getCurrentStudentNotificationUserId,
  subscribeToStudentNotifications,
  updateStudentNotificationCache,
} from './student-notifications-cache.js'
import './StudentNotificationsPage.css'

function isToday(value) {
  const date = value ? new Date(value) : null
  if (!date || !Number.isFinite(date.getTime())) return false
  const today = new Date()
  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
}

function pageNotificationIcon(type) {
  if (type === 'assignment_due') return 'document'
  if (type === 'course_updated' || type === 'course_assigned' || type === 'course_incomplete') return 'book'
  if (type === 'independent_student_approved') return 'check'
  return notificationIcon(type)
}

function NotificationsHero() {
  return (
    <section className="student-notifications-hero">
      <div className="student-notifications-hero__copy">
        <span>NOTIFICATIONS</span>
        <h1>Your Updates</h1>
        <p>Stay in the loop with your courses, assignments and account.</p>
      </div>
      <svg className="student-notifications-hero__art" viewBox="0 0 220 150" fill="none" aria-hidden="true">
        <path d="M22 117c28-19 60-13 91-25 34-13 59-30 98-30v88H22z" fill="#DDE8D7" />
        <rect x="81" y="24" width="104" height="104" rx="28" fill="#F9F6E9" fillOpacity=".76" transform="rotate(8 81 24)" />
        <circle cx="137" cy="82" r="44" fill="#E8F0E7" />
        <path d="M112 87c8-7 12-15 13-27 1-13 9-22 21-22s20 9 21 22c1 12 5 20 13 27l-5 8h-58z" fill="#F3D28B" />
        <path d="M112 87c8-7 12-15 13-27 1-13 9-22 21-22s20 9 21 22c1 12 5 20 13 27l-5 8h-58z" stroke="#D3A94F" strokeWidth="2" strokeLinejoin="round" />
        <path d="M133 102a14 14 0 0 0 26 0" stroke="#D3A94F" strokeWidth="4" strokeLinecap="round" />
        <path d="m99 36-8-8m19-2-3-12m75 24 8-8m-19-4 3-12" stroke="#D8AD4D" strokeWidth="3" strokeLinecap="round" />
        <path d="m184 103 3 6 6 3-6 3-3 6-3-6-6-3 6-3z" fill="#75A995" />
      </svg>
    </section>
  )
}

export default function StudentNotificationsPage({ onLogout }) {
  const navigate = useNavigate()
  const studentUserId = getCurrentStudentNotificationUserId()
  const cachedNotifications = getCachedStudentNotifications(studentUserId)
  const [notifications, setNotifications] = useState(cachedNotifications?.notifications || [])
  const [unreadCount, setUnreadCount] = useState(cachedNotifications?.unreadCount || 0)
  const [loading, setLoading] = useState(!cachedNotifications)
  const [error, setError] = useState('')
  const [markingAll, setMarkingAll] = useState(false)
  const [busyIds, setBusyIds] = useState([])

  const loadNotifications = useCallback(async (signal) => {
    if (!getCachedStudentNotifications(studentUserId)) setLoading(true)
    setError('')
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      const auth = savedAuth ? JSON.parse(savedAuth) : null
      if (auth?.user?.role !== 'student' || typeof auth.token !== 'string') {
        onLogout()
        throw new Error('Your session has ended. Please sign in again.')
      }

      const data = await fetchStudentNotifications(studentUserId, async () => {
        const response = await fetchWithAuth(`${API_BASE_URL}/notifications/me`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        }, API_BASE_URL, auth.token)
        const result = await response.json()
        if (isInvalidSessionResponse(response, result)) {
          onLogout()
          throw new Error('Your session has ended. Please sign in again.')
        }
        if (!response.ok) throw new Error(result.message || 'Notifications could not be loaded.')
        if (!Array.isArray(result.notifications)) {
          throw new Error('The server returned invalid notification data.')
        }

        const records = result.notifications.map((notification) => ({
          ...notification,
          id: notification.id || (notification._id ? String(notification._id) : ''),
          isRead: typeof notification.isRead === 'boolean'
            ? notification.isRead
            : Boolean(notification.readAt),
        }))
        if (records.some((notification) => !notification.id)) {
          throw new Error('The server returned a notification without an ID.')
        }
        return {
          notifications: records,
          unreadCount: Number.isSafeInteger(result.unreadCount) && result.unreadCount >= 0
            ? result.unreadCount
            : records.filter((notification) => !notification.isRead).length,
        }
      })
      if (signal?.aborted) return
      setNotifications(data.notifications)
      setUnreadCount(data.unreadCount)
    } catch (loadError) {
      if (!signal?.aborted && loadError instanceof Error && loadError.name !== 'AbortError') {
        setError(loadError.message)
      } else if (!signal?.aborted && !(loadError instanceof Error)) {
        setError('Notifications could not be loaded.')
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [onLogout, studentUserId])

  useEffect(() => {
    const controller = new AbortController()
    void loadNotifications(controller.signal)
    return () => controller.abort()
  }, [loadNotifications])

  useEffect(() => subscribeToStudentNotifications(studentUserId, (data) => {
    if (!data) {
      setNotifications([])
      setUnreadCount(0)
      return
    }
    setNotifications(data.notifications)
    setUnreadCount(data.unreadCount)
  }), [studentUserId])

  const groups = useMemo(() => {
    const today = []
    const earlier = []
    for (const notification of notifications) {
      (isToday(notification.createdAt) ? today : earlier).push(notification)
    }
    return [
      { title: 'Today', notifications: today, tone: 'today' },
      { title: 'Earlier', notifications: earlier, tone: 'earlier' },
    ].filter((group) => group.notifications.length > 0)
  }, [notifications])

  async function sendAction(path, method) {
    const savedAuth = sessionStorage.getItem('lms.auth')
    const auth = savedAuth ? JSON.parse(savedAuth) : null
    if (auth?.user?.role !== 'student' || typeof auth.token !== 'string') {
      onLogout()
      throw new Error('Your session has ended. Please sign in again.')
    }
    const response = await fetchWithAuth(`${API_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${auth.token}` },
    }, API_BASE_URL, auth.token)
    const result = await response.json()
    if (isInvalidSessionResponse(response, result)) {
      onLogout()
      throw new Error('Your session has ended. Please sign in again.')
    }
    if (!response.ok) {
      throw new Error(getNotificationActionError(response, result, 'The notification action could not be completed.'))
    }
    return result
  }

  async function markAsRead(notification) {
    if (!notification || notification.isRead) return
    setError('')
    try {
      const result = await sendAction(`/notifications/${encodeURIComponent(notification.id)}/read`, 'PATCH')
      setNotifications((current) => current.map((entry) => (
        entry.id === notification.id ? { ...entry, isRead: true, readAt: result.readAt } : entry
      )))
      setUnreadCount((current) => Math.max(0, current - 1))
      updateStudentNotificationCache(studentUserId, (current) => ({
        notifications: current.notifications.map((entry) => (
          entry.id === notification.id ? { ...entry, isRead: true, readAt: result.readAt } : entry
        )),
        unreadCount: Math.max(0, current.unreadCount - 1),
      }))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'This notification could not be marked as read.')
    }
  }

  async function markAllAsRead() {
    if (!unreadCount || markingAll) return
    setMarkingAll(true)
    setError('')
    try {
      await sendAction('/notifications/read-all', 'PATCH')
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((entry) => ({
        ...entry,
        isRead: true,
        readAt: entry.readAt || readAt,
      })))
      setUnreadCount(0)
      updateStudentNotificationCache(studentUserId, (current) => ({
        notifications: current.notifications.map((entry) => ({
          ...entry,
          isRead: true,
          readAt: entry.readAt || readAt,
        })),
        unreadCount: 0,
      }))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Notifications could not be marked as read.')
    } finally {
      setMarkingAll(false)
    }
  }

  async function deleteNotification(notification) {
    if (!notification || busyIds.includes(notification.id)) return
    setBusyIds((current) => [...current, notification.id])
    setError('')
    try {
      await sendAction(`/notifications/${encodeURIComponent(notification.id)}`, 'DELETE')
      setNotifications((current) => current.filter((entry) => entry.id !== notification.id))
      if (!notification.isRead) setUnreadCount((current) => Math.max(0, current - 1))
      updateStudentNotificationCache(studentUserId, (current) => ({
        notifications: current.notifications.filter((entry) => entry.id !== notification.id),
        unreadCount: notification.isRead
          ? current.unreadCount
          : Math.max(0, current.unreadCount - 1),
      }))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'This notification could not be deleted.')
    } finally {
      setBusyIds((current) => current.filter((id) => id !== notification.id))
    }
  }

  async function openNotification(notification) {
    await markAsRead(notification)
    navigate(getStudentLink(notification))
  }

  return (
    <div className="student-notifications-page">
      <NotificationsHero />
      <section className="student-notifications-card" aria-label="All notifications" aria-busy={loading}>
        <div className="student-notifications-card__toolbar">
          <span>{unreadCount ? `${unreadCount} unread` : ''}</span>
          {unreadCount > 0 && (
            <button type="button" onClick={markAllAsRead} disabled={markingAll}>
              <NotificationIcon name="check" />
              {markingAll ? 'Saving…' : 'Mark all as read'}
            </button>
          )}
        </div>
        {error && (
          <div className="student-notifications__error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadNotifications()}>Retry</button>
          </div>
        )}
        {loading && notifications.length === 0 ? (
          <div className="student-notifications__skeleton" role="status" aria-label="Loading notifications">
            {[0, 1, 2].map((item) => <span key={item} />)}
          </div>
        ) : notifications.length === 0 && error ? null : notifications.length === 0 ? (
          <p className="student-notifications__empty">No notifications</p>
        ) : (
          <div className="student-notifications__groups">
            {groups.map((group) => (
              <section className={`student-notifications__group is-${group.tone}`} key={group.title}>
                <h2><span>{group.title}</span></h2>
                <ul>
                  {group.notifications.map((notification) => {
                    const iconName = pageNotificationIcon(notification.type)
                    return (
                      <li
                        className={`student-notifications__item${notification.isRead ? '' : ' is-unread'}`}
                        key={notification.id}
                      >
                        <button
                          className="student-notifications__open"
                          type="button"
                          onClick={() => void openNotification(notification)}
                        >
                          <span className={`student-notifications__icon is-${iconName}`} aria-hidden="true">
                            <NotificationIcon name={iconName} />
                          </span>
                          <span className="student-notifications__copy">
                            <strong>{notification.title}</strong>
                            <span>{notification.message}</span>
                          </span>
                          <time dateTime={notification.createdAt}>{notificationDate(notification.createdAt)}</time>
                          {!notification.isRead && <span className="student-notifications__unread-dot" aria-label="Unread" />}
                        </button>
                        <button
                          className="student-notifications__delete"
                          type="button"
                          aria-label="Delete notification"
                          title="Delete notification"
                          disabled={busyIds.includes(notification.id)}
                          onClick={() => void deleteNotification(notification)}
                        >
                          <NotificationIcon name="delete" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
