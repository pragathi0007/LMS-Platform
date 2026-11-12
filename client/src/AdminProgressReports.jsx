import React, { useCallback, useEffect, useState } from 'react'
import { API_BASE_URL } from './api-base-url.js'
import './AdminProgressReports.css'

const STUDENT_PAGE_SIZE = 100

async function requestAdminJson(path, onLogout, signal, { method = 'GET', body: requestBody } = {}) {
  let auth
  try {
    const storedAuth = sessionStorage.getItem('lms.auth')
    auth = storedAuth ? JSON.parse(storedAuth) : null
  } catch {
    onLogout()
    throw new Error('Your admin session could not be verified. Sign in again.')
  }
  if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
    onLogout()
    throw new Error('Your admin session has expired. Sign in again.')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(requestBody ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
    signal,
  })
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error('The server returned an invalid report response.')
  }
  if (response.status === 401 || response.status === 403) {
    onLogout()
    throw new Error(body.message || 'Your admin session has expired. Sign in again.')
  }
  if (!response.ok) throw new Error(body.message || 'The report could not be loaded.')
  return body
}

async function requestAdminFile(path, onLogout) {
  let auth
  try {
    const storedAuth = sessionStorage.getItem('lms.auth')
    auth = storedAuth ? JSON.parse(storedAuth) : null
  } catch {
    onLogout()
    throw new Error('Your admin session could not be verified. Sign in again.')
  }
  if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
    onLogout()
    throw new Error('Your admin session has expired. Sign in again.')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  })
  if (response.status === 401 || response.status === 403) {
    let message
    try {
      message = (await response.json()).message
    } catch {
      message = ''
    }
    onLogout()
    throw new Error(message || 'Your admin session has expired. Sign in again.')
  }
  if (!response.ok) {
    let message
    try {
      message = (await response.json()).message
    } catch {
      message = ''
    }
    throw new Error(message || 'The file could not be loaded.')
  }
  return response.blob()
}

