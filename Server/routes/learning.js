import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import multer from 'multer'
import path from 'node:path'
import { Router } from 'express'
import AccountIdentity from '../models/AccountIdentity.js'
import College from '../models/College.js'
import Course from '../models/Course.js'
import Certificate from '../models/Certificate.js'
import Enrollment from '../models/Enrollment.js'
import AssignmentSubmission from '../models/AssignmentSubmission.js'
import QuizAttempt from '../models/QuizAttempt.js'
import {
  CollegeAdmin,
  CollegeStudent,
  Student,
  accountModelsByCollection,
} from '../models/account-models.js'
import { authenticate, requireRoles } from '../middleware/auth.js'
import {
  assertCollegeStudentCapacity,
  countCollegeStudents,
  getCollegeStudentLimit,
} from '../utils/college-student-capacity.js'
import { parseStudentCsv } from '../utils/student-csv.js'
import { toMongoBuffer } from '../utils/mongo-binary.js'
import QuizAttemptState from '../models/QuizAttemptState.js'
import VideoAttentionResponse from '../models/VideoAttentionResponse.js'
import CertificateTemplate from '../models/CertificateTemplate.js'
import { config } from '../config/env.js'
import {
  evaluateCertificateEligibility,
  generateCertificatePdf,
  getActiveCertificateTemplateId,
  getRequiredCertificateActivities,
  issueCertificateIfEligible,
} from '../utils/certificates.js'

const router = Router()
const requireStudent = [authenticate, requireRoles('student')]
const requireCollegeAdmin = [authenticate, requireRoles('college_admin')]
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/
const maxAssignmentSubmissionBytes = 10 * 1024 * 1024
const maxCertificateTemplateBytes = 4 * 1024 * 1024
const quizAttemptLimit = 3
const quizAttemptCooldownMs = 24 * 60 * 60 * 1000
const attentionCheckResponseTimeoutMs = 10 * 1000
const loggedInvalidAttentionConfigurations = new Set()
const assignmentFileTypes = new Map([
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
])
const assignmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxAssignmentSubmissionBytes, files: 1, fields: 0, parts: 1 },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname || '').toLowerCase()
    if (assignmentFileTypes.get(extension) !== file.mimetype) {
      const error = new Error('Upload a PDF, DOCX, or TXT file whose extension matches its file type.')
      error.statusCode = 415
      callback(error)
      return
    }
    callback(null, true)
  },
})

function certificateImageBuffer(imageData) {
  if (Buffer.isBuffer(imageData)) return imageData
  if (imageData instanceof Uint8Array) return Buffer.from(imageData)
  if (imageData?._bsontype === 'Binary' && Buffer.isBuffer(imageData.buffer)) {
    const length = Number.isInteger(imageData.position) ? imageData.position : imageData.buffer.length
    return Buffer.from(imageData.buffer.subarray(0, length))
  }
  return null
}

async function loadCertificateTemplateImage(template) {
  const storedImageData = certificateImageBuffer(template?.imageData)
  if (storedImageData?.length) return storedImageData
  if (typeof template?.secureUrl !== 'string' || !config.cloudinaryCloudName) {
    throw new Error('The certificate background used for this certificate is unavailable.')
  }

  const imageUrl = new URL(template.secureUrl)
  const expectedPath = `/${config.cloudinaryCloudName}/image/upload/`
  if (
    imageUrl.protocol !== 'https:'
    || imageUrl.hostname !== 'res.cloudinary.com'
    || !imageUrl.pathname.startsWith(expectedPath)
  ) {
    throw new Error('The certificate background URL is invalid.')
  }

  const response = await fetch(imageUrl, { redirect: 'error', signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error('The certificate background could not be loaded.')
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxCertificateTemplateBytes) {
    throw new Error('The certificate background exceeds the supported file size.')
  }
  const imageData = Buffer.from(await response.arrayBuffer())
  if (!imageData.length || imageData.length > maxCertificateTemplateBytes) {
    throw new Error('The certificate background could not be loaded.')
  }
  return imageData
}

function isValidObjectId(value) {
  return typeof value === 'string' && mongoose.isValidObjectId(value)
}

async function getAssignedCollegeAdmin(req) {
  const collegeId = req.auth.user.collegeId
  if (!isValidObjectId(collegeId)) return null
  const account = await CollegeAdmin.findById(req.auth.id)
    .select('collegeId studentLimit')
    .lean()
  return account && String(account.collegeId) === collegeId
    ? { ...account, collegeId: new mongoose.Types.ObjectId(collegeId) }
    : null
}

async function accountIdentifierExists(field, value) {
  if (await AccountIdentity.exists({ [field]: value })) return true
  for (const AccountModel of Object.values(accountModelsByCollection)) {
    if (await AccountModel.exists({ [field]: value })) return true
  }
  return false
}

function makeImportUsername(studentId) {
  const digest = createHash('sha256').update(studentId.toLowerCase()).digest('hex').slice(0, 20)
  return `college-${digest}`
}

function isDuplicateStudentId(studentId, model, session) {
  let query = model.findOne({ studentId })
    .collation({ locale: 'en', strength: 2 })
    .select('_id')
  if (session) query = query.session(session)
  return query.lean()
}

function getLessonPlaybackPositions(enrollment) {
  const positions = enrollment?.lessonPlaybackPositions
  if (positions instanceof Map) return Object.fromEntries(positions)
  return positions && typeof positions === 'object' ? { ...positions } : {}
}

function getCertificateCourseProgress(activities, pendingRequirements = [], earned = false) {
  const totalActivities = Object.values(activities).reduce((total, items) => total + items.length, 0)
  const incompleteActivities = pendingRequirements.filter((requirement) => (
    ['video', 'quiz', 'assignment'].includes(requirement.type)
  )).length
  const completedActivities = earned ? totalActivities : Math.max(0, totalActivities - incompleteActivities)
  return {
    completedActivities,
    totalActivities,
    percentage: earned ? 100 : totalActivities ? Math.round((completedActivities / totalActivities) * 100) : 0,
  }
}

function canonicalObjectId(value) {
  const isBsonObjectId = value instanceof mongoose.Types.ObjectId
    || (value?._bsontype === 'ObjectId' && typeof value.toHexString === 'function')
  if ((!isValidObjectId(value) && !isBsonObjectId) || !mongoose.isValidObjectId(value)) return ''
  return new mongoose.Types.ObjectId(value).toString()
}

function sanitizeStudentAttentionCheck(attentionCheck) {
  if (!attentionCheck) return attentionCheck
  return {
    enabled: attentionCheck.enabled === true,
    questionsDuringVideo: attentionCheck.questionsDuringVideo
      ?? Math.max(1, (attentionCheck.questions || []).length),
    minIntervalSeconds: attentionCheck.minIntervalSeconds ?? 120,
    maxIntervalSeconds: attentionCheck.maxIntervalSeconds ?? 300,
  }
}

function logInvalidAttentionCheckConfigurations(course) {
  for (const [moduleIndex, module] of (course.modules || []).entries()) {
    const videoLessons = [
      ...(module.lessons || []).map((lesson) => ({ lesson, source: 'legacy' })),
      ...(module.contentItems || [])
        .filter((item) => item.type === 'video-lesson')
        .map((lesson) => ({ lesson, source: 'contentItem' })),
    ]
    for (const { lesson, source } of videoLessons) {
      const settings = lesson.attentionCheck
      if (settings?.enabled !== true) continue

      const questions = settings.questions || []
      const isLegacy = settings.questionsDuringVideo === undefined
        && questions.every((question) => question.selectedForPlayback === undefined)
      const questionCount = Number(settings.questionsDuringVideo ?? Math.max(1, questions.length))
      const minIntervalSeconds = Number(settings.minIntervalSeconds ?? 120)
      const maxIntervalSeconds = Number(settings.maxIntervalSeconds ?? 300)
      const durationSeconds = Number(lesson.durationSeconds)
      const selectedQuestionCount = isLegacy
        ? questions.length
        : questions.filter((question) => question.selectedForPlayback === true).length
      const reasons = []

      if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 100) {
        reasons.push('invalid_question_count')
      }
      if (
        !Number.isInteger(minIntervalSeconds)
        || minIntervalSeconds < 10
        || minIntervalSeconds > 7200
        || !Number.isInteger(maxIntervalSeconds)
        || maxIntervalSeconds < minIntervalSeconds
        || maxIntervalSeconds > 7200
      ) {
        reasons.push('invalid_interval_range')
      }
      if (selectedQuestionCount !== questionCount) reasons.push('selected_question_count_mismatch')
      if (
        Number.isFinite(durationSeconds)
        && durationSeconds > 0
        && Number.isInteger(questionCount)
        && Number.isInteger(minIntervalSeconds)
        && durationSeconds < questionCount * minIntervalSeconds
      ) {
        reasons.push('video_duration_too_short')
      }
      if (!reasons.length) continue

      const diagnostic = {
        event: 'student.video_attention_check.invalid_configuration',
        courseId: String(course._id || ''),
        moduleIndex: moduleIndex + 1,
        lessonId: String(lesson._id || ''),
        lessonSource: source,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
        questionsDuringVideo: questionCount,
        selectedQuestionCount,
        minIntervalSeconds,
        maxIntervalSeconds,
        reasons,
      }
      const diagnosticKey = JSON.stringify(diagnostic)
      if (loggedInvalidAttentionConfigurations.has(diagnosticKey)) continue
      loggedInvalidAttentionConfigurations.add(diagnosticKey)
      console.warn(JSON.stringify(diagnostic))
    }
  }
}

