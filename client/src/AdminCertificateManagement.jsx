import React, { useEffect, useState } from 'react'
import { isInvalidSessionResponse } from './auth-session.js'
import './AdminCertificateManagement.css'

const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:5000/api'
).replace(/\/+$/, '')

async function adminCertificateRequest(path, onLogout, { method = 'GET', body } = {}) {
  let auth
  try {
    auth = JSON.parse(sessionStorage.getItem('lms.auth') || 'null')
  } catch {
    onLogout()
    throw new Error('Your saved administrator session is invalid. Please sign in again.')
  }
  if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
    onLogout()
    throw new Error('Your administrator session has ended.')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let result
  try {
    result = text ? JSON.parse(text) : {}
  } catch {
    throw new Error('The server returned an invalid response.')
  }
  if (isInvalidSessionResponse(response, result)) onLogout()
  if (!response.ok) throw new Error(result.message || 'The assignment review request could not be completed.')
  return result
}

export default function AdminCertificateManagement({ onBack, onLogout }) {
  const [submissions, setSubmissions] = useState([])
  const [reviewComments, setReviewComments] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [activeReview, setActiveReview] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadManagement() {
    setIsLoading(true)
    setError('')
    try {
      const submissionResult = await adminCertificateRequest('/admin/assignment-submissions', onLogout)
      setSubmissions(submissionResult.submissions || [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Assignment reviews could not be loaded.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadManagement() }, [])

  async function downloadSubmission(submission) {
    setError('')
    try {
      let auth
      try {
        auth = JSON.parse(sessionStorage.getItem('lms.auth') || 'null')
      } catch {
        onLogout()
        throw new Error('Your saved administrator session is invalid. Please sign in again.')
      }
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        throw new Error('Your administrator session has ended.')
      }
      const response = await fetch(`${API_BASE_URL}/admin/assignment-submissions/${encodeURIComponent(submission.id)}/download`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        if (isInvalidSessionResponse(response, result)) onLogout()
        throw new Error(result.message || 'The assignment file could not be downloaded.')
      }
      const objectUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = submission.fileName
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'The assignment file could not be downloaded.')
    }
  }

  async function reviewSubmission(submission, reviewStatus) {
    setActiveReview(submission.id)
    setError('')
    setNotice('')
    try {
      await adminCertificateRequest(`/admin/assignment-submissions/${encodeURIComponent(submission.id)}/review`, onLogout, {
        method: 'PATCH',
        body: { reviewStatus, reviewComment: reviewComments[submission.id] || '' },
      })
      setSubmissions((current) => current.filter((entry) => entry.id !== submission.id))
      setNotice(reviewStatus === 'approved'
        ? `Approved ${submission.assignmentName}. Certificate eligibility was updated.`
        : `Rejected ${submission.assignmentName}. The student must submit the assignment again.`)
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'The assignment review could not be saved.')
    } finally {
      setActiveReview('')
    }
  }

  return (
    <div className="admin-course-workspace">
      <div className="ac-library admin-certificate-management">
        <div className="ac-page-heading">
          <div>
            <p className="ac-eyebrow">COURSE MANAGEMENT</p>
            <h1>Assignment reviews</h1>
            <p>Review required assignment submissions that affect certificate eligibility.</p>
          </div>
          <button type="button" className="ac-button ac-button--outline" onClick={onBack}>← Course management</button>
        </div>
        {notice && <p className="ac-success" role="status">{notice}</p>}
        {error && <p className="ac-inline-error" role="alert">{error}</p>}

        <section className="ac-certificate-panel" aria-labelledby="ac-assignment-review-title">
          <div className="ac-certificate-review-heading">
            <div>
              <p className="ac-eyebrow">REQUIRED ASSIGNMENTS</p>
              <h2 id="ac-assignment-review-title">Submissions awaiting review <span>{submissions.length}</span></h2>
              <p>Approving a submission completes that required assignment for certificate eligibility.</p>
            </div>
            <button type="button" className="ac-button ac-button--outline" onClick={loadManagement} disabled={isLoading}>
              {isLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {isLoading ? <div className="ac-empty-state"><span className="ac-spinner" />Loading assignment submissions…</div>
            : submissions.length === 0 ? <div className="ac-empty-state"><span aria-hidden="true">✓</span><strong>No submissions awaiting review</strong><p>New assignment submissions will appear here.</p></div>
              : <div className="ac-certificate-submissions">
                {submissions.map((submission) => (
                  <article className="ac-certificate-submission" key={submission.id}>
                    <div className="ac-certificate-submission__details">
                      <strong>{submission.assignmentName}</strong>
                      <span>{submission.studentName}{submission.studentEmail ? ` · ${submission.studentEmail}` : ''}</span>
                      <span>{submission.courseName} · Submitted {new Date(submission.submittedAt).toLocaleString()}</span>
                      <button type="button" className="ac-text-button" onClick={() => downloadSubmission(submission)}>
                        Download {submission.fileName}
                      </button>
                    </div>
                    <label className="ac-field">
                      <span>Feedback (optional)</span>
                      <textarea
                        rows="2"
                        maxLength="1000"
                        value={reviewComments[submission.id] || ''}
                        onChange={(event) => setReviewComments((current) => ({ ...current, [submission.id]: event.target.value }))}
                      />
                    </label>
                    <div className="ac-certificate-submission__actions">
                      <button type="button" className="ac-button ac-button--outline" disabled={activeReview === submission.id} onClick={() => reviewSubmission(submission, 'rejected')}>Reject</button>
                      <button type="button" className="ac-button ac-button--gold" disabled={activeReview === submission.id} onClick={() => reviewSubmission(submission, 'approved')}>{activeReview === submission.id ? 'Saving…' : 'Approve'}</button>
                    </div>
                  </article>
                ))}
              </div>}
        </section>
      </div>
    </div>
  )
}