function formatDate(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatMarks(obtained, maximum) {
  if (!Number.isFinite(obtained) || !Number.isFinite(maximum)) return 'Not recorded'
  return `${obtained} / ${maximum}`
}

function formatMarkSummary(summary) {
  if (!summary) return 'Not recorded'
  const marks = formatMarks(summary.marksObtained, summary.maximumMarks)
  return Number.isFinite(summary.percentage) ? `${marks} · ${summary.percentage}%` : marks
}

function formatEvaluationStatus(value) {
  if (value === 'evaluated') return 'Evaluated'
  if (value === 're_evaluation_required') return 'Re-evaluation Required'
  return 'Pending'
}

function formatLessonStatus(value) {
  if (value === 'completed') return 'Completed'
  if (value === 'in_progress') return 'In progress'
  if (value === 'pending') return 'Pending'
  return 'Not started'
}

function getQuizQuestion(attempt, answer, index) {
  const questions = attempt.questions || attempt.questionSnapshot || []
  return questions.find((question) => String(question.id || question._id || question.questionId) === String(answer.questionId))
    || questions[index]
    || null
}

function answerText(question, answer, answerKey) {
  const direct = answer[answerKey]
  if (typeof direct === 'string') return direct
  if (Array.isArray(direct)) return direct.join(', ')
  const indices = answerKey === 'selectedAnswers'
    ? answer.selectedOptionIndices
    : answer.correctOptionIndices
  if (Array.isArray(indices) && question?.options) {
    return indices.map((optionIndex) => {
      const option = question.options[optionIndex]
      return typeof option === 'string' ? option : option?.text || option?.label || ''
    }).filter(Boolean).join(', ')
  }
  return Array.isArray(indices) ? indices.map((value) => `Option ${Number(value) + 1}`).join(', ') : 'Not recorded'
}

function getCourseLessons(course) {
  if (Array.isArray(course.lessons)) return course.lessons
  return [
    ...(course.completedLessons || []).map((lesson) => ({ ...lesson, status: 'completed' })),
    ...(course.pendingLessons || []).map((lesson) => ({ ...lesson, status: 'pending' })),
  ]
}

function getCourseCertificates(certificates, courseId) {
  if (courseId == null) return []
  return (certificates || []).filter((certificate) => (
    certificate.courseId != null && String(certificate.courseId) === String(courseId)
  ))
}

function getUnassignedCertificates(certificates, courses) {
  return (certificates || []).filter((certificate) => !courses.some((course) => (
    course.courseId != null
      && certificate.courseId != null
      && String(course.courseId) === String(certificate.courseId)
  )))
}

function CourseCertificateCard({ certificate, onView, onDownload }) {
  return (
    <article className="admin-progress-course-certificate">
      <div>
        <span className="admin-progress-certificate-badge">Earned</span>
        <strong>{certificate.name}</strong>
        {certificate.courseName && <span>{certificate.courseName}</span>}
        <span>Issued {formatDate(certificate.issuedAt)}</span>
        <code>{certificate.certificateId}</code>
      </div>
      <div className="admin-progress-course-certificate__actions">
        <button type="button" className="admin-progress-link" onClick={() => onView(certificate)}>View</button>
        <button type="button" className="admin-progress-link" onClick={() => onDownload(certificate)}>Download</button>
      </div>
    </article>
  )
}

function SubmissionEvaluationForm({ submission, saving, onSave }) {
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    const formData = new FormData(event.currentTarget)
    const marksObtained = Number(formData.get('marksObtained'))
    const maximumMarks = Number(submission.maximumMarks)
    if (!Number.isFinite(maximumMarks) || maximumMarks < 0) {
      setError('A valid maximum mark is not available for this submission.')
      return
    }
    if (!Number.isFinite(marksObtained) || marksObtained < 0 || marksObtained > maximumMarks) {
      setError(`Enter marks from 0 to ${maximumMarks}.`)
      return
    }
    try {
      await onSave(submission, {
        marksObtained,
        feedback: String(formData.get('feedback') || ''),
        correctness: String(formData.get('correctness') || ''),
        evaluationStatus: String(formData.get('evaluationStatus') || 'evaluated'),
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The evaluation could not be saved.')
    }
  }

  return (
    <form className="admin-progress-evaluation-form" onSubmit={handleSubmit}>
      <h5>{submission.evaluationHistory?.length ? 'Update evaluation' : 'Evaluate submission'}</h5>
      {submission.maximumMarks !== null && submission.maximumMarks !== undefined ? (
        <label>
          Marks obtained (maximum {submission.maximumMarks})
          <input
            type="number"
            name="marksObtained"
            min="0"
            max={submission.maximumMarks}
            step="any"
            required
            defaultValue={submission.marksObtained ?? ''}
          />
        </label>
      ) : <p className="admin-progress-empty">Evaluation is unavailable because the maximum marks are not configured.</p>}
      <label>
        Correction result
        <select name="correctness" defaultValue={submission.correctness || 'partially_correct'}>
          <option value="correct">Correct</option>
          <option value="partially_correct">Partially Correct</option>
          <option value="incorrect">Incorrect</option>
        </select>
      </label>
      <label>
        Evaluation status
        <select name="evaluationStatus" defaultValue={submission.evaluationStatus === 're_evaluation_required' ? 're_evaluation_required' : 'evaluated'}>
          <option value="evaluated">Evaluated</option>
          <option value="re_evaluation_required">Re-evaluation Required</option>
        </select>
      </label>
      <label>
        Correction comments and feedback
        <textarea name="feedback" rows="3" maxLength="5000" defaultValue={submission.feedback || ''} />
      </label>
      {error && <p className="admin-progress-error" role="alert">{error}</p>}
      <button type="submit" className="admin-button admin-button--primary" disabled={saving || submission.maximumMarks == null}>
        {saving ? 'Saving…' : 'Save evaluation'}
      </button>
    </form>
  )
}

function AssignmentSubmissionCard({ submission, saving, onSaveEvaluation, onOpenFile }) {
  const supportsInlinePreview = ['application/pdf', 'text/plain'].includes(submission.contentType)
  return (
    <article className="admin-progress-submission">
      <div className="admin-progress-submission__header">
        <div>
          <h5>{submission.assignmentName || 'Assignment or practical submission'}</h5>
          <span>Submitted {formatDate(submission.submittedAt)}</span>
        </div>
        <span className={`admin-progress-status admin-progress-status--${submission.evaluationStatus || 'pending'}`}>
          {formatEvaluationStatus(submission.evaluationStatus)}
        </span>
      </div>
      {submission.instructions && <p className="admin-progress-submission__instructions">{submission.instructions}</p>}
      {submission.answer && (
        <div className="admin-progress-submission__answer">
          <strong>Written answer</strong>
          <p>{submission.answer}</p>
        </div>
      )}
      {submission.fileName && (
        <div className="admin-progress-submission__file">
          <span>{submission.fileName}{submission.fileSize ? ` · ${(submission.fileSize / 1024).toFixed(1)} KB` : ''}</span>
          {supportsInlinePreview && (
            <button type="button" className="admin-progress-link" onClick={() => onOpenFile(submission, 'view')}>Preview</button>
          )}
          <button type="button" className="admin-progress-link" onClick={() => onOpenFile(submission, 'download')}>Download</button>
        </div>
      )}
      <div className="admin-progress-submission__result">
        <span>Marks: <strong>{formatMarks(submission.marksObtained, submission.maximumMarks)}</strong></span>
        {submission.correctness && <span>Result: <strong>{submission.correctness.replace(/_/g, ' ')}</strong></span>}
        {submission.feedback && <p><strong>Feedback:</strong> {submission.feedback}</p>}
      </div>
      {submission.evaluationHistory?.length > 0 && (
        <details className="admin-progress-evaluation-history">
          <summary>Evaluation history ({submission.evaluationHistory.length})</summary>
          <ol>
            {submission.evaluationHistory.map((entry, index) => (
              <li key={entry.id || `${entry.evaluatedAt}-${index}`}>
                <strong>{formatMarks(entry.marksObtained, entry.maximumMarks)}</strong>
                <span>{entry.correctness ? entry.correctness.replace(/_/g, ' ') : ''}</span>
                <time>{formatDate(entry.evaluatedAt)}</time>
                {entry.evaluatorId && <code>Evaluator {entry.evaluatorId}</code>}
                {entry.feedback && <p>{entry.feedback}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      <SubmissionEvaluationForm submission={submission} saving={saving} onSave={onSaveEvaluation} />
    </article>
  )
}

function StudentProgressDialog({
  student,
  report,
  loading,
  error,
  onClose,
  onPrint,
  onSaveEvaluation,
  onOpenSubmissionFile,
  savingEvaluationIds,
  onViewCertificate,
  onDownloadCertificate,
}) {
  const unassignedCertificates = report
    ? getUnassignedCertificates(report.certificates, report.courseProgress)
    : []

  return (
    <div className="admin-progress-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="admin-progress-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-progress-dialog-title">
        <header className="admin-progress-dialog__header">
          <div>
            <p className="admin-eyebrow">INDIVIDUAL STUDENT REPORT</p>
            <h2 id="admin-progress-dialog-title">{report?.student?.name || student?.fullName || 'Student progress'}</h2>
            {(report?.student || student) && <p>{report?.student?.email || student?.email} · {report?.student?.id || student?._id}</p>}
          </div>
          <button type="button" className="admin-button admin-button--secondary admin-progress-print" onClick={onPrint}>Print / Save as PDF</button>
          <button type="button" className="admin-progress-dialog__close" aria-label="Close progress report" onClick={onClose}>×</button>
        </header>

        {loading && <p className="admin-progress-empty" role="status">Loading progress records…</p>}
        {error && <p className="admin-progress-error" role="alert">{error}</p>}
        {!loading && report && (
          <div className="admin-progress-dialog__body">
            <section className="admin-progress-detail-summary" aria-label="Course progress summary">
              <div><span>Enrolled courses</span><strong>{report.summary.enrolledCourses}</strong></div>
              <div><span>Completed</span><strong>{report.summary.completedCourses}</strong></div>
              <div><span>In progress</span><strong>{report.summary.inProgressCourses}</strong></div>
              <div><span>Overall completion</span><strong>{report.summary.overallCompletionPercent === null ? 'Not tracked' : `${report.summary.overallCompletionPercent}%`}</strong></div>
              <div><span>Total marks</span><strong>{formatMarkSummary(report.overallPerformance)}</strong></div>
            </section>

            <section className="admin-progress-detail-section">
              <h3>Course-wise performance</h3>
              {report.courseProgress.length ? (
                <div className="admin-progress-course-list">
                  {report.courseProgress.map((course) => {
                    const lessons = getCourseLessons(course)
                    const courseCertificates = getCourseCertificates(report.certificates, course.courseId)
                    const completionPercent = Number.isFinite(course.completionPercent)
                      ? Math.min(100, Math.max(0, course.completionPercent))
                      : null
                    return (
                    <details className="admin-progress-course" key={course.enrollmentId}>
                      <summary className="admin-progress-course__summary">
                        <div className="admin-progress-course__header">
                          <div>
                            <h4>{course.courseName}</h4>
                            <span>Course ID: {course.courseId} · Enrolled {formatDate(course.enrolledAt)}</span>
                          </div>
                          <span className="admin-progress-course__view">View Details</span>
                        </div>
                        <div className="admin-progress-course__summary-progress">
                          {completionPercent === null
                            ? <span>Progress not tracked</span>
                            : (
                              <>
                                <div
                                  className="admin-progress-course__progress-track"
                                  role="progressbar"
                                  aria-label={`${course.courseName} completion`}
                                  aria-valuemin="0"
                                  aria-valuemax="100"
                                  aria-valuenow={completionPercent}
                                >
                                  <span style={{ width: `${completionPercent}%` }} />
                                </div>
                                <strong>{completionPercent}%</strong>
                              </>
                            )}
                        </div>
                      </summary>
                      <div className="admin-progress-course__details">
                        <section className="admin-progress-course-section">
                          <h5>Course overview</h5>
                          <div className="admin-progress-course__metrics">
                            <span>Progress <strong>{course.completionPercent === null ? 'Not tracked' : `${course.completionPercent}%`}</strong></span>
                            <span>Lessons <strong>{course.completedLessonCount} completed · {course.pendingLessonCount} pending</strong></span>
                            <span>Marks <strong>{formatMarkSummary(course.marksSummary)}</strong></span>
                            <span>Status <strong>{String(course.status || 'not_started').replace(/_/g, ' ')}</strong></span>
                            <span>Assignments <strong>{course.assignmentSummary
                              ? `${course.assignmentSummary.submittedCount} of ${course.assignmentSummary.totalCount} submitted`
                              : 'Not tracked'}</strong></span>
                          </div>
                        </section>

                        <section className="admin-progress-course-section">
                          <h5>Lessons and learning progress</h5>
                          {lessons.length ? (
                            <ul className="admin-progress-lessons">
                              {lessons.map((lesson) => (
                                <li key={lesson.id}>
                                  <span>{lesson.title}</span>
                                  <span className={`admin-progress-status admin-progress-status--${lesson.status}`}>{formatLessonStatus(lesson.status)}</span>
                                  <time>{lesson.status === 'completed' ? formatDate(lesson.completedAt) : '—'}</time>
                                </li>
                              ))}
                            </ul>
                          ) : <p className="admin-progress-empty">No lesson progress is recorded.</p>}
                        </section>

                        <section className="admin-progress-course-section">
                          <h5>Quizzes and marks</h5>
                          {course.quizAttempts?.length ? course.quizAttempts.map((attempt) => (
                            <article className="admin-progress-quiz" key={attempt.id}>
                              <div className="admin-progress-quiz__header">
                                <div><strong>{attempt.quizName || 'Quiz'}</strong><span>{formatDate(attempt.submittedAt || attempt.startedAt)}</span></div>
                                <strong>{formatMarks(attempt.earnedPoints, attempt.totalPoints)}</strong>
                              </div>
                              <p>
                                {attempt.questionCount ?? attempt.questions?.length ?? 0} questions · {attempt.correctAnswers ?? '—'} correct · {attempt.scorePercentage === null ? 'Not scored' : `${attempt.scorePercentage}%`}
                                {attempt.passed === null || attempt.passed === undefined ? ` · ${attempt.status}` : ` · ${attempt.passed ? 'Passed' : 'Failed'}`}
                              </p>
                              {attempt.answers?.length > 0 && (
                                <details className="admin-progress-quiz__answers">
                                  <summary>Inspect recorded answers ({attempt.answers.length})</summary>
                                  <ol>
                                    {attempt.answers.map((answer, index) => {
                                      const question = getQuizQuestion(attempt, answer, index)
                                      return (
                                        <li key={answer.questionId || index}>
                                          <strong>{question?.question || question?.text || question?.prompt || `Question ${index + 1}`}</strong>
                                          <span>Your answer: {answerText(question, answer, 'selectedAnswers')}</span>
                                          <span>Correct answer: {answerText(question, answer, 'correctAnswers')}</span>
                                        </li>
                                      )
                                    })}
                                  </ol>
                                </details>
                              )}
                            </article>
                          )) : <p className="admin-progress-empty">No quiz attempts are recorded for this course.</p>}
                        </section>

                        <section className="admin-progress-course-section">
                          <h5>Assignments and practical submissions</h5>
                          {course.assignmentSummary && (
                            <p className="admin-progress-assignment-summary">
                              {course.assignmentSummary.totalCount === null
                                ? 'Assignment completion is not tracked for this course.'
                                : `${course.assignmentSummary.submittedCount} of ${course.assignmentSummary.totalCount} assignments submitted`}
                            </p>
                          )}
                          {course.submissions?.length ? course.submissions.map((submission) => (
                            <AssignmentSubmissionCard
                              key={submission.id}
                              submission={submission}
                              saving={Boolean(savingEvaluationIds[submission.id])}
                              onSaveEvaluation={onSaveEvaluation}
                              onOpenFile={onOpenSubmissionFile}
                            />
                          )) : <p className="admin-progress-empty">No assignment or practical submissions are recorded for this course.</p>}
                        </section>

                        <section className="admin-progress-course-section">
                          <h5>Earned certificates</h5>
                          {!report.certificateRecordsAvailable
                            ? <p className="admin-progress-empty">Certificate records are unavailable.</p>
                            : courseCertificates.length
                              ? (
                                <div className="admin-progress-course-certificates">
                                  {courseCertificates.map((certificate) => (
                                    <CourseCertificateCard
                                      key={certificate.id}
                                      certificate={certificate}
                                      onView={onViewCertificate}
                                      onDownload={onDownloadCertificate}
                                    />
                                  ))}
                                </div>
                              )
                              : <p className="admin-progress-empty">No earned certificates for this course.</p>}
                        </section>
                      </div>
                    </details>
                    )
                  })}
                </div>
              ) : <p className="admin-progress-empty">No active course enrollments are recorded for this student.</p>}
            </section>

            {report.certificateRecordsAvailable && unassignedCertificates.length > 0 && (
              <section className="admin-progress-detail-section">
                <h3>Certificates from courses not currently enrolled</h3>
                <div className="admin-progress-course-certificates">
                  {unassignedCertificates.map((certificate) => (
                    <CourseCertificateCard
                      key={certificate.id}
                      certificate={certificate}
                      onView={onViewCertificate}
                      onDownload={onDownloadCertificate}
                    />
                  ))}
                </div>
              </section>
            )}

          </div>
        )}
      </section>
    </div>
  )
}

export default function AdminProgressReports({ onLogout }) {
  const [students, setStudents] = useState([])
  const [studentTotal, setStudentTotal] = useState(0)
  const [studentPage, setStudentPage] = useState(1)
  const [studentError, setStudentError] = useState('')
  const [isLoadingStudents, setIsLoadingStudents] = useState(false)
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState('')
  const [isLoadingSummary, setIsLoadingSummary] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [progressReport, setProgressReport] = useState(null)
  const [progressError, setProgressError] = useState('')
  const [isLoadingProgress, setIsLoadingProgress] = useState(false)
  const [savingEvaluationIds, setSavingEvaluationIds] = useState({})

  const loadStudents = useCallback(async (page, append = false, signal) => {
    setIsLoadingStudents(true)
    setStudentError('')
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(STUDENT_PAGE_SIZE),
        tab: 'all',
        filterType: 'all',
        approvalStatus: 'all',
      })
      const result = await requestAdminJson(`/admin/students?${params}`, onLogout, signal)
      if (!Array.isArray(result.students) || !Number.isInteger(result.total)) {
        throw new Error('The server returned invalid student report data.')
      }
      setStudents((current) => append ? [...current, ...result.students] : result.students)
      setStudentTotal(result.total)
      setStudentPage(result.page)
    } catch (error) {
      if (error.name !== 'AbortError') setStudentError(error instanceof Error ? error.message : 'Unable to load students.')
    } finally {
      if (!signal?.aborted) setIsLoadingStudents(false)
    }
  }, [onLogout])

  const loadSummary = useCallback(async (signal) => {
    setIsLoadingSummary(true)
    setSummaryError('')
    try {
      const result = await requestAdminJson('/admin/reports/progress/summary', onLogout, signal)
      if (typeof result.certificateRecordsAvailable !== 'boolean') {
        throw new Error('The server returned an invalid progress summary.')
      }
      setSummary(result)
    } catch (error) {
      if (error.name !== 'AbortError') setSummaryError(error instanceof Error ? error.message : 'Unable to load progress summary.')
    } finally {
      if (!signal?.aborted) setIsLoadingSummary(false)
    }
  }, [onLogout])

  useEffect(() => {
    const controller = new AbortController()
    loadStudents(1, false, controller.signal)
    loadSummary(controller.signal)
    return () => controller.abort()
  }, [loadStudents, loadSummary])

  const openProgressReport = async (student) => {
    setSelectedStudent(student)
    setProgressReport(null)
    setProgressError('')
    setIsLoadingProgress(true)
    try {
      const report = await requestAdminJson(
        `/admin/reports/progress/${encodeURIComponent(student.studentType)}/${encodeURIComponent(student._id)}`,
        onLogout,
      )
      setProgressReport(report)
    } catch (error) {
      setProgressError(error instanceof Error ? error.message : 'Unable to load student progress.')
    } finally {
      setIsLoadingProgress(false)
    }
  }

  const openCertificate = async (certificate, action) => {
    const download = action === 'download'
    const certificateUrl = download ? certificate.downloadUrl : certificate.viewUrl
    if (typeof certificateUrl !== 'string' || !certificateUrl.startsWith('/certificates/')) {
      setProgressError('This certificate does not have a valid file URL.')
      return
    }

    const viewWindow = download ? null : window.open('about:blank', '_blank')
    if (!download && !viewWindow) {
      setProgressError('Allow pop-ups to view the certificate.')
      return
    }

    try {
      const file = await requestAdminFile(certificateUrl, onLogout)
      const fileUrl = URL.createObjectURL(file)
      if (download) {
        const link = document.createElement('a')
        link.href = fileUrl
        link.download = `${certificate.certificateId}.svg`
        document.body.appendChild(link)
        link.click()
        link.remove()
      } else {
        viewWindow.opener = null
        viewWindow.location.href = fileUrl
      }
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000)
    } catch (error) {
      viewWindow?.close()
      setProgressError(error instanceof Error ? error.message : 'The certificate could not be loaded.')
    }
  }

  const saveEvaluation = async (submission, evaluation) => {
    setSavingEvaluationIds((current) => ({ ...current, [submission.id]: true }))
    try {
      const result = await requestAdminJson(
        `/admin/reports/progress/submissions/${encodeURIComponent(submission.id)}/evaluation`,
        onLogout,
        undefined,
        { method: 'PUT', body: evaluation },
      )
      const updatedSubmission = result.submission || result
      if (!updatedSubmission.id || !Array.isArray(updatedSubmission.evaluationHistory)) {
        throw new Error('The server did not confirm the saved evaluation history.')
      }
      setProgressReport((current) => current && ({
        ...current,
        courseProgress: current.courseProgress.map((course) => ({
          ...course,
          submissions: (course.submissions || []).map((item) => (
            item.id === submission.id ? updatedSubmission : item
          )),
        })),
      }))
    } finally {
      setSavingEvaluationIds((current) => ({ ...current, [submission.id]: false }))
    }
  }

  const openSubmissionFile = async (submission, action) => {
    const download = action === 'download'
    if (typeof submission.fileUrl !== 'string' || !submission.fileUrl.startsWith('/admin/reports/progress/submissions/')) {
      setProgressError('This submission does not have a valid file URL.')
      return
    }

    const viewWindow = download ? null : window.open('about:blank', '_blank')
    if (!download && !viewWindow) {
      setProgressError('Allow pop-ups to preview this submission.')
      return
    }
    if (viewWindow) viewWindow.opener = null
    try {
      const file = await requestAdminFile(submission.fileUrl, onLogout)
      const fileUrl = URL.createObjectURL(file)
      if (download) {
        const link = document.createElement('a')
        link.href = fileUrl
        link.download = submission.fileName || `submission-${submission.id}`
        document.body.appendChild(link)
        link.click()
        link.remove()
      } else {
        viewWindow.location.href = fileUrl
      }
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000)
    } catch (error) {
      viewWindow?.close()
      setProgressError(error instanceof Error ? error.message : 'The submission file could not be loaded.')
    }
  }

  return (
    <div className="admin-progress-reports">
      <div className="admin-progress-reports__toolbar">
        <div>
          <h2>Student progress</h2>
          <p>Progress from independent and college student enrollment records.</p>
        </div>
        <button
          type="button"
          className="admin-button admin-button--secondary"
          onClick={() => {
            loadStudents(1)
            loadSummary()
          }}
          disabled={isLoadingStudents || isLoadingSummary}
        >
          {isLoadingStudents || isLoadingSummary ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {summaryError && <p className="admin-progress-error" role="alert">{summaryError}</p>}

      {summary && !summary.certificateRecordsAvailable && (
        <section className="admin-progress-chart">
          <h3>Earned certificates</h3>
          <p className="admin-progress-empty">Certificate issuance records are not stored in the current database schema. No certificate names, issue dates, or download links can be verified.</p>
        </section>
      )}

      <section className="admin-progress-students">
        <div className="admin-progress-students__heading">
          <div><h3>Student progress reports</h3><span>{studentTotal} students</span></div>
        </div>
        {studentError && <p className="admin-progress-error" role="alert">{studentError}</p>}
        {isLoadingStudents && students.length === 0
          ? <p className="admin-progress-empty" role="status">Loading student records…</p>
          : !studentError && students.length === 0
            ? <p className="admin-progress-empty">No student records are available.</p>
            : (
              <>
                <div className="admin-progress-table-wrap">
                  <table className="admin-progress-table">
                    <thead><tr><th>Student name</th><th>User ID</th><th>Email</th><th>Progress</th></tr></thead>
                    <tbody>
                      {students.map((student) => (
                        <tr key={`${student.studentType}-${student._id}`}>
                          <td>
                            <strong>{student.fullName || student.username || 'Name unavailable'}</strong>
                            <span className="admin-progress-student-type">{student.studentType === 'college' ? 'College student' : 'Independent student'}</span>
                          </td>
                          <td><code>{student._id}</code></td>
                          <td>{student.email || 'Email unavailable'}</td>
                          <td><button type="button" className="admin-progress-link" onClick={() => openProgressReport(student)}>View Progress</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {students.length < studentTotal && (
                  <div className="admin-progress-load-more">
                    <button
                      type="button"
                      className="admin-button admin-button--secondary"
                      onClick={() => loadStudents(studentPage + 1, true)}
                      disabled={isLoadingStudents}
                    >
                      {isLoadingStudents ? 'Loading…' : 'Load more students'}
                    </button>
                  </div>
                )}
              </>
            )}
      </section>

      {selectedStudent && (
        <StudentProgressDialog
          student={selectedStudent}
          report={progressReport}
          loading={isLoadingProgress}
          error={progressError}
          savingEvaluationIds={savingEvaluationIds}
          onPrint={() => window.print()}
          onSaveEvaluation={saveEvaluation}
          onOpenSubmissionFile={openSubmissionFile}
          onViewCertificate={(certificate) => openCertificate(certificate, 'view')}
          onDownloadCertificate={(certificate) => openCertificate(certificate, 'download')}
          onClose={() => {
            setSelectedStudent(null)
            setProgressReport(null)
            setProgressError('')
          }}
        />
      )}
    </div>
  )
}
