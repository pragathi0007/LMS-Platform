import React, { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import './StudentDashboard.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

const navigation = [
  { label: 'Dashboard', icon: 'grid', path: '/student/dashboard' },
  { label: 'My Courses', icon: 'book', path: '/student/courses' },
  { label: 'Assignments', icon: 'check', path: '/student/assignments' },
  { label: 'Grades & Results', icon: 'chart', path: '/student/results' },
  { label: 'Learning Resources', icon: 'folder', path: '/student/resources' },
  { label: 'Messages', icon: 'message', path: '/student/messages' },
  { label: 'Certificates', icon: 'award', path: '/student/certificates' },
  { label: 'My Profile', icon: 'user', path: '/student/profile' },
  { label: 'Settings', icon: 'settings', path: '/student/settings' },
]

const stats = [
  { label: 'Enrolled courses', icon: 'book', tone: 'gold' },
  { label: 'Pending assignments', icon: 'check', tone: 'peach' },
  { label: 'Completed courses', icon: 'award', tone: 'mint' },
  { label: 'Learning streak', icon: 'spark', tone: 'blue' },
]

const categories = [
  { label: 'Business', icon: 'briefcase' },
  { label: 'Artificial Intelligence', icon: 'spark' },
  { label: 'Data Science', icon: 'chart' },
  { label: 'Computer Science', icon: 'code' },
  { label: 'Information Technology', icon: 'laptop' },
  { label: 'Personal Development', icon: 'rocket' },
  { label: 'Healthcare', icon: 'health' },
  { label: 'Language Learning', icon: 'globe' },
  { label: 'Social Sciences', icon: 'users' },
  { label: 'Arts and Humanities', icon: 'pen' },
  { label: 'Physical Science and Engineering', icon: 'flask' },
  { label: 'Math and Logic', icon: 'calculator' },
]

const recommendedResources = [
  {
    title: 'Python Fundamentals',
    description: 'Get comfortable with core Python concepts, syntax, and simple programs.',
    category: 'Computer Science',
    difficulty: 'Beginner',
    icon: 'code',
    tone: 'gold',
  },
  {
    title: 'Web Development Basics',
    description: 'Explore how HTML, CSS, and JavaScript work together to build websites.',
    category: 'Information Technology',
    difficulty: 'Beginner',
    icon: 'laptop',
    tone: 'teal',
  },
  {
    title: 'Introduction to Data Science',
    description: 'See how data is collected, explored, and used to answer real questions.',
    category: 'Data Science',
    difficulty: 'Beginner',
    icon: 'chart',
    tone: 'mint',
  },
  {
    title: 'SQL for Beginners',
    description: 'Learn the basics of querying tables and working with structured data.',
    category: 'Information Technology',
    difficulty: 'Beginner',
    icon: 'database',
    tone: 'cyan',
  },
  {
    title: 'JavaScript Essentials',
    description: 'Start writing interactive code with variables, functions, and events.',
    category: 'Computer Science',
    difficulty: 'Beginner',
    icon: 'code',
    tone: 'peach',
  },
  {
    title: 'Database Management',
    description: 'Understand how databases organize, store, and retrieve information.',
    category: 'Information Technology',
    difficulty: 'Intermediate',
    icon: 'database',
    tone: 'lavender',
  },
]

const tools = [
  { title: 'Grades & Results', description: 'Your assessment results will appear here.', icon: 'chart', id: 'student-grades' },
  { title: 'Learning Resources', description: 'Resources shared with your courses will appear here.', icon: 'folder', id: 'student-resources' },
  { title: 'Messages', description: 'Course conversations and messages will appear here.', icon: 'message', id: 'student-messages' },
  { title: 'Certificates', description: 'Certificates you earn will appear here.', icon: 'award', id: 'student-certificates' },
  { title: 'My Profile', description: 'Your account details are verified securely from the LMS.', icon: 'user', id: 'student-profile' },
  { title: 'Settings', description: 'Account preferences will be available here.', icon: 'settings', id: 'student-settings' },
]

function Icon({ name, size = 19 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8m-8 4h8" /></>,
    check: <><rect x="4" y="4" width="16" height="17" rx="2" /><path d="M8 3v3m8-3v3M4 9h16m-11 5 2 2 4-4" /></>,
    chart: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 5-6m-4 0h4v4" /></>,
    folder: <><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /><path d="M3 9h18" /></>,
    message: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.5-.8L4 20l1.5-4A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>,
    award: <><circle cx="12" cy="8" r="5" /><path d="m8.5 12-1 9 4.5-2.5 4.5 2.5-1-9" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.8-.6a8 8 0 0 1-1.7 1l-.3 1.9h-2.8l-.3-1.9a8 8 0 0 1-1.7-1l-1.8.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.8.6a8 8 0 0 1 1.7-1l.3-1.9h2.8l.3 1.9a8 8 0 0 1 1.7 1l1.8-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z" transform="translate(-1 -1)" /></>,
    spark: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.5 1.5c-.9 1.1-2.1 1.3-2.1 3m0 3h.01" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    logout: <><path d="M10 17l5-5-5-5m5 5H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V4h8v3m-13 5h18m-11 0v2h4v-2" /></>,
    code: <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14" /></>,
    laptop: <><rect x="4" y="4" width="16" height="12" rx="1.5" /><path d="M2 20h20l-2-4H4z" /></>,
    rocket: <><path d="M12 15 9 12c.5-4 3.5-7 10-9-.5 6.5-3.5 9.5-7 10Z" /><path d="m9 12-4 1-2 4 5-1m4-1 1 4 4 2-1-5" /><circle cx="15" cy="8" r="1" /></>,
    health: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="M12 8v7m-3.5-3.5h7" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1Zm12-9a3 3 0 1 0-1-5.8M17 14a5 5 0 0 1 4 5v1h-3" /></>,
    pen: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m14 7 3 3" /></>,
    flask: <><path d="M9 3h6m-5 0v7l-6 10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1l-6-10V3m-8 12h12" /></>,
    calculator: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8v3H8zm0 7h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01M16 17h.01" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] || paths.grid}
    </svg>
  )
}

function LearningIllustration() {
  return (
    <svg className="student-welcome__illustration" viewBox="0 0 240 172" fill="none" aria-hidden="true">
      <circle cx="154" cy="83" r="67" fill="#F7EBC8" />
      <circle cx="154" cy="83" r="52" fill="#E4F0E7" />
      <path d="M104 120h99" stroke="#AFC6B8" strokeWidth="2" strokeLinecap="round" />
      <path d="M126 119V74c0-4 3-7 7-7h42c4 0 7 3 7 7v45" fill="#FFFDF7" stroke="#D8D6C9" strokeWidth="2" />
      <path d="M147 67v52m-21-38h21m7 0h28m-28 12h28m-28 12h19" stroke="#7FA99A" strokeWidth="2" strokeLinecap="round" />
      <path d="M108 121c11-15 24-19 39-12 12 6 19 5 28 1" stroke="#D6B35B" strokeWidth="3" strokeLinecap="round" />
      <circle cx="101" cy="51" r="8" fill="#E8C460" />
      <path d="m197 38 3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#6BA99A" />
      <path d="M57 121h44m-35-9v9m26-9v9" stroke="#C9C7BA" strokeWidth="2" strokeLinecap="round" />
      <path d="M65 107h28l-3-30a11 11 0 0 0-22 0z" fill="#EBD789" />
      <path d="M72 91h14m-12 8h10" stroke="#A78A43" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function EmptyState({ icon, title, description }) {
  return (
    <div className="student-empty">
      <span className="student-empty__icon"><Icon name={icon} size={22} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  )
}

function RecommendedResourceCard({ resource }) {
  return (
    <article className="student-recommendation-card">
      <div
        className={`student-recommendation-card__thumbnail is-${resource.tone}`}
        aria-hidden="true"
      >
        <span className="student-recommendation-card__thumbnail-orbit" />
        <span className="student-recommendation-card__thumbnail-icon">
          <Icon name={resource.icon} size={34} />
        </span>
        <span className="student-recommendation-card__placeholder">Sample resource</span>
      </div>
      <div className="student-recommendation-card__body">
        <div className="student-recommendation-card__meta">
          <span>{resource.category}</span>
          <span>{resource.difficulty}</span>
        </div>
        <h3>{resource.title}</h3>
        <p>{resource.description}</p>
        <button
          className="student-recommendation-card__button"
          type="button"
          disabled
          title="This sample resource does not have a YouTube link yet."
        >
          Watch on YouTube
          <Icon name="arrow" size={15} />
        </button>
      </div>
    </article>
  )
}

function StudentRoutePage({ eyebrow, title, children }) {
  return (
    <section className="student-panel student-route-page">
      <div className="student-section-heading">
        <div>
          <span className="student-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  )
}

function StudentCourses({ user, onLogout }) {
  const [courses, setCourses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [enrollingId, setEnrollingId] = useState('')
  const [message, setMessage] = useState('')
  const isCollegeStudent = user?.studentType === 'college' || Boolean(user?.collegeId)

  async function loadCourses() {
    const savedAuth = sessionStorage.getItem('lms.auth')
    const auth = savedAuth ? JSON.parse(savedAuth) : null
    if (typeof auth?.token !== 'string') {
      onLogout()
      return
    }
    const headers = { Authorization: `Bearer ${auth.token}` }
    const [courseResponse, enrollmentResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/courses`, { headers }),
      fetch(`${API_BASE_URL}/enrollments/me`, { headers }),
    ])
    const [courseResult, enrollmentResult] = await Promise.all([
      courseResponse.json(),
      enrollmentResponse.json(),
    ])
    if (courseResponse.status === 401 || courseResponse.status === 403 ||
      enrollmentResponse.status === 401 || enrollmentResponse.status === 403) {
      onLogout()
      return
    }
    if (!courseResponse.ok) throw new Error(courseResult.message || 'Unable to load courses.')
    if (!enrollmentResponse.ok) throw new Error(enrollmentResult.message || 'Unable to load your enrollments.')
    setCourses(courseResult.courses || [])
    setEnrollments(enrollmentResult.enrollments || [])
  }

  useEffect(() => {
    loadCourses()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Unable to load course data.'))
      .finally(() => setLoading(false))
  }, [user?.id])

  async function enroll(courseId) {
    setEnrollingId(courseId)
    setError('')
    setMessage('')
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      const auth = savedAuth ? JSON.parse(savedAuth) : null
      if (typeof auth?.token !== 'string') {
        onLogout()
        return
      }
      const response = await fetch(`${API_BASE_URL}/enrollments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ courseId }),
      })
      const result = await response.json()
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      if (!response.ok) throw new Error(result.message || 'Unable to enroll in this course.')
      setMessage(result.message)
      await loadCourses()
    } catch (enrollError) {
      setError(enrollError instanceof Error ? enrollError.message : 'Unable to enroll in this course.')
    } finally {
      setEnrollingId('')
    }
  }

  const enrolledCourseIds = new Set(enrollments.map((entry) => String(entry.courseId?._id || entry.courseId)))

  return (
    <StudentRoutePage eyebrow="YOUR LEARNING SPACE" title="My Courses">
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      {message && <p className="student-courses__message" role="status">{message}</p>}
      {loading ? <p>Loading courses…</p> : (
        <>
          <h3 className="student-courses__heading">Published courses</h3>
          {courses.length === 0 ? <EmptyState icon="book" title="No published courses yet" description="Published courses will appear here when the administrator adds them." /> : (
            <div className="student-courses__list">
              {courses.map((course) => {
                const isEnrolled = enrolledCourseIds.has(String(course._id))
                return (
                  <article className="student-courses__card" key={course._id}>
                    <div><h3>{course.title}</h3><p>{course.description || 'No description provided.'}</p>
                      <small>{course.modules?.length || 0} modules</small></div>
                    {isEnrolled ? <span className="student-courses__enrolled">Enrolled</span> : isCollegeStudent
                      ? <span className="student-courses__enrolled">Ask your college administrator to enroll you</span>
                      : <button type="button" disabled={enrollingId === course._id} onClick={() => enroll(course._id)}>{enrollingId === course._id ? 'Enrolling…' : 'Enroll'}</button>}
                  </article>
                )
              })}
            </div>
          )}
          <h3 className="student-courses__heading">Current enrollments</h3>
          {enrollments.length === 0 ? <p>You are not enrolled in any courses yet.</p> : (
            <ul className="student-courses__enrollments">
              {enrollments.map((entry) => <li key={entry._id}>{entry.courseId?.title || 'Course'} <span>{entry.status}</span></li>)}
            </ul>
          )}
        </>
      )}
    </StudentRoutePage>
  )
}

function StudentDashboard({ user, loading, error, onRetry, onLogout }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const currentPage = navigation.find((item) => item.path === location.pathname)
  const pageTitle = currentPage?.label || (
    location.pathname === '/student/announcements'
      ? 'Announcements'
      : location.pathname === '/student/study-companion'
        ? 'AI Study Companion'
        : 'Dashboard'
  )
  const firstName = user?.fullName?.trim().split(/\s+/)[0] || 'Student'
  const initials = user?.fullName
    ? user.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    : 'S'

  useEffect(() => {
    setSidebarOpen(false)
    setProfileOpen(false)
    window.scrollTo(0, 0)
    document.querySelector('.student-main')?.scrollTo(0, 0)
  }, [location.pathname])

  function navigateTo(path) {
    setSidebarOpen(false)
    navigate(path)
  }

  return (
    <div className="student-dashboard">
      {sidebarOpen && (
        <button
          className="student-dashboard__scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`student-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Student navigation">
        <a className="student-sidebar__brand" href="/" aria-label="Morrow Learning home">
          <img src="/logo.png" alt="Morrow Learning" />
          <span>LEARN. GROW. BECOME.</span>
        </a>
        <p className="student-sidebar__label">LEARNING SPACE</p>
        <nav className="student-sidebar__nav">
          {navigation.map((item) => (
            <Link
              key={item.label}
              to={item.path}
              className={`student-sidebar__link${item.path === location.pathname ? ' is-active' : ''}`}
              aria-current={item.path === location.pathname ? 'page' : undefined}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.label === 'Messages' && <span className="student-sidebar__soon">Soon</span>}
            </Link>
          ))}
        </nav>
        <div className="student-sidebar__bottom">
          <div className="student-sidebar__profile">
            <span className="student-avatar">{initials}</span>
            <span className="student-sidebar__identity">
              <strong>{user?.fullName || 'Your account'}</strong>
              <small>Student account</small>
            </span>
          </div>
          <button className="student-sidebar__logout" type="button" onClick={onLogout}>
            <Icon name="logout" size={17} /> Log out
          </button>
        </div>
      </aside>

      <main className="student-main" id="student-overview">
        <header className="student-topbar">
          <button
            className="student-icon-button student-menu-toggle"
            type="button"
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <div className="student-breadcrumb"><span>Morrow Learning</span><b>/</b><strong>{pageTitle}</strong></div>
          <label className="student-search">
            <Icon name="search" size={18} />
            <input type="search" placeholder="Search courses, lessons, resources..." aria-label="Search courses, lessons, resources" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="student-topbar__actions">
            <button
              className="student-icon-button"
              type="button"
              aria-label="Announcements"
              onClick={() => navigateTo('/student/announcements')}
            >
              <Icon name="bell" />
            </button>
            <button
              className="student-icon-button"
              type="button"
              aria-label="Help and study companion"
              onClick={() => navigateTo('/student/study-companion')}
            >
              <Icon name="help" />
            </button>
            <div className="student-profile-menu">
              <button
                className="student-profile-trigger"
                type="button"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((open) => !open)}
              >
                <span className="student-avatar">{initials}</span>
                <span className="student-profile-trigger__copy">
                  <strong>{user?.fullName || 'Student'}</strong><small>Student</small>
                </span>
                <span className="student-profile-trigger__chevron">⌄</span>
              </button>
              {profileOpen && (
                <div className="student-profile-dropdown">
                  <span>{user?.email || 'Account details'}</span>
                  <button type="button" onClick={onLogout}><Icon name="logout" size={16} /> Log out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="student-content">
          {loading ? (
            <section className="student-state-card" aria-live="polite">
              <span className="student-loader" />
              <h1>Preparing your learning space</h1>
              <p>Verifying your student account...</p>
            </section>
          ) : error ? (
            <section className="student-state-card student-state-card--error" role="alert">
              <span className="student-state-card__icon"><Icon name="lock" size={22} /></span>
              <h1>We couldn’t verify your session</h1>
              <p>{error}</p>
              <div><button className="student-button" type="button" onClick={onRetry}>Try again</button>
                <button className="student-button student-button--quiet" type="button" onClick={onLogout}>Return to login</button></div>
            </section>
          ) : (
            <Routes>
              <Route path="/student/dashboard" element={
                <>
              <section className="student-welcome">
                <div className="student-welcome__copy">
                  <span className="student-eyebrow"><span /> YOUR LEARNING SPACE</span>
                  <h1>Welcome back, {firstName}!</h1>
                  <p>Continue learning, achieve your goals and track your progress.</p>
                  <span className="student-welcome__today"><Icon name="spark" size={16} /> A little progress adds up.</span>
                </div>
                <LearningIllustration />
              </section>

              <section className="student-stats" aria-label="Student statistics">
                {stats.map((stat) => (
                  <article className="student-stat" key={stat.label}>
                    <span className={`student-stat__icon is-${stat.tone}`}><Icon name={stat.icon} size={19} /></span>
                    <span className="student-stat__label">{stat.label}</span>
                    <strong className="student-stat__value" aria-label="Data unavailable">—</strong>
                    <small>Not yet connected to LMS data</small>
                  </article>
                ))}
              </section>

              <section className="student-panel student-progress-panel" aria-labelledby="student-progress-title">
                <div className="student-section-heading">
                  <div><span className="student-eyebrow">YOUR JOURNEY</span><h2 id="student-progress-title">My learning progress</h2></div>
                  <span className="student-data-note">Progress tracking unavailable</span>
                </div>
                <div className="student-progress-layout">
                  <div className="student-donut" role="img" aria-label="Overall learning completion data unavailable">
                    <div><strong>—</strong><span>OVERALL</span></div>
                  </div>
                  <div className="student-lesson-counts">
                    {[
                      ['Completed lessons', 'mint'],
                      ['Lessons in progress', 'gold'],
                      ['Lessons not started', 'gray'],
                    ].map(([label, tone]) => (
                      <div className="student-lesson-count" key={label}>
                        <span className={`student-lesson-count__dot is-${tone}`} />
                        <span>{label}</span>
                        <strong>—</strong>
                      </div>
                    ))}
                    <p>Lesson progress will appear once course tracking is connected.</p>
                  </div>
                </div>
              </section>

              <section className="student-categories" aria-labelledby="student-categories-title">
                <h2 id="student-categories-title">Explore categories</h2>
                <div className="student-categories__list">
                  {categories.map((category) => (
                    <div className="student-category" key={category.label}>
                      <Icon name={category.icon} size={19} />
                      {category.label}
                    </div>
                  ))}
                </div>
              </section>

              <section className="student-recommendations" aria-labelledby="student-recommendations-title">
                <div className="student-section-heading">
                  <div>
                    <span className="student-eyebrow">PLACEHOLDER SAMPLES</span>
                    <h2 id="student-recommendations-title">Recommended Learning Resources</h2>
                  </div>
                  <span className="student-recommendations__note">Sample content only</span>
                </div>
                <div className="student-recommendations__grid">
                  {recommendedResources.map((resource) => (
                    <RecommendedResourceCard key={resource.title} resource={resource} />
                  ))}
                </div>
              </section>

              <section className="student-panel" aria-labelledby="student-courses-title">
                <div className="student-section-heading">
                  <div><span className="student-eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2 id="student-courses-title">Continue learning</h2></div>
                  <Link className="student-section-link" to="/student/courses">Browse courses</Link>
                </div>
                <EmptyState icon="book" title="Explore the course catalog" description="Browse published courses and view your current enrollments." />
              </section>

              <div className="student-two-column">
                <section className="student-panel" aria-labelledby="student-assignments-title">
                  <div className="student-section-heading">
                    <div><span className="student-eyebrow">STAY ON TRACK</span><h2 id="student-assignments-title">Upcoming assignments</h2></div>
                    <Link className="student-section-link student-section-link--muted" to="/student/assignments">View all</Link>
                  </div>
                  <EmptyState icon="check" title="No assignment data available" description="Assignments and due dates aren’t connected to this account yet." />
                </section>
                <section className="student-panel student-announcements" aria-labelledby="student-announcements-title">
                  <div className="student-section-heading">
                    <div><span className="student-eyebrow">FROM YOUR LEARNING COMMUNITY</span><h2 id="student-announcements-title">Announcements</h2></div>
                    <span className="student-section-link student-section-link--muted">Updates</span>
                  </div>
                  <EmptyState icon="bell" title="Announcement data isn’t connected yet" description="Main Admin and College Sub-Admin announcements will appear here once the LMS provides them." />
                </section>
              </div>

              <div className="student-two-column student-lower-grid">
                <section className="student-panel student-weekly-goal" aria-labelledby="student-goal-title">
                  <span className="student-eyebrow">A STEADY RHYTHM</span>
                  <h2 id="student-goal-title">Weekly learning goal</h2>
                  <div className="student-goal-values"><strong>— <small>hrs</small></strong><span>of — hrs this week</span></div>
                  <div className="student-progress-track"><span /></div>
                  <p>Learning time and weekly goal tracking aren’t connected yet.</p>
                </section>
                <section className="student-panel student-ai-card" aria-labelledby="student-ai-title">
                  <span className="student-ai-card__icon"><Icon name="spark" size={20} /></span>
                  <span className="student-eyebrow">A HELPFUL STUDY SPACE</span>
                  <h2 id="student-ai-title">AI Study Companion</h2>
                  <p>Topic explanations, lesson summaries and practice questions are planned for a future release.</p>
                  <span className="student-ai-card__status">Not connected to an AI service</span>
                </section>
              </div>

              <section className="student-tools" aria-labelledby="student-tools-title">
                <div className="student-section-heading">
                  <div><span className="student-eyebrow">MORE FOR YOUR JOURNEY</span><h2 id="student-tools-title">Student tools</h2></div>
                </div>
                <div className="student-tools-grid">
                  {tools.map((tool) => (
                    <article className="student-tool-card" id={tool.id} key={tool.id}>
                      <span className="student-tool-card__icon"><Icon name={tool.icon} size={19} /></span>
                      <h3>{tool.title}</h3>
                      <p>{tool.description}</p>
                      <span className="student-tool-card__status">Coming as LMS features are connected</span>
                    </article>
                  ))}
                </div>
              </section>
              <footer className="student-footer"><span>Made for curious minds</span><span>Keep going, one lesson at a time.</span></footer>
                </>
              } />
              <Route path="/student/courses" element={<StudentCourses user={user} onLogout={onLogout} />} />
              <Route path="/student/assignments" element={
                <StudentRoutePage eyebrow="STAY ON TRACK" title="Assignments">
                  <EmptyState icon="check" title="No assignment data available" description="Assignments and due dates aren’t connected to this account yet." />
                </StudentRoutePage>
              } />
              <Route path="/student/results" element={
                <StudentRoutePage eyebrow="YOUR ACHIEVEMENTS" title="Grades &amp; Results">
                  <EmptyState icon="chart" title="Results are not available yet" description="Grades and assessment results will appear here when the LMS results API is connected." />
                </StudentRoutePage>
              } />
              <Route path="/student/resources" element={
                <StudentRoutePage eyebrow="KEEP EXPLORING" title="Learning Resources">
                  <EmptyState icon="folder" title="Learning resources are not connected yet" description="Curated learning resources will appear here when the LMS content catalog is connected." />
                </StudentRoutePage>
              } />
              <Route path="/student/messages" element={
                <StudentRoutePage eyebrow="YOUR LEARNING COMMUNITY" title="Messages">
                  <EmptyState icon="message" title="Messages are not connected yet" description="Course conversations and messages will appear here when messaging is available." />
                </StudentRoutePage>
              } />
              <Route path="/student/certificates" element={
                <StudentRoutePage eyebrow="YOUR ACHIEVEMENTS" title="Certificates">
                  <EmptyState icon="award" title="No certificates to show yet" description="Certificates you earn will appear here." />
                </StudentRoutePage>
              } />
              <Route path="/student/profile" element={
                <StudentRoutePage eyebrow="YOUR ACCOUNT" title="My Profile">
                  <dl className="student-profile-details">
                    <div><dt>Full name</dt><dd>{user?.fullName || 'Not provided'}</dd></div>
                    <div><dt>Email</dt><dd>{user?.email || 'Not provided'}</dd></div>
                    <div><dt>Username</dt><dd>{user?.username || 'Not provided'}</dd></div>
                    <div><dt>Account type</dt><dd>Student</dd></div>
                  </dl>
                </StudentRoutePage>
              } />
              <Route path="/student/settings" element={
                <StudentRoutePage eyebrow="PREFERENCES" title="Settings">
                  <EmptyState icon="settings" title="Settings are not available yet" description="Account preferences will be available here in a future LMS update." />
                </StudentRoutePage>
              } />
              <Route path="/student/announcements" element={
                <StudentRoutePage eyebrow="FROM YOUR LEARNING COMMUNITY" title="Announcements">
                  <EmptyState icon="bell" title="Announcement data isn’t connected yet" description="Main Admin and College Sub-Admin announcements will appear here once the LMS provides them." />
                </StudentRoutePage>
              } />
              <Route path="/student/study-companion" element={
                <StudentRoutePage eyebrow="A HELPFUL STUDY SPACE" title="AI Study Companion">
                  <EmptyState icon="spark" title="Study Companion is not connected" description="Topic explanations, lesson summaries and practice questions are planned for a future release." />
                </StudentRoutePage>
              } />
              <Route path="*" element={<Navigate to="/student/dashboard" replace />} />
            </Routes>
          )}
        </div>
      </main>
    </div>
  )
}

export default StudentDashboard
