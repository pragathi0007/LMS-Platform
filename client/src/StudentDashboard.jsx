import React, { useEffect, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { API_BASE_URL } from './api-base-url.js'
import {
  EmailSupportPage,
  HelpCenterHome,
  SubmitSupportTicketPage,
  SupportFaqPage,
  SupportRequestsPage,
  SupportTicketDetailPage,
} from './SupportCenter.jsx'
import SettingsPage from './SettingsPage.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { isInvalidSessionResponse } from './auth-session.js'
import NotificationFeed from './NotificationFeed.jsx'
import StudentQuizExperience from './StudentQuizPanel.jsx'
import './StudentDashboard.css'

const COURSE_NOTES_KEY = 'course-notes'
const COURSE_RESOURCES_KEY = 'course-resources'

const navigation = [
  { label: 'Dashboard', icon: 'grid', path: '/student/dashboard' },
  { label: 'My Courses', icon: 'book', path: '/student/courses' },
  { label: 'Assignments', icon: 'check', path: '/student/assignments' },
  { label: 'Grades & Results', icon: 'chart', path: '/student/results' },
  { label: 'Learning Resources', icon: 'folder', path: '/student/resources' },
  { label: 'Messages', icon: 'message', path: '/student/messages' },
  { label: 'Certificates', icon: 'award', path: '/student/certificates' },
  { label: 'My Referrals', icon: 'users', path: '/student/referrals' },
  { label: 'My Profile', icon: 'user', path: '/student/profile' },
  { label: 'Settings', icon: 'settings', path: '/student/settings' },
  { label: 'Help Center', icon: 'help', path: '/student/help' },
]

const secondaryPages = {
  '/student/announcements': { label: 'Updates', icon: 'bell' },
  '/student/updates': { label: 'Updates', icon: 'bell' },
  '/student/purchases': { label: 'My Purchases', icon: 'bookOpen' },
  '/student/achievements': { label: 'My Achievements', icon: 'award' },
  '/student/learning-activity': { label: 'Learning Streak', icon: 'chartNoAxesCombined' },
  '/student/study-companion': { label: 'AI Study Companion', icon: 'spark' },
}

const stats = [
  { label: 'Enrolled courses', value: 'enrolledCourses', caption: 'courses in your learning plan', icon: 'book', tone: 'gold' },
  { label: 'Pending assignments', value: 'pendingAssignments', caption: 'assignments awaiting submission', icon: 'check', tone: 'peach' },
  { label: 'Completed courses', value: 'completedCourses', caption: 'courses with every lesson complete', icon: 'award', tone: 'mint' },
  { label: 'Learning streak', value: 'learningStreak', caption: 'consecutive active days', icon: 'spark', tone: 'blue' },
]

const emptyLearningSummary = {
  enrolledCourses: 0,
  pendingAssignments: 0,
  completedCourses: 0,
  learningStreak: 0,
  completedLessons: 0,
  inProgressLessons: 0,
  notStartedLessons: 0,
  totalLessons: 0,
  completionPercentage: 0,
}

const categories = [
  { label: 'Digital Marketing', icon: 'chart' },
  { label: 'Python', icon: 'code' },
  { label: 'Prompt Engineering', icon: 'spark' },
  { label: 'UI/UX Design', icon: 'pen' },
  { label: 'Full Stack Development', icon: 'laptop' },
  { label: 'Web Development', icon: 'laptop' },
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
    layoutDashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
    bookOpen: <><path d="M12 7v14" /><path d="M3 18V5a1 1 0 0 1 1-1h4a4 4 0 0 1 4 4 4 4 0 0 1 4-4h4a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-4a4 4 0 0 0-4 2 4 4 0 0 0-4-2H4a1 1 0 0 1-1-1Z" /></>,
    play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4z" /></>,
    clipboardCheck: <><rect x="8" y="4" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></>,
    chartNoAxesCombined: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-5 5" /></>,
    messageCircle: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.5-.8L4 20l1.5-4A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>,
    userRound: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    circleHelp: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.5 1.5c-.9 1.1-2.1 1.3-2.1 3m0 3h.01" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8m-8 4h8" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1.1-1.1" /></>,
    check: <><rect x="4" y="4" width="16" height="17" rx="2" /><path d="M8 3v3m8-3v3M4 9h16m-11 5 2 2 4-4" /></>,
    chart: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 5-6m-4 0h4v4" /></>,
    folder: <><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /><path d="M3 9h18" /></>,
    folderOpen: <><path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4H10l2 2h6.5A1.5 1.5 0 0 1 20 7.5V9" /><path d="M3 10h18l-2.1 8.4a2 2 0 0 1-1.9 1.6H5a2 2 0 0 1-2-2z" /></>,
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

function StudentRoutePage({ title, children, to, showHeading = false, className = '' }) {
  const Element = to ? Link : 'section'
  return (
    <Element className={`student-panel student-route-page ${className}`.trim()} {...(to ? { to } : {})}>
      {showHeading && (
        <div className="student-section-heading">
          <div>
            <h2>{title}</h2>
          </div>
        </div>
      )}
      {children}
    </Element>
  )
}

async function fetchMyEnrollments(onLogout, signal) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (typeof auth?.token !== 'string') {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  const response = await fetch(`${API_BASE_URL}/enrollments/me`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    signal,
  })
  const result = await response.json()
  if (isInvalidSessionResponse(response, result)) {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  if (!response.ok) throw new Error(result.message || 'Your learning data could not be loaded.')
  if (!Array.isArray(result.enrollments)) throw new Error('The server returned invalid enrollment data.')
  return result.enrollments
}

async function fetchStudentLearningSummary(onLogout, signal) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (typeof auth?.token !== 'string') {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  const response = await fetch(`${API_BASE_URL}/learning/summary`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    signal,
  })
  const result = await response.json()
  if (isInvalidSessionResponse(response, result)) {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  if (!response.ok) throw new Error(result.message || 'Learning statistics could not be loaded.')
  if (!result.summary || Object.keys(emptyLearningSummary).some((key) => !Number.isFinite(result.summary[key]))) {
    throw new Error('The server returned invalid learning statistics.')
  }
  return result.summary
}

async function fetchStudentCourseContent(courseId, onLogout, signal) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (typeof auth?.token !== 'string') {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  const response = await fetch(`${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/learning-content`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    signal,
  })
  const result = await response.json()
  if (isInvalidSessionResponse(response, result)) {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  if (!response.ok) throw new Error(result.message || 'Your course content could not be loaded.')
  if (!result.enrollment?._id || !result.enrollment.courseId || !Array.isArray(result.assignmentSubmissions) || !Array.isArray(result.quizAttempts)) {
    throw new Error('The server returned invalid course content.')
  }
  return result
}

async function fetchPublishedCourses(onLogout, signal) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (typeof auth?.token !== 'string') {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  const response = await fetch(`${API_BASE_URL}/courses`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    signal,
  })
  const result = await response.json()
  if (isInvalidSessionResponse(response, result)) {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  if (!response.ok) throw new Error(result.message || 'Available courses could not be loaded.')
  if (!Array.isArray(result.courses)) throw new Error('The server returned invalid course data.')
  return result.courses
}

function getCourseCounts(course) {
  const lessonCount = (course.modules || []).reduce((count, module) => {
    const items = module.contentItems || []
    return count + (items.length
      ? items.filter((item) => item.type === 'video-lesson').length
      : (module.lessons || []).length)
  }, 0)
  return { modules: course.modules?.length || 0, lessons: lessonCount }
}

function formatCourseDuration(minutes) {
  const value = Number(minutes) || 0
  if (value < 60) return `${value} min`
  const hours = Math.floor(value / 60)
  const remainder = value % 60
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`
}

function getCourseLessons(course) {
  return (course?.modules || []).flatMap((module, moduleIndex) => {
    const videoItems = (module.contentItems || []).filter((item) => item.type === 'video-lesson')
    const lessons = videoItems.length ? videoItems : module.lessons || []
    return lessons.map((lesson, lessonIndex) => ({
      module,
      lesson,
      moduleKey: String(module._id || `${module.title}-${moduleIndex}`),
      lessonKey: String(lesson._id || `${moduleIndex}-${lessonIndex}`),
    }))
  })
}

function getCourseProgress(enrollment) {
  const lessons = getCourseLessons(enrollment.courseId)
  const completedIds = new Set((enrollment.completedLessonIds || []).map(String))
  const completedCount = lessons.filter(({ lesson }) => completedIds.has(String(lesson._id))).length
  return {
    completedCount,
    totalCount: lessons.length,
    percentage: lessons.length ? Math.round((completedCount / lessons.length) * 100) : 0,
  }
}

function getModuleLearningItems(module, moduleIndex) {
  const moduleKey = String(module._id || `${module.title}-${moduleIndex}`)
  const contentItems = module.contentItems?.length
    ? module.contentItems
      .map((item, index) => ({ item, index }))
      .sort((left, right) => (left.item.order ?? left.index) - (right.item.order ?? right.index))
      .map(({ item, index }) => ({
        ...item,
        _learningKey: String(item._id || `${moduleKey}-item-${index}`),
        _moduleKey: moduleKey,
      }))
    : (module.lessons || []).map((lesson, index) => ({
      ...lesson,
      type: 'video-lesson',
      _learningKey: String(lesson._id || `${moduleKey}-lesson-${index}`),
      _moduleKey: moduleKey,
    }))
  const items = [...contentItems]
  if (module.quiz?.questions?.length && !contentItems.some((item) => item.type === 'quiz')) {
    items.push({
      type: 'quiz',
      title: module.quiz.title || 'Module quiz',
      quiz: module.quiz,
      _learningKey: String(module.quiz._id || `${moduleKey}-quiz`),
      _moduleKey: moduleKey,
    })
  }
  return items
}

function getStudentContentLabel(type) {
  return {
    'video-lesson': 'Video',
    quiz: 'Quiz',
    assignment: 'Assignment',
    note: 'Notes / resources',
  }[type] || 'Course content'
}

function StudentAssignmentPanel({ courseId, enrollmentId, assignment, submissions, onSubmitted, onLearningDataChanged, onLogout, showHeader = true }) {
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const assignmentSubmissions = submissions.filter((submission) => (
    String(submission.assignmentId) === String(assignment._id)
  ))

  async function submitAssignment(event) {
    event.preventDefault()
    const form = event.currentTarget
    if (!file) {
      setError('Choose a PDF, DOCX, or TXT file to submit.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      const auth = savedAuth ? JSON.parse(savedAuth) : null
      if (typeof auth?.token !== 'string') {
        onLogout()
        return
      }
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(`${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignment._id)}/submissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}` },
        body: formData,
      })
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok) throw new Error(result.message || 'Your assignment could not be submitted.')
      if (!result.submission?._id) throw new Error('The server did not confirm your assignment submission.')
      onSubmitted(result.submission)
      setFile(null)
      form.reset()
      onLearningDataChanged()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Your assignment could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="student-course-activity">
      {showHeader && (
        <header>
          <span className="student-eyebrow">{getStudentContentLabel('assignment')}</span>
          <h2>{assignment.title}</h2>
        </header>
      )}
      {assignment.description && <p className="student-course-activity__instructions">{assignment.description}</p>}
      <div className="student-course-activity__details">
        <span>Due {assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No due date'}</span>
        <span>{Number(assignment.points) || 0} points</span>
      </div>
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      <form className="student-assignment-submit" onSubmit={submitAssignment}>
        <label>
          <span>Upload your work (PDF, DOCX, or TXT · max 10 MB)</span>
          <input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => setFile(event.currentTarget.files?.[0] || null)} />
        </label>
        <button className="student-button" type="submit" disabled={submitting || !assignment._id}>
          {submitting ? 'Submitting…' : 'Submit assignment'}
        </button>
      </form>
      {assignmentSubmissions.length > 0 && (
        <div className="student-assignment-submissions">
          <h3>Submissions</h3>
          {assignmentSubmissions.map((submission) => (
            <a key={submission._id} href={`${API_BASE_URL}/assignment-submissions/${encodeURIComponent(submission._id)}/download`} onClick={async (event) => {
              event.preventDefault()
              try {
                const savedAuth = sessionStorage.getItem('lms.auth')
                const auth = savedAuth ? JSON.parse(savedAuth) : null
                if (typeof auth?.token !== 'string') {
                  onLogout()
                  return
                }
                const response = await fetch(event.currentTarget.href, { headers: { Authorization: `Bearer ${auth.token}` } })
                if (isInvalidSessionResponse(response, {})) {
                  onLogout()
                  return
                }
                if (!response.ok) throw new Error('The submitted file could not be downloaded.')
                const blob = await response.blob()
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = submission.fileName
                link.click()
                URL.revokeObjectURL(url)
              } catch (downloadError) {
                setError(downloadError instanceof Error ? downloadError.message : 'The submitted file could not be downloaded.')
              }
            }}>
              {submission.fileName} · Submitted {new Date(submission.submittedAt).toLocaleString()}
            </a>
          ))}
        </div>
      )}
    </section>
  )
}

function StudentNotePanel({ item }) {
  return (
    <section className="student-course-activity">
      <header>
        <span className="student-eyebrow">{getStudentContentLabel('note')}</span>
        <h2>{item.title}</h2>
      </header>
      {item.description && <p className="student-course-activity__instructions">{item.description}</p>}
      {item.content && <div className="student-course-note__content">{item.content}</div>}
      {item.resources?.length > 0 ? (
        <ul className="student-course-note__resources">
          {item.resources.map((resource, index) => (
            <li key={resource._id || `${resource.url}-${index}`}>
              <a href={resource.url} target="_blank" rel="noreferrer" download={resource.resourceType === 'raw' || resource.format === 'pdf' ? resource.title : undefined}>
                {resource.title || `Resource ${index + 1}`}
              </a>
              {resource.format && <small>{resource.format.toUpperCase()}</small>}
            </li>
          ))}
        </ul>
      ) : <p>No downloadable resources were added to this note.</p>}
    </section>
  )
}

function EnrollmentCourseCard({ enrollment }) {
  const course = enrollment.courseId
  const courseId = String(course._id)
  const counts = getCourseCounts(course)
  const { completedCount, totalCount, percentage } = getCourseProgress(enrollment)
  const difficultyLabels = {
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    'all-levels': 'All levels',
  }
  const coursePath = `/student/course/${encodeURIComponent(courseId)}/learn`

  return (
    <article className="student-available-course student-enrolled-course">
      {course.thumbnailUrl
        ? <img className="student-available-course__thumbnail" src={course.thumbnailUrl} alt={`${course.title} course thumbnail`} />
        : <div className="student-available-course__thumbnail student-available-course__thumbnail--empty" aria-label="No course thumbnail"><Icon name="book" size={28} /></div>}
      <div className="student-available-course__body student-enrolled-course__body">
        <div className="student-available-course__heading">
          <div>
            <p className="student-available-course__category">
              {course.category || 'Other'} <span>·</span> {difficultyLabels[course.difficulty] || 'Not specified'}
            </p>
            <h3>{course.title}</h3>
          </div>
          <span className="student-available-course__status">
            {course.status === 'published' ? 'Published' : 'Enrolled'}
          </span>
        </div>
        <p className="student-available-course__description">{course.description || course.detailedDescription || 'No course description is available.'}</p>
        <div className="student-available-course__meta">
          <span>{counts.modules} modules</span>
          <span>{counts.lessons} lessons</span>
          <span>{formatCourseDuration(course.estimatedDurationMinutes)}</span>
        </div>
        <div className="student-enrolled-course__progress">
          <div className="student-enrolled-course__progress-copy">
            <span>Learning progress</span>
            <strong>{completedCount} of {totalCount} lessons · {percentage}%</strong>
          </div>
          <div className="student-enrolled-course__progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percentage} aria-label={`${course.title} progress`}>
            <span style={{ width: `${percentage}%` }} />
          </div>
        </div>
        <Link className="student-enrolled-course__continue" to={coursePath}>
          Continue Learning
          <Icon name="arrow" size={16} />
        </Link>
      </div>
    </article>
  )
}

function EnrollmentCourseCards({
  enrollments,
  emptyTitle = 'No enrolled courses yet',
  emptyDescription = 'Courses assigned or enrolled for your account will appear here.',
}) {
  const availableEnrollments = enrollments.filter((entry) => entry.courseId && typeof entry.courseId === 'object')
  if (!availableEnrollments.length) {
    return enrollments.length
      ? <p className="student-courses__message is-error" role="alert">Your enrollment exists, but its course details are unavailable. Please contact your administrator.</p>
      : <EmptyState icon="book" title={emptyTitle} description={emptyDescription} />
  }
  return (
    <div className="student-enrolled-courses">
      {availableEnrollments.map((entry) => <EnrollmentCourseCard key={entry._id} enrollment={entry} />)}
    </div>
  )
}

function StudentDashboardCourses({ onLogout, selectedCategory }) {
  const [enrollments, setEnrollments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchMyEnrollments(onLogout, controller.signal)
      .then(setEnrollments)
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Your courses could not be loaded.')
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [onLogout])

  const categoryEnrollments = selectedCategory
    ? enrollments.filter((entry) => (
      typeof entry.courseId === 'object'
      && entry.courseId
      && entry.courseId.category?.trim().toLowerCase() === selectedCategory.toLowerCase()
    ))
    : enrollments.slice(0, 3)

  return loading
    ? <p role="status">Loading your courses…</p>
    : error
      ? <p className="student-courses__message is-error" role="alert">{error}</p>
      : <EnrollmentCourseCards
        enrollments={categoryEnrollments}
        emptyTitle={selectedCategory ? `No ${selectedCategory} courses yet` : 'No enrolled courses yet'}
        emptyDescription={selectedCategory
          ? `Enrolled courses in ${selectedCategory} will appear here.`
          : 'Courses assigned or enrolled for your account will appear here.'}
      />
}

function StudentAvailableCourseCard({ course, enrollment, onEnroll, enrolling, error }) {
  const counts = getCourseCounts(course)
  const difficultyLabels = {
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    'all-levels': 'All levels',
  }
  return (
    <article className="student-available-course">
      {course.thumbnailUrl
        ? <img className="student-available-course__thumbnail" src={course.thumbnailUrl} alt={`${course.title} course thumbnail`} />
        : <div className="student-available-course__thumbnail student-available-course__thumbnail--empty" aria-label="No course thumbnail"><Icon name="book" size={28} /></div>}
      <div className="student-available-course__body">
        <div className="student-available-course__heading">
          <div>
            <p className="student-available-course__category">
              {course.category || 'Other'} <span>·</span> {difficultyLabels[course.difficulty] || 'Beginner'}
            </p>
            <h3>{course.title}</h3>
          </div>
          <span className="student-available-course__status">{enrollment ? 'Enrolled' : 'Not Enrolled'}</span>
        </div>
        <p className="student-available-course__description">{course.description || course.detailedDescription || 'No course description added yet.'}</p>
        <div className="student-available-course__meta">
          <span>{counts.modules} modules</span>
          <span>{counts.lessons} lessons</span>
          <span>{formatCourseDuration(course.estimatedDurationMinutes)}</span>
        </div>
        {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
        {enrollment
          ? <Link className="student-available-course__action" to={`/student/course/${encodeURIComponent(course._id)}/learn`}>
            Continue Learning <Icon name="arrow" size={15} />
          </Link>
          : <button className="student-available-course__action" type="button" onClick={() => onEnroll(course)} disabled={enrolling}>
            {enrolling ? 'Enrolling…' : 'Enroll Now'} <Icon name="arrow" size={15} />
          </button>}
      </div>
    </article>
  )
}

function StudentAvailableCourses({ user, onLogout, onLearningDataChanged }) {
  const [courses, setCourses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [enrollingCourseId, setEnrollingCourseId] = useState('')
  const [enrollmentErrors, setEnrollmentErrors] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetchPublishedCourses(onLogout, controller.signal),
      fetchMyEnrollments(onLogout, controller.signal),
    ])
      .then(([publishedCourses, currentEnrollments]) => {
        setCourses(publishedCourses)
        setEnrollments(currentEnrollments)
      })
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Available courses could not be loaded.')
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [onLogout, user?.id])

  const enrollmentsByCourseId = new Map()
  for (const entry of enrollments) {
    if (!entry.courseId || entry.status === 'cancelled') continue
    const enrolledCourseId = String(entry.courseId?._id || entry.courseId)
    if (!enrollmentsByCourseId.has(enrolledCourseId)) enrollmentsByCourseId.set(enrolledCourseId, entry)
  }

  async function enrollInCourse(course) {
    const courseId = String(course._id)
    setEnrollingCourseId(courseId)
    setEnrollmentErrors((current) => ({ ...current, [courseId]: '' }))
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
          Authorization: `******`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ courseId }),
      })
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok) throw new Error(result.message || 'You could not be enrolled in this course.')
      if (!result.enrollment?._id) throw new Error('The server did not confirm your enrollment.')
      setEnrollments((current) => [
        { ...result.enrollment, courseId: course },
        ...current.filter((entry) => String(entry.courseId?._id || entry.courseId) !== courseId),
      ])
      onLearningDataChanged()
    } catch (enrollError) {
      setEnrollmentErrors((current) => ({
        ...current,
        [courseId]: enrollError instanceof Error ? enrollError.message : 'You could not be enrolled in this course.',
      }))
    } finally {
      setEnrollingCourseId('')
    }
  }

  return (
    <section className="student-panel student-available-courses" aria-labelledby="student-available-courses-title">
      <div className="student-section-heading">
        <div><span className="student-eyebrow">KEEP LEARNING</span><h2 id="student-available-courses-title">All Courses</h2></div>
      </div>
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading courses…</p> : !error && (
        courses.length
          ? <div className="student-available-courses__grid">
            {courses.map((course) => (
              <StudentAvailableCourseCard
                key={course._id}
                course={course}
                enrollment={enrollmentsByCourseId.get(String(course._id))}
                onEnroll={enrollInCourse}
                enrolling={enrollingCourseId === String(course._id)}
                error={enrollmentErrors[String(course._id)]}
              />
            ))}
          </div>
          : <EmptyState
            icon="book"
            title="No published courses yet"
            description="Published courses will appear here when the administrator adds them."
          />
      )}
    </section>
  )
}

function StudentCourseLearning({
  enrollment,
  onEnrollmentUpdated,
  onLearningDataChanged,
  onLogout,
  requestedLessonId,
  contentSearch,
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const course = enrollment.courseId
  const lessons = getCourseLessons(course)
  const moduleItems = (course.modules || []).map((module, index) => ({
    module,
    moduleKey: String(module._id || `${module.title}-${index}`),
    items: getModuleLearningItems(module, index),
  }))
  const courseLevelItems = [
    ...(course.quizzes || []).map((quiz, index) => ({
      type: 'quiz',
      title: quiz.title || `Course quiz ${index + 1}`,
      quiz,
      _learningKey: String(quiz._id || `course-quiz-${index}`),
      _moduleKey: '',
    })),
    ...(course.assignments || []).map((assignment, index) => ({
      ...assignment,
      type: 'assignment',
      _learningKey: String(assignment._id || `course-assignment-${index}`),
      _moduleKey: '',
    })),
  ]
  const allContentItems = [...moduleItems.flatMap(({ items }) => items), ...courseLevelItems]
  const [activeLessonId, setActiveLessonId] = useState(() => (
    lessons.some(({ lesson }) => String(lesson._id) === requestedLessonId)
      ? requestedLessonId
      : lessons[0]?.lessonKey || ''
  ))
  const [activeContentItemId, setActiveContentItemId] = useState('')
  const [detailsTab, setDetailsTab] = useState('overview')
  const [expandedModules, setExpandedModules] = useState(() => new Set(
    course.modules?.length ? [String(course.modules[0]._id || `${course.modules[0].title}-0`)] : [],
  ))
  const [savingLessonId, setSavingLessonId] = useState('')
  const [progressError, setProgressError] = useState('')
  const [assignmentSubmissions, setAssignmentSubmissions] = useState(enrollment.assignmentSubmissions || [])
  const [quizAttempts, setQuizAttempts] = useState(enrollment.quizAttempts || [])
  const videoPlayerRef = useRef(null)
  const startedLessonIds = useRef(new Set([
    ...(enrollment.startedLessonIds || []).map(String),
    ...(enrollment.completedLessonIds || []).map(String),
  ]))
  const activeIndex = Math.max(0, lessons.findIndex(({ lesson, lessonKey }) => (
    String(lesson._id || lessonKey) === activeLessonId
  )))
  const activeEntry = lessons[activeIndex]
  const activeContentItem = allContentItems.find((item) => item._learningKey === activeContentItemId)
  const completedLessonIds = new Set((enrollment.completedLessonIds || []).map(String))
  const filteredModuleItems = moduleItems.map((group) => ({
    ...group,
    items: group.items.filter((item) => (
      !contentSearch || item.title?.toLowerCase().includes(contentSearch.trim().toLowerCase())
    )),
  }))
  const filteredCourseLevelItems = courseLevelItems.filter((item) => (
    !contentSearch || item.title?.toLowerCase().includes(contentSearch.trim().toLowerCase())
  ))
  const courseResources = [
    ...lessons.flatMap(({ lesson }) => lesson.resources || []),
    ...allContentItems.flatMap((item) => item.resources || []),
  ].filter((resource) => resource.url)
    .filter((resource, index, resources) => resources.findIndex((entry) => entry.url === resource.url) === index)
  const courseNotes = allContentItems.filter((item) => item.type === 'note')
  const activeContentIndex = allContentItems.findIndex((item) => (
    item._learningKey === activeContentItemId
    || (!activeContentItemId && item.type === 'video-lesson' && item._learningKey === activeEntry?.lessonKey)
  ))
  const showVideoPlayer = detailsTab === 'overview'
    && (!activeContentItem || activeContentItem.type === 'video-lesson')

  useEffect(() => {
    const matchedLesson = lessons.find(({ lesson }) => String(lesson._id) === requestedLessonId)
    if (matchedLesson) {
      setActiveLessonId(String(matchedLesson.lesson._id))
      setExpandedModules((current) => new Set(current).add(matchedLesson.moduleKey))
    } else if (lessons.length && !lessons.some(({ lesson, lessonKey }) => String(lesson._id || lessonKey) === activeLessonId)) {
      setActiveLessonId(lessons[0].lessonKey)
    }
  }, [requestedLessonId, course._id])

  useEffect(() => {
    if (activeEntry) void setLessonStarted(activeEntry)
  }, [activeLessonId, enrollment._id])

  function selectLesson(entry) {
    const id = String(entry.lesson._id || entry.lessonKey)
    setActiveContentItemId('')
    setDetailsTab('overview')
    setActiveLessonId(id)
    setExpandedModules((current) => new Set(current).add(entry.moduleKey))
    const params = new URLSearchParams(location.search)
    params.set('lesson', id)
    navigate(`${location.pathname}?${params.toString()}`, { replace: true })
  }

  function selectContentItem(item) {
    if (item.type === 'video-lesson') {
      const lesson = lessons.find((entry) => String(entry.lesson._id || entry.lessonKey) === item._learningKey)
      if (lesson) selectLesson(lesson)
      return
    }
    videoPlayerRef.current?.pause()
    setActiveContentItemId(item._learningKey)
    setDetailsTab(item.type === 'note' ? 'notes' : 'overview')
    if (item._moduleKey) {
      setExpandedModules((current) => new Set(current).add(item._moduleKey))
    }
  }

  function addAssignmentSubmission(submission) {
    setAssignmentSubmissions((current) => [submission, ...current])
  }

  function addQuizAttempt(attempt) {
    setQuizAttempts((current) => [attempt, ...current.filter((entry) => String(entry._id) !== String(attempt._id))])
  }

  async function setLessonStarted(entry) {
    const lessonId = String(entry.lesson._id || '')
    if (!lessonId || startedLessonIds.current.has(lessonId)) return
    startedLessonIds.current.add(lessonId)
    setProgressError('')
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      const auth = savedAuth ? JSON.parse(savedAuth) : null
      if (typeof auth?.token !== 'string') {
        startedLessonIds.current.delete(lessonId)
        onLogout()
        return
      }
      const response = await fetch(`${API_BASE_URL}/enrollments/${encodeURIComponent(enrollment._id)}/progress`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lessonId, started: true }),
      })
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        startedLessonIds.current.delete(lessonId)
        onLogout()
        return
      }
      if (!response.ok) throw new Error(result.message || 'Lesson progress could not be saved.')
      onLearningDataChanged()
    } catch (saveError) {
      startedLessonIds.current.delete(lessonId)
      setProgressError(saveError instanceof Error ? saveError.message : 'Lesson progress could not be saved.')
    }
  }

  async function setLessonCompleted(entry, completed) {
    const lessonId = String(entry.lesson._id || '')
    if (!lessonId) {
      setProgressError('This lesson cannot be tracked because it has no saved lesson ID.')
      return
    }
    setSavingLessonId(lessonId)
    setProgressError('')
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      const auth = savedAuth ? JSON.parse(savedAuth) : null
      if (typeof auth?.token !== 'string') {
        onLogout()
        return
      }
      const response = await fetch(`${API_BASE_URL}/enrollments/${encodeURIComponent(enrollment._id)}/progress`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lessonId, completed }),
      })
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok) throw new Error(result.message || 'Lesson progress could not be saved.')
      onEnrollmentUpdated({ ...enrollment, completedLessonIds: result.completedLessonIds || [] })
      startedLessonIds.current.add(lessonId)
      onLearningDataChanged()
    } catch (saveError) {
      setProgressError(saveError instanceof Error ? saveError.message : 'Lesson progress could not be saved.')
    } finally {
      setSavingLessonId('')
    }
  }

  function moveLesson(offset) {
    const nextEntry = lessons[activeIndex + offset]
    if (nextEntry) selectLesson(nextEntry)
  }

  function moveContent(offset) {
    const nextItem = allContentItems[activeContentIndex + offset]
    if (nextItem) selectContentItem(nextItem)
  }

  return (
    <div className="student-course-learning">
      {progressError && <p className="student-courses__message is-error" role="alert">{progressError}</p>}
      {allContentItems.length ? (
        <div className="student-course-learning__layout">
          <aside className="student-course-learning__sidebar" aria-label="Course modules and lessons">
            <header className="student-course-learning__sidebar-header">
              <h2 className={course.title?.trim().toLowerCase() === 'python' ? 'is-python' : undefined}>{course.title}</h2>
            </header>
            {filteredModuleItems.map(({ module, moduleKey, items }) => {
              const expanded = expandedModules.has(moduleKey) || Boolean(contentSearch.trim())
              return (
                <section className={`student-course-learning__module${expanded ? ' is-expanded' : ''}`} key={moduleKey}>
                  <button type="button" aria-expanded={expanded} onClick={() => {
                    setExpandedModules((current) => {
                      const next = new Set(current)
                      if (next.has(moduleKey)) next.delete(moduleKey)
                      else next.add(moduleKey)
                      return next
                    })
                  }}>
                    <span>{module.title}<small>{items.length} {items.length === 1 ? 'item' : 'items'}</small></span><span>{expanded ? '⌃' : '⌄'}</span>
                  </button>
                  {expanded && (items.length
                    ? <ul>{items.map((item) => {
                      const isSelected = item._learningKey === activeContentItemId
                        || (!activeContentItem && detailsTab === 'overview' && item.type === 'video-lesson' && item._learningKey === activeEntry?.lessonKey)
                      const isCompleted = item.type === 'video-lesson' && completedLessonIds.has(String(item._id))
                      const quizAttemptCount = item.quiz?._id
                        ? quizAttempts.filter((attempt) => String(attempt.quizId) === String(item.quiz._id)).length
                        : 0
                      const assignmentSubmitted = item.type === 'assignment'
                        && assignmentSubmissions.some((submission) => String(submission.assignmentId) === String(item._id))
                      const status = item.type === 'video-lesson'
                        ? isCompleted ? 'Completed' : item.durationSeconds ? `${Math.ceil(item.durationSeconds / 60)} min` : 'Video'
                        : item.type === 'quiz'
                          ? `${quizAttemptCount} ${quizAttemptCount === 1 ? 'attempt' : 'attempts'}`
                          : item.type === 'assignment'
                            ? assignmentSubmitted ? 'Submitted' : 'Assignment'
                            : item.type === 'note' ? 'Notes / PDF' : getStudentContentLabel(item.type)
                      return (
                        <li key={item._learningKey}>
                          <button
                            id={item._id ? `student-content-${item._id}` : undefined}
                            className={isSelected ? 'is-selected' : ''}
                            type="button"
                            aria-current={isSelected ? 'true' : undefined}
                            onClick={() => selectContentItem(item)}
                          >
                            <span className={`student-course-learning__item-icon${isCompleted || assignmentSubmitted ? ' is-complete' : ''}`}>
                              <Icon name={isCompleted || assignmentSubmitted ? 'check' : item.type === 'assignment' || item.type === 'quiz' ? 'clipboardCheck' : item.type === 'note' ? 'folderOpen' : 'play'} size={15} />
                            </span>
                            <span className="student-course-learning__item-copy"><strong>{item.title}</strong><small>{status}</small></span>
                            {isSelected && <span className="student-course-learning__play">▶</span>}
                          </button>
                        </li>
                      )
                    })}</ul>
                    : <p className="student-course-learning__empty-module">{contentSearch ? 'No matching content in this module.' : 'No content in this module.'}</p>)}
                </section>
              )
            })}
            {filteredCourseLevelItems.length > 0 && (
              <section className="student-course-learning__module student-course-learning__course-items">
                <strong>Course activities</strong>
                <ul>{filteredCourseLevelItems.map((item) => (
                  <li key={item._learningKey}>
                    <button
                      className={item._learningKey === activeContentItemId ? 'is-selected' : ''}
                      type="button"
                      aria-current={item._learningKey === activeContentItemId ? 'true' : undefined}
                      onClick={() => selectContentItem(item)}
                    >
                      <span>{item.title}</span>
                      <small>{getStudentContentLabel(item.type)}</small>
                    </button>
                  </li>
                ))}</ul>
              </section>
            )}
            <section className="student-course-learning__sidebar-links" aria-label="Course materials">
              <button
                className={detailsTab === 'notes' ? 'is-selected' : ''}
                type="button"
                aria-pressed={detailsTab === 'notes'}
                onClick={() => {
                  videoPlayerRef.current?.pause()
                  setActiveContentItemId(COURSE_NOTES_KEY)
                  setDetailsTab('notes')
                }}
              >
                <span className="student-course-learning__item-icon"><Icon name="pen" size={15} /></span>
                <strong>Notes</strong>
              </button>
              <button
                className={detailsTab === 'resources' ? 'is-selected' : ''}
                type="button"
                aria-pressed={detailsTab === 'resources'}
                onClick={() => {
                  videoPlayerRef.current?.pause()
                  setActiveContentItemId(COURSE_RESOURCES_KEY)
                  setDetailsTab('resources')
                }}
              >
                <span className="student-course-learning__item-icon"><Icon name="link" size={15} /></span>
                <strong>Resources</strong>
              </button>
            </section>
            {contentSearch && !filteredModuleItems.some(({ items }) => items.length) && !filteredCourseLevelItems.length && (
              <p className="student-course-learning__empty-module">No course content matches “{contentSearch}”.</p>
            )}
          </aside>
          <div className={`student-course-learning__main${showVideoPlayer ? ' student-course-learning__main--video' : ' student-course-learning__main--activity'}`}>
            {showVideoPlayer && (
              <div className="student-course-learning__active-heading">
                <div>
                  <h2>{activeEntry?.lesson.title || 'Select course content'}</h2>
                  <span className="student-course-learning__type student-course-learning__type--video-lesson">
                    <Icon name="book" size={14} />
                    {getStudentContentLabel('video-lesson')}
                  </span>
                </div>
              </div>
            )}
            {showVideoPlayer && (
              <div className="student-course-learning__player">
                {activeEntry?.lesson.videoUrl
                  ? <video ref={videoPlayerRef} key={activeEntry.lesson.videoUrl} controls playsInline preload="metadata" src={activeEntry.lesson.videoUrl} onEnded={() => {
                    if (!completedLessonIds.has(String(activeEntry.lesson._id))) setLessonCompleted(activeEntry, true)
                  }}>
                    Your browser does not support video playback.
                  </video>
                  : <div className="student-course-learning__no-video">No video has been uploaded for this lesson.</div>}
              </div>
            )}
            {showVideoPlayer && (
              <div className="student-course-learning__video-nav">
                <button type="button" disabled={activeContentIndex <= 0} onClick={() => moveContent(-1)}>← Previous</button>
                <button type="button" disabled={activeContentIndex < 0 || activeContentIndex >= allContentItems.length - 1} onClick={() => moveContent(1)}>Next →</button>
              </div>
            )}
            <section className="student-course-learning__details">
              {!showVideoPlayer && <div className="student-course-learning__active-heading">
                <div>
                  <h2>{activeContentItem?.title || (detailsTab === 'notes' ? 'Notes' : detailsTab === 'resources' ? 'Resources' : activeEntry?.lesson.title) || 'Select course content'}</h2>
                  <span className={`student-course-learning__type student-course-learning__type--${activeContentItem?.type || 'video-lesson'}`}>
                    <Icon name={activeContentItem?.type === 'assignment' ? 'clipboardCheck' : activeContentItem?.type === 'note' || detailsTab === 'notes' ? 'folderOpen' : activeContentItem?.type === 'quiz' ? 'check' : detailsTab === 'resources' ? 'link' : 'book'} size={14} />
                    {detailsTab === 'resources'
                      ? 'Resources'
                      : getStudentContentLabel(activeContentItem?.type || (detailsTab === 'notes' ? 'note' : 'video-lesson'))}
                  </span>
                </div>
                {!showVideoPlayer && <div className="student-course-learning__detail-nav">
                  <button type="button" disabled={activeContentIndex <= 0} onClick={() => moveContent(-1)}>← Previous</button>
                  <button type="button" disabled={activeContentIndex < 0 || activeContentIndex >= allContentItems.length - 1} onClick={() => moveContent(1)}>Next →</button>
                </div>}
              </div>}
              {detailsTab === 'overview' && (activeContentItem?.description || (!activeContentItem && activeEntry?.lesson.content)) && (
                <p className="student-course-learning__active-description">
                  {activeContentItem?.description || activeEntry?.lesson.content}
                </p>
              )}
              <div className="student-course-learning__tabs" role="tablist" aria-label="Course information">
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailsTab === 'overview'}
                  className={detailsTab === 'overview' ? 'is-active' : ''}
                  onClick={() => {
                    setActiveContentItemId('')
                    setDetailsTab('overview')
                  }}
                >
                  <Icon name="book" size={15} />
                  Overview
                </button>
              </div>
              {detailsTab === 'notes' ? (
                <div className="student-course-learning__tab-content">
                  {courseNotes.length ? courseNotes.map((note) => (
                    <article className="student-course-learning__note-card" key={note._learningKey}>
                      <h3>{note.title}</h3>
                      {note.content && <p>{note.content}</p>}
                      {note.resources?.length > 0 && (
                        <ul className="student-course-note__resources">
                          {note.resources.map((resource, index) => (
                            <li key={resource._id || `${resource.url}-${index}`}>
                              <a href={resource.url} target="_blank" rel="noreferrer" download={resource.resourceType === 'raw' || resource.format === 'pdf' ? resource.title : undefined}>
                                {resource.title || `Resource ${index + 1}`}
                              </a>
                              {resource.format && <small>{resource.format.toUpperCase()}</small>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </article>
                  )) : <p className="student-course-learning__tab-empty">No notes have been added to this course.</p>}
                </div>
              ) : detailsTab === 'resources' ? (
                <div className="student-course-learning__tab-content">
                  {courseResources.length ? (
                    <ul className="student-course-note__resources">
                      {courseResources.map((resource, index) => (
                        <li key={resource._id || `${resource.url}-${index}`}>
                          <a href={resource.url} target="_blank" rel="noreferrer" download={resource.resourceType === 'raw' || resource.format === 'pdf' ? resource.title : undefined}>
                            {resource.title || `Resource ${index + 1}`}
                          </a>
                          {resource.format && <small>{resource.format.toUpperCase()}</small>}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="student-course-learning__tab-empty">No resources have been added to this course.</p>}
                </div>
              ) : (
                <div className="student-course-learning__tab-content">
                  {activeContentItem?.type === 'quiz' ? (
                    activeContentItem.quiz?.questions?.length ? (
                      <StudentQuizExperience
                        key={activeContentItem._learningKey}
                        courseId={course._id}
                        enrollmentId={enrollment._id}
                        quiz={activeContentItem.quiz}
                        attempts={quizAttempts}
                        onAttemptAdded={addQuizAttempt}
                        onLearningDataChanged={onLearningDataChanged}
                        onLogout={onLogout}
                        showHeader={false}
                      />
                    ) : <EmptyState icon="check" title="Quiz is not available" description="This quiz does not contain any questions." />
                  ) : activeContentItem?.type === 'assignment' ? (
                    <StudentAssignmentPanel
                      key={activeContentItem._learningKey}
                      courseId={course._id}
                      enrollmentId={enrollment._id}
                      assignment={activeContentItem}
                      submissions={assignmentSubmissions}
                      onSubmitted={addAssignmentSubmission}
                      onLearningDataChanged={onLearningDataChanged}
                      onLogout={onLogout}
                      showHeader={false}
                    />
                  ) : activeContentItem?.type === 'note' ? (
                    <StudentNotePanel item={activeContentItem} />
                  ) : activeEntry ? (
                    <section className="student-course-learning__lesson">
                      <span className="student-eyebrow">{activeEntry.module.title}</span>
                      <button
                        className={`student-button${completedLessonIds.has(String(activeEntry.lesson._id)) ? ' student-button--quiet' : ''}`}
                        type="button"
                        disabled={savingLessonId === String(activeEntry.lesson._id) || !activeEntry.lesson._id}
                        onClick={() => setLessonCompleted(activeEntry, !completedLessonIds.has(String(activeEntry.lesson._id)))}
                      >
                        {savingLessonId === String(activeEntry.lesson._id)
                          ? 'Saving…'
                          : completedLessonIds.has(String(activeEntry.lesson._id)) ? 'Mark incomplete' : 'Mark as complete'}
                      </button>
                    </section>
                  ) : <EmptyState icon="book" title="Select course content" description="Choose a video, quiz, assignment, or note from the course content list." />}
                </div>
              )}
            </section>
          </div>
        </div>
      ) : <EmptyState icon="book" title="Course content is not available yet" description="This enrolled course does not currently have any lessons or activities." />}
    </div>
  )
}

async function referralsRequest(path, { onLogout, method = 'GET', body, signal }) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (typeof auth?.token !== 'string') {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  })
  const result = await response.json()
  if (isInvalidSessionResponse(response, result)) {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  if (!response.ok) {
    const message = response.status === 404
      ? 'The referral service is unavailable right now. Please try again shortly.'
      : result.message || 'Referral information could not be loaded.'
    const error = new Error(message)
    error.statusCode = response.status
    throw error
  }
  return result
}

function formatReferralDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function StudentReferrals({ onLogout }) {
  const [referralData, setReferralData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [notice, setNotice] = useState('')
  const [copiedCode, setCopiedCode] = useState('')
  const pendingRequestId = useRef('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    referralsRequest('/referrals/me', { onLogout, signal: controller.signal })
      .then((result) => {
        if (!Array.isArray(result.codes) || !result.stats) {
          throw new Error('The server returned invalid referral information.')
        }
        setReferralData(result)
      })
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Referral information could not be loaded.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [onLogout, loadAttempt])

  async function generateReferralCode() {
    setGenerating(true)
    setError('')
    setNotice('')
    try {
      if (!pendingRequestId.current) {
        if (typeof window.crypto?.randomUUID !== 'function') {
          throw new Error('Your browser cannot securely start a referral request. Please update your browser.')
        }
        pendingRequestId.current = window.crypto.randomUUID()
      }
      await referralsRequest('/referrals/generate', {
        onLogout,
        method: 'POST',
        body: { requestId: pendingRequestId.current },
      })
      pendingRequestId.current = ''
      setNotice('Your referral code has been generated.')
      const result = await referralsRequest('/referrals/me', { onLogout })
      setReferralData(result)
    } catch (generateError) {
      if (generateError?.statusCode === 429) {
        setReferralData((current) => current && ({
          ...current,
          stats: { ...current.stats, generatedToday: current.stats.dailyLimit },
        }))
      }
      setError(generateError instanceof Error ? generateError.message : 'A referral code could not be generated.')
    } finally {
      setGenerating(false)
    }
  }

  async function copyReferralCode(code) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      setNotice('Referral code copied.')
      setError('')
    } catch {
      setError('The referral code could not be copied. Please copy it manually.')
    }
  }

  const stats = referralData?.stats || {
    totalGenerated: 0,
    generatedToday: 0,
    dailyLimit: 5,
    successfullyUsed: 0,
    active: 0,
    expired: 0,
  }
  const summary = [
    { label: 'Total referral codes', value: stats.totalGenerated, tone: 'gold' },
    { label: 'Generated today', value: `${stats.generatedToday}/${stats.dailyLimit}`, tone: 'blue' },
    { label: 'Successfully used', value: stats.successfullyUsed, tone: 'mint' },
    { label: 'Active codes', value: stats.active, tone: 'peach' },
    { label: 'Expired codes', value: stats.expired, tone: 'lavender' },
  ]

  return (
    <div className="student-referrals">
      <section className="student-panel student-referrals__intro">
        <div>
          <span className="student-eyebrow">SHARE YOUR LEARNING JOURNEY</span>
          <h1>My Referrals</h1>
          <p>Invite a friend to join Morrow Learning with a one-time referral code.</p>
        </div>
        <button
          className="student-button"
          type="button"
          onClick={generateReferralCode}
          disabled={loading || !referralData || generating || stats.generatedToday >= stats.dailyLimit}
        >
          {generating ? 'Generating…' : 'Generate Referral Code'}
        </button>
        {stats.generatedToday >= stats.dailyLimit && (
          <p className="student-referrals__limit" role="status">
            You’ve reached today’s limit of 5 codes. The limit resets at 00:00 UTC.
          </p>
        )}
      </section>

      {error && (
        <p className="student-courses__message is-error" role="alert">
          {error}
          {!referralData && !loading && (
            <button
              className="student-button student-button--quiet"
              type="button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              Try again
            </button>
          )}
        </p>
      )}
      {notice && <p className="student-courses__message" role="status">{notice}</p>}

      <section className="student-referrals__summary" aria-label="Referral summary">
        {summary.map((item) => (
          <article className="student-stat" key={item.label}>
            <span className={`student-stat__icon is-${item.tone}`}><Icon name="users" size={18} /></span>
            <span className="student-stat__label">{item.label}</span>
            <strong className="student-stat__value">{referralData ? item.value : '—'}</strong>
          </article>
        ))}
      </section>

      <section className="student-panel student-referrals__history" aria-labelledby="student-referral-history-title">
        <div className="student-section-heading">
          <div>
            <span className="student-eyebrow">YOUR CODE ACTIVITY</span>
            <h2 id="student-referral-history-title">Referral history</h2>
          </div>
          <span className="student-data-note">Codes expire 15 days after they’re generated.</span>
        </div>
        {loading ? (
          <p role="status">Loading your referral history…</p>
        ) : referralData?.codes.length ? (
          <div className="student-referrals__list">
            {referralData.codes.map((code) => (
              <article className="student-referral-card" key={code.code}>
                <div className="student-referral-card__top">
                  <strong className="student-referral-card__code">{code.code}</strong>
                  <span className={`student-referral-card__status is-${code.status}`}>{code.status}</span>
                  {code.status === 'active' && (
                    <button className="student-button student-button--quiet" type="button" onClick={() => copyReferralCode(code.code)}>
                      {copiedCode === code.code ? 'Copied' : 'Copy'}
                    </button>
                  )}
                </div>
                <dl>
                  <div><dt>Generated</dt><dd>{formatReferralDate(code.createdAt)}</dd></div>
                  <div><dt>Expires</dt><dd>{formatReferralDate(code.expiresAt)}</dd></div>
                  <div><dt>Friend registered</dt><dd>{code.friendRegistered ? 'Yes' : 'No'}</dd></div>
                  {code.usedAt && <div><dt>Used</dt><dd>{formatReferralDate(code.usedAt)}</dd></div>}
                  {code.registrationStatus && (
                    <div><dt>Registration status</dt><dd>{code.registrationStatus.replaceAll('_', ' ')}</dd></div>
                  )}
                </dl>
              </article>
            ))}
          </div>
        ) : !error ? (
          <EmptyState
            icon="users"
            title="No referral codes yet"
            description="Generate a code to invite a friend. Your used and expired codes will stay in this history."
          />
        ) : null}
      </section>
    </div>
  )
}

function StudentCourseDetailsPage({ user, onLogout, onLearningDataChanged }) {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(false)
  const [error, setError] = useState('')
  const isCollegeStudent = user?.studentType === 'college' || Boolean(user?.collegeId)
  const courseLessons = course ? getCourseLessons(course) : []
  const courseCounts = course ? getCourseCounts(course) : { modules: 0, lessons: 0 }

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetchPublishedCourses(onLogout, controller.signal),
      fetchMyEnrollments(onLogout, controller.signal),
    ])
      .then(([publishedCourses, enrollments]) => {
        const enrolled = enrollments.find((entry) => String(entry.courseId?._id || entry.courseId) === courseId)
        if (enrolled) {
          navigate(`/student/course/${encodeURIComponent(courseId)}/learn`, { replace: true })
          return
        }
        const selectedCourse = publishedCourses.find((item) => String(item._id) === courseId)
        if (!selectedCourse) throw new Error('This course is not currently published or available.')
        setCourse(selectedCourse)
      })
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Course details could not be loaded.')
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [courseId, navigate, onLogout])

  async function enroll() {
    setEnrolling(true)
    setError('')
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
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok) throw new Error(result.message || 'You could not be enrolled in this course.')
      if (!result.enrollment?._id) throw new Error('The server did not confirm your enrollment.')
      onLearningDataChanged()
      navigate(`/student/course/${encodeURIComponent(courseId)}/learn`, { replace: true })
    } catch (enrollError) {
      setError(enrollError instanceof Error ? enrollError.message : 'You could not be enrolled in this course.')
    } finally {
      setEnrolling(false)
    }
  }

  return (
    <StudentRoutePage title={course?.title || 'Course details'}>
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading course details…</p> : course && (
        <div className="student-course-details">
          <Link className="student-section-link" to="/student/dashboard">← Back to dashboard</Link>
          <section className="student-course-details__intro">
            <header className="student-course-details__header">
              <div className="student-course-details__identity">
                <p className="student-course-details__category">
                  {course.category || 'Other'} <span>·</span> {course.difficulty?.replaceAll('-', ' ') || 'Beginner'}
                </p>
                <h1>{course.title}</h1>
                <span className="student-course-details__published">Published</span>
              </div>
              <div className="student-course-details__enroll">
                {isCollegeStudent
                  ? <p>Enrollment for this course is managed by your college administrator.</p>
                  : <button type="button" className="student-enrolled-course__continue" disabled={enrolling} onClick={enroll}>
                    {enrolling ? 'Enrolling…' : 'Enroll for free'}
                  </button>}
              </div>
            </header>
            <p className="student-course-details__description">{course.description || course.detailedDescription || 'No course description added yet.'}</p>
          </section>
          <section className="student-course-details__facts" aria-label="Course overview">
            <div><span>Course duration</span><strong>{formatCourseDuration(course.estimatedDurationMinutes)}</strong></div>
            <div><span>Modules</span><strong>{courseCounts.modules}</strong></div>
            <div><span>Lessons</span><strong>{courseCounts.lessons}</strong></div>
          </section>
          {(course.learningObjectives?.length > 0 || course.prerequisites?.length > 0) && (
            <div className="student-course-details__information">
              {course.learningObjectives?.length > 0 && (
                <section className="student-course-details__section">
                  <h2>What you’ll learn</h2>
                  <ul>{course.learningObjectives.map((objective, index) => <li key={`${objective}-${index}`}>{objective}</li>)}</ul>
                </section>
              )}
              {course.prerequisites?.length > 0 && (
                <section className="student-course-details__section">
                  <h2>Prerequisites</h2>
                  <ul>{course.prerequisites.map((prerequisite, index) => <li key={`${prerequisite}-${index}`}>{prerequisite}</li>)}</ul>
                </section>
              )}
            </div>
          )}
          <section className="student-course-details__section">
            <h2>Course modules</h2>
            {course.modules?.length ? course.modules.map((module, moduleIndex) => {
              const moduleKey = String(module._id || `${module.title}-${moduleIndex}`)
              const moduleLessons = courseLessons.filter((entry) => entry.moduleKey === moduleKey)
              return (
                <article className="student-course-details__module" key={moduleKey}>
                  <h3>{module.title}</h3>
                  {module.description && <p>{module.description}</p>}
                  {moduleLessons.length
                    ? <ul>{moduleLessons.map(({ lesson, lessonKey }) => (
                      <li key={lessonKey}>
                        <strong>{lesson.title}</strong>
                        {lesson.content && <p>{lesson.content}</p>}
                      </li>
                    ))}</ul>
                    : <p>No lessons have been added to this module.</p>}
                </article>
              )
            }) : <EmptyState icon="book" title="Course content is not available yet" description="This course does not currently have any modules or lessons." />}
          </section>
        </div>
      )}
    </StudentRoutePage>
  )
}

function StudentCourseLearningPage({
  onLogout,
  onLearningDataChanged,
  onCourseTitleChange,
  contentSearch,
}) {
  const { courseId } = useParams()
  const [enrollment, setEnrollment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const location = useLocation()
  const requestedLessonId = new URLSearchParams(location.search).get('lesson')

  useEffect(() => {
    onCourseTitleChange(enrollment?.courseId?.title || '')
  }, [enrollment?.courseId?.title, onCourseTitleChange])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetchStudentCourseContent(courseId, onLogout, controller.signal)
      .then(({ enrollment: courseEnrollment, assignmentSubmissions, quizAttempts }) => {
        setEnrollment({
          ...courseEnrollment,
          assignmentSubmissions,
          quizAttempts,
        })
      })
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Your course could not be loaded.')
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [courseId, onLogout])

  return (
    <StudentRoutePage title={enrollment?.courseId?.title || 'Course learning'} className="student-course-learning-page">
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading your course…</p> : enrollment && (
        <StudentCourseLearning
          enrollment={enrollment}
          onEnrollmentUpdated={(updates) => setEnrollment((current) => current ? {
            ...current,
            ...updates,
            courseId: current.courseId,
          } : current)}
          onLearningDataChanged={onLearningDataChanged}
          onLogout={onLogout}
          requestedLessonId={requestedLessonId}
          contentSearch={contentSearch}
        />
      )}
    </StudentRoutePage>
  )
}

function StudentCourses({ user, onLogout }) {
  const [enrollments, setEnrollments] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const location = useLocation()
  const requestedFilter = new URLSearchParams(location.search).get('filter')
  const enrollmentFilter = ['enrolled', 'completed', 'active'].includes(requestedFilter) ? requestedFilter : ''

  useEffect(() => {
    const controller = new AbortController()
    fetchMyEnrollments(onLogout, controller.signal)
      .then(setEnrollments)
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load your enrolled courses.')
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [onLogout, user?.id])

  const filteredEnrollments = enrollmentFilter
    ? enrollments.filter((entry) => enrollmentFilter === 'enrolled'
      ? ['active', 'completed'].includes(entry.status)
      : entry.status === enrollmentFilter)
    : enrollments
  const pageTitle = enrollmentFilter === 'completed'
    ? 'Completed Courses'
    : enrollmentFilter === 'active'
      ? 'Courses In Progress'
      : 'My Courses'

  return (
    <StudentRoutePage title={pageTitle} showHeading>
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading your courses…</p> : !error && (
        <EnrollmentCourseCards
          enrollments={filteredEnrollments}
          emptyTitle={enrollmentFilter === 'completed'
            ? 'No completed courses yet'
            : enrollmentFilter === 'active'
              ? 'No courses in progress'
              : 'No enrolled courses yet'}
          emptyDescription="Your courses and progress will appear here when an enrollment is available."
        />
      )}
    </StudentRoutePage>
  )
}

function StudentAchievements({ onLogout }) {
  const [enrollments, setEnrollments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchMyEnrollments(onLogout, controller.signal)
      .then(setEnrollments)
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError instanceof Error ? loadError.message : 'Achievements could not be loaded.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [onLogout])

  const completed = enrollments.filter((entry) => entry.status === 'completed')

  return (
    <StudentRoutePage eyebrow="YOUR ACHIEVEMENTS" title="My Achievements">
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading your achievements…</p> : !error && (
        completed.length
          ? <div className="student-achievements-list">{completed.map((entry) => (
            <article className="student-achievement-item" key={entry._id}>
              <span className="student-stat__icon is-mint"><Icon name="award" size={19} /></span>
              <div><strong>{entry.courseId?.title || 'Completed course'}</strong><small>Course completion milestone</small></div>
              <span>{entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : 'Date unavailable'}</span>
            </article>
          ))}</div>
          : <EmptyState icon="award" title="No achievements yet" description="Completed-course milestones will appear here when recorded in your enrollment history. Certificates and badges are not yet tracked by the platform." />
      )}
    </StudentRoutePage>
  )
}

function StudentLearningActivity({ onLogout }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasEnrollments, setHasEnrollments] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchMyEnrollments(onLogout, controller.signal)
      .then((enrollments) => setHasEnrollments(enrollments.length > 0))
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError instanceof Error ? loadError.message : 'Learning activity could not be loaded.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [onLogout])

  return (
    <StudentRoutePage eyebrow="YOUR LEARNING ACTIVITY" title="Learning Streak">
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      {loading ? <p role="status">Checking your learning activity…</p> : !error && (
        <EmptyState icon="spark" title={hasEnrollments ? 'Learning activity tracking is not available yet' : 'No learning activity recorded'} description={hasEnrollments ? 'Course enrollments are available, but lesson activity and daily streaks are not yet recorded by the platform.' : 'Your learning streak will begin when learning activity tracking is available and records your sessions.'} />
      )}
    </StudentRoutePage>
  )
}

function StudentSearch({ onLogout, navigateTo }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (normalizedQuery.length < 2) {
      setResults([])
      setError('')
      setStatus('idle')
      return undefined
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      setStatus('loading')
      setError('')
      try {
        const savedAuth = sessionStorage.getItem('lms.auth')
        const auth = savedAuth ? JSON.parse(savedAuth) : null
        if (typeof auth?.token !== 'string') {
          onLogout()
          throw new Error('Your session has ended. Please sign in again.')
        }
        const response = await fetch(`${API_BASE_URL}/enrollments/me`, {
          headers: { Authorization: `Bearer ${auth.token}` },
          signal: controller.signal,
        })
        const result = await response.json()
        if (isInvalidSessionResponse(response, result)) {
          onLogout()
          throw new Error('Your session has ended. Please sign in again.')
        }
        if (!response.ok) throw new Error(result.message || 'Search is temporarily unavailable.')
        if (!Array.isArray(result.enrollments)) throw new Error('The server returned invalid course search data.')

        const matches = []
        for (const enrollment of result.enrollments) {
          const course = enrollment.courseId
          if (!course || typeof course !== 'object') continue
          const courseText = `${course.title || ''} ${course.description || ''}`.toLowerCase()
          if (courseText.includes(normalizedQuery)) {
            matches.push({
              id: `course-${course._id}`,
              title: course.title,
              detail: 'Course',
              courseId: course._id,
            })
          }
          for (const { module, lesson, lessonKey } of getCourseLessons(course)) {
            const lessonText = `${lesson.title || ''} ${lesson.content || ''} ${module.title || ''}`.toLowerCase()
            if (lessonText.includes(normalizedQuery)) {
              matches.push({
                id: `lesson-${course._id}-${lessonKey}`,
                title: lesson.title,
                detail: `${course.title} · ${module.title}`,
                courseId: course._id,
                lessonId: lesson._id,
              })
            }
          }
        }
        if (!controller.signal.aborted) {
          setResults(matches.slice(0, 8))
          setStatus('ready')
        }
      } catch (searchError) {
        if (!controller.signal.aborted) {
          setError(searchError instanceof Error ? searchError.message : 'Search is temporarily unavailable.')
          setResults([])
          setStatus('error')
        }
      }
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [query, onLogout])

  function selectResult(result) {
    setQuery('')
    setIsOpen(false)
    const path = `/student/course/${encodeURIComponent(result.courseId)}/learn`
    const params = new URLSearchParams()
    if (result.lessonId) params.set('lesson', result.lessonId)
    navigateTo(params.size ? `${path}?${params.toString()}` : path)
  }

  return (
    <div
      className="student-search-wrap"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false)
      }}
    >
      <label className="student-search">
        <Icon name="search" size={18} />
        <input
          type="search"
          placeholder="Search courses and lessons..."
          aria-label="Search courses and lessons"
          aria-expanded={isOpen && query.trim().length >= 2}
          aria-controls="student-search-results"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            setIsOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setIsOpen(false)
            if (event.key === 'Enter' && results.length) {
              event.preventDefault()
              selectResult(results[0])
            }
          }}
        />
        <kbd>⌘ K</kbd>
      </label>
      {isOpen && query.trim().length >= 2 && (
        <div className="student-search-results" id="student-search-results" role="listbox" aria-label="Search results">
          {status === 'loading' && <p role="status">Searching your courses…</p>}
          {status === 'error' && <p className="is-error" role="alert">{error}</p>}
          {status === 'ready' && results.length === 0 && (
            <p>No matching enrolled courses or lessons were found.</p>
          )}
          {status === 'ready' && results.map((result) => (
            <button
              className="student-search-result"
              type="button"
              role="option"
              aria-selected="false"
              key={result.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectResult(result)}
            >
              <span><strong>{result.title}</strong><small>{result.detail}</small></span>
              <Icon name="arrow" size={16} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StudentPurchases() {
  return (
    <StudentRoutePage eyebrow="YOUR ACCOUNT ACTIVITY" title="My Purchases">
      <EmptyState icon="book" title="No purchases yet" description="Purchase history, payment status, transaction details, and invoices are not currently available from the LMS." />
    </StudentRoutePage>
  )
}

function StudentUpdates() {
  return (
    <StudentRoutePage eyebrow="FROM YOUR LEARNING COMMUNITY" title="Updates">
      <EmptyState icon="bell" title="Updates aren’t available yet" description="The LMS does not currently provide an announcements or platform-updates feed for this account." />
    </StudentRoutePage>
  )
}

function StudentProfile({ user, onLogout }) {
  const [enrollments, setEnrollments] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadEnrollments() {
      try {
        const savedAuth = sessionStorage.getItem('lms.auth')
        const auth = savedAuth ? JSON.parse(savedAuth) : null
        if (typeof auth?.token !== 'string') {
          onLogout()
          return
        }
        const response = await fetch(`${API_BASE_URL}/enrollments/me`, {
          headers: { Authorization: `Bearer ${auth.token}` },
          signal: controller.signal,
        })
        const result = await response.json()
        if (isInvalidSessionResponse(response, result)) {
          onLogout()
          return
        }
        if (!response.ok) throw new Error(result.message || 'Learning overview could not be loaded.')
        if (!Array.isArray(result.enrollments)) {
          throw new Error('The server returned invalid enrollment data.')
        }
        setEnrollments(result.enrollments)
      } catch (loadError) {
        if (loadError.name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Learning overview could not be loaded.')
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    loadEnrollments()
    return () => controller.abort()
  }, [onLogout])

  const accountType = user?.studentType === 'college'
    ? 'College Student'
    : user?.studentType === 'independent'
      ? 'Independent Student'
      : 'Not available'
  const completedCount = enrollments.filter((entry) => entry.status === 'completed').length
  const inProgressCount = enrollments.filter((entry) => entry.status === 'active').length
  const emailVerification = typeof user?.emailVerified === 'boolean'
    ? user.emailVerified ? 'Verified' : 'Not verified'
    : 'Not recorded by the platform'

  return (
    <div className="student-profile-layout">
      <div className="student-profile-overview">
      <StudentRoutePage title="Account Information" showHeading>
        <div className="student-profile-actions">
          <Link className="student-profile-settings-link" to="/student/settings">Manage account settings <Icon name="arrow" size={15} /></Link>
          <Link className="student-profile-settings-link" to="/student/help">Help Center <Icon name="arrow" size={15} /></Link>
        </div>
        <dl className="student-profile-details">
          <div><dt>Full name</dt><dd>{user?.fullName || 'Not available'}</dd></div>
          <div><dt>Username</dt><dd>{user?.username || 'Not available'}</dd></div>
          <div><dt>Email</dt><dd>{user?.email || 'Not available'}</dd></div>
          <div><dt>Email verification</dt><dd>{emailVerification}</dd></div>
          <div><dt>Account type</dt><dd>{accountType}</dd></div>
        </dl>
      </StudentRoutePage>

      <StudentRoutePage title="Learning Overview" showHeading>
        {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
        {isLoading ? (
          <p role="status">Loading your learning overview…</p>
        ) : !error ? (
          <>
            <section className="student-stats" aria-label="Learning overview statistics">
              {[
                ['Enrolled Courses', enrollments.length, 'book', 'peach', 'Open your enrolled courses', '/student/courses?filter=enrolled'],
                ['Completed Courses', completedCount, 'award', 'mint', 'View completed courses', '/student/courses?filter=completed'],
                ['In Progress', inProgressCount, 'chart', 'gold', 'View courses in progress', '/student/courses?filter=active'],
                ['Learning Streak', 0, 'spark', 'blue', 'View learning activity details', '/student/learning-activity'],
              ].map(([label, count, icon, tone, note, to]) => (
                <Link className={`student-stat is-${tone} student-profile-stat-link`} key={label} to={to}>
                  <span className={`student-stat__icon is-${tone}`}><Icon name={icon} size={19} /></span>
                  <span className="student-stat__label">{label}</span>
                  <strong className="student-stat__value">{count}{label === 'Learning Streak' ? ' days' : ''}</strong>
                  <small>{note}</small>
                </Link>
              ))}
            </section>
          </>
        ) : null}
      </StudentRoutePage>
      </div>

      <div className="student-profile-sections">
        <StudentRoutePage title="My Purchases" to="/student/purchases" showHeading>
          <EmptyState icon="book" title="Purchase history unavailable" description="The LMS does not currently provide purchase records, payment status, or invoices." />
        </StudentRoutePage>
        <StudentRoutePage title="Updates" to="/student/updates" showHeading>
          <EmptyState icon="bell" title="Open your updates" description="View platform announcements and course updates when they are available." />
        </StudentRoutePage>
        <StudentRoutePage title="My Achievements" to="/student/achievements" showHeading>
          <EmptyState icon="award" title="View your achievements" description="Completed-course milestones and earned achievements appear here." />
        </StudentRoutePage>
      </div>
    </div>
  )
}

function StudentDashboard({
  user,
  loading,
  error,
  onRetry,
  onLogout,
  isDark,
  onToggleTheme,
  themePreference,
  onSetTheme,
  onAccountUpdated,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedCourseCategory, setSelectedCourseCategory] = useState('')
  const [courseLearningTitle, setCourseLearningTitle] = useState('')
  const [courseContentSearch, setCourseContentSearch] = useState('')
  const [courseBookmarked, setCourseBookmarked] = useState(false)
  const [learningSummary, setLearningSummary] = useState(emptyLearningSummary)
  const [learningSummaryLoading, setLearningSummaryLoading] = useState(true)
  const [learningSummaryError, setLearningSummaryError] = useState('')
  const [learningSummaryRefresh, setLearningSummaryRefresh] = useState(0)
  const location = useLocation()
  const navigate = useNavigate()
  const visibleNavigation = user?.studentType === 'independent'
    ? navigation
    : navigation.filter((item) => item.path !== '/student/referrals')
  const currentPage = visibleNavigation.find((item) => item.path === location.pathname)
  const isCourseLearningPage = /^\/student\/course\/[^/]+\/learn$/.test(location.pathname)
  const isHelpPage = location.pathname.startsWith('/student/help')
  const secondaryPage = secondaryPages[location.pathname]
  const pageTitle = currentPage?.label || (isHelpPage ? 'Help Center' : secondaryPage?.label || 'Dashboard')
  const pageIcon = currentPage
    ? {
      Dashboard: 'layoutDashboard',
      'My Courses': 'bookOpen',
      Assignments: 'clipboardCheck',
      'Grades & Results': 'chartNoAxesCombined',
      'Learning Resources': 'folderOpen',
      Messages: 'messageCircle',
      Certificates: 'award',
      'My Referrals': 'users',
      'My Profile': 'userRound',
      Settings: 'settings',
      'Help Center': 'circleHelp',
    }[currentPage.label]
    : isHelpPage ? 'circleHelp' : secondaryPage?.icon || 'layoutDashboard'
  const firstName = user?.fullName?.trim().split(/\s+/)[0] || 'Student'
  const initials = user?.fullName
    ? user.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    : 'S'
  const completionPercentage = learningSummary.completionPercentage

  useEffect(() => {
    if (loading) return undefined
    const controller = new AbortController()
    setLearningSummaryLoading(true)
    fetchStudentLearningSummary(onLogout, controller.signal)
      .then((summary) => {
        if (!controller.signal.aborted) {
          setLearningSummary(summary)
          setLearningSummaryError('')
        }
      })
      .catch((summaryError) => {
        if (!controller.signal.aborted) {
          setLearningSummary(emptyLearningSummary)
          setLearningSummaryError(summaryError instanceof Error
            ? summaryError.message
            : 'Learning statistics could not be loaded.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLearningSummaryLoading(false)
      })
    return () => controller.abort()
  }, [loading, user?.id, onLogout, learningSummaryRefresh])

  useEffect(() => {
    setSidebarOpen(false)
    window.scrollTo(0, 0)
    document.querySelector('.student-main')?.scrollTo(0, 0)
  }, [location.pathname])

  useEffect(() => {
    if (!isCourseLearningPage) {
      setCourseLearningTitle('')
      setCourseContentSearch('')
      setCourseBookmarked(false)
    }
  }, [isCourseLearningPage])

  useEffect(() => {
    if (!sidebarOpen) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [sidebarOpen])

  function navigateTo(path) {
    setSidebarOpen(false)
    navigate(path)
  }

  function refreshLearningSummary() {
    setLearningSummaryRefresh((refresh) => refresh + 1)
  }

  return (
    <div className={`student-dashboard${sidebarOpen ? ' is-sidebar-open' : ''}${isCourseLearningPage ? ' is-course-learning' : ''}`}>
      <aside
        id="student-navigation"
        className={`student-sidebar${sidebarOpen ? ' is-open' : ''}`}
        aria-label="Student navigation"
        aria-hidden={!sidebarOpen}
        inert={!sidebarOpen}
      >
        <a className="student-sidebar__brand" href="/" aria-label="Morrow Learning home">
          <img src="/logo.png" alt="Morrow Learning" />
          <span>LEARN. GROW. BECOME.</span>
        </a>
        <p className="student-sidebar__label">LEARNING SPACE</p>
        <nav className="student-sidebar__nav">
          {visibleNavigation.map((item) => (
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
          <button className="student-sidebar__logout" type="button" onClick={onLogout}>
            <Icon name="logout" size={17} /> Logout
          </button>
        </div>
      </aside>

      <main className="student-main" id="student-overview">
        <header className="student-topbar">
          {!isCourseLearningPage && <button
            className="student-icon-button student-menu-toggle"
            type="button"
            aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={sidebarOpen}
            aria-controls="student-navigation"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <Icon name="menu" />
          </button>}
          <div className={`student-breadcrumb student-page-heading${isCourseLearningPage ? ' student-course-learning-topbar__identity' : ''}`}>
            {isCourseLearningPage ? (
              <>
                <Link to="/student/courses">← Back to My Courses</Link>
                <span aria-hidden="true" />
                <strong>{courseLearningTitle || 'Course learning'}</strong>
              </>
            ) : (
              <>
                <Icon name={pageIcon} size={19} />
                <strong>{pageTitle}</strong>
              </>
            )}
          </div>
          {isCourseLearningPage ? (
            <label className="student-search student-course-learning-topbar__search">
              <Icon name="search" size={17} />
              <input
                type="search"
                value={courseContentSearch}
                onChange={(event) => setCourseContentSearch(event.target.value)}
                placeholder="Search here..."
                aria-label="Search course content"
              />
            </label>
          ) : <StudentSearch onLogout={onLogout} navigateTo={navigateTo} />}
          {isCourseLearningPage && (
            <button
              className={`student-course-learning__bookmark student-course-learning-topbar__bookmark${courseBookmarked ? ' is-active' : ''}`}
              type="button"
              aria-label={courseBookmarked ? 'Remove course bookmark' : 'Bookmark course'}
              aria-pressed={courseBookmarked}
              onClick={() => setCourseBookmarked((saved) => !saved)}
            >
              <Icon name="book" size={17} />
            </button>
          )}
          <div className="student-topbar__actions">
            <ThemeToggle isDark={isDark} onToggle={onToggleTheme} className="student-theme-toggle" />
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
              <div className="student-profile-trigger">
                <span className="student-avatar">{initials}</span>
                <span className="student-profile-trigger__copy">
                  <strong>{user?.fullName || 'Student'}</strong><small>Student</small>
                </span>
              </div>
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

              {learningSummaryError && (
                <p className="student-courses__message is-error" role="alert">{learningSummaryError}</p>
              )}
              <section className="student-stats" aria-label="Student statistics">
                {stats.map((stat) => (
                  <article className="student-stat" key={stat.label}>
                    <span className={`student-stat__icon is-${stat.tone}`}><Icon name={stat.icon} size={19} /></span>
                    <span className="student-stat__label">{stat.label}</span>
                    <strong className="student-stat__value" aria-label={`${learningSummary[stat.value]} ${stat.label.toLowerCase()}`}>
                      {learningSummary[stat.value]}
                    </strong>
                    <small>{learningSummaryLoading ? 'Updating your learning data…' : stat.caption}</small>
                  </article>
                ))}
              </section>

              <section className="student-panel student-progress-panel" aria-labelledby="student-progress-title">
                <div className="student-section-heading">
                  <div><span className="student-eyebrow">YOUR JOURNEY</span><h2 id="student-progress-title">My learning progress</h2></div>
                  <span className="student-data-note">
                    {learningSummaryLoading ? 'Updating progress…' : `${learningSummary.totalLessons} lessons across enrolled courses`}
                  </span>
                </div>
                <div className="student-progress-layout">
                  <div
                    className="student-donut"
                    role="img"
                    aria-label={`Overall learning completion ${completionPercentage}%`}
                    style={{ background: `conic-gradient(#5d9a83 ${completionPercentage}%, #dedfd5 ${completionPercentage}% 100%)` }}
                  >
                    <div><strong>{completionPercentage}%</strong><span>OVERALL</span></div>
                  </div>
                  <div className="student-lesson-counts">
                    {[
                      ['Completed lessons', 'completedLessons', 'mint'],
                      ['Lessons in progress', 'inProgressLessons', 'gold'],
                      ['Lessons not started', 'notStartedLessons', 'gray'],
                    ].map(([label, value, tone]) => (
                      <div className="student-lesson-count" key={label}>
                        <span className={`student-lesson-count__dot is-${tone}`} />
                        <span>{label}</span>
                        <strong>{learningSummary[value]}</strong>
                      </div>
                    ))}
                    <p>Counts update as you start and complete lessons.</p>
                  </div>
                </div>
              </section>

              <section className="student-categories" aria-labelledby="student-categories-title">
                <h2 id="student-categories-title">Explore categories</h2>
                <div className="student-categories__list">
                  {categories.map((category) => (
                    <button
                      className={`student-category student-category-link${selectedCourseCategory === category.label ? ' is-selected' : ''}`}
                      key={category.label}
                      type="button"
                      aria-pressed={selectedCourseCategory === category.label}
                      onClick={() => setSelectedCourseCategory((current) => (
                        current === category.label ? '' : category.label
                      ))}
                    >
                      <Icon name={category.icon} size={19} />
                      {category.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="student-panel" aria-labelledby="student-courses-title">
                <div className="student-section-heading">
                  <div><span className="student-eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2 id="student-courses-title">My Courses</h2></div>
                  <div className="student-dashboard-courses__actions">
                    {selectedCourseCategory && (
                      <button
                        className="student-section-link"
                        type="button"
                        onClick={() => setSelectedCourseCategory('')}
                      >
                        Clear filter
                      </button>
                    )}
                    <Link className="student-section-link" to="/student/courses">View all</Link>
                  </div>
                </div>
                <StudentDashboardCourses
                  onLogout={onLogout}
                  selectedCategory={selectedCourseCategory}
                />
              </section>

              <StudentAvailableCourses
                user={user}
                onLogout={onLogout}
                onLearningDataChanged={refreshLearningSummary}
              />

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
                  <NotificationFeed role="student" onLogout={onLogout} />
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
              <Route path="/student/course/:courseId/learn" element={
                <StudentCourseLearningPage
                  onLogout={onLogout}
                  onLearningDataChanged={refreshLearningSummary}
                  onCourseTitleChange={setCourseLearningTitle}
                  contentSearch={courseContentSearch}
                />
              } />
              <Route path="/student/course/:courseId" element={
                <StudentCourseDetailsPage user={user} onLogout={onLogout} onLearningDataChanged={refreshLearningSummary} />
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
              <Route
                path="/student/referrals"
                element={user?.studentType === 'independent'
                  ? <StudentReferrals onLogout={onLogout} />
                  : <Navigate to="/student/dashboard" replace />}
              />
              <Route path="/student/profile" element={<StudentProfile user={user} onLogout={onLogout} />} />
              <Route path="/student/purchases" element={<StudentPurchases />} />
              <Route path="/student/achievements" element={<StudentAchievements onLogout={onLogout} />} />
              <Route path="/student/learning-activity" element={<StudentLearningActivity onLogout={onLogout} />} />
              <Route path="/student/updates" element={<StudentUpdates />} />
              <Route path="/student/settings" element={
                <StudentRoutePage eyebrow="PREFERENCES" title="Settings">
                  <SettingsPage
                    user={user}
                    onAccountUpdated={onAccountUpdated}
                    themePreference={themePreference}
                    onSetTheme={onSetTheme}
                  />
                </StudentRoutePage>
              } />
              <Route path="/student/help" element={<HelpCenterHome />} />
              <Route path="/student/help/email" element={<EmailSupportPage user={user} />} />
              <Route path="/student/help/submit-ticket" element={<SubmitSupportTicketPage />} />
              <Route path="/student/help/faqs" element={<SupportFaqPage />} />
              <Route path="/student/help/requests" element={<SupportRequestsPage />} />
              <Route path="/student/help/requests/:ticketId" element={<SupportTicketDetailPage />} />
              <Route path="/student/announcements" element={
                <StudentRoutePage eyebrow="FROM YOUR LEARNING COMMUNITY" title="Announcements">
                  <NotificationFeed role="student" onLogout={onLogout} />
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
