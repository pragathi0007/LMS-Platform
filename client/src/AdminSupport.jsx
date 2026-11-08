import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import WorkspaceTopbar from './WorkspaceTopbar.jsx'
import './AdminSupport.css'
import './SupportCenter.css'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/+$/, '')
const statuses = ['Open', 'In Progress', 'Waiting for User', 'Resolved', 'Closed']
const categories = [
  'Account and Login',
  'Course and Enrollment',
  'Assignments and Results',
  'Payments and Purchases',
  'Technical Issue',
  'Other',
]
const priorities = ['Low', 'Medium', 'High']

function getToken() {
  const storedAuth = sessionStorage.getItem('lms.auth')
  let token
  try {
    token = storedAuth ? JSON.parse(storedAuth)?.token : null
  } catch {
    throw new Error('Your saved session is invalid. Please sign in again.')
  }
  if (typeof token !== 'string' || !token) throw new Error('Your session has expired. Please sign in again.')
  return token
}

function getTicketQuery(filters) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

async function adminSupportRequest(path, options = {}) {
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${getToken()}`)
  if (options.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_BASE_URL}/support${path}`, { ...options, headers })
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('The server returned an invalid response.')
  }
  if (!response.ok) throw new Error(result.message || 'The support request failed.')
  return result
}

