import AssignmentSubmission from '../models/AssignmentSubmission.js'
import Course from '../models/Course.js'
import Enrollment from '../models/Enrollment.js'
import QuizAttempt from '../models/QuizAttempt.js'

function isRequired(activity, nestedActivity) {
  return activity?.requiredForCertificate !== false
    && nestedActivity?.requiredForCertificate !== false
}

function getCourseProgressActivities(course, { includeOptional = false } = {}) {
  const activities = { videos: [], quizzes: [], assignments: [] }
  const seen = new Set()
  function add(type, activity, idSource = activity, nestedActivity = null) {
    if (!activity || (!includeOptional && !isRequired(activity, nestedActivity))) return
    const id = documentId(idSource)
    if (!id) return
    const key = `${type}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    activities[type === 'quiz' ? 'quizzes' : `${type}s`].push({ id })
  }

  for (const module of course?.modules || []) {
    const contentItems = Array.isArray(module.contentItems) ? module.contentItems : []
    const contentVideos = contentItems.filter((item) => item.type === 'video-lesson')
    for (const video of (contentVideos.length ? contentVideos : module.lessons || [])) {
      add('video', video)
    }

    const contentQuizzes = contentItems.filter((item) => item.type === 'quiz')
    for (const item of (contentQuizzes.length ? contentQuizzes : module.quiz ? [module.quiz] : [])) {
      if (item.quiz) add('quiz', item, item.quiz._id ? item.quiz : item, item.quiz)
      else add('quiz', item)
    }

    for (const assignment of contentItems.filter((item) => item.type === 'assignment')) {
      add('assignment', assignment)
    }
  }
  for (const quiz of course?.quizzes || []) add('quiz', quiz)
  for (const assignment of course?.assignments || []) add('assignment', assignment)
  return activities
}

function documentId(value) {
  const id = value && typeof value === 'object' ? value._id : value
  return id === undefined || id === null ? '' : String(id)
}

export function getCourseActivitySequence(course) {
  const activities = []
  const seen = new Set()
  const add = (type, activity) => {
    const id = type === 'quiz'
      ? documentId(activity?.quiz) || documentId(activity)
      : documentId(activity)
    if (!id) return
    const key = `${type}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    activities.push({ type, id, key })
  }
  const orderedModules = (course?.modules || [])
    .map((module, index) => ({ module, index }))
    .sort((left, right) => (left.module.order ?? left.index) - (right.module.order ?? right.index))

  for (const { module } of orderedModules) {
    const contentItems = (module.contentItems || [])
      .map((item, index) => ({ item, index }))
      .sort((left, right) => (left.item.order ?? left.index) - (right.item.order ?? right.index))
      .map(({ item }) => item)
    if (contentItems.length) {
      if (!contentItems.some((item) => item.type === 'video-lesson')) {
        for (const lesson of module.lessons || []) add('video-lesson', lesson)
      }
      for (const item of contentItems) {
        if (['video-lesson', 'quiz', 'assignment'].includes(item.type)) add(item.type, item)
      }
      if (module.quiz && !contentItems.some((item) => item.type === 'quiz')) {
        add('quiz', module.quiz)
      }
      continue
    }

    for (const lesson of module.lessons || []) add('video-lesson', lesson)
    if (module.quiz) add('quiz', module.quiz)
  }

  for (const quiz of course?.quizzes || []) add('quiz', quiz)
  for (const assignment of course?.assignments || []) add('assignment', assignment)
  return activities
}

export function isCourseActivityCompleted(activity, {
  enrollment,
  quizAttempts = [],
  assignmentSubmissions = [],
}) {
  if (activity.type === 'video-lesson') {
    return (enrollment?.completedLessonIds || []).some((id) => documentId(id) === activity.id)
  }
  if (activity.type === 'quiz') {
    return quizAttempts.some((attempt) => (
      documentId(attempt.quizId) === activity.id
      && attempt.status === 'submitted'
      && attempt.passed === true
    ))
  }
  if (activity.type === 'assignment') {
    return assignmentSubmissions.some((submission) => (
      documentId(submission.assignmentId) === activity.id
    ))
  }
  return false
}