function hideQuizAnswers(course) {
  if (!course) return course
  logInvalidAttentionCheckConfigurations(course)
  return {
    ...course,
    quizzes: course.quizzes?.map(({ questions, ...quiz }) => ({
      ...quiz,
      questions: questions?.map(({ correctOptionIndex, ...question }) => question),
    })),
    modules: course.modules?.map(({ quiz, lessons, contentItems, ...module }) => ({
      ...module,
      ...(lessons ? {
        lessons: lessons.map(({ attentionCheck, ...lesson }) => ({
          ...lesson,
          ...(attentionCheck ? { attentionCheck: sanitizeStudentAttentionCheck(attentionCheck) } : {}),
        })),
      } : {}),
      ...(quiz ? {
        quiz: {
          ...quiz,
          questions: quiz.questions?.map(({ correctOptionIndices, ...question }) => question),
        },
      } : {}),
      ...(contentItems ? {
        contentItems: contentItems.map(({ quiz: itemQuiz, attentionCheck, ...item }) => ({
          ...item,
          ...(attentionCheck ? { attentionCheck: sanitizeStudentAttentionCheck(attentionCheck) } : {}),
          ...(itemQuiz ? {
            quiz: {
              ...itemQuiz,
              questions: itemQuiz.questions?.map(({ correctOptionIndices, ...question }) => question),
            },
          } : {}),
        })),
      } : {}),
    })),
  }
}

function courseHasLesson(course, lessonId) {
  return course?.modules?.some((module) => {
    const videoItems = module.contentItems?.filter((item) => item.type === 'video-lesson') || []
    const lessons = videoItems.length ? videoItems : module.lessons || []
    return lessons.some((lesson) => String(lesson._id) === lessonId)
  })
}

function getCourseLessonIds(course) {
  return (course?.modules || []).flatMap((module) => {
    const videoItems = module.contentItems?.filter((item) => item.type === 'video-lesson') || []
    const lessons = videoItems.length ? videoItems : module.lessons || []
    return lessons.map((lesson) => String(lesson._id)).filter(Boolean)
  })
}

function getCourseAssignmentCount(course) {
  const ids = new Set((course?.assignments || []).map((assignment) => String(assignment._id)))
  for (const module of course?.modules || []) {
    for (const item of module.contentItems || []) {
      if (item.type === 'assignment') ids.add(String(item._id))
    }
  }
  return ids
}

function getLearningStreak(dates, now = new Date()) {
  const activeDays = new Set(dates
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()))
    .map((date) => date.toISOString().slice(0, 10)))
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const yesterday = new Date(today)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const todayKey = today.toISOString().slice(0, 10)
  const yesterdayKey = yesterday.toISOString().slice(0, 10)
  if (!activeDays.has(todayKey) && !activeDays.has(yesterdayKey)) return 0

  const currentDay = new Date(activeDays.has(todayKey) ? today : yesterday)
  let streak = 0
  while (activeDays.has(currentDay.toISOString().slice(0, 10))) {
    streak += 1
    currentDay.setUTCDate(currentDay.getUTCDate() - 1)
  }
  return streak
}

function summarizeStudentLearning(enrollments, assignmentSubmissions, now = new Date()) {
  const enrollmentsByCourse = new Map()
  for (const enrollment of enrollments) {
    const course = enrollment.courseId
    if (!course || typeof course !== 'object') continue
    const courseId = String(course._id)
    if (courseId && !enrollmentsByCourse.has(courseId)) {
      enrollmentsByCourse.set(courseId, enrollment)
    }
  }

  let completedCourses = 0
  let completedLessons = 0
  let inProgressLessons = 0
  let notStartedLessons = 0
  let totalLessons = 0
  let pendingAssignments = 0
  const completionDates = []
  const submittedAssignments = new Map()
  for (const submission of assignmentSubmissions) {
    const key = `${submission.enrollmentId}:${submission.assignmentId}`
    submittedAssignments.set(key, true)
  }

  for (const enrollment of enrollmentsByCourse.values()) {
    const course = enrollment.courseId
    const lessonIds = getCourseLessonIds(course)
    const lessonIdSet = new Set(lessonIds)
    const completedIds = new Set((enrollment.completedLessonIds || []).map(String))
    const startedIds = new Set((enrollment.startedLessonIds || []).map(String))
    let completedInCourse = 0

    for (const lessonId of lessonIdSet) {
      if (completedIds.has(lessonId)) {
        completedInCourse += 1
        completedLessons += 1
      } else if (startedIds.has(lessonId)) {
        inProgressLessons += 1
      } else {
        notStartedLessons += 1
      }
    }

    totalLessons += lessonIdSet.size
    if (lessonIdSet.size > 0 && completedInCourse === lessonIdSet.size) completedCourses += 1
    for (const assignmentId of getCourseAssignmentCount(course)) {
      if (!submittedAssignments.has(`${enrollment._id}:${assignmentId}`)) pendingAssignments += 1
    }

    const savedCompletionDates = enrollment.lessonCompletionDates instanceof Map
      ? [...enrollment.lessonCompletionDates.entries()]
      : Object.entries(enrollment.lessonCompletionDates || {})
    for (const [lessonId, completedAt] of savedCompletionDates) {
      if (lessonIdSet.has(String(lessonId)) && completedIds.has(String(lessonId))) {
        completionDates.push(completedAt)
      }
    }
  }

  return {
    enrolledCourses: enrollmentsByCourse.size,
    pendingAssignments,
    completedCourses,
    learningStreak: getLearningStreak(completionDates, now),
    completedLessons,
    inProgressLessons,
    notStartedLessons,
    totalLessons,
    completionPercentage: totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0,
  }
}

function getStudentEnrollmentScope(req) {
  return req.auth.user.studentType === 'college'
    ? { collegeId: req.auth.user.collegeId }
    : { collegeId: { $exists: false } }
}

function findQuiz(course, quizId) {
  const requestedQuizId = canonicalObjectId(quizId)
  if (!requestedQuizId) return null
  for (const module of course?.modules || []) {
    for (const item of module.contentItems || []) {
      if (canonicalObjectId(item.quiz?._id) === requestedQuizId) return item.quiz
    }
  }
  for (const module of course?.modules || []) {
    if (canonicalObjectId(module.quiz?._id) === requestedQuizId) return module.quiz
  }
  for (const quiz of course?.quizzes || []) {
    if (canonicalObjectId(quiz._id) === requestedQuizId) return quiz
  }
  return null
}

function getQuizAttemptStatus(state, now = new Date()) {
  const lockedUntil = state.lockedUntil || null
  const remainingLockMs = lockedUntil ? Math.max(0, new Date(lockedUntil).getTime() - now.getTime()) : 0
  return {
    maxAttempts: quizAttemptLimit,
    attemptsUsed: state.attemptsUsed,
    attemptsRemaining: state.passed || remainingLockMs > 0
      ? 0
      : Math.max(0, quizAttemptLimit - state.attemptsUsed),
    cycleNumber: state.cycleNumber,
    passed: state.passed,
    lockedUntil,
    remainingLockMs,
    serverTime: now,
  }
}

