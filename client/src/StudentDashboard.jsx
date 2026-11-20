import React, { useEffect, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { API_BASE_URL } from './api-base-url.js'
import {
  EmailSupportPage,
  HelpCenterHome,
  SubmitComplaintPage,
  SubmitSupportTicketPage,
  SupportFaqPage,
  SupportRequestsPage,
  SupportTicketDetailPage,
} from './SupportCenter.jsx'
import SettingsPage from './SettingsPage.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { fetchWithAuth, isInvalidSessionResponse } from './auth-session.js'
import NotificationFeed from './NotificationFeed.jsx'
import StudentNotificationBell from './StudentNotificationBell.jsx'
import StudentNotificationsPage from './StudentNotificationsPage.jsx'
import StudentQuizExperience from './StudentQuizPanel.jsx'
import { STUDENT_LEARNING_PROGRESS_UPDATED_EVENT } from './student-notifications-events.js'
import { filterCoursesByCategory, getCourseCategoryNames, normalizeCourseCategory } from './course-categories.js'
import { findActiveTranscriptCueIndex, formatTranscriptTime } from './srt-transcript.js'
import { createAttentionCheckSchedule } from './video-attention-checks.js'
import './StudentDashboard.css'

const studentCertificateCache = new Map()
const studentCertificateRequests = new Map()
const studentCertificateCacheTtlMs = 30_000
const studentLearningPageCacheTtlMs = 30_000
const studentEnrollmentCache = new Map()
const studentEnrollmentRequests = new Map()
const studentCourseContentCache = new Map()
const studentCourseContentRequests = new Map()
const studentCourseLearningSeeds = new Map()
const studentPageCertificateRequests = new Map()
const studentResultsCache = new Map()
const studentReferralCache = new Map()
const studentReferralRequests = new Map()
const COURSE_NOTES_KEY = 'course-notes'
const COURSE_CERTIFICATE_KEY = 'course-certificate'

function getStudentCertificateCacheKey() {
  try {
    const auth = JSON.parse(sessionStorage.getItem('lms.auth') || 'null')
    return typeof auth?.user?.id === 'string' ? auth.user.id : ''
  } catch {
    return ''
  }
}

const navigation = [
  { label: 'Dashboard', icon: 'grid', path: '/student/dashboard' },
  { label: 'My Courses', icon: 'book', path: '/student/courses' },
  { label: 'Assignments', icon: 'check', path: '/student/assignments' },
  { label: 'Grades & Results', icon: 'chart', path: '/student/results' },
  { label: 'Learning Resources', icon: 'folder', path: '/student/resources' },
  { label: 'Certificates', icon: 'award', path: '/student/certificates' },
  { label: 'My Referrals', icon: 'users', path: '/student/referrals' },
  { label: 'My Profile', icon: 'user', path: '/student/profile' },
  { label: 'Settings', icon: 'settings', path: '/student/settings' },
  { label: 'Help Center', icon: 'help', path: '/student/help' },
]

const secondaryPages = {
  '/student/announcements': { label: 'Notifications', icon: 'bell' },
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
  { title: 'Grades & Results', description: 'View your quiz and assignment scores.', icon: 'chart', id: 'student-grades', path: '/student/results' },
  { title: 'Learning Resources', description: 'Access course notes and learning materials.', icon: 'folder', id: 'student-resources', path: '/student/resources' },
  { title: 'Certificates', description: 'View and download your earned certificates.', icon: 'award', id: 'student-certificates', path: '/student/certificates' },
  { title: 'My Profile', description: 'Review your personal and academic details.', icon: 'user', id: 'student-profile', path: '/student/profile' },
  { title: 'Settings', description: 'Manage your account and preferences.', icon: 'settings', id: 'student-settings', path: '/student/settings' },
]

function Icon({ name, size = 19 }) {
  const paths = {
    layoutDashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
    bookOpen: <><path d="M12 7v14" /><path d="M3 18V5a1 1 0 0 1 1-1h4a4 4 0 0 1 4 4 4 4 0 0 1 4-4h4a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-4a4 4 0 0 0-4 2 4 4 0 0 0-4-2H4a1 1 0 0 1-1-1Z" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8m-8 4h8" /></>,
    play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4z" /></>,
    clipboardCheck: <><rect x="8" y="4" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></>,
    chartNoAxesCombined: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-5 5" /></>,
    userRound: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    circleHelp: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.5 1.5c-.9 1.1-2.1 1.3-2.1 3m0 3h.01" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8m-8 4h8" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1.1-1.1" /></>,
    check: <><rect x="4" y="4" width="16" height="17" rx="2" /><path d="M8 3v3m8-3v3M4 9h16m-11 5 2 2 4-4" /></>,
    chart: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 5-6m-4 0h4v4" /></>,
    folder: <><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /><path d="M3 9h18" /></>,
    folderOpen: <><path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4H10l2 2h6.5A1.5 1.5 0 0 1 20 7.5V9" /><path d="M3 10h18l-2.1 8.4a2 2 0 0 1-1.9 1.6H5a2 2 0 0 1-2-2z" /></>,
    eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
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
    circleX: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.7 10.6 6.6-4.2m-6.6 7 6.6 4.2" /></>,
    gift: <><rect x="3" y="9" width="18" height="12" rx="1" /><path d="M2 6h20v4H2zm10 0v15m0-15H7.5a2.5 2.5 0 1 1 2.4-3.2L12 6Zm0 0h4.5a2.5 2.5 0 1 0-2.4-3.2L12 6Z" /></>,
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

function EarnedCertificateSkeleton() {
  return (
    <article className="student-certificates__earned-item" aria-hidden="true">
      <span className="student-certificates__skeleton-shape student-certificates__earned-art-skeleton" />
      <span className="student-certificates__earned-copy student-certificates__earned-copy-skeleton">
        <i className="student-certificates__skeleton-shape is-wide" />
        <i className="student-certificates__skeleton-shape is-medium" />
        <i className="student-certificates__skeleton-shape is-short" />
      </span>
      <span className="student-certificates__earned-actions">
        <i className="student-certificates__skeleton-shape is-action" />
        <i className="student-certificates__skeleton-shape is-action" />
      </span>
    </article>
  )
}

function InProgressCertificateSkeleton() {
  return (
    <article className="student-certificates__progress-card" aria-hidden="true">
      <div className="student-certificates__course-progress">
        <span className="student-certificates__course-art">
          <i className="student-certificates__skeleton-shape is-course-art" />
        </span>
        <span className="student-certificates__course-progress-copy">
          <i className="student-certificates__skeleton-shape is-wide" />
          <i className="student-certificates__skeleton-shape is-progress-meter" />
        </span>
        <i className="student-certificates__skeleton-shape is-course-arrow" />
      </div>
      <div className="student-certificates__remaining">
        <i className="student-certificates__skeleton-shape is-medium" />
        <i className="student-certificates__skeleton-shape is-wide" />
      </div>
    </article>
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

function StudentCertificatesPage({ onLogout }) {
  const navigate = useNavigate()
  const initialCache = studentCertificateCache.get(getStudentCertificateCacheKey())
  const [courses, setCourses] = useState(initialCache?.certificates || null)
  const [isLoading, setIsLoading] = useState(!initialCache)
  const [error, setError] = useState('')
  const [earnedSearch, setEarnedSearch] = useState('')
  const [preview, setPreview] = useState(null)
  const [activeCertificate, setActiveCertificate] = useState('')
  const previewUrlRef = useRef('')

  async function studentRequest(path) {
    let auth
    try {
      auth = JSON.parse(sessionStorage.getItem('lms.auth') || 'null')
    } catch {
      onLogout()
      throw new Error('Your saved student session is invalid. Please sign in again.')
    }
    if (typeof auth?.token !== 'string') {
      onLogout()
      throw new Error('Your session has ended. Please sign in again.')
    }
    const response = await fetchWithAuth(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    }, API_BASE_URL, auth.token)
    const result = await response.json().catch(() => ({}))
    if (isInvalidSessionResponse(response, result)) {
      onLogout()
      throw new Error('Your session has ended. Please sign in again.')
    }
    if (!response.ok) throw new Error(result.message || 'The certificate request could not be completed.')
    return result
  }

  async function loadCertificates(forceRefresh = false) {
    const cacheKey = getStudentCertificateCacheKey()
    const cached = cacheKey ? studentCertificateCache.get(cacheKey) : null
    const hasCachedData = Array.isArray(cached?.certificates)
    if (hasCachedData) {
      setCourses(cached.certificates)
      setIsLoading(false)
    } else {
      setIsLoading(true)
    }
    setError('')

    if (
      !forceRefresh
      && hasCachedData
      && Date.now() - cached.savedAt < studentCertificateCacheTtlMs
    ) return

    let request = cacheKey ? studentCertificateRequests.get(cacheKey) : null
    try {
      if (!request) {
        request = studentRequest('/certificates').then((result) => {
          if (!Array.isArray(result.certificates)) {
            throw new Error('The server returned invalid certificate data.')
          }
          if (cacheKey) {
            studentCertificateCache.set(cacheKey, {
              certificates: result.certificates,
              savedAt: Date.now(),
            })
          }
          return result.certificates
        })
        if (cacheKey) studentCertificateRequests.set(cacheKey, request)
      }
      setCourses(await request)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Certificates could not be loaded.')
    } finally {
      if (!hasCachedData) setIsLoading(false)
      if (cacheKey && studentCertificateRequests.get(cacheKey) === request) {
        studentCertificateRequests.delete(cacheKey)
      }
    }
  }

  useEffect(() => {
    loadCertificates()
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  async function openCertificate(certificate, download) {
    setActiveCertificate(certificate.id)
    setError('')
    try {
      let auth
      try {
        auth = JSON.parse(sessionStorage.getItem('lms.auth') || 'null')
      } catch {
        onLogout()
        throw new Error('Your saved student session is invalid. Please sign in again.')
      }
      if (typeof auth?.token !== 'string') {
        onLogout()
        throw new Error('Your session has ended. Please sign in again.')
      }
      const response = await fetchWithAuth(
        `${API_BASE_URL}/certificates/${encodeURIComponent(certificate.id)}/pdf${download ? '?download=true' : ''}`,
        { headers: { Authorization: `Bearer ${auth.token}` } },
        API_BASE_URL,
        auth.token,
      )
      const result = response.ok ? null : await response.json().catch(() => ({}))
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        throw new Error('Your session has ended. Please sign in again.')
      }
      if (!response.ok) throw new Error(result?.message || 'The certificate PDF could not be opened.')

      const objectUrl = URL.createObjectURL(await response.blob())
      if (download) {
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = `aiHustle-certificate-${certificate.certificateId}.pdf`
        document.body.append(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      } else {
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = objectUrl
        setPreview(certificate)
      }
    } catch (certificateError) {
      setError(certificateError instanceof Error ? certificateError.message : 'The certificate PDF could not be opened.')
    } finally {
      setActiveCertificate('')
    }
  }

  function closePreview() {
    setPreview(null)
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = ''
    }
  }

  const hasCertificateData = Array.isArray(courses)
  const certificateCourses = hasCertificateData ? courses : []
  const earnedCourses = certificateCourses.filter((course) => course.certificate)
  const matchingEarnedCourses = earnedCourses.filter((course) => (
    String(course.courseName || '').toLowerCase().includes(earnedSearch.trim().toLowerCase())
  ))
  const inProgressCourses = certificateCourses.filter((course) => !course.certificate)
  function continueCourse(course, pendingRequirements) {
    const courseId = String(course.courseId || '')
    if (!courseId) return
    const firstIncomplete = pendingRequirements.find((requirement) => (
      ['video', 'quiz', 'assignment'].includes(requirement.type)
      && typeof requirement.id === 'string'
      && requirement.id
    ))
    const query = new URLSearchParams()
    if (firstIncomplete?.type === 'video') {
      query.set('lesson', firstIncomplete.id)
    } else if (firstIncomplete) {
      query.set('activity', firstIncomplete.id)
      query.set('activityType', firstIncomplete.type)
    }
    const search = query.toString()
    navigate(`/student/course/${encodeURIComponent(courseId)}/learn${search ? `?${search}` : ''}`)
  }

  function getRequirementStatus(requirement) {
    if (requirement.type === 'assignment') {
      return requirement.status === 'awaiting-review' ? 'Awaiting Admin review'
        : requirement.status === 'resubmit' ? 'Resubmit required' : 'Not submitted'
    }
    if (requirement.type === 'quiz') return 'Pass required'
    if (requirement.type === 'profile') return 'Update profile'
    if (requirement.type === 'course') return 'Admin setup required'
    return 'Not completed'
  }

  return (
    <StudentRoutePage title="Certificates" className="student-certificates-page">
      <header className="student-certificates__hero">
        <div className="student-certificates__hero-copy">
          <h1>Certificates</h1>
          <p>Your course completion certificates, all in one place.</p>
          <span aria-hidden="true" />
        </div>
        <div className="student-certificates__hero-art" aria-hidden="true">
          <div className="student-certificates__diploma"><span /><i /><b /></div>
          <div className="student-certificates__diploma-seal"><Icon name="award" size={28} /></div>
          <span className="student-certificates__leaf student-certificates__leaf--one" />
          <span className="student-certificates__leaf student-certificates__leaf--two" />
        </div>
      </header>
      <section className="student-certificates__summary" aria-label="Certificate summary">
        {[
          { label: 'Certificates Earned', count: earnedCourses.length, icon: 'award', tone: 'gold' },
          { label: 'In Progress', count: inProgressCourses.length, icon: 'bookOpen', tone: 'green' },
          { label: 'Total Courses', count: certificateCourses.length, icon: 'spark', tone: 'amber' },
        ].map((stat) => (
          <div className="student-certificates__summary-card" key={stat.label}>
            <span className={`student-certificates__summary-icon is-${stat.tone}`}><Icon name={stat.icon} size={25} /></span>
            <span>
              <strong>
                {hasCertificateData
                  ? stat.count
                  : isLoading
                    ? <i className="student-certificates__skeleton-shape is-summary-count" aria-hidden="true" />
                    : '—'}
              </strong>
              <small>{stat.label}</small>
            </span>
          </div>
        ))}
      </section>
      {error && <p className="student-certificates__error" role="alert">{error}</p>}
      {hasCertificateData && certificateCourses.length === 0
        ? <EmptyState icon="award" title="No enrolled courses yet" description="Certificate status will appear here after you enroll in a course." />
        : <div className="student-certificates__columns" aria-busy={!hasCertificateData && isLoading}>
            <section className="student-certificates__panel student-certificates__panel--earned" aria-labelledby="student-certificates-earned-title">
              <header className="student-certificates__panel-heading">
                <span className="student-certificates__panel-icon"><Icon name="award" size={34} /></span>
                <div><h2 id="student-certificates-earned-title">Earned Certificates</h2><p>Courses you have successfully completed.</p></div>
                {hasCertificateData
                  ? <span className="student-certificates__count">{earnedCourses.length} {earnedCourses.length === 1 ? 'Certificate' : 'Certificates'}</span>
                  : isLoading
                    ? <span className="student-certificates__count student-certificates__count-skeleton" aria-hidden="true"><i className="student-certificates__skeleton-shape" /></span>
                    : <span className="student-certificates__count">Unavailable</span>}
              </header>
              <div className="student-certificates__earned-list">
                <label className="student-certificates__earned-search">
                  <span aria-hidden="true"><Icon name="search" size={16} /></span>
                  <input
                    type="search"
                    aria-label="Search earned certificates by course name"
                    placeholder="Search by course name"
                    value={earnedSearch}
                    onChange={(event) => setEarnedSearch(event.target.value)}
                  />
                </label>
                {!hasCertificateData && isLoading
                  ? [0, 1].map((skeleton) => <EarnedCertificateSkeleton key={skeleton} />)
                  : !hasCertificateData
                    ? <p className="student-certificates__panel-empty">Certificate data could not be loaded.</p>
                    : matchingEarnedCourses.length ? matchingEarnedCourses.map((course) => (
                  <article className="student-certificates__earned-item" key={course.courseId}>
                    <div className="student-certificates__certificate-art" aria-hidden="true">
                      <small>aiHustle</small><strong>Certificate</strong><span>of Completion</span><Icon name="award" size={22} />
                    </div>
                    <div className="student-certificates__earned-copy">
                      <h3>{course.courseName}</h3>
                      <span className="student-certificates__completed"><Icon name="check" size={13} />Completed</span>
                      <p><Icon name="clock" size={14} />Completed on {new Date(course.certificate.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                      <p><Icon name="clipboardCheck" size={14} />Certificate ID: {course.certificate.certificateId}</p>
                    </div>
                    <div className="student-certificates__earned-actions">
                      <button
                        type="button"
                        className="student-certificates__preview-button"
                        disabled={activeCertificate === course.certificate.id}
                        onClick={() => openCertificate(course.certificate, false)}
                      >
                        <Icon name="search" size={15} />Preview
                      </button>
                      <button
                        type="button"
                        className="student-certificates__download-button"
                        disabled={activeCertificate === course.certificate.id}
                        onClick={() => openCertificate(course.certificate, true)}
                      >
                        <Icon name="arrow" size={15} />Download PDF
                      </button>
                    </div>
                  </article>
                )) : earnedSearch.trim()
                  ? <p className="student-certificates__panel-empty">No certificates found</p>
                  : <p className="student-certificates__panel-empty">Completed courses will appear here once certificates are earned.</p>}
              </div>
            </section>
            <section className="student-certificates__panel student-certificates__panel--progress" aria-labelledby="student-certificates-progress-title">
              <header className="student-certificates__panel-heading">
                <span className="student-certificates__panel-icon"><Icon name="clock" size={34} /></span>
                <div><h2 id="student-certificates-progress-title">In Progress</h2><p>Complete the remaining activities to earn your certificate.</p></div>
                {hasCertificateData
                  ? <span className="student-certificates__count">{inProgressCourses.length} {inProgressCourses.length === 1 ? 'Course' : 'Courses'}</span>
                  : isLoading
                    ? <span className="student-certificates__count student-certificates__count-skeleton" aria-hidden="true"><i className="student-certificates__skeleton-shape" /></span>
                    : <span className="student-certificates__count">Unavailable</span>}
              </header>
              <div className="student-certificates__progress-list">
                {!hasCertificateData && isLoading
                  ? [0, 1].map((skeleton) => <InProgressCertificateSkeleton key={skeleton} />)
                  : !hasCertificateData
                    ? <p className="student-certificates__panel-empty">Certificate data could not be loaded.</p>
                    : inProgressCourses.length ? inProgressCourses.map((course) => {
                  const percentage = Math.max(0, Math.min(100, Number(course.progress?.percentage) || 0))
                  const pendingRequirements = course.pendingRequirements || []
                  const firstIncomplete = pendingRequirements.find((requirement) => (
                    ['video', 'quiz', 'assignment'].includes(requirement.type)
                    && typeof requirement.id === 'string'
                    && requirement.id
                  ))
                  return (
                    <article className="student-certificates__progress-card" key={course.courseId}>
                      <div className="student-certificates__course-progress">
                        <span className="student-certificates__course-art">
                          {course.thumbnailUrl
                            ? <img src={course.thumbnailUrl} alt="" loading="lazy" />
                            : <Icon name="bookOpen" size={28} />}
                        </span>
                        <div className="student-certificates__course-progress-copy">
                          <h3>{course.courseName}</h3>
                          <div className="student-certificates__progress-meter">
                            <span role="progressbar" aria-label={`${course.courseName} completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
                              <i style={{ width: `${percentage}%` }} />
                            </span>
                            <strong>{percentage}%</strong>
                          </div>
                        </div>
                        <button
                          className="student-certificates__course-arrow"
                          type="button"
                          aria-label={firstIncomplete
                            ? `Continue ${course.courseName}: ${firstIncomplete.title}`
                            : `Open ${course.courseName}`}
                          onClick={() => continueCourse(course, pendingRequirements)}
                        >
                          <Icon name="arrow" size={17} />
                        </button>
                      </div>
                      <div className="student-certificates__remaining">
                        <strong>Remaining requirement:</strong>
                        {pendingRequirements.length ? (
                          <ul>
                            {pendingRequirements.slice(0, 2).map((requirement, index) => (
                              <li key={`${requirement.type}-${requirement.title}-${index}`}>
                                <span aria-hidden="true" />
                                <span>{requirement.title}</span>
                                <small>{getRequirementStatus(requirement)}</small>
                              </li>
                            ))}
                          </ul>
                        ) : <p>Course requirements are being checked.</p>}
                        {pendingRequirements.length > 2 && <small className="student-certificates__more-requirements">+{pendingRequirements.length - 2} more requirements</small>}
                        <span className="student-certificates__task-count">{pendingRequirements.length} {pendingRequirements.length === 1 ? 'task' : 'tasks'} required</span>
                      </div>
                    </article>
                  )
                }) : <p className="student-certificates__panel-empty">All enrolled courses have earned certificates.</p>}
              </div>
            </section>
          </div>}
      {preview && previewUrlRef.current && (
        <div className="student-certificate-preview" role="dialog" aria-modal="true" aria-label={`Certificate preview for ${preview.courseName}`}>
          <div className="student-certificate-preview__panel">
            <header><strong>{preview.courseName}</strong><button type="button" onClick={closePreview} aria-label="Close certificate preview">×</button></header>
            <iframe title={`Certificate for ${preview.courseName}`} src={`${previewUrlRef.current}#view=Fit`} />
          </div>
        </div>
      )}
    </StudentRoutePage>
  )
}

async function fetchMyEnrollments(onLogout, signal) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (typeof auth?.token !== 'string') {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  const response = await fetchWithAuth(`${API_BASE_URL}/enrollments/me`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    signal,
  }, API_BASE_URL, auth.token)
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
  const response = await fetchWithAuth(`${API_BASE_URL}/learning/summary`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    signal,
  }, API_BASE_URL, auth.token)
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

function getLocalLearningDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getLearningActivityDateRanges(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const previousMonday = new Date(monday)
  previousMonday.setDate(monday.getDate() - 7)
  const datesForWeek = (mondayDate) => Array.from({ length: 7 }, (_value, index) => {
    const date = new Date(mondayDate)
    date.setDate(mondayDate.getDate() + index)
    return getLocalLearningDateKey(date)
  })
  const currentWeek = datesForWeek(monday)
  const previousWeek = datesForWeek(previousMonday)
  return {
    today: getLocalLearningDateKey(today),
    currentWeek,
    previousWeek,
    start: previousWeek[0],
    end: currentWeek[currentWeek.length - 1],
  }
}

async function fetchStudentLearningActivity(onLogout, startDate, endDate, signal) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (typeof auth?.token !== 'string') {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  const query = new URLSearchParams({ start: startDate, end: endDate })
  const response = await fetchWithAuth(`${API_BASE_URL}/learning/activity?${query}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    signal,
  }, API_BASE_URL, auth.token)
  const result = await response.json()
  if (isInvalidSessionResponse(response, result)) {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  if (!response.ok) throw new Error(result.message || 'Learning activity could not be loaded.')
  if (!Array.isArray(result.days) || result.days.some((day) => (
    typeof day.date !== 'string'
    || !Number.isFinite(day.seconds)
    || !Number.isFinite(day.videosWatched)
    || !Number.isFinite(day.lessonsCompleted)
  ))) {
    throw new Error('The server returned invalid learning activity data.')
  }
  return result.days
}

async function fetchStudentCourseContent(courseId, onLogout, signal) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (typeof auth?.token !== 'string') {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  const response = await fetchWithAuth(`${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/learning-content`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    signal,
  }, API_BASE_URL, auth.token)
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

function getStudentPageCacheKey() {
  return getStudentCertificateCacheKey()
}

function getCachedStudentPageEnrollments() {
  const cacheKey = getStudentPageCacheKey()
  return cacheKey ? studentEnrollmentCache.get(cacheKey)?.enrollments || null : null
}

async function fetchStudentPageEnrollments(onLogout) {
  const cacheKey = getStudentPageCacheKey()
  if (!cacheKey) return fetchMyEnrollments(onLogout)
  const cached = studentEnrollmentCache.get(cacheKey)
  if (cached && Date.now() - cached.savedAt < studentLearningPageCacheTtlMs) return cached.enrollments

  let request = studentEnrollmentRequests.get(cacheKey)
  if (!request) {
    request = fetchMyEnrollments(onLogout).then((enrollments) => {
      studentEnrollmentCache.set(cacheKey, { enrollments, savedAt: Date.now() })
      return enrollments
    })
    studentEnrollmentRequests.set(cacheKey, request)
  }
  try {
    return await request
  } finally {
    if (studentEnrollmentRequests.get(cacheKey) === request) studentEnrollmentRequests.delete(cacheKey)
  }
}

function getStudentCourseContentCacheKey(courseId) {
  const studentId = getStudentPageCacheKey()
  return studentId ? `${studentId}:${courseId}` : ''
}

function getCachedStudentPageCourseContent(courseId) {
  const cacheKey = getStudentCourseContentCacheKey(courseId)
  return cacheKey ? studentCourseContentCache.get(cacheKey)?.content || null : null
}

function seedStudentCourseLearning(enrollment) {
  const courseId = enrollment?.courseId?._id
  const cacheKey = getStudentCourseContentCacheKey(courseId)
  if (!cacheKey || !enrollment?._id || !courseId) return
  studentCourseLearningSeeds.set(cacheKey, { enrollment, savedAt: Date.now() })
}

function getStudentCourseLearningSeed(courseId) {
  const cacheKey = getStudentCourseContentCacheKey(courseId)
  const seed = cacheKey ? studentCourseLearningSeeds.get(cacheKey) : null
  if (!seed) return null
  if (Date.now() - seed.savedAt >= studentLearningPageCacheTtlMs) {
    studentCourseLearningSeeds.delete(cacheKey)
    return null
  }
  return seed.enrollment
}

function getInitialStudentCourseLearningEnrollment(courseId) {
  const cachedContent = getCachedStudentPageCourseContent(courseId)
  if (cachedContent?.enrollment) {
    return {
      ...cachedContent.enrollment,
      assignmentSubmissions: cachedContent.assignmentSubmissions,
      quizAttempts: cachedContent.quizAttempts,
    }
  }
  const enrollment = getStudentCourseLearningSeed(courseId)
  return enrollment
    ? { ...enrollment, assignmentSubmissions: [], quizAttempts: [] }
    : null
}

async function fetchStudentPageCourseContent(courseId, onLogout) {
  const cacheKey = getStudentCourseContentCacheKey(courseId)
  if (!cacheKey) return fetchStudentCourseContent(courseId, onLogout)
  const cached = studentCourseContentCache.get(cacheKey)
  if (cached && Date.now() - cached.savedAt < studentLearningPageCacheTtlMs) return cached.content

  let request = studentCourseContentRequests.get(cacheKey)
  if (!request) {
    request = fetchStudentCourseContent(courseId, onLogout).then((content) => {
      studentCourseContentCache.set(cacheKey, { content, savedAt: Date.now() })
      return content
    })
    studentCourseContentRequests.set(cacheKey, request)
  }
  try {
    return await request
  } finally {
    if (studentCourseContentRequests.get(cacheKey) === request) studentCourseContentRequests.delete(cacheKey)
  }
}

async function fetchStudentPageCertificates(onLogout) {
  const cacheKey = getStudentPageCacheKey()
  if (!cacheKey) return fetchStudentCertificates(onLogout)
  const cached = studentCertificateCache.get(cacheKey)
  if (cached && Date.now() - cached.savedAt < studentCertificateCacheTtlMs) return cached.certificates

  let request = studentPageCertificateRequests.get(cacheKey)
  if (!request) {
    request = fetchStudentCertificates(onLogout).then((certificates) => {
      studentCertificateCache.set(cacheKey, { certificates, savedAt: Date.now() })
      return certificates
    })
    studentPageCertificateRequests.set(cacheKey, request)
  }
  try {
    return await request
  } finally {
    if (studentPageCertificateRequests.get(cacheKey) === request) studentPageCertificateRequests.delete(cacheKey)
  }
}

function invalidateStudentResultsCache() {
  const cacheKey = getStudentPageCacheKey()
  if (cacheKey) studentResultsCache.delete(cacheKey)
}

function invalidateStudentLearningPageCaches() {
  const cacheKey = getStudentPageCacheKey()
  if (!cacheKey) return
  studentEnrollmentCache.delete(cacheKey)
  studentResultsCache.delete(cacheKey)
  studentCertificateCache.delete(cacheKey)
  const coursePrefix = `${cacheKey}:`
  studentCourseContentCache.forEach((_, key) => {
    if (key.startsWith(coursePrefix)) studentCourseContentCache.delete(key)
  })
  studentCourseLearningSeeds.forEach((_, key) => {
    if (key.startsWith(coursePrefix)) studentCourseLearningSeeds.delete(key)
  })
}

async function fetchStudentCourseCertificate(courseId, onLogout, signal) {
  const certificates = await fetchStudentCertificates(onLogout, signal)
  const certificate = certificates.find((entry) => String(entry.courseId) === String(courseId))
  if (!certificate) throw new Error('Certificate status for this course could not be found.')
  return certificate
}

async function fetchStudentCertificates(onLogout, signal) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (typeof auth?.token !== 'string') {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  const response = await fetchWithAuth(`${API_BASE_URL}/certificates`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    signal,
  }, API_BASE_URL, auth.token)
  const result = await response.json()
  if (isInvalidSessionResponse(response, result)) {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  if (!response.ok) throw new Error(result.message || 'Certificate status could not be loaded.')
  if (!Array.isArray(result.certificates)) throw new Error('The server returned invalid certificate data.')
  return result.certificates
}

function getCourseQuizTitle(course, quizId) {
  const quizzes = [
    ...(course.quizzes || []),
    ...(course.modules || []).flatMap((module) => [
      ...(module.quiz ? [module.quiz] : []),
      ...(module.contentItems || [])
        .filter((item) => item.type === 'quiz')
        .map((item) => item.quiz || item),
    ]),
  ]
  return quizzes.find((quiz) => String(quiz._id || quiz.quiz?._id) === String(quizId))?.title || 'Quiz'
}

function getCourseAssignmentTitle(course, assignmentId) {
  const assignments = [
    ...(course.assignments || []),
    ...(course.modules || []).flatMap((module) => (module.contentItems || [])
      .filter((item) => item.type === 'assignment')
      .map((item) => item.assignment || item)),
  ]
  return assignments.find((assignment) => String(assignment._id) === String(assignmentId))?.title || 'Assignment'
}

function getCourseAssignments(course) {
  const moduleAssignments = (course.modules || []).flatMap((module) => (
    (module.contentItems || [])
      .filter((item) => item.type === 'assignment')
      .map((item) => ({ ...item, ...(item.assignment || {}), _id: item._id || item.assignment?._id }))
  ))
  const seenIds = new Set()
  return [...(course.assignments || []), ...moduleAssignments].filter((assignment) => {
    const id = String(assignment._id || '')
    if (!id || seenIds.has(id)) return false
    seenIds.add(id)
    return true
  }).map((assignment) => ({
    ...assignment,
    description: assignment.description || assignment.content || '',
  }))
}

function getLatestAssignmentSubmission(submissions, assignmentId) {
  return submissions
    .filter((submission) => String(submission.assignmentId) === String(assignmentId))
    .sort((left, right) => new Date(right.submittedAt || 0).getTime() - new Date(left.submittedAt || 0).getTime())[0] || null
}

function getAssignmentRecordStatus(submission) {
  if (!submission) return 'pending'
  if (submission.reviewStatus === 'approved') return 'graded'
  if (submission.reviewStatus === 'pending') return 'submitted'
  return 'pending'
}

function getLatestEnrollmentsByCourse(enrollments) {
  const latestEnrollmentByCourse = new Map()
  enrollments.forEach((enrollment) => {
    const courseId = String(enrollment.courseId?._id || enrollment.courseId || '')
    if (courseId && !latestEnrollmentByCourse.has(courseId)) {
      latestEnrollmentByCourse.set(courseId, enrollment)
    }
  })
  return latestEnrollmentByCourse
}

function getStudentResourceRecords(enrollments) {
  const resourcesByCourseAndUrl = new Map()
  for (const enrollment of getLatestEnrollmentsByCourse(enrollments).values()) {
    const course = enrollment.courseId
    if (!course || typeof course !== 'object') continue
    const courseId = String(course._id || '')
    if (!courseId) continue

    for (const module of course.modules || []) {
      const contentItems = [
        ...(module.lessons || []),
        ...(module.contentItems || []),
      ]
      for (const item of contentItems) {
        for (const resource of item.resources || []) {
          const url = typeof resource.url === 'string' ? resource.url.trim() : ''
          if (!url) continue
          const key = `${courseId}:${url}`
          if (resourcesByCourseAndUrl.has(key)) continue
          const fileName = url.split(/[?#]/, 1)[0].split('/').pop()
          const format = resource.format
            || (fileName?.includes('.') ? fileName.split('.').pop() : '')
            || 'FILE'
          resourcesByCourseAndUrl.set(key, {
            key,
            title: resource.title?.trim() || fileName || 'Learning resource',
            url,
            format: String(format).toUpperCase(),
            bytes: resource.bytes,
            topic: course.category || module.title || course.title || 'Course',
            courseId,
            courseName: course.title || 'Course',
            date: item.updatedAt || course.updatedAt || enrollment.createdAt,
          })
        }
      }
    }
  }
  return [...resourcesByCourseAndUrl.values()]
}

function formatStudentResourceSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatStudentResourceDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function createStudentAssignmentRows(courseResults) {
  return courseResults.flatMap(({ enrollment, submissions }) => {
    const course = enrollment.courseId
    return getCourseAssignments(course).map((assignment) => {
      const submission = getLatestAssignmentSubmission(submissions, assignment._id)
      return {
        key: `${enrollment._id}:${assignment._id}`,
        courseId: String(course._id),
        courseName: course.title || 'Course',
        enrollmentId: String(enrollment._id),
        assignment,
        submission,
        status: getAssignmentRecordStatus(submission),
      }
    })
  })
}

async function fetchStudentAssignmentRows(onLogout) {
  const enrollments = await fetchStudentPageEnrollments(onLogout)
  const latestEnrollments = getLatestEnrollmentsByCourse(enrollments)
  const courseResults = await Promise.all([...latestEnrollments.keys()].map(async (courseId) => {
    const result = await fetchStudentPageCourseContent(courseId, onLogout)
    return { enrollment: result.enrollment, submissions: result.assignmentSubmissions }
  }))
  return createStudentAssignmentRows(courseResults)
}

function getCachedStudentAssignmentRows() {
  const enrollments = getCachedStudentPageEnrollments()
  if (!enrollments) return null
  const latestEnrollments = getLatestEnrollmentsByCourse(enrollments)
  const courseResults = [...latestEnrollments.keys()].map((courseId) => {
    const content = getCachedStudentPageCourseContent(courseId)
    return content
      ? { enrollment: content.enrollment, submissions: content.assignmentSubmissions }
      : null
  })
  if (courseResults.some((result) => result === null)) return null
  return createStudentAssignmentRows(courseResults)
}

function getDashboardAssignmentStatus(entry) {
  const reviewStatus = entry.submission?.reviewStatus
  if (!entry.submission) return { label: 'Pending', tone: 'pending' }
  if (reviewStatus === 'approved') return { label: 'Approved', tone: 'approved' }
  if (reviewStatus === 'rejected') return { label: 'Rejected', tone: 'rejected' }
  if (reviewStatus === 'pending') return { label: 'Awaiting Review', tone: 'awaiting' }
  return { label: 'Submitted', tone: 'submitted' }
}

function StudentDashboardUpcomingAssignments({ onLogout }) {
  const cachedAssignments = getCachedStudentAssignmentRows()
  const [assignments, setAssignments] = useState(cachedAssignments || [])
  const [hasAssignmentData, setHasAssignmentData] = useState(cachedAssignments !== null)
  const [loading, setLoading] = useState(cachedAssignments === null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    async function loadAssignments() {
      setLoading(true)
      setError('')
      try {
        const rows = await fetchStudentAssignmentRows(onLogout)
        if (active) {
          setAssignments(rows)
          setHasAssignmentData(true)
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Assignments could not be loaded.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadAssignments()
    return () => { active = false }
  }, [onLogout, retry])

  const visibleAssignments = [...assignments]
    .sort((left, right) => {
      const priority = (entry) => {
        const status = getDashboardAssignmentStatus(entry).tone
        return status === 'approved' ? 2 : status === 'awaiting' || status === 'submitted' ? 1 : 0
      }
      const priorityDifference = priority(left) - priority(right)
      if (priorityDifference) return priorityDifference
      const leftDue = left.assignment.dueDate ? new Date(left.assignment.dueDate).getTime() : Number.POSITIVE_INFINITY
      const rightDue = right.assignment.dueDate ? new Date(right.assignment.dueDate).getTime() : Number.POSITIVE_INFINITY
      return leftDue - rightDue
    })
    .slice(0, 3)

  return (
    <div className="student-dashboard-assignment-list" aria-busy={loading}>
      {error && <p className="student-dashboard-data-error" role="alert">{error}</p>}
      {loading && !hasAssignmentData ? (
        [0, 1, 2].map((item) => (
          <div className="student-dashboard-assignment student-dashboard-assignment--skeleton" key={item} aria-hidden="true">
            <span className="student-page-skeleton student-dashboard-assignment__skeleton-icon" />
            <span className="student-dashboard-assignment__skeleton-copy">
              <i className="student-page-skeleton" />
              <i className="student-page-skeleton is-short" />
            </span>
            <span className="student-page-skeleton student-dashboard-assignment__skeleton-status" />
          </div>
        ))
      ) : !hasAssignmentData && error ? null : assignments.length === 0 ? (
        <EmptyState
          icon="check"
          title="No assignments yet"
          description="Assignments from your enrolled courses will appear here."
        />
      ) : visibleAssignments.map((entry) => {
        const status = getDashboardAssignmentStatus(entry)
        const dueDate = entry.assignment.dueDate ? new Date(entry.assignment.dueDate) : null
        const dueDateLabel = dueDate && Number.isFinite(dueDate.getTime())
          ? `Due: ${formatResultDate(dueDate)}`
          : 'No due date'
        return (
          <Link className="student-dashboard-assignment" key={entry.key} to="/student/assignments">
            <span className="student-dashboard-assignment__icon"><Icon name="file" size={18} /></span>
            <span className="student-dashboard-assignment__copy">
              <strong>{entry.assignment.title || 'Assignment'}</strong>
              <span>{entry.courseName}</span>
              <small>{dueDateLabel}</small>
            </span>
            <span className={`student-dashboard-assignment__status is-${status.tone}`}>{status.label}</span>
          </Link>
        )
      })}
      {hasAssignmentData && assignments.length > 3 && (
        <Link className="student-dashboard-assignment-list__more" to="/student/assignments">
          View all assignments <Icon name="arrow" size={15} />
        </Link>
      )}
      {!hasAssignmentData && error && (
        <button
          className="student-dashboard-data-retry"
          type="button"
          onClick={() => setRetry((current) => current + 1)}
        >
          Try again
        </button>
      )}
    </div>
  )
}

function StudentResourcesPage({ onLogout }) {
  const cachedEnrollments = getCachedStudentPageEnrollments()
  const [enrollments, setEnrollments] = useState(cachedEnrollments)
  const [isLoading, setIsLoading] = useState(!cachedEnrollments)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedCourseId, setSelectedCourseId] = useState('all')
  const [previewResource, setPreviewResource] = useState(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let isCurrent = true
    if (!getCachedStudentPageEnrollments()) setIsLoading(true)
    setLoadError('')
    fetchStudentPageEnrollments(onLogout)
      .then((result) => {
        if (isCurrent) setEnrollments(result)
      })
      .catch((error) => {
        if (isCurrent) {
          setLoadError(error instanceof Error ? error.message : 'Learning resources could not be loaded.')
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })
    return () => { isCurrent = false }
  }, [onLogout, retryCount])

  const enrolledCourses = [...getLatestEnrollmentsByCourse(enrollments || []).entries()]
    .flatMap(([courseId, enrollment]) => {
      const course = enrollment.courseId
      return course && typeof course === 'object'
        ? [{ id: courseId, title: course.title || 'Course' }]
        : []
    })
  const resources = getStudentResourceRecords(enrollments || [])
  const visibleResources = resources.filter((resource) => {
    const matchesCourse = selectedCourseId === 'all' || resource.courseId === selectedCourseId
    const term = search.trim().toLocaleLowerCase()
    const matchesSearch = !term || [resource.title, resource.topic, resource.courseName]
      .some((value) => value.toLocaleLowerCase().includes(term))
    return matchesCourse && matchesSearch
  })

  return (
    <div className="student-resource-library">
      <header className="student-resource-library__intro">
        <p className="student-resource-library__eyebrow">KEEP EXPLORING</p>
        <h1>Learning Resources</h1>
        <p>Explore study materials and learning resources for your enrolled courses.</p>
      </header>

      <section className="student-resource-library__filters" aria-label="Filter learning resources">
        <label className="student-resource-library__search">
          <Icon name="search" size={20} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search resources by title or topic..."
            aria-label="Search resources by title or topic"
          />
        </label>
        <label className="student-resource-library__course-filter">
          <span>Filter by Course</span>
          <select
            value={selectedCourseId}
            onChange={(event) => setSelectedCourseId(event.target.value)}
            disabled={enrolledCourses.length === 0}
            aria-label="Filter resources by course"
          >
            <option value="all">All Enrolled Courses ({enrolledCourses.length})</option>
            {enrolledCourses.map((course) => (
              <option key={course.id} value={course.id}>{course.title}</option>
            ))}
          </select>
        </label>
      </section>

      {loadError && (
        <div className="student-resource-library__error" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
        </div>
      )}

      {isLoading && !enrollments ? (
        <p className="student-resource-library__state" role="status" aria-busy="true">Loading your learning resources...</p>
      ) : visibleResources.length ? (
        <div className="student-resource-library__grid">
          {visibleResources.map((resource) => (
            <article className="student-resource-card" key={resource.key}>
              <div className="student-resource-card__topline">
                <span className="student-resource-card__format">{resource.format}</span>
                {formatStudentResourceSize(resource.bytes) && (
                  <span className="student-resource-card__size">{formatStudentResourceSize(resource.bytes)}</span>
                )}
              </div>
              <h2>{resource.title}</h2>
              <p className="student-resource-card__topic">{resource.topic}</p>
              <footer>
                <time dateTime={resource.date || undefined}>{formatStudentResourceDate(resource.date)}</time>
                <div className="student-resource-card__actions">
                  <button type="button" onClick={() => setPreviewResource(resource)}>
                    <Icon name="eye" size={17} />
                    Preview
                  </button>
                  <a href={resource.url} download={resource.title}>
                    <Icon name="download" size={17} />
                    Download
                  </a>
                </div>
              </footer>
            </article>
          ))}
        </div>
      ) : !isLoading && !loadError ? (
        <div className="student-resource-library__state">
          <h2>
            {resources.length
              ? 'No resources match your search'
              : enrolledCourses.length
                ? 'No learning materials yet'
                : 'No enrolled courses yet'}
          </h2>
          <p>
            {resources.length
              ? 'Try another title or topic, or select a different course.'
              : enrolledCourses.length
                ? 'Course materials will appear here when they are shared with your enrolled courses.'
                : 'Enroll in a course to find its study materials here.'}
          </p>
          {(search || selectedCourseId !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setSelectedCourseId('all')
              }}
            >Clear filters</button>
          )}
        </div>
      ) : null}

      {previewResource && (
        <div
          className="student-resource-preview"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${previewResource.title}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreviewResource(null)
          }}
        >
          <div className="student-resource-preview__panel">
            <header>
              <strong>{previewResource.title}</strong>
              <button type="button" onClick={() => setPreviewResource(null)} aria-label="Close preview">×</button>
            </header>
            <iframe title={`Preview of ${previewResource.title}`} src={previewResource.url} />
          </div>
        </div>
      )}
    </div>
  )
}

function StudentAssignmentsPage({ onLogout, onLearningDataChanged }) {
  const [initialAssignments] = useState(getCachedStudentAssignmentRows)
  const [assignments, setAssignments] = useState(initialAssignments || [])
  const [hasAssignmentData, setHasAssignmentData] = useState(initialAssignments !== null)
  const [isLoading, setIsLoading] = useState(initialAssignments === null)
  const [error, setError] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [selectedCourseId, setSelectedCourseId] = useState('all')
  const [activeAssignmentKey, setActiveAssignmentKey] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)
  const hasAssignmentDataRef = useRef(initialAssignments !== null)

  useEffect(() => {
    let active = true
    async function loadAssignments() {
      if (!hasAssignmentDataRef.current) setIsLoading(true)
      setError('')
      try {
        const rows = await fetchStudentAssignmentRows(onLogout)
        if (active) {
          setAssignments(rows)
          setHasAssignmentData(true)
          hasAssignmentDataRef.current = true
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Assignments could not be loaded.')
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }
    void loadAssignments()
    return () => { active = false }
  }, [onLogout, refreshToken])

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setRefreshToken((current) => current + 1)
    }
    const intervalId = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const activeAssignment = assignments.find(({ key }) => key === activeAssignmentKey) || null
  const courseAssignments = selectedCourseId === 'all'
    ? assignments
    : assignments.filter(({ courseId }) => courseId === selectedCourseId)
  const counts = {
    all: courseAssignments.length,
    pending: courseAssignments.filter(({ status }) => status === 'pending').length,
    submitted: courseAssignments.filter(({ status }) => status === 'submitted').length,
    graded: courseAssignments.filter(({ status }) => status === 'graded').length,
  }
  const visibleAssignments = courseAssignments.filter((entry) => (
    (selectedStatus === 'all' || entry.status === selectedStatus)
  )).sort((left, right) => {
    const leftDue = left.assignment.dueDate ? new Date(left.assignment.dueDate).getTime() : Number.POSITIVE_INFINITY
    const rightDue = right.assignment.dueDate ? new Date(right.assignment.dueDate).getTime() : Number.POSITIVE_INFINITY
    return leftDue - rightDue || String(left.assignment.title || '').localeCompare(String(right.assignment.title || ''))
  })
  const courses = [...new Map(assignments.map(({ courseId, courseName }) => [courseId, courseName])).entries()]
  function updateSubmission(entryKey, submission) {
    setAssignments((current) => current.map((entry) => (
      entry.key === entryKey
        ? { ...entry, submission, status: getAssignmentRecordStatus(submission) }
        : entry
    )))
    const entry = assignments.find(({ key }) => key === entryKey)
    if (entry) {
      studentCourseContentCache.delete(getStudentCourseContentCacheKey(entry.courseId))
      invalidateStudentResultsCache()
    }
  }

  const filters = [
    { key: 'all', label: hasAssignmentData ? `All Assignments (${counts.all})` : 'All Assignments' },
    { key: 'pending', label: hasAssignmentData ? `Pending (${counts.pending})` : 'Pending' },
    { key: 'submitted', label: hasAssignmentData ? `Awaiting Review (${counts.submitted})` : 'Awaiting Review' },
    { key: 'graded', label: hasAssignmentData ? `Graded (${counts.graded})` : 'Graded' },
  ]

  return (
    <StudentRoutePage eyebrow="STAY ON TRACK" title="Assignments" className="student-assignments-page">
      <div className="student-assignments">
        <header className="student-assignments__header">
          <div className="student-assignments__heading">
            <span className="student-assignments__eyebrow">Stay on Track</span>
            <h1>Your Assignments</h1>
            <p>View, submit, and track your course assignments.</p>
          </div>
          <svg className="student-assignments__illustration" viewBox="0 0 300 160" aria-hidden="true">
            <path d="M232 147c0 0 18-54-14-90 11-12 14-21 13-35l-26-2-27 17-14 36-15 12 14 31 69-2Z" fill="#AAD0B6" opacity="0.7"/>
            <path d="M220 58h-42c-5 0-9 4-9 9v55c0 5 4 9 9 9h67c5 0 9-4 9-9V81l-34-23Z" fill="#f4f5f0" stroke="#c9c7be" strokeWidth="2"/>
            <path d="M220 58v23h34" fill="none" stroke="#d5d0c8" strokeWidth="2"/>
            <path d="M178 84h52M178 96h52M178 108h41" stroke="#88A99A" strokeWidth="2" strokeLinecap="round"/>
            <path d="M250 99l15 15-20 20-17-17" fill="none" stroke="#38A76A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M267 95l-8 8" stroke="#7DA297" strokeWidth="2" strokeLinecap="round"/>
            <path d="M144 52c0-6 5-11 11-11h43c6 0 11 5 11 11v57c0 6-5 11-11 11h-43c-6 0-11-5-11-11V52Z" fill="#f6f7f1" stroke="#d4d0c4" strokeWidth="2"/>
            <path d="M171 48l39 29-39 29-39-29 39-29Z" fill="#dfece4" opacity="0.9"/>
            <path d="M165 58h13M165 68h26" stroke="#7EA89C" strokeWidth="2" strokeLinecap="round"/>
            <path d="M124 118c14-15 28-19 44-11 9 5 18 6 29 3" fill="none" stroke="#d8b142" strokeWidth="4" strokeLinecap="round"/>
            <path d="M230 105l16-11 28 0c13 0 25 12 25 25v3H203l27-17Z" fill="#D3E8D3"/>
            <path d="M263 98l15 42h3l14-42h-12l-9 17-9-17h-2Z" fill="#f1d474"/>
            <path d="M100 121l-28-34 19 63h27l-18-29Z" fill="#e6d38d" opacity="0.85"/>
            <path d="M65 110l52 30" stroke="#7e7f74" strokeWidth="3" strokeLinecap="round" opacity="0.6"/>
            <path d="M72 61l-25 35" stroke="#f3d363" strokeWidth="5" strokeLinecap="round"/>
            <path d="M47 99l-17 8 27 9-10-17Z" fill="#f3d363"/>
            <path d="M46 91l31-24" stroke="#f0c94f" strokeWidth="4" strokeLinecap="round"/>
            <circle cx="44" cy="87" r="4" fill="#e6c257"/>
          </svg>
        </header>

        <div className="student-assignments__stats" aria-label="Assignment summary">
          {[
            { label: 'Total Assignments', value: counts.all, icon: 'check' },
            { label: 'Pending', value: counts.pending, icon: 'clock', tone: 'amber' },
            { label: 'Awaiting Review', value: counts.submitted, icon: 'check', tone: 'green' },
            { label: 'Graded', value: counts.graded, icon: 'award', tone: 'purple' },
          ].map((stat) => (
            <article className="student-assignments__stat" key={stat.label}>
              <span className={`student-assignments__stat-icon${stat.tone ? ` student-assignments__stat-icon--${stat.tone}` : ''}`}>
                <Icon name={stat.icon} size={20} />
              </span>
              <div>
                <span className="student-assignments__stat-label">{stat.label}</span>
                <strong>
                  {isLoading
                    ? <span className="student-page-skeleton student-assignments__stat-skeleton" aria-hidden="true" />
                    : hasAssignmentData ? stat.value : '—'}
                </strong>
              </div>
            </article>
          ))}
        </div>

        {error && <p className="student-assignments__error" role="alert">{error}</p>}

        <div className="student-assignments__toolbar">
          <div className="student-assignments__tabs" role="tablist" aria-label="Assignment filters">
            {filters.map((filter) => (
              <button
                type="button"
                role="tab"
                aria-selected={selectedStatus === filter.key}
                className={`student-assignments__tab${selectedStatus === filter.key ? ' is-active' : ''}`}
                key={filter.key}
                onClick={() => setSelectedStatus(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <label className="student-assignments__filter">
            <select aria-label="Filter by course" value={selectedCourseId} onChange={(event) => setSelectedCourseId(event.target.value)}>
              <option value="all">All Courses</option>
              {courses.map(([courseId, courseName]) => <option value={courseId} key={courseId}>{courseName}</option>)}
            </select>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </label>
        </div>

        <div className="student-assignments__list" aria-label="Assignments list" aria-busy={isLoading}>
          {isLoading ? (
            [0, 1, 2].map((item) => (
              <article className="student-assignment-item student-assignment-item--skeleton" key={item} aria-hidden="true">
                <div className="student-assignment-item__meta">
                  <span className="student-page-skeleton student-assignment-item__skeleton-icon" />
                  <div>
                    <span className="student-page-skeleton student-assignment-item__skeleton-title" />
                    <span className="student-page-skeleton student-assignment-item__skeleton-course" />
                  </div>
                </div>
                <span className="student-page-skeleton student-assignment-item__skeleton-due" />
                <span className="student-page-skeleton student-assignment-item__skeleton-status" />
                <span className="student-page-skeleton student-assignment-item__skeleton-score" />
                <span className="student-page-skeleton student-assignment-item__skeleton-action" />
              </article>
            ))
          ) : !hasAssignmentData ? null : visibleAssignments.length === 0 ? (
            <p className="student-assignments__empty">
              {assignments.length === 0
                ? 'Assignments from your enrolled courses will appear here.'
                : 'No assignments match these filters.'}
            </p>
          ) : visibleAssignments.map((entry) => {
            const { assignment, submission, status } = entry
            const rejected = submission?.reviewStatus === 'rejected'
            const hasMarks = submission?.marksObtained !== null
              && submission?.marksObtained !== undefined
              && Number.isFinite(Number(submission.marksObtained))
            const statusLabel = rejected ? 'Rejected' : status === 'graded' ? 'Approved' : status === 'submitted' ? 'Submitted' : 'Pending'
            const actionLabel = rejected ? 'Resubmit' : status === 'graded' ? 'View Details' : status === 'submitted' ? 'View Submission' : 'View & Submit'
            return (
              <article className="student-assignment-item" key={entry.key}>
                <div className="student-assignment-item__meta">
                  <span className="student-assignment-item__icon"><Icon name="book" size={16} /></span>
                  <div>
                    <h2>{assignment.title || 'Assignment'}</h2>
                    <p>{entry.courseName}</p>
                  </div>
                </div>
                <div className="student-assignment-item__due">
                  <Icon name="clock" size={14} />
                  <span>{assignment.dueDate ? `Due: ${formatResultDate(assignment.dueDate)}` : 'No due date'}</span>
                </div>
                <span className={`student-assignment-item__status is-${rejected ? 'rejected' : status === 'graded' ? 'graded' : status}`}>
                  {statusLabel}
                </span>
                {status === 'graded' && hasMarks ? (
                  <span className="student-assignment-item__score">
                    Score: {submission.marksObtained} / {assignment.points ?? assignment.maximumMarks ?? '—'}
                  </span>
                ) : <span className="student-assignment-item__score-placeholder" aria-hidden="true" />}
                <button
                  type="button"
                  className={`student-assignment-item__action${status === 'pending' ? ' student-assignment-item__action--primary' : ''}`}
                  onClick={() => setActiveAssignmentKey(entry.key)}
                >
                  {actionLabel} <span aria-hidden="true">›</span>
                </button>
              </article>
            )
          })}
        </div>
      </div>

      {activeAssignment && (
        <StudentAssignmentDetail
          entry={activeAssignment}
          onClose={() => setActiveAssignmentKey('')}
          onLogout={onLogout}
          onSubmitted={(submission) => updateSubmission(activeAssignment.key, submission)}
          onLearningDataChanged={onLearningDataChanged}
        />
      )}
    </StudentRoutePage>
  )
}

function getAttemptScore(attempt) {
  const score = attempt.scorePercentage
  if (score !== null && score !== undefined && Number.isFinite(Number(score))) return Number(score)
  const totalPoints = Number(attempt.totalPoints)
  const earnedPoints = attempt.earnedPoints === null || attempt.earnedPoints === undefined
    ? Number.NaN
    : Number(attempt.earnedPoints)
  return Number.isFinite(totalPoints) && totalPoints > 0 && Number.isFinite(earnedPoints)
    ? (earnedPoints / totalPoints) * 100
    : null
}

function formatResultDate(value) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    : '—'
}

function getCachedStudentResults() {
  const cacheKey = getStudentPageCacheKey()
  if (!cacheKey) return null
  const cachedResults = studentResultsCache.get(cacheKey)
  if (cachedResults) return { ...cachedResults, hasCertificatesData: true }

  const enrollments = getCachedStudentPageEnrollments()
  if (!enrollments) return null
  const courseResults = [...getLatestEnrollmentsByCourse(enrollments).keys()].map((courseId) => {
    const content = getCachedStudentPageCourseContent(courseId)
    return content
      ? {
        courseId,
        enrollment: content.enrollment,
        course: content.enrollment.courseId,
        quizAttempts: content.quizAttempts,
        assignmentSubmissions: content.assignmentSubmissions,
      }
      : null
  })
  if (courseResults.some((result) => result === null)) return null
  const certificateCache = studentCertificateCache.get(cacheKey)
  return {
    courseResults,
    certificates: certificateCache?.certificates || [],
    hasCertificatesData: Boolean(certificateCache),
  }
}

function StudentResultsTableSkeleton() {
  return (
    <div className="student-results__table-wrap student-results__skeleton-wrap" role="status" aria-label="Loading results" aria-busy="true">
      <table className="student-results__table" aria-hidden="true">
        <thead><tr>{[0, 1, 2, 3, 4, 5].map((cell) => <th key={cell}><span className="student-page-skeleton student-results__skeleton-heading" /></th>)}</tr></thead>
        <tbody>{[0, 1, 2].map((row) => (
          <tr key={row}>{[0, 1, 2, 3, 4, 5].map((cell) => (
            <td key={cell}><span className={`student-page-skeleton student-results__skeleton-cell is-cell-${cell}`} /></td>
          ))}</tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function StudentResultsPage({ onLogout }) {
  const navigate = useNavigate()
  const [progressRefresh, setProgressRefresh] = useState(0)
  const [initialResults] = useState(getCachedStudentResults)
  const [courseResults, setCourseResults] = useState(initialResults?.courseResults || [])
  const [certificates, setCertificates] = useState(initialResults?.certificates || [])
  const [hasResultsData, setHasResultsData] = useState(initialResults !== null)
  const [hasCertificatesData, setHasCertificatesData] = useState(initialResults?.hasCertificatesData === true)
  const [activeTab, setActiveTab] = useState('courses')
  const [selectedCourseId, setSelectedCourseId] = useState('all')
  const [loading, setLoading] = useState(initialResults === null)
  const [certificatesLoading, setCertificatesLoading] = useState(initialResults?.hasCertificatesData !== true)
  const [error, setError] = useState('')

  useEffect(() => {
    const refreshProgress = () => {
      invalidateStudentLearningPageCaches()
      setProgressRefresh((refresh) => refresh + 1)
    }
    window.addEventListener(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT, refreshProgress)
    return () => window.removeEventListener(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT, refreshProgress)
  }, [])

  useEffect(() => {
    let active = true
    async function loadResults() {
      setError('')
      try {
        const enrollments = await fetchStudentPageEnrollments(onLogout)
        const latestEnrollments = getLatestEnrollmentsByCourse(enrollments)
        const [loadedCourseResults, loadedCertificates] = await Promise.all([
          Promise.all([...latestEnrollments.keys()].map(async (courseId) => {
            const result = await fetchStudentCourseContent(courseId, onLogout)
            return {
              courseId,
              enrollment: result.enrollment,
              course: result.enrollment.courseId,
              quizAttempts: result.quizAttempts,
              assignmentSubmissions: result.assignmentSubmissions,
            }
          })),
          fetchStudentPageCertificates(onLogout),
        ])
        if (!active) return
        setCourseResults(loadedCourseResults)
        setCertificates(loadedCertificates)
        setHasResultsData(true)
        setHasCertificatesData(true)
        const cacheKey = getStudentPageCacheKey()
        if (cacheKey) {
          studentResultsCache.set(cacheKey, {
            courseResults: loadedCourseResults,
            certificates: loadedCertificates,
          })
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Grades and results could not be loaded.')
        }
      } finally {
        if (active) {
          setLoading(false)
          setCertificatesLoading(false)
        }
      }
    }
    void loadResults()
    return () => { active = false }
  }, [onLogout, progressRefresh])

  const courseRows = courseResults.map((result) => {
    const lessonEntries = getCourseLessons(result.course)
    const completedLessonIds = new Set((result.enrollment.completedLessonIds || []).map(String))
    const completedLessons = lessonEntries.filter(({ lesson }) => completedLessonIds.has(String(lesson._id))).length
    const activityProgress = getCourseProgress(result.enrollment)
    const progress = activityProgress.percentage
    const submittedQuizzes = result.quizAttempts.filter((attempt) => attempt.status === 'submitted')
    const scores = submittedQuizzes.map(getAttemptScore).filter((score) => score !== null)
    const averageScore = scores.length
      ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
      : null
    const lastAttempt = [
      ...submittedQuizzes.map((attempt) => attempt.submittedAt || attempt.createdAt),
      ...result.assignmentSubmissions.map((submission) => submission.submittedAt),
    ].filter(Boolean).sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0]
    return {
      ...result,
      completedLessons,
      lessonCount: lessonEntries.length,
      completedActivityCount: activityProgress.completedCount,
      totalActivityCount: activityProgress.totalCount,
      progress,
      status: progress >= 100 ? 'completed' : progress > 0 ? 'in-progress' : 'not-started',
      submittedQuizzes,
      averageScore,
      lastAttempt,
    }
  })
  const allQuizAttempts = courseRows.flatMap((course) => course.submittedQuizzes.map((attempt) => ({
    ...attempt,
    courseId: course.courseId,
    courseName: course.course.title || 'Course',
    quizTitle: getCourseQuizTitle(course.course, attempt.quizId),
    score: getAttemptScore(attempt),
  }))).sort((left, right) => new Date(right.submittedAt || right.createdAt).getTime()
    - new Date(left.submittedAt || left.createdAt).getTime())
  const allAssignments = courseRows.flatMap((course) => course.assignmentSubmissions.map((submission) => ({
    ...submission,
    courseId: course.courseId,
    courseName: course.course.title || 'Course',
    assignmentTitle: getCourseAssignmentTitle(course.course, submission.assignmentId),
  }))).sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())
  const scoredAttempts = allQuizAttempts.filter((attempt) => attempt.score !== null)
  const averageScore = scoredAttempts.length
    ? Math.round(scoredAttempts.reduce((total, attempt) => total + attempt.score, 0) / scoredAttempts.length)
    : null
  const totalActivities = courseRows.reduce((total, course) => total + course.totalActivityCount, 0)
  const completedActivities = courseRows.reduce((total, course) => total + course.completedActivityCount, 0)
  const overallProgress = totalActivities ? Math.round((completedActivities / totalActivities) * 100) : 0
  const completedCourseCount = courseRows.filter((course) => course.status === 'completed').length
  const inProgressCourseCount = courseRows.filter((course) => course.status === 'in-progress').length
  const notStartedCourseCount = courseRows.filter((course) => course.status === 'not-started').length
  const earnedCertificates = certificates.filter((entry) => entry.certificate)
  const visibleCourses = selectedCourseId === 'all'
    ? courseRows
    : courseRows.filter((course) => course.courseId === selectedCourseId)
  const recentAttempts = allQuizAttempts.slice(0, 3)

  function openCourse(courseId) {
    navigate(`/student/course/${encodeURIComponent(courseId)}/learn`)
  }

  return (
    <section className="student-results">
      <header className="student-results__hero">
        <div className="student-results__heading">
          <span className="student-results__hero-icon"><Icon name="award" size={27} /></span>
          <div>
            <h1>Your Grades &amp; Results</h1>
            <p>Track your performance and view your results</p>
          </div>
        </div>
        <label className="student-results__filter">
          <span className="sr-only">Filter results by course</span>
          <select value={selectedCourseId} onChange={(event) => setSelectedCourseId(event.target.value)}>
            <option value="all">All Courses</option>
            {courseRows.map((course) => <option key={course.courseId} value={course.courseId}>{course.course.title}</option>)}
          </select>
        </label>
      </header>

      <section className="student-results__summary" aria-label="Learning results summary">
        <button className="student-results__summary-card is-blue" type="button" onClick={() => navigate('/student/courses')}>
          <span className="student-results__summary-icon"><Icon name="bookOpen" size={25} /></span>
          <span><strong>{hasResultsData ? courseRows.length : loading ? <span className="student-page-skeleton student-results__summary-skeleton" /> : '—'}</strong><small>Enrolled Courses</small></span>
        </button>
        <article className="student-results__summary-card is-green">
          <span className="student-results__summary-icon"><Icon name="check" size={23} /></span>
          <span>
            <strong>{hasResultsData ? `${overallProgress}%` : loading ? <span className="student-page-skeleton student-results__summary-skeleton" /> : '—'}</strong>
            <small>Overall Progress</small>
            <i>{hasResultsData || loading
              ? <b className={!hasResultsData ? 'student-page-skeleton' : ''} style={{ width: hasResultsData ? `${overallProgress}%` : '100%' }} />
              : null}</i>
          </span>
        </article>
        <article className="student-results__summary-card is-purple">
          <span className="student-results__summary-icon"><Icon name="spark" size={23} /></span>
          <span><strong>{hasResultsData ? (averageScore === null ? '—' : `${averageScore}%`) : loading ? <span className="student-page-skeleton student-results__summary-skeleton" /> : '—'}</strong><small>Average Score</small></span>
        </article>
        <button className="student-results__summary-card is-orange" type="button" onClick={() => navigate('/student/certificates')}>
          <span className="student-results__summary-icon"><Icon name="award" size={25} /></span>
          <span><strong>{hasCertificatesData ? earnedCertificates.length : certificatesLoading ? <span className="student-page-skeleton student-results__summary-skeleton" /> : '—'}</strong><small>Certificates Earned</small></span>
        </button>
      </section>

      <section className="student-results__content">
        <nav className="student-results__tabs" aria-label="Results categories">
          {[
            ['courses', 'Course Results'],
            ['assignments', 'Assignments'],
            ['quizzes', 'Quizzes'],
            ['certificates', 'Certificates'],
          ].map(([tab, label]) => (
            <button
              key={tab}
              className={activeTab === tab ? 'is-active' : ''}
              type="button"
              aria-current={activeTab === tab ? 'page' : undefined}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </nav>
        {error && <p className="student-results__error" role="alert">{error}</p>}
        {loading && !hasResultsData ? <StudentResultsTableSkeleton /> : hasResultsData ? (
          <div className="student-results__table-wrap">
            {activeTab === 'courses' && (
              visibleCourses.length
                ? <table className="student-results__table">
                    <thead><tr><th>Course</th><th>Progress</th><th>Average Score</th><th>Status</th><th>Last Attempt</th><th><span className="sr-only">Course actions</span></th></tr></thead>
                    <tbody>{visibleCourses.map((course) => (
                      <tr key={course.courseId}>
                        <td>
                          <div className="student-results__course">
                            <span className="student-results__course-art">
                              {course.course.thumbnailUrl
                                ? <img src={course.course.thumbnailUrl} alt="" />
                                : <Icon name="bookOpen" size={21} />}
                            </span>
                            <button type="button" onClick={() => openCourse(course.courseId)}>{course.course.title || 'Course'}</button>
                          </div>
                        </td>
                        <td>
                          <div className="student-results__progress">
                            <span>
                              <small>{course.progress}%</small>
                              <small>{course.completedActivityCount} of {course.totalActivityCount} activities</small>
                            </span>
                            <i><b className={course.status === 'completed' ? 'is-completed' : ''} style={{ width: `${course.progress}%` }} /></i>
                          </div>
                        </td>
                        <td><strong className="student-results__score">{course.averageScore === null ? '—' : `${course.averageScore}%`}</strong></td>
                        <td><span className={`student-results__status is-${course.status}`}><Icon name={course.status === 'completed' ? 'check' : 'clock'} size={14} />{course.status === 'completed' ? 'Completed' : course.status === 'not-started' ? 'Not Started' : 'In Progress'}</span></td>
                        <td>{formatResultDate(course.lastAttempt)}</td>
                        <td><button className="student-results__details" type="button" onClick={() => openCourse(course.courseId)}>View Details <Icon name="arrow" size={15} /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                : <p className="student-results__empty">No enrolled courses to show yet.</p>
            )}
            {activeTab === 'assignments' && (
              allAssignments.length
                ? <table className="student-results__table">
                    <thead><tr><th>Assignment</th><th>Course</th><th>Status</th><th>Submitted</th><th /></tr></thead>
                    <tbody>{allAssignments.map((assignment) => (
                      <tr key={assignment._id}>
                        <td>{assignment.assignmentTitle}</td>
                        <td>{assignment.courseName}</td>
                        <td><span className={`student-results__status is-${assignment.reviewStatus === 'approved' ? 'completed' : assignment.reviewStatus === 'rejected' ? 'not-started' : 'in-progress'}`}>{assignment.reviewStatus === 'approved' ? 'Approved' : assignment.reviewStatus === 'rejected' ? 'Changes Requested' : 'In Review'}</span></td>
                        <td>{formatResultDate(assignment.submittedAt)}</td>
                        <td><button className="student-results__details" type="button" onClick={() => openCourse(assignment.courseId)}>Open Course <Icon name="arrow" size={15} /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                : <p className="student-results__empty">Assignment submissions will appear here when you submit work.</p>
            )}
            {activeTab === 'quizzes' && (
              allQuizAttempts.length
                ? <table className="student-results__table">
                    <thead><tr><th>Quiz</th><th>Course</th><th>Score</th><th>Status</th><th>Attempt Date</th><th /></tr></thead>
                    <tbody>{allQuizAttempts.map((attempt) => (
                      <tr key={attempt._id}>
                        <td>{attempt.quizTitle}</td>
                        <td>{attempt.courseName}</td>
                        <td>{attempt.score === null ? '—' : `${Math.round(attempt.score)}%`}</td>
                        <td><span className={`student-results__status is-${attempt.passed ? 'completed' : 'in-progress'}`}>{attempt.passed ? 'Passed' : 'Failed'}</span></td>
                        <td>{formatResultDate(attempt.submittedAt || attempt.createdAt)}</td>
                        <td><button className="student-results__details" type="button" onClick={() => openCourse(attempt.courseId)}>Open Course <Icon name="arrow" size={15} /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                : <p className="student-results__empty">Quiz attempts will appear here after you complete a quiz.</p>
            )}
            {activeTab === 'certificates' && (
              !hasCertificatesData
                ? certificatesLoading
                  ? <StudentResultsTableSkeleton />
                  : <p className="student-results__empty">Certificate data is unavailable.</p>
                : earnedCertificates.length
                ? <div className="student-results__certificates">
                    {earnedCertificates.map((entry) => (
                      <button key={entry.courseId} type="button" onClick={() => navigate('/student/certificates')}>
                        <span className="student-results__certificate-icon"><Icon name="award" size={21} /></span>
                        <span><strong>{entry.courseName}</strong><small>Certificate earned · {formatResultDate(entry.certificate.completedAt)}</small></span>
                        <Icon name="arrow" size={17} />
                      </button>
                    ))}
                  </div>
                : <p className="student-results__empty">Earned certificates will appear here.</p>
            )}
          </div>
        ) : null}
      </section>

      <div className="student-results__lower">
        <section className="student-results__panel" aria-labelledby="student-results-performance-title">
          <h2 id="student-results-performance-title"><Icon name="chart" size={17} />Performance Overview</h2>
          <div className="student-results__performance">
            <div
              className={`student-results__donut${hasResultsData ? '' : ' is-loading'}`}
              role="img"
              aria-label={hasResultsData ? `${overallProgress}% overall progress` : loading ? 'Overall progress loading' : 'Overall progress unavailable'}
              style={{ '--student-results-progress': `${overallProgress}%` }}
            >
              <span>
                <strong>{hasResultsData ? `${overallProgress}%` : loading ? <span className="student-page-skeleton student-results__summary-skeleton" /> : '—'}</strong>
                <small>Overall Progress</small>
              </span>
            </div>
            <ul>
              <li><i className="is-completed" />Completed<strong>{hasResultsData ? completedCourseCount : loading ? <span className="student-page-skeleton student-results__metric-skeleton" /> : '—'}</strong></li>
              <li><i className="is-progress" />In Progress<strong>{hasResultsData ? inProgressCourseCount : loading ? <span className="student-page-skeleton student-results__metric-skeleton" /> : '—'}</strong></li>
              <li><i className="is-not-started" />Not Started<strong>{hasResultsData ? notStartedCourseCount : loading ? <span className="student-page-skeleton student-results__metric-skeleton" /> : '—'}</strong></li>
            </ul>
          </div>
        </section>
        <section className="student-results__panel" aria-labelledby="student-results-recent-title">
          <h2 id="student-results-recent-title"><Icon name="spark" size={17} />Recent Results</h2>
          <button className="student-results__view-all" type="button" onClick={() => setActiveTab('quizzes')}>View All <Icon name="arrow" size={14} /></button>
          {loading && !hasResultsData
            ? <ul className="student-results__recent student-results__recent--skeleton" aria-hidden="true">
                {[0, 1, 2].map((item) => (
                  <li key={item}>
                    <span className="student-page-skeleton student-results__recent-skeleton-icon" />
                    <span className="student-results__recent-copy">
                      <span className="student-page-skeleton student-results__recent-skeleton-copy" />
                      <span className="student-page-skeleton student-results__recent-skeleton-copy is-short" />
                    </span>
                    <span className="student-page-skeleton student-results__recent-skeleton-score" />
                    <span className="student-page-skeleton student-results__recent-skeleton-date" />
                  </li>
                ))}
              </ul>
            : !hasResultsData
              ? <p className="student-results__empty">Results are unavailable.</p>
              : recentAttempts.length
            ? <ul className="student-results__recent">
                {recentAttempts.map((attempt) => (
                  <li key={attempt._id}>
                    <span className="student-results__recent-icon"><Icon name="check" size={13} /></span>
                    <span className="student-results__recent-copy"><strong>Quiz · {attempt.courseName}</strong><small>{attempt.quizTitle}</small></span>
                    <span className="student-results__recent-score">{attempt.score === null ? 'Submitted' : `Score: ${Math.round(attempt.score)}%`}</span>
                    <time>{formatResultDate(attempt.submittedAt || attempt.createdAt)}</time>
                  </li>
                ))}
              </ul>
            : <p className="student-results__empty">Your recent quiz results will appear here.</p>}
        </section>
      </div>
    </section>
  )
}

async function fetchPublishedCourses(onLogout, signal) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (typeof auth?.token !== 'string') {
    onLogout()
    throw new Error('Your session has ended. Please sign in again.')
  }
  const response = await fetchWithAuth(`${API_BASE_URL}/courses`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    signal,
  }, API_BASE_URL, auth.token)
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
    return count + getModuleVideoLessons(module).length
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

function isValidLessonId(value) {
  return /^[a-f\d]{24}$/i.test(String(value || ''))
}

function getVideoCompletionDuration(video) {
  const duration = Number(video?.duration)
  if (Number.isFinite(duration) && duration > 0) return duration

  if (video?.seekable?.length) {
    const seekableEnd = Number(video.seekable.end(video.seekable.length - 1))
    if (Number.isFinite(seekableEnd) && seekableEnd > 0) return seekableEnd
  }

  return 0
}

function getCourseLessons(course) {
  const modules = (course?.modules || [])
    .map((module, index) => ({ module, index }))
    .sort((left, right) => (left.module.order ?? left.index) - (right.module.order ?? right.index))
  return modules.flatMap(({ module, index: moduleIndex }) => {
    const lessons = getModuleVideoLessons(module)
    return lessons.map((lesson, lessonIndex) => ({
      module,
      lesson,
      moduleKey: String(module._id || `${module.title}-${moduleIndex}`),
      lessonKey: String(lesson._id || `${moduleIndex}-${lessonIndex}`),
    }))
  })
}

function getModuleVideoLessons(module) {
  const contentItems = (module.contentItems || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === 'video-lesson')
    .sort((left, right) => (left.item.order ?? left.index) - (right.item.order ?? right.index))
    .map(({ item }) => item)
  return contentItems.length ? contentItems : module.lessons || []
}

function createEmptyAttentionSession(lessonId = '') {
  return {
    lessonId,
    sessionId: '',
    schedule: [],
    nextIndex: 0,
    pending: false,
    blocked: false,
    initialized: false,
    pendingDetails: null,
    lastVideoPositionSeconds: 0,
    durationSeconds: 0,
    videoUrl: '',
    questionsDuringVideo: 0,
    minIntervalSeconds: 0,
    maxIntervalSeconds: 0,
  }
}

function getCourseProgress(enrollment) {
  const progress = enrollment.courseProgress
  const activityGroups = ['videos', 'quizzes', 'assignments'].map((type) => ({
    completed: Math.max(0, Math.floor(Number(progress?.[type]?.completed) || 0)),
    total: Math.max(0, Math.floor(Number(progress?.[type]?.total) || 0)),
  }))
  const activityCompletedCount = activityGroups.reduce((total, group) => total + group.completed, 0)
  const activityTotalCount = activityGroups.reduce((total, group) => total + group.total, 0)
  const hasReportedTotalCount = Number.isSafeInteger(Number(progress?.totalActivities))
    && Number(progress.totalActivities) >= 0
  const hasReportedCompletedCount = Number.isSafeInteger(Number(progress?.completedActivities))
    && Number(progress.completedActivities) >= 0
  const totalCount = hasReportedTotalCount
    ? Number(progress.totalActivities)
    : activityTotalCount
  const completedCount = Math.min(
    totalCount,
    hasReportedCompletedCount ? Number(progress.completedActivities) : activityCompletedCount,
  )
  const isComplete = totalCount > 0 && completedCount === totalCount
  const percentage = isComplete
    ? 100
    : totalCount
      ? Math.min(99, Math.floor((completedCount / totalCount) * 100))
      : 0
  return {
    completedCount,
    totalCount,
    percentage,
  }
}

function getModuleLearningItems(module, moduleIndex) {
  const moduleKey = String(module._id || `${module.title}-${moduleIndex}`)
  const orderedContentItems = module.contentItems?.length
    ? module.contentItems
      .map((item, index) => ({ item, index }))
      .sort((left, right) => (left.item.order ?? left.index) - (right.item.order ?? right.index))
    : []
  const legacyVideoItems = orderedContentItems.length
    && !orderedContentItems.some(({ item }) => item.type === 'video-lesson')
    ? (module.lessons || []).map((lesson, index) => ({
      ...lesson,
      type: 'video-lesson',
      _learningKey: String(lesson._id || `${moduleKey}-lesson-${index}`),
      _moduleKey: moduleKey,
    }))
    : []
  const contentItems = orderedContentItems.length
    ? [
      ...legacyVideoItems,
      ...orderedContentItems.map(({ item, index }) => ({
        ...item,
        _learningKey: String(item._id || `${moduleKey}-item-${index}`),
        _moduleKey: moduleKey,
      })),
    ]
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

function StudentAssignmentPanel({ courseId, enrollmentId, assignment, submissions, onSubmitted, onLearningDataChanged, onLogout, showHeader = true, canSubmit = true }) {
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [filePreviewUrl, setFilePreviewUrl] = useState('')
  const fileInputRef = useRef(null)
  const assignmentSubmissions = submissions.filter((submission) => (
    String(submission.assignmentId) === String(assignment._id)
  ))
  const latestSubmission = assignmentSubmissions
    .slice()
    .sort((left, right) => new Date(right.submittedAt || 0).getTime() - new Date(left.submittedAt || 0).getTime())[0]

  useEffect(() => {
    if (!file) {
      setFilePreviewUrl('')
      return undefined
    }
    const previewUrl = URL.createObjectURL(file)
    setFilePreviewUrl(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [file])

  function chooseAssignmentFile(candidate) {
    if (!candidate) return
    const extension = candidate.name.slice(candidate.name.lastIndexOf('.')).toLowerCase()
    if (!['.pdf', '.docx', '.txt'].includes(extension)) {
      setError('Choose a PDF, DOCX, or TXT file.')
      return
    }
    if (!candidate.size || candidate.size > 10 * 1024 * 1024) {
      setError('Choose a file that is smaller than 10 MB.')
      return
    }
    setError('')
    setFile(candidate)
  }

  function formatFileSize(bytes) {
    return bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  function getSubmissionStatusLabel(submission) {
    if (submission.reviewStatus === 'approved') return 'Approved'
    if (submission.reviewStatus === 'rejected') return 'Rejected — resubmission required'
    return 'Awaiting Admin Review'
  }

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
      const response = await fetchWithAuth(`${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignment._id)}/submissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}` },
        body: formData,
      }, API_BASE_URL, auth.token)
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
    <section className={`student-course-activity${showHeader ? ' student-course-assignment-view' : ''}`}>
      {showHeader && (
        <header className="student-course-assignment-view__header">
          <span className="student-course-assignment-view__icon"><Icon name="clipboardCheck" size={20} /></span>
          <h2>{assignment.title}</h2>
          <span className="student-course-assignment-view__badge"><Icon name="clipboardCheck" size={13} />Assignment</span>
          {latestSubmission && (
            <span className={`student-course-assignment-view__status is-${latestSubmission.reviewStatus || 'pending'}`}>
              {getSubmissionStatusLabel(latestSubmission)}
            </span>
          )}
        </header>
      )}
      {assignment.description && <p className="student-course-activity__instructions">{assignment.description}</p>}
      {showHeader ? (
        <div className="student-course-activity__details student-course-assignment-view__details">
          <span>
            <Icon name="clock" size={19} />
            <span><small>Due Date</small><strong>{assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No due date'}</strong></span>
          </span>
          <span>
            <Icon name="award" size={20} />
            <span><small>Total Points</small><strong>{Number(assignment.points) || 0} points</strong></span>
          </span>
        </div>
      ) : (
        <div className="student-course-activity__details">
          <span>Due {assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No due date'}</span>
          <span>{Number(assignment.points) || 0} points</span>
        </div>
      )}
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      {canSubmit && (
        <form className={`student-assignment-submit${showHeader ? ' student-assignment-submit--card' : ''}`} onSubmit={submitAssignment}>
          {showHeader && (
            <div className="student-assignment-submit__heading">
              <span className="student-assignment-submit__upload-icon"><Icon name="file" size={20} /></span>
              <span><strong>Upload your work</strong><small>Upload a PDF, DOCX, or TXT file (max 10 MB)</small></span>
            </div>
          )}
          {showHeader ? (
            <label
              className={`student-assignment-submit__dropzone${isDragging ? ' is-dragging' : ''}${file ? ' has-file' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setIsDragging(false)
                chooseAssignmentFile(event.dataTransfer.files?.[0])
              }}
            >
              <input
                ref={fileInputRef}
                className="student-assignment-submit__file-input"
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={(event) => chooseAssignmentFile(event.currentTarget.files?.[0])}
              />
              <Icon name="file" size={32} />
              <span>Drag and drop your file here</span>
              <small>or</small>
              <span className="student-assignment-submit__choose">Choose File</span>
            </label>
          ) : (
            <label>
              <span>Upload your work (PDF, DOCX, or TXT · max 10 MB)</span>
              <input
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={(event) => chooseAssignmentFile(event.currentTarget.files?.[0])}
              />
            </label>
          )}
          {showHeader && file && (
            <div className="student-assignment-submit__uploaded">
              <span className="student-assignment-submit__file-icon"><Icon name="file" size={17} /></span>
              <span className="student-assignment-submit__file-name"><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span>
              <a href={filePreviewUrl || undefined} target="_blank" rel="noreferrer">View</a>
              <button
                type="button"
                onClick={() => {
                  setFile(null)
                  setError('')
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              >
                Remove
              </button>
            </div>
          )}
          <button
            className={`student-button${showHeader ? ' student-assignment-submit__submit' : ''}`}
            type="submit"
            disabled={submitting || !assignment._id || (showHeader && !file)}
          >
            {submitting ? 'Submitting…' : showHeader ? <>Submit assignment <Icon name="arrow" size={15} /></> : 'Submit assignment'}
          </button>
        </form>
      )}
      {showHeader && latestSubmission && (
        <div className="student-assignment-submit__review">
          <strong>{getSubmissionStatusLabel(latestSubmission)}</strong>
          {latestSubmission.reviewStatus === 'approved' && latestSubmission.marksObtained !== null && latestSubmission.marksObtained !== undefined && (
            <span>Score: {latestSubmission.marksObtained} / {assignment.points ?? assignment.maximumMarks ?? '—'}</span>
          )}
          {(latestSubmission.reviewComment || latestSubmission.feedback) && (
            <p>{latestSubmission.reviewComment || latestSubmission.feedback}</p>
          )}
        </div>
      )}
      {assignmentSubmissions.length > 0 && (
        <div className="student-assignment-submissions">
          <h3>Submissions</h3>
          {assignmentSubmissions.map((submission) => (
            <a className={showHeader ? 'student-assignment-submissions__file' : undefined} key={submission._id} href={`${API_BASE_URL}/assignment-submissions/${encodeURIComponent(submission._id)}/download`} onClick={async (event) => {
              event.preventDefault()
              try {
                const savedAuth = sessionStorage.getItem('lms.auth')
                const auth = savedAuth ? JSON.parse(savedAuth) : null
                if (typeof auth?.token !== 'string') {
                  onLogout()
                  return
                }
                const response = await fetchWithAuth(event.currentTarget.href, {
                  headers: { Authorization: `Bearer ${auth.token}` },
                }, API_BASE_URL, auth.token)
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
              {showHeader ? (
                <>
                  <span className="student-assignment-submit__file-icon"><Icon name="file" size={17} /></span>
                  <span className="student-assignment-submit__file-name"><strong>{submission.fileName}</strong><small>Submitted {new Date(submission.submittedAt).toLocaleString()}</small></span>
                  <span>View</span>
                </>
              ) : `${submission.fileName} · Submitted ${new Date(submission.submittedAt).toLocaleString()}`}
            </a>
          ))}
        </div>
      )}
    </section>
  )
}

function StudentAssignmentDetail({ entry, onClose, onLogout, onSubmitted, onLearningDataChanged }) {
  const { assignment, submission, status } = entry
  const isRejected = submission?.reviewStatus === 'rejected'
  const feedback = submission?.reviewComment || submission?.feedback
  const hasScore = submission?.marksObtained !== null
    && submission?.marksObtained !== undefined
    && Number.isFinite(Number(submission.marksObtained))
  const maximumMarks = assignment.points ?? assignment.maximumMarks

  return (
    <div className="student-assignment-dialog" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="student-assignment-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="student-assignment-dialog-title">
        <header className="student-assignment-dialog__header">
          <div>
            <span className="student-assignments__eyebrow">{entry.courseName}</span>
            <h2 id="student-assignment-dialog-title">{assignment.title || 'Assignment'}</h2>
          </div>
          <button type="button" className="student-assignment-dialog__close" onClick={onClose} aria-label="Close assignment details">×</button>
        </header>
        {submission && (
          <div className={`student-assignment-dialog__review is-${isRejected ? 'rejected' : status}`}>
            <strong>{isRejected ? 'Rejected — resubmission required' : status === 'graded' ? 'Approved' : 'Awaiting Admin Review'}</strong>
            {hasScore && status === 'graded' && (
              <span>Score: {submission.marksObtained}{maximumMarks !== undefined ? ` / ${maximumMarks}` : ''}</span>
            )}
            {feedback && <p>{feedback}</p>}
          </div>
        )}
        <StudentAssignmentPanel
          courseId={entry.courseId}
          enrollmentId={entry.enrollmentId}
          assignment={assignment}
          submissions={submission ? [submission] : []}
          onSubmitted={onSubmitted}
          onLearningDataChanged={onLearningDataChanged}
          onLogout={onLogout}
          showHeader={false}
          canSubmit={status === 'pending'}
        />
      </section>
    </div>
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
          <div className="student-enrolled-course__statuses">
            <span className="student-available-course__status">
              {course.status === 'published' ? 'Published' : 'Enrolled'}
            </span>
            {enrollment.status === 'completed' && (
              <span className="student-enrolled-course__completed">Completed</span>
            )}
          </div>
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
            <strong>{completedCount} of {totalCount} activities · {percentage}%</strong>
          </div>
          <div className="student-enrolled-course__progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percentage} aria-label={`${course.title} progress`}>
            <span style={{ width: `${percentage}%` }} />
          </div>
        </div>
        <div className="student-enrolled-course__actions">
          <Link
            className="student-enrolled-course__continue"
            to={coursePath}
            onClick={() => seedStudentCourseLearning(enrollment)}
          >
            Continue Learning
            <Icon name="arrow" size={16} />
          </Link>
        </div>
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

function EnrollmentCourseSkeletons() {
  return (
    <div className="student-enrolled-courses student-enrolled-courses--skeleton" role="status" aria-label="Loading courses" aria-busy="true">
      {[0, 1].map((item) => (
        <article className="student-enrolled-course" key={item} aria-hidden="true">
          <span className="student-page-skeleton student-enrolled-course__skeleton-image" />
          <div className="student-enrolled-course__body student-enrolled-course__skeleton-body">
            <span className="student-page-skeleton student-enrolled-course__skeleton-title" />
            <span className="student-page-skeleton student-enrolled-course__skeleton-line" />
            <span className="student-page-skeleton student-enrolled-course__skeleton-line is-short" />
            <span className="student-page-skeleton student-enrolled-course__skeleton-progress" />
          </div>
        </article>
      ))}
    </div>
  )
}

function StudentDashboardCourses({ onLogout, selectedCategory }) {
  const [progressRefresh, setProgressRefresh] = useState(0)
  const [initialEnrollments] = useState(getCachedStudentPageEnrollments)
  const [enrollments, setEnrollments] = useState(initialEnrollments || [])
  const [loading, setLoading] = useState(initialEnrollments === null)
  const [error, setError] = useState('')
  const [averageScores, setAverageScores] = useState({})
  const [scoresLoading, setScoresLoading] = useState(false)
  const [scoreError, setScoreError] = useState('')

  useEffect(() => {
    const refreshProgress = () => {
      invalidateStudentLearningPageCaches()
      setProgressRefresh((refresh) => refresh + 1)
    }
    window.addEventListener(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT, refreshProgress)
    return () => window.removeEventListener(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT, refreshProgress)
  }, [])

  useEffect(() => {
    let active = true
    fetchStudentPageEnrollments(onLogout)
      .then((loadedEnrollments) => {
        if (!active) return
        const cacheKey = getStudentPageCacheKey()
        if (cacheKey) studentEnrollmentCache.set(cacheKey, { enrollments: loadedEnrollments, savedAt: Date.now() })
        setEnrollments(loadedEnrollments)
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Your courses could not be loaded.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onLogout, progressRefresh])

  const categoryEnrollments = selectedCategory
    ? enrollments.filter((entry) => (
      typeof entry.courseId === 'object'
      && entry.courseId
      && filterCoursesByCategory([entry.courseId], selectedCategory).length > 0
    ))
    : enrollments.slice(0, 3)

  const scoreCourseIds = [...new Set(categoryEnrollments
    .filter((entry) => entry.courseId && typeof entry.courseId === 'object' && entry.courseId._id)
    .map((entry) => String(entry.courseId._id)))]
  const scoreCourseIdsKey = scoreCourseIds.join('|')

  useEffect(() => {
    let active = true
    if (!scoreCourseIdsKey) {
      setAverageScores({})
      setScoreError('')
      setScoresLoading(false)
      return () => { active = false }
    }

    setScoresLoading(true)
    setScoreError('')
    const courseIds = scoreCourseIdsKey.split('|')
    Promise.allSettled(courseIds.map(async (courseId) => {
      const result = await fetchStudentPageCourseContent(courseId, onLogout)
      return getStudentAverageQuizScore(result.quizAttempts)
    }))
      .then((results) => {
        if (!active) return
        const nextScores = {}
        let failed = false
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') nextScores[courseIds[index]] = result.value
          else failed = true
        })
        setAverageScores(nextScores)
        if (failed) setScoreError('Some course average scores could not be loaded.')
      })
      .finally(() => {
        if (active) setScoresLoading(false)
      })

    return () => { active = false }
  }, [onLogout, progressRefresh, scoreCourseIdsKey])

  return loading
    ? <StudentDashboardCourseTableSkeleton />
    : error && initialEnrollments === null
      ? <p className="student-courses__message is-error" role="alert">{error}</p>
      : <>
        {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
        {scoreError && <p className="student-courses__message is-error" role="alert">{scoreError}</p>}
        <StudentDashboardCourseTable
          enrollments={categoryEnrollments}
          averageScores={averageScores}
          scoresLoading={scoresLoading}
          emptyTitle={selectedCategory ? `No ${selectedCategory} courses yet` : 'No enrolled courses yet'}
          emptyDescription={selectedCategory
            ? `Enrolled courses in ${selectedCategory} will appear here.`
            : 'Courses assigned or enrolled for your account will appear here.'}
        />
      </>
}

function getStudentAverageQuizScore(attempts) {
  const scores = attempts
    .filter((attempt) => attempt.status === 'submitted')
    .map(getAttemptScore)
    .filter((score) => score !== null)
  return scores.length
    ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
    : null
}

function StudentDashboardCourseTable({
  enrollments,
  averageScores,
  scoresLoading,
  emptyTitle,
  emptyDescription,
}) {
  const availableEnrollments = enrollments.filter((entry) => entry.courseId && typeof entry.courseId === 'object')
  if (!availableEnrollments.length) {
    return enrollments.length
      ? <p className="student-courses__message is-error" role="alert">Your enrollment exists, but its course details are unavailable. Please contact your administrator.</p>
      : <EmptyState icon="book" title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="student-dashboard-course-table" role="table" aria-label="My courses" aria-busy={scoresLoading}>
      <div className="student-dashboard-course-table__header" role="row">
        <span role="columnheader">Course</span>
        <span role="columnheader">Progress</span>
        <span role="columnheader">Average Score</span>
      </div>
      <div role="rowgroup">
        {availableEnrollments.map((enrollment) => {
          const course = enrollment.courseId
          const courseId = String(course._id)
          const { completedCount, totalCount, percentage } = getCourseProgress(enrollment)
          const averageScore = averageScores[courseId]
          return (
            <div className="student-dashboard-course-table__row" role="row" key={enrollment._id}>
              <div className="student-dashboard-course-table__course" role="cell">
                <Link
                  to={`/student/course/${encodeURIComponent(courseId)}/learn`}
                  aria-label={`Continue learning ${course.title || 'course'}`}
                  onClick={() => seedStudentCourseLearning(enrollment)}
                >
                  {course.thumbnailUrl
                    ? <img src={course.thumbnailUrl} alt="" />
                    : <span className="student-dashboard-course-table__thumbnail-fallback"><Icon name="book" size={20} /></span>}
                  <strong>{course.title || 'Course'}</strong>
                </Link>
              </div>
              <div className="student-dashboard-course-table__progress" role="cell">
                <span className="student-dashboard-course-table__mobile-label">Progress</span>
                <div className="student-dashboard-course-table__progress-copy">
                  <strong>{percentage}%</strong>
                  <small>{completedCount} of {totalCount} activities</small>
                </div>
                <div
                  className="student-dashboard-course-table__progress-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percentage}
                  aria-label={`${course.title || 'Course'} progress`}
                >
                  <span style={{ width: `${percentage}%` }} />
                </div>
              </div>
              <div className="student-dashboard-course-table__score" role="cell">
                <span>Average Score</span>
                <strong>{averageScore === null || averageScore === undefined ? '—' : `${averageScore}%`}</strong>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StudentDashboardCourseTableSkeleton() {
  return (
    <div className="student-dashboard-course-table student-dashboard-course-table--loading" role="status" aria-label="Loading courses" aria-busy="true">
      <div className="student-dashboard-course-table__header" aria-hidden="true">
        <span>Course</span>
        <span>Progress</span>
        <span>Average Score</span>
      </div>
      {[0, 1].map((row) => (
        <div className="student-dashboard-course-table__row" key={row} aria-hidden="true">
          <div className="student-dashboard-course-table__course">
            <span className="student-page-skeleton student-dashboard-course-table__skeleton-thumbnail" />
            <span className="student-page-skeleton student-dashboard-course-table__skeleton-title" />
          </div>
          <div className="student-dashboard-course-table__progress">
            <span className="student-page-skeleton student-dashboard-course-table__skeleton-progress-copy" />
            <span className="student-page-skeleton student-dashboard-course-table__skeleton-progress-track" />
          </div>
          <div className="student-dashboard-course-table__score">
            <span className="student-page-skeleton student-dashboard-course-table__skeleton-score" />
          </div>
        </div>
      ))}
    </div>
  )
}

function StudentAvailableCourseCard({ course, enrollment }) {
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
        {enrollment
          ? <Link
            className="student-available-course__action"
            to={`/student/course/${encodeURIComponent(course._id)}/learn`}
            onClick={() => seedStudentCourseLearning({ ...enrollment, courseId: course })}
          >
            Continue Learning <Icon name="arrow" size={15} />
          </Link>
          : <Link className="student-available-course__action" to={`/student/course/${encodeURIComponent(course._id)}`}>
            View Details <Icon name="arrow" size={15} />
          </Link>}
      </div>
    </article>
  )
}

function StudentAvailableCourses({ user, onLogout, onCategoriesLoaded, selectedCategory }) {
  const [courses, setCourses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetchPublishedCourses(onLogout, controller.signal),
      fetchStudentPageEnrollments(onLogout),
    ])
      .then(([publishedCourses, currentEnrollments]) => {
        if (controller.signal.aborted) return
        setCourses(publishedCourses)
        setEnrollments(currentEnrollments)
        onCategoriesLoaded(getCourseCategoryNames(publishedCourses))
      })
      .catch((loadError) => {
        if (!controller.signal.aborted && loadError.name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Available courses could not be loaded.')
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [onCategoriesLoaded, onLogout, user?.id])

  const enrollmentsByCourseId = new Map()
  for (const entry of enrollments) {
    if (!entry.courseId || entry.status === 'cancelled') continue
    const enrolledCourseId = String(entry.courseId?._id || entry.courseId)
    if (!enrollmentsByCourseId.has(enrolledCourseId)) enrollmentsByCourseId.set(enrolledCourseId, entry)
  }

  const categoryCourses = filterCoursesByCategory(courses, selectedCategory)

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
      const response = await fetchWithAuth(`${API_BASE_URL}/enrollments`, {
        method: 'POST',
        headers: {
          Authorization: `******`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ courseId }),
      }, API_BASE_URL, auth.token)
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
        categoryCourses.length
          ? <div className="student-available-courses__grid">
            {categoryCourses.map((course) => (
              <StudentAvailableCourseCard
                key={course._id}
                course={course}
                enrollment={enrollmentsByCourseId.get(String(course._id))}
              />
            ))}
          </div>
          : selectedCategory
            ? <EmptyState
              icon="book"
              title={`No ${selectedCategory} courses found`}
              description={`Published courses in ${selectedCategory} will appear here.`}
            />
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
  requestedActivityId,
  requestedActivityType,
  contentSearch,
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const course = enrollment.courseId
  const orderedCourseModules = (course.modules || [])
    .map((module, index) => ({ module, index }))
    .sort((left, right) => (left.module.order ?? left.index) - (right.module.order ?? right.index))
  const orderedCourse = { ...course, modules: orderedCourseModules.map(({ module }) => module) }
  const lessons = getCourseLessons(orderedCourse)
  const moduleItems = orderedCourseModules.map(({ module, index }) => ({
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
  const initialCompletedLessonIds = new Set((enrollment.completedLessonIds || []).map(String))
  const initialQuizAttempts = enrollment.quizAttempts || []
  const initialAssignmentSubmissions = enrollment.assignmentSubmissions || []
  const activityItems = allContentItems.filter((item) => (
    ['video-lesson', 'quiz', 'assignment'].includes(item.type)
  ))
  const isInitiallyCompleted = (item) => {
    if (item.type === 'video-lesson') {
      return initialCompletedLessonIds.has(String(item._id || item._learningKey))
    }
    if (item.type === 'quiz') {
      const quizId = String(item.quiz?._id || item._learningKey)
      return initialQuizAttempts.some((attempt) => (
        String(attempt.quizId) === quizId && attempt.status === 'submitted' && attempt.passed === true
      ))
    }
    const assignmentId = String(item._id || item._learningKey)
    const latestSubmission = initialAssignmentSubmissions
      .filter((submission) => String(submission.assignmentId) === assignmentId)
      .sort((left, right) => (
        new Date(right.submittedAt || 0).getTime() - new Date(left.submittedAt || 0).getTime()
      ))[0]
    return latestSubmission?.reviewStatus === 'approved'
  }
  const initialFrontierIndex = activityItems.findIndex((item) => !isInitiallyCompleted(item))
  const requestedActivityItem = requestedActivityId && ['quiz', 'assignment'].includes(requestedActivityType)
    ? allContentItems.find((item) => (
      item.type === requestedActivityType
      && String(item.type === 'quiz' ? item.quiz?._id || item._learningKey : item._learningKey) === requestedActivityId
    ))
    : null
  const requestedLessonItem = requestedLessonId
    ? activityItems.find((item) => item.type === 'video-lesson' && String(item._id || item._learningKey) === requestedLessonId)
    : null
  const requestedInitialItem = requestedActivityItem || requestedLessonItem
  const requestedInitialIndex = activityItems.indexOf(requestedInitialItem)
  const requestedInitialAccessible = requestedInitialItem && (
    isInitiallyCompleted(requestedInitialItem)
    || initialFrontierIndex < 0
    || requestedInitialIndex <= initialFrontierIndex
  )
  const initialActivity = requestedInitialAccessible
    ? requestedInitialItem
    : activityItems[initialFrontierIndex] || activityItems[0]
  const initialLessonId = initialActivity?.type === 'video-lesson'
    ? String(initialActivity._id || initialActivity._learningKey)
    : lessons[0]?.lessonKey || ''
  const [activeLessonId, setActiveLessonId] = useState(initialLessonId)
  const [activeContentItemId, setActiveContentItemId] = useState(
    initialActivity?.type && initialActivity.type !== 'video-lesson'
      ? initialActivity._learningKey
      : '',
  )
  const [detailsTab, setDetailsTab] = useState('overview')
  const [lessonInfoTab, setLessonInfoTab] = useState('overview')
  const [videoOpenSequence, setVideoOpenSequence] = useState(0)
  const [transcriptPlayback, setTranscriptPlayback] = useState({ lessonKey: '', cueIndex: -1 })
  const [expandedModules, setExpandedModules] = useState(() => new Set(
    orderedCourseModules.length
      ? [String(orderedCourseModules[0].module._id || `${orderedCourseModules[0].module.title}-0`)]
      : [],
  ))
  const [savingLessonId, setSavingLessonId] = useState('')
  const [optimisticallyCompletedLessonIds, setOptimisticallyCompletedLessonIds] = useState(() => new Set())
  const [progressError, setProgressError] = useState('')
  const [autoplayBlockedLessonId, setAutoplayBlockedLessonId] = useState('')
  const [assignmentSubmissions, setAssignmentSubmissions] = useState(enrollment.assignmentSubmissions || [])
  const [quizAttempts, setQuizAttempts] = useState(enrollment.quizAttempts || [])
  const [courseCertificate, setCourseCertificate] = useState(null)
  const [courseCertificateLoading, setCourseCertificateLoading] = useState(true)
  const [courseCertificateError, setCourseCertificateError] = useState('')
  const [courseCertificateRefresh, setCourseCertificateRefresh] = useState(0)
  const [courseCertificatePdf, setCourseCertificatePdf] = useState({ certificateId: '', url: '' })

  const [courseCertificatePdfLoading, setCourseCertificatePdfLoading] = useState(false)
  const [courseCertificatePdfError, setCourseCertificatePdfError] = useState('')
  const [courseCertificatePdfRetry, setCourseCertificatePdfRetry] = useState(0)
  const courseCertificatePdfUrlRef = useRef('')
  const videoPlayerRef = useRef(null)
  const videoPlayerContainerRef = useRef(null)
  const videoControlsHideTimeoutRef = useRef(null)
  const [isVideoPlayerFullscreen, setIsVideoPlayerFullscreen] = useState(false)
  const [videoPlayerFullscreenError, setVideoPlayerFullscreenError] = useState('')
  const [isVideoMuted, setIsVideoMuted] = useState(false)
  const [areVideoControlsVisible, setAreVideoControlsVisible] = useState(false)
  const [areVideoControlsKeyboardFocused, setAreVideoControlsKeyboardFocused] = useState(false)
  const transcriptCueListRef = useRef(null)
  const transcriptCueRefs = useRef([])
  const transcriptScriptRef = useRef(null)
  const transcriptScriptCueRefs = useRef([])
  const assignmentStatusRefreshRef = useRef(false)
  const lessonPlaybackPositionsRef = useRef({ ...(enrollment.lessonPlaybackPositions || {}) })
  const lessonWatchedPositionsRef = useRef({
    ...(enrollment.lessonPlaybackPositions || {}),
    ...(enrollment.lessonWatchedPositions || {}),
  })
  const playbackPositionSaveRef = useRef(new Map())
  const learningActivitySampleRef = useRef({ lessonId: '', positionSeconds: 0, sampledAt: 0 })
  const learningActivityPendingRef = useRef(new Map())
  const initialAttentionLesson = lessons.find(({ lesson, lessonKey }) => (
    String(lesson._id || lessonKey) === activeLessonId
  ))?.lesson
  const attentionSessionRef = useRef(createEmptyAttentionSession(
    initialAttentionLesson ? String(initialAttentionLesson._id || activeLessonId) : '',
  ))
  const attentionResponseFinalizationRef = useRef('')
  const attentionTimeoutTriggeredRef = useRef('')
  const [attentionCheckChallenge, setAttentionCheckChallenge] = useState(null)
  const [attentionCheckAnswer, setAttentionCheckAnswer] = useState([])
  const [attentionCheckSecondsRemaining, setAttentionCheckSecondsRemaining] = useState(10)
  const [attentionCheckLoading, setAttentionCheckLoading] = useState(false)
  const [attentionCheckError, setAttentionCheckError] = useState('')
  const [attentionCheckConfigurationError, setAttentionCheckConfigurationError] = useState('')
  const [attentionCheckPlaybackError, setAttentionCheckPlaybackError] = useState('')
  const [attentionCheckRetry, setAttentionCheckRetry] = useState(null)
  const startedLessonIds = useRef(new Set([
    ...(enrollment.startedLessonIds || []).map(String),
    ...(enrollment.completedLessonIds || []).map(String),
  ]))
  const activeIndex = Math.max(0, lessons.findIndex(({ lesson, lessonKey }) => (
    String(lesson._id || lessonKey) === activeLessonId
  )))
  const activeEntry = lessons[activeIndex]
  const activeVideoKey = `${String(course._id)}:${String(activeEntry?.lesson?._id || activeEntry?.lessonKey || '')}`
  const transcriptCues = Array.isArray(activeEntry?.lesson?.transcriptCues)
    ? activeEntry.lesson.transcriptCues
    : []
  const activeTranscriptCueIndex = transcriptPlayback.lessonKey === activeVideoKey
    ? transcriptPlayback.cueIndex
    : findActiveTranscriptCueIndex(transcriptCues, 0)
  const activeContentItem = allContentItems.find((item) => item._learningKey === activeContentItemId)
  const showCourseCertificate = course.generateCertificate !== false
  const hasCurrentCourseCertificate = String(courseCertificate?.courseId || '') === String(course._id)
  const completedLessonIds = new Set([
    ...(enrollment.completedLessonIds || []).map(String),
    ...optimisticallyCompletedLessonIds,
    ...(savingLessonId ? [savingLessonId] : []),
  ])
  const hasPassedQuiz = (quizId) => Boolean(quizId) && quizAttempts.some((attempt) => (
    String(attempt.quizId) === String(quizId)
    && attempt.status === 'submitted'
    && attempt.passed === true
  ))
  const isActivityComplete = (item) => {
    if (item.type === 'video-lesson') {
      return (enrollment.completedLessonIds || []).some((id) => (
        String(id) === String(item._id || item._learningKey)
      ))
    }
    if (item.type === 'quiz') return hasPassedQuiz(item.quiz?._id || item._learningKey)
    if (item.type === 'assignment') {
      return assignmentSubmissions.some((submission) => (
        String(submission.assignmentId) === String(item._id || item._learningKey)
      ))
    }
    return false
  }
  const nextIncompleteActivity = activityItems.find((item) => !isActivityComplete(item)) || null
  const nextIncompleteActivityIndex = nextIncompleteActivity ? activityItems.indexOf(nextIncompleteActivity) : -1
  const isCourseItemAccessible = (item) => {
    if (!item || !['video-lesson', 'quiz', 'assignment'].includes(item.type)) return true
    const itemIndex = activityItems.indexOf(item)
    return isActivityComplete(item)
      || nextIncompleteActivityIndex < 0
      || (itemIndex >= 0 && itemIndex <= nextIncompleteActivityIndex)
  }
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
  const isActiveQuiz = detailsTab === 'overview' && activeContentItem?.type === 'quiz'
  const isActiveAssignment = detailsTab === 'overview' && activeContentItem?.type === 'assignment'
  const hasActiveQuizAttempt = isActiveQuiz && quizAttempts.some((attempt) => (
    String(attempt.quizId) === String(activeContentItem.quiz?._id)
    && attempt.status === 'started'
  ))

  useEffect(() => {
    setAssignmentSubmissions(enrollment.assignmentSubmissions || [])
  }, [enrollment.assignmentSubmissions])

  useEffect(() => {
    setQuizAttempts(enrollment.quizAttempts || [])
  }, [enrollment.quizAttempts])

  useEffect(() => {
    lessonPlaybackPositionsRef.current = {
      ...lessonPlaybackPositionsRef.current,
      ...(enrollment.lessonPlaybackPositions || {}),
    }
    lessonWatchedPositionsRef.current = {
      ...lessonWatchedPositionsRef.current,
      ...(enrollment.lessonWatchedPositions || {}),
    }
  }, [enrollment.lessonPlaybackPositions, enrollment.lessonWatchedPositions])

  useEffect(() => {
    setProgressError('')
  }, [enrollment.courseId])

  useEffect(() => {
    if (activeTranscriptCueIndex < 0) return
    const container = lessonInfoTab === 'transcript'
      ? transcriptScriptRef.current
      : transcriptCueListRef.current
    const cue = lessonInfoTab === 'transcript'
      ? transcriptScriptCueRefs.current[activeTranscriptCueIndex]
      : transcriptCueRefs.current[activeTranscriptCueIndex]
    if (!container || !cue) return
    const containerBounds = container.getBoundingClientRect()
    const cueBounds = cue.getBoundingClientRect()
    if (cueBounds.top < containerBounds.top) {
      container.scrollTo({
        top: container.scrollTop + cueBounds.top - containerBounds.top - 6,
        behavior: 'smooth',
      })
    } else if (cueBounds.bottom > containerBounds.bottom) {
      container.scrollTo({
        top: container.scrollTop + cueBounds.bottom - containerBounds.bottom + 6,
        behavior: 'smooth',
      })
    }
  }, [activeTranscriptCueIndex, activeVideoKey, lessonInfoTab, transcriptCues])

  function seekToTranscriptCue(cue) {
    const video = videoPlayerRef.current
    if (!video || !Number.isFinite(cue.startTimeMs)) return
    video.currentTime = cue.startTimeMs / 1000
    updateTranscriptPlaybackTime(video)
  }

  function updateTranscriptPlaybackTime(video) {
    if (!Number.isFinite(video.currentTime)) return
    const cueIndex = findActiveTranscriptCueIndex(transcriptCues, video.currentTime)
    setTranscriptPlayback((current) => (
      current.lessonKey === activeVideoKey && current.cueIndex === cueIndex
        ? current
        : { lessonKey: activeVideoKey, cueIndex }
    ))
  }

  useEffect(() => {
    if (!showCourseCertificate) return undefined
    const controller = new AbortController()
    if (!hasCurrentCourseCertificate) setCourseCertificateLoading(true)
    setCourseCertificateError('')
    fetchStudentCourseCertificate(course._id, onLogout, controller.signal)
      .then((result) => setCourseCertificate(result))
      .catch((certificateError) => {
        if (certificateError.name !== 'AbortError') {
          setCourseCertificateError(certificateError instanceof Error
            ? certificateError.message
            : 'Certificate status could not be loaded.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCourseCertificateLoading(false)
      })
    return () => controller.abort()
  }, [course._id, showCourseCertificate, onLogout, courseCertificateRefresh])

  useEffect(() => {
    if (!showCourseCertificate) return undefined
    const refresh = () => setCourseCertificateRefresh((current) => current + 1)
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 30000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refresh)
    }
  }, [showCourseCertificate])

  useEffect(() => {
    const controller = new AbortController()
    async function refreshAssignmentStatuses() {
      if (assignmentStatusRefreshRef.current) return
      assignmentStatusRefreshRef.current = true
      try {
        const { assignmentSubmissions: submissions } = await fetchStudentCourseContent(
          course._id,
          onLogout,
          controller.signal,
        )
        if (controller.signal.aborted) return
        setProgressError((current) => current === 'API route not found.' ? '' : current)
        setAssignmentSubmissions((current) => {
          const currentById = new Map(current.map((submission) => [String(submission._id), submission]))
          const refreshedIds = new Set(submissions.map((submission) => String(submission._id)))
          const refreshed = submissions.map((submission) => ({
            ...currentById.get(String(submission._id)),
            ...submission,
          }))
          return [...refreshed, ...current.filter((submission) => !refreshedIds.has(String(submission._id)))]
        })
      } catch (refreshError) {
        if (!controller.signal.aborted) {
          setProgressError(refreshError instanceof Error
            ? refreshError.message
            : 'Assignment review status could not be loaded.')
        }
      } finally {
        assignmentStatusRefreshRef.current = false
      }
    }

    const handleFocus = () => { void refreshAssignmentStatuses() }
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAssignmentStatuses()
    }, 30000)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      controller.abort()
    }
  }, [course._id, enrollment._id, onLogout])

  useEffect(() => {
    const certificate = courseCertificate?.certificate
    if (detailsTab !== 'certificate' || !hasCurrentCourseCertificate || !certificate?.id) return undefined
    if (courseCertificatePdf.certificateId === certificate.id && courseCertificatePdf.url) return undefined

    const controller = new AbortController()
    setCourseCertificatePdfLoading(true)
    setCourseCertificatePdfError('')
    async function loadCertificatePdf() {
      try {
        const savedAuth = sessionStorage.getItem('lms.auth')
        const auth = savedAuth ? JSON.parse(savedAuth) : null
        if (typeof auth?.token !== 'string') {
          onLogout()
          throw new Error('Your session has ended. Please sign in again.')
        }
        const response = await fetchWithAuth(
          `${API_BASE_URL}/certificates/${encodeURIComponent(certificate.id)}/pdf`,
          { headers: { Authorization: `Bearer ${auth.token}` }, signal: controller.signal },
          API_BASE_URL,
          auth.token,
        )
        const result = response.ok ? null : await response.json().catch(() => ({}))
        if (isInvalidSessionResponse(response, result)) {
          onLogout()
          throw new Error('Your session has ended. Please sign in again.')
        }
        if (!response.ok) throw new Error(result?.message || 'The certificate preview could not be generated.')
        const pdfBlob = await response.blob()
        if (!pdfBlob.size || (pdfBlob.type && pdfBlob.type !== 'application/pdf')) {
          throw new Error('The server did not return a valid certificate PDF.')
        }
        const url = URL.createObjectURL(pdfBlob)
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url)
          return
        }
        if (courseCertificatePdfUrlRef.current) URL.revokeObjectURL(courseCertificatePdfUrlRef.current)
        courseCertificatePdfUrlRef.current = url
        setCourseCertificatePdf({ certificateId: certificate.id, url })
      } catch (pdfError) {
        if (!controller.signal.aborted) {
          setCourseCertificatePdfError(pdfError instanceof Error
            ? pdfError.message
            : 'The certificate preview could not be generated.')
        }
      } finally {
        if (!controller.signal.aborted) setCourseCertificatePdfLoading(false)
      }
    }

    void loadCertificatePdf()
    return () => controller.abort()
  }, [
    courseCertificate?.certificate?.id,
    courseCertificatePdf.certificateId,
    courseCertificatePdf.url,
    courseCertificatePdfRetry,
    detailsTab,
    hasCurrentCourseCertificate,
    onLogout,
  ])

  useEffect(() => () => {
    if (courseCertificatePdfUrlRef.current) URL.revokeObjectURL(courseCertificatePdfUrlRef.current)
  }, [])

  function initializeAttentionCheckSession(video, entry = activeEntry) {
    const lesson = entry?.lesson
    const settings = lesson?.attentionCheck
    if (!lesson || settings?.enabled !== true) return
    const lessonId = String(lesson._id || entry.lessonKey)
    if (attentionSessionRef.current.lessonId === lessonId && attentionSessionRef.current.initialized) return

    try {
      const durationSeconds = Number(video.duration)
      const configuration = {
        durationSeconds,
        videoUrl: String(lesson.videoUrl || lesson.video || ''),
        questionsDuringVideo: Number(settings.questionsDuringVideo),
        minIntervalSeconds: Number(settings.minIntervalSeconds),
        maxIntervalSeconds: Number(settings.maxIntervalSeconds),
      }
      sessionStorage.removeItem(getAttentionCheckSessionStorageKey(lessonId))
      const schedule = createAttentionCheckSchedule(
        durationSeconds,
        configuration.questionsDuringVideo,
        configuration.minIntervalSeconds,
        configuration.maxIntervalSeconds,
      )
      const session = {
        ...createEmptyAttentionSession(lessonId),
        ...configuration,
        sessionId: createAttentionCheckSessionId(),
        schedule,
        initialized: true,
      }
      attentionSessionRef.current = session
      setAttentionCheckError('')
      setAttentionCheckConfigurationError('')
      setAttentionCheckRetry(null)
    } catch (scheduleError) {
      attentionSessionRef.current = { ...createEmptyAttentionSession(lessonId), initialized: true }
      setAttentionCheckConfigurationError(scheduleError instanceof Error ? scheduleError.message : 'Attention checks could not be scheduled for this video.')
    }
  }

  function getAttentionCheckSessionStorageKey(lessonId) {
    return `lms.video-attention:${course._id}:${enrollment?._id || 'enrollment'}:${lessonId}`
  }

  function createAttentionCheckSessionId() {
    const randomUUID = globalThis.crypto?.randomUUID
    return typeof randomUUID === 'function'
      ? randomUUID.call(globalThis.crypto)
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
        const value = Math.floor(Math.random() * 16)
        return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16)
      })
  }

  function endCurrentAttentionCheckSession() {
    const lessonId = String(activeEntry?.lesson?._id || activeEntry?.lessonKey || '')
    if (lessonId) sessionStorage.removeItem(getAttentionCheckSessionStorageKey(lessonId))
    attentionSessionRef.current = createEmptyAttentionSession()
    attentionResponseFinalizationRef.current = ''
    attentionTimeoutTriggeredRef.current = ''
    setAttentionCheckChallenge(null)
    setAttentionCheckAnswer([])
    setAttentionCheckSecondsRemaining(10)
    setAttentionCheckLoading(false)
    setAttentionCheckError('')
    setAttentionCheckConfigurationError('')
    setAttentionCheckPlaybackError('')
    setAttentionCheckRetry(null)
  }

  async function requestAttentionQuestion(triggerIndex, positionSeconds) {
    const session = attentionSessionRef.current
    const lessonId = String(activeEntry?.lesson?._id || '')
    if (!lessonId || !session.sessionId) return
    session.pending = true
    session.blocked = true
    session.pendingDetails = { triggerIndex, positionSeconds }
    setAttentionCheckLoading(true)
    setAttentionCheckError('')
    setAttentionCheckRetry(null)
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      const auth = savedAuth ? JSON.parse(savedAuth) : null
      if (typeof auth?.token !== 'string') {
        onLogout()
        return
      }
      const response = await fetchWithAuth(`${API_BASE_URL}/courses/${encodeURIComponent(course._id)}/attention-checks/${encodeURIComponent(lessonId)}/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId: session.sessionId, triggerIndex, positionSeconds }),
      }, API_BASE_URL, auth.token)
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (result.recorded === true && ['answered', 'not_answered'].includes(result.status)) {
        completeAttentionCheck(triggerIndex)
        return
      }
      if (!response.ok || !result.responseId || !result.question) {
        throw new Error(result.message || 'The attention check could not be loaded.')
      }
      setAttentionCheckAnswer([])
      attentionResponseFinalizationRef.current = ''
      attentionTimeoutTriggeredRef.current = ''
      setAttentionCheckSecondsRemaining(10)
      setAttentionCheckChallenge({ ...result, triggerIndex })
    } catch (requestError) {
      session.pending = false
      setAttentionCheckError(requestError instanceof Error ? requestError.message : 'The attention check could not be loaded.')
      setAttentionCheckRetry({ triggerIndex, positionSeconds })
    } finally {
      setAttentionCheckLoading(false)
    }
  }

  function checkAttentionSchedule(video) {
    const session = attentionSessionRef.current
    if (!session.initialized || session.pending || !session.schedule.length) return
    session.lastVideoPositionSeconds = video.currentTime
    const triggerIndex = session.nextIndex
    if (triggerIndex >= session.schedule.length || video.currentTime < session.schedule[triggerIndex]) return
    video.pause()
    void requestAttentionQuestion(triggerIndex, video.currentTime)
  }

  function completeAttentionCheck(triggerIndex) {
    const video = videoPlayerRef.current
    const session = attentionSessionRef.current
    session.nextIndex = Math.max(session.nextIndex, triggerIndex + 1)
    session.pending = false
    session.blocked = false
    session.pendingDetails = null
    session.lastVideoPositionSeconds = Number(video?.currentTime) || 0
    attentionResponseFinalizationRef.current = ''
    attentionTimeoutTriggeredRef.current = ''
    setAttentionCheckChallenge(null)
    setAttentionCheckAnswer([])
    setAttentionCheckPlaybackError('')
    const playback = video?.play()
    if (playback && typeof playback.catch === 'function') {
      playback.catch(() => setAttentionCheckPlaybackError('Your response was recorded. Resume the video when ready.'))
    }
  }

  async function finalizeAttentionCheck(selectedOptionIndices, notAnswered = false) {
    if (!attentionCheckChallenge) return
    const responseId = attentionCheckChallenge.responseId
    if (!responseId || attentionResponseFinalizationRef.current === responseId) return
    attentionResponseFinalizationRef.current = responseId
    setAttentionCheckLoading(true)
    setAttentionCheckError('')
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      const auth = savedAuth ? JSON.parse(savedAuth) : null
      if (typeof auth?.token !== 'string') {
        onLogout()
        return
      }
      const lessonId = String(activeEntry?.lesson?._id || '')
      const response = await fetchWithAuth(`${API_BASE_URL}/courses/${encodeURIComponent(course._id)}/attention-checks/${encodeURIComponent(lessonId)}/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notAnswered
          ? { responseId, notAnswered: true }
          : { responseId, selectedOptionIndices }),
      }, API_BASE_URL, auth.token)
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok || result.recorded !== true) {
        if (notAnswered && response.status === 409 && result.message === 'The 10-second response window is still active.') {
          attentionResponseFinalizationRef.current = ''
          window.setTimeout(() => {
            if (
              attentionCheckChallenge?.responseId === responseId
              && attentionResponseFinalizationRef.current !== responseId
            ) {
              void finalizeAttentionCheck([], true)
            }
          }, 100)
          return
        }
        throw new Error(result.message || 'Your attention check response could not be recorded.')
      }
      completeAttentionCheck(attentionCheckChallenge.triggerIndex)
    } catch (submitError) {
      attentionResponseFinalizationRef.current = ''
      setAttentionCheckError(submitError instanceof Error ? submitError.message : 'Your attention check response could not be recorded.')
      if (notAnswered || attentionCheckSecondsRemaining <= 0) {
        window.setTimeout(() => {
          if (
            attentionCheckChallenge?.responseId === responseId
            && attentionResponseFinalizationRef.current !== responseId
          ) {
            void finalizeAttentionCheck([], true)
          }
        }, 1000)
      }
    } finally {
      setAttentionCheckLoading(false)
    }
  }

  async function submitAttentionAnswer(event) {
    event.preventDefault()
    if (!attentionCheckChallenge || !attentionCheckAnswer.length || attentionCheckSecondsRemaining <= 0) return
    await finalizeAttentionCheck(attentionCheckAnswer)
  }

  useEffect(() => {
    const updateFullscreenState = () => {
      setIsVideoPlayerFullscreen(document.fullscreenElement === videoPlayerContainerRef.current)
    }
    document.addEventListener('fullscreenchange', updateFullscreenState)
    return () => document.removeEventListener('fullscreenchange', updateFullscreenState)
  }, [])

  useEffect(() => () => {
    if (videoControlsHideTimeoutRef.current !== null) {
      window.clearTimeout(videoControlsHideTimeoutRef.current)
    }
  }, [])

  function revealVideoControls() {
    setAreVideoControlsVisible(true)
    if (videoControlsHideTimeoutRef.current !== null) {
      window.clearTimeout(videoControlsHideTimeoutRef.current)
    }
    videoControlsHideTimeoutRef.current = window.setTimeout(() => {
      videoControlsHideTimeoutRef.current = null
      setAreVideoControlsVisible(false)
    }, 2000)
  }

  function hideVideoControls() {
    if (videoControlsHideTimeoutRef.current !== null) {
      window.clearTimeout(videoControlsHideTimeoutRef.current)
      videoControlsHideTimeoutRef.current = null
    }
    setAreVideoControlsVisible(false)
  }

  async function toggleVideoPlayerFullscreen() {
    const player = videoPlayerContainerRef.current
    if (!player) return
    setVideoPlayerFullscreenError('')
    try {
      if (document.fullscreenElement === player) {
        await document.exitFullscreen()
      } else if (typeof player.requestFullscreen === 'function') {
        await player.requestFullscreen()
      } else {
        setVideoPlayerFullscreenError('Fullscreen mode is not supported by this browser.')
      }
    } catch {
      setVideoPlayerFullscreenError('Fullscreen mode could not be changed. Please try again.')
    }
  }

  function toggleVideoMute() {
    const video = videoPlayerRef.current
    if (!video) return
    video.muted = !video.muted
    setIsVideoMuted(video.muted)
  }

  useEffect(() => {
    if (!attentionCheckChallenge) {
      setAttentionCheckSecondsRemaining(10)
      return undefined
    }
    const presentedAtMs = Date.parse(attentionCheckChallenge.presentedAt)
    const serverTimeMs = Date.parse(attentionCheckChallenge.serverTime)
    const elapsedBeforeDisplayMs = Number.isFinite(presentedAtMs) && Number.isFinite(serverTimeMs)
      ? Math.max(0, serverTimeMs - presentedAtMs)
      : 0
    const deadlineMs = Date.now() + Math.max(0, 10_000 - elapsedBeforeDisplayMs)
    const updateCountdown = () => {
      setAttentionCheckSecondsRemaining(Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)))
    }
    updateCountdown()
    const intervalId = window.setInterval(updateCountdown, 100)
    return () => window.clearInterval(intervalId)
  }, [attentionCheckChallenge])

  useEffect(() => {
    if (!attentionCheckChallenge || attentionCheckSecondsRemaining > 0) return
    const responseId = attentionCheckChallenge.responseId
    if (!responseId || attentionTimeoutTriggeredRef.current === responseId) return
    attentionTimeoutTriggeredRef.current = responseId
    void finalizeAttentionCheck([], true)
  }, [attentionCheckChallenge, attentionCheckSecondsRemaining])

  function handleAttentionVideoSeeking(video) {
    const session = attentionSessionRef.current
    const lessonId = String(activeEntry?.lesson?._id || activeEntry?.lessonKey || '')
    if (!lessonId || session.lessonId !== lessonId) return
    if (video.currentTime <= 1 && session.lastVideoPositionSeconds > 5 && !session.pending && !session.blocked) {
      sessionStorage.removeItem(getAttentionCheckSessionStorageKey(lessonId))
      attentionSessionRef.current = createEmptyAttentionSession(lessonId)
      initializeAttentionCheckSession(video)
    }
    attentionSessionRef.current.lastVideoPositionSeconds = video.currentTime
  }

  useEffect(() => {
    const lessonId = String(activeEntry?.lesson?._id || activeEntry?.lessonKey || '')
    if (attentionSessionRef.current.lessonId === lessonId) return
    attentionSessionRef.current = createEmptyAttentionSession()
    setAttentionCheckChallenge(null)
    setAttentionCheckAnswer([])
    setAttentionCheckLoading(false)
    setAttentionCheckError('')
    setAttentionCheckConfigurationError('')
    setAttentionCheckPlaybackError('')
    setAttentionCheckRetry(null)
    setVideoPlayerFullscreenError('')
    setAutoplayBlockedLessonId('')
  }, [activeLessonId])

  useEffect(() => {
    const matchedLesson = lessons.find(({ lesson }) => String(lesson._id) === requestedLessonId)
    const matchedActivity = activityItems.find((item) => (
      item.type === 'video-lesson'
      && String(item._id || item._learningKey) === requestedLessonId
    ))
    if (matchedLesson && matchedActivity && isCourseItemAccessible(matchedActivity)) {
      setActiveLessonId(String(matchedLesson.lesson._id))
      setExpandedModules((current) => new Set(current).add(matchedLesson.moduleKey))
    } else if (lessons.length && !lessons.some(({ lesson, lessonKey }) => String(lesson._id || lessonKey) === activeLessonId)) {
      setActiveLessonId(lessons[0].lessonKey)
    }
  }, [requestedLessonId, course._id])

  useEffect(() => {
    if (!requestedActivityId || !['quiz', 'assignment'].includes(requestedActivityType)) return
    const item = allContentItems.find((entry) => (
      entry.type === requestedActivityType
      && String(entry.type === 'quiz' ? entry.quiz?._id || entry._learningKey : entry._learningKey) === requestedActivityId
    ))
    if (!item || !isCourseItemAccessible(item)) return
    videoPlayerRef.current?.pause()
    setActiveContentItemId(item._learningKey)
    setDetailsTab('overview')
    if (item._moduleKey) {
      setExpandedModules((current) => new Set(current).add(item._moduleKey))
    }
  }, [requestedActivityId, requestedActivityType, course._id])

  useEffect(() => {
    if (!activeEntry || activeContentItemId) return
    const item = activityItems.find((activity) => (
      activity.type === 'video-lesson'
      && String(activity._id || activity._learningKey) === String(activeEntry.lesson._id || activeEntry.lessonKey)
    ))
    if (item && isCourseItemAccessible(item)) void setLessonStarted(activeEntry)
  }, [activeLessonId, activeContentItemId, enrollment._id])

  function selectLesson(entry) {
    if (attentionCheckChallenge || attentionCheckLoading || attentionSessionRef.current.blocked) return
    const id = String(entry.lesson._id || entry.lessonKey)
    const activityItem = activityItems.find((item) => (
      item.type === 'video-lesson' && String(item._id || item._learningKey) === id
    ))
    if (!activityItem || !isCourseItemAccessible(activityItem)) return
    if (entry.lesson._progressionLocked) {
      window.dispatchEvent(new Event(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT))
    }
    if (videoPlayerRef.current && activeEntry) {
      recordLearningActivity(activeEntry, videoPlayerRef.current, true)
      saveLessonPlaybackPosition(activeEntry, videoPlayerRef.current.currentTime, true)
      videoPlayerRef.current.pause()
    }
    endCurrentAttentionCheckSession()
    setActiveContentItemId('')
    setDetailsTab('overview')
    setVideoOpenSequence((current) => current + 1)
    setActiveLessonId(id)
    setExpandedModules((current) => new Set(current).add(entry.moduleKey))
    const params = new URLSearchParams(location.search)
    params.set('lesson', id)
    params.delete('activity')
    params.delete('activityType')
    navigate(`${location.pathname}?${params.toString()}`, { replace: true })
  }

  function selectContentItem(item) {
    if (attentionCheckChallenge || attentionCheckLoading || attentionSessionRef.current.blocked) return
    if (!isCourseItemAccessible(item)) return
    if (item.type === 'video-lesson') {
      const lesson = lessons.find((entry) => String(entry.lesson._id || entry.lessonKey) === item._learningKey)
      if (lesson) selectLesson(lesson)
      return
    }
    if (item._progressionLocked) {
      window.dispatchEvent(new Event(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT))
    }
    endCurrentAttentionCheckSession()
    videoPlayerRef.current?.pause()
    setActiveContentItemId(item._learningKey)
    setDetailsTab(item.type === 'note' ? 'notes' : 'overview')
    if (item._moduleKey) {
      setExpandedModules((current) => new Set(current).add(item._moduleKey))
    }
  }

  function addAssignmentSubmission(submission) {
    setAssignmentSubmissions((current) => [submission, ...current])
    setCourseCertificateRefresh((current) => current + 1)
  }

  function addQuizAttempt(attempt, courseProgress) {
    setQuizAttempts((current) => [attempt, ...current.filter((entry) => String(entry._id) !== String(attempt._id))])
    if (courseProgress) {
      onEnrollmentUpdated({
        courseProgress,
        ...(courseProgress.status ? { status: courseProgress.status } : {}),
      })
    }
    if (attempt.status === 'submitted') {
      setCourseCertificateRefresh((current) => current + 1)
    }
  }

  function getAssignmentReviewStatus(assignment) {
    const submission = assignmentSubmissions.find((entry) => (
      String(entry.assignmentId) === String(assignment?._id)
    ))
    if (!submission) return 'not-submitted'
    if (['approved', 'rejected', 'pending'].includes(submission.reviewStatus)) {
      return submission.reviewStatus
    }
    const requirement = courseCertificate?.pendingRequirements?.find((entry) => (
      entry.type === 'assignment' && String(entry.id) === String(assignment?._id)
    ))
    if (requirement?.status === 'resubmit') return 'rejected'
    if (requirement) return 'pending'
    if (
      assignment?.requiredForCertificate !== false
      && Array.isArray(courseCertificate?.pendingRequirements)
      && hasCurrentCourseCertificate
    ) {
      return 'approved'
    }
    return 'pending'
  }

  function getAssignmentSidebarLabel(status) {
    if (status === 'approved') return 'Completed'
    if (status === 'pending') return 'Awaiting Admin Review'
    if (status === 'rejected') return 'Rejected'
    return 'Assignment'
  }

  function saveLessonPlaybackPosition(entry, positionSeconds, force = false, isPlayingOverride) {
    const lessonId = String(entry?.lesson?._id || '')
    if (!isValidLessonId(lessonId) || !Number.isFinite(positionSeconds) || positionSeconds < 0) return

    const position = Math.min(43200, Math.floor(positionSeconds))
    const isPlaying = typeof isPlayingOverride === 'boolean'
      ? isPlayingOverride
      : videoPlayerRef.current?.paused === false
    let saveState = playbackPositionSaveRef.current.get(lessonId)
    if (!saveState) {
      const savedPosition = Number(lessonPlaybackPositionsRef.current[lessonId])
      saveState = {
        lastSavedPosition: Number.isFinite(savedPosition) ? Math.floor(savedPosition) : 0,
        inFlight: false,
        queuedPosition: null,
      }
      playbackPositionSaveRef.current.set(lessonId, saveState)
    }
    if (saveState.inFlight) {
      if (force) saveState.queuedPosition = { position, isPlaying }
      return
    }
    if (!force && (
      position === saveState.lastSavedPosition
      || Math.abs(position - saveState.lastSavedPosition) < 10
    )) return

    saveState.inFlight = true
    void (async () => {
      try {
        const savedAuth = sessionStorage.getItem('lms.auth')
        const auth = savedAuth ? JSON.parse(savedAuth) : null
        if (typeof auth?.token !== 'string') {
          onLogout()
          return
        }
        const response = await fetchWithAuth(`${API_BASE_URL}/enrollments/${encodeURIComponent(enrollment._id)}/progress`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${auth.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ lessonId, positionSeconds: position, isPlaying }),
        }, API_BASE_URL, auth.token)
        const result = await response.json()
        if (isInvalidSessionResponse(response, result)) {
          onLogout()
          return
        }
        if (Number.isFinite(result.maxPositionSeconds)) {
          lessonWatchedPositionsRef.current[lessonId] = result.maxPositionSeconds
        }
        if (!response.ok) throw new Error(result.message || 'Video playback position could not be saved.')
        saveState.lastSavedPosition = position
        lessonPlaybackPositionsRef.current = {
          ...lessonPlaybackPositionsRef.current,
          [lessonId]: position,
        }
        if (Number.isFinite(result.lessonWatchedPositions?.[lessonId])) {
          lessonWatchedPositionsRef.current[lessonId] = result.lessonWatchedPositions[lessonId]
        }
        onEnrollmentUpdated({
          lessonPlaybackPositions: { ...lessonPlaybackPositionsRef.current },
          lessonWatchedPositions: { ...lessonWatchedPositionsRef.current },
        })
      } catch (saveError) {
        setProgressError(saveError instanceof Error ? saveError.message : 'Video playback position could not be saved.')
      } finally {
        saveState.inFlight = false
        const queuedPosition = saveState.queuedPosition
        saveState.queuedPosition = null
        if (queuedPosition && queuedPosition.position !== saveState.lastSavedPosition) {
          saveLessonPlaybackPosition(entry, queuedPosition.position, true, queuedPosition.isPlaying)
        }
      }
    })()
  }

  function getWatchedPosition(lessonId) {
    return Math.max(
      Number(lessonWatchedPositionsRef.current[lessonId]) || 0,
      Number(lessonPlaybackPositionsRef.current[lessonId]) || 0,
    )
  }

  function updateWatchedPosition(entry, video) {
    if (video.paused || video.seeking) return
    const lessonId = String(entry?.lesson?._id || '')
    const position = Number(video.currentTime)
    if (!lessonId || !Number.isFinite(position) || position <= getWatchedPosition(lessonId)) return
    lessonWatchedPositionsRef.current[lessonId] = position
  }

  function resetLearningActivitySample(entry, video) {
    learningActivitySampleRef.current = {
      lessonId: String(entry?.lesson?._id || ''),
      positionSeconds: Number(video?.currentTime) || 0,
      sampledAt: performance.now(),
    }
  }

  function flushLearningActivity(entry) {
    const lessonId = String(entry?.lesson?._id || '')
    if (!isValidLessonId(lessonId)) return
    const activityState = learningActivityPendingRef.current.get(lessonId)
    if (!activityState || activityState.inFlight) return
    const seconds = Math.min(60, Math.floor(activityState.seconds))
    if (seconds < 1) return

    activityState.seconds -= seconds
    activityState.inFlight = true
    let saved = false
    void (async () => {
      try {
        const savedAuth = sessionStorage.getItem('lms.auth')
        const auth = savedAuth ? JSON.parse(savedAuth) : null
        if (typeof auth?.token !== 'string') {
          onLogout()
          return
        }
        const response = await fetchWithAuth(
          `${API_BASE_URL}/enrollments/${encodeURIComponent(enrollment._id)}/learning-activity`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${auth.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              lessonId,
              seconds,
              activityDate: getLocalLearningDateKey(new Date()),
            }),
          },
          API_BASE_URL,
          auth.token,
        )
        const result = await response.json()
        if (isInvalidSessionResponse(response, result)) {
          onLogout()
          return
        }
        if (!response.ok) throw new Error(result.message || 'Video learning time could not be saved.')
        saved = true
      } catch (activityError) {
        activityState.seconds += seconds
        setProgressError(activityError instanceof Error
          ? activityError.message
          : 'Video learning time could not be saved.')
      } finally {
        activityState.inFlight = false
        if (saved && activityState.seconds >= 15) flushLearningActivity(entry)
      }
    })()
  }

  function recordLearningActivity(entry, video, flush = false) {
    const lessonId = String(entry?.lesson?._id || '')
    if (!isValidLessonId(lessonId) || !video) return
    const now = performance.now()
    const positionSeconds = Number(video.currentTime) || 0
    const previousSample = learningActivitySampleRef.current
    const elapsedSeconds = (now - previousSample.sampledAt) / 1000
    const positionDelta = positionSeconds - previousSample.positionSeconds

    if (
      previousSample.lessonId === lessonId
      && !video.paused
      && !video.seeking
      && elapsedSeconds > 0
      && elapsedSeconds <= 4
      && positionDelta > 0
      && positionDelta <= elapsedSeconds * Math.max(1, Number(video.playbackRate) || 1) + 1
    ) {
      const activityState = learningActivityPendingRef.current.get(lessonId) || { seconds: 0, inFlight: false }
      activityState.seconds += Math.min(2, elapsedSeconds)
      learningActivityPendingRef.current.set(lessonId, activityState)
    }

    learningActivitySampleRef.current = { lessonId, positionSeconds, sampledAt: now }
    const activityState = learningActivityPendingRef.current.get(lessonId)
    if (activityState && (flush || activityState.seconds >= 15)) flushLearningActivity(entry)
  }

  function handleVideoMetadata(video, entry) {
    initializeAttentionCheckSession(video, entry)
    const lessonId = String(entry?.lesson?._id || '')
    const savedPosition = Number(lessonPlaybackPositionsRef.current[lessonId])
    const duration = getVideoCompletionDuration(video)
    const resumePosition = Number.isFinite(savedPosition) && savedPosition >= 0
      ? Math.min(savedPosition, duration || savedPosition)
      : 0
    lessonWatchedPositionsRef.current[lessonId] = Math.max(
      getWatchedPosition(lessonId),
      resumePosition,
    )
    video.currentTime = resumePosition
    updateTranscriptPlaybackTime(video)
    setAutoplayBlockedLessonId('')
    const playback = video.play()
    if (playback && typeof playback.catch === 'function') {
      playback.catch((playError) => {
        if (playError?.name !== 'AbortError' && activeLessonId === lessonId) {
          setAutoplayBlockedLessonId(lessonId)
        }
      })
    }
  }

  async function setLessonStarted(entry) {
    const lessonId = String(entry.lesson._id || '')
    if (!isValidLessonId(lessonId) || startedLessonIds.current.has(lessonId)) return
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
      const response = await fetchWithAuth(`${API_BASE_URL}/enrollments/${encodeURIComponent(enrollment._id)}/progress`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lessonId, started: true }),
      }, API_BASE_URL, auth.token)
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

  async function setLessonCompleted(entry, completed, video = videoPlayerRef.current) {
    const lessonId = String(entry.lesson._id || '')
    const positionSeconds = Number(video?.currentTime)
    const playerDuration = getVideoCompletionDuration(video)
    const videoDuration = playerDuration > 0 ? playerDuration : positionSeconds
    if (!isValidLessonId(lessonId)) {
      setProgressError('This lesson cannot be tracked because it has no saved lesson ID.')
      return
    }
    if (completed && (
      videoDuration <= 0
      || !Number.isFinite(positionSeconds)
    )) {
      setProgressError('Watch the entire video before completing this lesson.')
      return
    }
    if (completed) {
      setOptimisticallyCompletedLessonIds((current) => new Set(current).add(lessonId))
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
      const response = await fetchWithAuth(`${API_BASE_URL}/enrollments/${encodeURIComponent(enrollment._id)}/progress`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lessonId,
          completed,
          ...(completed ? {
            positionSeconds,
            videoDurationSeconds: videoDuration,
            isPlaying: false,
          } : {}),
        }),
      }, API_BASE_URL, auth.token)
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok) throw new Error(result.message || 'Lesson progress could not be saved.')
      const savedCompletedLessonIds = (result.completedLessonIds || []).map(String)
      if (completed && !savedCompletedLessonIds.includes(lessonId)) {
        throw new Error('The server did not confirm this lesson completion.')
      }
      if (result.lessonPlaybackPositions) {
        lessonPlaybackPositionsRef.current = result.lessonPlaybackPositions
      }
      if (result.lessonWatchedPositions) {
        lessonWatchedPositionsRef.current = result.lessonWatchedPositions
      }
      onEnrollmentUpdated({
        ...enrollment,
        status: result.status || enrollment.status,
        courseProgress: result.courseProgress || enrollment.courseProgress,
        completedLessonIds: savedCompletedLessonIds,
        lessonPlaybackPositions: { ...lessonPlaybackPositionsRef.current },
        lessonWatchedPositions: { ...lessonWatchedPositionsRef.current },
      })
      if (completed) {
        setOptimisticallyCompletedLessonIds((current) => {
          const next = new Set(current)
          next.delete(lessonId)
          return next
        })
      }
      startedLessonIds.current.add(lessonId)
      if (completed) setCourseCertificateRefresh((current) => current + 1)
      onLearningDataChanged()
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Lesson progress could not be saved.'
      if (completed) {
        setOptimisticallyCompletedLessonIds((current) => {
          const next = new Set(current)
          next.delete(lessonId)
          return next
        })
      }
      setProgressError(completed
        ? `Video finished, but completion could not be synced: ${message}`
        : message)
    } finally {
      setSavingLessonId('')
    }
  }

  function downloadCourseCertificate() {
    const certificate = courseCertificate?.certificate
    const pdfUrl = courseCertificatePdf.certificateId === certificate?.id ? courseCertificatePdf.url : ''
    if (!certificate?.id || !pdfUrl) return
    const link = document.createElement('a')
    link.href = pdfUrl
    link.download = `aiHustle-certificate-${certificate.certificateId}.pdf`
    document.body.append(link)
    link.click()
    link.remove()
  }

  function renderCourseCertificate() {
    return (
      <section className="student-certificate-card student-course-learning__certificate" aria-labelledby="student-course-certificate-title">
        <div className="student-certificate-card__heading">
          <div>
            <span className={`student-certificate-card__status${courseCertificate?.certificate ? ' is-earned' : ' is-locked'}`}>
              {courseCertificate?.certificate ? 'Certificate unlocked' : 'Certificate locked'}
            </span>
            <h3 id="student-course-certificate-title">Course Certificate</h3>
          </div>
          <span className="student-certificate-card__icon" aria-hidden="true">
            <Icon name={courseCertificate?.certificate ? 'award' : 'lock'} size={21} />
          </span>
        </div>
        {courseCertificateError && <p className="student-certificates__error" role="alert">{courseCertificateError}</p>}
        {hasCurrentCourseCertificate && courseCertificate?.certificate ? (
          <div className="student-certificate-card__earned">
            {courseCertificatePdfError && <p className="student-certificates__error" role="alert">{courseCertificatePdfError}</p>}
            {courseCertificatePdfLoading && (
              <p className="student-certificate-card__pending" role="status">Generating your personalized certificate…</p>
            )}
            {courseCertificatePdf.certificateId === courseCertificate.certificate.id && courseCertificatePdf.url && (
              <>
                <iframe
                  className="student-course-learning__certificate-preview"
                  title={`Certificate for ${courseCertificate.certificate.courseName}`}
                  src={courseCertificatePdf.url}
                />
                <div className="student-certificate-card__actions">
                  <button type="button" className="student-button" onClick={downloadCourseCertificate}>
                    Download Certificate PDF
                  </button>
                </div>
              </>
            )}
            {courseCertificatePdfError && (
              <button type="button" className="student-button student-button--quiet" onClick={() => setCourseCertificatePdfRetry((current) => current + 1)}>
                Retry certificate generation
              </button>
            )}
          </div>
        ) : courseCertificateLoading && !hasCurrentCourseCertificate ? (
          <p className="student-certificate-card__pending" role="status">Checking your course requirements…</p>
        ) : courseCertificate?.pendingRequirements?.length ? (
          <div className="student-certificate-card__pending">
            <strong>Complete these requirements to unlock your certificate</strong>
            <ul>
              {courseCertificate.pendingRequirements.map((requirement, index) => (
                <li key={`${requirement.type}-${requirement.title}-${index}`}>
                  <span aria-hidden="true">○</span>
                  <span>{requirement.title}</span>
                  <small>{requirement.type === 'assignment'
                    ? requirement.status === 'awaiting-review' ? 'Awaiting Admin review' : requirement.status === 'resubmit' ? 'Resubmit required' : 'Not submitted'
                    : requirement.type === 'quiz' ? 'Pass required'
                      : requirement.type === 'profile' ? 'Update profile'
                        : requirement.type === 'course' ? 'Admin setup required' : 'Not completed'}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="student-certificate-card__pending" role="status">
            {courseCertificateError ? 'Certificate requirements could not be checked.' : 'Course requirements are being checked.'}
          </p>
        )}
        {courseCertificateError && (
          <button type="button" className="student-button student-button--quiet" onClick={() => setCourseCertificateRefresh((current) => current + 1)}>
            Retry
          </button>
        )}
      </section>
    )
  }

  function moveLesson(offset) {
    const nextEntry = lessons[activeIndex + offset]
    if (nextEntry) selectLesson(nextEntry)
  }

  function moveContent(offset) {
    const nextItem = allContentItems[activeContentIndex + offset]
    if (nextItem && isCourseItemAccessible(nextItem)) selectContentItem(nextItem)
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
                      const quizPassed = item.type === 'quiz' && hasPassedQuiz(item.quiz?._id)
                      const assignmentReviewStatus = item.type === 'assignment'
                        ? getAssignmentReviewStatus(item)
                        : ''
                      const assignmentApproved = assignmentReviewStatus === 'approved'
                      const assignmentAwaitingReview = assignmentReviewStatus === 'pending'
                      const assignmentRejected = assignmentReviewStatus === 'rejected'
                      const isCompleted = (item.type === 'video-lesson' && completedLessonIds.has(String(item._id)))
                        || quizPassed
                        || assignmentApproved
                      const isLocked = !isCourseItemAccessible(item)
                      const quizAttemptCount = item.quiz?._id
                        ? quizAttempts.filter((attempt) => String(attempt.quizId) === String(item.quiz._id)).length
                        : 0
                      const status = isLocked
                        ? 'Locked until previous activity is complete'
                        : item.type === 'video-lesson'
                        ? isCompleted ? 'Completed' : item.durationSeconds ? `${Math.ceil(item.durationSeconds / 60)} min` : 'Video'
                        : item.type === 'quiz'
                          ? quizPassed ? 'Passed' : `${quizAttemptCount} ${quizAttemptCount === 1 ? 'attempt' : 'attempts'}`
                          : item.type === 'assignment'
                            ? getAssignmentSidebarLabel(assignmentReviewStatus)
                            : item.type === 'note' ? 'Notes / PDF' : getStudentContentLabel(item.type)
                      const itemIconClassName = [
                        'student-course-learning__item-icon',
                        isCompleted && 'is-complete',
                        assignmentAwaitingReview && 'is-awaiting-review',
                        assignmentRejected && 'is-rejected',
                      ].filter(Boolean).join(' ')
                      const statusClassName = assignmentAwaitingReview
                        ? 'is-awaiting-review'
                        : assignmentRejected ? 'is-rejected' : ''
                      const itemIcon = isLocked
                        ? 'lock'
                        : isCompleted
                        ? 'check'
                        : assignmentAwaitingReview
                          ? 'clock'
                          : assignmentRejected
                            ? 'circleX'
                            : item.type === 'assignment' || item.type === 'quiz'
                              ? 'clipboardCheck'
                              : item.type === 'note' ? 'folderOpen' : 'play'
                      return (
                        <li key={item._learningKey}>
                          <button
                            id={item._id ? `student-content-${item._id}` : undefined}
                            className={isSelected ? 'is-selected' : ''}
                            type="button"
                            disabled={isLocked}
                            aria-current={isSelected ? 'true' : undefined}
                            onClick={() => selectContentItem(item)}
                          >
                            <span className={itemIconClassName}>
                              <Icon name={itemIcon} size={15} />
                            </span>
                            <span className="student-course-learning__item-copy"><strong>{item.title}</strong><small className={statusClassName}>{status}</small></span>
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
                <ul>{filteredCourseLevelItems.map((item) => {
                  const quizPassed = item.type === 'quiz' && hasPassedQuiz(item.quiz?._id)
                  const assignmentReviewStatus = item.type === 'assignment'
                    ? getAssignmentReviewStatus(item)
                    : ''
                  const assignmentApproved = assignmentReviewStatus === 'approved'
                  const assignmentAwaitingReview = assignmentReviewStatus === 'pending'
                  const assignmentRejected = assignmentReviewStatus === 'rejected'
                  const isCompleted = quizPassed || assignmentApproved
                  const isLocked = !isCourseItemAccessible(item)
                  const itemIconClassName = [
                    'student-course-learning__item-icon',
                    isCompleted && 'is-complete',
                    assignmentAwaitingReview && 'is-awaiting-review',
                    assignmentRejected && 'is-rejected',
                  ].filter(Boolean).join(' ')
                  const statusClassName = assignmentAwaitingReview
                    ? 'is-awaiting-review'
                    : assignmentRejected ? 'is-rejected' : ''
                  return (
                    <li key={item._learningKey}>
                      <button
                        className={item._learningKey === activeContentItemId ? 'is-selected' : ''}
                        type="button"
                        disabled={isLocked}
                        aria-current={item._learningKey === activeContentItemId ? 'true' : undefined}
                        onClick={() => selectContentItem(item)}
                      >
                        <span className={itemIconClassName}>
                          <Icon
                            name={isLocked ? 'lock' : isCompleted ? 'check' : assignmentAwaitingReview ? 'clock' : assignmentRejected ? 'circleX' : 'clipboardCheck'}
                            size={15}
                          />
                        </span>
                        <span className="student-course-learning__item-copy">
                          <strong>{item.title}</strong>
                          <small className={statusClassName}>
                            {isLocked
                              ? 'Locked until previous activity is complete'
                              : item.type === 'assignment'
                              ? getAssignmentSidebarLabel(assignmentReviewStatus)
                              : quizPassed ? 'Passed' : getStudentContentLabel(item.type)}
                          </small>
                        </span>
                      </button>
                    </li>
                  )
                })}</ul>
              </section>
            )}
            <section className="student-course-learning__sidebar-links" aria-label="Course materials">
              {showCourseCertificate && (
                <button
                  className={detailsTab === 'certificate' ? 'is-selected' : ''}
                  type="button"
                  aria-pressed={detailsTab === 'certificate'}
                  onClick={() => {
                    if (attentionCheckChallenge || attentionCheckLoading || attentionSessionRef.current.blocked) return
                    videoPlayerRef.current?.pause()
                    endCurrentAttentionCheckSession()
                    setActiveContentItemId(COURSE_CERTIFICATE_KEY)
                    setDetailsTab('certificate')
                  }}
                >
                  <span className="student-course-learning__item-icon"><Icon name="award" size={15} /></span>
                  <strong>Certificate</strong>
                </button>
              )}
              <button
                className={detailsTab === 'notes' ? 'is-selected' : ''}
                type="button"
                aria-pressed={detailsTab === 'notes'}
                onClick={() => {
                  if (attentionCheckChallenge || attentionCheckLoading || attentionSessionRef.current.blocked) return
                  videoPlayerRef.current?.pause()
                  endCurrentAttentionCheckSession()
                  setActiveContentItemId(COURSE_NOTES_KEY)
                  setDetailsTab('notes')
                }}
              >
                <span className="student-course-learning__item-icon"><Icon name="pen" size={15} /></span>
                <strong>Notes</strong>
              </button>
            </section>
            {contentSearch && !filteredModuleItems.some(({ items }) => items.length) && !filteredCourseLevelItems.length && (
              <p className="student-course-learning__empty-module">No course content matches “{contentSearch}”.</p>
            )}
          </aside>
          <div className={`student-course-learning__main${showVideoPlayer ? ' student-course-learning__main--video' : ' student-course-learning__main--activity'}${isActiveAssignment ? ' student-course-learning__main--assignment' : ''}`}>
            {isActiveAssignment && (
              <button
                className="student-course-learning__assignment-back"
                type="button"
                onClick={() => {
                  setActiveContentItemId('')
                  setDetailsTab('overview')
                }}
              >
                ← Back to Course
              </button>
            )}
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
              <div
                className="student-course-learning__player"
                ref={videoPlayerContainerRef}
                onPointerMove={revealVideoControls}
                onPointerLeave={hideVideoControls}
              >
                {activeEntry?.lesson.videoUrl
                  ? <video
                    ref={videoPlayerRef}
                    key={`${String(activeEntry.lesson._id || activeEntry.lessonKey)}:${activeEntry.lesson.videoUrl}:${videoOpenSequence}`}
                    controls
                    controlsList="nodownload noplaybackrate nofullscreen"
                    disablePictureInPicture
                    playsInline
                    preload="metadata"
                    src={activeEntry.lesson.videoUrl}
                    onLoadedMetadata={(event) => {
                      handleVideoMetadata(event.currentTarget, activeEntry)
                      updateTranscriptPlaybackTime(event.currentTarget)
                      setIsVideoMuted(event.currentTarget.muted)
                    }}
                    onVolumeChange={(event) => setIsVideoMuted(event.currentTarget.muted)}
                    onPlaying={(event) => resetLearningActivitySample(activeEntry, event.currentTarget)}
                    onPlay={(event) => {
                      updateTranscriptPlaybackTime(event.currentTarget)
                      resetLearningActivitySample(activeEntry, event.currentTarget)
                      saveLessonPlaybackPosition(activeEntry, event.currentTarget.currentTime, true, true)
                      const settings = activeEntry.lesson.attentionCheck
                      if (settings?.enabled === true) {
                        initializeAttentionCheckSession(event.currentTarget)
                        if (attentionSessionRef.current.pending || attentionSessionRef.current.blocked) event.currentTarget.pause()
                      }
                    }}
                    onTimeUpdate={(event) => {
                      updateTranscriptPlaybackTime(event.currentTarget)
                      recordLearningActivity(activeEntry, event.currentTarget)
                      updateWatchedPosition(activeEntry, event.currentTarget)
                      saveLessonPlaybackPosition(activeEntry, event.currentTarget.currentTime)
                      checkAttentionSchedule(event.currentTarget)
                    }}
                    onSeeking={(event) => {
                      updateTranscriptPlaybackTime(event.currentTarget)
                      resetLearningActivitySample(activeEntry, event.currentTarget)
                      handleAttentionVideoSeeking(event.currentTarget)
                    }}
                    onSeeked={(event) => {
                      updateTranscriptPlaybackTime(event.currentTarget)
                      resetLearningActivitySample(activeEntry, event.currentTarget)
                    }}
                    onWaiting={(event) => resetLearningActivitySample(activeEntry, event.currentTarget)}
                    onPause={(event) => {
                      updateTranscriptPlaybackTime(event.currentTarget)
                      recordLearningActivity(activeEntry, event.currentTarget, true)
                      saveLessonPlaybackPosition(activeEntry, event.currentTarget.currentTime, true, false)
                    }}
                    onEnded={(event) => {
                      recordLearningActivity(activeEntry, event.currentTarget, true)
                      endCurrentAttentionCheckSession()
                      const video = event.currentTarget
                      updateWatchedPosition(activeEntry, video)
                      updateTranscriptPlaybackTime(video)
                      saveLessonPlaybackPosition(activeEntry, video.currentTime, true, false)
                      if (!completedLessonIds.has(String(activeEntry.lesson._id))) {
                        void setLessonCompleted(activeEntry, true, video)
                      }
                    }}
                  >
                    Your browser does not support video playback.
                  </video>
                  : <div className="student-course-learning__no-video">No video has been uploaded for this lesson.</div>}
                {activeEntry?.lesson.videoUrl && (
                  <div
                    className={`student-course-learning__custom-controls${areVideoControlsVisible ? ' is-visible' : ''}${areVideoControlsKeyboardFocused ? ' is-keyboard-focused' : ''}`}
                    role="group"
                    aria-label="Video controls"
                    onFocus={(event) => setAreVideoControlsKeyboardFocused(event.target.matches(':focus-visible'))}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setAreVideoControlsKeyboardFocused(false)
                      }
                    }}
                  >
                    <button
                      className="student-course-learning__volume-button"
                      type="button"
                      aria-label={isVideoMuted ? 'Unmute video' : 'Mute video'}
                      aria-pressed={isVideoMuted}
                      onClick={toggleVideoMute}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 9v6h4l5 4V5L7 9H3z" />
                        {isVideoMuted
                          ? <path d="m16 9 5 6m0-6-5 6" />
                          : <><path d="M16 9a5 5 0 0 1 0 6" /><path d="M18.5 6a9 9 0 0 1 0 12" /></>}
                      </svg>
                    </button>
                    <button
                      className="student-course-learning__fullscreen-button"
                      type="button"
                      aria-label={isVideoPlayerFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                      title={isVideoPlayerFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                      aria-pressed={isVideoPlayerFullscreen}
                      onClick={() => void toggleVideoPlayerFullscreen()}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        {isVideoPlayerFullscreen
                          ? <path d="M9 3v6H3M21 9h-6V3M15 21v-6h6M3 15h6v6" />
                          : <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />}
                      </svg>
                    </button>
                  </div>
                )}
                {attentionCheckLoading && !attentionCheckChallenge && (
                  <div className="student-course-learning__attention-overlay" role="status">Loading attention check…</div>
                )}
                {attentionCheckChallenge && (
                  <form className="student-course-learning__attention-overlay student-course-learning__attention-overlay--question" onSubmit={submitAttentionAnswer} role="dialog" aria-modal="true" aria-labelledby="student-attention-question">
                    <h3 id="student-attention-question">{attentionCheckChallenge.question.prompt}</h3>
                    <p role="timer" aria-live="off">Time remaining: {attentionCheckSecondsRemaining}s</p>
                    <div className="student-course-learning__attention-options">
                      {attentionCheckChallenge.question.options.map((option, index) => {
                        const multiSelect = attentionCheckChallenge.question.type === 'multiple-select'
                        const checked = attentionCheckAnswer.includes(index)
                        return (
                          <label key={`${index}-${option}`}>
                            <input
                              type={multiSelect ? 'checkbox' : 'radio'}
                              name={`attention-${activeEntry.lesson._id}-${attentionCheckChallenge.triggerIndex}`}
                              checked={checked}
                              disabled={attentionCheckLoading || attentionCheckSecondsRemaining <= 0}
                              onChange={(event) => setAttentionCheckAnswer((current) => (
                                multiSelect
                                  ? event.target.checked ? [...current, index] : current.filter((value) => value !== index)
                                  : [index]
                              ))}
                            />
                            <span>{option}</span>
                          </label>
                        )
                      })}
                    </div>
                    {attentionCheckError && <p role="alert">{attentionCheckError}</p>}
                    <button type="submit" disabled={attentionCheckLoading || !attentionCheckAnswer.length || attentionCheckSecondsRemaining <= 0}>
                      {attentionCheckLoading ? 'Recording…' : 'Submit answer'}
                    </button>
                  </form>
                )}
                {attentionCheckError && !attentionCheckChallenge && !attentionCheckLoading && (
                  <div className="student-course-learning__attention-overlay" role="alert">
                    <p>{attentionCheckError}</p>
                    {attentionCheckRetry && (
                      <button type="button" onClick={() => requestAttentionQuestion(attentionCheckRetry.triggerIndex, attentionCheckRetry.positionSeconds)}>Retry attention check</button>
                    )}
                  </div>
                )}
                {videoPlayerFullscreenError && (
                  <div className="student-course-learning__fullscreen-error" role="alert">
                    {videoPlayerFullscreenError}
                  </div>
                )}
              </div>
            )}
            {showVideoPlayer && attentionCheckConfigurationError && (
              <p className="student-course-learning__attention-warning" role="alert">
                {attentionCheckConfigurationError} The video can still be watched, but attention checks could not be scheduled. Please contact an administrator.
              </p>
            )}
            {showVideoPlayer && attentionCheckPlaybackError && (
              <p className="student-course-learning__attention-warning" role="status">
                {attentionCheckPlaybackError}{' '}
                <button type="button" onClick={() => {
                  setAttentionCheckPlaybackError('')
                  videoPlayerRef.current?.play()?.catch(() => setAttentionCheckPlaybackError('Playback could not resume. Press play on the video controls.'))
                }}>Resume video</button>
              </p>
            )}
            {showVideoPlayer && autoplayBlockedLessonId === String(activeEntry?.lesson?._id || activeEntry?.lessonKey) && (
              <p className="student-course-learning__attention-warning" role="status">
                Autoplay was blocked by your browser. Press Play on the video controls to start the lesson.
              </p>
            )}
            {showVideoPlayer && (
              <div className="student-course-learning__video-actions">
                {activeEntry && (
                  <div className="student-course-learning__video-completion">
                    <button
                      className={`student-button${completedLessonIds.has(String(activeEntry.lesson._id)) ? ' student-button--quiet' : ''}`}
                      type="button"
                      disabled={
                        savingLessonId === String(activeEntry.lesson._id)
                        || !activeEntry.lesson._id
                        || !completedLessonIds.has(String(activeEntry.lesson._id))
                      }
                      title={completedLessonIds.has(String(activeEntry.lesson._id))
                        ? 'This lesson is complete.'
                        : 'Watch the entire video to complete this lesson.'}
                    >
                      {savingLessonId === String(activeEntry.lesson._id)
                        ? 'Saving…'
                        : completedLessonIds.has(String(activeEntry.lesson._id)) ? 'Completed' : 'Watch video to complete'}
                    </button>
                  </div>
                )}
                <div className="student-course-learning__video-nav">
                  <button type="button" disabled={activeContentIndex <= 0} onClick={() => moveContent(-1)}>← Previous</button>
                  <button
                    type="button"
                    disabled={activeContentIndex < 0 || activeContentIndex >= allContentItems.length - 1 || !isCourseItemAccessible(allContentItems[activeContentIndex + 1])}
                    onClick={() => moveContent(1)}
                  >Next →</button>
                </div>
              </div>
            )}
            <section className="student-course-learning__details">
              {!showVideoPlayer && !isActiveAssignment && <div className="student-course-learning__active-heading">
                <div>
                  <h2>{detailsTab === 'certificate' ? 'Course Certificate' : activeContentItem?.title || (detailsTab === 'notes' ? 'Notes' : detailsTab === 'resources' ? 'Resources' : activeEntry?.lesson.title) || 'Select course content'}</h2>
                  {detailsTab === 'certificate'
                    ? <span className="student-course-learning__type student-course-learning__type--certificate"><Icon name="award" size={14} />Certificate</span>
                    : <span className={`student-course-learning__type student-course-learning__type--${activeContentItem?.type || 'video-lesson'}`}>
                      <Icon name={activeContentItem?.type === 'assignment' ? 'clipboardCheck' : activeContentItem?.type === 'note' || detailsTab === 'notes' ? 'folderOpen' : activeContentItem?.type === 'quiz' ? 'check' : detailsTab === 'resources' ? 'link' : 'book'} size={14} />
                      {detailsTab === 'resources'
                        ? 'Resources'
                        : getStudentContentLabel(activeContentItem?.type || (detailsTab === 'notes' ? 'note' : 'video-lesson'))}
                    </span>}
                </div>
                {!showVideoPlayer && detailsTab !== 'certificate' && !isActiveQuiz && <div className="student-course-learning__detail-nav">
                  <button type="button" disabled={activeContentIndex <= 0} onClick={() => moveContent(-1)}>← Previous</button>
                  <button
                    type="button"
                    disabled={activeContentIndex < 0 || activeContentIndex >= allContentItems.length - 1 || !isCourseItemAccessible(allContentItems[activeContentIndex + 1])}
                    onClick={() => moveContent(1)}
                  >Next →</button>
                </div>}
              </div>}
              {detailsTab === 'overview' && !isActiveAssignment && (activeContentItem?.description || (!activeContentItem && activeEntry?.lesson.content)) && (
                <p className="student-course-learning__active-description">
                  {activeContentItem?.description || activeEntry?.lesson.content}
                </p>
              )}
              {detailsTab !== 'certificate' && !isActiveAssignment && <div className="student-course-learning__tabs" role="tablist" aria-label="Course information">
                {showVideoPlayer ? (
                  <>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={lessonInfoTab === 'overview'}
                      className={lessonInfoTab === 'overview' ? 'is-active' : ''}
                      onClick={() => setLessonInfoTab('overview')}
                    >
                      <Icon name="book" size={15} />
                      Lesson Overview
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={lessonInfoTab === 'transcript'}
                      className={lessonInfoTab === 'transcript' ? 'is-active' : ''}
                      onClick={() => setLessonInfoTab('transcript')}
                    >
                      <Icon name="book" size={15} />
                      Transcript
                    </button>
                  </>
                ) : (
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
                )}
              </div>}
              {detailsTab === 'certificate' ? (
                <div className="student-course-learning__tab-content">{renderCourseCertificate()}</div>
              ) : detailsTab === 'notes' ? (
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
              ) : showVideoPlayer ? (
                <div className="student-course-learning__tab-content">
                  <section className="student-course-learning__transcript" aria-labelledby="student-course-transcript-title">
                    <h3 id="student-course-transcript-title">Transcript</h3>
                    {transcriptCues.length ? lessonInfoTab === 'transcript' ? (
                      <div
                        key={activeVideoKey}
                        ref={transcriptScriptRef}
                        className="student-course-learning__transcript-script"
                        aria-label="Video transcript"
                      >
                        <p>
                          {transcriptCues.map((cue, index) => (
                            <React.Fragment key={`${activeVideoKey}-${cue.startTimeMs}-${index}`}>
                              {index > 0 ? ' ' : ''}
                              <button
                                type="button"
                                ref={(element) => { transcriptScriptCueRefs.current[index] = element }}
                                className={`student-course-learning__transcript-script-cue${index === activeTranscriptCueIndex ? ' is-active' : ''}`}
                                aria-current={index === activeTranscriptCueIndex ? 'true' : undefined}
                                aria-label={`Jump to ${formatTranscriptTime(cue.startTimeMs)}: ${cue.text}`}
                                onClick={() => seekToTranscriptCue(cue)}
                              >
                                {cue.text}
                              </button>
                            </React.Fragment>
                          ))}
                        </p>
                      </div>
                    ) : (
                      <ol
                        key={activeVideoKey}
                        ref={transcriptCueListRef}
                        className="student-course-learning__transcript-cues"
                        aria-label="Video transcript"
                      >
                        {transcriptCues.map((cue, index) => (
                          <li
                            key={`${activeVideoKey}-${cue.startTimeMs}-${index}`}
                            ref={(element) => { transcriptCueRefs.current[index] = element }}
                            className={`student-course-learning__transcript-cue${index === activeTranscriptCueIndex ? ' is-active' : ''}`}
                            aria-current={index === activeTranscriptCueIndex ? 'true' : undefined}
                          >
                            <time>{formatTranscriptTime(cue.startTimeMs)}</time>
                            <button
                              type="button"
                              className="student-course-learning__transcript-text"
                              aria-label={`Jump to ${formatTranscriptTime(cue.startTimeMs)}: ${cue.text}`}
                              onClick={() => seekToTranscriptCue(cue)}
                            >
                              {cue.text}
                            </button>
                          </li>
                        ))}
                      </ol>
                    ) : <p className="student-course-learning__transcript-empty">Transcript not available</p>}
                  </section>
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
                      showHeader
                      canSubmit={['not-submitted', 'rejected'].includes(getAssignmentReviewStatus(activeContentItem))}
                    />
                  ) : activeContentItem?.type === 'note' ? (
                    <StudentNotePanel item={activeContentItem} />
                  ) : activeEntry ? (
                    <section className="student-course-learning__lesson">
                      <span className="student-eyebrow">{activeEntry.module.title}</span>
                    </section>
                  ) : <EmptyState icon="book" title="Select course content" description="Choose a video, quiz, assignment, or note from the course content list." />}
                </div>
              )}
              {(isActiveAssignment || (isActiveQuiz && !hasActiveQuizAttempt)) && (
                <div className={`student-course-learning__detail-nav student-course-learning__detail-nav--bottom${isActiveAssignment ? ' student-course-learning__detail-nav--assignment' : ''}`}>
                  <button type="button" disabled={activeContentIndex <= 0} onClick={() => moveContent(-1)}>← Previous</button>
                  <button
                    type="button"
                    disabled={activeContentIndex < 0 || activeContentIndex >= allContentItems.length - 1 || !isCourseItemAccessible(allContentItems[activeContentIndex + 1])}
                    onClick={() => moveContent(1)}
                  >Next →</button>
                </div>
              )}
            </section>
          </div>
        </div>
      ) : showCourseCertificate ? (
        <div className="student-course-learning__layout">
          <aside className="student-course-learning__sidebar" aria-label="Course modules and lessons">
            <header className="student-course-learning__sidebar-header"><h2>{course.title}</h2></header>
            <section className="student-course-learning__sidebar-links" aria-label="Course materials">
              <button
                className={detailsTab === 'certificate' ? 'is-selected' : ''}
                type="button"
                aria-pressed={detailsTab === 'certificate'}
                onClick={() => setDetailsTab('certificate')}
              >
                <span className="student-course-learning__item-icon"><Icon name="award" size={15} /></span>
                <strong>Certificate</strong>
              </button>
              <button className={detailsTab === 'notes' ? 'is-selected' : ''} type="button" aria-pressed={detailsTab === 'notes'} onClick={() => setDetailsTab('notes')}>
                <span className="student-course-learning__item-icon"><Icon name="pen" size={15} /></span>
                <strong>Notes</strong>
              </button>
            </section>
          </aside>
          <div className="student-course-learning__main student-course-learning__main--activity">
            {detailsTab === 'certificate' ? (
              <>
                <div className="student-course-learning__active-heading"><h2>Course Certificate</h2></div>
                <div className="student-course-learning__tab-content">{renderCourseCertificate()}</div>
              </>
            ) : <EmptyState icon="book" title="Course content is not available yet" description="This enrolled course does not currently have any lessons or activities." />}
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
  const response = await fetchWithAuth(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  }, API_BASE_URL, auth.token)
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