export function getCourseActivityProgression({
  course,
  enrollment,
  quizAttempts = [],
  assignmentSubmissions = [],
}) {
  const activities = getCourseActivitySequence(course).map((activity, index) => ({
    ...activity,
    index,
    completed: isCourseActivityCompleted(activity, { enrollment, quizAttempts, assignmentSubmissions }),
  }))
  const nextActivity = activities.find((activity) => !activity.completed) || null
  return { activities, nextActivity }
}

function getLatestSubmissionsByAssignment(submissions) {
  const latestSubmissions = new Map()
  for (const submission of submissions) {
    const assignmentId = documentId(submission.assignmentId)
    if (!assignmentId) continue
    const current = latestSubmissions.get(assignmentId)
    const submittedAt = new Date(submission.submittedAt || 0).getTime()
    const currentSubmittedAt = current ? new Date(current.submittedAt || 0).getTime() : -Infinity
    if (
      !current
      || submittedAt > currentSubmittedAt
      || (submittedAt === currentSubmittedAt && documentId(submission) > documentId(current))
    ) {
      latestSubmissions.set(assignmentId, submission)
    }
  }
  return latestSubmissions
}

export function calculateCourseProgress({
  course,
  enrollment,
  quizAttempts = [],
  assignmentSubmissions = [],
}) {
  const activities = getCourseProgressActivities(course)
  const completedVideoIds = new Set((enrollment?.completedLessonIds || []).map(String))
  const passedQuizIds = new Set(quizAttempts
    .filter((attempt) => attempt.status === 'submitted' && attempt.passed === true)
    .map((attempt) => documentId(attempt.quizId))
    .filter(Boolean))
  const latestSubmissions = getLatestSubmissionsByAssignment(assignmentSubmissions)

  const completedVideos = activities.videos.filter(({ id }) => completedVideoIds.has(id)).length
  const completedQuizzes = activities.quizzes.filter(({ id }) => passedQuizIds.has(id)).length
  const completedAssignments = activities.assignments.filter(({ id }) => (
    latestSubmissions.get(id)?.reviewStatus === 'approved'
  )).length
  const totalActivities = activities.videos.length + activities.quizzes.length + activities.assignments.length
  const completedActivities = completedVideos + completedQuizzes + completedAssignments
  const isComplete = totalActivities > 0 && completedActivities === totalActivities

  return {
    completedActivities,
    totalActivities,
    percentage: isComplete ? 100 : totalActivities
      ? Math.min(99, Math.floor((completedActivities / totalActivities) * 100))
      : 0,
    isComplete,
    videos: { completed: completedVideos, total: activities.videos.length },
    quizzes: { completed: completedQuizzes, total: activities.quizzes.length },
    assignments: { completed: completedAssignments, total: activities.assignments.length },
  }
}

export function summarizeCourseProgress(enrollments, quizAttempts = [], assignmentSubmissions = []) {
  const attemptsByEnrollmentId = new Map()
  const submissionsByEnrollmentId = new Map()
  for (const attempt of quizAttempts) {
    const key = documentId(attempt.enrollmentId)
    if (key) attemptsByEnrollmentId.set(key, [...(attemptsByEnrollmentId.get(key) || []), attempt])
  }
  for (const submission of assignmentSubmissions) {
    const key = documentId(submission.enrollmentId)
    if (key) submissionsByEnrollmentId.set(key, [...(submissionsByEnrollmentId.get(key) || []), submission])
  }

  const summary = {
    completed: 0,
    inProgress: 0,
    notStarted: 0,
    totalEnrollments: 0,
    completedActivities: 0,
    inProgressActivities: 0,
    notStartedActivities: 0,
    totalActivities: 0,
  }
  const eligibleStudentKeys = new Set()
  for (const enrollment of enrollments) {
    if (
      !['active', 'completed'].includes(enrollment.status)
      || enrollment.studentStatus !== 'active'
      || enrollment.studentIsActive === false
      || enrollment.courseStatus !== 'published'
      || !enrollment.course
      || !enrollment.courseId
      || !enrollment.userId
    ) continue

    eligibleStudentKeys.add(`${enrollment.studentType}:${documentId(enrollment.userId)}`)
    const enrollmentId = documentId(enrollment._id)
    const matchesEnrollment = (record) => (
      documentId(record.userId) === documentId(enrollment.userId)
      && documentId(record.courseId) === documentId(enrollment.courseId)
    )
    const progress = calculateCourseProgress({
      course: enrollment.course,
      enrollment,
      quizAttempts: (attemptsByEnrollmentId.get(enrollmentId) || []).filter(matchesEnrollment),
      assignmentSubmissions: (submissionsByEnrollmentId.get(enrollmentId) || []).filter(matchesEnrollment),
    })
    summary.totalEnrollments += 1
    summary.totalActivities += progress.totalActivities
    summary.completedActivities += progress.completedActivities
    if (progress.isComplete) {
      summary.completed += 1
    } else if (progress.completedActivities > 0) {
      summary.inProgress += 1
      summary.inProgressActivities += progress.totalActivities - progress.completedActivities
    } else {
      summary.notStarted += 1
      summary.notStartedActivities += progress.totalActivities
    }
  }
  summary.enrolledStudents = eligibleStudentKeys.size
  return summary
}