async function getQuizAttemptState(key, now = new Date()) {
  let state = await QuizAttemptState.findOne(key).lean()
  if (!state) {
    const history = await QuizAttempt.find(key)
      .select('status passed submittedAt createdAt attemptNumber cycleNumber')
      .sort({ createdAt: 1 })
      .lean()
    const submitted = history.filter((attempt) => attempt.status === 'submitted')
    const passed = submitted.some((attempt) => attempt.passed === true)
    const lastThree = submitted.slice(-quizAttemptLimit)
    const thirdFailure = !passed
      && lastThree.length === quizAttemptLimit
      && lastThree.every((attempt) => attempt.passed === false)
      ? lastThree[lastThree.length - 1]
      : null
    let attemptsUsed = Math.min(history.length, quizAttemptLimit)
    let cycleNumber = 1
    let lockedUntil = null
    if (thirdFailure) {
      const failedAt = thirdFailure.submittedAt || thirdFailure.createdAt
      if (failedAt) lockedUntil = new Date(new Date(failedAt).getTime() + quizAttemptCooldownMs)
      if (lockedUntil && lockedUntil <= now) {
        attemptsUsed = 0
        cycleNumber += 1
        lockedUntil = null
      } else {
        attemptsUsed = quizAttemptLimit
      }
    }

    try {
      state = await QuizAttemptState.findOneAndUpdate(
        key,
        {
          $setOnInsert: {
            ...key,
            attemptsUsed,
            cycleNumber,
            passed,
            lockedUntil,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean()
    } catch (error) {
      if (error?.code !== 11000) throw error
      state = await QuizAttemptState.findOne(key).lean()
      if (!state) throw error
    }
  }

  if (state.lockedUntil && new Date(state.lockedUntil) <= now && !state.passed) {
    const resetState = await QuizAttemptState.findOneAndUpdate(
      { ...key, cycleNumber: state.cycleNumber, lockedUntil: state.lockedUntil },
      {
        $set: { attemptsUsed: 0, lockedUntil: null },
        $inc: { cycleNumber: 1 },
      },
      { new: true },
    ).lean()
    state = resetState || await QuizAttemptState.findOne(key).lean()
  }
  return state
}

async function reserveQuizAttempt(key, now = new Date()) {
  let state = await getQuizAttemptState(key, now)
  if (state.passed) return { state, reason: 'passed' }
  if (state.lockedUntil && new Date(state.lockedUntil) > now) return { state, reason: 'locked' }
  if (state.attemptsUsed >= quizAttemptLimit) return { state, reason: 'exhausted' }

  const reservedState = await QuizAttemptState.findOneAndUpdate(
    {
      ...key,
      cycleNumber: state.cycleNumber,
      attemptsUsed: { $lt: quizAttemptLimit },
      passed: { $ne: true },
      $or: [
        { lockedUntil: null },
        { lockedUntil: { $exists: false } },
        { lockedUntil: { $lte: now } },
      ],
    },
    { $inc: { attemptsUsed: 1 } },
    { new: true },
  ).lean()
  if (reservedState) return { state: reservedState, attemptNumber: reservedState.attemptsUsed }

  state = await getQuizAttemptState(key, now)
  if (state.passed) return { state, reason: 'passed' }
  if (state.lockedUntil && new Date(state.lockedUntil) > now) return { state, reason: 'locked' }
  return { state, reason: 'exhausted' }
}

function findVideoLesson(course, lessonId) {
  for (const module of course?.modules || []) {
    const lessons = [
      ...(module.lessons || []),
      ...(module.contentItems || []).filter((item) => item.type === 'video-lesson'),
    ]
    const lesson = lessons.find((item) => canonicalObjectId(item._id) === lessonId)
    if (lesson) return lesson
  }
  return null
}

function getSelectedAttentionQuestions(attentionCheck) {
  const questions = attentionCheck?.questions || []
  const isLegacy = attentionCheck?.questionsDuringVideo === undefined
    && questions.every((question) => question.selectedForPlayback === undefined)
  return questions.filter((question) => isLegacy || question.selectedForPlayback === true)
}

function isCorrectAttentionAnswer(selectedIndices, correctIndices) {
  const sortedSelected = [...selectedIndices].sort((a, b) => a - b)
  const sortedCorrect = [...correctIndices].sort((a, b) => a - b)
  return sortedSelected.length === sortedCorrect.length
    && sortedSelected.every((index, position) => index === sortedCorrect[position])
}

function getQuizQuestionSnapshot(quiz) {
  const questionIds = new Set()
  return quiz.questions.map((question, index) => {
    const questionId = canonicalObjectId(question._id)
    if (!questionId) {
      const error = new Error(`Question ${index + 1} is missing a valid saved question ID.`)
      error.statusCode = 400
      throw error
    }
    if (questionIds.has(questionId)) {
      const error = new Error(`Question ${index + 1} has a duplicate saved question ID.`)
      error.statusCode = 400
      throw error
    }
    questionIds.add(questionId)
    const correctOptionIndices = Array.isArray(question.correctOptionIndices) && question.correctOptionIndices.length > 0
      ? question.correctOptionIndices
      : Number.isInteger(question.correctOptionIndex) ? [question.correctOptionIndex] : []
    return {
      questionId,
      prompt: question.prompt,
      type: question.type || 'multiple-choice',
      options: question.options || [],
      correctOptionIndices,
      marks: question.marks,
      explanation: question.explanation || '',
    }
  })
}

function getPublicQuestionSnapshot(questionSnapshot) {
  return questionSnapshot.map(({ questionId, prompt, type, options }) => ({
    _id: questionId,
    prompt,
    type,
    options,
  }))
}

function serializeQuizAttempt(attempt) {
  const { questionSnapshot, ...publicAttempt } = attempt
  return {
    ...publicAttempt,
    ...(questionSnapshot?.length ? { questions: getPublicQuestionSnapshot(questionSnapshot) } : {}),
  }
}

function findAssignment(course, assignmentId) {
  for (const assignment of course?.assignments || []) {
    if (String(assignment._id) === assignmentId) return assignment
  }
  for (const module of course?.modules || []) {
    const assignment = (module.contentItems || []).find((item) => (
      item.type === 'assignment' && String(item._id) === assignmentId
    ))
    if (assignment) return assignment
  }
  return null
}

function sanitizeSubmissionFileName(fileName) {
  return path.basename(fileName).replace(/[^\w.-]/g, '_').slice(0, 180) || 'assignment'
}

function isValidAssignmentFile(file) {
  if (!file?.buffer?.length || file.buffer.length > maxAssignmentSubmissionBytes) return false
  if (file.mimetype === 'application/pdf') return file.buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return file.buffer.length >= 4
      && file.buffer[0] === 0x50
      && file.buffer[1] === 0x4b
      && file.buffer[2] === 0x03
      && file.buffer[3] === 0x04
  }
  if (file.mimetype === 'text/plain') {
    return !file.buffer.includes(0)
      && file.buffer.every((byte) => byte === 9 || byte === 10 || byte === 13 || byte >= 32)
  }
  return false
}

function receiveAssignmentSubmission(req, res, next) {
  assignmentUpload.single('file')(req, res, (error) => {
    if (!error) return next()
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'Assignment submissions must be 10 MB or smaller.' })
    }
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ message: 'Choose one assignment file to upload.' })
    }
    if (error.statusCode === 415) return res.status(415).json({ message: error.message })
    return next(error)
  })
}

router.post('/college/students', ...requireCollegeAdmin, async (req, res, next) => {
  try {
    const subAdmin = await getAssignedCollegeAdmin(req)
    if (!subAdmin) {
      return res.status(403).json({ message: 'Your Sub-Admin account is not assigned to a valid college.' })
    }

    const { fullName, email, username, password, studentId, department, batch } = req.body ?? {}
    if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 120) {
      return res.status(400).json({ message: 'Enter a student name between 1 and 120 characters.' })
    }
    if (typeof email !== 'string' || email.trim().length > 254 || !emailPattern.test(email.trim())) {
      return res.status(400).json({ message: 'Enter a valid email address.' })
    }
    if (typeof username !== 'string' || !usernamePattern.test(username.trim())) {
      return res.status(400).json({ message: 'Use a username with 3–30 letters, numbers, dots, underscores, or hyphens.' })
    }
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ message: 'Use a password of at least 8 characters.' })
    }
    if (typeof studentId !== 'string' || !studentId.trim() || studentId.trim().length > 100) {
      return res.status(400).json({ message: 'Enter a student ID of up to 100 characters.' })
    }
    if (department !== undefined && (typeof department !== 'string' || department.trim().length > 120)) {
      return res.status(400).json({ message: 'Department must be 120 characters or fewer.' })
    }
    if (batch !== undefined && (typeof batch !== 'string' || batch.trim().length > 80)) {
      return res.status(400).json({ message: 'Batch must be 80 characters or fewer.' })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()
    const normalizedStudentId = studentId.trim()
    const [existingEmail, existingUsername, existingStudentId] = await Promise.all([
      accountIdentifierExists('email', normalizedEmail),
      accountIdentifierExists('username', normalizedUsername),
      Promise.all([
        isDuplicateStudentId(normalizedStudentId, Student),
        isDuplicateStudentId(normalizedStudentId, CollegeStudent),
      ]).then((matches) => matches.some(Boolean)),
    ])
    if (existingEmail) return res.status(409).json({ message: 'An account with this email already exists.' })
    if (existingUsername) return res.status(409).json({ message: 'This username is already taken.' })
    if (existingStudentId) return res.status(409).json({ message: 'This student ID already exists.' })

    const accountId = new mongoose.Types.ObjectId()
    const passwordHash = await bcrypt.hash(password, 12)
    const session = await mongoose.startSession()
    let student
    try {
      await session.withTransaction(async () => {
        await assertCollegeStudentCapacity(subAdmin.collegeId, session)
        const duplicate = await AccountIdentity.findOne({
          $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
        }).session(session)
        if (duplicate) {
          const error = new Error('Email or username already belongs to an LMS account.')
          error.statusCode = 409
          throw error
        }
        if ((await Promise.all([
          isDuplicateStudentId(normalizedStudentId, Student, session),
          isDuplicateStudentId(normalizedStudentId, CollegeStudent, session),
        ])).some(Boolean)) {
          const error = new Error('This student ID already exists.')
          error.statusCode = 409
          throw error
        }
        await AccountIdentity.create([{
          email: normalizedEmail,
          username: normalizedUsername,
          accountCollection: CollegeStudent.collection.name,
          accountId,
        }], { session })
        ;[student] = await CollegeStudent.create([{
          _id: accountId,
          fullName: fullName.trim(),
          email: normalizedEmail,
          username: normalizedUsername,
          studentId: normalizedStudentId,
          department: department?.trim() || undefined,
          batch: batch?.trim() || undefined,
          passwordHash,
          role: 'student',
          studentType: 'college',
          collegeId: subAdmin.collegeId,
          status: 'active',
          isActive: true,
          permissions: [],
        }], { session })
      })
    } finally {
      await session.endSession()
    }
    return res.status(201).json({
      message: 'College student created.',
      student: {
        id: String(student._id),
        fullName: student.fullName,
        email: student.email,
        studentId: student.studentId,
        department: student.department || '',
        batch: student.batch || '',
      },
    })
  } catch (error) {
    if (error?.statusCode === 409) {
      return res.status(409).json({ message: error.message })
    }
    return next(error)
  }
})

