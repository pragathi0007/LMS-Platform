import mongoose from 'mongoose'
import multer from 'multer'
import path from 'node:path'
import { Router } from 'express'
import College from '../models/College.js'
import Course from '../models/Course.js'
import Enrollment from '../models/Enrollment.js'
import AssignmentSubmission from '../models/AssignmentSubmission.js'
import QuizAttempt from '../models/QuizAttempt.js'
import { CollegeStudent, Student } from '../models/account-models.js'
import { authenticate, requireRoles } from '../middleware/auth.js'

const router = Router()
const requireStudent = [authenticate, requireRoles('student')]
const requireCollegeAdmin = [authenticate, requireRoles('college_admin')]
const maxAssignmentSubmissionBytes = 10 * 1024 * 1024
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

function isValidObjectId(value) {
  return typeof value === 'string' && mongoose.isValidObjectId(value)
}

function canonicalObjectId(value) {
  const isBsonObjectId = value instanceof mongoose.Types.ObjectId
    || (value?._bsontype === 'ObjectId' && typeof value.toHexString === 'function')
  if ((!isValidObjectId(value) && !isBsonObjectId) || !mongoose.isValidObjectId(value)) return ''
  return new mongoose.Types.ObjectId(value).toString()
}

function hideQuizAnswers(course) {
  if (!course) return course
  return {
    ...course,
    quizzes: course.quizzes?.map(({ questions, ...quiz }) => ({
      ...quiz,
      questions: questions?.map(({ correctOptionIndex, ...question }) => question),
    })),
    modules: course.modules?.map(({ quiz, contentItems, ...module }) => ({
      ...module,
      ...(quiz ? {
        quiz: {
          ...quiz,
          questions: quiz.questions?.map(({ correctOptionIndices, ...question }) => question),
        },
      } : {}),
      ...(contentItems ? {
        contentItems: contentItems.map(({ quiz: itemQuiz, ...item }) => ({
          ...item,
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
        .select('_id assignmentId fileName contentType fileSize submittedAt')
        .sort({ submittedAt: -1 })
        .lean(),
      QuizAttempt.find({ userId: req.auth.id, enrollmentId: enrollment._id })
        .select('_id quizId status startedAt passingPercentage timeLimitMinutes timeTakenSeconds answers earnedPoints totalPoints correctAnswers incorrectAnswers scorePercentage passed submittedAt createdAt +questionSnapshot')
        .sort({ createdAt: -1 })
        .lean(),
    ])
    return res.json({
      enrollment: {
        ...enrollment,
        courseId: hideQuizAnswers(course),
      },
      assignmentSubmissions,
      quizAttempts: quizAttempts.map(serializeQuizAttempt),
    })
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
    const attemptsMade = await QuizAttempt.countDocuments({
      userId: req.auth.id,
      enrollmentId: enrollment._id,
      quizId,
    })
    const maxAttempts = Number.isInteger(quiz.maxAttempts) && quiz.maxAttempts > 0 ? quiz.maxAttempts : 3
    if (attemptsMade >= maxAttempts) {
      return res.status(409).json({ message: 'You have used all available attempts for this quiz.' })
    }

    const attempt = await QuizAttempt.create({
      userId: req.auth.id,
      ...(req.auth.user.studentType === 'college' ? { collegeId: req.auth.user.collegeId } : {}),
      enrollmentId: enrollment._id,
      courseId,
      quizId,
      status: 'started',
      startedAt: new Date(),
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
        attemptsMade: attemptsMade + 1,
        maxAttempts,
      },
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
          passed: scorePercentage >= passingPercentage,
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
        answers: submittedAttempt.answers,
        earnedPoints,
        totalPoints,
        correctAnswers,
        incorrectAnswers: questions.length - correctAnswers,
        scorePercentage,
        passed: scorePercentage >= passingPercentage,
        attemptsMade: await QuizAttempt.countDocuments({ userId: req.auth.id, enrollmentId: enrollment._id, quizId }),
        maxAttempts: Number.isInteger(quiz?.maxAttempts) && quiz.maxAttempts > 0 ? quiz.maxAttempts : 3,
        questions: getPublicQuestionSnapshot(attempt.questionSnapshot?.length
          ? attempt.questionSnapshot
          : questions.map((question) => ({
            questionId: question._id,
            prompt: question.prompt,
            type: question.type || 'multiple-choice',
            options: question.options || [],
          }))),
      },
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
    res.set({
      'Content-Type': submission.contentType,
      'Content-Length': String(submission.fileSize),
      'Content-Disposition': `attachment; filename="${submission.fileName}"`,
      'X-Content-Type-Options': 'nosniff',
    })
    return res.send(submission.fileData)
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

router.patch('/enrollments/:enrollmentId/progress', ...requireStudent, async (req, res, next) => {
  try {
    const { enrollmentId } = req.params
    const { lessonId, completed, started } = req.body ?? {}
    if (
      !isValidObjectId(enrollmentId)
      || !isValidObjectId(lessonId)
      || (typeof completed !== 'boolean' && started !== true)
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
      .populate('courseId', 'modules')
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
    const result = await Enrollment.updateOne(enrollmentQuery, update)
    if (!result.matchedCount) return res.status(404).json({ message: 'The enrollment was not found.' })

    const completedLessonIds = new Set((enrollment.completedLessonIds || []).map(String))
    const startedLessonIds = new Set((enrollment.startedLessonIds || []).map(String))
    startedLessonIds.add(lessonId)
    if (completed === true) completedLessonIds.add(lessonId)
    if (completed === false) completedLessonIds.delete(lessonId)
    return res.json({
      completedLessonIds: [...completedLessonIds],
      startedLessonIds: [...startedLessonIds],
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

    const [college, students, courses, enrollments] = await Promise.all([
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
    ])
    if (!college) return res.status(403).json({ message: 'The assigned college no longer exists.' })
    return res.json({ college, students, courses, enrollments })
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
