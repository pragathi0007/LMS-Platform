import React, { useEffect, useState } from 'react'
import './NotificationFeed.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

function formatNotificationDate(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function NotificationFeed({ role, onLogout, onOpenApprovals }) {
  const [notifications, setNotifications] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    async function loadNotifications() {
      setLoading(true)
      setError('')
      try {
        const savedAuth = sessionStorage.getItem('lms.auth')
        const auth = savedAuth ? JSON.parse(savedAuth) : null
        if (auth?.user?.role !== role || typeof auth.token !== 'string') {
          onLogout()
          return
        }
        const response = await fetch(`${API_BASE_URL}/notifications/me`, {
          headers: { Authorization: `Bearer ${auth.token}` },
          signal: controller.signal,
        })
        const result = await response.json()
        if (response.status === 401 || response.status === 403) {
          onLogout()
          return
        }
        if (!response.ok) throw new Error(result.message || 'Unable to load notifications.')
        if (!Array.isArray(result.notifications)) {
          throw new Error('The server returned invalid notifications.')
        }
        setNotifications(result.notifications)
      } catch (loadError) {
        if (loadError.name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load notifications.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadNotifications()
    return () => controller.abort()
  }, [onLogout, role])

  if (loading) return <p className="notification-feed__message" role="status">Loading notifications…</p>
  if (error) return <p className="notification-feed__message is-error" role="alert">{error}</p>
  if (!notifications.length) {
    return <p className="notification-feed__message">You’re all caught up. There are no notifications yet.</p>
  }

  return (
    <div className="notification-feed">
      {notifications.map((notification) => (
        <article className="notification-feed__item" key={notification.id}>
          <div className="notification-feed__copy">
            <h3>{notification.title}</h3>
            <p>{notification.message}</p>
            <time dateTime={notification.createdAt}>{formatNotificationDate(notification.createdAt)}</time>
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