router.post('/college/students/import', ...requireCollegeAdmin, async (req, res, next) => {
  try {
    const subAdmin = await getAssignedCollegeAdmin(req)
    if (!subAdmin) {
      return res.status(403).json({ message: 'Your Sub-Admin account is not assigned to a valid college.' })
    }
    let rows
    try {
      rows = parseStudentCsv(req.body?.csvText)
    } catch (error) {
      return res.status(400).json({ message: error.message })
    }
    if (rows.length > 500) {
      return res.status(400).json({ message: 'Import is limited to 500 students per CSV.' })
    }

    const imported = []
    const failures = []
    const seenEmails = new Set()
    const seenStudentIds = new Set()
    const seenUsernames = new Set()
    for (const row of rows) {
      if (row.error) {
        failures.push({ row: row.rowNumber, reason: row.error })
        continue
      }

      const { fullName, studentId, email, department, batch } = row
      const username = makeImportUsername(studentId)
      const errors = []
      if (!fullName || fullName.length > 120) errors.push('Full Name is required and must be 120 characters or fewer.')
      if (!studentId || studentId.length > 100) errors.push('Student ID is required and must be 100 characters or fewer.')
      if (!emailPattern.test(email) || email.length > 254) errors.push('Enter a valid email address.')
      if (!department || department.length > 120) errors.push('Department is required and must be 120 characters or fewer.')
      if (!batch || batch.length > 80) errors.push('Batch is required and must be 80 characters or fewer.')
      if (seenEmails.has(email)) errors.push('Email is duplicated in this CSV.')
      if (seenStudentIds.has(studentId.toLowerCase())) errors.push('Student ID is duplicated in this CSV.')
      if (seenUsernames.has(username)) errors.push('Generated username is duplicated in this CSV.')
      seenEmails.add(email)
      seenStudentIds.add(studentId.toLowerCase())
      seenUsernames.add(username)
      if (!errors.length) {
        const [existingEmail, existingStudentId, existingUsername] = await Promise.all([
          accountIdentifierExists('email', email),
          isDuplicateStudentId(studentId, CollegeStudent),
          accountIdentifierExists('username', username),
        ])
        if (existingEmail) errors.push('Email already belongs to an LMS account.')
        if (existingStudentId) errors.push('Student ID already exists.')
        if (existingUsername) errors.push('Generated username conflicts with an LMS account.')
      }
      if (errors.length) {
        failures.push({ row: row.rowNumber, email, studentId, reason: errors.join(' ') })
        continue
      }

      const accountId = new mongoose.Types.ObjectId()
      const passwordHash = await bcrypt.hash(randomBytes(48).toString('base64url'), 12)
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          await assertCollegeStudentCapacity(subAdmin.collegeId, session)
          await AccountIdentity.create([{
            email,
            username,
            accountCollection: CollegeStudent.collection.name,
            accountId,
          }], { session })
          await CollegeStudent.create([{
            _id: accountId,
            fullName,
            email,
            username,
            studentId,
            department,
            batch,
            passwordHash,
            role: 'student',
            studentType: 'college',
            collegeId: subAdmin.collegeId,
            status: 'active',
            isActive: true,
            permissions: [],
          }], { session })
        })
        imported.push({ row: row.rowNumber, email, studentId })
      } catch (error) {
        if (error?.statusCode === 409 || error?.code === 11000) {
          failures.push({ row: row.rowNumber, email, studentId, reason: error.message || 'Email, username, or Student ID already exists.' })
        } else {
          throw error
        }
      } finally {
        await session.endSession()
      }
    }
    return res.json({
      message: 'College student import completed. No invitation emails were sent.',
      summary: { total: rows.length, imported: imported.length, failed: failures.length },
      imported,
      failures,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/courses', ...requireStudent, async (req, res, next) => {
  try {
    const courses = await Course.find({ status: 'published' })
      .select('title description detailedDescription category difficulty thumbnailUrl learningObjectives prerequisites estimatedDurationMinutes modules assignments quizzes status createdAt')
      .sort({ title: 1 })
      .lean()
    return res.json({ courses: courses.map(hideQuizAnswers) })
  } catch (error) {
    return next(error)
  }
})

router.get('/learning/summary', ...requireStudent, async (req, res, next) => {
  try {
    const scope = req.auth.user.studentType === 'college'
      ? { collegeId: req.auth.user.collegeId }
      : { collegeId: { $exists: false } }
    const enrollmentQuery = {
      userId: req.auth.id,
      ...scope,
      status: { $ne: 'cancelled' },
    }
    const enrollments = await Enrollment.find(enrollmentQuery)
      .populate('courseId', 'modules assignments')
      .sort({ createdAt: -1 })
      .lean()
    const assignmentSubmissions = enrollments.length
      ? await AssignmentSubmission.find({
        userId: req.auth.id,
        enrollmentId: { $in: enrollments.map((enrollment) => enrollment._id) },
      }).select('enrollmentId assignmentId').lean()
      : []
    return res.json({ summary: summarizeStudentLearning(enrollments, assignmentSubmissions) })
  } catch (error) {
    return next(error)
  }
})

