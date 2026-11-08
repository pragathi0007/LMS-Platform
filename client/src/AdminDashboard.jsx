import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CollegesManagement, CourseManagement, EnrollmentManagement } from './AdminDataViews.jsx'
import { isInvalidSessionResponse } from './auth-session.js'
import IndependentStudentApprovals from './IndependentStudentApprovals.jsx'
import NotificationFeed from './NotificationFeed.jsx'
import { readStudentFile } from './student-file.js'
import './AdminDashboard.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

const navigation = [
  { id: 'overview', label: 'Overview', icon: '◫' },
  { id: 'students', label: 'Students', group: 'User Management', icon: '♙' },
  { id: 'independent-approvals', label: 'Independent Student Approvals', group: 'User Management', icon: '✓' },
  { id: 'colleges', label: 'Colleges', icon: '▦' },
  { id: 'courses', label: 'Courses', group: 'Course Management', icon: '▤' },
  { id: 'enrollments', label: 'Enrollments', icon: '⇄' },
  { id: 'reports', label: 'Reports & Analytics', icon: '⌁' },
  { id: 'notifications', label: 'Notifications', icon: '♧' },
  { id: 'feedback', label: 'Feedback & Complaints', icon: '☷' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

const administrativeActions = [
  {
    view: 'overview',
    title: 'Review dashboard overview',
    description: 'View platform totals and recent administrative activity.',
    keywords: 'overview dashboard statistics activity',
  },
  {
    view: 'students',
    title: 'Import college students',
    description: 'Import college student records from a CSV file.',
    keywords: 'student import college csv',
  },
  {
    view: 'independent-approvals',
    title: 'Review independent student applications',
    description: 'Approve or reject external student account applications.',
    keywords: 'independent student approval pending applications',
  },
  {
    view: 'colleges',
    title: 'Manage colleges and Sub-Admins',
    description: 'Create colleges and manage college administration.',
    keywords: 'college create sub-admin administrator',
  },
  {
    view: 'courses',
    title: 'Manage course creation and deadlines',
    description: 'Create courses and manage course content and due dates.',
    keywords: 'course creation tasks deadlines assignments',
  },
  {
    view: 'enrollments',
    title: 'Review course enrollments',
    description: 'Review current student-course enrollment records.',
    keywords: 'enrollment review student course',
  },
  {
    view: 'reports',
    title: 'Export student and college reports',
    description: 'Open reporting tools for colleges and students.',
    keywords: 'report export analytics',
  },
  {
    view: 'notifications',
    title: 'Open notifications',
    description: 'View the dashboard notifications section.',
    keywords: 'notification alerts',
  },
  {
    view: 'feedback',
    title: 'Review feedback and complaints',
    description: 'Open the feedback and complaints section.',
    keywords: 'feedback complaints',
  },
  {
    view: 'settings',
    title: 'Open administrator settings',
    description: 'Open the administrator settings section.',
    keywords: 'settings administrator profile',
  },
]

const reportColumns = [
  ['recordType', 'Record type'],
  ['studentId', 'Student ID'],
  ['studentName', 'Student name'],
  ['studentEmail', 'Student email'],
  ['studentType', 'Student type'],
  ['studentStatus', 'Student status'],
  ['registeredAt', 'Registration date'],
  ['collegeId', 'College ID'],
  ['collegeName', 'College name'],
  ['collegeCode', 'College code'],
  ['courseId', 'Course ID'],
  ['courseTitle', 'Course'],
  ['enrollmentStatus', 'Enrollment status'],
  ['enrolledAt', 'Enrollment date'],
  ['collegeStatus', 'College status'],
  ['contactName', 'College contact'],
  ['contactEmail', 'College contact email'],
  ['contactPhone', 'College contact phone'],
  ['totalCollegeStudents', 'College students'],
  ['totalSubAdmins', 'Sub-Admins'],
  ['totalEnrollments', 'College enrollments'],
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
  const badgeStatus = ['invitation_pending', 'pending approval'].includes(normalizedStatus)
    ? 'pending'
    : normalizedStatus
  const label = {
    'pending approval': 'Pending Approval',
    invitation_pending: 'Pending',
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
  }[normalizedStatus] || normalizedStatus.replaceAll('_', ' ')
  return <span className={`admin-status admin-status--${badgeStatus}`}>{label}</span>
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
      <svg className="admin-metric__trend" viewBox="0 0 76 42" aria-hidden="true">
        <path d="M3 31h15l9 7 17-18h12L73 3" />
        <path d="M64 3h9v9" />
      </svg>
    </article>
  )
}

function getEngagementPoints(records, period) {
  const countsByPeriod = new Map(records.map(({ date, count }) => [date, count]))
  const now = new Date()
  now.setUTCHours(0, 0, 0, 0)
  const isMonthly = period === '3m' || period === '6m'
  const length = period === '7d' ? 7 : period === '30d' ? 30 : period === '3m' ? 3 : 6

  return Array.from({ length }, (_, index) => {
    if (isMonthly) {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - length + 1 + index, 1))
      const key = month.toISOString().slice(0, 7)
      return {
        date: key,
        label: new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(month),
        count: countsByPeriod.get(key) || 0,
      }
    }

    const date = new Date(now)
    date.setUTCDate(now.getUTCDate() - length + 1 + index)
    const key = date.toISOString().slice(0, 10)
    return {
      date: key,
      label: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date),
      count: countsByPeriod.get(key) || 0,
    }
  })
}

function createSmoothLinePath(points) {
  if (!points.length) return ''
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]
    const beforePrevious = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 2)]
    const span = point.x - previous.x
    const controlOneY = previous.y + ((point.y - beforePrevious.y) / 6)
    const controlTwoY = point.y - ((next.y - previous.y) / 6)
    return `${path} C ${previous.x + span / 3} ${controlOneY}, ${point.x - span / 3} ${controlTwoY}, ${point.x} ${point.y}`
  }, `M ${points[0].x} ${points[0].y}`)
}

function EngagementChart({ engagement, period }) {
  const points = getEngagementPoints(engagement, period)
  const maxCount = Math.max(0, ...points.map(({ count }) => count))
  const maxValue = Math.max(4, Math.ceil(maxCount / 4) * 4)
  const chart = { left: 48, right: 670, top: 16, bottom: 188 }
  const plottedPoints = points.map((point, index) => ({
    ...point,
    x: chart.left + (index / Math.max(1, points.length - 1)) * (chart.right - chart.left),
    y: chart.bottom - (point.count / maxValue) * (chart.bottom - chart.top),
  }))
  const linePath = createSmoothLinePath(plottedPoints)
  const areaPath = `${linePath} L ${chart.right} ${chart.bottom} L ${chart.left} ${chart.bottom} Z`
  const tickCount = Math.min(points.length, period === '7d' ? 7 : period === '30d' ? 6 : points.length)
  const xTickIndexes = Array.from({ length: tickCount }, (_, index) => (
    Math.round(index * (points.length - 1) / Math.max(1, tickCount - 1))
  ))
  const periodLabel = { '7d': 'last 7 days', '30d': 'last 30 days', '3m': 'last 3 months', '6m': 'last 6 months' }[period]

  return (
    <div className="admin-engagement-chart">
      <svg
        className="admin-engagement-chart__svg"
        viewBox="0 0 680 238"
        role="img"
        aria-label={`Enrollments over the ${periodLabel}`}
      >
        <defs>
          <linearGradient id="admin-engagement-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" className="admin-engagement-chart__gradient-start" />
            <stop offset="100%" className="admin-engagement-chart__gradient-end" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((step) => {
          const value = (maxValue / 4) * step
          const y = chart.bottom - (step / 4) * (chart.bottom - chart.top)
          return (
            <g key={step}>
              <line x1={chart.left} x2={chart.right} y1={y} y2={y} className="admin-chart-gridline" />
              <text x={chart.left - 10} y={y + 3} textAnchor="end" className="admin-engagement-chart__axis-label">
                {value}
              </text>
            </g>
          )
        })}
        <text
          className="admin-engagement-chart__axis-title"
          transform="translate(12 116) rotate(-90)"
          textAnchor="middle"
        >Enrollments</text>
        <path d={areaPath} className="admin-engagement-chart__area" />
        <path d={linePath} className="admin-engagement-chart__line" />
        {plottedPoints.map((point) => (
          <circle
            key={point.date}
            cx={point.x}
            cy={point.y}
            r="3.5"
            className="admin-engagement-chart__marker"
          >
            <title>{`${point.label}: ${point.count} enrollment${point.count === 1 ? '' : 's'}`}</title>
          </circle>
        ))}
        {xTickIndexes.map((index) => {
          const point = plottedPoints[index]
          return (
            <text
              key={point.date}
              x={point.x}
              y="213"
              textAnchor="middle"
              className="admin-engagement-chart__axis-label"
            >
              {point.label}
            </text>
          )
        })}
        <text x={(chart.left + chart.right) / 2} y="233" textAnchor="middle" className="admin-engagement-chart__axis-title">
          {period === '3m' || period === '6m' ? 'Month' : 'Date'}
        </text>
      </svg>
    </div>
  )
}