function AdminSupport({
  onLogout,
  isDark,
  onToggleTheme,
  dashboardPath = '/admin/dashboard',
  supportPath = '/admin/support',
  settingsPath = '/admin/settings',
  user,
  roleLabel = 'Main Admin',
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const ticketId = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean)
    return parts.length > 2 ? decodeURIComponent(parts[2]) : ''
  }, [location.pathname])
  const [filters, setFilters] = useState({ status: '', category: '', priority: '' })
  const [tickets, setTickets] = useState([])
  const [ticket, setTicket] = useState(null)
  const [handlers, setHandlers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reply, setReply] = useState('')
  const [notice, setNotice] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    adminSupportRequest(`/admin/tickets${getTicketQuery(filters)}`)
      .then((result) => {
        if (active) setTickets(result.tickets)
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Support tickets could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [filters])

  useEffect(() => {
    if (!ticketId) {
      setTicket(null)
      return undefined
    }
    let active = true
    setLoading(true)
    setError('')
    Promise.all([
      adminSupportRequest(`/admin/tickets/${encodeURIComponent(ticketId)}`),
      adminSupportRequest('/admin/tickets/handlers'),
    ])
      .then(([ticketResult, handlerResult]) => {
        if (active) {
          setTicket(ticketResult.ticket)
          setHandlers(handlerResult.handlers)
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Support ticket details could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [ticketId])

  async function updateTicket(path, body, successMessage) {
    setIsSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await adminSupportRequest(`/admin/tickets/${encodeURIComponent(ticketId)}${path}`, {
        method: path === '/status' || path === '/assignment' ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      })
      setTicket((current) => ({ ...current, ...result.ticket, requester: current?.requester }))
      setNotice(successMessage)
      const [ticketResult, listResult] = await Promise.all([
        adminSupportRequest(`/admin/tickets/${encodeURIComponent(ticketId)}`),
        adminSupportRequest(`/admin/tickets${getTicketQuery(filters)}`),
      ])
      setTicket(ticketResult.ticket)
      setTickets(listResult.tickets)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The ticket could not be updated.')
    } finally {
      setIsSaving(false)
    }
  }

  async function downloadAttachment() {
    try {
      const response = await fetch(
        `${API_BASE_URL}/support/admin/tickets/${encodeURIComponent(ticketId)}/attachment?id=${encodeURIComponent(ticket.attachment.id)}`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      )
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.message || 'The attachment could not be downloaded.')
      }
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = ticket.attachment.fileName
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'The attachment could not be downloaded.')
    }
  }

  return (
    <div className={`admin-support${isDark ? ' is-dark' : ''}`}>
      <WorkspaceTopbar
        title="Support"
        name={user?.fullName}
        email={user?.email}
        roleLabel={roleLabel}
        dashboardPath={dashboardPath}
        helpPath={supportPath}
        settingsPath={settingsPath}
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
      />
      <main className="admin-support__main">
        <div className="admin-support__heading">
          <div>
            <span className="student-eyebrow">SUPPORT MANAGEMENT</span>
            <h1>{ticketId ? 'Review Support Request' : 'Support Tickets'}</h1>
          </div>
          {ticketId && <button className="student-button student-button--quiet" type="button" onClick={() => navigate(supportPath)}>Back to all tickets</button>}
        </div>

        {error && <div className="support-notice is-error" role="alert">{error}</div>}
        {notice && <div className="support-notice is-success" role="status">{notice}</div>}

        {ticketId ? (
          loading ? <p className="support-loading" role="status">Loading ticket…</p> : ticket ? (
            <section className="student-panel admin-support__detail">
              <div className="admin-support__ticket-title">
                <div><small>{ticket.ticketId} · {ticket.category}</small><h2>{ticket.subject}</h2></div>
                <span className={`support-status is-${ticket.status.toLowerCase().replaceAll(' ', '-')}`}>{ticket.status}</span>
              </div>
              <div className="admin-support__requester">
                <span>Requester: {ticket.requester?.fullName || 'Student'} · {ticket.requester?.email || 'Email unavailable'}</span>
                <span>Account: {ticket.accountType === 'college' ? 'College student' : 'Independent student'}</span>
                <span>Priority: {ticket.priority}</span>
                <span>Submitted: {new Date(ticket.createdAt).toLocaleString()}</span>
              </div>
              <section className="support-ticket-description">
                <h3>Request details</h3><p>{ticket.description}</p>
                {ticket.attachment && <button className="support-text-button" type="button" onClick={downloadAttachment}>Download {ticket.attachment.fileName}</button>}
              </section>
              <div className="admin-support__controls">
                <label>Status
                  <select value={ticket.status} disabled={isSaving} onChange={(event) => updateTicket('/status', { status: event.currentTarget.value }, 'Ticket status updated.')}>
                    {statuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <label>Assigned support handler
                  <select value={ticket.assignedTo || ''} disabled={isSaving} onChange={(event) => updateTicket('/assignment', { assignedTo: event.currentTarget.value || null }, 'Ticket assignment updated.')}>
                    <option value="">Unassigned</option>
                    {handlers.map((handler) => <option key={handler.id} value={handler.id}>{handler.fullName} · {handler.email}</option>)}
                  </select>
                </label>
              </div>
              <section className="support-conversation">
                <h3>Conversation</h3>
                {ticket.replies?.length ? ticket.replies.map((item) => (
                  <article className={`support-message is-${item.authorRole}`} key={item._id}>
                    <div><strong>{item.authorRole === 'admin' ? 'Support team' : ticket.requester?.fullName || 'Student'}</strong><time>{new Date(item.createdAt).toLocaleString()}</time></div>
                    <p>{item.message}</p>
                  </article>
                )) : <p className="support-muted">No replies yet.</p>}
              </section>
              <section className="support-status-history">
                <h3>Status history</h3>
                <ol>{ticket.statusHistory?.map((entry) => (
                  <li key={entry._id}><span>{entry.from ? `${entry.from} → ` : ''}{entry.to}</span><time>{new Date(entry.createdAt).toLocaleString()}</time></li>
                ))}</ol>
              </section>
              {!['Resolved', 'Closed'].includes(ticket.status) && (
                <form className="support-form support-reply-form" onSubmit={(event) => {
                  event.preventDefault()
                  updateTicket('/replies', { message: reply }, 'Reply sent.')
                  setReply('')
                }}>
                  <label>Reply to student<textarea value={reply} onChange={(event) => setReply(event.currentTarget.value)} required maxLength={5000} rows={4} /></label>
                  <button className="student-button" type="submit" disabled={isSaving}>{isSaving ? 'Sending…' : 'Send reply'}</button>
                </form>
              )}
            </section>
          ) : null
        ) : (
          <>
            <div className="admin-support__filters">
              <label>Status<select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.currentTarget.value }))}><option value="">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
              <label>Category<select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.currentTarget.value }))}><option value="">All categories</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label>Priority<select value={filters.priority} onChange={(event) => setFilters((current) => ({ ...current, priority: event.currentTarget.value }))}><option value="">All priorities</option>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
            </div>
            {loading ? <p className="support-loading" role="status">Loading support tickets…</p> : tickets.length ? (
              <div className="support-ticket-list">
                {tickets.map((item) => (
                  <Link className="support-ticket-row" to={`${supportPath}/${encodeURIComponent(item.ticketId)}`} key={item.ticketId}>
                    <span className="support-ticket-row__main">
                      <strong>{item.subject}</strong>
                      <small>{item.ticketId} · {item.requester?.fullName || 'Student'} · {item.category}</small>
                    </span>
                    <span className="support-ticket-row__meta">
                      <span className={`support-status is-${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span>
                      <small>{item.priority} · {new Date(item.updatedAt).toLocaleDateString()}</small>
                    </span>
                  </Link>
                ))}
              </div>
            ) : !error ? <div className="support-empty-state"><h3>No support tickets found</h3><p>Tickets matching these filters will appear here.</p></div> : null}
          </>
        )}
      </main>
    </div>
  )
}

export default AdminSupport
