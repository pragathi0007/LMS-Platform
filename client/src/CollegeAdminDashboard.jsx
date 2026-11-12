import React, { useEffect, useState } from 'react'
import { isInvalidSessionResponse } from './auth-session.js'
import { API_BASE_URL } from './api-base-url.js'
import WorkspaceTopbar from './WorkspaceTopbar.jsx'
import { readStudentFile } from './student-file.js'
import './CollegeAdminDashboard.css'

async function collegeRequest(path, onLogout, options = {}) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (auth?.user?.role !== 'college_admin' || typeof auth.token !== 'string') {
    onLogout()
    throw new Error('Your college administrator session has ended.')
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('The server returned an invalid response.')
  }
  if (isInvalidSessionResponse(response, result)) onLogout()
  if (!response.ok) throw new Error(result.message || 'The request could not be completed.')
  return result
}

function CollegeAdminDashboard({ user, onLogout, isDark, onToggleTheme }) {
  const [dashboard, setDashboard] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [studentFile, setStudentFile] = useState(null)
  const [studentActionError, setStudentActionError] = useState('')
  const [studentActionMessage, setStudentActionMessage] = useState('')
  const [isImportingStudents, setIsImportingStudents] = useState(false)

  async function loadDashboard() {
    setLoadError('')
    try {
      setDashboard(await collegeRequest('/college/dashboard', onLogout))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load college data.')
    }
  }

  useEffect(() => { loadDashboard() }, [])

  async function assignCourse(event) {
    event.preventDefault()
    setIsSaving(true)
    setFormError('')
    setMessage('')
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget).entries())
      const result = await collegeRequest('/college/enrollments', onLogout, {
        method: 'POST',
        body: JSON.stringify(data),
      })
      setMessage(result.message)
      event.currentTarget.reset()
      await loadDashboard()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to assign the course.')
    } finally {
      setIsSaving(false)
    }
  }

  async function createStudent(event) {
    event.preventDefault()
    const form = event.currentTarget
    setIsSaving(true)
    setStudentActionError('')
    setStudentActionMessage('')
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget).entries())
      const result = await collegeRequest('/college/students', onLogout, {
        method: 'POST',
        body: JSON.stringify(data),
      })
      setStudentActionMessage(result.message)
      form.reset()
      await loadDashboard()
    } catch (error) {
      setStudentActionError(error instanceof Error ? error.message : 'Unable to create the student.')
    } finally {
      setIsSaving(false)
    }
  }

  async function importStudents(event) {
    event.preventDefault()
    const form = event.currentTarget
    setIsImportingStudents(true)
    setStudentActionError('')
    setStudentActionMessage('')
    try {
      if (!studentFile) throw new Error('Choose a CSV or XLSX file.')
      const csvText = await readStudentFile(studentFile)
      const result = await collegeRequest('/college/students/import', onLogout, {
        method: 'POST',
        body: JSON.stringify({ csvText }),
      })
      setStudentActionMessage(`${result.message} ${result.summary.imported} imported, ${result.summary.failed} failed.`)
      setStudentFile(null)
      form.reset()
      await loadDashboard()
    } catch (error) {
      setStudentActionError(error instanceof Error ? error.message : 'Unable to import students.')
    } finally {
      setIsImportingStudents(false)
    }
  }

  return (
    <main className="college-admin">
      <WorkspaceTopbar
        title="College Workspace"
        name={user.fullName}
        email={user.email}
        roleLabel="College Sub-Admin"
        dashboardPath="/college-admin/dashboard"
        helpPath="/college-admin/support"
        settingsPath="/college-admin/settings"
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
      />
      <div className="college-admin__content">

      {loadError && <p className="college-admin__alert" role="alert">{loadError}<button type="button" onClick={loadDashboard}>Retry</button></p>}
      {!dashboard && !loadError && <p className="college-admin__loading">Loading college data…</p>}
      {dashboard && (
        <>
          <section className="college-admin__stats" aria-label="Student registration capacity">
            <article><span>Student Limit</span><strong>{dashboard.studentLimit ?? 'Not Set'}</strong></article>
            <article><span>Registered Students</span><strong>{dashboard.totalStudents ?? 0}</strong></article>
            <article><span>Remaining Student Slots</span><strong>{dashboard.remainingSlots ?? 'Not Set'}</strong></article>
          </section>

          <section className="college-admin__panel">
            <h2>Manage college students</h2>
            <p>New accounts count toward your college's student registration limit.</p>
            <div className="college-admin__student-actions">
              <form className="college-admin__student-form" onSubmit={createStudent}>
                <h3>Add a student</h3>
                <label><span>Full name</span><input name="fullName" maxLength="120" required /></label>
                <label><span>Email</span><input name="email" type="email" maxLength="254" required /></label>
                <label><span>Username</span><input name="username" minLength="3" maxLength="30" pattern="[A-Za-z0-9._-]{3,30}" required /></label>
                <label><span>Password</span><input name="password" type="password" minLength="8" maxLength="72" required /></label>
                <label><span>Student ID</span><input name="studentId" maxLength="100" required /></label>
                <label><span>Department</span><input name="department" maxLength="120" /></label>
                <label><span>Batch</span><input name="batch" maxLength="80" /></label>
                <button type="submit" disabled={isSaving}>{isSaving ? 'Creating…' : 'Add student'}</button>
              </form>
              <form className="college-admin__student-form" onSubmit={importStudents}>
                <h3>Bulk upload</h3>
                <p>Upload CSV or XLSX with Full Name, Student ID, Email, Department, and Batch columns.</p>
                <label><span>Student file</span><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setStudentFile(event.target.files?.[0] || null)} required /></label>
                <button type="submit" disabled={isImportingStudents || !studentFile}>{isImportingStudents ? 'Importing…' : 'Import students'}</button>
              </form>
            </div>
            {studentActionError && <p className="college-admin__alert" role="alert">{studentActionError}</p>}
            {studentActionMessage && <p className="college-admin__success" role="status">{studentActionMessage}</p>}
          </section>

          <section className="college-admin__panel">
            <h2>Assign a course</h2>
            <p>Students and enrollment changes are limited to your assigned college.</p>
            <form className="college-admin__form" onSubmit={assignCourse}>
              <label>
                <span>College student</span>
                <select name="studentId" required defaultValue="">
                  <option value="" disabled>Select a student</option>
                  {dashboard.students.map((student) => (
                    <option key={student._id} value={student._id}>
                      {student.fullName || student.username} · {student.email}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Published course</span>
                <select name="courseId" required defaultValue="">
                  <option value="" disabled>Select a course</option>
                  {dashboard.courses.map((course) => <option key={course._id} value={course._id}>{course.title}</option>)}
                </select>
              </label>
              <button type="submit" disabled={isSaving || !dashboard.students.length || !dashboard.courses.length}>
                {isSaving ? 'Assigning…' : 'Assign course'}
              </button>
            </form>
            {formError && <p className="college-admin__alert" role="alert">{formError}</p>}
            {message && <p className="college-admin__success" role="status">{message}</p>}
            {!dashboard.students.length && <p>No college students are available for assignment.</p>}
            {!dashboard.courses.length && <p>No published courses are available.</p>}
          </section>

          <section className="college-admin__panel">
            <h2>College students <span>{dashboard.totalStudents ?? 0}</span></h2>
            {dashboard.students.length === 0 ? <p>No college students have been imported.</p> : (
              <div className="college-admin__table-wrap">
                <table><thead><tr><th>Student</th><th>Email</th><th>Student ID</th><th>Department</th></tr></thead>
                  <tbody>{dashboard.students.map((student) => (
                    <tr key={student._id}><td>{student.fullName || student.username}</td><td>{student.email}</td><td>{student.studentId || '—'}</td><td>{student.department || '—'}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="college-admin__panel">
            <h2>Enrollment records</h2>
            {dashboard.enrollments.length === 0 ? <p>No courses have been assigned to students yet.</p> : (
              <div className="college-admin__table-wrap">
                <table><thead><tr><th>Student</th><th>Course</th><th>Status</th></tr></thead>
                  <tbody>{dashboard.enrollments.map((entry) => (
                    <tr key={entry._id}><td>{entry.userId?.fullName || entry.userId?.email || 'Unknown student'}</td><td>{entry.courseId?.title || 'Unknown course'}</td><td>{entry.status}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      </div>
    </main>
  )
}

export default CollegeAdminDashboard