function CourseCompletionChart({ courseCompletion }) {
  const completed = courseCompletion?.completed || 0
  const inProgress = courseCompletion?.inProgress || 0
  const total = completed + inProgress
  const completionAngle = total ? (completed / total) * 360 : 0

  if (!total) {
    return (
      <EmptyState title="No completion data available">
        Course completion will appear when learner enrollment records are available.
      </EmptyState>
    )
  }

  return (
    <div className="admin-completion">
      <div
        className="admin-completion__donut"
        style={{ '--completion-angle': `${completionAngle}deg` }}
        role="img"
        aria-label={`${completed} completed enrollments and ${inProgress} active enrollments`}
      >
        <span>{Math.round((completed / total) * 100)}%</span>
        <small>complete</small>
      </div>
      <div className="admin-completion__legend">
        <div><span className="admin-completion__swatch is-completed" /><span>Completed</span><strong>{completed}</strong></div>
        <div><span className="admin-completion__swatch is-progress" /><span>Active</span><strong>{inProgress}</strong></div>
        <small>Based on enrollment status</small>
      </div>
    </div>
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

function StudentManagementTable({ students, onViewDetails }) {
  if (!students.length) {
    return (
      <EmptyState title="No students found">
        No student records match the current search and filters.
      </EmptyState>
    )
  }
  return (
    <div className="admin-table-wrap">
      <table className="admin-table admin-students-table__table">
        <thead>
          <tr>
            <th>Student Name</th>
            <th>Role / Student Type</th>
            <th>Registration Date</th>
            <th>Status</th>
            <th>View Details</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student._id}>
              <td>
                <span className="admin-table__name">{student.fullName || 'Unnamed student'}</span>
                <span className="admin-table__email">{student.email}</span>
              </td>
              <td>Student · {student.studentType === 'college' ? 'College' : 'Independent'}</td>
              <td>{formatDate(student.createdAt)}</td>
              <td><StatusBadge status={
                student.studentType === 'independent'
                  ? student.approvalStatus === 'pending'
                    ? 'Pending Approval'
                    : student.approvalStatus || student.status
                  : student.status
              } /></td>
              <td>
                <button
                  type="button"
                  className="admin-text-button"
                  onClick={() => onViewDetails(student)}
                >View details</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CourseRegistrationsTable({ courses }) {
  if (!courses.length) {
    return <EmptyState title="No course registrations yet">Created courses will appear here when available.</EmptyState>
  }
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr><th>Course</th><th>Status</th><th>Registration date</th></tr>
        </thead>
        <tbody>
          {courses.map((course) => (
            <tr key={course._id}>
              <td><span className="admin-table__name">{course.title || 'Untitled course'}</span></td>
              <td><StatusBadge status={course.status} /></td>
              <td>{formatDate(course.createdAt)}</td>
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
  const [engagementPeriod, setEngagementPeriod] = useState('30d')
  const [engagement, setEngagement] = useState([])
  const [isLoadingEngagement, setIsLoadingEngagement] = useState(true)
  const [engagementError, setEngagementError] = useState('')
  const [engagementRetry, setEngagementRetry] = useState(0)
  const [activeView, setActiveView] = useState('overview')
  const [registrationTab, setRegistrationTab] = useState('all')
  const [studentSearch, setStudentSearch] = useState('')
  const [studentFilter, setStudentFilter] = useState('all')
  const [approvalFilter, setApprovalFilter] = useState('all')
  const [studentPage, setStudentPage] = useState(1)
  const [students, setStudents] = useState([])
  const [studentTotal, setStudentTotal] = useState(0)
  const [isLoadingStudents, setIsLoadingStudents] = useState(false)
  const [studentsError, setStudentsError] = useState('')
  const [studentsRetry, setStudentsRetry] = useState(0)
  const [studentActionMessage, setStudentActionMessage] = useState('')
  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false)
  const [isCreatingStudent, setIsCreatingStudent] = useState(false)
  const [studentCreateError, setStudentCreateError] = useState('')
  const [studentDetails, setStudentDetails] = useState(null)
  const [studentDetailsError, setStudentDetailsError] = useState('')
  const [studentDetailsLoading, setStudentDetailsLoading] = useState(false)
  const [studentDetailsRetry, setStudentDetailsRetry] = useState(0)
  const [studentToEdit, setStudentToEdit] = useState(null)
  const [studentEditForm, setStudentEditForm] = useState({ fullName: '', email: '', username: '' })
  const [studentEditError, setStudentEditError] = useState('')
  const [isSavingStudentEdit, setIsSavingStudentEdit] = useState(false)
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [studentDeleteError, setStudentDeleteError] = useState('')
  const [isDeletingStudent, setIsDeletingStudent] = useState(false)
  const [studentManageAction, setStudentManageAction] = useState('')
  const [studentManageSearch, setStudentManageSearch] = useState('')
  const [studentManageStudents, setStudentManageStudents] = useState([])
  const [isLoadingManageStudents, setIsLoadingManageStudents] = useState(false)
  const [studentManageError, setStudentManageError] = useState('')
  const [studentForm, setStudentForm] = useState({
    fullName: '',
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    studentType: 'independent',
    studentId: '',
    collegeId: '',
  })
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [singleDataMenuOpen, setSingleDataMenuOpen] = useState(false)
  const [bulkDataMenuOpen, setBulkDataMenuOpen] = useState(false)
  const [bulkDataAction, setBulkDataAction] = useState('')
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const searchInputRef = useRef(null)
  const [colleges, setColleges] = useState([])
  const [reportColleges, setReportColleges] = useState([])
  const [reportCollegesError, setReportCollegesError] = useState('')
  const [isLoadingReportColleges, setIsLoadingReportColleges] = useState(false)
  const [selectedCollegeId, setSelectedCollegeId] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportType, setReportType] = useState('all')
  const [reportCollegeId, setReportCollegeId] = useState('')
  const [reportStudentQuery, setReportStudentQuery] = useState('')
  const [reportStudentResults, setReportStudentResults] = useState([])
  const [selectedReportStudent, setSelectedReportStudent] = useState(null)
  const [reportLookupLoading, setReportLookupLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [isExportingReport, setIsExportingReport] = useState(false)
  const [studentCsv, setStudentCsv] = useState(null)
  const [studentCsvText, setStudentCsvText] = useState('')
  const [studentImportPreview, setStudentImportPreview] = useState(null)
  const [isPreviewingStudentImport, setIsPreviewingStudentImport] = useState(false)
  const [collegeLoadError, setCollegeLoadError] = useState('')
  const [studentImportError, setStudentImportError] = useState('')
  const [studentImportResult, setStudentImportResult] = useState(null)
  const [isLoadingColleges, setIsLoadingColleges] = useState(false)
  const [isImportingStudents, setIsImportingStudents] = useState(false)
  const [bulkCollegeId, setBulkCollegeId] = useState('')
  const [bulkStudents, setBulkStudents] = useState([])
  const [bulkStudentIds, setBulkStudentIds] = useState([])
  const [bulkStudentsError, setBulkStudentsError] = useState('')
  const [isLoadingBulkStudents, setIsLoadingBulkStudents] = useState(false)
  const [bulkStudentChanges, setBulkStudentChanges] = useState({ department: '', batch: '' })
  const [bulkEditPreview, setBulkEditPreview] = useState(null)
  const [isSavingBulkEdit, setIsSavingBulkEdit] = useState(false)
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false)
  const [isDeletingBulkStudents, setIsDeletingBulkStudents] = useState(false)

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
    if (activeView !== 'overview') return undefined
    const controller = new AbortController()

    async function loadEngagement() {
      setIsLoadingEngagement(true)
      setEngagementError('')
      try {
        const storedAuth = sessionStorage.getItem('lms.auth')
        const auth = storedAuth ? JSON.parse(storedAuth) : null
        if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
          onLogout()
          return
        }
        const params = new URLSearchParams({ period: engagementPeriod })
        const response = await fetch(`${API_BASE_URL}/admin/engagement?${params}`, {
          headers: { Authorization: 'Bearer ' + auth.token },
          signal: controller.signal,
        })
        if (response.status === 401 || response.status === 403) {
          onLogout()
          return
        }
        const result = await readResponse(response, onLogout)
        if (!Array.isArray(result.engagement) || result.period !== engagementPeriod) {
          throw new Error('The server returned invalid enrollment activity data.')
        }
        setEngagement(result.engagement)
      } catch (error) {
        if (error.name !== 'AbortError') {
          if (error instanceof SyntaxError) {
            onLogout()
            return
          }
          setEngagementError(error instanceof Error ? error.message : 'Unable to load enrollment activity.')
          setEngagement([])
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingEngagement(false)
      }
    }

    loadEngagement()
    return () => controller.abort()
  }, [activeView, engagementPeriod, engagementRetry, onLogout])

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

  useEffect(() => {
    if (activeView !== 'students') return undefined
    const controller = new AbortController()

    async function loadStudents() {
      setIsLoadingStudents(true)
      setStudentsError('')
      try {
        const storedAuth = sessionStorage.getItem('lms.auth')
        const auth = storedAuth ? JSON.parse(storedAuth) : null
        if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
          onLogout()
          return
        }
        const params = new URLSearchParams({
          page: String(studentPage),
          pageSize: '25',
          tab: registrationTab,
          filterType: ['independent', 'college'].includes(studentFilter) ? studentFilter : 'all',
          approvalStatus: approvalFilter,
          search: studentSearch.trim(),
        })
        if (studentFilter.startsWith('college-name:')) {
          params.set('collegeId', studentFilter.slice(studentFilter.indexOf(':') + 1))
        }
        const response = await fetch(`${API_BASE_URL}/admin/students?${params}`, {
          headers: { Authorization: 'Bearer ' + auth.token },
          signal: controller.signal,
        })
        if (response.status === 401 || response.status === 403) {
          onLogout()
          return
        }
        const result = await readResponse(response, onLogout)
        if (!Array.isArray(result.students) || !Number.isInteger(result.total)) {
          throw new Error('The server returned invalid student records.')
        }
        setStudents(result.students)
        setStudentTotal(result.total)
      } catch (error) {
        if (error.name !== 'AbortError') {
          if (error instanceof SyntaxError) {
            onLogout()
            return
          }
          setStudentsError(error instanceof Error ? error.message : 'Unable to load students.')
          setStudents([])
          setStudentTotal(0)
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingStudents(false)
      }
    }

    loadStudents()
    return () => controller.abort()
  }, [activeView, approvalFilter, onLogout, registrationTab, studentFilter, studentPage, studentSearch, studentsRetry])

  useEffect(() => {
    if (!studentManageAction) {
      setStudentManageStudents([])
      setStudentManageError('')
      setIsLoadingManageStudents(false)
      return undefined
    }

    const controller = new AbortController()
    async function findManageStudents() {
      setIsLoadingManageStudents(true)
      setStudentManageError('')
      try {
        const storedAuth = sessionStorage.getItem('lms.auth')
        const auth = storedAuth ? JSON.parse(storedAuth) : null
        if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
          onLogout()
          return
        }
        const params = new URLSearchParams({
          page: '1',
          pageSize: '25',
          tab: 'all',
          filterType: 'all',
          search: studentManageSearch.trim(),
        })
        const response = await fetch(`${API_BASE_URL}/admin/students?${params}`, {
          headers: { Authorization: 'Bearer ' + auth.token },
          signal: controller.signal,
        })
        if (response.status === 401 || response.status === 403) {
          onLogout()
          return
        }
        const result = await readResponse(response, onLogout)
        if (!Array.isArray(result.students)) {
          throw new Error('The server returned invalid student records.')
        }
        setStudentManageStudents(result.students)
      } catch (error) {
        if (error.name !== 'AbortError') {
          setStudentManageError(error instanceof Error ? error.message : 'Unable to find students.')
          setStudentManageStudents([])
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingManageStudents(false)
      }
    }

    findManageStudents()
    return () => controller.abort()
  }, [onLogout, studentManageAction, studentManageSearch])

  useEffect(() => {
    if (!['edit', 'delete'].includes(bulkDataAction) || !bulkCollegeId) {
      setBulkStudents([])
      setBulkStudentIds([])
      setBulkStudentsError('')
      setIsLoadingBulkStudents(false)
      return undefined
    }

    const controller = new AbortController()
    async function loadCollegeStudents() {
      setIsLoadingBulkStudents(true)
      setBulkStudentsError('')
      setBulkStudents([])
      setBulkStudentIds([])
      try {
        const storedAuth = sessionStorage.getItem('lms.auth')
        const auth = storedAuth ? JSON.parse(storedAuth) : null
        if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
          onLogout()
          return
        }
        const allStudents = []
        let total = 0
        let page = 1
        do {
          const params = new URLSearchParams({
            page: String(page),
            pageSize: '100',
            tab: 'college',
            filterType: 'all',
            collegeId: bulkCollegeId,
          })
          const response = await fetch(`${API_BASE_URL}/admin/students?${params}`, {
            headers: { Authorization: 'Bearer ' + auth.token },
            signal: controller.signal,
          })
          if (response.status === 401 || response.status === 403) {
            onLogout()
            return
          }
          const result = await readResponse(response, onLogout)
          if (!Array.isArray(result.students) || !Number.isInteger(result.total)) {
            throw new Error('The server returned invalid college student records.')
          }
          allStudents.push(...result.students)
          total = result.total
          page += 1
        } while (allStudents.length < total)
        if (!controller.signal.aborted) setBulkStudents(allStudents)
      } catch (error) {
        if (error.name !== 'AbortError') {
          setBulkStudentsError(error instanceof Error ? error.message : 'Unable to load college students.')
          setBulkStudents([])
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingBulkStudents(false)
      }
    }

    loadCollegeStudents()
    return () => controller.abort()
  }, [bulkCollegeId, bulkDataAction, onLogout])

  const registrations = overview?.recentRegistrations || []
  const recentCourses = overview?.recentCourses || []
  const shownRegistrations = useMemo(
    () => registrations.filter((user) => (
      user.role === 'student' &&
      (registrationTab === 'all' || user.studentType === registrationTab)
    )),
    [registrations, registrationTab],
  )
  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []
    return administrativeActions.filter((action) => (
      `${action.title} ${action.description} ${action.keywords}`.toLowerCase().includes(query)
    ))
  }, [search])

  useEffect(() => {
    if (mobileSearchOpen) searchInputRef.current?.focus()
  }, [mobileSearchOpen])

  useEffect(() => {
    if (!reportOpen) return undefined
    function closeReportOnEscape(event) {
      if (event.key === 'Escape' && !isExportingReport) setReportOpen(false)
    }
    window.addEventListener('keydown', closeReportOnEscape)
    return () => window.removeEventListener('keydown', closeReportOnEscape)
  }, [isExportingReport, reportOpen])

  useEffect(() => {
    if (!isStudentModalOpen && !selectedStudent && !studentToEdit && !studentToDelete &&
      !studentManageAction && !isBulkDeleteConfirmOpen) return undefined
    function closeStudentDialogOnEscape(event) {
      if (event.key === 'Escape' && !isCreatingStudent && !isSavingStudentEdit && !isDeletingStudent) {
        setIsStudentModalOpen(false)
        setSelectedStudent(null)
        setStudentToEdit(null)
        setStudentToDelete(null)
        setStudentManageAction('')
        setIsBulkDeleteConfirmOpen(false)
      }
    }
    window.addEventListener('keydown', closeStudentDialogOnEscape)
    return () => window.removeEventListener('keydown', closeStudentDialogOnEscape)
  }, [isBulkDeleteConfirmOpen, isCreatingStudent, isDeletingStudent, isSavingStudentEdit, isStudentModalOpen, selectedStudent, studentManageAction, studentToDelete, studentToEdit])

  useEffect(() => {
    if (!selectedStudent) {
      setStudentDetails(null)
      setStudentDetailsError('')
      setStudentDetailsLoading(false)
      return undefined
    }

    const controller = new AbortController()
    async function loadStudentDetails() {
      setStudentDetails(null)
      setStudentDetailsError('')
      setStudentDetailsLoading(true)
      try {
        const storedAuth = sessionStorage.getItem('lms.auth')
        const auth = storedAuth ? JSON.parse(storedAuth) : null
        if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
          onLogout()
          return
        }
        const params = new URLSearchParams({ studentType: selectedStudent.studentType })
        const response = await fetch(
          `${API_BASE_URL}/admin/students/${encodeURIComponent(selectedStudent._id)}/details?${params}`,
          {
            headers: { Authorization: 'Bearer ' + auth.token },
            signal: controller.signal,
          },
        )
        if (response.status === 401 || response.status === 403) {
          onLogout()
          return
        }
        const result = await readResponse(response, onLogout)
        if (!result.student || !result.summary || !Array.isArray(result.courseProgress)) {
          throw new Error('The server returned incomplete student detail data.')
        }
        setStudentDetails(result)
      } catch (error) {
        if (error.name !== 'AbortError') {
          if (error instanceof SyntaxError) {
            onLogout()
            return
          }
          setStudentDetailsError(error instanceof Error ? error.message : 'Unable to load student details.')
        }
      } finally {
        if (!controller.signal.aborted) setStudentDetailsLoading(false)
      }
    }

    loadStudentDetails()
    return () => controller.abort()
  }, [onLogout, selectedStudent, studentDetailsRetry])

  useEffect(() => {
    if (!reportOpen || reportType !== 'student' || selectedReportStudent) {
      setReportStudentResults([])
      setReportLookupLoading(false)
      return undefined
    }
    const query = reportStudentQuery.trim()
    if (query.length < 2) {
      setReportStudentResults([])
      setReportLookupLoading(false)
      return undefined
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setReportLookupLoading(true)
      setReportError('')
      try {
        const storedAuth = sessionStorage.getItem('lms.auth')
        const auth = storedAuth ? JSON.parse(storedAuth) : null
        if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
          onLogout()
          return
        }
        const params = new URLSearchParams({ search: query })
        const response = await fetch(`${API_BASE_URL}/admin/reports/lookup?${params}`, {
          headers: { Authorization: 'Bearer ' + auth.token },
          signal: controller.signal,
        })
        if (response.status === 401 || response.status === 403) {
          onLogout()
          return
        }
        const result = await readResponse(response, onLogout)
        setReportStudentResults(result.students || [])
      } catch (error) {
        if (error.name !== 'AbortError') {
          setReportError(error instanceof Error ? error.message : 'Unable to search students.')
          setReportStudentResults([])
        }
      } finally {
        if (!controller.signal.aborted) setReportLookupLoading(false)
      }
    }, 250)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [onLogout, reportOpen, reportStudentQuery, reportType, selectedReportStudent])

  async function openReportDialog() {
    setReportOpen(true)
    setReportType('all')
    setReportCollegeId('')
    setReportStudentQuery('')
    setReportStudentResults([])
    setSelectedReportStudent(null)
    setReportError('')
    setReportCollegesError('')
    setReportColleges([])
    setIsLoadingReportColleges(true)
    try {
      const storedAuth = sessionStorage.getItem('lms.auth')
      const auth = storedAuth ? JSON.parse(storedAuth) : null
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        return
      }
      const response = await fetch(`${API_BASE_URL}/admin/colleges`, {
        headers: { Authorization: 'Bearer ' + auth.token },
      })
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      const result = await readResponse(response, onLogout)
      setReportColleges(result.colleges || [])
    } catch (error) {
      setReportCollegesError(error instanceof Error ? error.message : 'Unable to load colleges.')
    } finally {
      setIsLoadingReportColleges(false)
    }
  }

  async function exportSelectedReport(event) {
    event.preventDefault()
    setReportError('')
    if ((reportType === 'college' || reportType === 'college_students') && !reportCollegeId) {
      setReportError('Select a college for this report.')
      return
    }
    if (reportType === 'student' && !selectedReportStudent) {
      setReportError('Search for and select a student.')
      return
    }

    setIsExportingReport(true)
    try {
      const storedAuth = sessionStorage.getItem('lms.auth')
      const auth = storedAuth ? JSON.parse(storedAuth) : null
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        return
      }

      const reportRows = []
      let reportSummary
      let page = 0
      let hasMore = true
      while (hasMore) {
        const params = new URLSearchParams({ type: reportType, page: String(page) })
        if (reportCollegeId) params.set('collegeId', reportCollegeId)
        if (selectedReportStudent) {
          params.set('studentId', selectedReportStudent.id)
          params.set('accountCollection', selectedReportStudent.accountCollection)
        }
        const response = await fetch(`${API_BASE_URL}/admin/reports?${params}`, {
          headers: { Authorization: 'Bearer ' + auth.token },
        })
        if (response.status === 401 || response.status === 403) {
          onLogout()
          return
        }
        const result = await readResponse(response, onLogout)
        if (page === 0) reportSummary = result.summary
        reportRows.push(...(result.rows || []))
        hasMore = result.hasMore === true
        page += 1
      }

      const rows = []
      if (reportType === 'college' && reportSummary) {
        rows.push({ recordType: 'College summary', ...reportSummary })
      }
      rows.push(...reportRows)
      const escapeCsvField = (value) => {
        const field = value instanceof Date ? value.toISOString() : String(value ?? '')
        const safeField = /^[\s]*[=+\-@]/.test(field) ? `'${field}` : field
        return `"${safeField.replaceAll('"', '""')}"`
      }
      const csv = [
        reportColumns.map(([, label]) => escapeCsvField(label)).join(','),
        ...rows.map((row) => reportColumns.map(([key]) => escapeCsvField(row[key])).join(',')),
      ].join('\r\n')
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      const reportName = {
        college: 'college-report',
        student: 'student-report-card',
        college_students: 'college-students-report',
        all: 'all-students-report',
      }[reportType]
      link.download = `${reportName}-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setReportOpen(false)
    } catch (error) {
      setReportError(error instanceof Error ? error.message : 'Unable to export the report.')
    } finally {
      setIsExportingReport(false)
    }
  }

  async function previewCollegeStudents(event) {
    event.preventDefault()
    setStudentImportError('')
    setStudentImportResult(null)
    setStudentImportPreview(null)
    if (!selectedCollegeId || !studentCsv) {
      setStudentImportError('Select a college and choose a CSV or XLSX file.')
      return
    }

    setIsPreviewingStudentImport(true)
    try {
      const storedAuth = sessionStorage.getItem('lms.auth')
      const auth = storedAuth ? JSON.parse(storedAuth) : null
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        return
      }
      const csvText = await readStudentFile(studentCsv)
      const response = await fetch(`${API_BASE_URL}/admin/students/import/preview`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + auth.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ csvText, collegeId: selectedCollegeId }),
      })
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      const result = await readResponse(response, onLogout)
      setStudentCsvText(csvText)
      setStudentImportPreview(result)
    } catch (error) {
      setStudentImportError(error instanceof Error ? error.message : 'Unable to preview students.')
    } finally {
      setIsPreviewingStudentImport(false)
    }
  }

  async function importCollegeStudents() {
    setStudentImportError('')
    setStudentImportResult(null)
    if (!selectedCollegeId || !studentCsvText || !studentImportPreview?.summary?.valid) {
      setStudentImportError('Preview a file with valid records before importing.')
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
      const response = await fetch(`${API_BASE_URL}/admin/students/import`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + auth.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ csvText: studentCsvText, collegeId: selectedCollegeId }),
      })
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      const result = await readResponse(response, onLogout)
      setStudentImportResult(result)
      setStudentImportPreview(null)
      setStudentCsv(null)
      setStudentCsvText('')
      setStudentPage(1)
      setStudentsRetry((retry) => retry + 1)
      await loadOverview()
    } catch (error) {
      setStudentImportError(error instanceof Error ? error.message : 'Unable to import students.')
    } finally {
      setIsImportingStudents(false)
    }
  }

  function openStudentModal() {
    setStudentForm({
      fullName: '',
      email: '',
      username: '',
      password: '',
      confirmPassword: '',
      studentType: 'independent',
      studentId: '',
      collegeId: '',
    })
    setStudentCreateError('')
    setIsStudentModalOpen(true)
  }

  async function createSingleStudent(event) {
    event.preventDefault()
    setStudentCreateError('')
    if (studentForm.password !== studentForm.confirmPassword) {
      setStudentCreateError('The passwords do not match.')
      return
    }
    if (studentForm.studentType === 'college' &&
      (!studentForm.studentId.trim() || !studentForm.collegeId)) {
      setStudentCreateError('Enter the student ID and select a college.')
      return
    }

    setIsCreatingStudent(true)
    try {
      const storedAuth = sessionStorage.getItem('lms.auth')
      const auth = storedAuth ? JSON.parse(storedAuth) : null
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        return
      }
      const response = await fetch(`${API_BASE_URL}/admin/students`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + auth.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fullName: studentForm.fullName,
          email: studentForm.email,
          username: studentForm.username,
          password: studentForm.password,
          studentType: studentForm.studentType,
          ...(studentForm.studentId.trim() ? { studentId: studentForm.studentId } : {}),
          ...(studentForm.studentType === 'college' ? { collegeId: studentForm.collegeId } : {}),
        }),
      })
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      const result = await readResponse(response, onLogout)
      setIsStudentModalOpen(false)
      setStudentActionMessage(result.message || 'Student created successfully.')
      setStudentSearch('')
      setStudentFilter('all')
      setApprovalFilter('all')
      setRegistrationTab('all')
      setStudentPage(1)
      setStudentsRetry((retry) => retry + 1)
      await loadOverview()
    } catch (error) {
      setStudentCreateError(error instanceof Error ? error.message : 'Unable to create the student.')
    } finally {
      setIsCreatingStudent(false)
    }
  }

  function openStudentEdit(student) {
    setStudentToEdit(student)
    setStudentEditForm({
      fullName: student.fullName || '',
      email: student.email || '',
      username: student.username || '',
    })
    setStudentEditError('')
  }

  function chooseStudentForManagement(student) {
    const action = studentManageAction
    setStudentManageAction('')
    setStudentManageSearch('')
    if (action === 'edit') {
      openStudentEdit(student)
      return
    }
    if (action === 'delete') {
      setStudentDeleteError('')
      setStudentToDelete(student)
    }
  }

  async function saveStudentEdit(event) {
    event.preventDefault()
    if (!studentToEdit) return
    setStudentEditError('')
    setIsSavingStudentEdit(true)
    try {
      const storedAuth = sessionStorage.getItem('lms.auth')
      const auth = storedAuth ? JSON.parse(storedAuth) : null
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        return
      }
      const params = new URLSearchParams({ studentType: studentToEdit.studentType })
      const response = await fetch(
        `${API_BASE_URL}/admin/students/${encodeURIComponent(studentToEdit._id)}?${params}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer ' + auth.token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(studentEditForm),
        },
      )
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      const result = await readResponse(response, onLogout)
      setStudentToEdit(null)
      setStudentActionMessage(result.message || 'Student details updated successfully.')
      setStudentsRetry((retry) => retry + 1)
    } catch (error) {
      setStudentEditError(error instanceof Error ? error.message : 'Unable to update the student.')
    } finally {
      setIsSavingStudentEdit(false)
    }
  }

  async function deleteStudent() {
    if (!studentToDelete) return
    setStudentDeleteError('')
    setIsDeletingStudent(true)
    try {
      const storedAuth = sessionStorage.getItem('lms.auth')
      const auth = storedAuth ? JSON.parse(storedAuth) : null
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        return
      }
      const params = new URLSearchParams({ studentType: studentToDelete.studentType })
      const response = await fetch(
        `${API_BASE_URL}/admin/students/${encodeURIComponent(studentToDelete._id)}?${params}`,
        { method: 'DELETE', headers: { Authorization: 'Bearer ' + auth.token } },
      )
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      const result = await readResponse(response, onLogout)
      setStudentToDelete(null)
      if (selectedStudent?._id === studentToDelete._id) setSelectedStudent(null)
      setStudentActionMessage(result.message || 'Student and related records deleted.')
      if (students.length === 1 && studentPage > 1) setStudentPage((page) => page - 1)
      else setStudentsRetry((retry) => retry + 1)
      await loadOverview()
    } catch (error) {
      setStudentDeleteError(error instanceof Error ? error.message : 'Unable to delete the student.')
    } finally {
      setIsDeletingStudent(false)
    }
  }

  function openBulkDataAction(action) {
    setBulkDataAction(action)
    setBulkDataMenuOpen(false)
    setBulkCollegeId('')
    setBulkStudents([])
    setBulkStudentIds([])
    setBulkStudentsError('')
    setBulkStudentChanges({ department: '', batch: '' })
    setBulkEditPreview(null)
    setIsBulkDeleteConfirmOpen(false)
  }

  function toggleBulkStudent(studentId) {
    setBulkStudentIds((current) => (
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : current.length < 5000
          ? [...current, studentId]
          : current
    ))
    setBulkEditPreview(null)
  }

  function previewBulkStudentChanges() {
    const changes = Object.fromEntries(
      Object.entries(bulkStudentChanges)
        .filter(([, value]) => value.trim())
        .map(([key, value]) => [key, value.trim()]),
    )
    if (!Object.keys(changes).length) {
      setBulkStudentsError('Enter a department or batch value to apply.')
      return
    }
    if (!bulkStudentIds.length) {
      setBulkStudentsError('Select at least one student.')
      return
    }
    setBulkStudentsError('')
    setBulkEditPreview({ changes, students: bulkStudents.filter((student) => bulkStudentIds.includes(String(student._id))) })
  }

  async function saveBulkStudentChanges() {
    if (!bulkEditPreview || !bulkCollegeId || !bulkStudentIds.length) return
    setIsSavingBulkEdit(true)
    setBulkStudentsError('')
    try {
      const storedAuth = sessionStorage.getItem('lms.auth')
      const auth = storedAuth ? JSON.parse(storedAuth) : null
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        return
      }
      const response = await fetch(`${API_BASE_URL}/admin/students/bulk`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + auth.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          collegeId: bulkCollegeId,
          studentIds: bulkStudentIds,
          ...bulkEditPreview.changes,
        }),
      })
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      const result = await readResponse(response, onLogout)
      setStudentActionMessage(result.message || 'Selected college students updated.')
      setBulkStudents((current) => current.map((student) => (
        bulkStudentIds.includes(String(student._id))
          ? { ...student, ...bulkEditPreview.changes }
          : student
      )))
      setBulkEditPreview(null)
      setBulkStudentIds([])
      setStudentsRetry((retry) => retry + 1)
    } catch (error) {
      setBulkStudentsError(error instanceof Error ? error.message : 'Unable to update the selected students.')
    } finally {
      setIsSavingBulkEdit(false)
    }
  }

  async function deleteBulkStudents() {
    if (!bulkCollegeId || !bulkStudentIds.length) return
    setIsDeletingBulkStudents(true)
    setBulkStudentsError('')
    try {
      const storedAuth = sessionStorage.getItem('lms.auth')
      const auth = storedAuth ? JSON.parse(storedAuth) : null
      if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
        onLogout()
        return
      }
      const response = await fetch(`${API_BASE_URL}/admin/students/bulk`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer ' + auth.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ collegeId: bulkCollegeId, studentIds: bulkStudentIds }),
      })
      if (response.status === 401 || response.status === 403) {
        onLogout()
        return
      }
      const result = await readResponse(response, onLogout)
      setIsBulkDeleteConfirmOpen(false)
      setStudentActionMessage(result.message || 'Selected college students deleted.')
      setBulkStudents((current) => current.filter((student) => !bulkStudentIds.includes(String(student._id))))
      setBulkStudentIds([])
      setStudentsRetry((retry) => retry + 1)
      await loadOverview()
    } catch (error) {
      setBulkStudentsError(error instanceof Error ? error.message : 'Unable to delete the selected students.')
    } finally {
      setIsDeletingBulkStudents(false)
    }
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
    setSearchOpen(false)
    setMobileSearchOpen(false)
    setProfileOpen(false)
    if (view === 'students') {
      setRegistrationTab('all')
      setStudentSearch('')
      setStudentFilter('all')
      setApprovalFilter('all')
      setStudentPage(1)
      setStudentActionMessage('')
    }
  }

  const stats = overview?.stats
  const viewTitles = {
    overview: 'Admin Dashboard',
    students: 'Students',
    'independent-approvals': 'Independent Student Approvals',
    colleges: 'Colleges',
    courses: 'Course Management',
    enrollments: 'Enrollments',
    reports: 'Reports & Analytics',
    notifications: 'Notifications',
    feedback: 'Feedback & Complaints',
    settings: 'Settings',
  }

  return (
    <div className="admin-app" data-theme={isDark ? 'dark' : 'light'}>
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
            <div
              className={`admin-search-shell${mobileSearchOpen ? ' admin-search-shell--mobile-open' : ''}`}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setSearchOpen(false)
                  setMobileSearchOpen(false)
                }
              }}
            >
              <button
                type="button"
                className="admin-search-mobile-toggle"
                aria-label="Search administrative tasks"
                aria-expanded={mobileSearchOpen}
                onClick={() => {
                  setMobileSearchOpen(true)
                  setSearchOpen(true)
                }}
              >⌕</button>
              <label className="admin-search">
                <span aria-hidden="true">⌕</span>
                <input
                  ref={searchInputRef}
                  type="search"
                  placeholder="Search admin tasks..."
                  aria-label="Search administrative tasks and activities"
                  value={search}
                  onFocus={() => setSearchOpen(true)}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setSearchOpen(true)
                  }}
                />
                <kbd>⌘ K</kbd>
              </label>
              {searchOpen && search.trim() && (
                <div className="admin-search-results" role="listbox" aria-label="Administrative search results">
                  {searchResults.length ? searchResults.map((result) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected="false"
                      key={result.view}
                      onClick={() => selectView(result.view)}
                    >
                      <strong>{result.title}</strong>
                      <span>{result.description}</span>
                    </button>
                  )) : (
                    <p className="admin-search-results__empty">No administrative actions match this search.</p>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="admin-icon-button admin-theme-toggle"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-pressed={isDark}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={onToggleTheme}
            >
              {isDark ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3Z" />
                </svg>
              )}
            </button>
            <button type="button" className="admin-icon-button" aria-label="Notifications" onClick={() => selectView('notifications')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
              </svg>
              <i />
            </button>
            <div className="admin-profile-menu" onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setProfileOpen(false)
            }}>
              <button
                type="button"
                className="admin-profile"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((open) => !open)}
              >
                <span className="admin-avatar">{(email || 'A').slice(0, 1).toUpperCase()}</span>
                <span className="admin-profile__label"><strong>Administrator</strong></span>
                <span className="admin-profile__chevron">⌄</span>
              </button>
              {profileOpen && (
                <div className="admin-profile-dropdown" role="menu">
                  <strong>Administrator</strong>
                  <span className="admin-profile-dropdown__email">{email || 'Email unavailable'}</span>
                  <button type="button" role="menuitem" onClick={onLogout}>Logout</button>
                </div>
              )}
            </div>
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
              <section className="admin-page-heading admin-page-heading--overview">
                <div className="admin-page-heading__copy">
                  <p className="admin-eyebrow">OVERVIEW</p>
                  <h1>Administrator</h1>
                </div>
                <img
                  className="admin-page-heading__illustration"
                  src="/admin-learning-illustration.svg"
                  alt=""
                  aria-hidden="true"
                />
                <div className="admin-page-heading__actions">
                  <button type="button" className="admin-button admin-button--secondary" onClick={openReportDialog}>
                    <span aria-hidden="true">⇩</span> Export Report
                  </button>
                </div>
              </section>

              <section className="admin-metrics" aria-label="Platform statistics">
                <MetricCard label="Active Students" value={isLoading ? '…' : stats?.totalStudents ?? '—'} note="Approved independent and active college learners" icon="♙" tone="sage" />
                <MetricCard label="Total Colleges" value={isLoading ? '…' : stats?.totalColleges ?? '—'} note="Colleges in the LMS" icon="▦" tone="gold" />
              </section>

              <section className="admin-analytics-grid">
                <article className="admin-panel">
                  <div className="admin-panel__heading">
                    <div>
                      <h2>Learning Engagement</h2>
                      <p>Enrollment activity over the {
                        { '7d': 'last 7 days', '30d': 'last 30 days', '3m': 'last 3 months', '6m': 'last 6 months' }[engagementPeriod]
                      }</p>
                    </div>
                    <select
                      aria-label="Learning engagement date range"
                      value={engagementPeriod}
                      onChange={(event) => setEngagementPeriod(event.target.value)}
                    >
                      <option value="7d">Last 7 days</option>
                      <option value="30d">Last 30 days</option>
                      <option value="3m">Last 3 months</option>
                      <option value="6m">Last 6 months</option>
                    </select>
                  </div>
                  {isLoadingEngagement
                    ? <div className="admin-loading">Loading enrollment data…</div>
                    : engagementError
                      ? (
                        <div className="admin-chart-error" role="alert">
                          <p>{engagementError}</p>
                          <button
                            type="button"
                            className="admin-text-button"
                            onClick={() => setEngagementRetry((retry) => retry + 1)}
                          >Try again</button>
                        </div>
                      )
                      : engagement.length
                        ? <EngagementChart engagement={engagement} period={engagementPeriod} />
                        : <EmptyState title="No enrollment records for this period">
                          Enrollment activity will appear here when records are available in the selected date range.
                        </EmptyState>}
                </article>
                <article className="admin-panel">
                  <div className="admin-panel__heading">
                    <div><h2>Course Completion</h2><p>Learner progress breakdown</p></div>
                    <span className="admin-panel__period">All courses</span>
                  </div>
                  {isLoading
                    ? <div className="admin-loading">Loading completion data…</div>
                    : <CourseCompletionChart courseCompletion={overview?.courseCompletion} />}
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
                    : <RegistrationsTable users={shownRegistrations.slice(0, 5)} emptyMessage="New registrations will appear here when available." />}
                </article>
                <article className="admin-panel">
                  <div className="admin-panel__heading admin-panel__heading--registrations">
                    <div><h2>Recent Course Registrations</h2><p>Latest courses added to the catalog</p></div>
                    <button className="admin-text-button" type="button" onClick={() => selectView('courses')}>View all <span>→</span></button>
                  </div>
                  {isLoading
                    ? <div className="admin-loading">Loading courses…</div>
                    : <CourseRegistrationsTable courses={recentCourses} />}
                </article>
              </section>
            </>
          )}

          {activeView === 'students' && (
            <div className="admin-students-page">
              <section className="admin-page-heading admin-page-heading--overview admin-page-heading--students">
                <div className="admin-page-heading__copy">
                  <p className="admin-eyebrow">STUDENT MANAGEMENT</p>
                  <h1>{viewTitles[activeView]}</h1>
                  <p>Independent and college students registered in the LMS.</p>
                </div>
                <div className="admin-page-heading__actions">
                  <div
                    className="admin-student-data-menu"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setSingleDataMenuOpen(false)
                    }}
                  >
                    <button
                      type="button"
                      className="admin-button admin-button--primary"
                      aria-haspopup="menu"
                      aria-expanded={singleDataMenuOpen}
                      onClick={() => {
                        setSingleDataMenuOpen((open) => !open)
                        setBulkDataMenuOpen(false)
                      }}
                    >
                      Single Data <span aria-hidden="true">⌄</span>
                    </button>
                    {singleDataMenuOpen && (
                      <div className="admin-student-data-menu__items" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSingleDataMenuOpen(false)
                            openStudentModal()
                          }}
                        >Add Student</button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setStudentManageSearch('')
                            setStudentManageError('')
                            setStudentManageAction('edit')
                            setSingleDataMenuOpen(false)
                          }}
                        >Edit Student</button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setStudentManageSearch('')
                            setStudentManageError('')
                            setStudentManageAction('delete')
                            setSingleDataMenuOpen(false)
                          }}
                        >Delete Student</button>
                      </div>
                    )}
                  </div>
                  <div
                    className="admin-student-data-menu"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setBulkDataMenuOpen(false)
                    }}
                  >
                    <button
                      type="button"
                      className="admin-button admin-button--secondary"
                      aria-haspopup="menu"
                      aria-expanded={bulkDataMenuOpen}
                      onClick={() => {
                        setBulkDataMenuOpen((open) => !open)
                        setSingleDataMenuOpen(false)
                      }}
                    >
                      Bulk Data <span aria-hidden="true">⌄</span>
                    </button>
                    {bulkDataMenuOpen && (
                      <div className="admin-student-data-menu__items" role="menu">
                        <button type="button" role="menuitem" onClick={() => openBulkDataAction('add')}>Add Bulk Students</button>
                        <button type="button" role="menuitem" onClick={() => openBulkDataAction('edit')}>Edit Bulk Students</button>
                        <button type="button" role="menuitem" onClick={() => openBulkDataAction('delete')}>Delete Bulk Students</button>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="admin-panel admin-students-management" aria-label="Student management">
                {studentActionMessage && (
                  <div className="admin-import-result" role="status">
                    {studentActionMessage}
                    <button
                      type="button"
                      className="admin-text-button"
                      aria-label="Dismiss success message"
                      onClick={() => setStudentActionMessage('')}
                    >Dismiss</button>
                  </div>
                )}
                {studentsError && (
                  <div className="admin-alert" role="alert">
                    <span>{studentsError}</span>
                    <button type="button" onClick={() => setStudentsRetry((retry) => retry + 1)}>Retry</button>
                  </div>
                )}
                <div className="admin-students-controls">
                  <label className="admin-students-search">
                    <span aria-hidden="true">⌕</span>
                    <input
                      type="search"
                      placeholder="Search by name, username, email or student ID"
                      aria-label="Search students by name, username, email or student ID"
                      value={studentSearch}
                      onChange={(event) => {
                        setStudentSearch(event.target.value)
                        setStudentPage(1)
                      }}
                    />
                  </label>
                  <label className="admin-students-filter">
                    <span>Filter Students</span>
                    <select
                      aria-label="Filter Students"
                      value={studentFilter}
                      onChange={(event) => {
                        const value = event.target.value
                        if (value === 'clear') {
                          setStudentSearch('')
                          setStudentFilter('all')
                          setApprovalFilter('all')
                          setRegistrationTab('all')
                        } else {
                          setStudentFilter(value)
                        }
                        setStudentPage(1)
                      }}
                    >
                      <option value="all">All Students</option>
                      <option value="independent">Independent Students</option>
                      <option value="college">College Students</option>
                      <optgroup label="College Name">
                        {colleges.map((college) => (
                          <option key={`name-${college.id}`} value={`college-name:${college.id}`}>
                            {college.name}
                          </option>
                        ))}
                      </optgroup>
                      <option value="clear">Clear Filter</option>
                    </select>
                  </label>
                  <label className="admin-students-filter">
                    <span>Approval Status</span>
                    <select
                      aria-label="Filter by approval status"
                      value={approvalFilter}
                      onChange={(event) => {
                        setApprovalFilter(event.target.value)
                        setStudentPage(1)
                      }}
                    >
                      <option value="all">All statuses</option>
                      <option value="pending">Pending Approval</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </label>
                </div>

                {bulkDataAction === 'add' && (
                  <section
                    className="admin-student-import"
                    id="admin-bulk-student-import"
                    aria-labelledby="student-import-title"
                  >
                    <div className="admin-student-import__heading">
                      <div>
                        <h2 id="student-import-title">Add Bulk Students</h2>
                        <p>Upload a CSV or XLSX with Full Name, Student ID, Email, Department, and Batch.</p>
                      </div>
                      <div className="admin-student-import__heading-actions">
                        <span className="admin-student-import__badge">No emails sent</span>
                        <button type="button" className="admin-text-button" onClick={() => openBulkDataAction('')}>Close</button>
                      </div>
                    </div>
                    <form className="admin-student-import__form" onSubmit={previewCollegeStudents}>
                      <label>
                        <span>College</span>
                        <select
                          value={selectedCollegeId}
                          onChange={(event) => {
                            setSelectedCollegeId(event.target.value)
                            setStudentImportPreview(null)
                          }}
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
                        <span>Student file</span>
                        <input
                          type="file"
                          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          onChange={(event) => {
                            setStudentCsv(event.target.files?.[0] || null)
                            setStudentCsvText('')
                            setStudentImportPreview(null)
                            setStudentImportResult(null)
                            setStudentImportError('')
                          }}
                          required
                        />
                      </label>
                      <button
                        className="admin-button admin-button--primary"
                        type="submit"
                        disabled={isPreviewingStudentImport || isImportingStudents || isLoadingColleges || !colleges.length || !studentCsv}
                      >
                        {isPreviewingStudentImport ? 'Validating…' : 'Preview records'}
                      </button>
                    </form>
                    {collegeLoadError && <p className="admin-inline-error" role="alert">{collegeLoadError}</p>}
                    {!isLoadingColleges && !collegeLoadError && !colleges.length && (
                      <p className="admin-inline-error" role="status">No colleges are available. Add a college before importing students.</p>
                    )}
                    {studentImportError && <p className="admin-inline-error" role="alert">{studentImportError}</p>}
                    {studentImportPreview && (
                      <div className="admin-bulk-preview">
                        <div className="admin-bulk-preview__heading">
                          <strong>Preview: {studentImportPreview.summary.valid} valid · {studentImportPreview.summary.invalid} need attention</strong>
                          {studentImportPreview.summary.invalid === 0 && (
                            <button
                              className="admin-button admin-button--primary"
                              type="button"
                              disabled={isImportingStudents}
                              onClick={importCollegeStudents}
                            >{isImportingStudents ? 'Importing…' : `Confirm import of ${studentImportPreview.summary.valid} students`}</button>
                          )}
                        </div>
                        <div className="admin-table-wrap">
                          <table className="admin-table">
                            <thead><tr><th>Name</th><th>Student ID</th><th>Email</th><th>Department</th><th>Batch</th><th>Validation</th></tr></thead>
                            <tbody>
                              {studentImportPreview.preview.slice(0, 100).map((row) => (
                                <tr key={row.row}>
                                  <td>{row.fullName || '—'}</td>
                                  <td>{row.studentId || '—'}</td>
                                  <td>{row.email || '—'}</td>
                                  <td>{row.department || '—'}</td>
                                  <td>{row.batch || '—'}</td>
                                  <td>{row.errors.length ? row.errors.join(' ') : 'Ready'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {studentImportPreview.preview.length > 100 && (
                          <p className="admin-student-picker__hint">Showing the first 100 of {studentImportPreview.preview.length} rows. All rows are validated before import.</p>
                        )}
                        {studentImportPreview.summary.invalid > 0 && (
                          <p className="admin-inline-error" role="status">Resolve invalid records in the source file and upload it again. No records have been imported.</p>
                        )}
                      </div>
                    )}
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

                {['edit', 'delete'].includes(bulkDataAction) && (
                  <section className="admin-student-import admin-bulk-management" aria-labelledby="bulk-student-management-title">
                    <div className="admin-student-import__heading">
                      <div>
                        <h2 id="bulk-student-management-title">
                          {bulkDataAction === 'edit' ? 'Edit Bulk Students' : 'Delete Bulk Students'}
                        </h2>
                        <p>
                          {bulkDataAction === 'edit'
                            ? 'Choose a college, select its students, then preview department or batch updates.'
                            : 'Choose a college first. Selecting a college never deletes records.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="admin-text-button"
                        onClick={() => openBulkDataAction('')}
                      >Close</button>
                    </div>
                    <label className="admin-student-picker__search">
                      <span>College</span>
                      <select
                        value={bulkCollegeId}
                        onChange={(event) => {
                          setBulkCollegeId(event.target.value)
                          setBulkEditPreview(null)
                          setIsBulkDeleteConfirmOpen(false)
                        }}
                        disabled={isLoadingColleges || !colleges.length}
                        required
                      >
                        <option value="">{isLoadingColleges ? 'Loading colleges…' : 'Select a college'}</option>
                        {colleges.map((college) => <option key={college.id} value={college.id}>{college.name}</option>)}
                      </select>
                    </label>
                    {bulkStudentsError && <p className="admin-inline-error" role="alert">{bulkStudentsError}</p>}
                    {bulkCollegeId && (
                      <>
                        <div className="admin-bulk-selection-heading">
                          <span>{bulkStudentIds.length} selected · {bulkStudents.length} students in this college</span>
                          <label>
                            <input
                              type="checkbox"
                              checked={bulkStudents.length > 0 && bulkStudentIds.length === bulkStudents.length}
                              onChange={(event) => {
                                setBulkStudentIds(event.target.checked ? bulkStudents.map((student) => String(student._id)) : [])
                                setBulkEditPreview(null)
                              }}
                              disabled={!bulkStudents.length || bulkStudents.length > 5000}
                            />
                            Select all
                          </label>
                        </div>
                        {isLoadingBulkStudents
                          ? <div className="admin-loading">Loading students for this college…</div>
                          : bulkStudents.length
                            ? (
                              <div className="admin-table-wrap admin-bulk-students-table">
                                <table className="admin-table">
                                  <thead><tr><th>Select</th><th>Name</th><th>Student ID</th><th>Email</th><th>Department</th><th>Batch</th></tr></thead>
                                  <tbody>
                                    {bulkStudents.map((student) => (
                                      <tr key={student._id}>
                                        <td>
                                          <input
                                            type="checkbox"
                                            aria-label={`Select ${student.fullName || 'student'}`}
                                            checked={bulkStudentIds.includes(String(student._id))}
                                            onChange={() => toggleBulkStudent(String(student._id))}
                                          />
                                        </td>
                                        <td>{student.fullName || 'Unnamed student'}</td>
                                        <td>{student.studentId || student.username || '—'}</td>
                                        <td>{student.email || '—'}</td>
                                        <td>{student.department || '—'}</td>
                                        <td>{student.batch || '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )
                            : !bulkStudentsError && <p className="admin-student-no-data">No students belong to this college.</p>}
                      </>
                    )}
                    {bulkDataAction === 'edit' && bulkCollegeId && bulkStudents.length > 0 && (
                      <div className="admin-bulk-edit-controls">
                        <label className="admin-report-field">
                          <span>Set department</span>
                          <input
                            maxLength={120}
                            value={bulkStudentChanges.department}
                            onChange={(event) => setBulkStudentChanges((current) => ({ ...current, department: event.target.value }))}
                          />
                        </label>
                        <label className="admin-report-field">
                          <span>Set batch</span>
                          <input
                            maxLength={80}
                            value={bulkStudentChanges.batch}
                            onChange={(event) => setBulkStudentChanges((current) => ({ ...current, batch: event.target.value }))}
                          />
                        </label>
                        <button
                          type="button"
                          className="admin-button admin-button--secondary"
                          onClick={previewBulkStudentChanges}
                          disabled={!bulkStudentIds.length || isSavingBulkEdit}
                        >Preview changes</button>
                      </div>
                    )}
                    {bulkEditPreview && (
                      <div className="admin-bulk-preview">
                        <strong>Review updates for {bulkEditPreview.students.length} selected students</strong>
                        <p>{Object.entries(bulkEditPreview.changes).map(([field, value]) => `${field}: ${value}`).join(' · ')}</p>
                        <ul>
                          {bulkEditPreview.students.map((student) => (
                            <li key={student._id}>
                              {student.fullName} · {student.email}
                              {Object.entries(bulkEditPreview.changes).map(([field, value]) => ` · ${field}: ${value}`).join('')}
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="admin-button admin-button--primary"
                          onClick={saveBulkStudentChanges}
                          disabled={isSavingBulkEdit}
                        >{isSavingBulkEdit ? 'Saving…' : 'Confirm and save changes'}</button>
                      </div>
                    )}
                    {bulkDataAction === 'delete' && bulkCollegeId && bulkStudentIds.length > 0 && (
                      <div className="admin-bulk-delete-controls">
                        <p>{bulkStudentIds.length} student{bulkStudentIds.length === 1 ? '' : 's'} selected for deletion.</p>
                        <button
                          type="button"
                          className="admin-button admin-button--danger"
                          onClick={() => setIsBulkDeleteConfirmOpen(true)}
                          disabled={isDeletingBulkStudents}
                        >Review deletion</button>
                      </div>
                    )}
                  </section>
                )}

                <div className="admin-tabs admin-students-tabs" role="tablist" aria-label="Student category">
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
                      onClick={() => {
                        setRegistrationTab(studentType)
                        setStudentPage(1)
                      }}
                    >{label}</button>
                  ))}
                </div>

                <div className="admin-panel__heading admin-panel__heading--registrations admin-students-table-heading">
                  <div>
                    <h2>Student Registrations</h2>
                    <p>{studentTotal} student{studentTotal === 1 ? '' : 's'}</p>
                  </div>
                </div>
                {isLoadingStudents
                  ? <div className="admin-loading">Loading registrations…</div>
                  : studentsError
                    ? null
                    : (
                      <StudentManagementTable
                        students={students}
                        onViewDetails={setSelectedStudent}
                      />
                    )}
                <div className="admin-students-pagination" aria-label="Student table pagination">
                  <span>
                    {studentTotal
                      ? `${(studentPage - 1) * 25 + 1}–${Math.min(studentPage * 25, studentTotal)} of ${studentTotal}`
                      : '0 students'}
                  </span>
                  <div>
                    <button
                      type="button"
                      className="admin-button admin-button--secondary"
                      disabled={studentPage <= 1 || isLoadingStudents}
                      onClick={() => setStudentPage((page) => page - 1)}
                    >Previous</button>
                    <button
                      type="button"
                      className="admin-button admin-button--secondary"
                      disabled={studentPage * 25 >= studentTotal || isLoadingStudents}
                      onClick={() => setStudentPage((page) => page + 1)}
                    >Next</button>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeView === 'colleges' && <CollegesManagement onLogout={onLogout} />}
          {activeView === 'courses' && <CourseManagement onLogout={onLogout} />}
          {activeView === 'enrollments' && <EnrollmentManagement onLogout={onLogout} />}
          {activeView === 'independent-approvals' && <IndependentStudentApprovals onLogout={onLogout} />}

          {['reports', 'notifications', 'feedback', 'settings'].includes(activeView) && (
            <section className="admin-panel admin-view-panel">
              <div className="admin-page-heading admin-page-heading--compact">
                <div><p className="admin-eyebrow">WORKSPACE</p><h1>{viewTitles[activeView]}</h1><p>Manage your LMS {viewTitles[activeView].toLowerCase()}.</p></div>
              </div>
              {activeView === 'notifications'
                ? <NotificationFeed role="main_admin" onLogout={onLogout} onOpenApprovals={() => selectView('independent-approvals')} />
                : <EmptyState title={`${viewTitles[activeView]} are not connected`}>This section will show live LMS data when its backend API is available.</EmptyState>}
            </section>
          )}
        </div>
      </main>
      {reportOpen && (
        <div
          className="admin-report-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isExportingReport) setReportOpen(false)
          }}
        >
          <section className="admin-report-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-report-title">
            <div className="admin-report-dialog__heading">
              <div>
                <p className="admin-eyebrow">DATABASE REPORTS</p>
                <h2 id="admin-report-title">Export report</h2>
                <p>Reports use current LMS student, college, course, and enrollment records.</p>
              </div>
              <button
                type="button"
                className="admin-report-dialog__close"
                aria-label="Close report dialog"
                disabled={isExportingReport}
                onClick={() => setReportOpen(false)}
              >×</button>
            </div>
            <form onSubmit={exportSelectedReport}>
              <label className="admin-report-field">
                <span>Report type</span>
                <select autoFocus value={reportType} onChange={(event) => {
                  setReportType(event.target.value)
                  setReportError('')
                  setSelectedReportStudent(null)
                  setReportStudentQuery('')
                  setReportStudentResults([])
                }}>
                  <option value="college">College report</option>
                  <option value="student">Individual student report card</option>
                  <option value="college_students">College students report</option>
                  <option value="all">All students report</option>
                </select>
              </label>

              {(reportType === 'college' || reportType === 'college_students') && (
                <label className="admin-report-field">
                  <span>College</span>
                  <select
                    value={reportCollegeId}
                    onChange={(event) => setReportCollegeId(event.target.value)}
                    required
                    disabled={isLoadingReportColleges || Boolean(reportCollegesError) || !reportColleges.length}
                  >
                    <option value="">
                      {isLoadingReportColleges ? 'Loading colleges…' : reportColleges.length ? 'Select a college' : 'No colleges available'}
                    </option>
                    {reportColleges.map((college) => (
                      <option key={college.id} value={college.id}>{college.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {reportCollegesError && (reportType === 'college' || reportType === 'college_students') && (
                <p className="admin-inline-error" role="alert">{reportCollegesError}</p>
              )}

              {reportType === 'student' && (
                <div className="admin-report-field admin-report-student-picker">
                  <label htmlFor="admin-report-student">Find student</label>
                  <input
                    id="admin-report-student"
                    type="search"
                    value={reportStudentQuery}
                    placeholder="Search by name, username, or email"
                    autoComplete="off"
                    onChange={(event) => {
                      setReportStudentQuery(event.target.value)
                      setSelectedReportStudent(null)
                      setReportError('')
                    }}
                  />
                  {reportLookupLoading && <span className="admin-report-hint">Searching current student records…</span>}
                  {!reportLookupLoading && reportStudentQuery.trim().length >= 2 && !selectedReportStudent && (
                    <div className="admin-report-student-results">
                      {reportStudentResults.length ? reportStudentResults.map((student) => (
                        <button
                          type="button"
                          key={`${student.accountCollection}-${student.id}`}
                          onClick={() => {
                            setSelectedReportStudent(student)
                            setReportStudentQuery(`${student.name} · ${student.email}`)
                            setReportStudentResults([])
                          }}
                        >
                          <strong>{student.name}</strong>
                          <span>{student.email} · {student.studentType === 'college' ? student.collegeName || 'College student' : 'Independent student'}</span>
                        </button>
                      )) : (
                        <p className="admin-report-hint">No matching students found.</p>
                      )}
                    </div>
                  )}
                  {selectedReportStudent && (
                    <span className="admin-report-hint" role="status">
                      Selected: {selectedReportStudent.studentType === 'college' ? 'College student' : 'Independent student'}
                    </span>
                  )}
                </div>
              )}

              <p className="admin-report-hint">
                Download as CSV, which opens in Excel. The export contains live records only; no report data is generated when records are absent.
              </p>
              {reportError && <p className="admin-inline-error" role="alert">{reportError}</p>}
              <div className="admin-report-dialog__actions">
                <button type="button" className="admin-button admin-button--secondary" disabled={isExportingReport} onClick={() => setReportOpen(false)}>Cancel</button>
                <button
                  type="submit"
                  className="admin-button admin-button--primary"
                  disabled={
                    isExportingReport ||
                    Boolean(reportCollegesError && (reportType === 'college' || reportType === 'college_students')) ||
                    (isLoadingReportColleges && (reportType === 'college' || reportType === 'college_students'))
                  }
                >
                  {isExportingReport ? 'Preparing report…' : 'Export CSV'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {isStudentModalOpen && (
        <div
          className="admin-report-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isCreatingStudent) setIsStudentModalOpen(false)
          }}
        >
          <section className="admin-report-dialog admin-student-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-student-dialog-title">
            <div className="admin-report-dialog__heading">
              <div>
                <p className="admin-eyebrow">STUDENT MANAGEMENT</p>
                <h2 id="admin-student-dialog-title">Add a student</h2>
                <p>Create a login for an independent or college student.</p>
              </div>
              <button
                type="button"
                className="admin-report-dialog__close"
                aria-label="Close student form"
                disabled={isCreatingStudent}
                onClick={() => setIsStudentModalOpen(false)}
              >×</button>
            </div>
            <form className="admin-student-form" onSubmit={createSingleStudent}>
              <label className="admin-report-field">
                <span>Student type</span>
                <select
                  value={studentForm.studentType}
                  onChange={(event) => setStudentForm((form) => ({
                    ...form,
                    studentType: event.target.value,
                    studentId: '',
                    collegeId: '',
                  }))}
                >
                  <option value="independent">Independent student</option>
                  <option value="college">College student</option>
                </select>
              </label>
              <label className="admin-report-field">
                <span>Full name</span>
                <input
                  type="text"
                  autoComplete="name"
                  maxLength={120}
                  value={studentForm.fullName}
                  onChange={(event) => setStudentForm((form) => ({ ...form, fullName: event.target.value }))}
                  required
                />
              </label>
              <label className="admin-report-field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={studentForm.email}
                  onChange={(event) => setStudentForm((form) => ({ ...form, email: event.target.value }))}
                  required
                />
              </label>
              <label className="admin-report-field">
                <span>Username</span>
                <input
                  type="text"
                  autoComplete="username"
                  minLength={3}
                  maxLength={30}
                  value={studentForm.username}
                  onChange={(event) => setStudentForm((form) => ({ ...form, username: event.target.value }))}
                  required
                />
              </label>
              {studentForm.studentType === 'college' && (
                <>
                  <label className="admin-report-field">
                    <span>Student ID</span>
                    <input
                      type="text"
                      maxLength={100}
                      value={studentForm.studentId}
                      onChange={(event) => setStudentForm((form) => ({ ...form, studentId: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="admin-report-field">
                    <span>College</span>
                    <select
                      value={studentForm.collegeId}
                      onChange={(event) => setStudentForm((form) => ({ ...form, collegeId: event.target.value }))}
                      disabled={isLoadingColleges || !colleges.length}
                      required
                    >
                      <option value="">
                        {isLoadingColleges ? 'Loading colleges…' : colleges.length ? 'Select a college' : 'No colleges available'}
                      </option>
                      {colleges.map((college) => (
                        <option key={college.id} value={college.id}>{college.name}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="admin-report-field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={72}
                  value={studentForm.password}
                  onChange={(event) => setStudentForm((form) => ({ ...form, password: event.target.value }))}
                  required
                />
              </label>
              <label className="admin-report-field">
                <span>Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={72}
                  value={studentForm.confirmPassword}
                  onChange={(event) => setStudentForm((form) => ({ ...form, confirmPassword: event.target.value }))}
                  required
                />
              </label>
              {collegeLoadError && studentForm.studentType === 'college' && (
                <p className="admin-inline-error" role="alert">{collegeLoadError}</p>
              )}
              {studentCreateError && <p className="admin-inline-error" role="alert">{studentCreateError}</p>}
              <div className="admin-report-dialog__actions">
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  disabled={isCreatingStudent}
                  onClick={() => setIsStudentModalOpen(false)}
                >Cancel</button>
                <button
                  type="submit"
                  className="admin-button admin-button--primary"
                  disabled={isCreatingStudent || (studentForm.studentType === 'college' && (!colleges.length || isLoadingColleges))}
                >
                  {isCreatingStudent ? 'Creating…' : 'Create student'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {selectedStudent && (
        <div
          className="admin-report-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedStudent(null)
          }}
        >
          <section className="admin-report-dialog admin-student-dialog admin-student-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-student-details-title">
            <div className="admin-report-dialog__heading">
              <div>
                <p className="admin-eyebrow">STUDENT DETAILS</p>
                <h2 id="admin-student-details-title">{studentDetails?.student.fullName || selectedStudent.fullName || 'Unnamed student'}</h2>
              </div>
              <button
                type="button"
                className="admin-report-dialog__close"
                aria-label="Close student details"
                onClick={() => setSelectedStudent(null)}
              >×</button>
            </div>
            {studentDetailsLoading && <div className="admin-loading" role="status">Loading student details…</div>}
            {studentDetailsError && (
              <div className="admin-alert" role="alert">
                <span>{studentDetailsError}</span>
                <button type="button" onClick={() => setStudentDetailsRetry((retry) => retry + 1)}>Retry</button>
              </div>
            )}
            {studentDetails && (
              <>
                <section className="admin-student-detail-section" aria-labelledby="admin-student-information-title">
                  <div className="admin-student-detail-section__heading">
                    <h3 id="admin-student-information-title">Student Information</h3>
                    <StatusBadge status={studentDetails.student.status} />
                  </div>
                  <dl className="admin-student-details">
                    <div><dt>Full Name</dt><dd>{studentDetails.student.fullName || 'No data available yet'}</dd></div>
                    <div><dt>Username</dt><dd>{studentDetails.student.username || 'No data available yet'}</dd></div>
                    <div><dt>Email Address</dt><dd>{studentDetails.student.email || 'No data available yet'}</dd></div>
                    <div><dt>College Name</dt><dd>{studentDetails.student.studentType === 'college' ? studentDetails.student.collegeName || 'No data available yet' : 'Not Applicable'}</dd></div>
                    <div><dt>College ID</dt><dd>{studentDetails.student.studentType === 'college' ? studentDetails.student.collegeId || 'No data available yet' : 'Not Applicable'}</dd></div>
                    <div><dt>Registration Date</dt><dd>{studentDetails.student.createdAt ? formatDate(studentDetails.student.createdAt) : 'No data available yet'}</dd></div>
                    <div><dt>Account Status</dt><dd><StatusBadge status={studentDetails.student.status} /></dd></div>
                  </dl>
                </section>

                <section className="admin-student-detail-section" aria-labelledby="admin-student-course-summary-title">
                  <div className="admin-student-detail-section__heading">
                    <h3 id="admin-student-course-summary-title">Course Summary</h3>
                  </div>
                  <div className="admin-student-course-summary">
                    {[
                      ['Courses Assigned', studentDetails.summary.coursesAssigned, 'sage'],
                      ['Courses Enrolled', studentDetails.summary.coursesEnrolled, 'teal'],
                      ['Completed Courses', studentDetails.summary.coursesCompleted, 'gold'],
                    ].map(([label, count, tone]) => (
                      <article className={`admin-student-course-summary__card is-${tone}`} key={label}>
                        <span>{label}</span>
                        <strong>{count}</strong>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="admin-student-detail-section" aria-labelledby="admin-student-report-title">
                  <div className="admin-student-detail-section__heading">
                    <h3 id="admin-student-report-title">Overall Report</h3>
                    <span className="admin-student-completion">
                      {studentDetails.summary.overallCompletionPercentage === null
                        ? 'No data available yet'
                        : `${studentDetails.summary.overallCompletionPercentage}% complete`}
                    </span>
                  </div>
                  <p className="admin-student-report-counts">
                    Assigned: {studentDetails.summary.coursesAssigned}
                    <span>·</span>
                    Enrolled: {studentDetails.summary.coursesEnrolled}
                    <span>·</span>
                    Completed: {studentDetails.summary.coursesCompleted}
                  </p>
                  <p className="admin-student-progress-note">
                    Completion uses unique, non-cancelled course enrollments marked completed. Lesson-level progress is not currently stored.
                  </p>
                  {studentDetails.summary.overallCompletionPercentage !== null && (
                    <div
                      className="admin-student-completion-track"
                      role="img"
                      aria-label={`Overall course completion: ${studentDetails.summary.overallCompletionPercentage}%`}
                    >
                      <span style={{ width: `${studentDetails.summary.overallCompletionPercentage}%` }} />
                    </div>
                  )}
                  <h4>Individual Course Progress</h4>
                  {studentDetails.courseProgress.length ? (
                    <div className="admin-table-wrap">
                      <table className="admin-table admin-student-progress-table">
                        <thead>
                          <tr><th>Course</th><th>Course Type</th><th>Status</th><th>Progress</th></tr>
                        </thead>
                        <tbody>
                          {studentDetails.courseProgress.map((course) => (
                            <tr key={course.courseId}>
                              <td>{course.title}</td>
                              <td>{course.source === 'assigned' ? 'Assigned' : 'Enrolled'}</td>
                              <td><StatusBadge status={course.status} /></td>
                              <td>{course.progressPercent === null ? 'Progress not tracked' : `${course.progressPercent}%`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="admin-student-no-data">No data available yet</p>
                  )}
                  <div className="admin-student-report-results">
                    {[
                      ['Quiz Results', studentDetails.quizResults],
                      ['Assignment Results', studentDetails.assignmentResults],
                      ['Certificates Earned', studentDetails.certificates],
                    ].map(([title, records]) => (
                      <section key={title}>
                        <h4>{title}</h4>
                        {records.length
                          ? <p>{records.map((record) => record.title || record.name || 'Result').join(', ')}</p>
                          : <p className="admin-student-no-data">No data available yet</p>}
                      </section>
                    ))}
                  </div>
                </section>
              </>
            )}
          </section>
        </div>
      )}
      {studentManageAction && (
        <div
          className="admin-report-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setStudentManageAction('')
          }}
        >
          <section
            className="admin-report-dialog admin-student-dialog admin-student-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-student-picker-title"
          >
            <div className="admin-report-dialog__heading">
              <div>
                <p className="admin-eyebrow">STUDENT MANAGEMENT</p>
                <h2 id="admin-student-picker-title">
                  {studentManageAction === 'edit' ? 'Choose a student to edit' : 'Choose a student to delete'}
                </h2>
                <p>Search by name, username, email, or student ID.</p>
              </div>
              <button
                type="button"
                className="admin-report-dialog__close"
                aria-label="Close student management"
                onClick={() => setStudentManageAction('')}
              >×</button>
            </div>
            <label className="admin-report-field admin-student-picker__search">
              <span>Find a student</span>
              <input
                type="search"
                maxLength={200}
                value={studentManageSearch}
                onChange={(event) => setStudentManageSearch(event.target.value)}
                autoFocus
              />
            </label>
            <div className="admin-student-picker__results" aria-live="polite">
              {isLoadingManageStudents
                ? <div className="admin-loading">Searching students…</div>
                : studentManageError
                  ? <p className="admin-inline-error" role="alert">{studentManageError}</p>
                  : studentManageStudents.length
                    ? studentManageStudents.map((student) => (
                      <button
                        type="button"
                        className="admin-student-picker__result"
                        key={`${student.studentType}-${student._id}`}
                        onClick={() => chooseStudentForManagement(student)}
                      >
                        <span>
                          <strong>{student.fullName || 'Unnamed student'}</strong>
                          <small>{student.email || 'No email'} · @{student.username || 'No username'}</small>
                        </span>
                        <span className="admin-student-picker__type">
                          {student.studentType === 'college' ? 'College' : 'Independent'}
                        </span>
                      </button>
                    ))
                    : <p className="admin-student-no-data">No matching students found.</p>}
            </div>
            {!isLoadingManageStudents && !studentManageError && studentManageStudents.length === 25 && (
              <p className="admin-student-picker__hint">Showing the 25 most recent matches. Refine your search to find other students.</p>
            )}
          </section>
        </div>
      )}
      {studentToEdit && (
        <div
          className="admin-report-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSavingStudentEdit) setStudentToEdit(null)
          }}
        >
          <section className="admin-report-dialog admin-student-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-student-edit-title">
            <div className="admin-report-dialog__heading">
              <div>
                <p className="admin-eyebrow">STUDENT MANAGEMENT</p>
                <h2 id="admin-student-edit-title">Edit student</h2>
                <p>Update the student’s account details.</p>
              </div>
              <button
                type="button"
                className="admin-report-dialog__close"
                aria-label="Close edit student form"
                disabled={isSavingStudentEdit}
                onClick={() => setStudentToEdit(null)}
              >×</button>
            </div>
            <form className="admin-student-form" onSubmit={saveStudentEdit}>
              <label className="admin-report-field">
                <span>Full name</span>
                <input
                  type="text"
                  autoComplete="name"
                  maxLength={120}
                  value={studentEditForm.fullName}
                  onChange={(event) => setStudentEditForm((form) => ({ ...form, fullName: event.target.value }))}
                  required
                />
              </label>
              <label className="admin-report-field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={studentEditForm.email}
                  onChange={(event) => setStudentEditForm((form) => ({ ...form, email: event.target.value }))}
                  required
                />
              </label>
              <label className="admin-report-field">
                <span>Username</span>
                <input
                  type="text"
                  autoComplete="username"
                  minLength={3}
                  maxLength={30}
                  value={studentEditForm.username}
                  onChange={(event) => setStudentEditForm((form) => ({ ...form, username: event.target.value }))}
                  required
                />
              </label>
              {studentEditError && <p className="admin-inline-error" role="alert">{studentEditError}</p>}
              <div className="admin-report-dialog__actions">
                <button
                  type="button"
                  className="admin-button admin-button--secondary"
                  disabled={isSavingStudentEdit}
                  onClick={() => setStudentToEdit(null)}
                >Cancel</button>
                <button type="submit" className="admin-button admin-button--primary" disabled={isSavingStudentEdit}>
                  {isSavingStudentEdit ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {studentToDelete && (
        <div
          className="admin-report-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDeletingStudent) setStudentToDelete(null)
          }}
        >
          <section className="admin-report-dialog admin-student-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-student-delete-title">
            <div className="admin-report-dialog__heading">
              <div>
                <p className="admin-eyebrow">PERMANENT ACTION</p>
                <h2 id="admin-student-delete-title">Delete student?</h2>
                <p>
                  This permanently deletes this student account, its login identity, and enrollment records.
                  Course records will remain.
                </p>
                <dl className="admin-student-delete-summary">
                  <div><dt>Name</dt><dd>{studentToDelete.fullName || 'Unnamed student'}</dd></div>
                  <div><dt>ID / Username</dt><dd>{studentToDelete.studentId || studentToDelete.username || 'Not available'}</dd></div>
                  <div><dt>Email</dt><dd>{studentToDelete.email || 'Not available'}</dd></div>
                </dl>
              </div>
              <button
                type="button"
                className="admin-report-dialog__close"
                aria-label="Close delete confirmation"
                disabled={isDeletingStudent}
                onClick={() => setStudentToDelete(null)}
              >×</button>
            </div>
            {studentDeleteError && <p className="admin-inline-error" role="alert">{studentDeleteError}</p>}
            <div className="admin-report-dialog__actions">
              <button
                type="button"
                className="admin-button admin-button--secondary"
                disabled={isDeletingStudent}
                onClick={() => setStudentToDelete(null)}
              >Cancel</button>
              <button
                type="button"
                className="admin-button admin-button--danger"
                disabled={isDeletingStudent}
                onClick={deleteStudent}
              >{isDeletingStudent ? 'Deleting…' : 'Delete permanently'}</button>
            </div>
          </section>
        </div>
      )}
      {isBulkDeleteConfirmOpen && (
        <div
          className="admin-report-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDeletingBulkStudents) setIsBulkDeleteConfirmOpen(false)
          }}
        >
          <section
            className="admin-report-dialog admin-student-dialog admin-bulk-delete-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="admin-bulk-delete-title"
          >
            <div className="admin-report-dialog__heading">
              <div>
                <p className="admin-eyebrow">PERMANENT BULK ACTION</p>
                <h2 id="admin-bulk-delete-title">Confirm student deletion</h2>
                <p>
                  This permanently deletes {bulkStudentIds.length} selected students from{' '}
                  {colleges.find((college) => college.id === bulkCollegeId)?.name || 'the selected college'},
                  their login identities, and enrollment records. The college, its administrators, courses,
                  and students from other colleges are not changed.
                </p>
              </div>
              <button
                type="button"
                className="admin-report-dialog__close"
                aria-label="Close bulk deletion confirmation"
                disabled={isDeletingBulkStudents}
                onClick={() => setIsBulkDeleteConfirmOpen(false)}
              >×</button>
            </div>
            <div className="admin-bulk-delete-confirm__list">
              {bulkStudents
                .filter((student) => bulkStudentIds.includes(String(student._id)))
                .map((student) => (
                  <div key={student._id}>
                    <strong>{student.fullName || 'Unnamed student'}</strong>
                    <span>{student.studentId || student.username || 'No ID'} · {student.email || 'No email'}</span>
                  </div>
                ))}
            </div>
            {bulkStudentsError && <p className="admin-inline-error" role="alert">{bulkStudentsError}</p>}
            <div className="admin-report-dialog__actions">
              <button
                type="button"
                className="admin-button admin-button--secondary"
                disabled={isDeletingBulkStudents}
                onClick={() => setIsBulkDeleteConfirmOpen(false)}
              >Cancel</button>
              <button
                type="button"
                className="admin-button admin-button--danger"
                disabled={isDeletingBulkStudents || !bulkStudentIds.length}
                onClick={deleteBulkStudents}
              >{isDeletingBulkStudents ? 'Deleting…' : `Delete ${bulkStudentIds.length} selected students`}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default AdminDashboard
