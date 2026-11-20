import React, { useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from './api-base-url.js'
import { fetchWithAuth } from './auth-session.js'
import {
  fetchStudentNotifications,
  getCachedStudentNotifications,
  getCurrentStudentNotificationUserId,
  subscribeToStudentNotifications,
  updateStudentNotificationCache,
} from './student-notifications-cache.js'
import { STUDENT_NOTIFICATIONS_UPDATED_EVENT } from './student-notifications-events.js'
import './NotificationFeed.css'
function formatNotificationDate(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function getDateGroup(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Earlier'

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const notificationDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  if (notificationDay.getTime() === today.getTime()) return 'Today'

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  return notificationDay.getTime() === yesterday.getTime() ? 'Yesterday' : 'Earlier'
}

function groupByDate(notifications) {
  const groups = new Map()
  notifications.forEach((notification) => {
    const label = getDateGroup(notification.createdAt)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(notification)
  })
  return ['Today', 'Yesterday', 'Earlier']
    .filter((label) => groups.has(label))
    .map((label) => ({ label, notifications: groups.get(label) }))
}

function getNotificationStyle(notification) {
  const details = {
    independent_student_registered: {
      typeLabel: 'Student application',
      typeTone: 'application',
      priorityLabel: 'Action needed',
      priorityTone: 'high',
    },
    independent_student_approved: {
      typeLabel: 'Account approved',
      typeTone: 'success',
      priorityLabel: 'Informational',
      priorityTone: 'low',
    },
    independent_student_rejected: {
      typeLabel: 'Application update',
      typeTone: 'attention',
      priorityLabel: 'Review',
      priorityTone: 'medium',
    },
  }[notification.type] || {
    typeLabel: 'Notification',
    typeTone: 'neutral',
    priorityLabel: 'Normal',
    priorityTone: 'normal',
  }
  if (notification.type === 'independent_student_registered' && notification.actionCompleted) {
    return { ...details, priorityLabel: '', priorityTone: '' }
  }
  const suppliedPriority = notification.priority || notification.metadata?.priority
  if (!suppliedPriority) return details

  const priority = String(suppliedPriority).toLowerCase()
  if (priority.includes('urgent') || priority.includes('high')) {
    return { ...details, priorityLabel: 'High priority', priorityTone: 'high' }
  }
  if (priority.includes('medium')) {
    return { ...details, priorityLabel: 'Medium priority', priorityTone: 'medium' }
  }
  if (priority.includes('low')) {
    return { ...details, priorityLabel: 'Low priority', priorityTone: 'low' }
  }
  return details
}

function NotificationIcon({ type }) {
  const paths = {
    independent_student_registered: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0M18 8v6m-3-3h6" />
      </>
    ),
    independent_student_approved: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16.5 9" />
      </>
    ),
    independent_student_rejected: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m9 9 6 6m0-6-6 6" />
      </>
    ),
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[type] || <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>}
    </svg>
  )
}