export function calculateCourseActivityProgress(course, enrollment, quizAttempts = [], assignmentSubmissions = []) {
  return calculateCourseProgress({ course, enrollment, quizAttempts, assignmentSubmissions })
}

export async function syncEnrollmentStatus(enrollment, progress) {
  if (!enrollment?._id || !enrollment.userId || enrollment.status === 'cancelled') {
    return enrollment?.status || 'active'
  }
  const status = progress.isComplete ? 'completed' : 'active'
  if (enrollment.status !== status) {
    await Enrollment.updateOne(
      {
        _id: enrollment._id,
        userId: enrollment.userId,
        courseId: enrollment.courseId?._id || enrollment.courseId,
        status: { $ne: 'cancelled' },
      },
      { $set: { status } },
    )
  }
  return status
}

export async function recalculateEnrollmentCourseProgress({ enrollment, course }) {
  const activities = getCourseProgressActivities(course)
  const [quizAttempts, assignmentSubmissions] = await Promise.all([
    activities.quizzes.length
      ? QuizAttempt.find({
        userId: enrollment.userId,
        enrollmentId: enrollment._id,
        courseId: course._id,
        quizId: { $in: activities.quizzes.map(({ id }) => id) },
        status: 'submitted',
        passed: true,
      }).select('quizId status passed').lean()
      : [],
    activities.assignments.length
      ? AssignmentSubmission.find({
        userId: enrollment.userId,
        enrollmentId: enrollment._id,
        courseId: course._id,
        assignmentId: { $in: activities.assignments.map(({ id }) => id) },
      }).select('assignmentId reviewStatus submittedAt').sort({ submittedAt: -1, _id: -1 }).lean()
      : [],
  ])
  const progress = calculateCourseProgress({ course, enrollment, quizAttempts, assignmentSubmissions })
  const status = await syncEnrollmentStatus(enrollment, progress)
  return { ...progress, status }
}

