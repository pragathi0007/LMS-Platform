import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from './api-base-url.js'
import { fetchWithAuth, isInvalidSessionResponse } from './auth-session.js'
import {
  STUDENT_LEARNING_PROGRESS_UPDATED_EVENT,
  STUDENT_NOTIFICATIONS_UPDATED_EVENT,
} from './student-notifications-events.js'
import {
  fetchStudentNotifications,
  getCachedStudentNotifications,
  getCurrentStudentNotificationUserId,
  subscribeToStudentNotifications,
  updateStudentNotificationCache,
} from './student-notifications-cache.js'
import './StudentNotificationBell.css'

export { STUDENT_NOTIFICATIONS_UPDATED_EVENT }

function notificationDate(value) {
  const timestamp = value ? new Date(value).getTime() : NaN
  if (!Number.isFinite(timestamp)) return 'Date unavailable'

  const difference = timestamp - Date.now()
  const absoluteDifference = Math.abs(difference)
  if (absoluteDifference < 60_000) return difference > 0 ? 'In a moment' : 'Just now'
  if (absoluteDifference >= 7 * 24 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
  }
  const units = [
    { duration: 24 * 60 * 60 * 1000, suffix: 'd' },
    { duration: 60 * 60 * 1000, suffix: 'h' },
    { duration: 60 * 1000, suffix: 'm' },
  ]
  const unit = units.find(({ duration }) => absoluteDifference >= duration)
  const amount = Math.floor(absoluteDifference / unit.duration)
  return difference < 0 ? `${amount}${unit.suffix} ago` : `In ${amount}${unit.suffix}`
}

function notificationIcon(type) {
  if (type === 'certificate_available') return 'award'
  if (type === 'quiz_result') return 'chart'
  if (type === 'assignment_due') return 'clock'
  if (type === 'assignment_approved') return 'check'
  if (type?.startsWith('assignment_')) return 'document'
  if (type === 'course_updated') return 'megaphone'
  if (type === 'course_assigned' || type === 'course_incomplete') return 'book'
  return 'bell'
}

function getNotificationActionError(response, result, fallback) {
  if (response.status === 404 && result?.message === 'API route not found.') {
    return 'Restart the backend server to load the latest notification actions, then retry.'
  }
  return result?.message || fallback
}

function getStudentLink(notification) {
  if (typeof notification.link === 'string') {
    let target
    try {
      target = new URL(notification.link, window.location.origin)
    } catch {
      target = null
    }
    if (target?.origin === window.location.origin && target.pathname.startsWith('/student/')) {
      return `${target.pathname}${target.search}${target.hash}`
    }
  }
  if (notification.type === 'certificate_available') return '/student/certificates'
  if (notification.type?.startsWith('assignment_')) return '/student/assignments'
  const courseId = notification.metadata?.courseId
  return courseId
    ? `/student/course/${encodeURIComponent(String(courseId))}/learn`
    : '/student/dashboard'
}