router.get('/courses/:courseId/learning-content', ...requireStudent, async (req, res, next) => {
  try {
    const { courseId } = req.params
    if (!isValidObjectId(courseId)) return res.status(400).json({ message: 'Select a valid course.' })
    const enrollmentQuery = {
      userId: req.auth.id,
      courseId,
      ...getStudentEnrollmentScope(req),
      status: { $ne: 'cancelled' },
    }
    const enrollment = await Enrollment.findOne(enrollmentQuery).sort({ createdAt: -1 }).lean()
    if (!enrollment) return res.status(404).json({ message: 'Enroll in this course before accessing its content.' })
    const course = await Course.findById(courseId)
      .select('+modules.quiz.questions.correctOptionIndices +modules.contentItems.quiz.questions.correctOptionIndices +quizzes.questions.correctOptionIndex')
      .lean()
    if (!course) return res.status(404).json({ message: 'The enrolled course could not be found.' })

    const [assignmentSubmissions, quizAttempts] = await Promise.all([
      AssignmentSubmission.find({ userId: req.auth.id, enrollmentId: enrollment._id })
        .select('_id assignmentId fileName contentType fileSize submittedAt reviewStatus')
        .sort({ submittedAt: -1, _id: -1 })
        .lean(),
      QuizAttempt.find({ userId: req.auth.id, enrollmentId: enrollment._id })
        .select('_id quizId status startedAt passingPercentage timeLimitMinutes timeTakenSeconds answers earnedPoints totalPoints correctAnswers incorrectAnswers scorePercentage passed submittedAt createdAt +questionSnapshot')
        .sort({ createdAt: -1 })
        .lean(),
    ])
    return res.json({
      enrollment: {
        ...enrollment,
        lessonPlaybackPositions: getLessonPlaybackPositions(enrollment),
        courseId: hideQuizAnswers(course),
      },
      assignmentSubmissions: assignmentSubmissions.map((submission) => ({
        ...submission,
        reviewStatus: ['approved', 'rejected'].includes(submission.reviewStatus)
          ? submission.reviewStatus
          : 'pending',
      })),
      quizAttempts: quizAttempts.map(serializeQuizAttempt),
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/courses/:courseId/attention-checks/:lessonId/start', ...requireStudent, async (req, res, next) => {
  try {
    const { courseId, lessonId } = req.params
    const { sessionId, triggerIndex, positionSeconds } = req.body ?? {}
    if (
      !isValidObjectId(courseId)
      || !isValidObjectId(lessonId)
      || typeof sessionId !== 'string'
      || !/^[a-f\d-]{36}$/i.test(sessionId)
      || !Number.isInteger(triggerIndex)
      || triggerIndex < 0
      || triggerIndex > 99
      || !Number.isFinite(positionSeconds)
      || positionSeconds < 0
      || positionSeconds > 43200
    ) {
      return res.status(400).json({ message: 'A valid course, lesson, playback session, question number, and video position are required.' })
    }

    const enrollment = await Enrollment.findOne({
      userId: req.auth.id,
      courseId,
      ...getStudentEnrollmentScope(req),
      status: { $ne: 'cancelled' },
    }).sort({ createdAt: -1 }).lean()
    if (!enrollment) return res.status(404).json({ message: 'An active enrollment is required to answer this attention check.' })

    const course = await Course.findById(courseId)
      .select('+modules.lessons.attentionCheck.questions.correctOptionIndices +modules.contentItems.attentionCheck.questions.correctOptionIndices')
      .lean()
    if (!course) return res.status(404).json({ message: 'The enrolled course could not be found.' })
    const lesson = findVideoLesson(course, lessonId)
    const attentionCheck = lesson?.attentionCheck
    if (!attentionCheck?.enabled) return res.status(404).json({ message: 'Attention checks are not enabled for this lesson.' })

    const questions = getSelectedAttentionQuestions(attentionCheck)
    const questionCount = attentionCheck.questionsDuringVideo ?? questions.length
    if (!questions.length || questions.length !== questionCount || triggerIndex >= questionCount) {
      return res.status(409).json({ message: 'The attention check configuration for this lesson is incomplete.' })
    }

    const scope = {
      userId: req.auth.id,
      enrollmentId: enrollment._id,
      courseId,
      lessonId,
      sessionId,
      triggerIndex,
    }
    const previousResponse = await VideoAttentionResponse.findOne(scope).select('+correctOptionIndices').lean()
    if (previousResponse && previousResponse.status !== 'presented') {
      return res.json({
        recorded: true,
        status: previousResponse.status,
        responseTimeMs: previousResponse.responseTimeMs,
        presentedAt: previousResponse.presentedAt,
        serverTime: new Date(),
      })
    }
    if (previousResponse) {
      return res.json({
        responseId: String(previousResponse._id),
        question: {
          _id: String(previousResponse.questionId),
          prompt: previousResponse.questionPrompt,
          type: previousResponse.questionType,
          options: previousResponse.options,
        },
        presentedAt: previousResponse.presentedAt,
        serverTime: new Date(),
      })
    }

    const priorResponses = await VideoAttentionResponse.find({
      userId: req.auth.id,
      enrollmentId: enrollment._id,
      lessonId,
      sessionId,
    }).select('questionId').lean()
    const usedQuestionIds = new Set(priorResponses.map((response) => String(response.questionId)))
    const availableQuestions = questions.filter((question) => !usedQuestionIds.has(String(question._id)))
    if (!availableQuestions.length) {
      return res.status(409).json({ message: 'There are no unused attention questions remaining in this playback session.' })
    }
    const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)]
    const presentedAt = new Date()
    const response = await VideoAttentionResponse.create({
      userId: req.auth.id,
      ...(req.auth.user.studentType === 'college' ? { collegeId: req.auth.user.collegeId } : {}),
      enrollmentId: enrollment._id,
      courseId,
      lessonId,
      lessonTitle: lesson.title || 'Video lesson',
      sessionId,
      triggerIndex,
      questionId: question._id,
      questionPrompt: question.prompt,
      questionType: question.type,
      options: question.options,
      correctOptionIndices: question.correctOptionIndices,
      videoPositionSeconds: positionSeconds,
      presentedAt,
      status: 'presented',
    })
    return res.status(201).json({
      responseId: String(response._id),
      question: {
        _id: String(question._id),
        prompt: question.prompt,
        type: question.type,
        options: question.options,
      },
      presentedAt,
      serverTime: new Date(),
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/courses/:courseId/attention-checks/:lessonId/submit', ...requireStudent, async (req, res, next) => {
  try {
    const { courseId, lessonId } = req.params
    const { responseId, selectedOptionIndices, notAnswered } = req.body ?? {}
    if (!isValidObjectId(courseId) || !isValidObjectId(lessonId) || !isValidObjectId(responseId)) {
      return res.status(400).json({ message: 'Select a valid course, lesson, and attention check response.' })
    }
    if (notAnswered !== undefined && typeof notAnswered !== 'boolean') {
      return res.status(400).json({ message: 'The attention check response status is invalid.' })
    }

    const enrollment = await Enrollment.findOne({
      userId: req.auth.id,
      courseId,
      ...getStudentEnrollmentScope(req),
      status: { $ne: 'cancelled' },
    }).sort({ createdAt: -1 }).lean()
    if (!enrollment) return res.status(404).json({ message: 'An active enrollment is required to submit this attention check.' })

    const response = await VideoAttentionResponse.findOne({
      _id: responseId,
      userId: req.auth.id,
      enrollmentId: enrollment._id,
      courseId,
      lessonId,
    }).select('+correctOptionIndices')
    if (!response) return res.status(409).json({ message: 'This attention check is no longer available for submission.' })
    const answeredAt = new Date()
    const responseTimeMs = Math.max(0, answeredAt.getTime() - new Date(response.presentedAt).getTime())
    const isTimedOut = responseTimeMs >= attentionCheckResponseTimeoutMs
    const hasNoAnswer = notAnswered === true
      || selectedOptionIndices === undefined
      || (Array.isArray(selectedOptionIndices) && selectedOptionIndices.length === 0)
    const isNotAnswered = hasNoAnswer || isTimedOut

    if (response.status === 'answered') {
      if (notAnswered === true || !Array.isArray(selectedOptionIndices) || !isCorrectAttentionAnswer(selectedOptionIndices, response.selectedOptionIndices || [])) {
        return res.status(409).json({ message: 'This attention check has already been answered.' })
      }
      return res.json({
        recorded: true,
        status: 'answered',
        isCorrect: response.isCorrect,
        responseTimeMs: response.responseTimeMs,
      })
    }

    if (response.status === 'not_answered') {
      if (!isNotAnswered) return res.status(409).json({ message: 'This attention check was recorded as not answered.' })
      return res.json({
        recorded: true,
        status: 'not_answered',
        isCorrect: false,
        responseTimeMs: response.responseTimeMs,
      })
    }

    if (isNotAnswered && !isTimedOut) {
      return res.status(409).json({ message: 'The 10-second response window is still active.' })
    }

    if (isNotAnswered) {
      response.selectedOptionIndices = []
      response.answeredAt = answeredAt
      response.responseTimeMs = attentionCheckResponseTimeoutMs
      response.isCorrect = false
      response.status = 'not_answered'
      await response.save()
      return res.json({
        recorded: true,
        status: 'not_answered',
        isCorrect: false,
        responseTimeMs: response.responseTimeMs,
      })
    }

    if (
      !Array.isArray(selectedOptionIndices)
      || selectedOptionIndices.length < 1
      || selectedOptionIndices.length > response.options.length
      || selectedOptionIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= response.options.length)
      || new Set(selectedOptionIndices).size !== selectedOptionIndices.length
      || (response.questionType !== 'multiple-select' && selectedOptionIndices.length !== 1)
    ) {
      return res.status(400).json({ message: 'Select a valid answer for this attention check.' })
    }

    response.selectedOptionIndices = selectedOptionIndices
    response.answeredAt = answeredAt
    response.responseTimeMs = responseTimeMs
    response.isCorrect = isCorrectAttentionAnswer(selectedOptionIndices, response.correctOptionIndices)
    response.status = 'answered'
    await response.save()
    return res.json({
      recorded: true,
      status: 'answered',
      isCorrect: response.isCorrect,
      responseTimeMs: response.responseTimeMs,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/courses/:courseId/quizzes/:quizId/attempts/status', ...requireStudent, async (req, res, next) => {
  try {
    const { courseId, quizId } = req.params
    if (![courseId, quizId].every(isValidObjectId)) {
      return res.status(400).json({ message: 'Select a valid course and quiz.' })
    }
    const enrollment = await Enrollment.findOne({
      userId: req.auth.id,
      courseId,
      ...getStudentEnrollmentScope(req),
      status: { $ne: 'cancelled' },
    }).sort({ createdAt: -1 }).lean()
    if (!enrollment) return res.status(404).json({ message: 'An active enrollment is required to view quiz status.' })

    const course = await Course.findById(courseId).select('_id modules quizzes').lean()
    if (!course) return res.status(404).json({ message: 'The enrolled course could not be found.' })
    if (!findQuiz(course, quizId)) return res.status(404).json({ message: 'This quiz is not available in the enrolled course.' })

    const now = new Date()
    const state = await getQuizAttemptState({
      userId: req.auth.id,
      courseId,
      quizId,
    }, now)
    return res.status(200).json({ quizStatus: getQuizAttemptStatus(state, now) })
  } catch (error) {
    return next(error)
  }
})

router.post('/courses/:courseId/quizzes/:quizId/attempts/start', ...requireStudent, async (req, res, next) => {
  try {
    const { courseId, quizId } = req.params
    if (!isValidObjectId(courseId) || !isValidObjectId(quizId)) {
      return res.status(400).json({ message: 'Select a valid course and quiz.' })
    }
    const enrollment = await Enrollment.findOne({
      userId: req.auth.id,
      courseId,
      ...getStudentEnrollmentScope(req),
      status: { $ne: 'cancelled' },
    }).sort({ createdAt: -1 }).lean()
    if (!enrollment) return res.status(404).json({ message: 'An active enrollment is required to submit this quiz.' })

    const course = await Course.findById(courseId)
      .select('+modules.quiz.questions.correctOptionIndices +modules.contentItems.quiz.questions.correctOptionIndices +quizzes.questions.correctOptionIndex')
      .lean()
    if (!course) return res.status(404).json({ message: 'The enrolled course could not be found.' })
    const quiz = findQuiz(course, quizId)
    if (!quiz || !Array.isArray(quiz.questions) || !quiz.questions.length) {
      return res.status(404).json({ message: 'This quiz is not available in the enrolled course.' })
    }
    const questionSnapshot = getQuizQuestionSnapshot(quiz)
    const stateKey = {
      userId: req.auth.id,
      courseId,
      quizId,
    }
    const now = new Date()
    const reservation = await reserveQuizAttempt(stateKey, now)
    if (reservation.reason) {
      const quizStatus = getQuizAttemptStatus(reservation.state, now)
      const message = reservation.reason === 'locked'
        ? 'This quiz is locked until the 24-hour cooldown ends.'
        : reservation.reason === 'passed'
          ? 'You have already passed this quiz.'
          : 'You have used all 3 attempts for this quiz.'
      return res.status(reservation.reason === 'locked' ? 423 : 409).json({ message, quizStatus })
    }

    const attempt = await QuizAttempt.create({
      userId: req.auth.id,
      ...(req.auth.user.studentType === 'college' ? { collegeId: req.auth.user.collegeId } : {}),
      enrollmentId: enrollment._id,
      courseId,
      quizId,
      cycleNumber: reservation.state.cycleNumber,
      attemptNumber: reservation.attemptNumber,
      status: 'started',
      startedAt: now,
      passingPercentage: Number.isFinite(quiz.passingPercentage) ? quiz.passingPercentage : 70,
      timeLimitMinutes: Number.isFinite(quiz.timeLimitMinutes) ? quiz.timeLimitMinutes : 0,
      questionSnapshot,
    })
    return res.status(201).json({
      attempt: {
        _id: attempt._id,
        quizId: attempt.quizId,
        status: attempt.status,
        startedAt: attempt.startedAt,
        passingPercentage: attempt.passingPercentage,
        timeLimitMinutes: attempt.timeLimitMinutes,
        answers: [],
        attemptsMade: reservation.attemptNumber,
        attemptNumber: reservation.attemptNumber,
        cycleNumber: reservation.state.cycleNumber,
        maxAttempts: quizAttemptLimit,
      },
      quizStatus: getQuizAttemptStatus(reservation.state, now),
      questions: getPublicQuestionSnapshot(questionSnapshot),
    })
  } catch (error) {
    if (error?.statusCode === 400) return res.status(400).json({ message: error.message })
    return next(error)
  }
})

router.post('/courses/:courseId/quizzes/:quizId/attempts/:attemptId/submit', ...requireStudent, async (req, res, next) => {
  try {
    const { courseId, quizId, attemptId } = req.params
    if (![courseId, quizId, attemptId].every(isValidObjectId)) {
      return res.status(400).json({ message: 'Select a valid course, quiz, and attempt.' })
    }
    const enrollment = await Enrollment.findOne({
      userId: req.auth.id,
      courseId,
      ...getStudentEnrollmentScope(req),
      status: { $ne: 'cancelled' },
    }).sort({ createdAt: -1 }).lean()
    if (!enrollment) return res.status(404).json({ message: 'An active enrollment is required to submit this quiz.' })

    const attempt = await QuizAttempt.findOne({
      _id: attemptId,
      userId: req.auth.id,
      enrollmentId: enrollment._id,
      courseId,
      quizId,
      status: 'started',
    }).select('+questionSnapshot')
    if (!attempt) return res.status(409).json({ message: 'This quiz attempt has already been submitted or is no longer available.' })

    const stateKey = {
      userId: req.auth.id,
      courseId,
      quizId,
    }
    const stateNow = new Date()
    const state = await getQuizAttemptState(stateKey, stateNow)
    const cycleNumber = attempt.cycleNumber || state.cycleNumber
    if (cycleNumber !== state.cycleNumber || state.passed) {
      return res.status(409).json({ message: 'This quiz attempt is no longer available.', quizStatus: getQuizAttemptStatus(state, stateNow) })
    }
    if (state.lockedUntil && new Date(state.lockedUntil) > stateNow) {
      return res.status(423).json({
        message: 'This quiz is locked until the 24-hour cooldown ends.',
        quizStatus: getQuizAttemptStatus(state, stateNow),
      })
    }
    const attemptNumber = attempt.attemptNumber || state.attemptsUsed

    const course = await Course.findById(courseId)
      .select('+modules.quiz.questions.correctOptionIndices +modules.contentItems.quiz.questions.correctOptionIndices +quizzes.questions.correctOptionIndex')
      .lean()
    if (!course) return res.status(404).json({ message: 'The enrolled course could not be found.' })
    const quiz = findQuiz(course, quizId)
    const questions = attempt.questionSnapshot?.length
      ? attempt.questionSnapshot.map((question) => ({
        _id: question.questionId,
        prompt: question.prompt,
        type: question.type,
        options: question.options,
        correctOptionIndices: question.correctOptionIndices,
        marks: question.marks,
        explanation: question.explanation,
      }))
      : quiz?.questions
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(404).json({ message: 'This quiz is not available in the enrolled course.' })
    }

    const answers = req.body?.answers
    if (!Array.isArray(answers) || answers.length !== questions.length) {
      return res.status(400).json({ message: `Submit an answer for each of the ${questions.length} quiz questions, including unanswered questions.` })
    }
    const quizQuestionIds = new Set(questions.map((question) => canonicalObjectId(question._id)))
    const answerByQuestionId = new Map()
    for (const [answerIndex, answer] of answers.entries()) {
      const questionId = canonicalObjectId(answer?.questionId)
      if (
        !questionId
        || !Array.isArray(answer.selectedOptionIndices)
        || answer.selectedOptionIndices.some((index) => !Number.isInteger(index))
        || answerByQuestionId.has(questionId)
      ) {
        return res.status(400).json({ message: `The submitted answer for question ${answerIndex + 1} has an invalid question ID or answer format.` })
      }
      if (!quizQuestionIds.has(questionId)) {
        return res.status(400).json({ message: `The submitted answer for question ${answerIndex + 1} does not match a question in this quiz.` })
      }
      answerByQuestionId.set(questionId, answer.selectedOptionIndices)
    }

    let earnedPoints = 0
    let totalPoints = 0
    let correctAnswers = 0
    const savedAnswers = []
    for (const [questionIndex, question] of questions.entries()) {
      const questionId = canonicalObjectId(question._id)
      const selectedOptionIndices = answerByQuestionId.get(questionId)
      const correctOptionIndices = Array.isArray(question.correctOptionIndices) && question.correctOptionIndices.length > 0
        ? question.correctOptionIndices
        : Number.isInteger(question.correctOptionIndex) ? [question.correctOptionIndex] : null
      const questionLabel = `Question ${questionIndex + 1}${questionId ? ` (${questionId})` : ''}`
      const questionType = question.type || 'multiple-choice'
      if (!['multiple-choice', 'multiple-select', 'true-false'].includes(questionType)) {
        return res.status(400).json({ message: `${questionLabel} has unsupported question type "${questionType}".` })
      }
      const isMultipleSelect = questionType === 'multiple-select'
      if (
        !isValidObjectId(questionId)
      ) {
        return res.status(400).json({ message: `${questionLabel} is missing a valid saved question ID.` })
      }
      if (!Array.isArray(question.options) || question.options.length < 2 || question.options.some((option) => typeof option !== 'string' || !option.trim())) {
        return res.status(400).json({ message: `${questionLabel} has invalid answer options.` })
      }
      if (!Array.isArray(correctOptionIndices) || !correctOptionIndices.length) {
        return res.status(400).json({ message: `${questionLabel} has no saved correct answer indices.` })
      }
      if (correctOptionIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= question.options.length)) {
        return res.status(400).json({ message: `${questionLabel} has a correct answer index outside its available options.` })
      }
      if (new Set(correctOptionIndices).size !== correctOptionIndices.length) {
        return res.status(400).json({ message: `${questionLabel} contains duplicate correct answer indices.` })
      }
      if (
        (isMultipleSelect && correctOptionIndices.length < 2)
        || (!isMultipleSelect && correctOptionIndices.length !== 1)
      ) {
        return res.status(400).json({ message: `${questionLabel} has a correct answer format that does not match its ${isMultipleSelect ? 'multiple-select' : 'single-select'} type.` })
      }
      if (!Array.isArray(selectedOptionIndices)) {
        return res.status(400).json({ message: `No submitted answer was found for ${questionLabel}.` })
      }
      if (selectedOptionIndices.some((index) => index < 0 || index >= question.options.length)) {
        return res.status(400).json({ message: `The submitted answer for ${questionLabel} contains an option index outside the available options.` })
      }
      const uniqueSelected = [...new Set(selectedOptionIndices)].sort((left, right) => left - right)
      if (uniqueSelected.length !== selectedOptionIndices.length) {
        return res.status(400).json({ message: `Do not select the same answer more than once for ${questionLabel}.` })
      }
      if (uniqueSelected.length && !isMultipleSelect && uniqueSelected.length !== 1) {
        return res.status(400).json({ message: `Choose exactly one answer for ${questionLabel}.` })
      }
      const expected = [...correctOptionIndices].sort((left, right) => left - right)
      const points = Number.isFinite(question.marks) && question.marks > 0 ? question.marks : 1
      totalPoints += points
      if (
        uniqueSelected.length === expected.length
        && uniqueSelected.every((index, answerIndex) => index === expected[answerIndex])
      ) {
        earnedPoints += points
        correctAnswers += 1
      }
      savedAnswers.push({
        questionId,
        selectedOptionIndices: uniqueSelected,
        correctOptionIndices: expected,
        explanation: question.explanation || '',
      })
    }

    const scorePercentage = Math.round((earnedPoints / totalPoints) * 100)
    const passingPercentage = Number.isFinite(attempt.passingPercentage)
      ? attempt.passingPercentage
      : Number.isFinite(quiz?.passingPercentage) ? quiz.passingPercentage : 70
    const submittedAt = new Date()
    const elapsedSeconds = Math.max(0, Math.floor((submittedAt - new Date(attempt.startedAt)) / 1000))
    const timeLimitMinutes = Number.isFinite(attempt.timeLimitMinutes)
      ? attempt.timeLimitMinutes
      : Number.isFinite(quiz?.timeLimitMinutes) ? quiz.timeLimitMinutes : 0
    const timeTakenSeconds = timeLimitMinutes > 0
      ? Math.min(elapsedSeconds, timeLimitMinutes * 60)
      : elapsedSeconds
    const passed = scorePercentage >= passingPercentage
    const submittedAttempt = await QuizAttempt.findOneAndUpdate(
      { _id: attempt._id, userId: req.auth.id, status: 'started' },
      {
        $set: {
          status: 'submitted',
          answers: savedAnswers,
          earnedPoints,
          totalPoints,
          correctAnswers,
          incorrectAnswers: questions.length - correctAnswers,
          scorePercentage,
          passed,
          passingPercentage,
          timeLimitMinutes,
          timeTakenSeconds,
          submittedAt,
        },
      },
      { new: true, runValidators: true },
    )
    if (!submittedAttempt) {
      return res.status(409).json({ message: 'This quiz attempt has already been submitted.' })
    }
    let updatedState = state
    if (passed || attemptNumber === quizAttemptLimit) {
      updatedState = await QuizAttemptState.findOneAndUpdate(
        { ...stateKey, cycleNumber, passed: { $ne: true } },
        {
          $set: passed
            ? { passed: true, lockedUntil: null }
            : { lockedUntil: new Date(submittedAt.getTime() + quizAttemptCooldownMs) },
        },
        { new: true },
      ).lean() || await QuizAttemptState.findOne(stateKey).lean()
    }
    if (!updatedState) throw new Error('Quiz attempt state could not be updated after submission.')
    const quizStatus = getQuizAttemptStatus(updatedState, submittedAt)

    if (submittedAttempt.passed) {
      await issueCertificateIfEligible({
        userId: req.auth.id,
        studentName: req.auth.user.fullName,
        enrollment,
        course,
      })
    }

    return res.status(200).json({
      attempt: {
        _id: submittedAttempt._id,
        quizId: submittedAttempt.quizId,
        status: submittedAttempt.status,
        startedAt: submittedAttempt.startedAt,
        submittedAt: submittedAttempt.submittedAt,
        timeTakenSeconds: submittedAttempt.timeTakenSeconds,
        passingPercentage: submittedAttempt.passingPercentage,
        timeLimitMinutes: submittedAttempt.timeLimitMinutes,
        attemptNumber,
        cycleNumber,
        answers: submittedAttempt.answers,
        earnedPoints,
        totalPoints,
        correctAnswers,
        incorrectAnswers: questions.length - correctAnswers,
        scorePercentage,
        passed,
        attemptsMade: attemptNumber,
        maxAttempts: quizAttemptLimit,
        questions: getPublicQuestionSnapshot(attempt.questionSnapshot?.length
          ? attempt.questionSnapshot
          : questions.map((question) => ({
            questionId: question._id,
            prompt: question.prompt,
            type: question.type || 'multiple-choice',
            options: question.options || [],
          }))),
      },
      quizStatus,
    })
  } catch (error) {
    return next(error)
  }
})

router.post(
  '/courses/:courseId/assignments/:assignmentId/submissions',
  ...requireStudent,
  receiveAssignmentSubmission,
  async (req, res, next) => {
    try {
      const { courseId, assignmentId } = req.params
      if (!isValidObjectId(courseId) || !isValidObjectId(assignmentId)) {
        return res.status(400).json({ message: 'Select a valid course and assignment.' })
      }
      if (!req.file || !isValidAssignmentFile(req.file)) {
        return res.status(400).json({ message: 'Upload a valid PDF, DOCX, or TXT file up to 10 MB.' })
      }
      const enrollment = await Enrollment.findOne({
        userId: req.auth.id,
        courseId,
        ...getStudentEnrollmentScope(req),
        status: { $ne: 'cancelled' },
      }).sort({ createdAt: -1 }).lean()
      if (!enrollment) return res.status(404).json({ message: 'An active enrollment is required to submit this assignment.' })
      const course = await Course.findById(courseId).select('assignments modules.contentItems').lean()
      if (!course || !findAssignment(course, assignmentId)) {
        return res.status(404).json({ message: 'This assignment is not available in the enrolled course.' })
      }
      const submission = await AssignmentSubmission.create({
        userId: req.auth.id,
        ...(req.auth.user.studentType === 'college' ? { collegeId: req.auth.user.collegeId } : {}),
        enrollmentId: enrollment._id,
        courseId,
        assignmentId,
        fileName: sanitizeSubmissionFileName(req.file.originalname),
        contentType: req.file.mimetype,
        fileSize: req.file.size,
        fileData: req.file.buffer,
      })
      return res.status(201).json({
        submission: {
          _id: submission._id,
          assignmentId: submission.assignmentId,
          fileName: submission.fileName,
          contentType: submission.contentType,
          fileSize: submission.fileSize,
          submittedAt: submission.submittedAt,
          reviewStatus: submission.reviewStatus,
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.get('/assignment-submissions/:submissionId/download', ...requireStudent, async (req, res, next) => {
  try {
    const { submissionId } = req.params
    if (!isValidObjectId(submissionId)) return res.status(400).json({ message: 'Select a valid submission.' })
    const submission = await AssignmentSubmission.findOne({
      _id: submissionId,
      userId: req.auth.id,
    }).select('+fileData').lean()
    if (!submission) return res.status(404).json({ message: 'The submission was not found.' })
    const enrollment = await Enrollment.findOne({
      _id: submission.enrollmentId,
      userId: req.auth.id,
      ...getStudentEnrollmentScope(req),
      status: { $ne: 'cancelled' },
    }).select('_id').lean()
    if (!enrollment) return res.status(404).json({ message: 'The submission was not found.' })
    const fileData = toMongoBuffer(submission.fileData)
    if (!fileData || fileData.length < 1 || fileData.length > maxAssignmentSubmissionBytes) {
      return res.status(404).json({ message: 'The submission file is unavailable.' })
    }
    res.set({
      'Content-Type': submission.contentType,
      'Content-Length': String(fileData.length),
      'Content-Disposition': `attachment; filename="${submission.fileName}"`,
      'X-Content-Type-Options': 'nosniff',
    })
    return res.send(fileData)
  } catch (error) {
    return next(error)
  }
})

router.get('/enrollments/me', ...requireStudent, async (req, res, next) => {
  try {
    const scope = req.auth.user.studentType === 'college'
      ? { collegeId: req.auth.user.collegeId }
      : { collegeId: { $exists: false } }
    const enrollments = await Enrollment.find({
      userId: req.auth.id,
      ...scope,
      status: { $ne: 'cancelled' },
    })
      .populate(
        'courseId',
        'title description detailedDescription category difficulty thumbnailUrl estimatedDurationMinutes modules assignments quizzes status',
      )
      .sort({ createdAt: -1 })
      .lean()
    return res.json({
      enrollments: enrollments.map((enrollment) => ({
        ...enrollment,
        courseId: hideQuizAnswers(enrollment.courseId),
      })),
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/certificates', ...requireStudent, async (req, res, next) => {
  try {
    const enrollments = await Enrollment.find({
      userId: req.auth.id,
      ...getStudentEnrollmentScope(req),
      status: { $ne: 'cancelled' },
    })
      .populate('courseId', 'title thumbnailUrl modules assignments quizzes generateCertificate')
      .sort({ createdAt: -1 })
      .lean()
    const latestEnrollmentByCourse = new Map()
    for (const enrollment of enrollments) {
      if (!enrollment.courseId) continue
      const courseId = String(enrollment.courseId._id)
      if (!latestEnrollmentByCourse.has(courseId)) latestEnrollmentByCourse.set(courseId, enrollment)
    }

    const certificates = await Promise.all([...latestEnrollmentByCourse.values()].map(async (enrollment) => {
      const course = enrollment.courseId
      const existing = await Certificate.findOne({ userId: req.auth.id, courseId: course._id }).lean()
      if (existing) {
        const requiredActivities = getRequiredCertificateActivities(course)
        return {
          courseId: String(course._id),
          courseName: existing.courseName,
          thumbnailUrl: course.thumbnailUrl || '',
          eligible: true,
          pendingRequirements: [],
          progress: getCertificateCourseProgress(requiredActivities, [], true),
          certificate: {
            id: String(existing._id),
            certificateId: existing.certificateId,
            studentName: existing.studentName,
            courseName: existing.courseName,
            completedAt: existing.completedAt,
          },
        }
      }

      const eligibility = await evaluateCertificateEligibility({ course, enrollment })
      const pendingRequirements = [...eligibility.pendingRequirements]
      let certificate = null
      if (eligibility.eligible && req.auth.user.fullName?.trim()) {
        certificate = await issueCertificateIfEligible({
          userId: req.auth.id,
          studentName: req.auth.user.fullName,
          enrollment,
          course,
          eligibility,
        })
      }
      if (eligibility.eligible && !req.auth.user.fullName?.trim()) {
        pendingRequirements.push({ type: 'profile', title: 'Add your full name to your account', status: 'name-required' })
      }
      return {
        courseId: String(course._id),
        courseName: course.title,
        thumbnailUrl: course.thumbnailUrl || '',
        eligible: Boolean(certificate),
        pendingRequirements: certificate ? [] : pendingRequirements,
        progress: getCertificateCourseProgress(eligibility.activities, pendingRequirements, Boolean(certificate)),
        certificate: certificate ? {
          id: String(certificate._id),
          certificateId: certificate.certificateId,
          studentName: certificate.studentName,
          courseName: certificate.courseName,
          completedAt: certificate.completedAt,
        } : null,
      }
    }))

    return res.json({ certificates })
  } catch (error) {
    return next(error)
  }
})

router.get('/certificates/:certificateId/pdf', ...requireStudent, async (req, res, next) => {
  try {
    const { certificateId } = req.params
    if (!isValidObjectId(certificateId)) return res.status(404).json({ message: 'The certificate was not found.' })
    const activeTemplateId = await getActiveCertificateTemplateId()
    const certificate = await Certificate.findOne({ _id: certificateId, userId: req.auth.id }).lean()
    if (!certificate) return res.status(404).json({ message: 'The certificate was not found.' })
    const templateId = certificate.templateId || activeTemplateId
    const template = templateId === 'builtin'
      ? null
      : await CertificateTemplate.findById(templateId).select('+imageData secureUrl').lean()
    if (templateId !== 'builtin' && !template) {
      throw new Error('The certificate background used for this certificate is unavailable.')
    }
    const templateImage = templateId === 'builtin' ? undefined : await loadCertificateTemplateImage(template)
    const pdf = await generateCertificatePdf(certificate, templateImage)
    const download = req.query.download === 'true'
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="aiHustle-certificate-${certificate.certificateId}.pdf"`)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.send(pdf)
  } catch (error) {
    return next(error)
  }
})

router.patch('/enrollments/:enrollmentId/progress', ...requireStudent, async (req, res, next) => {
  try {
    const { enrollmentId } = req.params
    const { lessonId, completed, started, positionSeconds } = req.body ?? {}
    const hasPositionSeconds = Object.prototype.hasOwnProperty.call(req.body || {}, 'positionSeconds')
    if (
      !isValidObjectId(enrollmentId)
      || !isValidObjectId(lessonId)
      || (typeof completed !== 'boolean' && started !== true && !hasPositionSeconds)
      || (hasPositionSeconds && (!Number.isFinite(positionSeconds) || positionSeconds < 0 || positionSeconds > 43200))
    ) {
      return res.status(400).json({ message: 'A valid enrollment, lesson, and progress state are required.' })
    }

    const scope = req.auth.user.studentType === 'college'
      ? { collegeId: req.auth.user.collegeId }
      : { collegeId: { $exists: false } }
    const enrollmentQuery = {
      _id: enrollmentId,
      userId: req.auth.id,
      ...scope,
      status: { $ne: 'cancelled' },
    }
    const enrollment = await Enrollment.findOne(enrollmentQuery)
      .populate('courseId', 'title modules assignments quizzes generateCertificate')
      .lean()
    if (!enrollment) return res.status(404).json({ message: 'The enrollment was not found.' })
    if (!courseHasLesson(enrollment.courseId, lessonId)) {
      return res.status(404).json({ message: 'The lesson was not found in this course.' })
    }

    const isAlreadyCompleted = (enrollment.completedLessonIds || []).some((id) => String(id) === lessonId)
    const update = { $addToSet: { startedLessonIds: lessonId } }
    if (typeof completed === 'boolean') {
      if (completed) {
        update.$addToSet.completedLessonIds = lessonId
        if (!isAlreadyCompleted) {
          update.$set = { [`lessonCompletionDates.${lessonId}`]: new Date() }
        }
      } else {
        update.$pull = { completedLessonIds: lessonId }
        update.$unset = { [`lessonCompletionDates.${lessonId}`]: 1 }
      }
    }
    if (hasPositionSeconds) {
      update.$set = {
        ...update.$set,
        [`lessonPlaybackPositions.${lessonId}`]: positionSeconds,
      }
    }
    const result = await Enrollment.updateOne(enrollmentQuery, update)
    if (!result.matchedCount) return res.status(404).json({ message: 'The enrollment was not found.' })

    const completedLessonIds = new Set((enrollment.completedLessonIds || []).map(String))
    const startedLessonIds = new Set((enrollment.startedLessonIds || []).map(String))
    startedLessonIds.add(lessonId)
    if (completed === true) completedLessonIds.add(lessonId)
    if (completed === false) completedLessonIds.delete(lessonId)
    if (completed === true) {
      await issueCertificateIfEligible({
        userId: req.auth.id,
        studentName: req.auth.user.fullName,
        enrollment: { ...enrollment, completedLessonIds: [...completedLessonIds] },
        course: enrollment.courseId,
      })
    }
    const lessonPlaybackPositions = getLessonPlaybackPositions(enrollment)
    if (hasPositionSeconds) lessonPlaybackPositions[lessonId] = positionSeconds
    return res.json({
      completedLessonIds: [...completedLessonIds],
      startedLessonIds: [...startedLessonIds],
      lessonPlaybackPositions,
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/enrollments', ...requireStudent, async (req, res, next) => {
  try {
    const { courseId } = req.body ?? {}
    if (!isValidObjectId(courseId)) {
      return res.status(400).json({ message: 'Select a valid course.' })
    }

    if (req.auth.user.studentType !== 'independent' || req.auth.user.collegeId) {
      return res.status(403).json({ message: 'College students must be enrolled by their college sub-admin.' })
    }

    const student = await Student.findOne({ _id: req.auth.id, role: 'student', studentType: 'independent' })
      .select('_id')
      .lean()
    if (!student) return res.status(404).json({ message: 'The student account was not found.' })

    const course = await Course.findOne({ _id: courseId, status: 'published' }).select('_id')
    if (!course) return res.status(404).json({ message: 'The published course was not found.' })
    const existing = await Enrollment.findOne({
      userId: student._id,
      courseId: course._id,
      status: { $ne: 'cancelled' },
    }).select('_id')
    if (existing) return res.status(409).json({ message: 'You are already enrolled in this course.' })

    const [enrollment] = await Enrollment.create([{
      userId: student._id,
      courseId: course._id,
      assignedBy: student._id,
      status: 'active',
    }])
    return res.status(201).json({ message: 'You are now enrolled in this course.', enrollment })
  } catch (error) {
    return next(error)
  }
})

router.get('/college/dashboard', ...requireCollegeAdmin, async (req, res, next) => {
  try {
    const collegeId = req.auth.user.collegeId
    if (!isValidObjectId(collegeId)) {
      return res.status(403).json({ message: 'This sub-admin is not assigned to a valid college.' })
    }
    const subAdmin = await getAssignedCollegeAdmin(req)
    if (!subAdmin) {
      return res.status(403).json({ message: 'Your Sub-Admin account is not assigned to a valid college.' })
    }

    const [college, students, courses, enrollments, totalStudents, studentLimit] = await Promise.all([
      College.findById(collegeId).select('name').lean(),
      CollegeStudent.find({ role: 'student', studentType: 'college', collegeId })
        .select('fullName username email studentId department batch')
        .sort({ fullName: 1 })
        .limit(1000)
        .lean(),
      Course.find({ status: 'published' })
        .select('title description')
        .sort({ title: 1 })
        .limit(500)
        .lean(),
      Enrollment.find({ collegeId })
        .populate('userId', 'fullName username email studentId')
        .populate('courseId', 'title')
        .sort({ createdAt: -1 })
        .limit(1000)
        .lean(),
      countCollegeStudents(subAdmin.collegeId),
      getCollegeStudentLimit(subAdmin.collegeId),
    ])
    if (!college) return res.status(403).json({ message: 'The assigned college no longer exists.' })
    return res.json({
      college,
      students,
      courses,
      enrollments,
      studentLimit,
      totalStudents,
      remainingSlots: studentLimit === null ? null : Math.max(0, studentLimit - totalStudents),
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/college/enrollments', ...requireCollegeAdmin, async (req, res, next) => {
  try {
    const collegeId = req.auth.user.collegeId
    const { studentId, courseId } = req.body ?? {}
    if (!isValidObjectId(collegeId) || !isValidObjectId(studentId) || !isValidObjectId(courseId)) {
      return res.status(400).json({ message: 'Select a valid student and course.' })
    }

    const [student, course] = await Promise.all([
      CollegeStudent.findOne({
        _id: studentId,
        role: 'student',
        studentType: 'college',
        collegeId,
      }).select('_id'),
      Course.findOne({ _id: courseId, status: 'published' }).select('_id'),
    ])
    if (!student) {
      return res.status(404).json({ message: 'The student was not found in your college.' })
    }
    if (!course) return res.status(404).json({ message: 'The published course was not found.' })

    const existing = await Enrollment.findOne({
      userId: student._id,
      courseId: course._id,
      collegeId,
      status: { $ne: 'cancelled' },
    }).select('_id')
    if (existing) return res.status(409).json({ message: 'This student is already enrolled in the course.' })

    const [enrollment] = await Enrollment.create([{
      userId: student._id,
      courseId: course._id,
      collegeId,
      assignedBy: req.auth.id,
      status: 'active',
    }])
    return res.status(201).json({ message: 'Course assigned to the student.', enrollment })
  } catch (error) {
    return next(error)
  }
})

export default router