export async function recalculateEnrollmentsCourseProgress(enrollments, activityData) {
  const activeEnrollments = enrollments.filter((enrollment) => (
    enrollment.status !== 'cancelled' && enrollment.courseId
  ))
  const coursesById = new Map()
  for (const enrollment of activeEnrollments) {
    const course = enrollment.courseId
    const isCourseReference = typeof course === 'string'
      || course?._bsontype === 'ObjectId'
      || typeof course?.toHexString === 'function'
    if (course && typeof course === 'object' && !isCourseReference) {
      coursesById.set(documentId(course), course)
    }
  }
  const missingCourseIds = [...new Set(activeEnrollments
    .map(({ courseId }) => documentId(courseId))
    .filter((id) => id && !coursesById.has(id)))]
  if (missingCourseIds.length) {
    const courses = await Course.find({ _id: { $in: missingCourseIds } })
      .select('modules assignments quizzes')
      .lean()
    for (const course of courses) coursesById.set(documentId(course), course)
  }
  const eligibleEnrollments = activeEnrollments.filter(({ courseId }) => coursesById.has(documentId(courseId)))
  if (!eligibleEnrollments.length) {
    return enrollments.map((enrollment) => ({
      ...enrollment,
      courseProgress: calculateCourseProgress({
        course: coursesById.get(documentId(enrollment.courseId)) || enrollment.courseId,
      }),
    }))
  }

  const userId = eligibleEnrollments[0].userId
  const enrollmentIds = eligibleEnrollments.map(({ _id }) => _id)
  const courseIds = eligibleEnrollments.map(({ courseId }) => documentId(courseId))
  const coursesByEnrollmentId = new Map()
  const activitiesByEnrollmentId = new Map()
  for (const enrollment of eligibleEnrollments) {
    const enrollmentId = String(enrollment._id)
    const course = coursesById.get(documentId(enrollment.courseId))
    coursesByEnrollmentId.set(enrollmentId, course)
    activitiesByEnrollmentId.set(enrollmentId, getCourseProgressActivities(course))
  }
  const quizIds = [...new Set([...activitiesByEnrollmentId.values()].flatMap(({ quizzes }) => quizzes.map(({ id }) => id)))]
  const assignmentIds = [...new Set([...activitiesByEnrollmentId.values()].flatMap(({ assignments }) => assignments.map(({ id }) => id)))]
  const eligibleEnrollmentsById = new Map(
    eligibleEnrollments.map((enrollment) => [documentId(enrollment._id), enrollment]),
  )
  const [quizAttempts, assignmentSubmissions] = activityData
    ? [
      activityData.quizAttempts.filter((attempt) => {
        const enrollment = eligibleEnrollmentsById.get(documentId(attempt.enrollmentId))
        return enrollment
          && documentId(attempt.userId) === documentId(enrollment.userId)
          && documentId(attempt.courseId) === documentId(enrollment.courseId)
      }),
      activityData.assignmentSubmissions.filter((submission) => {
        const enrollment = eligibleEnrollmentsById.get(documentId(submission.enrollmentId))
        return enrollment
          && documentId(submission.userId) === documentId(enrollment.userId)
          && documentId(submission.courseId) === documentId(enrollment.courseId)
      }),
    ]
    : await Promise.all([
      quizIds.length
        ? QuizAttempt.find({
          userId,
          enrollmentId: { $in: enrollmentIds },
          courseId: { $in: courseIds },
          quizId: { $in: quizIds },
          status: 'submitted',
          passed: true,
        }).select('enrollmentId quizId status passed').lean()
        : [],
      assignmentIds.length
        ? AssignmentSubmission.find({
          userId,
          enrollmentId: { $in: enrollmentIds },
          courseId: { $in: courseIds },
          assignmentId: { $in: assignmentIds },
        }).select('enrollmentId assignmentId reviewStatus submittedAt').sort({ submittedAt: -1, _id: -1 }).lean()
        : [],
    ])
  const attemptsByEnrollmentId = new Map()
  const submissionsByEnrollmentId = new Map()
  for (const attempt of quizAttempts) {
    const key = String(attempt.enrollmentId)
    attemptsByEnrollmentId.set(key, [...(attemptsByEnrollmentId.get(key) || []), attempt])
  }
  for (const submission of assignmentSubmissions) {
    const key = String(submission.enrollmentId)
    submissionsByEnrollmentId.set(key, [...(submissionsByEnrollmentId.get(key) || []), submission])
  }

  const updatedEnrollments = await Promise.all(eligibleEnrollments.map(async (enrollment) => {
    const enrollmentId = String(enrollment._id)
    const course = coursesByEnrollmentId.get(enrollmentId)
    const progress = calculateCourseProgress({
      course,
      enrollment,
      quizAttempts: attemptsByEnrollmentId.get(enrollmentId) || [],
      assignmentSubmissions: submissionsByEnrollmentId.get(enrollmentId) || [],
    })
    const status = await syncEnrollmentStatus(enrollment, progress)
    return { ...enrollment, status, courseProgress: progress }
  }))
  const updatedByEnrollmentId = new Map(updatedEnrollments.map((enrollment) => [String(enrollment._id), enrollment]))
  return enrollments.map((enrollment) => (
    updatedByEnrollmentId.get(String(enrollment._id)) || {
      ...enrollment,
      courseProgress: calculateCourseProgress({
        course: coursesById.get(documentId(enrollment.courseId)) || enrollment.courseId,
      }),
    }
  ))
}