function formatReferralDay(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function getReferralExpiryLabel(value) {
  const expiresAt = new Date(value).getTime()
  if (!Number.isFinite(expiresAt)) return 'Expiry unavailable'
  const hoursRemaining = Math.ceil((expiresAt - Date.now()) / (60 * 60 * 1000))
  if (hoursRemaining <= 0) return 'Expired'
  return `Expires in ${hoursRemaining} ${hoursRemaining === 1 ? 'hour' : 'hours'}`
}

function isReferralCodeActive(code, now = Date.now()) {
  const expiresAt = new Date(code?.expiresAt).getTime()
  return code?.status === 'active' && Number.isFinite(expiresAt) && expiresAt > now
}

function getCachedStudentReferralData() {
  const cacheKey = getStudentCertificateCacheKey()
  const cached = cacheKey ? studentReferralCache.get(cacheKey) : null
  if (!cached) return null
  if (Date.now() - cached.savedAt >= studentLearningPageCacheTtlMs) {
    studentReferralCache.delete(cacheKey)
    return null
  }
  return cached.data
}

async function fetchStudentReferralData(onLogout) {
  const cacheKey = getStudentCertificateCacheKey()
  let request = cacheKey ? studentReferralRequests.get(cacheKey) : null
  if (!request) {
    request = referralsRequest('/referrals/me', { onLogout }).then((result) => {
      if (!Array.isArray(result.codes) || !result.stats) {
        throw new Error('The server returned invalid referral information.')
      }
      if (cacheKey) studentReferralCache.set(cacheKey, { data: result, savedAt: Date.now() })
      return result
    })
    if (cacheKey) studentReferralRequests.set(cacheKey, request)
  }
  try {
    return await request
  } finally {
    if (cacheKey && studentReferralRequests.get(cacheKey) === request) {
      studentReferralRequests.delete(cacheKey)
    }
  }
}

function StudentReferrals({ onLogout }) {
  const [initialReferralData] = useState(getCachedStudentReferralData)
  const [referralData, setReferralData] = useState(initialReferralData)
  const [loading, setLoading] = useState(!initialReferralData)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [notice, setNotice] = useState('')
  const [copiedCode, setCopiedCode] = useState('')
  const [showAllCodes, setShowAllCodes] = useState(false)
  const [expiryCheckTime, setExpiryCheckTime] = useState(() => Date.now())
  const pendingRequestId = useRef('')

  useEffect(() => {
    let active = true
    const cachedData = getCachedStudentReferralData()
    if (cachedData) setReferralData(cachedData)
    setLoading(!cachedData)
    setError('')
    fetchStudentReferralData(onLogout)
      .then((result) => {
        if (active) setReferralData(result)
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Referral information could not be loaded.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [onLogout, loadAttempt])

  useEffect(() => {
    const nextExpiry = (referralData?.codes || [])
      .filter((code) => code.status === 'active')
      .map((code) => new Date(code.expiresAt).getTime())
      .filter((expiresAt) => Number.isFinite(expiresAt) && expiresAt > Date.now())
      .sort((left, right) => left - right)[0]
    if (!nextExpiry) return undefined
    const timeout = window.setTimeout(
      () => setExpiryCheckTime(Date.now()),
      Math.max(0, nextExpiry - Date.now()),
    )
    return () => window.clearTimeout(timeout)
  }, [referralData, expiryCheckTime])

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
      const result = await fetchStudentReferralData(onLogout)
      setReferralData(result)
    } catch (generateError) {
      if (generateError?.statusCode === 429) {
        setReferralData((current) => {
          if (!current) return current
          const totalLimit = Number.isSafeInteger(current.stats?.totalLimit)
            ? current.stats.totalLimit
            : 20
          return {
            ...current,
            stats: { ...current.stats, totalGenerated: totalLimit, totalLimit, remaining: 0 },
          }
        })
      }
      setError(generateError instanceof Error ? generateError.message : 'A referral code could not be generated.')
    } finally {
      setGenerating(false)
    }
  }

  async function copyReferralCode(code) {
    if (!isReferralCodeActive(referralCodes.find((entry) => entry.code === code))) {
      setError('This referral code is no longer active.')
      return
    }
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      setNotice('Referral code copied.')
      setError('')
    } catch {
      setError('The referral code could not be copied. Please copy it manually.')
    }
  }

  async function shareReferralCode(code) {
    if (!isReferralCodeActive(referralCodes.find((entry) => entry.code === code))) {
      setError('This referral code is no longer active.')
      return
    }
    const url = new URL('/', window.location.origin)
    url.searchParams.set('mode', 'register')
    url.searchParams.set('referralCode', code)
    const shareData = {
      title: 'Join Morrow Learning',
      text: `Use my referral code ${code} when you sign up.`,
      url: url.toString(),
    }

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData)
        setNotice('Referral link shared.')
        setError('')
        return
      } catch (shareError) {
        if (shareError?.name === 'AbortError') return
      }
    }

    try {
      await navigator.clipboard.writeText(shareData.url)
      setNotice('Referral link copied.')
      setError('')
    } catch {
      setError('The referral link could not be shared. Please copy the code manually.')
    }
  }

  const rawStats = referralData?.stats || {}
  const referralCodes = referralData?.codes || []
  const totalLimit = Number.isSafeInteger(rawStats.totalLimit) && rawStats.totalLimit >= 0
    ? rawStats.totalLimit
    : 20
  const totalGenerated = Number.isSafeInteger(rawStats.totalGenerated) && rawStats.totalGenerated >= 0
    ? rawStats.totalGenerated
    : 0
  const stats = {
    ...rawStats,
    totalGenerated,
    totalLimit,
    remaining: Number.isSafeInteger(rawStats.remaining) && rawStats.remaining >= 0
      ? rawStats.remaining
      : Math.max(0, totalLimit - totalGenerated),
    successfullyUsed: Number.isSafeInteger(rawStats.successfullyUsed) && rawStats.successfullyUsed >= 0
      ? rawStats.successfullyUsed
      : 0,
    active: referralData
      ? referralCodes.filter((code) => isReferralCodeActive(code, expiryCheckTime)).length
      : Number.isSafeInteger(rawStats.active) && rawStats.active >= 0
        ? rawStats.active
        : 0,
    expired: referralData
      ? referralCodes.filter((code) =>
        code.status === 'expired' ||
        (code.status === 'active' && !isReferralCodeActive(code, expiryCheckTime)),
      ).length
      : Number.isSafeInteger(rawStats.expired) && rawStats.expired >= 0
        ? rawStats.expired
        : 0,
  }
  const summary = [
    { label: 'Total codes generated', value: `${stats.totalGenerated}/${stats.totalLimit}`, tone: 'gold' },
    { label: 'Codes remaining', value: stats.remaining, tone: 'blue' },
    { label: 'Successfully used', value: stats.successfullyUsed, tone: 'mint' },
    { label: 'Active codes', value: stats.active, tone: 'peach' },
    { label: 'Expired codes', value: stats.expired, tone: 'lavender' },
  ]
  const activeReferralCode = referralCodes.find((code) => isReferralCodeActive(code, expiryCheckTime)) || null
  const visibleReferralCodes = showAllCodes ? referralCodes : referralCodes.slice(0, 3)

  return (
    <div className="student-referrals">
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

      <section className="student-referrals__hero">
        <div className="student-referrals__code-panel">
          <div className="student-referrals__code-label">
            <Icon name="gift" size={21} />
            <span>YOUR REFERRAL CODE</span>
          </div>
          <div className="student-referrals__code-value">
            {loading && !referralData
              ? <span className="student-page-skeleton" style={{ width: '150px', height: '32px' }} />
              : activeReferralCode
                ? <strong>{activeReferralCode.code}</strong>
                : <span>No active code yet</span>}
            {activeReferralCode && (
              <button
                className="student-referrals__copy-current"
                type="button"
                aria-label={`Copy referral code ${activeReferralCode.code}`}
                onClick={() => copyReferralCode(activeReferralCode.code)}
              >
                <Icon name="copy" size={18} />
              </button>
            )}
          </div>
          {activeReferralCode && (
            <p className="student-referrals__code-expiry">
              <span aria-hidden="true">✓</span>
              Code generated on {formatReferralDay(activeReferralCode.createdAt)} · {getReferralExpiryLabel(activeReferralCode.expiresAt)}
            </p>
          )}
          <div className="student-referrals__hero-actions">
            {activeReferralCode ? (
              <button
                className="student-referrals__share"
                type="button"
                onClick={() => shareReferralCode(activeReferralCode.code)}
              >
                <Icon name="share" size={16} /> Share Code
              </button>
            ) : (
              <button
                className="student-referrals__share"
                type="button"
                onClick={generateReferralCode}
                disabled={loading || !referralData || generating || stats.totalGenerated >= stats.totalLimit}
              >
                {generating ? 'Generating…' : 'Generate Referral Code'}
              </button>
            )}
            {activeReferralCode && (
              <button
                className="student-referrals__generate"
                type="button"
                onClick={generateReferralCode}
                disabled={loading || !referralData || generating || stats.totalGenerated >= stats.totalLimit}
              >
                {generating ? 'Generating…' : 'Generate another'}
              </button>
            )}
          </div>
          {stats.totalGenerated >= stats.totalLimit && (
            <p className="student-referrals__limit" role="status">
              You’ve reached your overall limit of 20 referral codes.
            </p>
          )}
        </div>
        <div className="student-referrals__hero-divider" aria-hidden="true" />
        <div className="student-referrals__invite">
          <div>
            <h1>Invite Friends, Earn More!</h1>
            <p>Share your referral code with friends. When they sign up, you’ll earn rewards and unlock more benefits.</p>
          </div>
          <svg className="student-referrals__gift-illustration" viewBox="0 0 180 145" fill="none" aria-hidden="true">
            <circle cx="92" cy="68" r="52" fill="#F2EECF" />
            <path d="M25 121c17-17 42-24 67-19 27-6 50 1 67 19" fill="#D9E8D9" />
            <path d="M49 66h86v59H49z" fill="#FFFDF7" stroke="#D6CDB8" strokeWidth="2" />
            <path d="M42 54h100v18H42z" fill="#F3D994" stroke="#D6CDB8" strokeWidth="2" />
            <path d="M84 54v71h17V54z" fill="#6BA58E" />
            <path d="M91 53c-23-1-31-13-24-20 8-7 22 3 24 20Zm2 0c1-21 17-28 24-19 7 9-8 19-24 19Z" fill="#4F967E" />
            <path d="M91 53c-23-1-31-13-24-20 8-7 22 3 24 20Zm2 0c1-21 17-28 24-19 7 9-8 19-24 19Z" stroke="#397C68" strokeWidth="2" />
            <path d="m151 35 9-8m-3 20 12-2m-26-23 2-11" stroke="#E2B74D" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      </section>

      <section className="student-referrals__summary" aria-label="Referral summary">
        {summary.map((item) => (
          <article className="student-stat" key={item.label}>
            <span className={`student-stat__icon is-${item.tone}`}><Icon name="users" size={18} /></span>
            <span className="student-stat__label">{item.label}</span>
            <strong className="student-stat__value">
              {referralData
                ? item.value
                : loading
                  ? <span className="student-page-skeleton" style={{ width: '48px', height: '16px' }} />
                  : '—'}
            </strong>
          </article>
        ))}
      </section>

      <section className="student-panel student-referrals__history" aria-labelledby="student-referral-history-title">
        <header className="student-referrals__history-heading">
          <h2 id="student-referral-history-title"><Icon name="clock" size={21} /> Referral History</h2>
          {referralCodes.length > 3 && (
            <button
              className="student-referrals__view-all"
              type="button"
              onClick={() => setShowAllCodes((showAll) => !showAll)}
            >
              {showAllCodes ? 'Show Less ↑' : 'View All →'}
            </button>
          )}
        </header>
        {loading && !referralData ? (
          <div className="student-referrals__loading" role="status" aria-label="Loading your referral history">
            <span className="student-page-skeleton" />
            <span className="student-page-skeleton" />
            <span className="student-page-skeleton" />
          </div>
        ) : referralCodes.length ? (
          <div className="student-referrals__table-wrap">
            <table className="student-referrals__table">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Generated On</th>
                  <th scope="col">Expires On</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleReferralCodes.map((code) => (
                  <tr key={code.code}>
                    <td><strong className="student-referrals__history-code">{code.code}</strong></td>
                    <td>{formatReferralDate(code.createdAt)}</td>
                    <td>{formatReferralDate(code.expiresAt)}</td>
                    <td>
                      <span className={`student-referral-card__status is-${code.status === 'active' && !isReferralCodeActive(code, expiryCheckTime) ? 'expired' : code.status}`}>
                        {code.status === 'active' && !isReferralCodeActive(code, expiryCheckTime) ? 'expired' : code.status}
                      </span>
                    </td>
                    <td>
                      {isReferralCodeActive(code, expiryCheckTime) ? (
                        <button
                          className="student-referrals__copy-row"
                          type="button"
                          aria-label={`Copy referral code ${code.code}`}
                          onClick={() => copyReferralCode(code.code)}
                        >
                          <Icon name="copy" size={15} /> {copiedCode === code.code ? 'Copied' : 'Copy'}
                        </button>
                      ) : <span className="student-referrals__no-action">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(false)
  const [isEnrolled, setIsEnrolled] = useState(false)
  const [courseEnrollment, setCourseEnrollment] = useState(null)
  const [error, setError] = useState('')
  const isCollegeStudent = user?.studentType === 'college' || Boolean(user?.collegeId)
  const courseCounts = course ? getCourseCounts(course) : { modules: 0, lessons: 0 }

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setCourse(null)
    setIsEnrolled(false)
    setCourseEnrollment(null)
    setError('')
    Promise.all([
      fetchPublishedCourses(onLogout, controller.signal),
      fetchMyEnrollments(onLogout, controller.signal),
    ])
      .then(([publishedCourses, enrollments]) => {
        const selectedCourse = publishedCourses.find((item) => String(item._id) === courseId)
        if (!selectedCourse) throw new Error('This course is not currently published or available.')
        const selectedEnrollment = enrollments.find((entry) => (
          String(entry.courseId?._id || entry.courseId) === courseId && entry.status !== 'cancelled'
        ))
        setIsEnrolled(Boolean(selectedEnrollment))
        setCourseEnrollment(selectedEnrollment ? { ...selectedEnrollment, courseId: selectedCourse } : null)
        setCourse(selectedCourse)
      })
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') {
          setError(loadError instanceof Error ? loadError.message : 'Course details could not be loaded.')
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [courseId, onLogout])

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
      const response = await fetchWithAuth(`${API_BASE_URL}/enrollments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ courseId }),
      }, API_BASE_URL, auth.token)
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok) throw new Error(result.message || 'You could not be enrolled in this course.')
      if (!result.enrollment?._id) throw new Error('The server did not confirm your enrollment.')
      const confirmedEnrollment = { ...result.enrollment, courseId: course }
      onLearningDataChanged()
      seedStudentCourseLearning(confirmedEnrollment)
      setCourseEnrollment(confirmedEnrollment)
      setIsEnrolled(true)
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
              {course.thumbnailUrl
                ? <img
                  className="student-course-details__thumbnail"
                  src={course.thumbnailUrl}
                  alt={`${course.title} course thumbnail`}
                />
                : <div className="student-course-details__thumbnail student-course-details__thumbnail--empty" aria-label="No course thumbnail">
                  <Icon name="book" size={34} />
                </div>}
              <div className="student-course-details__identity">
                <p className="student-course-details__category">
                  {course.category || 'Other'} <span>·</span> {course.difficulty?.replaceAll('-', ' ') || 'Beginner'}
                </p>
                <h1>{course.title}</h1>
                <span className="student-course-details__published">{isEnrolled ? 'Enrolled' : 'Published'}</span>
              </div>
              <div className="student-course-details__enroll">
                {isEnrolled
                  ? <Link
                    className="student-enrolled-course__continue"
                    to={`/student/course/${encodeURIComponent(courseId)}/learn`}
                    onClick={() => seedStudentCourseLearning(courseEnrollment)}
                  >
                    Get Started
                  </Link>
                  : isCollegeStudent
                  ? <p>Enrollment for this course is managed by your college administrator.</p>
                  : <button type="button" className="student-enrolled-course__continue" disabled={enrolling} onClick={enroll}>
                    {enrolling ? 'Enrolling…' : 'Enroll Now'}
                  </button>}
              </div>
            </header>
            {course.description && <p className="student-course-details__description">{course.description}</p>}
            {course.detailedDescription && course.detailedDescription !== course.description && (
              <p className="student-course-details__description student-course-details__description--detailed">
                {course.detailedDescription}
              </p>
            )}
            {!course.description && !course.detailedDescription && (
              <p className="student-course-details__description">No course description added yet.</p>
            )}
          </section>
          <section className="student-course-details__facts" aria-label="Course overview">
            <div><span>Difficulty</span><strong>{course.difficulty?.replaceAll('-', ' ') || 'Beginner'}</strong></div>
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
              const items = getModuleLearningItems(module, moduleIndex)
              return (
                <details className="student-course-details__module" key={moduleKey} open>
                  <summary className="student-course-details__module-summary">
                    <span className="student-course-details__module-heading">
                      <small>MODULE {moduleIndex + 1}</small>
                      <strong>{module.title}</strong>
                    </span>
                    <span className="student-course-details__module-count">
                      {items.length} {items.length === 1 ? 'item' : 'items'}
                      <span aria-hidden="true">⌄</span>
                    </span>
                  </summary>
                  {module.description && (
                    <p className="student-course-details__module-description">{module.description}</p>
                  )}
                  {items.length ? (
                    <ul className="student-course-details__module-items">
                      {items.map((item) => {
                        const durationMinutes = Math.ceil((Number(item.durationSeconds) || 0) / 60)
                        const itemDescription = item.type === 'video-lesson'
                          ? `Video Lesson${durationMinutes ? ` · ${durationMinutes} min` : ''}`
                          : item.type === 'quiz'
                            ? 'Quiz Checkpoint'
                            : item.type === 'assignment'
                              ? `Module Assessment${Number(item.points) ? ` · ${Number(item.points)} pts` : ''}`
                              : 'Course Resource'
                        const itemIcon = item.type === 'video-lesson'
                          ? 'play'
                          : item.type === 'note' ? 'folderOpen' : 'clipboardCheck'
                        return (
                          <li className="student-course-details__module-item" key={item._learningKey}>
                            <span className={`student-course-details__item-icon is-${item.type}`}>
                              <Icon name={itemIcon} size={16} />
                            </span>
                            <span className="student-course-details__item-copy">
                              <strong>{item.title}</strong>
                              <small>{itemDescription}</small>
                            </span>
                            <span className="student-course-details__item-status">Pending</span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : <p className="student-course-details__module-empty">No content has been added to this module.</p>}
                </details>
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
  const [initialEnrollment] = useState(() => getInitialStudentCourseLearningEnrollment(courseId))
  const [enrollment, setEnrollment] = useState(initialEnrollment)
  const [loading, setLoading] = useState(!initialEnrollment)
  const [error, setError] = useState('')
  const courseContentRequestSequence = useRef(0)
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const requestedLessonId = searchParams.get('lesson')
  const requestedActivityId = searchParams.get('activity')
  const requestedActivityType = searchParams.get('activityType')

  useEffect(() => {
    onCourseTitleChange(enrollment?.courseId?.title || '')
  }, [enrollment?.courseId?.title, onCourseTitleChange])

  useEffect(() => {
    let active = true
    const requestSequence = ++courseContentRequestSequence.current
    const initialCourseEnrollment = getInitialStudentCourseLearningEnrollment(courseId)
    setEnrollment(initialCourseEnrollment)
    setLoading(!initialCourseEnrollment)
    setError('')
    fetchStudentPageCourseContent(courseId, onLogout)
      .then(({ enrollment: courseEnrollment, assignmentSubmissions, quizAttempts }) => {
        if (!active || requestSequence !== courseContentRequestSequence.current) return
        const cacheKey = getStudentCourseContentCacheKey(courseId)
        if (cacheKey) studentCourseLearningSeeds.delete(cacheKey)
        setEnrollment({
          ...courseEnrollment,
          assignmentSubmissions,
          quizAttempts,
        })
      })
      .catch((loadError) => {
        if (active && requestSequence === courseContentRequestSequence.current) {
          setError(loadError instanceof Error ? loadError.message : 'Your course could not be loaded.')
        }
      })
      .finally(() => {
        if (active && requestSequence === courseContentRequestSequence.current) setLoading(false)
      })
    return () => {
      active = false
      if (requestSequence === courseContentRequestSequence.current) {
        courseContentRequestSequence.current += 1
      }
    }
  }, [courseId, onLogout])

  useEffect(() => {
    let active = true
    async function refreshProgress() {
      const requestSequence = ++courseContentRequestSequence.current
      const cacheKey = getStudentCourseContentCacheKey(courseId)
      if (cacheKey) studentCourseContentCache.delete(cacheKey)
      try {
        const content = await fetchStudentCourseContent(courseId, onLogout)
        if (!active || requestSequence !== courseContentRequestSequence.current) return
        const { enrollment: courseEnrollment, assignmentSubmissions, quizAttempts } = content
        if (cacheKey) studentCourseContentCache.set(cacheKey, { content, savedAt: Date.now() })
        setEnrollment({ ...courseEnrollment, assignmentSubmissions, quizAttempts })
        setError('')
      } catch (loadError) {
        if (active && requestSequence === courseContentRequestSequence.current) {
          setError(loadError instanceof Error ? loadError.message : 'Your course could not be loaded.')
        }
      }
    }
    window.addEventListener(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT, refreshProgress)
    return () => {
      active = false
      courseContentRequestSequence.current += 1
      window.removeEventListener(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT, refreshProgress)
    }
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
          requestedActivityId={requestedActivityId}
          requestedActivityType={requestedActivityType}
          contentSearch={contentSearch}
        />
      )}
    </StudentRoutePage>
  )
}

function StudentCourses({ user, onLogout }) {
  const [progressRefresh, setProgressRefresh] = useState(0)
  const [initialEnrollments] = useState(getCachedStudentPageEnrollments)
  const [enrollments, setEnrollments] = useState(initialEnrollments || [])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(initialEnrollments === null)
  const location = useLocation()
  const requestedFilter = new URLSearchParams(location.search).get('filter')
  const enrollmentFilter = ['enrolled', 'completed', 'active'].includes(requestedFilter) ? requestedFilter : ''

  useEffect(() => {
    const refreshProgress = () => {
      invalidateStudentLearningPageCaches()
      setProgressRefresh((refresh) => refresh + 1)
    }
    window.addEventListener(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT, refreshProgress)
    return () => window.removeEventListener(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT, refreshProgress)
  }, [])

  useEffect(() => {
    let active = true
    const cachedEnrollments = getCachedStudentPageEnrollments()
    if (cachedEnrollments) setEnrollments(cachedEnrollments)
    setLoading(cachedEnrollments === null)
    setError('')
    fetchStudentPageEnrollments(onLogout)
      .then((loadedEnrollments) => {
        if (!active) return
        const cacheKey = getStudentPageCacheKey()
        if (cacheKey) studentEnrollmentCache.set(cacheKey, { enrollments: loadedEnrollments, savedAt: Date.now() })
        setEnrollments(loadedEnrollments)
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load your enrolled courses.')
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onLogout, progressRefresh, user?.id])

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
    <StudentRoutePage title={pageTitle} showHeading className="student-courses-page">
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      {loading ? <EnrollmentCourseSkeletons /> : !error && (
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

function StudentLearningActivity({ onLogout, user }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [learningStreak, setLearningStreak] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchStudentLearningSummary(onLogout, controller.signal)
      .then((summary) => setLearningStreak(summary.learningStreak))
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError instanceof Error ? loadError.message : 'Learning activity could not be loaded.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [onLogout])

  return (
    <StudentRoutePage eyebrow="YOUR LEARNING ACTIVITY" title="Learning Streak">
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading your learning activity…</p> : !error && (
        <StudentLearningActivityPanel
          onLogout={onLogout}
          studentId={user?.id}
          learningStreak={learningStreak}
          streakLoading={false}
          showHeading={false}
        />
      )}
    </StudentRoutePage>
  )
}

function StudentLearningActivityPanel({
  onLogout,
  studentId,
  learningStreak,
  streakLoading,
  showHeading = true,
}) {
  const [calendar] = useState(() => getLearningActivityDateRanges())
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('current')
  const goalOptions = [30, 60, 90, 120]
  const goalStorageKey = `lms.learning-goal:${studentId || 'student'}`
  const [goalMinutes, setGoalMinutes] = useState(() => {
    const savedGoal = Number(localStorage.getItem(goalStorageKey))
    return goalOptions.includes(savedGoal) ? savedGoal : 60
  })

  useEffect(() => {
    const controller = new AbortController()
    fetchStudentLearningActivity(onLogout, calendar.start, calendar.end, controller.signal)
      .then((loadedDays) => {
        if (!controller.signal.aborted) {
          setDays(loadedDays)
          setError('')
        }
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Learning activity could not be loaded.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [calendar, onLogout])

  useEffect(() => {
    localStorage.setItem(goalStorageKey, String(goalMinutes))
  }, [goalMinutes, goalStorageKey])

  const activityByDate = new Map(days.map((day) => [day.date, day]))
  const weekDates = selectedWeek === 'current' ? calendar.currentWeek : calendar.previousWeek
  const weekData = weekDates.map((date) => activityByDate.get(date))
  const activityLoaded = !loading && !error
  const todayActivity = activityByDate.get(calendar.today)
  const totalWeekSeconds = activityLoaded
    ? weekData.reduce((total, day) => total + (day?.seconds || 0), 0)
    : null
  const averageDaySeconds = totalWeekSeconds === null ? null : totalWeekSeconds / 7
  const mostActiveDay = activityLoaded
    ? weekData.reduce((mostActive, day) => (
      day && (!mostActive || day.seconds > mostActive.seconds) ? day : mostActive
    ), null)
    : null
  const maxDaySeconds = Math.max(3600, ...weekData.map((day) => day?.seconds || 0))
  const todaySeconds = activityLoaded ? todayActivity?.seconds || 0 : null
  const goalProgress = todaySeconds === null
    ? 0
    : Math.min(100, Math.round((todaySeconds / (goalMinutes * 60)) * 100))
  const remainingGoalMinutes = todaySeconds === null
    ? null
    : Math.ceil(Math.max(0, goalMinutes * 60 - todaySeconds) / 60)

  return (
    <section
      className="student-learning-activity"
      aria-labelledby={showHeading ? 'student-learning-activity-title' : undefined}
      aria-label={showHeading ? undefined : 'Your learning activity'}
      aria-busy={loading}
    >
      {showHeading && (
        <header className="student-learning-activity__heading">
          <span className="student-eyebrow">YOUR LEARNING ACTIVITY</span>
          <h2 id="student-learning-activity-title">Your Learning Activity</h2>
          <p>Track your daily learning habits and weekly progress.</p>
        </header>
      )}
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}
      <div className="student-learning-activity__grid">
        <article className="student-learning-activity__card student-learning-activity__daily">
          <div className="student-learning-activity__card-heading">
            <div>
              <span className="student-eyebrow">TODAY’S HABIT</span>
              <h3>Daily Learning Summary</h3>
            </div>
            <label className="student-learning-activity__goal-select">
              <span>Goal:</span>
              <select value={goalMinutes} onChange={(event) => setGoalMinutes(Number(event.target.value))}>
                {goalOptions.map((minutes) => (
                  <option value={minutes} key={minutes}>{minutes} mins</option>
                ))}
              </select>
            </label>
          </div>
          <div className="student-learning-activity__daily-main">
            <div className="student-learning-activity__time">
              <strong>{todaySeconds === null ? '—' : formatLearningActivityDuration(todaySeconds)}</strong>
              <span>Total learning time today</span>
            </div>
            <div
              className="student-learning-activity__goal-ring"
              role="img"
              aria-label={todaySeconds === null
                ? 'Daily learning goal progress unavailable'
                : `${goalProgress}% of daily learning goal`}
              style={{ background: `conic-gradient(#4e8d78 ${goalProgress}%, #e7e5dc ${goalProgress}% 100%)` }}
            >
              <span><strong>{todaySeconds === null ? '—' : `${goalProgress}%`}</strong><small>GOAL</small></span>
            </div>
          </div>
          <div className="student-learning-activity__goal-copy">
            <span>{todaySeconds === null ? 'Daily goal progress unavailable' : `${Math.floor(todaySeconds / 60)} of ${goalMinutes} min daily goal`}</span>
            <strong>{remainingGoalMinutes === null ? '—' : `${remainingGoalMinutes} min to go`}</strong>
          </div>
          <div
            className="student-learning-activity__goal-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={goalMinutes}
            aria-valuenow={todaySeconds === null ? 0 : Math.min(goalMinutes, Math.floor(todaySeconds / 60))}
            aria-label="Daily learning goal"
          >
            <span style={{ width: `${goalProgress}%` }} />
          </div>
          <div className="student-learning-activity__daily-counts">
            <div>
              <span className="student-learning-activity__count-icon"><Icon name="check" size={17} /></span>
              <strong>{todaySeconds === null ? '—' : todayActivity?.lessonsCompleted || 0}</strong>
              <small>Lessons completed today</small>
            </div>
            <div>
              <span className="student-learning-activity__count-icon is-video"><Icon name="play" size={17} /></span>
              <strong>{todaySeconds === null ? '—' : todayActivity?.videosWatched || 0}</strong>
              <small>Videos watched today</small>
            </div>
          </div>
        </article>

        <article className="student-learning-activity__card student-learning-activity__weekly">
          <div className="student-learning-activity__card-heading">
            <div>
              <span className="student-eyebrow">7-DAY ACTIVITY</span>
              <h3>Weekly Learning Activity</h3>
            </div>
            <div className="student-learning-activity__week-switch" role="group" aria-label="Choose activity week">
              <button
                className={selectedWeek === 'current' ? 'is-selected' : ''}
                type="button"
                aria-pressed={selectedWeek === 'current'}
                onClick={() => setSelectedWeek('current')}
              >
                This Week
              </button>
              <button
                className={selectedWeek === 'previous' ? 'is-selected' : ''}
                type="button"
                aria-pressed={selectedWeek === 'previous'}
                onClick={() => setSelectedWeek('previous')}
              >
                Previous Week
              </button>
            </div>
          </div>
          <div className="student-learning-activity__chart" role="group" aria-label={`${selectedWeek === 'current' ? 'This week' : 'Previous week'} daily learning time`}>
            {weekDates.map((date, index) => {
              const day = weekData[index]
              const seconds = day?.seconds || 0
              const fillHeight = seconds ? Math.max(4, Math.min(100, (seconds / maxDaySeconds) * 100)) : 0
              const weekday = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
              return (
                <div className="student-learning-activity__day" key={date} role="img" aria-label={`${weekday}: ${activityLoaded ? formatLearningActivityDuration(seconds) : 'unavailable'}`}>
                  <div className="student-learning-activity__bar"><span style={{ height: `${fillHeight}%` }} /></div>
                  <small>{weekday}</small>
                </div>
              )
            })}
          </div>
          <div className="student-learning-activity__week-stats">
            <div><small>{selectedWeek === 'current' ? 'Total this week' : 'Total last week'}</small><strong>{totalWeekSeconds === null ? '—' : formatLearningActivityMinutes(totalWeekSeconds)}</strong></div>
            <div><small>Daily average</small><strong>{averageDaySeconds === null ? '—' : `${formatLearningActivityMinutes(averageDaySeconds)} / day`}</strong></div>
            <div><small>Most active day</small><strong>{mostActiveDay?.seconds ? new Date(`${mostActiveDay.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }) : '—'}</strong></div>
          </div>
        </article>
      </div>
      <div className="student-learning-activity__streak">
        <span><Icon name="spark" size={17} /> {streakLoading ? '—' : learningStreak} {learningStreak === 1 ? 'Day' : 'Days'} Streak</span>
      </div>
    </section>
  )
}

function formatLearningActivityDuration(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const remainder = totalSeconds % 60
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

function formatLearningActivityMinutes(seconds) {
  return `${Math.floor(Math.max(0, seconds) / 60)}m`
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
        const response = await fetchWithAuth(`${API_BASE_URL}/enrollments/me`, {
          headers: { Authorization: `Bearer ${auth.token}` },
          signal: controller.signal,
        }, API_BASE_URL, auth.token)
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
        const response = await fetchWithAuth(`${API_BASE_URL}/enrollments/me`, {
          headers: { Authorization: `Bearer ${auth.token}` },
          signal: controller.signal,
        }, API_BASE_URL, auth.token)
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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef(null)
  const [publishedCourseCategories, setPublishedCourseCategories] = useState([])
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
  const isResultsPage = location.pathname === '/student/results'
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
      Certificates: 'award',
      'My Referrals': 'users',
      'My Profile': 'userRound',
      Settings: 'settings',
      'Help Center': 'circleHelp',
    }[currentPage.label]
    : isHelpPage ? 'circleHelp' : secondaryPage?.icon || 'layoutDashboard'
  const firstName = user?.fullName?.trim().split(/\s+/)[0] || 'Student'
  const exploreCategories = [
    ...categories,
    ...publishedCourseCategories
      .filter((name) => !categories.some((category) => (
        normalizeCourseCategory(category.label) === normalizeCourseCategory(name)
      )))
      .map((label) => ({ label, icon: 'book' })),
  ]
  const initials = user?.fullName
    ? user.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    : 'S'
  const completionPercentage = learningSummary.completionPercentage

  useEffect(() => {
    if (!profileMenuOpen) return undefined

    const closeOnOutsideClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setProfileMenuOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [profileMenuOpen])

  useEffect(() => {
    const refreshProgress = () => {
      invalidateStudentLearningPageCaches()
      setLearningSummaryRefresh((refresh) => refresh + 1)
    }
    window.addEventListener(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT, refreshProgress)
    return () => window.removeEventListener(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT, refreshProgress)
  }, [])

  useEffect(() => {
    setProfileMenuOpen(false)
  }, [location.pathname])

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
    navigate(path)
  }

  function refreshLearningSummary() {
    invalidateStudentLearningPageCaches()
    setLearningSummaryRefresh((refresh) => refresh + 1)
    window.dispatchEvent(new Event(STUDENT_LEARNING_PROGRESS_UPDATED_EVENT))
  }

  return (
    <div className={`student-dashboard${sidebarOpen ? ' is-sidebar-open' : ''}${isCourseLearningPage ? ' is-course-learning' : ''}${isResultsPage ? ' is-results-page' : ''}`}>
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
            </Link>
          ))}
        </nav>
      </aside>

      <main className="student-main" id="student-overview">
        <header className="student-topbar">
          <button
            className="student-icon-button student-menu-toggle"
            type="button"
            aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={sidebarOpen}
            aria-controls="student-navigation"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <Icon name="menu" />
          </button>
          <div className={`student-breadcrumb student-page-heading${isCourseLearningPage ? ' student-course-learning-topbar__identity' : ''}`}>
            {isCourseLearningPage ? (
              <strong>{courseLearningTitle || 'Course learning'}</strong>
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
            <StudentNotificationBell onLogout={onLogout} />
            <div className={`student-profile-menu${profileMenuOpen ? ' is-open' : ''}`} ref={profileMenuRef}>
              <button
                className="student-profile-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                aria-controls="student-profile-dropdown"
                onClick={() => setProfileMenuOpen((isOpen) => !isOpen)}
              >
                <span className="student-avatar">{initials}</span>
                <span className="student-profile-trigger__copy">
                  <strong>{user?.fullName || 'Student'}</strong><small>Student</small>
                </span>
              </button>
              {profileMenuOpen && (
                <div className="student-profile-dropdown" id="student-profile-dropdown" role="menu">
                  <button
                    className="student-profile-dropdown__logout"
                    type="button"
                    role="menuitem"
                    onClick={onLogout}
                  >
                    <Icon name="logout" size={16} /> Logout
                  </button>
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
                  {exploreCategories.map((category) => (
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

              <section className="student-panel student-dashboard-my-courses" aria-labelledby="student-courses-eyebrow">
                <div className="student-section-heading">
                  <div><span className="student-eyebrow" id="student-courses-eyebrow">PICK UP WHERE YOU LEFT OFF</span></div>
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
                onCategoriesLoaded={setPublishedCourseCategories}
                selectedCategory={selectedCourseCategory}
              />

              <div className="student-two-column">
                <section className="student-panel" aria-labelledby="student-assignments-title">
                  <div className="student-section-heading">
                    <div><span className="student-eyebrow">STAY ON TRACK</span><h2 id="student-assignments-title">Upcoming assignments</h2></div>
                    <Link className="student-section-link student-section-link--muted" to="/student/assignments">View all</Link>
                  </div>
                  <StudentDashboardUpcomingAssignments onLogout={onLogout} />
                </section>
                <section className="student-panel student-announcements" aria-labelledby="student-announcements-title">
                  <div className="student-section-heading">
                    <div><span className="student-eyebrow">FROM YOUR LEARNING COMMUNITY</span><h2 id="student-announcements-title">Announcements</h2></div>
                    <Link className="student-section-link student-section-link--muted" to="/student/announcements">
                      Updates <Icon name="arrow" size={15} />
                    </Link>
                  </div>
                  <NotificationFeed role="student" onLogout={onLogout} />
                </section>
              </div>

              <StudentLearningActivityPanel
                onLogout={onLogout}
                studentId={user?.id}
                learningStreak={learningSummary.learningStreak}
                streakLoading={learningSummaryLoading || Boolean(learningSummaryError)}
              />

              <section className="student-tools" aria-labelledby="student-tools-title">
                <div className="student-section-heading">
                  <div><span className="student-eyebrow">MORE FOR YOUR JOURNEY</span><h2 id="student-tools-title">Student tools</h2></div>
                </div>
                <div className="student-tools-grid">
                  {tools.map((tool) => (
                    <Link className="student-tool-card" id={tool.id} key={tool.id} to={tool.path}>
                      <span className="student-tool-card__icon"><Icon name={tool.icon} size={19} /></span>
                      <span className="student-tool-card__copy">
                        <h3>{tool.title}</h3>
                        <p>{tool.description}</p>
                      </span>
                      <span className="student-tool-card__arrow" aria-hidden="true"><Icon name="arrow" size={18} /></span>
                    </Link>
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
                <StudentAssignmentsPage onLogout={onLogout} onLearningDataChanged={refreshLearningSummary} />
              } />
              <Route path="/student/results" element={
                <StudentResultsPage onLogout={onLogout} />
              } />
              <Route path="/student/resources" element={
                <StudentResourcesPage onLogout={onLogout} />
              } />
              <Route path="/student/certificates" element={
                <StudentCertificatesPage onLogout={onLogout} />
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
              <Route path="/student/learning-activity" element={<StudentLearningActivity onLogout={onLogout} user={user} />} />
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
              <Route path="/student/help/complaint" element={<SubmitComplaintPage />} />
              <Route path="/student/help/submit-ticket" element={<SubmitSupportTicketPage />} />
              <Route path="/student/help/faqs" element={<SupportFaqPage />} />
              <Route path="/student/help/requests" element={<SupportRequestsPage />} />
              <Route path="/student/help/requests/:ticketId" element={<SupportTicketDetailPage />} />
              <Route path="/student/announcements" element={
                <StudentNotificationsPage onLogout={onLogout} />
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
