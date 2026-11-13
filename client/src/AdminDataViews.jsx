import React, { useEffect, useState } from 'react'
import { isInvalidSessionResponse } from './auth-session.js'
import { API_BASE_URL } from './api-base-url.js'

async function adminRequest(path, onLogout, options = {}) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
    onLogout()
    throw new Error('Your administrator session has ended.')
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const text = await response.text()
  let result
  try {
    result = text ? JSON.parse(text) : {}
  } catch {
    throw new Error('The server returned an invalid response.')
  }
  if (isInvalidSessionResponse(response, result)) onLogout()
  return { response, result }
}

function AdminDataPanel({ eyebrow, title, description, className = '', children }) {
  return (
    <div className="admin-data-page">
      <header className="admin-page-heading admin-page-heading--compact">
        <div><p className="admin-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      </header>
      <section className={`admin-panel admin-view-panel ${className}`.trim()}>
        {children}
      </section>
    </div>
  )
}

export function CollegesManagement({ onLogout }) {
  const [colleges, setColleges] = useState([])
  const [selectedCollege, setSelectedCollege] = useState(null)
  const [selectedCollegeId, setSelectedCollegeId] = useState('')
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [selectedLimitSubAdminId, setSelectedLimitSubAdminId] = useState('')
  const [isStudentLimitDialogOpen, setIsStudentLimitDialogOpen] = useState(false)
  const [studentLimitValue, setStudentLimitValue] = useState('')
  const [studentLimitError, setStudentLimitError] = useState('')
  const [studentLimitMessage, setStudentLimitMessage] = useState('')
  const [isSavingStudentLimit, setIsSavingStudentLimit] = useState(false)
  const [activeForm, setActiveForm] = useState('')
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingAccountId, setPendingAccountId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  async function loadColleges() {
    setLoadError('')
    try {
      const { response, result } = await adminRequest('/admin/colleges?includeInactive=true', onLogout)
      if (!response.ok) throw new Error(result.message || 'Unable to load colleges.')
      setColleges(result.colleges || [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load colleges.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadColleges() }, [])

  async function viewCollege(collegeId) {
    setDetailsLoading(true)
    setDetailsError('')
    setStudentLimitMessage('')
    setActiveForm('')
    setSelectedCollegeId(collegeId)
    setSelectedCollege(null)
    try {
      const { response, result } = await adminRequest(
        `/admin/colleges/${encodeURIComponent(collegeId)}/details`,
        onLogout,
      )
      if (!response.ok) throw new Error(result.message || 'Unable to load college details.')
      setSelectedCollege(result.college)
      setSelectedLimitSubAdminId((current) => (
        result.college.subAdmins.some((account) => account.id === current)
          ? current
          : result.college.studentLimitSubAdminId ||
            (result.college.subAdmins.length === 1 ? result.college.subAdmins[0].id : '')
      ))
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : 'Unable to load college details.')
    } finally {
      setDetailsLoading(false)
    }
  }

  async function submitCollege(event) {
    event.preventDefault()
    setIsSaving(true)
    setFormError('')
    setMessage('')
    try {
      const form = event.currentTarget
      const payload = Object.fromEntries(new FormData(form).entries())
      const { response, result } = await adminRequest('/admin/colleges', onLogout, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(result.message || 'Unable to create the college.')
      form.reset()
      setMessage(`College created with ID ${result.college.id}.`)
      await loadColleges()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to create the college.')
    } finally {
      setIsSaving(false)
    }
  }

  async function sendSubAdmin(event) {
    event.preventDefault()
    setIsSaving(true)
    setFormError('')
    setMessage('')
    setPendingAccountId('')
    try {
      const form = event.currentTarget
      const data = Object.fromEntries(new FormData(form).entries())
      data.studentLimit = Number(data.studentLimit)
      const { response, result } = await adminRequest(
        `/admin/colleges/${encodeURIComponent(data.collegeId)}/sub-admins`,
        onLogout,
        { method: 'POST', body: JSON.stringify(data) },
      )
      if (!response.ok) {
        if (result.accountId) setPendingAccountId(result.accountId)
        throw new Error(result.message || 'Unable to create the sub-admin account.')
      }
      form.reset()
      setMessage(result.message)
      await loadColleges()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to create the sub-admin account.')
    } finally {
      setIsSaving(false)
    }
  }

  async function resendActivation() {
    setIsSaving(true)
    setFormError('')
    setMessage('')
    try {
      const { response, result } = await adminRequest(
        `/admin/college-admins/${encodeURIComponent(pendingAccountId)}/activation`,
        onLogout,
        { method: 'POST' },
      )
      if (!response.ok) throw new Error(result.message || 'Unable to send the activation email.')
      setMessage(result.message)
      setPendingAccountId('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to send the activation email.')
    } finally {
      setIsSaving(false)
    }
  }

  const selectedLimitSubAdmin = selectedCollege?.subAdmins.find(
    (account) => account.id === selectedLimitSubAdminId,
  )

  function openStudentLimitDialog(subAdmin = null) {
    const target = subAdmin || selectedCollege?.subAdmins.find(
      (account) => account.id === selectedLimitSubAdminId,
    )
    setSelectedLimitSubAdminId(target?.id || '')
    setStudentLimitValue(Number.isSafeInteger(target?.studentLimit) ? String(target.studentLimit) : '')
    setStudentLimitError('')
    setStudentLimitMessage('')
    setIsStudentLimitDialogOpen(true)
  }

  function selectStudentLimitSubAdmin(subAdminId) {
    const subAdmin = selectedCollege?.subAdmins.find((account) => account.id === subAdminId)
    setSelectedLimitSubAdminId(subAdmin?.id || '')
    setStudentLimitValue(Number.isSafeInteger(subAdmin?.studentLimit) ? String(subAdmin.studentLimit) : '')
    setStudentLimitError('')
  }

  async function saveStudentLimit(event) {
    event.preventDefault()
    if (!selectedCollegeId || !selectedLimitSubAdminId) return
    const trimmedLimit = studentLimitValue.trim()
    const studentLimit = Number(trimmedLimit)
    if (!trimmedLimit || !Number.isSafeInteger(studentLimit) || studentLimit <= 0) {
      setStudentLimitError('Enter a positive whole number for the student limit.')
      return
    }

    setIsSavingStudentLimit(true)
    setStudentLimitError('')
    try {
      const { response, result } = await adminRequest(
        `/admin/colleges/${encodeURIComponent(selectedCollegeId)}/sub-admins/${encodeURIComponent(selectedLimitSubAdminId)}/student-limit`,
        onLogout,
        { method: 'PATCH', body: JSON.stringify({ studentLimit }) },
      )
      if (!response.ok) throw new Error(result.message || 'Unable to update the student limit.')
      setIsStudentLimitDialogOpen(false)
      await viewCollege(selectedCollegeId)
      setStudentLimitMessage('Student limit updated successfully.')
    } catch (error) {
      setStudentLimitError(error instanceof Error ? error.message : 'Unable to update the student limit.')
    } finally {
      setIsSavingStudentLimit(false)
    }
  }

  return (
    <AdminDataPanel
      eyebrow="COLLEGE MANAGEMENT"
      title="Colleges"
      description="Manage colleges, enrollment counts, and college sub-admins."
    >
      {selectedCollegeId ? (
        <section className="admin-college-details" aria-label="College details">
          <div className="admin-college-details__heading">
            <button
              className="admin-button admin-button--college-back"
              type="button"
              onClick={() => {
                setSelectedCollege(null)
                setSelectedCollegeId('')
                setDetailsError('')
                setSelectedLimitSubAdminId('')
              }}
            >← Back to colleges</button>
            {selectedCollege && <span className={`admin-status admin-status--${selectedCollege.status}`}>{selectedCollege.status}</span>}
          </div>
          {detailsLoading
            ? <p className="admin-loading" role="status">Loading college details…</p>
            : detailsError
              ? <p className="admin-inline-error" role="alert">{detailsError}</p>
              : selectedCollege && (
                <>
                  <header>
                    <p className="admin-eyebrow">COLLEGE DETAILS</p>
                    <h2>{selectedCollege.name}</h2>
                    <p>College ID: <code>{selectedCollege.id}</code></p>
                  </header>
                  {studentLimitMessage && <p className="admin-import-result" role="status">{studentLimitMessage}</p>}
                  <div className="admin-college-stats" aria-label="Student statistics">
                    <article className="admin-college-stats__limit">
                      <div>
                        <span>Student Limit</span>
                        <strong>{selectedCollege.studentLimit ?? 'Not Set'}</strong>
                      </div>
                      <button
                        type="button"
                        className="admin-button admin-button--secondary"
                        onClick={() => openStudentLimitDialog(selectedLimitSubAdmin || null)}
                        disabled={!selectedCollege.subAdmins.length}
                        title={selectedLimitSubAdmin ? `Edit limit for ${selectedLimitSubAdmin.fullName || selectedLimitSubAdmin.username}` : undefined}
                      >Edit Limit</button>
                    </article>
                    <article><span>Total Registered Students</span><strong>{selectedCollege.totalStudents ?? 0}</strong></article>
                    <article>
                      <span>Remaining Student Slots</span>
                      <strong>
                        {Number.isSafeInteger(selectedCollege.studentLimit)
                          ? Math.max(0, selectedCollege.studentLimit - (selectedCollege.totalStudents ?? 0))
                          : 'Not Set'}
                      </strong>
                    </article>
                    <article><span>Enrolled Students</span><strong>{selectedCollege.enrolledStudents ?? 0}</strong></article>
                  </div>
                  {selectedCollege.subAdmins.filter((account) => Number.isSafeInteger(account.studentLimit)).length > 1 && (
                    <p className="admin-college-limit-policy">
                      The lowest limit assigned to a Sub-Admin governs new student registrations.
                    </p>
                  )}
                  <dl>
                    <div><dt>College Code</dt><dd>{selectedCollege.code || 'Not provided'}</dd></div>
                    <div><dt>Address</dt><dd>{selectedCollege.address || 'Not provided'}</dd></div>
                    <div><dt>City</dt><dd>{selectedCollege.city || 'Not provided'}</dd></div>
                    <div><dt>State / Region</dt><dd>{selectedCollege.state || 'Not provided'}</dd></div>
                    <div><dt>Country</dt><dd>{selectedCollege.country || 'Not provided'}</dd></div>
                    <div><dt>Contact Name</dt><dd>{selectedCollege.contactName || 'Not provided'}</dd></div>
                    <div><dt>Contact Phone</dt><dd>{selectedCollege.contactPhone || 'Not provided'}</dd></div>
                    <div><dt>Contact Email</dt><dd>{selectedCollege.contactEmail || 'Not provided'}</dd></div>
                    <div><dt>Date Created</dt><dd>{selectedCollege.createdAt ? new Date(selectedCollege.createdAt).toLocaleDateString() : 'Not available'}</dd></div>
                  </dl>
                  <section className="admin-college-details__section">
                    <h3>Sub-Admins</h3>
                    {selectedCollege.subAdmins.length ? (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead><tr><th>Sub-Admin Name</th><th>Username</th><th>Email</th><th>Assigned Student Limit</th><th>Status</th><th>Action</th></tr></thead>
                          <tbody>{selectedCollege.subAdmins.map((subAdmin) => (
                            <tr key={subAdmin.id}>
                              <td>{subAdmin.fullName || 'Not provided'}</td>
                              <td>{subAdmin.username}</td>
                              <td>{subAdmin.email}</td>
                              <td>{subAdmin.studentLimit ?? 'Not Set'}</td>
                              <td>{subAdmin.isActive ? 'Active' : subAdmin.status}</td>
                              <td>
                                <button
                                  className="admin-text-button"
                                  type="button"
                                  onClick={() => openStudentLimitDialog(subAdmin)}
                                >Edit Limit</button>
                              </td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    ) : <p>No Sub-Admin Assigned</p>}
                  </section>
                  <section className="admin-college-details__section">
                    <h3>Students</h3>
                    {selectedCollege.students.length ? (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead><tr><th>Name</th><th>Email</th><th>Username</th><th>Student ID</th><th>Department</th><th>Batch</th><th>Status</th></tr></thead>
                          <tbody>{selectedCollege.students.map((student) => (
                            <tr key={student.id}>
                              <td>{student.fullName || 'Not provided'}</td>
                              <td>{student.email}</td>
                              <td>{student.username}</td>
                              <td>{student.studentId || 'Not provided'}</td>
                              <td>{student.department || 'Not provided'}</td>
                              <td>{student.batch || 'Not provided'}</td>
                              <td>{student.status || 'Not provided'}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    ) : <p>No student accounts are assigned to this college.</p>}
                  </section>
                  <section className="admin-college-details__section">
                    <h3>Assigned Courses</h3>
                    {selectedCollege.courses.length ? (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead><tr><th>Course</th><th>Status</th><th>Enrolled Students</th></tr></thead>
                          <tbody>{selectedCollege.courses.map((course) => (
                            <tr key={course.id}>
                              <td>{course.title}</td>
                              <td>{course.status}</td>
                              <td>{course.enrolledStudents}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    ) : <p>No courses have student enrollments for this college.</p>}
                  </section>
                  <section className="admin-college-details__section">
                    <h3>Enrollment Details</h3>
                    {selectedCollege.enrollments.length ? (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead><tr><th>Student</th><th>Email</th><th>Course</th><th>Status</th><th>Enrolled</th></tr></thead>
                          <tbody>{selectedCollege.enrollments.map((enrollment) => (
                            <tr key={enrollment.id}>
                              <td>{enrollment.studentName || enrollment.studentId}</td>
                              <td>{enrollment.studentEmail || 'Not provided'}</td>
                              <td>{enrollment.courseTitle}</td>
                              <td>{enrollment.status}</td>
                              <td>{enrollment.createdAt ? new Date(enrollment.createdAt).toLocaleDateString() : 'Not available'}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    ) : <p>No enrollments are recorded for this college.</p>}
                  </section>
                </>
              )}
        </section>
      ) : (
        <>
      <div className="admin-college-actions" aria-label="College actions">
        <button
          className="admin-button admin-button--primary"
          type="button"
          aria-expanded={activeForm === 'college'}
          onClick={() => setActiveForm((current) => current === 'college' ? '' : 'college')}
        >+ Add College</button>
        <button
          className="admin-button admin-button--secondary"
          type="button"
          aria-expanded={activeForm === 'sub-admin'}
          onClick={() => setActiveForm((current) => current === 'sub-admin' ? '' : 'sub-admin')}
        >+ Add Sub-Admin</button>
      </div>
      <div className="admin-data-grid">
        {activeForm === 'college' && (
        <form className="admin-data-form" onSubmit={submitCollege}>
          <h2>Create a college</h2>
          <label><span>College name</span><input name="name" maxLength="200" required /></label>
          <label><span>College code</span><input name="code" minLength="2" maxLength="40" pattern="[A-Za-z0-9-]{2,40}" required /></label>
          <label><span>Address</span><input name="address" maxLength="500" /></label>
          <div className="admin-data-form__columns">
            <label><span>City</span><input name="city" maxLength="120" /></label>
            <label><span>State / region</span><input name="state" maxLength="120" /></label>
          </div>
          <div className="admin-data-form__columns">
            <label><span>Country</span><input name="country" maxLength="120" /></label>
            <label><span>Contact email</span><input name="contactEmail" type="email" maxLength="254" /></label>
          </div>
          <div className="admin-data-form__columns">
            <label><span>Contact name</span><input name="contactName" maxLength="120" /></label>
            <label><span>Contact phone</span><input name="contactPhone" maxLength="40" /></label>
          </div>
          <button className="admin-button admin-button--primary" disabled={isSaving}>Create college</button>
        </form>
        )}

        {activeForm === 'sub-admin' && (
        <form className="admin-data-form" onSubmit={sendSubAdmin}>
          <h2>Invite a college sub-admin</h2>
          <p>They set their own password through a single-use link that expires after 24 hours.</p>
          <label>
            <span>College</span>
            <select name="collegeId" required disabled={isLoading || !colleges.some((college) => college.status === 'active')}>
              <option value="">Select a college</option>
              {colleges.filter((college) => college.status === 'active').map((college) => <option key={college.id} value={college.id}>{college.name}</option>)}
            </select>
          </label>
          <label><span>Full name</span><input name="fullName" maxLength="120" required /></label>
          <label><span>Email</span><input name="email" type="email" maxLength="254" required /></label>
          <label><span>Username</span><input name="username" minLength="3" maxLength="30" pattern="[A-Za-z0-9._-]{3,30}" required /></label>
          <label>
            <span>Student Registration Limit</span>
            <input
              name="studentLimit"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="Enter maximum number of students"
              required
            />
            <small>Maximum number of students this Sub-Admin can register for their college.</small>
          </label>
          <button className="admin-button admin-button--primary" disabled={isSaving || isLoading || !colleges.some((college) => college.status === 'active')}>
            Create account and send activation
          </button>
        </form>
        )}
      </div>
      {loadError && <p className="admin-inline-error" role="alert">{loadError}</p>}
      {formError && <p className="admin-inline-error" role="alert">{formError}</p>}
      {pendingAccountId && (
        <div className="admin-import-result" role="status">
          <p>Account {pendingAccountId} is pending activation. Configure SMTP and retry delivery.</p>
          <button className="admin-button admin-button--secondary" type="button" onClick={resendActivation} disabled={isSaving}>
            Retry activation email
          </button>
        </div>
      )}
      {message && <p className="admin-import-result" role="status">{message}</p>}
      <div className="admin-college-list">
        <h2>Colleges</h2>
        {isLoading ? <p className="admin-loading">Loading colleges…</p> : colleges.length === 0
          ? <p>No colleges have been added.</p>
          : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>College Name</th><th>College ID</th><th>Total Students</th><th>Enrolled Students</th><th>View Details</th></tr></thead>
                <tbody>{colleges.map((college) => (
                  <tr key={college.id}>
                    <td>{college.name}</td>
                    <td><code>{college.id}</code></td>
                    <td>{college.totalStudents ?? 0}</td>
                    <td>{college.enrolledStudents ?? 0}</td>
                    <td><button className="admin-text-button" type="button" onClick={() => viewCollege(college.id)}>View Details</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
      </div>
        </>
      )}
      {isStudentLimitDialogOpen && selectedCollege?.subAdmins.length > 0 && (
        <div
          className="admin-report-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSavingStudentLimit) {
              setIsStudentLimitDialogOpen(false)
            }
          }}
        >
          <section
            className="admin-report-dialog admin-college-limit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-college-limit-title"
          >
            <div className="admin-report-dialog__heading">
              <div>
                <p className="admin-eyebrow">COLLEGE MANAGEMENT</p>
                <h2 id="admin-college-limit-title">Edit student limit</h2>
                <p>
                  {selectedLimitSubAdmin
                    ? `Update the limit assigned to ${selectedLimitSubAdmin.fullName || selectedLimitSubAdmin.username}.`
                    : 'Select the Sub-Admin whose student limit you want to configure.'}
                </p>
              </div>
              <button
                type="button"
                className="admin-report-dialog__close"
                aria-label="Close student limit dialog"
                disabled={isSavingStudentLimit}
                onClick={() => setIsStudentLimitDialogOpen(false)}
              >×</button>
            </div>
            <form onSubmit={saveStudentLimit}>
              {selectedCollege.subAdmins.length > 1 && (
                <label className="admin-report-field">
                  <span>Sub-Admin</span>
                  <select
                    value={selectedLimitSubAdminId}
                    required
                    onChange={(event) => selectStudentLimitSubAdmin(event.target.value)}
                  >
                    <option value="" disabled>Select a Sub-Admin</option>
                    {selectedCollege.subAdmins.map((subAdmin) => (
                      <option key={subAdmin.id} value={subAdmin.id}>
                        {subAdmin.fullName || subAdmin.username} ({subAdmin.studentLimit ?? 'Not Set'})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="admin-report-field">
                <span>Assigned student limit</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={studentLimitValue}
                  required
                  disabled={!selectedLimitSubAdmin}
                  onChange={(event) => setStudentLimitValue(event.target.value)}
                  aria-describedby="admin-college-limit-hint"
                  autoFocus
                />
              </label>
              <p id="admin-college-limit-hint" className="admin-college-limit-dialog__hint">
                Enter a positive whole number.
              </p>
              {studentLimitError && <p className="admin-inline-error" role="alert">{studentLimitError}</p>}
              <div className="admin-report-dialog__actions">
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  disabled={isSavingStudentLimit}
                  onClick={() => setIsStudentLimitDialogOpen(false)}
                >Cancel</button>
                <button
                  className="admin-button admin-button--primary"
                  disabled={isSavingStudentLimit || !selectedLimitSubAdmin}
                >
                  {isSavingStudentLimit ? 'Saving…' : 'Save limit'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </AdminDataPanel>
  )
}

function emptyModule() {
  return { title: '', description: '', lessons: [{ title: '', content: '', videoUrl: '' }] }
}

function emptyAssignment() {
  return { title: '', description: '', dueDate: '', points: 0 }
}

function emptyQuiz() {
  return {
    title: '',
    description: '',
    questions: [{ prompt: '', optionsText: '\n', correctOptionIndex: 0 }],
  }
}

export function CourseManagement({ onLogout }) {
  const [courses, setCourses] = useState([])
  const [modules, setModules] = useState([emptyModule()])
  const [assignments, setAssignments] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  async function loadCourses() {
    const { response, result } = await adminRequest('/admin/courses', onLogout)
    if (!response.ok) throw new Error(result.message || 'Unable to load courses.')
    setCourses(result.courses || [])
  }

  useEffect(() => {
    loadCourses().catch((loadError) => setError(loadError.message))
  }, [])

  function updateModule(moduleIndex, field, value) {
    setModules((current) => current.map((module, index) => (
      index === moduleIndex ? { ...module, [field]: value } : module
    )))
  }

  function updateLesson(moduleIndex, lessonIndex, field, value) {
    setModules((current) => current.map((module, index) => index !== moduleIndex ? module : {
      ...module,
      lessons: module.lessons.map((lesson, lessonPosition) => (
        lessonPosition === lessonIndex ? { ...lesson, [field]: value } : lesson
      )),
    }))
  }

  function updateAssignment(assignmentIndex, field, value) {
    setAssignments((current) => current.map((assignment, index) => (
      index === assignmentIndex ? { ...assignment, [field]: value } : assignment
    )))
  }

  function updateQuiz(quizIndex, field, value) {
    setQuizzes((current) => current.map((quiz, index) => (
      index === quizIndex ? { ...quiz, [field]: value } : quiz
    )))
  }

  function updateQuizQuestion(quizIndex, questionIndex, field, value) {
    setQuizzes((current) => current.map((quiz, index) => index !== quizIndex ? quiz : {
      ...quiz,
      questions: quiz.questions.map((question, position) => (
        position === questionIndex ? { ...question, [field]: value } : question
      )),
    }))
  }

  async function saveCourse(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsSaving(true)
    try {
      const form = event.currentTarget
      const values = new FormData(form)
      const payload = {
        title: values.get('title'),
        description: values.get('description'),
        status: values.get('status'),
        modules: modules.map((module) => ({
          ...module,
          lessons: module.lessons.filter((lesson) => lesson.title.trim()),
        })).filter((module) => module.title.trim()),
        assignments: assignments.filter((assignment) => assignment.title.trim()),
        quizzes: quizzes.filter((quiz) => quiz.title.trim()).map((quiz) => ({
          title: quiz.title,
          description: quiz.description,
          questions: quiz.questions.filter((question) => question.prompt.trim()).map((question) => ({
            prompt: question.prompt,
            options: question.optionsText.split(/\r?\n/).map((option) => option.trim()).filter(Boolean),
            correctOptionIndex: Number(question.correctOptionIndex),
          })),
        })),
      }
      const { response, result } = await adminRequest('/admin/courses', onLogout, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(result.message || 'Unable to save the course.')
      form.reset()
      setModules([emptyModule()])
      setAssignments([])
      setQuizzes([])
      setMessage(result.message)
      await loadCourses()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the course.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AdminDataPanel eyebrow="COURSE MANAGEMENT" title="Courses" description="Create courses with modules and lessons. Published courses are available for enrollment.">
      <form className="admin-data-form admin-course-form" onSubmit={saveCourse}>
        <h2>Create a course</h2>
        <label><span>Title</span><input name="title" maxLength="200" required /></label>
        <label><span>Description</span><textarea name="description" rows="3" maxLength="10000" /></label>
        <label><span>Status</span><select name="status"><option value="draft">Draft</option><option value="published">Published</option></select></label>
        {modules.map((module, moduleIndex) => (
          <fieldset className="admin-course-module" key={moduleIndex}>
            <legend>Module {moduleIndex + 1}</legend>
            <label><span>Module title</span><input value={module.title} maxLength="200" onChange={(event) => updateModule(moduleIndex, 'title', event.target.value)} /></label>
            <label><span>Module description</span><input value={module.description} maxLength="2000" onChange={(event) => updateModule(moduleIndex, 'description', event.target.value)} /></label>
            {module.lessons.map((lesson, lessonIndex) => (
              <div className="admin-course-lesson" key={lessonIndex}>
                <label><span>Lesson title</span><input value={lesson.title} maxLength="200" onChange={(event) => updateLesson(moduleIndex, lessonIndex, 'title', event.target.value)} /></label>
                <label><span>Lesson content</span><textarea rows="2" maxLength="20000" value={lesson.content} onChange={(event) => updateLesson(moduleIndex, lessonIndex, 'content', event.target.value)} /></label>
                <label><span>Video URL</span><input type="url" maxLength="2048" value={lesson.videoUrl} onChange={(event) => updateLesson(moduleIndex, lessonIndex, 'videoUrl', event.target.value)} /></label>
                {module.lessons.length > 1 && <button className="admin-text-button" type="button" onClick={() => updateModule(moduleIndex, 'lessons', module.lessons.filter((_, index) => index !== lessonIndex))}>Remove lesson</button>}
              </div>
            ))}
            <div className="admin-data-form__actions">
              <button className="admin-button admin-button--secondary" type="button" onClick={() => updateModule(moduleIndex, 'lessons', [...module.lessons, { title: '', content: '', videoUrl: '' }])}>Add lesson</button>
              {modules.length > 1 && <button className="admin-text-button" type="button" onClick={() => setModules((current) => current.filter((_, index) => index !== moduleIndex))}>Remove module</button>}
            </div>
          </fieldset>
        ))}
        <fieldset className="admin-course-module">
          <legend>Assignments</legend>
          {assignments.map((assignment, assignmentIndex) => (
            <div className="admin-course-lesson" key={assignmentIndex}>
              <label><span>Assignment title</span><input value={assignment.title} maxLength="200" onChange={(event) => updateAssignment(assignmentIndex, 'title', event.target.value)} /></label>
              <label><span>Description</span><textarea rows="2" maxLength="10000" value={assignment.description} onChange={(event) => updateAssignment(assignmentIndex, 'description', event.target.value)} /></label>
              <div className="admin-data-form__columns">
                <label><span>Due date</span><input type="date" value={assignment.dueDate} onChange={(event) => updateAssignment(assignmentIndex, 'dueDate', event.target.value)} /></label>
                <label><span>Points</span><input type="number" min="0" value={assignment.points} onChange={(event) => updateAssignment(assignmentIndex, 'points', event.target.value)} /></label>
              </div>
              <button className="admin-text-button" type="button" onClick={() => setAssignments((current) => current.filter((_, index) => index !== assignmentIndex))}>Remove assignment</button>
            </div>
          ))}
          <button className="admin-button admin-button--secondary" type="button" onClick={() => setAssignments((current) => [...current, emptyAssignment()])}>Add assignment</button>
        </fieldset>
        <fieldset className="admin-course-module">
          <legend>Quizzes</legend>
          {quizzes.map((quiz, quizIndex) => (
            <div className="admin-course-lesson" key={quizIndex}>
              <label><span>Quiz title</span><input value={quiz.title} maxLength="200" onChange={(event) => updateQuiz(quizIndex, 'title', event.target.value)} /></label>
              <label><span>Description</span><textarea rows="2" maxLength="10000" value={quiz.description} onChange={(event) => updateQuiz(quizIndex, 'description', event.target.value)} /></label>
              {quiz.questions.map((question, questionIndex) => (
                <div className="admin-course-lesson" key={questionIndex}>
                  <label><span>Question</span><input value={question.prompt} maxLength="2000" onChange={(event) => updateQuizQuestion(quizIndex, questionIndex, 'prompt', event.target.value)} /></label>
                  <label><span>Options (one per line)</span><textarea rows="3" maxLength="5000" value={question.optionsText} onChange={(event) => updateQuizQuestion(quizIndex, questionIndex, 'optionsText', event.target.value)} /></label>
                  <label><span>Correct option number (starting at 0)</span><input type="number" min="0" max="9" value={question.correctOptionIndex} onChange={(event) => updateQuizQuestion(quizIndex, questionIndex, 'correctOptionIndex', event.target.value)} /></label>
                  {quiz.questions.length > 1 && <button className="admin-text-button" type="button" onClick={() => updateQuiz(quizIndex, 'questions', quiz.questions.filter((_, index) => index !== questionIndex))}>Remove question</button>}
                </div>
              ))}
              <button className="admin-button admin-button--secondary" type="button" onClick={() => updateQuiz(quizIndex, 'questions', [...quiz.questions, { prompt: '', optionsText: '\n', correctOptionIndex: 0 }])}>Add question</button>
              <button className="admin-text-button" type="button" onClick={() => setQuizzes((current) => current.filter((_, index) => index !== quizIndex))}>Remove quiz</button>
            </div>
          ))}
          <button className="admin-button admin-button--secondary" type="button" onClick={() => setQuizzes((current) => [...current, emptyQuiz()])}>Add quiz</button>
        </fieldset>
        <div className="admin-data-form__actions">
          <button className="admin-button admin-button--secondary" type="button" onClick={() => setModules((current) => [...current, emptyModule()])}>Add module</button>
          <button className="admin-button admin-button--primary" type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save course'}</button>
        </div>
      </form>
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
      {message && <p className="admin-import-result" role="status">{message}</p>}
      <div className="admin-college-list">
        <h2>Saved courses</h2>
        {courses.length === 0 ? <p>No courses have been created.</p> : courses.map((course) => (
          <div className="admin-college-list__item" key={course._id}>
            <strong>{course.title}</strong>
            <span>{course.modules?.length || 0} modules · {course.modules?.reduce((total, module) => total + (module.lessons?.length || 0), 0) || 0} lessons · {course.status}</span>
          </div>
        ))}
      </div>
    </AdminDataPanel>
  )
}

export function EnrollmentManagement({ onLogout }) {
  const [courses, setCourses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [attentionResponses, setAttentionResponses] = useState([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCourse, setSelectedCourse] = useState(null)
  const [studentTypeFilter, setStudentTypeFilter] = useState('all')

  useEffect(() => {
    async function loadEnrollmentData() {
      setIsLoading(true)
      setError('')
      try {
        const [coursesResponse, enrollmentsResponse, attentionResponse] = await Promise.all([
          adminRequest('/admin/courses', onLogout),
          adminRequest('/admin/enrollments', onLogout),
          adminRequest('/admin/video-attention-responses', onLogout),
        ])
        if (!coursesResponse.response.ok) {
          throw new Error(coursesResponse.result.message || 'Unable to load courses.')
        }
        if (!enrollmentsResponse.response.ok) {
          throw new Error(enrollmentsResponse.result.message || 'Unable to load enrollments.')
        }
        if (!attentionResponse.response.ok) {
          throw new Error(attentionResponse.result.message || 'Unable to load video attention check responses.')
        }
        setCourses(Array.isArray(coursesResponse.result.courses) ? coursesResponse.result.courses : [])
        setEnrollments(Array.isArray(enrollmentsResponse.result.enrollments)
          ? enrollmentsResponse.result.enrollments
          : [])
        setAttentionResponses(Array.isArray(attentionResponse.result.responses)
          ? attentionResponse.result.responses
          : [])
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load enrollments.')
      } finally {
        setIsLoading(false)
      }
    }

    loadEnrollmentData()
  }, [])

  useEffect(() => {
    if (!selectedCourse) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') setSelectedCourse(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedCourse])

  const enrollmentsByCourse = enrollments.reduce((grouped, enrollment) => {
    const courseId = String(enrollment.courseId?._id || enrollment.courseId || '')
    const student = enrollment.userId
    const studentId = String(student?._id || student || '')
    if (!courseId || !studentId || !student?._id) return grouped

    const courseEnrollments = grouped.get(courseId) || new Map()
    if (!courseEnrollments.has(studentId)) courseEnrollments.set(studentId, enrollment)
    grouped.set(courseId, courseEnrollments)
    return grouped
  }, new Map())

  const normalizedSearch = search.trim().toLowerCase()
  const visibleCourses = courses.filter((course) => {
    const courseId = String(course._id || '')
    const matchesSearch = !normalizedSearch ||
      String(course.title || '').toLowerCase().includes(normalizedSearch) ||
      courseId.toLowerCase().includes(normalizedSearch)
    return matchesSearch
  })

  const selectedCourseAllEnrollments = selectedCourse
    ? [...(enrollmentsByCourse.get(String(selectedCourse._id))?.values() || [])]
    : []
  const selectedCourseEnrollments = selectedCourseAllEnrollments.filter((enrollment) => {
        if (studentTypeFilter === 'all') return true
        const isCollegeStudent = Boolean(enrollment.collegeId || enrollment.userId?.studentType === 'college')
        return studentTypeFilter === 'college' ? isCollegeStudent : !isCollegeStudent
      })

  return (
    <AdminDataPanel
      eyebrow="COURSE MANAGEMENT"
      title="Enrollments"
      description="View course enrollment totals, enrolled students, and video attention check responses."
      className="admin-enrollments"
    >
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
      <div className="admin-enrollments__filters">
        <label>
          <span>Search courses</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by course name or ID"
          />
        </label>
      </div>
      {isLoading
        ? <p className="admin-enrollments__state" role="status">Loading courses and enrollments…</p>
        : !error && courses.length === 0
          ? <p className="admin-enrollments__state">No courses have been created.</p>
          : !error && visibleCourses.length === 0
            ? <p className="admin-enrollments__state">No courses match your search.</p>
            : !error && (
          <div className="admin-table-wrap admin-enrollments__table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Course Name</th>
                  <th>Course ID</th>
                  <th>Total Enrolled Students</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleCourses.map((course) => {
                  const courseId = String(course._id || '')
                  const studentsById = enrollmentsByCourse.get(courseId) || new Map()
                  const courseEnrollments = [...studentsById.values()]
                  return (
                    <tr key={courseId}>
                      <td>{course.title || 'Untitled course'}</td>
                      <td><code>{courseId}</code></td>
                      <td>{courseEnrollments.length}</td>
                      <td>
                        <button
                          className="admin-button admin-button--secondary admin-enrollments__view-button"
                          type="button"
                          onClick={() => {
                            setStudentTypeFilter('all')
                            setSelectedCourse(course)
                          }}
                        >
                          View Students
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      {selectedCourse && (
        <div
          className="admin-enrollments__backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedCourse(null)
          }}
        >
          <section
            aria-labelledby="admin-enrollments-dialog-title"
            aria-modal="true"
            className="admin-enrollments__dialog"
            role="dialog"
          >
            <header className="admin-enrollments__dialog-header">
              <div>
                <p className="admin-eyebrow">COURSE ENROLLMENTS</p>
                <h2 id="admin-enrollments-dialog-title">{selectedCourse.title || 'Untitled course'}</h2>
                <p>{selectedCourseAllEnrollments.length} enrolled student{selectedCourseAllEnrollments.length === 1 ? '' : 's'}</p>
              </div>
              <button
                aria-label="Close enrolled students"
                className="admin-enrollments__close"
                type="button"
                onClick={() => setSelectedCourse(null)}
              >
                ×
              </button>
            </header>
            <label className="admin-enrollments__student-filter">
              <span>Student type</span>
              <select value={studentTypeFilter} onChange={(event) => setStudentTypeFilter(event.target.value)}>
                <option value="all">All students</option>
                <option value="independent">Independent students</option>
                <option value="college">College students</option>
              </select>
            </label>
            {selectedCourseEnrollments.length === 0
              ? <p className="admin-enrollments__state">
                {selectedCourseAllEnrollments.length === 0
                  ? 'No students enrolled yet.'
                  : 'No students match this student type filter.'}
              </p>
              : (
                <div className="admin-table-wrap admin-enrollments__table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Student Name</th>
                        <th>Student ID</th>
                        <th>Email</th>
                        <th>Student Type</th>
                        <th>College Name</th>
                        <th>Enrollment Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedCourseEnrollments.map((entry) => {
                        const student = entry.userId
                        const isCollegeStudent = Boolean(entry.collegeId || student?.studentType === 'college')
                        const enrollmentId = String(entry._id || `${selectedCourse._id}-${student?._id}`)
                        return (
                          <tr key={enrollmentId}>
                            <td>{student?.fullName || 'Name not available'}</td>
                            <td>{student?.studentId || student?._id || 'Not available'}</td>
                            <td>{student?.email || 'Not available'}</td>
                            <td>{isCollegeStudent ? 'College' : 'Independent'}</td>
                            <td>
                              {isCollegeStudent
                                ? entry.collegeId?.name || entry.collegeId?.collegeName || entry.collegeId?.title || 'Not available'
                                : '—'}
                            </td>
                            <td>
                              {entry.createdAt && !Number.isNaN(new Date(entry.createdAt).getTime())
                                ? new Date(entry.createdAt).toLocaleString()
                                : 'Not available'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
        </div>
      )}
      <h3 className="admin-data-section-title">Video Attention Check Responses</h3>
      {attentionResponses.length === 0
        ? <p>No video attention check responses have been recorded.</p>
        : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Student</th><th>Course / lesson</th><th>Question</th><th>Response</th><th>Result</th><th>Response time</th><th>Video position</th><th>Presented</th></tr></thead>
              <tbody>{attentionResponses.map((entry) => (
                <tr key={entry._id}>
                  <td>{entry.userId?.fullName || entry.userId?.email || 'Unknown student'}{entry.collegeId?.name ? ` · ${entry.collegeId.name}` : ''}</td>
                  <td>{entry.courseId?.title || 'Unknown course'} · {entry.lessonTitle}</td>
                  <td>{entry.questionPrompt}</td>
                  <td>{(entry.selectedOptionIndices || []).map((index) => entry.options?.[index]).filter(Boolean).join(', ') || (entry.status === 'presented' ? 'Not answered' : 'No response')}</td>
                  <td>{entry.status === 'answered' ? (entry.isCorrect ? 'Correct' : 'Incorrect') : 'Pending'}</td>
                  <td>{Number.isFinite(entry.responseTimeMs) ? `${(entry.responseTimeMs / 1000).toFixed(1)} s` : '—'}</td>
                  <td>{Number.isFinite(entry.videoPositionSeconds) ? `${Math.floor(entry.videoPositionSeconds)} s` : '—'}</td>
                  <td>{entry.presentedAt ? new Date(entry.presentedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
    </AdminDataPanel>
  )
}
