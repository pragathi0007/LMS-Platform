import React, { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from './api-base-url.js'
import './IndependentStudentApprovals.css'

const filters = [
  ['pending', 'Pending'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
]
const registrationFieldDefaults = {
  fullName: '',
  email: '',
  referralCode: '',
  username: '',
  educationQualification: '',
  customQualification: '',
  userExpectations: '',
  location: '',
  livingWithWhom: '',
  customLivingArrangement: '',
}

function registrationFieldLabel(field) {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function registrationFieldValue(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return 'Not provided'
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(registrationFieldValue).join(', ') : 'Not provided'
  }
  if (typeof value === 'object') return 'Not provided'
  return String(value)
}

function formatDate(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

async function readResponse(response) {
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || 'The request could not be completed.')
  return result
}

export default function IndependentStudentApprovals({ onLogout }) {
  const [status, setStatus] = useState('pending')
  const [students, setStudents] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const loadMoreRef = useRef(null)
  const loadingMoreRef = useRef(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [retry, setRetry] = useState(0)
  const registrationDetails = selectedStudent
    ? { ...registrationFieldDefaults, ...(selectedStudent.registrationDetails || {}) }
    : {}

  const loadStudents = useCallback(async (signal) => {
    if (page === 1) loadingMoreRef.current = false
    setLoading(true)
    setError('')
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      const auth = savedAuth ? JSON.parse(savedAuth) : null
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        return
      }
      const query = new URLSearchParams({ status, page: String(page), pageSize: '25' })
      const response = await fetch(`${API_BASE_URL}/admin/independent-student-approvals?${query}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal,
      })
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      const result = await readResponse(response)
      if (!Array.isArray(result.students) || !Number.isInteger(result.total) ||
        !Number.isInteger(result.pendingCount)) {
        throw new Error('The server returned invalid approval records.')
      }
      if (page === 1) {
        setStudents(result.students)
      } else {
        setStudents((current) => {
          const next = [...current]
          const seenIds = new Set(current.map((student) => String(student._id)))
          for (const student of result.students) {
            const id = String(student._id)
            if (!seenIds.has(id)) {
              seenIds.add(id)
              next.push(student)
            }
          }
          return next
        })
      }
      setTotal(result.total)
      setPendingCount(result.pendingCount)
    } catch (loadError) {
      if (loadError.name !== 'AbortError') {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load applications.')
        if (page === 1) {
          setStudents([])
          setTotal(0)
        }
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false)
        loadingMoreRef.current = false
      }
    }
  }, [onLogout, page, status])

  useEffect(() => {
    const controller = new AbortController()
    loadStudents(controller.signal)
    return () => controller.abort()
  }, [loadStudents, retry])

  useEffect(() => {
    const sentinel = loadMoreRef.current
    if (
      loading ||
      error ||
      students.length >= total ||
      !sentinel ||
      typeof IntersectionObserver === 'undefined'
    ) return undefined

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingMoreRef.current) {
        loadingMoreRef.current = true
        setPage((current) => current + 1)
      }
    }, { rootMargin: '240px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [error, loading, students.length, total])

  async function getAuthorization() {
    const savedAuth = sessionStorage.getItem('lms.auth')
    const auth = savedAuth ? JSON.parse(savedAuth) : null
    if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
      onLogout()
      return null
    }
    return auth
  }

  async function reviewStudent(student) {
    setSelectedStudent(student)
    setRejectionReason('')
    setRejecting(false)
    setDetailsLoading(true)
    setError('')
    try {
      const auth = await getAuthorization()
      if (!auth) return
      const response = await fetch(
        `${API_BASE_URL}/admin/independent-students/${encodeURIComponent(student._id)}/approval-details`,
        { headers: { Authorization: `Bearer ${auth.token}` } },
      )
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      const result = await readResponse(response)
      if (!result.student) throw new Error('The server returned incomplete application details.')
      setSelectedStudent(result.student)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load application details.')
    } finally {
      setDetailsLoading(false)
    }
  }

  async function decide(student, decision, reason = '') {
    if (decision === 'approve' && !window.confirm(`Approve ${student.fullName || student.email}'s account?`)) return
    if (decision === 'reject' && !rejecting) {
      setSelectedStudent(student)
      setRejecting(true)
      setRejectionReason('')
      return
    }

    setActionInProgress(student._id)
    setError('')
    setMessage('')
    try {
      const auth = await getAuthorization()
      if (!auth) return
      const response = await fetch(
        `${API_BASE_URL}/admin/independent-students/${encodeURIComponent(student._id)}/approval`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${auth.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ decision, ...(decision === 'reject' ? { reason } : {}) }),
        },
      )
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      const result = await readResponse(response)
      setMessage(result.message)
      setSelectedStudent(null)
      setRejecting(false)
      setStudents((current) => current.filter((entry) => entry._id !== student._id))
      setPendingCount((count) => Math.max(0, count - 1))
      setPage(1)
      setRetry((current) => current + 1)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to update the application.')
    } finally {
      setActionInProgress('')
    }
  }

  return (
    <section className="independent-approvals">
      <header className="independent-approvals__heading">
        <div>
          <p className="admin-eyebrow">USER MANAGEMENT</p>
          <h1>Student Approval</h1>
          <p>Review external student account applications before granting LMS access.</p>
        </div>
      </header>

      <div className="admin-panel independent-approvals__panel">
        <div className="independent-approvals__filters" role="tablist" aria-label="Approval status">
          {filters.map(([value, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={status === value}
              className={status === value ? 'is-selected' : ''}
              key={value}
              onClick={() => {
                setPage(1)
                setStatus(value)
              }}
            >{label}{value === 'pending' && <span>{pendingCount}</span>}</button>
          ))}
        </div>
        {message && <p className="admin-import-result" role="status">{message}</p>}
        {error && <div className="admin-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
        {loading && page === 1 ? <p className="admin-loading" role="status">Loading applications…</p> : students.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table independent-approvals__table">
              <thead>
                <tr>
                  <th>Student Name</th><th>Email</th><th>Registration Date</th>
                  <th>Student Type</th><th>Approval Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student._id}>
                    <td>{student.fullName || 'Unnamed student'}</td>
                    <td>{student.email}</td>
                    <td>{formatDate(student.createdAt)}</td>
                    <td>Independent</td>
                    <td><span className={`admin-status admin-status--${student.approvalStatus}`}>{student.approvalStatus}</span></td>
                    <td className="independent-approvals__actions">
                      <button type="button" className="admin-text-button" onClick={() => reviewStudent(student)}>View Details</button>
                      {student.approvalStatus === 'pending' && (
                        <>
                          <button type="button" className="admin-button admin-button--primary" disabled={Boolean(actionInProgress)} onClick={() => decide(student, 'approve')}>Approve</button>
                          <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(actionInProgress)} onClick={() => decide(student, 'reject')}>Reject</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading && !error ? <p className="independent-approvals__empty">No {status === 'all' ? '' : `${status} `}independent student applications.</p> : null}
        <div className="independent-approvals__load-more" ref={loadMoreRef} aria-live="polite">
          {total > 0 && <span>{Math.min(students.length, total)} of {total} applications loaded</span>}
          {loading && students.length > 0 && <span role="status">Loading more applications…</span>}
        </div>
      </div>

      {selectedStudent && (
        <div className="independent-approvals__backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !actionInProgress) setSelectedStudent(null)
        }}>
          <section className="independent-approvals__dialog" role="dialog" aria-modal="true" aria-labelledby="independent-approval-title">
            <header>
              <div><p className="admin-eyebrow">APPLICATION DETAILS</p><h2 id="independent-approval-title">Student application</h2></div>
              <button type="button" aria-label="Close application details" onClick={() => setSelectedStudent(null)}>×</button>
            </header>
            {detailsLoading ? <p className="admin-loading">Loading details…</p> : (
              <>
                <section className="independent-approvals__details-section">
                  <h3>Registration details</h3>
                  <dl>
                    {Object.entries(registrationDetails).map(([field, value]) => (
                      <div key={field}>
                        <dt>{registrationFieldLabel(field)}</dt>
                        <dd>{registrationFieldValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="independent-approvals__security-note">
                    Password and confirmation are intentionally hidden for security.
                  </p>
                </section>
                <section className="independent-approvals__details-section">
                  <h3>Application status</h3>
                  <dl>
                    <div><dt>Registration Date</dt><dd>{formatDate(selectedStudent.createdAt)}</dd></div>
                    <div><dt>Approval Status</dt><dd><span className={`admin-status admin-status--${selectedStudent.approvalStatus}`}>{selectedStudent.approvalStatus}</span></dd></div>
                    <div>
                      <dt>Approval Date</dt>
                      <dd>{selectedStudent.approvedAt
                        ? formatDate(selectedStudent.approvedAt)
                        : selectedStudent.approvalStatus === 'approved' ? 'Not recorded' : 'Not approved'}</dd>
                    </div>
                    {selectedStudent.rejectionReason && (
                      <div className="independent-approvals__detail-wide">
                        <dt>Rejection Reason</dt><dd>{selectedStudent.rejectionReason}</dd>
                      </div>
                    )}
                  </dl>
                </section>
                {selectedStudent.approvalStatus === 'pending' && (
                  <>
                    {rejecting && (
                      <label className="independent-approvals__reason">
                        Optional rejection reason
                        <textarea maxLength={1000} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} />
                      </label>
                    )}
                    <div className="independent-approvals__dialog-actions">
                      {rejecting ? (
                        <>
                          <button type="button" className="admin-button admin-button--secondary" onClick={() => setRejecting(false)}>Cancel</button>
                          <button type="button" className="admin-button admin-button--danger" disabled={Boolean(actionInProgress)} onClick={() => decide(selectedStudent, 'reject', rejectionReason)}>Confirm Reject</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="admin-button admin-button--primary" disabled={Boolean(actionInProgress)} onClick={() => decide(selectedStudent, 'approve')}>Approve</button>
                          <button type="button" className="admin-button admin-button--danger" disabled={Boolean(actionInProgress)} onClick={() => decide(selectedStudent, 'reject')}>Reject</button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  )
}
