import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CollegesManagement, CourseManagement, EnrollmentManagement } from './AdminDataViews.jsx'
import { isInvalidSessionResponse } from './auth-session.js'
import ThemeToggle from './ThemeToggle.jsx'
import './AdminDashboard.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

const navigation = [
  { id: 'overview', label: 'Overview', icon: '◫' },
  { id: 'students', label: 'Students', group: 'User Management', icon: '♙' },
  { id: 'colleges', label: 'Colleges', icon: '▦' },
  { id: 'courses', label: 'Courses', group: 'Course Management', icon: '▤' },
  { id: 'enrollments', label: 'Enrollments', icon: '⇄' },
  { id: 'reports', label: 'Reports & Analytics', icon: '⌁' },
  { id: 'notifications', label: 'Notifications', icon: '♧' },
  { id: 'feedback', label: 'Feedback & Complaints', icon: '☷' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

async function readResponse(response, onLogout) {
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error('The server returned an invalid response.')
  }
  if (isInvalidSessionResponse(response, body)) onLogout()
  if (!response.ok) {
    throw new Error(body.message || 'The request could not be completed.')
  }
  return body
}

function formatDate(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function StatusBadge({ status }) {
  const normalizedStatus = String(status || 'unknown').toLowerCase()
  return <span className={`admin-status admin-status--${normalizedStatus}`}>{normalizedStatus}</span>
}

function EmptyState({ title, children }) {
  return (
    <div className="admin-empty">
      <span className="admin-empty__mark" aria-hidden="true">—</span>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  )
}

function MetricCard({ label, value, note, icon, tone }) {
  return (
    <article className="admin-metric">
      <div className={`admin-metric__icon admin-metric__icon--${tone}`} aria-hidden="true">{icon}</div>
      <p>{label}</p>
      <strong>{value ?? '—'}</strong>
      <span>{note}</span>
    </article>
  )
}

function RegistrationsTable({ users, emptyMessage }) {
  if (!users.length) {
    return <EmptyState title="No registrations yet">{emptyMessage}</EmptyState>
  }
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr><th>Name</th><th>Role</th><th>Registration date</th><th>Status</th></tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user._id}>
              <td>
                <span className="admin-table__name">{user.fullName || user.username || 'Unnamed account'}</span>
                <span className="admin-table__email">{user.email}</span>
              </td>
              <td>{user.studentType === 'college' ? 'College Student' : 'Independent Student'}</td>
              <td>{formatDate(user.createdAt)}</td>
              <td><StatusBadge status={user.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminDashboard({ user, email = user?.email, onLogout, isDark, onToggleTheme }) {
  const navigate = useNavigate()
  const [overview, setOverview] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [activeView, setActiveView] = useState('overview')
  const [registrationTab, setRegistrationTab] = useState('all')
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [colleges, setColleges] = useState([])
  const [selectedCollegeId, setSelectedCollegeId] = useState('')
  const [studentCsv, setStudentCsv] = useState(null)
  const [collegeLoadError, setCollegeLoadError] = useState('')
  const [studentImportError, setStudentImportError] = useState('')
  const [studentImportResult, setStudentImportResult] = useState(null)
  const [isLoadingColleges, setIsLoadingColleges] = useState(false)
  const [isImportingStudents, setIsImportingStudents] = useState(false)

  const loadOverview = useCallback(async (signal) => {
    setIsLoading(true)
    setLoadError('')
    try {
      const storedAuth = sessionStorage.getItem('lms.auth')
      const auth = storedAuth ? JSON.parse(storedAuth) : null
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        return
      }
      const response = await fetch(`${API_BASE_URL}/admin/overview`, {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal,
      })
      const result = await readResponse(response, onLogout)
      setOverview(result)
    } catch (error) {
      if (error.name !== 'AbortError') {
        if (error instanceof SyntaxError) {
          onLogout()
          return
        }
        setLoadError(error instanceof Error ? error.message : 'Unable to load dashboard data.')
      }
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }
  }, [onLogout])

  useEffect(() => {
    const controller = new AbortController()
    loadOverview(controller.signal)
    return () => controller.abort()
  }, [loadOverview])

  useEffect(() => {
    if (activeView !== 'students') return undefined
    const controller = new AbortController()
    async function loadColleges() {
      setIsLoadingColleges(true)
      setCollegeLoadError('')
      try {
        const storedAuth = sessionStorage.getItem('lms.auth')
        const auth = storedAuth ? JSON.parse(storedAuth) : null
        if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
          onLogout()
          return
        }
        const response = await fetch(`${API_BASE_URL}/admin/colleges`, {
          headers: { Authorization: 'Bearer ' + auth.token },
          signal: controller.signal,
        })
        const result = await readResponse(response, onLogout)
        setColleges(result.colleges || [])
      } catch (error) {
        if (error.name !== 'AbortError') {
          setCollegeLoadError(error instanceof Error ? error.message : 'Unable to load colleges.')
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingColleges(false)
      }
    }
    loadColleges()
    return () => controller.abort()
  }, [activeView, onLogout])

  const registrations = overview?.recentRegistrations || []
  const shownRegistrations = useMemo(
    () => registrations.filter((user) => (
      user.role === 'student' &&
      (registrationTab === 'all' || user.studentType === registrationTab) &&
      `${user.fullName || ''} ${user.username || ''} ${user.email || ''}`.toLowerCase().includes(search.trim().toLowerCase())
    )),
    [registrations, registrationTab, search],
  )

  async function importCollegeStudents(event) {
    event.preventDefault()
    setStudentImportError('')
    setStudentImportResult(null)
    if (!selectedCollegeId || !studentCsv) {
      setStudentImportError('Select a college and choose a CSV file.')
      return
    }

    setIsImportingStudents(true)
    try {
      const storedAuth = sessionStorage.getItem('lms.auth')
      const auth = storedAuth ? JSON.parse(storedAuth) : null
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        return
      }
      const csvText = await studentCsv.text()
      const response = await fetch(`${API_BASE_URL}/admin/students/import`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + auth.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ csvText, collegeId: selectedCollegeId }),
      })
      const result = await readResponse(response, onLogout)
      setStudentImportResult(result)
      await loadOverview()
    } catch (error) {
      setStudentImportError(error instanceof Error ? error.message : 'Unable to import students.')
    } finally {
      setIsImportingStudents(false)
    }
  }

  function exportReport() {
    function escapeCsvField(value) {
      const field = String(value)
      const safeField = /^[\s]*[=+\-@]/.test(field) ? `'${field}` : field
      return `"${safeField.replaceAll('"', '""')}"`
    }

    const rows = [
      ['Name', 'Email', 'Role', 'Status', 'Registration date'],
      ...registrations.map((user) => [
        user.fullName || user.username || '',
        user.email || '',
        user.role || '',
        user.status || '',
        user.createdAt || '',
      ]),
    ]
    const csv = rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'lms-recent-registrations.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  function selectView(view) {
    if (view === 'logout') {
      onLogout()
      return
    }
    if (view === 'settings') {
      navigate('/admin/settings')
      return
    }
    setActiveView(view)
    setSidebarOpen(false)
    setSearch('')
    if (view === 'students') setRegistrationTab('all')
  }

  const stats = overview?.stats
  const viewTitles = {
    overview: 'Admin Dashboard',
    students: 'Students',
    colleges: 'Colleges',
    courses: 'Course Management',
    enrollments: 'Enrollments',
    reports: 'Reports & Analytics',
    notifications: 'Notifications',
    feedback: 'Feedback & Complaints',
    settings: 'Settings',
  }

  return (
    <div className="admin-app">
      {sidebarOpen && (
        <button
          className="admin-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`admin-sidebar${sidebarOpen ? ' admin-sidebar--open' : ''}`}>
        <a className="admin-brand" href="/admin/dashboard" onClick={(event) => { event.preventDefault(); selectView('overview') }}>
          <img className="admin-brand__image" src="/logo.png" alt="LMS logo" />
        </a>
        <div className="admin-sidebar__label">WORKSPACE</div>
        <nav className="admin-nav" aria-label="Admin navigation">
          {navigation.map((item, index) => (
            <React.Fragment key={item.id}>
              {item.group && <div className="admin-nav__group">{item.group}</div>}
              {!item.group && index > 0 && <div className="admin-nav__spacer" />}
              <button
                type="button"
                className={`admin-nav__item${activeView === item.id ? ' is-active' : ''}`}
                aria-current={activeView === item.id ? 'page' : undefined}
                onClick={() => selectView(item.id)}
              >
                <span className="admin-nav__icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            </React.Fragment>
          ))}
          <Link className="admin-nav__item" to="/admin/support">
            <span className="admin-nav__icon" aria-hidden="true">✉</span>
            <span>Support tickets</span>
          </Link>
        </nav>
        <div className="admin-sidebar__bottom">
          <div className="admin-sidebar__help"><span>✦</span><strong>Need a hand?</strong><small>Help center and support</small></div>
          <button type="button" className="admin-nav__item admin-nav__logout" onClick={() => selectView('logout')}>
            <span className="admin-nav__icon" aria-hidden="true">↪</span><span>Logout</span>
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <button
            type="button"
            className="admin-menu-toggle"
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >☰</button>
          <div className="admin-breadcrumb">Workspace <span>/</span> <strong>{viewTitles[activeView]}</strong></div>
          <div className="admin-topbar__right">
            <label className="admin-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="Search registrations..."
                aria-label="Search registrations"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
            <ThemeToggle isDark={isDark} onToggle={onToggleTheme} className="admin-theme-toggle" />
            <button type="button" className="admin-icon-button" aria-label="Notifications" onClick={() => selectView('notifications')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" />
              </svg>
              <i />
            </button>
            <Link to="/admin/support" className="admin-icon-button" aria-label="Help and support">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.6 9a2.5 2.5 0 1 1 4.5 1.5c-.9 1.1-2.1 1.3-2.1 3m0 3h.01" />
              </svg>
            </Link>
            <button type="button" className="admin-profile" onClick={() => selectView('settings')}>
              <span className="admin-avatar">{(email || 'A').slice(0, 1).toUpperCase()}</span>
              <span><strong>{user?.fullName || 'Administrator'}</strong><small>Main Admin</small></span>
              <span className="admin-profile__chevron">⌄</span>
            </button>
          </div>
        </header>

        <div className="admin-content">
          {loadError && (
            <div className="admin-alert" role="alert">
              <span>{loadError}</span>
              <button type="button" onClick={() => loadOverview()}>Retry</button>
            </div>
          )}

          {activeView === 'overview' && (
            <>
              <section className="admin-page-heading">
                <div>
                  <p className="admin-eyebrow">OVERVIEW</p>
                  <h1>Admin Dashboard</h1>
                  <p>Welcome back, Administrator. Here’s what’s happening with your learning community.</p>
                </div>
                <div className="admin-page-heading__actions">
                  <button type="button" className="admin-button admin-button--secondary" disabled={!registrations.length} onClick={exportReport}>
                    <span aria-hidden="true">⇩</span> Export Report
                  </button>
                  <button type="button" className="admin-button admin-button--primary" onClick={() => selectView('courses')}>
                    <span aria-hidden="true">＋</span> Add Course
                  </button>
                </div>
              </section>

              <section className="admin-metrics" aria-label="Platform statistics">
                <MetricCard label="Total Students" value={isLoading ? '…' : stats?.totalStudents ?? '—'} note="Registered learners" icon="♙" tone="sage" />
                <MetricCard label="Total Courses" value={isLoading ? '…' : stats?.totalCourses ?? '—'} note="Courses in catalog" icon="▤" tone="blue" />
                <MetricCard label="Total Enrollments" value={isLoading ? '…' : stats?.totalEnrollments ?? '—'} note="Active learning records" icon="⇄" tone="gold" />
              </section>

              <section className="admin-analytics-grid">
                <article className="admin-panel">
                  <div className="admin-panel__heading">
                    <div><h2>Learning Engagement</h2><p>Enrollment activity over time</p></div>
                    <select aria-label="Learning engagement period" defaultValue="30" disabled>
                      <option value="30">Last 30 days</option>
                    </select>
                  </div>
                  {isLoading
                    ? <div className="admin-loading">Loading enrollment data…</div>
                    : <EmptyState title={`${stats?.totalEnrollments ?? 0} enrollment records`}>
                      Enrollment assignments and independent student enrollments are saved in the enrollment collection.
                    </EmptyState>}
                </article>
                <article className="admin-panel">
                  <div className="admin-panel__heading">
                    <div><h2>Course Completion</h2><p>Learner progress breakdown</p></div>
                    <span className="admin-panel__period">All courses</span>
                  </div>
                  <EmptyState title="No completion data available">
                    Course and enrollment records are not available yet.
                  </EmptyState>
                </article>
              </section>

              <section className="admin-bottom-grid">
                <article className="admin-panel">
                  <div className="admin-panel__heading admin-panel__heading--registrations">
                    <div><h2>Recent Student Registrations</h2><p>Latest independent and college student accounts</p></div>
                    <button className="admin-text-button" type="button" onClick={() => selectView('students')}>View all <span>→</span></button>
                  </div>
                  <div className="admin-tabs" role="tablist" aria-label="Student type">
                    {[
                      ['all', 'All Students'],
                      ['independent', 'Independent'],
                      ['college', 'College'],
                    ].map(([studentType, label]) => (
                      <button
                        key={studentType}
                        type="button"
                        role="tab"
                        aria-selected={registrationTab === studentType}
                        className={registrationTab === studentType ? 'is-selected' : ''}
                        onClick={() => setRegistrationTab(studentType)}
                      >{label}</button>
                    ))}
                  </div>
                  {isLoading
                    ? <div className="admin-loading">Loading registrations…</div>
                    : <RegistrationsTable users={shownRegistrations} emptyMessage="New registrations will appear here when available." />}
                </article>
              </section>
            </>
          )}

          {activeView === 'students' && (
            <section className="admin-panel admin-view-panel">
              <div className="admin-page-heading admin-page-heading--compact">
                <div><p className="admin-eyebrow">STUDENT MANAGEMENT</p><h1>{viewTitles[activeView]}</h1><p>Independent and college students registered in the LMS.</p></div>
              </div>
              {activeView === 'students' && (
                <section className="admin-student-import" aria-labelledby="student-import-title">
                  <div className="admin-student-import__heading">
                    <div>
                      <h2 id="student-import-title">Import college students</h2>
                      <p>Upload a CSV with Full Name, Student ID, Email, Department, and Batch.</p>
                    </div>
                    <span className="admin-student-import__badge">No emails sent</span>
                  </div>
                  <form className="admin-student-import__form" onSubmit={importCollegeStudents}>
                    <label>
                      <span>College</span>
                      <select
                        value={selectedCollegeId}
                        onChange={(event) => setSelectedCollegeId(event.target.value)}
                        disabled={isLoadingColleges || !colleges.length}
                        required
                      >
                        <option value="">{isLoadingColleges ? 'Loading colleges…' : 'Select a college'}</option>
                        {colleges.map((college) => (
                          <option key={college.id} value={college.id}>{college.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Student CSV</span>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) => {
                          setStudentCsv(event.target.files?.[0] || null)
                          setStudentImportResult(null)
                          setStudentImportError('')
                        }}
                        required
                      />
                    </label>
                    <button
                      className="admin-button admin-button--primary"
                      type="submit"
                      disabled={isImportingStudents || isLoadingColleges || !colleges.length || !studentCsv}
                    >
                      {isImportingStudents ? 'Importing…' : 'Import students'}
                    </button>
                  </form>
                  {collegeLoadError && <p className="admin-inline-error" role="alert">{collegeLoadError}</p>}
                  {!isLoadingColleges && !collegeLoadError && !colleges.length && (
                    <p className="admin-inline-error" role="status">No colleges are available. Add a college before importing students.</p>
                  )}
                  {studentImportError && <p className="admin-inline-error" role="alert">{studentImportError}</p>}
                  {studentImportResult && (
                    <div className="admin-import-result" role="status">
                      <strong>Import complete: {studentImportResult.summary.imported} imported, {studentImportResult.summary.failed} failed.</strong>
                      <p>{studentImportResult.message}</p>
                      {studentImportResult.failures?.length > 0 && (
                        <ul>
                          {studentImportResult.failures.map((failure) => (
                            <li key={`${failure.row}-${failure.studentId}-${failure.email}`}>
                              Row {failure.row}{failure.studentId ? ` · ${failure.studentId}` : ''}: {failure.reason}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </section>
              )}
              <div className="admin-tabs" role="tablist" aria-label="Student type">
                {[
                  ['all', 'All Students'],
                  ['independent', 'Independent'],
                  ['college', 'College'],
                ].map(([studentType, label]) => (
                  <button
                    key={studentType}
                    type="button"
                    role="tab"
                    aria-selected={registrationTab === studentType}
                    className={registrationTab === studentType ? 'is-selected' : ''}
                    onClick={() => setRegistrationTab(studentType)}
                  >{label}</button>
                ))}
              </div>
              {isLoading
                ? <div className="admin-loading">Loading registrations…</div>
                : <RegistrationsTable users={shownRegistrations} emptyMessage="No matching student records were returned by the backend." />}
            </section>
          )}

          {activeView === 'colleges' && <CollegesManagement onLogout={onLogout} />}
          {activeView === 'courses' && <CourseManagement onLogout={onLogout} />}
          {activeView === 'enrollments' && <EnrollmentManagement onLogout={onLogout} />}

          {['reports', 'notifications', 'feedback', 'settings'].includes(activeView) && (
            <section className="admin-panel admin-view-panel">
              <div className="admin-page-heading admin-page-heading--compact">
                <div><p className="admin-eyebrow">WORKSPACE</p><h1>{viewTitles[activeView]}</h1><p>Manage your LMS {viewTitles[activeView].toLowerCase()}.</p></div>
              </div>
              <EmptyState title={`${viewTitles[activeView]} are not connected`}>This section will show live LMS data when its backend API is available.</EmptyState>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

export default AdminDashboard