export default function StudentNotificationBell({ onLogout }) {
  const navigate = useNavigate()
  const rootRef = useRef(null)
  const studentUserId = getCurrentStudentNotificationUserId()
  const cachedNotifications = getCachedStudentNotifications(studentUserId)
  const inFlightRef = useRef({ userId: '', request: null })
  const activeUserIdRef = useRef('')
  const progressNotificationIdsRef = useRef(new Set())
  const [notifications, setNotifications] = useState(cachedNotifications?.notifications || [])
  const [unreadCount, setUnreadCount] = useState(cachedNotifications?.unreadCount || 0)
  const [loading, setLoading] = useState(!cachedNotifications)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [busyIds, setBusyIds] = useState([])
  const [markingAll, setMarkingAll] = useState(false)

  const loadNotifications = useCallback((forceRefresh = false) => {
    if (inFlightRef.current.userId === studentUserId && inFlightRef.current.request) {
      return inFlightRef.current.request
    }
    if (!getCachedStudentNotifications(studentUserId)) setLoading(true)
    setError('')
    const request = (async () => {
      try {
        const savedAuth = sessionStorage.getItem('lms.auth')
        const auth = savedAuth ? JSON.parse(savedAuth) : null
        if (auth?.user?.role !== 'student' || typeof auth.token !== 'string') {
          onLogout()
          return
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
          const unreadCount = Number.isSafeInteger(result.unreadCount) && result.unreadCount >= 0
            ? result.unreadCount
            : result.notifications.filter((notification) => notification.isRead !== true && !notification.readAt).length
          return { notifications: result.notifications, unreadCount }
        }, { forceRefresh })
        if (activeUserIdRef.current !== studentUserId) return
        let hasNewAssignmentReview = false
        data.notifications.forEach((notification) => {
          if (!['assignment_approved', 'assignment_rejected'].includes(notification.type)) return
          const notificationId = String(notification.id || notification._id || '')
          if (!notificationId || progressNotificationIdsRef.current.has(notificationId)) return
          progressNotificationIdsRef.current.add(notificationId)
          hasNewAssignmentReview = true
        })
        if (hasNewAssignmentReview) {
          window.dispatchEvent(new Event(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT))
        }
        setNotifications(data.notifications)
        setUnreadCount(data.unreadCount)
      } catch (loadError) {
        if (activeUserIdRef.current === studentUserId && loadError instanceof Error && loadError.name !== 'AbortError') {
          setError(loadError.message)
        } else if (activeUserIdRef.current === studentUserId && !(loadError instanceof Error)) {
          setError('Notifications could not be loaded.')
        }
      } finally {
        if (activeUserIdRef.current === studentUserId) setLoading(false)
      }
    })()
    inFlightRef.current = { userId: studentUserId, request }
    void request.finally(() => {
      if (inFlightRef.current.request === request) {
        inFlightRef.current = { userId: '', request: null }
      }
    })
    return request
  }, [onLogout, studentUserId])

  useEffect(() => {
    activeUserIdRef.current = studentUserId
    void loadNotifications()
    const refresh = (force = false) => {
      if (document.visibilityState === 'visible') void loadNotifications(force)
    }
    const intervalId = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    const refreshUpdated = () => refresh(true)
    window.addEventListener(STUDENT_NOTIFICATIONS_UPDATED_EVENT, refreshUpdated)
    const unsubscribe = subscribeToStudentNotifications(studentUserId, (data) => {
      if (!data) {
        setNotifications([])
        setUnreadCount(0)
        setLoading(true)
        return
      }
      setNotifications(data.notifications)
      setUnreadCount(data.unreadCount)
    })
    return () => {
      if (activeUserIdRef.current === studentUserId) activeUserIdRef.current = ''
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(STUDENT_NOTIFICATIONS_UPDATED_EVENT, refreshUpdated)
      unsubscribe()
    }
  }, [loadNotifications, studentUserId])

  useEffect(() => {
    if (!open) return undefined
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  async function markAsRead(notificationId) {
    const notification = notifications.find((entry) => entry.id === notificationId)
    if (!notification || notification.isRead) return
    setBusyIds((current) => [...current, notificationId])
    setError('')
    try {
      const response = await sendStudentNotificationAction(notificationId, 'PATCH', 'read')
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok) {
        throw new Error(getNotificationActionError(response, result, 'This notification could not be marked as read.'))
      }
      setNotifications((current) => current.map((entry) => (
        entry.id === notificationId ? { ...entry, isRead: true, readAt: result.readAt } : entry
      )))
      setUnreadCount((current) => Math.max(0, current - 1))
      updateStudentNotificationCache(studentUserId, (current) => ({
        notifications: current.notifications.map((entry) => (
          entry.id === notificationId ? { ...entry, isRead: true, readAt: result.readAt } : entry
        )),
        unreadCount: Math.max(0, current.unreadCount - 1),
      }))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'This notification could not be marked as read.')
    } finally {
      setBusyIds((current) => current.filter((id) => id !== notificationId))
    }
  }

  async function markAllAsRead() {
    if (!unreadCount || markingAll) return
    setMarkingAll(true)
    setError('')
    try {
      const response = await sendStudentNotificationAction(null, 'PATCH', 'read-all')
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok) {
        throw new Error(getNotificationActionError(response, result, 'Notifications could not be marked as read.'))
      }
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((entry) => ({ ...entry, isRead: true, readAt: entry.readAt || readAt })))
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

  async function deleteNotification(notificationId) {
    const notification = notifications.find((entry) => entry.id === notificationId)
    if (!notification) return
    setBusyIds((current) => [...current, notificationId])
    setError('')
    try {
      const response = await sendStudentNotificationAction(notificationId, 'DELETE')
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok) {
        throw new Error(getNotificationActionError(response, result, 'This notification could not be deleted.'))
      }
      setNotifications((current) => current.filter((entry) => entry.id !== notificationId))
      if (!notification.isRead) setUnreadCount((current) => Math.max(0, current - 1))
      updateStudentNotificationCache(studentUserId, (current) => ({
        notifications: current.notifications.filter((entry) => entry.id !== notificationId),
        unreadCount: notification.isRead
          ? current.unreadCount
          : Math.max(0, current.unreadCount - 1),
      }))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'This notification could not be deleted.')
    } finally {
      setBusyIds((current) => current.filter((id) => id !== notificationId))
    }
  }

  function openNotification(notification) {
    if (!notification.isRead) void markAsRead(notification.id)
    setOpen(false)
    navigate(getStudentLink(notification))
  }

  return (
    <div className={`student-notification-bell${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        className="student-icon-button student-notification-bell__trigger"
        type="button"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="student-notification-panel"
        onClick={() => {
          const nextOpen = !open
          setOpen(nextOpen)
          if (nextOpen) void loadNotifications()
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></svg>
        {unreadCount > 0 && <span className="student-notification-bell__count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <section className="student-notification-bell__panel" id="student-notification-panel" role="dialog" aria-label="Notifications">
          <header className="student-notification-bell__header">
            <h2>Notifications</h2>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllAsRead} disabled={markingAll}>
                {markingAll ? 'Saving…' : 'Mark all as read'}
              </button>
            )}
          </header>
          {error && (
            <div className="student-notification-bell__error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void loadNotifications()}>Retry</button>
            </div>
          )}
          {loading && !notifications.length ? (
            <div className="student-notification-bell__skeleton" role="status" aria-label="Loading notifications">
              {[0, 1, 2].map((item) => <span className="student-notification-bell__skeleton-row" key={item} />)}
            </div>
          ) : !notifications.length && error ? null : !notifications.length ? (
            <p className="student-notification-bell__empty">No notifications</p>
          ) : (
            <ul className="student-notification-bell__list" aria-busy={loading}>
              {notifications.map((notification) => (
                <li className={`student-notification-bell__item${notification.isRead ? '' : ' is-unread'}`} key={notification.id}>
                  <button
                    className="student-notification-bell__content"
                    type="button"
                    onClick={() => openNotification(notification)}
                  >
                    <span className={`student-notification-bell__icon is-${notificationIcon(notification.type)}`} aria-hidden="true">
                      <NotificationIcon name={notificationIcon(notification.type)} />
                    </span>
                    <span className="student-notification-bell__copy">
                      <strong>{notification.title}</strong>
                      <span>{notification.message}</span>
                      <time dateTime={notification.createdAt}>{notificationDate(notification.createdAt)}</time>
                    </span>
                    <span className="student-notification-bell__chevron" aria-hidden="true">
                      <NotificationIcon name="chevron" />
                    </span>
                  </button>
                  <div className="student-notification-bell__item-actions">
                    <button
                      type="button"
                      aria-label="Delete notification"
                      title="Delete notification"
                      disabled={busyIds.includes(notification.id)}
                      onClick={() => void deleteNotification(notification.id)}
                    >
                      <NotificationIcon name="delete" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {notifications.length > 0 && (
            <button
              className="student-notification-bell__view-all"
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/student/announcements')
              }}
            >
              View All Notifications
              <NotificationIcon name="arrowRight" />
            </button>
          )}
        </section>
      )}
    </div>
  )

  async function sendStudentNotificationAction(notificationId, method, action) {
    const savedAuth = sessionStorage.getItem('lms.auth')
    const auth = savedAuth ? JSON.parse(savedAuth) : null
    if (auth?.user?.role !== 'student' || typeof auth.token !== 'string') {
      onLogout()
      throw new Error('Your session has ended. Please sign in again.')
    }
    const path = action === 'read-all'
      ? '/notifications/read-all'
      : `/notifications/${encodeURIComponent(notificationId)}/${action || ''}`.replace(/\/$/, '')
    return fetchWithAuth(`${API_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${auth.token}` },
    }, API_BASE_URL, auth.token)
  }
}

function NotificationIcon({ name }) {
  const paths = {
    award: <><path d="M8 21h8m-4-4v4m0-7a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" /><path d="m8 13-1 8 5-3 5 3-1-8" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z" /><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20" /></>,
    chart: <><path d="M4 20V10m5 10V4m5 16v-7m5 7V7" /><path d="M2 20h20" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    delete: <><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
    document: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v6h5M10 13h6m-6 4h6" /></>,
    megaphone: <><path d="m3 11 18-5v12L3 13z" /><path d="M7 14v4a2 2 0 0 0 2 2h2l-2-5m12-6a3 3 0 0 1 0 6" /></>,
    chevron: <><path d="m9 18 6-6-6-6" /></>,
    arrowRight: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name] || paths.bell}</svg>
}

export {
  getNotificationActionError,
  getStudentLink,
  NotificationIcon,
  notificationDate,
  notificationIcon,
}