export default function NotificationFeed({ role, onLogout, onOpenApprovals, onUnreadCountChange, limit }) {
  const studentUserId = role === 'student' ? getCurrentStudentNotificationUserId() : ''
  const cachedNotifications = role === 'student'
    ? getCachedStudentNotifications(studentUserId)
    : null
  const [notifications, setNotifications] = useState(cachedNotifications?.notifications || [])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!cachedNotifications)
  const [refreshToken, setRefreshToken] = useState(0)
  const forceRefreshRef = useRef(false)
  const [readError, setReadError] = useState('')
  const [markingReadId, setMarkingReadId] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    async function loadNotifications() {
      if (!getCachedStudentNotifications(studentUserId)) setLoading(true)
      setError('')
      try {
        const savedAuth = sessionStorage.getItem('lms.auth')
        const auth = savedAuth ? JSON.parse(savedAuth) : null
        if (auth?.user?.role !== role || typeof auth.token !== 'string') {
          onLogout()
          throw new Error('Your session has ended. Please sign in again.')
        }
        const fetchData = async () => {
          const requestOptions = {
            headers: { Authorization: `Bearer ${auth.token}` },
            ...(role === 'student' ? {} : { signal: controller.signal }),
          }
          const response = role === 'student'
            ? await fetchWithAuth(`${API_BASE_URL}/notifications/me`, requestOptions, API_BASE_URL, auth.token)
            : await fetch(`${API_BASE_URL}/notifications/me`, requestOptions)
          const result = await response.json()
          if (response.status === 401 || response.status === 403) {
            onLogout()
            throw new Error('Your session has ended. Please sign in again.')
          }
          if (!response.ok) throw new Error(result.message || 'Unable to load notifications.')
          if (!Array.isArray(result.notifications)) {
            throw new Error('The server returned invalid notifications.')
          }
          const unreadCount = Number.isSafeInteger(result.unreadCount) && result.unreadCount >= 0
            ? result.unreadCount
            : result.notifications.filter((notification) => notification.isRead !== true && !notification.readAt).length
          return { notifications: result.notifications, unreadCount }
        }
        const forceRefresh = forceRefreshRef.current
        forceRefreshRef.current = false
        const data = role === 'student'
          ? await fetchStudentNotifications(studentUserId, fetchData, { forceRefresh })
          : await fetchData()
        if (!active || controller.signal.aborted) return
        setNotifications(data.notifications)
        onUnreadCountChange?.(data.unreadCount)
      } catch (loadError) {
        if (active && loadError.name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load notifications.')
        }
      } finally {
        if (active && !controller.signal.aborted) setLoading(false)
      }
    }

    loadNotifications()
    const refresh = () => {
      forceRefreshRef.current = true
      setRefreshToken((current) => current + 1)
    }
    if (role === 'student') window.addEventListener(STUDENT_NOTIFICATIONS_UPDATED_EVENT, refresh)
    return () => {
      active = false
      controller.abort()
      if (role === 'student') window.removeEventListener(STUDENT_NOTIFICATIONS_UPDATED_EVENT, refresh)
    }
  }, [onLogout, onUnreadCountChange, role, refreshToken, studentUserId])

  useEffect(() => {
    if (role !== 'student') return undefined
    return subscribeToStudentNotifications(studentUserId, (data) => {
      if (!data) {
        setNotifications([])
        onUnreadCountChange?.(0)
        return
      }
      setNotifications(data.notifications)
      onUnreadCountChange?.(data.unreadCount)
    })
  }, [onUnreadCountChange, role, studentUserId])

  async function markAsRead(notificationId) {
    setMarkingReadId(notificationId)
    setReadError('')
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      const auth = savedAuth ? JSON.parse(savedAuth) : null
      if (auth?.user?.role !== role || typeof auth.token !== 'string') {
        onLogout()
        return
      }
      const response = await fetch(`${API_BASE_URL}/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${auth.token}` },
      })
      let result
      try {
        result = await response.json()
      } catch {
        throw new Error('The server returned an invalid response.')
      }
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      if (!response.ok) throw new Error(result.message || 'Unable to update notification status.')
      const currentNotification = notifications.find((notification) => notification.id === notificationId)
      const wasUnread = currentNotification?.isRead !== true
      setNotifications((current) => current.map((notification) => (
        notification.id === notificationId ? { ...notification, isRead: true } : notification
      )))
      onUnreadCountChange?.((current) => Math.max(0, current - 1))
      updateStudentNotificationCache(studentUserId, (current) => ({
        notifications: current.notifications.map((notification) => (
          notification.id === notificationId ? { ...notification, isRead: true } : notification
        )),
        unreadCount: wasUnread ? Math.max(0, current.unreadCount - 1) : current.unreadCount,
      }))
    } catch (markError) {
      setReadError(markError instanceof Error ? markError.message : 'Unable to update notification status.')
    } finally {
      setMarkingReadId('')
    }
  }

  const isMainAdmin = role === 'main_admin'
  if (loading && !notifications.length) {
    return <p className={`notification-feed__message${isMainAdmin ? ' notification-feed__message--admin' : ''}`} role="status">Loading notifications…</p>
  }
  if (error && !notifications.length) {
    return <p className={`notification-feed__message is-error${isMainAdmin ? ' notification-feed__message--admin' : ''}`} role="alert">{error}</p>
  }
  if (!loading && !error && !notifications.length) {
    return <p className="notification-feed__message">{role === 'student' ? 'No notifications yet.' : 'You’re all caught up. There are no notifications yet.'}</p>
  }

  if (isMainAdmin) {
    const visibleNotifications = Number.isSafeInteger(limit) && limit >= 0
      ? notifications.slice(0, limit)
      : notifications
    return (
      <div className="notification-feed notification-feed--admin">
        {error && <p className="notification-feed__message is-error" role="alert">{error}</p>}
        {readError && <p className="notification-feed__read-error" role="alert">{readError}</p>}
        {groupByDate(visibleNotifications).map((group) => (
          <section className="notification-feed__group" key={group.label}>
            <div className="notification-feed__group-heading">
              <h2>{group.label}</h2>
              <span>{group.notifications.length}</span>
            </div>
            <div className="notification-feed__group-list">
              {group.notifications.map((notification) => {
                const style = getNotificationStyle(notification)
                return (
                  <article
                    className={`notification-feed__item notification-feed__item--${style.typeTone}${notification.isRead ? '' : ' is-unread'}`}
                    key={notification.id}
                  >
                    <span className={`notification-feed__icon notification-feed__icon--${style.typeTone}`}>
                      <NotificationIcon type={notification.type} />
                    </span>
                    <div className="notification-feed__copy">
                      <div className="notification-feed__title-row">
                        <h3>{notification.title}</h3>
                        {!notification.isRead && <span className="notification-feed__unread">Unread</span>}
                      </div>
                      <div className="notification-feed__badges">
                        <span className={`notification-feed__badge notification-feed__badge--${style.typeTone}`}>{style.typeLabel}</span>
                        {style.priorityLabel && (
                          <span className={`notification-feed__badge notification-feed__badge--priority-${style.priorityTone}`}>{style.priorityLabel}</span>
                        )}
                      </div>
                      <p>{notification.message}</p>
                      <time dateTime={notification.createdAt}>{formatNotificationDate(notification.createdAt)}</time>
                    </div>
                    <div className="notification-feed__actions">
                      {!notification.isRead && (
                        <button
                          type="button"
                          className="notification-feed__mark-read"
                          disabled={Boolean(markingReadId)}
                          onClick={() => markAsRead(notification.id)}
                        >
                          {markingReadId === notification.id ? 'Marking…' : 'Mark as read'}
                        </button>
                      )}
                      {notification.type === 'independent_student_registered' && (
                        <button
                          type="button"
                          className="notification-feed__action"
                          onClick={() => onOpenApprovals?.(notification.metadata?.studentId)}
                        >
                          Review application
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    )
  }

  const visibleNotifications = role === 'student' ? notifications.slice(0, 2) : notifications

  return (
    <div className={`notification-feed${role === 'student' ? ' notification-feed--student' : ''}`}>
      {error && <p className="notification-feed__message is-error" role="alert">{error}</p>}
      {readError && <p className="notification-feed__read-error" role="alert">{readError}</p>}
      {visibleNotifications.map((notification) => (
        <article
          className={`notification-feed__item${role === 'student' ? ` is-${notification.isRead ? 'read' : 'unread'}` : ''}`}
          key={notification.id}
        >
          {role === 'student' && (
            <span className="notification-feed__student-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M3 10v4h4l10 5V5L7 10H3Z" />
                <path d="M7 14 9 20h4l-3-7m9-4a5 5 0 0 1 0 8m2-11a9 9 0 0 1 0 14" />
              </svg>
            </span>
          )}
          <div className="notification-feed__copy">
            {role === 'student' ? (
              <div className="notification-feed__student-heading">
                <h3>{notification.title}</h3>
                <span className={`notification-feed__read-status${notification.isRead ? ' is-read' : ' is-unread'}`}>
                  {notification.isRead ? 'Read' : 'Unread'}
                </span>
              </div>
            ) : <h3>{notification.title}</h3>}
            <p>{notification.message}</p>
            <time dateTime={notification.createdAt || undefined}>{formatNotificationDate(notification.createdAt)}</time>
          </div>
          {role === 'main_admin' && notification.type === 'independent_student_registered' && (
            <button type="button" className="notification-feed__action" onClick={onOpenApprovals}>
              Review application
            </button>
          )}
        </article>
      ))}
    </div>
  )
}
