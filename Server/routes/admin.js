import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { openAsBlob } from 'node:fs'
import { Readable } from 'node:stream'
import { open, unlink } from 'node:fs/promises'
import mongoose from 'mongoose'
import multer from 'multer'
import path from 'node:path'
import cloudinary from '../config/cloudinary.js'
import { config } from '../config/env.js'
import AccountIdentity from '../models/AccountIdentity.js'
import College from '../models/College.js'
import Course from '../models/Course.js'
import Certificate from '../models/Certificate.js'
import Enrollment from '../models/Enrollment.js'
import Notification from '../models/Notification.js'
import AssignmentSubmission from '../models/AssignmentSubmission.js'
import QuizAttempt from '../models/QuizAttempt.js'
import ReferralCode from '../models/ReferralCode.js'
import CertificateTemplate from '../models/CertificateTemplate.js'
import VideoAttentionResponse from '../models/VideoAttentionResponse.js'
import {
  CollegeAdmin,
  CollegeStudent,
  Student,
  accountModelsByCollection,
} from '../models/account-models.js'
import { authenticate, requireRoles } from '../middleware/auth.js'
import { receiveCourseResource, receiveCourseVideo } from '../middleware/course-media-upload.js'
import { normalizeCourseDetails } from '../utils/course-validation.js'
import {
  logEmailDeliveryFailure,
  sendCollegeAdminActivationEmail,
  sendIndependentStudentDecisionEmail,
} from '../utils/email.js'
import {
  assertCollegeStudentCapacity,
  countCollegeStudents,
  getCollegeStudentLimit,
} from '../utils/college-student-capacity.js'
import { generateQuizQuestions } from '../utils/quiz-question-generator.js'
import { parseStudentCsv } from '../utils/student-csv.js'
import { toMongoBuffer } from '../utils/mongo-binary.js'
import { getActiveCertificateTemplateId, issueCertificateIfEligible } from '../utils/certificates.js'

const router = Router()
const requireAdmin = [authenticate, requireRoles('main_admin')]
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/
const activationLifetimeMs = 24 * 60 * 60 * 1000
const protectedRegistrationField = /(password|token|secret|credential|auth|otp|hash)/i
const registrationFieldAliases = Object.freeze({
  referralCode: ['referral_code', 'usedReferralCode'],
  educationQualification: ['education_qualification', 'qualification'],
  customQualification: ['custom_qualification', 'otherQualification', 'qualificationOther'],
  userExpectations: ['user_expectations', 'expectations'],
  location: ['studentLocation'],
  livingWithWhom: ['living_with_whom', 'livingArrangement'],
  customLivingArrangement: ['custom_living_arrangement', 'otherLivingArrangement'],
})
const reportPageSize = 200
const approvalStatuses = new Set(['pending', 'approved', 'rejected', 'all'])

function publicRegistrationDetails(details, accountFields, legacyDetails = {}) {
  const nestedDetails = details && typeof details === 'object' && !Array.isArray(details)
    ? Object.entries(details)
    : []
  const legacyFieldNames = new Set(
    Object.entries(registrationFieldAliases).flatMap(([field, aliases]) => [field, ...aliases]),
  )
  const legacyDetailsEntries = legacyDetails && typeof legacyDetails === 'object'
    ? Object.entries(legacyDetails).filter(([field]) => legacyFieldNames.has(field))
    : []
  const isSafeEntry = ([field, value]) => (
    /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(field) &&
    !protectedRegistrationField.test(field) &&
    typeof value === 'string'
  )
  const nestedEntries = nestedDetails.filter(isSafeEntry)
  const legacyEntries = legacyDetailsEntries.filter(isSafeEntry)
  const aliases = new Set(Object.values(registrationFieldAliases).flat())
  const safeDetails = Object.fromEntries(nestedEntries.filter(([field]) => !aliases.has(field)))
  for (const [field, fieldAliases] of Object.entries(registrationFieldAliases)) {
    if (typeof safeDetails[field] === 'string' && safeDetails[field].trim()) continue
    const nestedAliasValue = nestedEntries.find(([name, value]) => (
      fieldAliases.includes(name) && value.trim()
    ))?.[1]
    const legacyValue = legacyEntries.find(([name, value]) => (
      (name === field || fieldAliases.includes(name)) && value.trim()
    ))?.[1]
    const normalizedValue = nestedAliasValue || legacyValue
    if (normalizedValue) safeDetails[field] = normalizedValue
  }
  return {
    ...safeDetails,
    fullName: accountFields.fullName || '',
    email: accountFields.email || '',
    username: accountFields.username || '',
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const certificateTemplateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  fileFilter(_req, file, callback) {
    if (!['image/png', 'image/jpeg'].includes(file.mimetype)) {
      const error = new Error('Upload a PNG or JPEG certificate background image up to 4 MB.')
      error.statusCode = 415
      callback(error)
      return
    }
    callback(null, true)
  },
})

function receiveCertificateTemplate(req, res, next) {
  certificateTemplateUpload.single('template')(req, res, (error) => {
    if (!error) return next()
    const statusCode = error.statusCode || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
    return res.status(statusCode).json({
      message: error.code === 'LIMIT_FILE_SIZE'
        ? 'The certificate background image must be 4 MB or smaller.'
        : error.message || 'The certificate background image could not be uploaded.',
    })
  })
}

function certificateImageType(buffer) {
  if (buffer?.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer?.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg'
  return ''
}

function uploadCertificateImage(buffer, publicId) {
  if (!cloudinaryIsConfigured()) {
    const error = new Error('Cloudinary is not configured for certificate background uploads.')
    error.statusCode = 503
    throw error
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream({
      folder: 'aihustle/certificate-templates',
      public_id: publicId,
      resource_type: 'image',
      overwrite: true,
    }, (error, result) => {
      if (error) {
        const uploadError = new Error('The certificate background image could not be uploaded to Cloudinary.')
        uploadError.statusCode = 502
        uploadError.cause = error
        reject(uploadError)
        return
      }
      if (!result?.secure_url || !result.public_id) {
        const uploadError = new Error('Cloudinary did not return a usable certificate image URL.')
        uploadError.statusCode = 502
        reject(uploadError)
        return
      }
      resolve({ secureUrl: result.secure_url, publicId: result.public_id })
    })
    uploadStream.on('error', reject)
    Readable.from([buffer]).on('error', reject).pipe(uploadStream)
  })
}

async function ensureCertificateImageOnCloudinary(template) {
  if (template.secureUrl && template.publicId) return template
  if (!template.imageData?.length) {
    throw new Error('The active certificate template image could not be loaded.')
  }

  const migrationId = createHash('sha256')
    .update(String(template._id))
    .update(template.imageData)
    .digest('hex')
  const uploaded = await uploadCertificateImage(template.imageData, `legacy-${migrationId}`)
  try {
    const savedTemplate = await CertificateTemplate.findByIdAndUpdate(
      template._id,
      { $set: uploaded },
      { new: true, runValidators: true },
    ).lean()
    if (!savedTemplate) throw new Error('The active certificate template could not be saved.')
    return { ...template, ...uploaded }
  } catch (error) {
    try {
      await cloudinary.uploader.destroy(uploaded.publicId, { resource_type: 'image', invalidate: true })
    } catch (cleanupError) {
      console.error(JSON.stringify({
        event: 'certificate_template_cloudinary_cleanup_failed',
        errorCode: typeof cleanupError?.http_code === 'number' ? cleanupError.http_code : undefined,
      }))
    }
    throw error
  }
}

function handleCertificateTemplateError(error, res, next) {
  if ([502, 503].includes(error?.statusCode)) {
    return res.status(error.statusCode).json({ message: error.message })
  }
  return next(error)
}

function assignmentTitle(course, assignmentId) {
  const topLevel = (course?.assignments || []).find((item) => String(item._id) === String(assignmentId))
  if (topLevel) return topLevel.title
  for (const module of course?.modules || []) {
    const item = (module.contentItems || []).find((entry) => (
      entry.type === 'assignment' && String(entry._id) === String(assignmentId)
    ))
    if (item) return item.title
  }
  return 'Assignment'
}

router.get('/certificate-template', ...requireAdmin, async (_req, res, next) => {
  try {
    const templateId = await getActiveCertificateTemplateId()
    let template = templateId === 'builtin'
      ? null
      : await CertificateTemplate.findById(templateId)
        .select('+imageData secureUrl publicId contentType fileName fileSize updatedAt')
        .lean()
    if (templateId !== 'builtin' && !template?.contentType) {
      throw new Error('The active certificate template could not be loaded.')
    }
    if (template) template = await ensureCertificateImageOnCloudinary(template)
    return res.json({
      configured: Boolean(template),
      uploaded: Boolean(template?.contentType),
      fileName: template?.fileName || '',
      fileSize: template?.fileSize || 0,
      secureUrl: template?.secureUrl || '',
      updatedAt: template?.updatedAt || null,
    })
  } catch (error) {
    return handleCertificateTemplateError(error, res, next)
  }
})

router.get('/certificate-template/image', ...requireAdmin, async (_req, res, next) => {
  try {
    const templateId = await getActiveCertificateTemplateId()
    if (templateId === 'builtin') return res.status(404).json({ message: 'No uploaded certificate background is configured.' })
    const template = await CertificateTemplate.findById(templateId)
      .select('+imageData contentType fileSize')
      .lean()
    if (!template) {
      throw new Error('The active certificate template could not be loaded.')
    }
    if (!template.contentType) {
      return res.status(404).json({ message: 'No uploaded certificate background is configured.' })
    }
    if (!template.imageData?.length) throw new Error('The active certificate template image could not be loaded.')
    res.setHeader('Content-Type', template.contentType)
    res.setHeader('Content-Length', template.fileSize)
    res.setHeader('Content-Disposition', 'inline; filename="certificate-background"')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    return res.send(template.imageData)
  } catch (error) {
    return next(error)
  }
})

router.post('/certificate-template', ...requireAdmin, receiveCertificateTemplate, async (req, res, next) => {
  try {
    const contentType = certificateImageType(req.file?.buffer)
    if (!contentType) return res.status(400).json({ message: 'Upload a valid PNG or JPEG certificate background image.' })
    const fileName = path.basename(req.file.originalname || 'certificate-template')
      .replace(/[\r\n"]/g, '_')
      .slice(0, 180)
    const currentTemplateId = await getActiveCertificateTemplateId()
    const templateId = `template-${randomUUID()}`
    const uploaded = await uploadCertificateImage(req.file.buffer, templateId)
    await CertificateTemplate.create({
      _id: templateId,
      imageData: req.file.buffer,
      ...uploaded,
      contentType,
      fileName,
      fileSize: req.file.size,
      updatedBy: req.auth.id,
    })
    const legacyTemplateFilter = currentTemplateId === 'default'
      ? { $or: [{ templateId: { $exists: false } }, { templateId: null }, { templateId: 'default' }] }
      : { $or: [{ templateId: { $exists: false } }, { templateId: null }] }
    await Certificate.updateMany(legacyTemplateFilter, { $set: { templateId: currentTemplateId } })
    const activeTemplate = await CertificateTemplate.findOneAndUpdate(
      { _id: 'default' },
      { $set: { activeTemplateId: templateId, updatedBy: req.auth.id } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    )
    return res.json({
      configured: true,
      uploaded: true,
      fileName,
      fileSize: req.file.size,
      secureUrl: uploaded.secureUrl,
      updatedAt: activeTemplate.updatedAt,
    })
  } catch (error) {
    return handleCertificateTemplateError(error, res, next)
  }
})

router.get('/assignment-submissions', ...requireAdmin, async (_req, res, next) => {
  try {
    const submissions = await AssignmentSubmission.find({ reviewStatus: { $in: ['pending', null] } })
      .select('userId enrollmentId courseId assignmentId fileName contentType fileSize submittedAt reviewStatus')
      .sort({ submittedAt: -1 })
      .limit(200)
      .lean()
    const userIds = [...new Set(submissions.map((submission) => String(submission.userId)))]
    const courseIds = [...new Set(submissions.map((submission) => String(submission.courseId)))]
    const [independentStudents, collegeStudents, courses] = await Promise.all([
      Student.find({ _id: { $in: userIds } }).select('fullName email').lean(),
      CollegeStudent.find({ _id: { $in: userIds } }).select('fullName email').lean(),
      Course.find({ _id: { $in: courseIds } }).select('title modules.contentItems assignments').lean(),
    ])
    const studentsById = new Map([...independentStudents, ...collegeStudents].map((student) => [String(student._id), student]))
    const coursesById = new Map(courses.map((course) => [String(course._id), course]))
    return res.json({
      submissions: submissions.map((submission) => {
        const student = studentsById.get(String(submission.userId))
        const course = coursesById.get(String(submission.courseId))
        return {
          id: String(submission._id),
          studentName: student?.fullName || 'Student name unavailable',
          studentEmail: student?.email || '',
          courseId: String(submission.courseId),
          courseName: course?.title || 'Course unavailable',
          assignmentId: String(submission.assignmentId),
          assignmentName: assignmentTitle(course, submission.assignmentId),
          fileName: submission.fileName,
          contentType: submission.contentType,
          fileSize: submission.fileSize,
          submittedAt: submission.submittedAt,
          reviewStatus: submission.reviewStatus || 'pending',
        }
      }),
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/assignment-submissions/:submissionId/download', ...requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.submissionId)) {
      return res.status(404).json({ message: 'The assignment submission was not found.' })
    }
    const submission = await AssignmentSubmission.findById(req.params.submissionId).select('+fileData')
    if (!submission) return res.status(404).json({ message: 'The assignment submission was not found.' })
    const fileName = submission.fileName.replace(/[\r\n"]/g, '_')
    res.setHeader('Content-Type', submission.contentType)
    res.setHeader('Content-Length', submission.fileSize)
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    return res.send(submission.fileData)
  } catch (error) {
    return next(error)
  }
})

router.patch('/assignment-submissions/:submissionId/review', ...requireAdmin, async (req, res, next) => {
  try {
    const { submissionId } = req.params
    const { reviewStatus, reviewComment = '' } = req.body ?? {}
    if (!mongoose.isValidObjectId(submissionId)) {
      return res.status(400).json({ message: 'Select a valid assignment submission.' })
    }
    if (!['approved', 'rejected'].includes(reviewStatus)) {
      return res.status(400).json({ message: 'Choose approved or rejected for the assignment review.' })
    }
    if (typeof reviewComment !== 'string' || reviewComment.length > 1000) {
      return res.status(400).json({ message: 'The review comment must be 1,000 characters or fewer.' })
    }
    const submission = await AssignmentSubmission.findByIdAndUpdate(
      submissionId,
      {
        $set: {
          reviewStatus,
          reviewComment: reviewComment.trim(),
          reviewedAt: new Date(),
          reviewedBy: req.auth.id,
        },
      },
      { new: true, runValidators: true },
    )
    if (!submission) return res.status(404).json({ message: 'The assignment submission was not found.' })

    if (reviewStatus === 'approved') {
      const enrollment = await Enrollment.findById(submission.enrollmentId)
        .populate('courseId', 'title modules assignments quizzes generateCertificate')
        .lean()
      if (
        enrollment
        && enrollment.status !== 'cancelled'
        && String(enrollment.userId) === String(submission.userId)
        && String(enrollment.courseId?._id) === String(submission.courseId)
      ) {
        const student = await Student.findById(submission.userId).select('fullName').lean()
          || await CollegeStudent.findById(submission.userId).select('fullName').lean()
        if (student?.fullName?.trim()) {
          await issueCertificateIfEligible({
            userId: submission.userId,
            studentName: student.fullName,
            enrollment,
            course: enrollment.courseId,
          })
        }
      }
    }

    return res.json({ reviewStatus: submission.reviewStatus, reviewedAt: submission.reviewedAt })
  } catch (error) {
    return next(error)
  }
})

async function accountIdentifierExists(field, value) {
  const identity = await AccountIdentity.exists({ [field]: value })
  if (identity) return true
  for (const AccountModel of Object.values(accountModelsByCollection)) {
    if (await AccountModel.exists({ [field]: value })) return true
  }
  return false
}

function makeImportUsername(studentId) {
  const digest = createHash('sha256').update(studentId.toLowerCase()).digest('hex').slice(0, 20)
  return `college-${digest}`
}

function getReportCourseLessons(course) {
  const lessons = []
  const seenIds = new Set()
  for (const module of course?.modules || []) {
    const videoItems = (module.contentItems || []).filter((item) => item.type === 'video-lesson')
    const moduleLessons = videoItems.length ? videoItems : module.lessons || []
    for (const lesson of moduleLessons) {
      const id = String(lesson._id || '')
      if (!id || seenIds.has(id)) continue
      seenIds.add(id)
      lessons.push({ id, title: lesson.title || 'Untitled lesson' })
    }
  }
  return lessons
}

function getReportCourseProgress(enrollment, course) {
  const lessons = getReportCourseLessons(course)
  const completedIds = new Set((enrollment.completedLessonIds || []).map(String))
  const startedIds = new Set((enrollment.startedLessonIds || []).map(String))
  const completedLessons = lessons.filter(({ id }) => completedIds.has(id))
  const pendingLessons = lessons.filter(({ id }) => !completedIds.has(id))
  const isComplete = enrollment.status === 'completed'
    || (lessons.length > 0 && completedLessons.length === lessons.length)
  const hasProgress = completedLessons.length > 0
    || lessons.some(({ id }) => startedIds.has(id))
  const status = isComplete ? 'completed' : hasProgress ? 'in_progress' : 'not_started'
  const completionPercent = isComplete
    ? 100
    : lessons.length
      ? Math.round((completedLessons.length / lessons.length) * 100)
      : null
  return {
    lessons,
    completedLessons,
    pendingLessons,
    status,
    completionPercent,
  }
}

function getReportAssignment(course, assignmentId) {
  const requestedId = String(assignmentId || '')
  const candidates = [
    ...(course?.assignments || []),
    ...(course?.modules || []).flatMap((module) => module.contentItems || []),
  ].filter((item) => (
    String(item._id || '') === requestedId
    && (!item.type || item.type === 'assignment' || item.type === 'practical')
  ))
  const assignment = candidates[0]
  if (!assignment) return null
  const candidateMaximums = candidates.map(({ points }) => points)
  const maximumMarks = candidateMaximums.every((points) => (
    Number.isFinite(points) && points >= 0 && points === candidateMaximums[0]
  )) ? candidateMaximums[0] : null
  return {
    assignmentName: assignment.title || 'Assignment unavailable',
    instructions: assignment.description || assignment.content || '',
    maximumMarks,
  }
}

function getReportAssignments(course) {
  const assignments = [
    ...(course?.assignments || []),
    ...(course?.modules || []).flatMap((module) => module.contentItems || []),
  ]
  const seenIds = new Set()
  return assignments.filter((item) => {
    if (item.type && item.type !== 'assignment' && item.type !== 'practical') return false
    const id = String(item._id || '')
    if (!id || seenIds.has(id)) return false
    seenIds.add(id)
    return true
  })
}

function getReportSubmission(submission, course) {
  const assignment = getReportAssignment(course, submission.assignmentId)
  if (!assignment) return null
  return {
    id: String(submission._id),
    assignmentId: String(submission.assignmentId),
    assignmentName: assignment.assignmentName,
    instructions: assignment.instructions,
    submittedAt: submission.submittedAt || null,
    fileName: submission.fileName,
    contentType: submission.contentType,
    fileSize: submission.fileSize,
    fileUrl: `/admin/reports/progress/submissions/${submission._id}/file`,
    maximumMarks: assignment.maximumMarks,
    marksObtained: Number.isFinite(submission.marksObtained) ? submission.marksObtained : null,
    evaluationStatus: submission.evaluationStatus || (Number.isFinite(submission.marksObtained) ? 'evaluated' : 'pending'),
    correctness: submission.correctness || null,
    feedback: submission.feedback || '',
    evaluatedAt: submission.evaluatedAt || null,
    evaluatorId: submission.evaluatorId ? String(submission.evaluatorId) : null,
    evaluationHistory: (submission.evaluationHistory || []).map((evaluation) => ({
      marksObtained: Number.isFinite(evaluation.marksObtained) ? evaluation.marksObtained : null,
      feedback: evaluation.feedback || '',
      correctness: evaluation.correctness || null,
      evaluationStatus: evaluation.evaluationStatus || 'evaluated',
      evaluatedAt: evaluation.evaluatedAt || null,
      evaluatorId: evaluation.evaluatorId ? String(evaluation.evaluatorId) : null,
    })),
  }
}

function getLatestRecordsByKey(records, getKey, getDate) {
  const latest = new Map()
  let ambiguous = false
  for (const record of records) {
    const key = String(getKey(record) || '')
    if (!key) {
      ambiguous = true
      continue
    }
    const dateValue = getDate(record)
    const timestamp = dateValue ? new Date(dateValue).getTime() : null
    const current = latest.get(key)
    if (!current) {
      latest.set(key, { record, timestamp })
      continue
    }
    if (!Number.isFinite(timestamp) || !Number.isFinite(current.timestamp)) {
      ambiguous = true
      continue
    }
    if (timestamp > current.timestamp) {
      latest.set(key, { record, timestamp })
    } else if (timestamp === current.timestamp) {
      ambiguous = true
    }
  }
  return { records: [...latest.values()].map(({ record }) => record), ambiguous }
}

function calculateCourseMarksSummary(quizAttempts, submissions, course) {
  let marksObtained = 0
  let maximumMarks = 0
  let hasResults = false
  let ambiguous = false
  const latestQuizAttempts = getLatestRecordsByKey(
    quizAttempts.filter((attempt) => attempt.status === 'submitted'),
    (attempt) => attempt.quizId,
    (attempt) => attempt.submittedAt || attempt.createdAt || attempt.startedAt,
  )
  ambiguous = latestQuizAttempts.ambiguous
  for (const attempt of latestQuizAttempts.records) {
    if (
      !Number.isFinite(attempt.earnedPoints) || attempt.earnedPoints < 0
      || !Number.isFinite(attempt.totalPoints) || attempt.totalPoints <= 0
    ) {
      ambiguous = true
      continue
    }
    marksObtained += attempt.earnedPoints
    maximumMarks += attempt.totalPoints
    hasResults = true
  }
  const latestEvaluatedSubmissions = getLatestRecordsByKey(
    submissions.filter((submission) => (
      submission.evaluationStatus === 'evaluated'
      || submission.evaluationStatus === 're_evaluation_required'
      || (!submission.evaluationStatus && Number.isFinite(submission.marksObtained))
    )),
    (submission) => submission.assignmentId,
    (submission) => submission.submittedAt,
  )
  ambiguous = ambiguous || latestEvaluatedSubmissions.ambiguous
  for (const submission of latestEvaluatedSubmissions.records) {
    const assignment = getReportAssignment(course, submission.assignmentId)
    if (
      !assignment || assignment.maximumMarks === null
      || !Number.isFinite(submission.marksObtained) || submission.marksObtained < 0
      || submission.marksObtained > assignment.maximumMarks
    ) {
      ambiguous = true
      continue
    }
    marksObtained += submission.marksObtained
    maximumMarks += assignment.maximumMarks
    hasResults = true
  }
  return {
    hasResults,
    ambiguous,
    summary: ambiguous || !hasResults ? null : {
      marksObtained,
      maximumMarks,
      percentage: maximumMarks > 0 ? Math.round((marksObtained / maximumMarks) * 100) : null,
    },
  }
}

function getReportQuizTitle(course, quizId) {
  const requestedId = String(quizId || '')
  if (!requestedId) return null
  for (const module of course?.modules || []) {
    if (String(module.quiz?._id || '') === requestedId) return module.quiz.title || null
    for (const item of module.contentItems || []) {
      if (String(item.quiz?._id || '') === requestedId) return item.quiz.title || item.title || null
    }
  }
  const quiz = (course?.quizzes || []).find((item) => String(item._id || '') === requestedId)
  return quiz?.title || null
}

function reportDateKey(value) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

async function configuredCollegeStudentLimit(collegeId, session) {
  return getCollegeStudentLimit(collegeId, session)
}

async function registeredCollegeStudentCount(collegeId, session) {
  return countCollegeStudents(collegeId, session)
}

router.get('/colleges', ...requireAdmin, async (req, res, next) => {
  try {
    const filter = req.query.includeInactive === 'true'
      ? {}
      : { status: { $in: [null, 'active'] } }
    const colleges = await College.find(filter)
      .select('name code collegeName title address city state country contactName contactPhone contactEmail status')
      .sort({ name: 1 })
      .limit(500)
      .lean()
    const collegeIdValues = colleges.flatMap((college) => [
      college._id,
      String(college._id),
    ])
    const studentCounts = await CollegeStudent.aggregate([
      { $match: { collegeId: { $in: collegeIdValues } } },
      {
        $lookup: {
          from: 'enrollment',
          let: { studentId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $eq: [
                        { $convert: { input: '$userId', to: 'string', onError: '', onNull: '' } },
                        { $convert: { input: '$$studentId', to: 'string', onError: '', onNull: '' } },
                      ],
                    },
                    { $ne: ['$status', 'cancelled'] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'activeEnrollments',
        },
      },
      {
        $group: {
          _id: '$collegeId',
          totalStudents: { $sum: 1 },
          enrolledStudents: {
            $sum: { $cond: [{ $gt: [{ $size: '$activeEnrollments' }, 0] }, 1, 0] },
          },
        },
      },
    ])
    const studentCountByCollege = new Map(
      studentCounts.map((entry) => [String(entry._id), entry]),
    )
    return res.json({
      colleges: colleges.map((college) => ({
        id: String(college._id),
        name: college.name || college.collegeName || college.title || 'Unnamed college',
        code: college.code || '',
        address: college.address || '',
        city: college.city || '',
        state: college.state || '',
        country: college.country || '',
        contactName: college.contactName || '',
        contactPhone: college.contactPhone || '',
        contactEmail: college.contactEmail || '',
        status: college.status || 'active',
        totalStudents: studentCountByCollege.get(String(college._id))?.totalStudents || 0,
        enrolledStudents: studentCountByCollege.get(String(college._id))?.enrolledStudents || 0,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/colleges', ...requireAdmin, async (req, res, next) => {
  try {
    const { name, code, address, city, state, country, contactName, contactPhone, contactEmail } = req.body ?? {}
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
      return res.status(400).json({ message: 'Enter a college name of up to 200 characters.' })
    }
    if (typeof code !== 'string' || !/^[a-zA-Z0-9-]{2,40}$/.test(code.trim())) {
      return res.status(400).json({ message: 'Enter a college code with 2Ã¢â‚¬â€œ40 letters, numbers, or hyphens.' })
    }
    for (const [field, value, maxLength] of [
      ['address', address, 500],
      ['city', city, 120],
      ['state', state, 120],
      ['country', country, 120],
      ['contactName', contactName, 120],
      ['contactPhone', contactPhone, 40],
    ]) {
      if (value !== undefined && (typeof value !== 'string' || value.length > maxLength)) {
        return res.status(400).json({ message: `College ${field} must be ${maxLength} characters or fewer.` })
      }
    }
    if (contactEmail !== undefined && contactEmail !== '' &&
      (typeof contactEmail !== 'string' || contactEmail.length > 254 || !emailPattern.test(contactEmail.trim()))) {
      return res.status(400).json({ message: 'Enter a valid college contact email.' })
    }

    const college = await College.create({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      address: typeof address === 'string' ? address.trim() : '',
      city: typeof city === 'string' ? city.trim() : '',
      state: typeof state === 'string' ? state.trim() : '',
      country: typeof country === 'string' ? country.trim() : '',
      contactName: typeof contactName === 'string' ? contactName.trim() : '',
      contactPhone: typeof contactPhone === 'string' ? contactPhone.trim() : '',
      contactEmail: typeof contactEmail === 'string' ? contactEmail.trim().toLowerCase() : '',
    })
    return res.status(201).json({
      message: 'College created successfully.',
      college: { id: String(college._id), name: college.name },
    })
  } catch (error) {
    return next(error)
  }
})

function createActivationToken() {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + activationLifetimeMs),
  }
}

async function deliverActivationEmail(account, token, res, isNewAccount = false) {
  try {
    await sendCollegeAdminActivationEmail({
      email: account.email,
      fullName: account.fullName,
      token,
    })
    return res.status(isNewAccount ? 201 : 200).json({
      message: 'College sub-admin created and activation email sent.',
      account: { id: String(account._id), email: account.email, collegeId: String(account.collegeId) },
      activationEmailSent: true,
    })
  } catch (error) {
    console.error(JSON.stringify({
      event: 'college_admin.activation_email_failed',
      accountId: String(account._id),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: typeof error?.code === 'string' ? error.code : undefined,
    }))
    return res.status(503).json({
      message: 'The account was created, but the activation email could not be sent. Configure SMTP and retry activation.',
      accountId: String(account._id),
      activationEmailSent: false,
    })
  }
}

router.post('/colleges/:collegeId/sub-admins', ...requireAdmin, async (req, res, next) => {
  try {
    const { collegeId } = req.params
    const { fullName, email, username, studentLimit } = req.body ?? {}
    if (!mongoose.isValidObjectId(collegeId)) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 120) {
      return res.status(400).json({ message: 'Enter a sub-admin name of up to 120 characters.' })
    }
    if (
      typeof email !== 'string' ||
      email.trim().length > 254 ||
      !emailPattern.test(email.trim())
    ) {
      return res.status(400).json({ message: 'Enter a valid sub-admin email address.' })
    }
    if (typeof username !== 'string' || !usernamePattern.test(username.trim())) {
      return res.status(400).json({ message: 'Use a username with 3Ã¢â‚¬â€œ30 letters, numbers, dots, underscores, or hyphens.' })
    }
    if (!Number.isSafeInteger(studentLimit) || studentLimit < 1) {
      return res.status(400).json({ message: 'Set a positive whole-number student registration limit.' })
    }

    const selectedCollegeId = new mongoose.Types.ObjectId(collegeId)
    if (!await College.exists({
      _id: selectedCollegeId,
      status: { $in: [null, 'active'] },
    })) {
      return res.status(404).json({ message: 'The selected college does not exist or is inactive.' })
    }
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()
    const [existingEmail, existingUsername] = await Promise.all([
      accountIdentifierExists('email', normalizedEmail),
      accountIdentifierExists('username', normalizedUsername),
    ])
    if (existingEmail) return res.status(409).json({ message: 'An account with this email already exists.' })
    if (existingUsername) return res.status(409).json({ message: 'This username is already taken.' })

    const accountId = new mongoose.Types.ObjectId()
    const { token, tokenHash, expiresAt } = createActivationToken()
    const session = await mongoose.startSession()
    let account
    try {
      await session.withTransaction(async () => {
        await AccountIdentity.create(
          [{
            email: normalizedEmail,
            username: normalizedUsername,
            accountCollection: CollegeAdmin.collection.name,
            accountId,
          }],
          { session },
        )
        ;[account] = await CollegeAdmin.create(
          [{
            _id: accountId,
            fullName: fullName.trim(),
            email: normalizedEmail,
            username: normalizedUsername,
            role: 'college_admin',
            collegeId: selectedCollegeId,
            studentLimit,
            status: 'invitation_pending',
            isActive: false,
            activationTokenHash: tokenHash,
            activationTokenExpiresAt: expiresAt,
          }],
          { session },
        )
      })
    } finally {
      await session.endSession()
    }
    return await deliverActivationEmail(account, token, res, true)
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'The email or username is already assigned to an LMS account.' })
    }
    return next(error)
  }
})

router.post('/college-admins/:id/activation', ...requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'The sub-admin account is invalid.' })
    }
    const account = await CollegeAdmin.findOne({
      _id: req.params.id,
      role: 'college_admin',
      status: 'invitation_pending',
    })
    if (!account) {
      return res.status(404).json({ message: 'A pending sub-admin account was not found.' })
    }

    const { token, tokenHash, expiresAt } = createActivationToken()
    account.activationTokenHash = tokenHash
    account.activationTokenExpiresAt = expiresAt
    await account.save()
    return await deliverActivationEmail(account, token, res)
  } catch (error) {
    return next(error)
  }
})

router.get('/courses', ...requireAdmin, async (req, res, next) => {
  try {
    const [courses, totalCourses, publishedCourses, draftCourses, totalEnrolledStudents] = await Promise.all([
      Course.find({})
        .select(`
          title description detailedDescription category difficulty thumbnailUrl thumbnailPublicId
          generateCertificate
          learningObjectives prerequisites estimatedDurationMinutes
          modules._id modules.title modules.description modules.order
          modules.lessons._id modules.lessons.title modules.lessons.description modules.lessons.content
          modules.lessons.videoUrl modules.lessons.videoPublicId modules.lessons.videoFormat
          modules.lessons.videoBytes modules.lessons.durationSeconds modules.lessons.resources
          modules.lessons.requiredForCertificate
          modules.lessons.order modules.lessons.createdAt modules.lessons.updatedAt
          modules.lessons.attentionCheck.enabled modules.lessons.attentionCheck.minIntervalSeconds
          modules.lessons.attentionCheck.maxIntervalSeconds
          modules.lessons.attentionCheck.questionsDuringVideo
          modules.lessons.attentionCheck.questions._id
          modules.lessons.attentionCheck.questions.prompt modules.lessons.attentionCheck.questions.type
          modules.lessons.attentionCheck.questions.options
          modules.lessons.attentionCheck.questions.selectedForPlayback
          +modules.lessons.attentionCheck.questions.correctOptionIndices
          modules.quiz._id modules.quiz.title modules.quiz.passingPercentage modules.quiz.maxAttempts
          modules.quiz.timeLimitMinutes modules.quiz.questions.prompt modules.quiz.questions.type
          modules.quiz.requiredForCertificate
          modules.quiz.questions.options modules.quiz.questions.marks modules.quiz.questions.order
          +modules.quiz.questions.correctOptionIndices
          modules.contentItems._id modules.contentItems.type modules.contentItems.title
          modules.contentItems.description modules.contentItems.content modules.contentItems.videoUrl
          modules.contentItems.requiredForCertificate
          modules.contentItems.videoPublicId modules.contentItems.videoFormat modules.contentItems.videoBytes
          modules.contentItems.durationSeconds modules.contentItems.resources modules.contentItems.dueDate
          modules.contentItems.attentionCheck.enabled modules.contentItems.attentionCheck.questionsDuringVideo
          modules.contentItems.attentionCheck.minIntervalSeconds
          modules.contentItems.attentionCheck.maxIntervalSeconds modules.contentItems.attentionCheck.questions.prompt
          modules.contentItems.attentionCheck.questions.type modules.contentItems.attentionCheck.questions.options
          modules.contentItems.attentionCheck.questions.selectedForPlayback
          +modules.contentItems.attentionCheck.questions.correctOptionIndices
          modules.contentItems.points modules.contentItems.quiz._id modules.contentItems.quiz.title
          modules.contentItems.quiz.passingPercentage modules.contentItems.quiz.maxAttempts
          modules.contentItems.quiz.requiredForCertificate
          modules.contentItems.quiz.timeLimitMinutes modules.contentItems.quiz.questions.prompt
          modules.contentItems.quiz.questions.type modules.contentItems.quiz.questions.options
          modules.contentItems.quiz.questions.marks modules.contentItems.quiz.questions.order
          +modules.contentItems.quiz.questions.correctOptionIndices modules.contentItems.order
          assignments status createdAt quizzes._id quizzes.title quizzes.description
          quizzes.passingPercentage quizzes.maxAttempts quizzes.timeLimitMinutes
          quizzes.requiredForCertificate quizzes.questions.prompt quizzes.questions.options
          quizzes.questions.explanation +quizzes.questions.correctOptionIndex
        `)
        .sort({ createdAt: -1 })
        .lean(),
      Course.countDocuments({}),
      Course.countDocuments({ status: 'published' }),
      Course.countDocuments({ status: 'draft' }),
      Enrollment.aggregate([
        { $match: { status: { $ne: 'cancelled' } } },
        { $group: { _id: { userId: '$userId', collegeId: { $ifNull: ['$collegeId', null] } } } },
        { $count: 'total' },
      ]),
    ])
    return res.json({
      courses,
      stats: {
        totalCourses,
        publishedCourses,
        draftCourses,
        totalEnrolledStudents: totalEnrolledStudents[0]?.total || 0,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/courses', ...requireAdmin, async (req, res, next) => {
  try {
    const result = normalizeCourseDetails(req.body)
    if (result.error) return res.status(400).json({ message: result.error })
    if (result.value.status === 'published' && !hasPublishableContent(result.value)) {
      return res.status(400).json({ message: 'Add at least one module and one lesson before publishing.' })
    }
    const course = await Course.create({ ...result.value, createdBy: req.auth.id })
    return res.status(201).json({ message: 'Course saved successfully.', course })
  } catch (error) {
    return next(error)
  }
})

function safeGeminiErrorMessage(error) {
  let message = typeof error?.message === 'string' ? error.message : ''
  if (config.geminiApiKey) message = message.replaceAll(config.geminiApiKey, '[redacted]')
  message = message.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[redacted]')
  message = message.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
  return message.replace(/[\r\n]+/g, ' ').trim().slice(0, 400)
}

router.post('/courses/generate-quiz-questions', ...requireAdmin, async (req, res) => {
  const { lessonContent, questionCount, difficulty, questionTypes } = req.body ?? {}
  const supportedQuestionTypes = ['multiple-choice', 'multiple-select', 'true-false']

  if (typeof lessonContent !== 'string' || !lessonContent.trim() || lessonContent.length > 30000) {
    return res.status(400).json({ message: 'Provide lesson content of up to 30,000 characters.' })
  }
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 20) {
    return res.status(400).json({ message: 'Choose a question count from 1 to 20.' })
  }
  if (!['beginner', 'intermediate', 'advanced', 'all-levels'].includes(difficulty)) {
    return res.status(400).json({ message: 'Choose beginner, intermediate, advanced, or all-levels difficulty.' })
  }
  if (
    questionTypes !== undefined &&
    (!Array.isArray(questionTypes) ||
      questionTypes.length === 0 ||
      questionTypes.length > supportedQuestionTypes.length ||
      questionTypes.some((type) => !supportedQuestionTypes.includes(type)) ||
      new Set(questionTypes).size !== questionTypes.length)
  ) {
    return res.status(400).json({ message: 'Choose one or more supported quiz question types.' })
  }

  const selectedQuestionTypes = questionTypes || supportedQuestionTypes
  if (!config.geminiApiKey) {
    return res.status(503).json({ message: 'Quiz question generation is unavailable because Gemini is not configured.' })
  }

  try {
    const questions = await generateQuizQuestions({
      lessonContent: lessonContent.trim(),
      questionCount,
      difficulty,
      questionTypes: selectedQuestionTypes,
    }, { apiKey: config.geminiApiKey })
    return res.json({ questions })
  } catch (error) {
    const providerMessage = safeGeminiErrorMessage(error)
    console.error(JSON.stringify({
      event: 'admin.quiz_question_generation_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: typeof error?.code === 'string' ? error.code : undefined,
      status: Number.isInteger(error?.status) ? error.status : undefined,
      providerMessage: providerMessage || undefined,
    }))
    return res.status(502).json({
      message: providerMessage
        ? `Quiz question generation failed: ${providerMessage}`
        : 'Quiz question generation failed without a provider error message. Check the server logs for details.',
    })
  }
})

function hasPublishableContent(course) {
  return (course.modules || []).some((module) => (
    (module.lessons || []).length > 0 ||
    (module.contentItems || []).some((item) => item.type === 'video-lesson' && item.videoUrl)
  ))
}

async function mediaHasExpectedSignature(file, assetType) {
  const handle = await open(file.path, 'r')
  const header = Buffer.alloc(16)
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const bytes = header.subarray(0, bytesRead)
    const extension = path.extname(file.originalname).toLowerCase()
    if (assetType === 'video') {
      if (['.mp4', '.m4v', '.mov'].includes(extension)) return bytes.length >= 8 && bytes.toString('ascii', 4, 8) === 'ftyp'
      if (['.webm', '.mkv'].includes(extension)) return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      if (extension === '.ogv') return bytes.toString('ascii', 0, 4) === 'OggS'
      if (extension === '.avi') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'AVI '
      return false
    }
    if (file.mimetype === 'application/pdf') return bytes.toString('ascii', 0, 5) === '%PDF-'
    if (file.mimetype === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    if (file.mimetype === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    if (file.mimetype === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    return false
  } finally {
    await handle.close()
  }
}

function cloudinaryIsConfigured() {
  return [config.cloudinaryCloudName, config.cloudinaryApiKey, config.cloudinaryApiSecret]
    .every((value) => typeof value === 'string' && value.trim())
}

function safeCloudinaryErrorMessage(error) {
  let message = typeof error?.error?.message === 'string'
    ? error.error.message
    : typeof error?.message === 'string' ? error.message : ''
  for (const secret of [config.cloudinaryApiKey, config.cloudinaryApiSecret]) {
    if (secret) message = message.replaceAll(secret, '[redacted]')
  }
  return message.replace(/[\r\n]+/g, ' ').trim().slice(0, 400)
}

function uploadLargeVideo(filePath, options) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_large(filePath, (error, result) => {
      if (error) {
        reject(error)
        return
      }
      if (!result?.secure_url || !result.public_id) {
        reject(new Error('Cloudinary completed the upload without returning a video URL and public ID.'))
        return
      }
      resolve(result)
    }, options)
  })
}

async function uploadVideoWithProviderErrorDetails(filePath, originalName, options) {
  const timestamp = Math.floor(Date.now() / 1000)
  const signedParams = {
    folder: options.folder,
    public_id: options.public_id,
    timestamp,
  }
  const signature = cloudinary.utils.api_sign_request(signedParams, config.cloudinaryApiSecret)
  const body = new FormData()
  body.append('file', await openAsBlob(filePath), originalName)
  body.append('api_key', config.cloudinaryApiKey)
  body.append('folder', signedParams.folder)
  body.append('public_id', signedParams.public_id)
  body.append('timestamp', String(timestamp))
  body.append('signature', signature)

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudinaryCloudName)}/video/upload`,
    { method: 'POST', body, signal: AbortSignal.timeout(options.timeout) },
  )
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error(`Cloudinary returned an unreadable response (HTTP ${response.status}).`)
  }
  if (!response.ok || !result?.secure_url || !result?.public_id) {
    const error = new Error(result?.error?.message || `Cloudinary rejected the video upload (HTTP ${response.status}).`)
    error.http_code = response.status
    throw error
  }
  return result
}

router.get('/cloudinary/health', ...requireAdmin, async (_req, res) => {
  if (!cloudinaryIsConfigured()) {
    return res.status(503).json({ connected: false, message: 'Cloudinary is not configured on the server.' })
  }
  try {
    await cloudinary.api.ping()
    return res.json({ connected: true })
  } catch {
    return res.status(503).json({ connected: false, message: 'Cloudinary is currently unavailable.' })
  }
})

async function uploadCourseMedia(req, res, next, assetType) {
  try {
    const { courseId, moduleId } = req.params
    if (!mongoose.isValidObjectId(courseId) || !mongoose.isValidObjectId(moduleId)) {
      return res.status(400).json({ message: 'Select a valid course and module before uploading media.' })
    }
    if (!req.file) return res.status(400).json({ message: 'Choose a file to upload.' })
    if (!cloudinaryIsConfigured()) {
      return res.status(503).json({ message: 'Course media uploads are not configured on the server.' })
    }
    const course = await Course.findById(courseId).select('_id').lean()
    if (!course) return res.status(404).json({ message: 'The course was not found.' })
    if (!await mediaHasExpectedSignature(req.file, assetType)) {
      return res.status(415).json({ message: 'The file contents do not match the selected file type.' })
    }

    const folder = `aihustle/courses/${courseId}/modules/${moduleId}`
    const resourceType = assetType === 'video'
      ? 'video'
      : req.file.mimetype === 'application/pdf' ? 'raw' : 'image'
    const uploadOptions = {
      folder,
      public_id: `${randomUUID()}${resourceType === 'raw' ? `.${path.extname(req.file.originalname).slice(1).toLowerCase()}` : ''}`,
      resource_type: resourceType,
      overwrite: false,
      unique_filename: false,
      timeout: 30 * 60 * 1000,
    }
    let uploaded
    try {
      uploaded = assetType === 'video' && req.file.size > 100 * 1024 * 1024
        ? await uploadLargeVideo(req.file.path, { ...uploadOptions, resource_type: 'video', chunk_size: 20 * 1024 * 1024 })
        : assetType === 'video'
          ? await uploadVideoWithProviderErrorDetails(req.file.path, req.file.originalname, uploadOptions)
          : await cloudinary.uploader.upload(req.file.path, uploadOptions)
    } catch (error) {
      const providerMessage = safeCloudinaryErrorMessage(error)
      const cloudinaryError = error?.error || error
      console.error(JSON.stringify({
        event: 'admin.course_media_upload_failed',
        assetType,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode: typeof cloudinaryError?.code === 'string' || typeof cloudinaryError?.code === 'number' ? cloudinaryError.code : undefined,
        httpCode: Number.isInteger(cloudinaryError?.http_code) ? cloudinaryError.http_code : undefined,
        requestId: typeof cloudinaryError?.request_id === 'string' ? cloudinaryError.request_id : undefined,
        providerMessage: providerMessage || undefined,
      }))
      return res.status(502).json({
        message: providerMessage
          ? `Cloudinary upload failed: ${providerMessage}`
          : 'Cloudinary upload failed without a provider error message. Check the server upload log and Cloudinary configuration.',
      })
    }

    return res.status(201).json({
      url: uploaded.secure_url,
      publicId: uploaded.public_id,
      duration: typeof uploaded.duration === 'number' ? uploaded.duration : null,
      format: uploaded.format,
      bytes: uploaded.bytes,
      originalName: req.file.originalname,
      resourceType,
      assetType,
    })
  } catch (error) {
    return next(error)
  } finally {
    if (req.file?.path) await unlink(req.file.path).catch(() => {})
  }
}

router.post(
  '/courses/:courseId/modules/:moduleId/media/video',
  ...requireAdmin,
  receiveCourseVideo,
  (req, res, next) => uploadCourseMedia(req, res, next, 'video'),
)

router.post(
  '/courses/:courseId/modules/:moduleId/media/resource',
  ...requireAdmin,
  receiveCourseResource,
  (req, res, next) => uploadCourseMedia(req, res, next, 'resource'),
)

router.post('/course-assets/delete', ...requireAdmin, async (req, res, next) => {
  try {
    const { publicId, resourceType } = req.body ?? {}
    if (
      typeof publicId !== 'string' ||
      !publicId.startsWith('aihustle/courses/') ||
      publicId.length > 255 ||
      !['video', 'image', 'raw'].includes(resourceType)
    ) return res.status(400).json({ message: 'Select a valid course media asset.' })
    if (!cloudinaryIsConfigured()) {
      return res.status(503).json({ message: 'Course media deletion is not configured on the server.' })
    }

    const isReferenced = await Course.exists({
      $or: [
        { thumbnailPublicId: publicId },
        { 'modules.lessons.videoPublicId': publicId },
        { 'modules.lessons.resources.publicId': publicId },
        { 'modules.contentItems.videoPublicId': publicId },
        { 'modules.contentItems.resources.publicId': publicId },
      ],
    })
    if (isReferenced) return res.json({ deleted: false, shared: true })

    let result
    try {
      result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true })
    } catch {
      return res.status(502).json({ message: 'Cloudinary could not delete the media asset.' })
    }
    if (!['ok', 'not found'].includes(result.result)) {
      return res.status(502).json({ message: 'Cloudinary did not confirm media deletion.' })
    }
    return res.json({ deleted: result.result === 'ok', shared: false })
  } catch (error) {
    return next(error)
  }
})

router.put('/courses/:courseId', ...requireAdmin, async (req, res, next) => {
  try {
    const { courseId } = req.params
    if (!mongoose.isValidObjectId(courseId)) return res.status(400).json({ message: 'Select a valid course.' })
    const existing = await Course.findById(courseId).select('assignments quizzes generateCertificate').lean()
    if (!existing) return res.status(404).json({ message: 'The course was not found.' })
    const result = normalizeCourseDetails({
      ...req.body,
      assignments: req.body?.assignments ?? existing.assignments ?? [],
      quizzes: req.body?.quizzes ?? existing.quizzes ?? [],
      generateCertificate: req.body?.generateCertificate ?? existing.generateCertificate ?? true,
    })
    if (result.error) return res.status(400).json({ message: result.error })
    if (result.value.status === 'published' && !hasPublishableContent(result.value)) {
      return res.status(400).json({ message: 'Add at least one module and one lesson before publishing.' })
    }
    const course = await Course.findByIdAndUpdate(courseId, { $set: result.value }, { new: true, runValidators: true })
    if (!course) return res.status(404).json({ message: 'The course was not found.' })
    return res.json({ message: 'Course updated successfully.', course })
  } catch (error) {
    return next(error)
  }
})

router.patch('/courses/:courseId/status', ...requireAdmin, async (req, res, next) => {
  try {
    const { courseId } = req.params
    const { status } = req.body ?? {}
    if (!mongoose.isValidObjectId(courseId)) return res.status(400).json({ message: 'Select a valid course.' })
    if (!['draft', 'published'].includes(status)) return res.status(400).json({ message: 'Choose draft or published for the course status.' })
    const existing = await Course.findById(courseId).select('modules').lean()
    if (!existing) return res.status(404).json({ message: 'The course was not found.' })
    if (status === 'published' && !hasPublishableContent(existing)) {
      return res.status(400).json({ message: 'Add at least one module and one lesson before publishing.' })
    }
    const course = await Course.findByIdAndUpdate(courseId, { $set: { status } }, { new: true, runValidators: true })
    return res.json({ message: status === 'published' ? 'Course published.' : 'Course moved to drafts.', course })
  } catch (error) {
    return next(error)
  }
})

router.delete('/courses/:courseId', ...requireAdmin, async (req, res, next) => {
  try {
    const { courseId } = req.params
    if (!mongoose.isValidObjectId(courseId)) return res.status(400).json({ message: 'Select a valid course.' })
    const course = await Course.findById(courseId)
      .select('status thumbnailPublicId modules.lessons.videoPublicId modules.lessons.resources.publicId modules.lessons.resources.resourceType modules.contentItems.videoPublicId modules.contentItems.resources.publicId modules.contentItems.resources.resourceType')
      .lean()
    if (!course) return res.status(404).json({ message: 'The course was not found.' })
    if (course.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft courses can be deleted.' })
    }

    const deletedCourse = await Course.findOneAndDelete({ _id: courseId, status: 'draft' }).lean()
    if (!deletedCourse) {
      return res.status(409).json({ message: 'The course status changed before it could be deleted. Refresh the course list and try again.' })
    }

    const assets = new Map()
    if (deletedCourse.thumbnailPublicId) {
      assets.set(`image:${deletedCourse.thumbnailPublicId}`, { publicId: deletedCourse.thumbnailPublicId, resourceType: 'image' })
    }
    for (const module of deletedCourse.modules || []) {
      const items = [...(module.lessons || []), ...(module.contentItems || [])]
      for (const item of items) {
        if (item.videoPublicId) {
          assets.set(`video:${item.videoPublicId}`, { publicId: item.videoPublicId, resourceType: 'video' })
        }
        for (const resource of item.resources || []) {
          if (resource.publicId) {
            const resourceType = resource.resourceType || 'raw'
            assets.set(`${resourceType}:${resource.publicId}`, { publicId: resource.publicId, resourceType })
          }
        }
      }
    }

    let failedAssetDeletions = 0
    for (const asset of assets.values()) {
      if (!asset.publicId.startsWith('aihustle/courses/')) {
        failedAssetDeletions += 1
        continue
      }
      if (!cloudinaryIsConfigured()) {
        failedAssetDeletions += 1
        continue
      }
      let isReferenced
      try {
        isReferenced = await Course.exists({
          $or: [
            { thumbnailPublicId: asset.publicId },
            { 'modules.lessons.videoPublicId': asset.publicId },
            { 'modules.lessons.resources.publicId': asset.publicId },
            { 'modules.contentItems.videoPublicId': asset.publicId },
            { 'modules.contentItems.resources.publicId': asset.publicId },
          ],
        })
      } catch {
        failedAssetDeletions += 1
        continue
      }
      if (isReferenced) continue

      try {
        const result = await cloudinary.uploader.destroy(asset.publicId, {
          resource_type: asset.resourceType,
          invalidate: true,
        })
        if (!['ok', 'not found'].includes(result.result)) failedAssetDeletions += 1
      } catch {
        failedAssetDeletions += 1
      }
    }

    return res.json({
      message: failedAssetDeletions
        ? 'Draft course deleted, but some associated Cloudinary files could not be removed.'
        : 'Draft course deleted.',
      assetCleanupFailed: failedAssetDeletions > 0,
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/course-assets/signature', ...requireAdmin, async (req, res) => {
  const { resourceType } = req.body ?? {}
  if (resourceType !== 'image') {
    return res.status(400).json({ message: 'Only course thumbnail images use a signed browser upload.' })
  }
  if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
    return res.status(503).json({ message: 'Course uploads are unavailable until Cloudinary is configured on the server.' })
  }
  const timestamp = Math.floor(Date.now() / 1000)
  const folder = 'aihustle/courses'
  const publicId = `course-assets/${randomUUID()}`
  const signatureInput = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${config.cloudinaryApiSecret}`
  const signature = createHash('sha1').update(signatureInput).digest('hex')
  return res.json({
    cloudName: config.cloudinaryCloudName,
    apiKey: config.cloudinaryApiKey,
    timestamp,
    folder,
    publicId,
    signature,
    resourceType,
  })
})

router.get('/enrollments', ...requireAdmin, async (req, res, next) => {
  try {
    const enrollments = await Enrollment.find({ status: { $ne: 'cancelled' } })
      .populate('userId', 'fullName email username studentId studentType collegeId')
      .populate('courseId', 'title')
      .populate('collegeId', 'name')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
    return res.json({ enrollments })
  } catch (error) {
    return next(error)
  }
})

router.get('/video-attention-responses', ...requireAdmin, async (req, res, next) => {
  try {
    const responses = await VideoAttentionResponse.find({})
      .select('userId collegeId enrollmentId courseId lessonId lessonTitle questionPrompt questionType options selectedOptionIndices videoPositionSeconds presentedAt answeredAt responseTimeMs isCorrect status')
      .populate('userId', 'fullName email username studentType')
      .populate('courseId', 'title')
      .populate('collegeId', 'name')
      .sort({ presentedAt: -1 })
      .limit(500)
      .lean()
    return res.json({ responses })
  } catch (error) {
    return next(error)
  }
})

router.post('/students/import', ...requireAdmin, async (req, res, next) => {
  try {
    const { csvText, collegeId } = req.body ?? {}
    if (typeof collegeId !== 'string' || !/^[a-f\d]{24}$/i.test(collegeId)) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    const selectedCollegeId = new mongoose.Types.ObjectId(collegeId)
    const college = await mongoose.connection.db.collection('colleges')
      .findOne({ _id: selectedCollegeId }, { projection: { _id: 1 } })
    if (!college) return res.status(400).json({ message: 'The selected college does not exist.' })

    let rows
    try {
      rows = parseStudentCsv(csvText)
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
        failures.push({ row: row.rowNumber, email: '', studentId: '', reason: row.error })
        continue
      }

      const { fullName, studentId, email, department, batch } = row
      const normalizedStudentId = studentId.toLowerCase()
      const username = makeImportUsername(studentId)
      const errors = []
      if (!fullName || fullName.length > 120) errors.push('Full Name is required and must be 120 characters or fewer.')
      if (!studentId || studentId.length > 100) errors.push('Student ID is required and must be 100 characters or fewer.')
      if (!emailPattern.test(email) || email.length > 254) errors.push('Enter a valid email address.')
      if (!department || department.length > 120) errors.push('Department is required and must be 120 characters or fewer.')
      if (!batch || batch.length > 80) errors.push('Batch is required and must be 80 characters or fewer.')
      if (seenEmails.has(email)) errors.push('Email is duplicated in this CSV.')
      if (seenStudentIds.has(normalizedStudentId)) errors.push('Student ID is duplicated in this CSV.')
      if (seenUsernames.has(username)) errors.push('Generated username is duplicated in this CSV.')
      if (email) seenEmails.add(email)
      if (studentId) seenStudentIds.add(normalizedStudentId)
      seenUsernames.add(username)

      if (!errors.length) {
        const [existingEmail, existingStudentId, existingUsername] = await Promise.all([
          accountIdentifierExists('email', email),
          CollegeStudent.findOne({ studentId }).collation({ locale: 'en', strength: 2 }).select('_id').lean(),
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

      try {
        const passwordHash = await bcrypt.hash(randomBytes(48).toString('base64url'), 12)
        const accountId = new mongoose.Types.ObjectId()
        const session = await mongoose.startSession()
        let student
        try {
          await session.withTransaction(async () => {
            await assertCollegeStudentCapacity(selectedCollegeId, session)
            await AccountIdentity.create(
              [{
                email,
                username,
                accountCollection: CollegeStudent.collection.name,
                accountId,
              }],
              { session },
            )
            ;[student] = await CollegeStudent.create(
              [{
                _id: accountId,
                fullName,
                studentId,
                email,
                username,
                department,
                batch,
                studentType: 'college',
                collegeId: selectedCollegeId,
                passwordHash,
                role: 'student',
                status: 'invitation_pending',
                isActive: false,
                permissions: [],
              }],
              { session },
            )
          })
        } finally {
          await session.endSession()
        }
        imported.push({ row: row.rowNumber, email: student.email, studentId: student.studentId })
      } catch (error) {
        if (error?.statusCode === 409 || error?.code === 11000) {
          failures.push({
            row: row.rowNumber,
            email,
            studentId,
            reason: error?.statusCode === 409
              ? error.message
              : 'Email, username, or Student ID already exists.',
          })
          continue
        }
        throw error
      }
    }

    return res.status(200).json({
      message: 'College student import completed. No invitation emails were sent.',
      summary: { total: rows.length, imported: imported.length, failed: failures.length },
      imported,
      failures,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/overview', ...requireAdmin, async (req, res, next) => {
  try {
    const [
      totalIndependentStudents,
      pendingIndependentStudents,
      totalCollegeStudents,
      totalColleges,
      totalCourses,
      totalEnrollments,
      completedEnrollments,
      activeEnrollments,
      enrollmentProgressSummary,
      recentIndependentStudents,
      recentCollegeStudents,
      recentCourses,
    ] =
      await Promise.all([
        Student.countDocuments({
          role: 'student',
        }),
        Student.countDocuments({
          role: 'student',
          studentType: 'independent',
          $or: [
            { approvalStatus: 'pending' },
            { approvalStatus: { $exists: false }, status: 'pending' },
          ],
        }),
        CollegeStudent.countDocuments({ role: 'student' }),
        College.countDocuments(),
        Course.countDocuments(),
        Enrollment.countDocuments(),
        Enrollment.countDocuments({ status: 'completed' }),
        Enrollment.countDocuments({ status: 'active' }),
        Enrollment.aggregate([
          {
            $match: {
              userId: { $exists: true, $ne: null },
              status: { $ne: 'cancelled' },
            },
          },
          {
            $lookup: {
              from: 'courses',
              localField: 'courseId',
              foreignField: '_id',
              as: 'course',
            },
          },
          { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } },
          {
            $addFields: {
              _courseLessonIds: {
                $reduce: {
                  input: { $ifNull: ['$course.modules', []] },
                  initialValue: [],
                  in: {
                    $let: {
                      vars: {
                        videoItems: {
                          $filter: {
                            input: { $ifNull: ['$$this.contentItems', []] },
                            as: 'item',
                            cond: { $eq: ['$$item.type', 'video-lesson'] },
                          },
                        },
                      },
                      in: {
                        $concatArrays: [
                          '$$value',
                          {
                            $map: {
                              input: {
                                $cond: [
                                  { $gt: [{ $size: '$$videoItems' }, 0] },
                                  '$$videoItems',
                                  { $ifNull: ['$$this.lessons', []] },
                                ],
                              },
                              as: 'lesson',
                              in: '$$lesson._id',
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
          {
            $addFields: {
              _courseLessonCount: { $size: '$_courseLessonIds' },
              _completedLessonCount: {
                $size: {
                  $setIntersection: [
                    { $ifNull: ['$completedLessonIds', []] },
                    '$_courseLessonIds',
                  ],
                },
              },
              _startedLessonCount: {
                $size: {
                  $setIntersection: [
                    { $ifNull: ['$startedLessonIds', []] },
                    '$_courseLessonIds',
                  ],
                },
              },
            },
          },
          {
            $addFields: {
              _isCourseCompleted: {
                $or: [
                  { $eq: ['$status', 'completed'] },
                  {
                    $and: [
                      { $gt: ['$_courseLessonCount', 0] },
                      { $eq: ['$_completedLessonCount', '$_courseLessonCount'] },
                    ],
                  },
                ],
              },
              _hasCourseProgress: {
                $or: [
                  { $eq: ['$status', 'completed'] },
                  { $gt: ['$_completedLessonCount', 0] },
                  { $gt: ['$_startedLessonCount', 0] },
                ],
              },
            },
          },
          {
            $group: {
              _id: {
                userId: '$userId',
                collegeId: { $ifNull: ['$collegeId', null] },
              },
              enrollmentCount: { $sum: 1 },
              completedCount: {
                $sum: { $cond: ['$_isCourseCompleted', 1, 0] },
              },
              progressCount: {
                $sum: { $cond: ['$_hasCourseProgress', 1, 0] },
              },
            },
          },
          {
            $group: {
              _id: null,
              enrolledStudents: { $sum: 1 },
              completedStudents: {
                $sum: {
                  $cond: [{ $eq: ['$enrollmentCount', '$completedCount'] }, 1, 0],
                },
              },
              inProgressStudents: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $lt: ['$completedCount', '$enrollmentCount'] },
                        { $gt: ['$progressCount', 0] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              notStartedStudents: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $lt: ['$completedCount', '$enrollmentCount'] },
                        { $eq: ['$progressCount', 0] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
        Student.find({ role: 'student' })
          .select('fullName username email role status studentType approvalStatus createdAt')
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
        CollegeStudent.find({ role: 'student' })
          .select('fullName username email role status studentType collegeId createdAt')
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
        Course.find({})
          .select('title status createdAt')
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
      ])
    const recentRegistrations = [...recentIndependentStudents, ...recentCollegeStudents]
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, 20)

    return res.json({
      stats: {
        totalStudents: totalIndependentStudents + totalCollegeStudents,
        pendingIndependentStudents,
        totalColleges,
        totalCourses,
        totalEnrollments,
        enrolledStudents: enrollmentProgressSummary[0]?.enrolledStudents || 0,
      },
      recentRegistrations,
      recentCourses,
      courseCompletion: {
        completed: completedEnrollments,
        inProgress: activeEnrollments,
        enrolledStudents: enrollmentProgressSummary[0]?.enrolledStudents || 0,
        completedStudents: enrollmentProgressSummary[0]?.completedStudents || 0,
        inProgressStudents: enrollmentProgressSummary[0]?.inProgressStudents || 0,
        notStartedStudents: enrollmentProgressSummary[0]?.notStartedStudents || 0,
      },
      dataAvailability: {
        courses: true,
        enrollmentActivity: Boolean(await Enrollment.exists({})),
        courseCompletion: completedEnrollments + activeEnrollments > 0,
      },
    })
  } catch (error) {
    return next(error)
  }
})



router.get('/colleges/:collegeId/details', ...requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.collegeId)) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    const collegeId = new mongoose.Types.ObjectId(req.params.collegeId)
    const [college, students, subAdmins] = await Promise.all([
      College.findById(collegeId)
        .select('name code collegeName title address city state country contactName contactPhone contactEmail status createdAt')
        .lean(),
      CollegeStudent.find({
        role: 'student',
        studentType: 'college',
        collegeId,
      })
        .select('fullName email username studentId department batch status createdAt')
        .sort({ fullName: 1, email: 1 })
        .lean(),
      CollegeAdmin.find({ role: 'college_admin', collegeId })
        .select('fullName email username status isActive studentLimit createdAt')
        .sort({ createdAt: -1 })
        .lean(),
    ])
    if (!college) return res.status(404).json({ message: 'The college was not found.' })

    const limitOwner = subAdmins
      .filter((account) => Number.isSafeInteger(account.studentLimit) && account.studentLimit >= 0)
      .sort((left, right) => left.studentLimit - right.studentLimit)[0] || null
    const studentById = new Map(students.map((student) => [String(student._id), student]))
    const enrollments = students.length
      ? await Enrollment.find({
        userId: { $in: students.map((student) => student._id) },
        status: { $ne: 'cancelled' },
      })
        .select('userId courseId assignedBy status createdAt')
        .populate('courseId', 'title status')
        .sort({ createdAt: -1 })
        .lean()
      : []
    const enrolledStudentIds = new Set(enrollments.map((enrollment) => String(enrollment.userId)))
    const coursesById = new Map()
    const studentsByCourse = new Map()
    const publicEnrollments = enrollments.map((enrollment) => {
      const studentId = String(enrollment.userId)
      const student = studentById.get(studentId)
      const course = enrollment.courseId && typeof enrollment.courseId === 'object'
        ? enrollment.courseId
        : null
      const courseId = String(course?._id || enrollment.courseId)
      if (course && !coursesById.has(courseId)) {
        coursesById.set(courseId, {
          id: courseId,
          title: course.title || 'Untitled course',
          status: course.status || 'unknown',
        })
      }
      if (course) {
        if (!studentsByCourse.has(courseId)) studentsByCourse.set(courseId, new Set())
        studentsByCourse.get(courseId).add(studentId)
      }
      return {
        id: String(enrollment._id),
        studentId,
        studentName: student?.fullName || '',
        studentEmail: student?.email || '',
        courseId,
        courseTitle: course?.title || 'Course unavailable',
        status: enrollment.status,
        assignedBy: String(enrollment.assignedBy),
        createdAt: enrollment.createdAt,
      }
    })

    return res.json({
      college: {
        id: String(college._id),
        name: college.name || college.collegeName || college.title || 'Unnamed college',
        code: college.code || '',
        address: college.address || '',
        city: college.city || '',
        state: college.state || '',
        country: college.country || '',
        contactName: college.contactName || '',
        contactPhone: college.contactPhone || '',
        contactEmail: college.contactEmail || '',
        status: college.status || 'active',
        createdAt: college.createdAt,
        totalStudents: students.length,
        enrolledStudents: enrolledStudentIds.size,
        studentLimit: limitOwner?.studentLimit ?? null,
        studentLimitSubAdminId: limitOwner ? String(limitOwner._id) : null,
        studentLimitSubAdminName: limitOwner?.fullName || limitOwner?.username || null,
        students: students.map((student) => ({
          id: String(student._id),
          fullName: student.fullName || '',
          email: student.email || '',
          username: student.username || '',
          studentId: student.studentId || '',
          department: student.department || '',
          batch: student.batch || '',
          status: student.status || '',
          createdAt: student.createdAt,
        })),
        courses: [...coursesById.values()].map((course) => ({
          ...course,
          enrolledStudents: studentsByCourse.get(course.id)?.size || 0,
        })),
        enrollments: publicEnrollments,
        subAdmins: subAdmins.map((account) => ({
          id: String(account._id),
          fullName: account.fullName || '',
          email: account.email,
          username: account.username,
          status: account.status,
          isActive: account.isActive,
          studentLimit: Number.isSafeInteger(account.studentLimit) ? account.studentLimit : null,
          createdAt: account.createdAt,
        })),
      },
    })
  } catch (error) {
    return next(error)
  }
})
router.patch('/colleges/:collegeId/sub-admins/:subAdminId/student-limit', ...requireAdmin, async (req, res, next) => {
  try {
    const { collegeId, subAdminId } = req.params
    const { studentLimit } = req.body ?? {}
    if (!mongoose.isValidObjectId(collegeId) || !mongoose.isValidObjectId(subAdminId)) {
      return res.status(400).json({ message: 'Select a valid college and Sub-Admin.' })
    }
    if (!Number.isSafeInteger(studentLimit) || studentLimit <= 0) {
      return res.status(400).json({ message: 'Student limit must be a positive whole number.' })
    }

    const account = await CollegeAdmin.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(subAdminId),
        collegeId: new mongoose.Types.ObjectId(collegeId),
        role: 'college_admin',
      },
      { $set: { studentLimit } },
      { new: true, runValidators: true },
    )
      .select('fullName email username studentLimit')
      .lean()
    if (!account) return res.status(404).json({ message: 'The Sub-Admin was not found for this college.' })

    return res.json({
      message: 'Student limit updated.',
      subAdmin: {
        id: String(account._id),
        fullName: account.fullName || '',
        email: account.email,
        username: account.username,
        studentLimit: Number.isSafeInteger(account.studentLimit) ? account.studentLimit : null,
      },
    })
  } catch (error) {
    return next(error)
  }
})
router.get('/independent-student-approvals', ...requireAdmin, async (req, res, next) => {
  try {
    const status = req.query.status ?? 'pending'
    const page = Number.parseInt(req.query.page ?? '1', 10)
    const pageSize = Number.parseInt(req.query.pageSize ?? '25', 10)
    if (typeof status !== 'string' || !approvalStatuses.has(status)) {
      return res.status(400).json({ message: 'Select a valid approval status.' })
    }
    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      return res.status(400).json({ message: 'Select a valid application page.' })
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ message: 'Application page size must be between 1 and 100.' })
    }

    const statusFilter = (selectedStatus) => {
      if (selectedStatus === 'pending') {
        return { $or: [{ approvalStatus: 'pending' }, { approvalStatus: { $exists: false }, status: 'pending' }] }
      }
      if (selectedStatus === 'rejected') {
        return { $or: [{ approvalStatus: 'rejected' }, { approvalStatus: { $exists: false }, status: 'rejected' }] }
      }
      return {
        $or: [
          { approvalStatus: 'approved' },
          { approvalStatus: { $exists: false }, status: 'active' },
        ],
      }
    }
    const query = { role: 'student', studentType: 'independent' }
    if (status !== 'all') Object.assign(query, statusFilter(status))
    const [students, total, pendingCount] = await Promise.all([
      Student.find(query)
        .select('fullName email username studentId createdAt studentType status approvalStatus rejectionReason')
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      Student.countDocuments(query),
      Student.countDocuments({
        role: 'student',
        studentType: 'independent',
        ...statusFilter('pending'),
      }),
    ])
    return res.json({
      students: students.map((student) => ({
        ...student,
        _id: String(student._id),
        approvalStatus: student.approvalStatus || (student.status === 'active' ? 'approved' : student.status),
        studentType: 'independent',
      })),
      total,
      page,
      pageSize,
      pendingCount,
    })
  } catch (error) {
    return next(error)
  }
})
router.get('/independent-students/:studentId/approval-details', ...requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ message: 'Select a valid independent student.' })
    }
    const student = await Student.findOne({
      _id: req.params.studentId,
      role: 'student',
      studentType: 'independent',
    })
      .select([
        'fullName email username createdAt status approvalStatus approvedAt rejectionReason registrationDetails',
        ...Object.entries(registrationFieldAliases).flatMap(([field, aliases]) => [field, ...aliases]),
      ].join(' '))
      .lean()
    if (!student) return res.status(404).json({ message: 'The independent student was not found.' })

    return res.json({
      student: {
        _id: String(student._id),
        fullName: student.fullName,
        email: student.email,
        username: student.username,
        createdAt: student.createdAt,
        approvedAt: student.approvedAt,
        status: student.status,
        rejectionReason: student.rejectionReason,
        studentType: 'independent',
        approvalStatus: student.approvalStatus || (student.status === 'active' ? 'approved' : student.status),
        registrationDetails: publicRegistrationDetails(student.registrationDetails, student, student),
      },
    })
  } catch (error) {
    return next(error)
  }
})
router.patch('/independent-students/:studentId/approval', ...requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ message: 'Select a valid independent student.' })
    }
    const { decision, reason } = req.body ?? {}
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ message: 'Select approve or reject.' })
    }
    if (decision === 'reject' && reason !== undefined &&
      (typeof reason !== 'string' || reason.trim().length > 1000)) {
      return res.status(400).json({ message: 'The rejection reason must be 1,000 characters or fewer.' })
    }

    const studentId = new mongoose.Types.ObjectId(req.params.studentId)
    const session = await mongoose.startSession()
    let student
    try {
      await session.withTransaction(async () => {
        student = await Student.findOneAndUpdate(
          {
            _id: studentId,
            role: 'student',
            studentType: 'independent',
            $or: [
              { approvalStatus: 'pending' },
              { approvalStatus: { $exists: false }, status: 'pending' },
            ],
          },
          decision === 'approve'
            ? {
                $set: {
                  approvalStatus: 'approved',
                  status: 'active',
                  isActive: true,
                  approvedAt: new Date(),
                  approvedBy: req.auth.id,
                },
                $unset: { rejectionReason: '', rejectedAt: '', rejectedBy: '' },
              }
            : {
                $set: {
                  approvalStatus: 'rejected',
                  status: 'rejected',
                  isActive: false,
                  rejectedAt: new Date(),
                  rejectedBy: req.auth.id,
                  rejectionReason: typeof reason === 'string' ? reason.trim() : '',
                },
                $unset: { approvedAt: '', approvedBy: '' },
              },
          { new: true, runValidators: true, session },
        ).lean()
        if (!student) {
          const exists = await Student.exists({
            _id: studentId,
            role: 'student',
            studentType: 'independent',
          }).session(session)
          const error = new Error(
            exists ? 'This application has already been reviewed.' : 'The independent student was not found.',
          )
          error.statusCode = exists ? 409 : 404
          throw error
        }

        const approved = decision === 'approve'
        await Notification.create(
          [{
            recipientRole: 'student',
            recipientId: studentId,
            type: approved ? 'independent_student_approved' : 'independent_student_rejected',
            title: approved ? 'Account approved' : 'Account application rejected',
            message: approved
              ? 'Your independent student account has been approved. You can now log in.'
              : typeof reason === 'string' && reason.trim()
                ? `Your independent student application was rejected. Reason: ${reason.trim()}`
                : 'Your independent student application was rejected.',
            link: '/student/dashboard',
            metadata: { approvalStatus: approved ? 'approved' : 'rejected' },
          }],
          { session },
        )
      })
    } finally {
      await session.endSession()
    }

    let message = decision === 'approve'
      ? 'The independent student was approved.'
      : 'The independent student application was rejected.'
    try {
      await sendIndependentStudentDecisionEmail({
        email: student.email,
        fullName: student.fullName,
        approved: decision === 'approve',
        reason: student.rejectionReason,
      })
    } catch (emailError) {
      logEmailDeliveryFailure({
        event: `notification.independent_student_${decision}_email.failed`,
        accountId: student._id,
        error: emailError,
      })
      message += ' The decision was saved, but the email notification could not be sent.'
    }

    return res.json({
      message,
      student: {
        id: String(student._id),
        approvalStatus: student.approvalStatus,
        status: student.status,
        rejectionReason: student.rejectionReason,
      },
    })
  } catch (error) {
    if ([404, 409].includes(error?.statusCode)) {
      return res.status(error.statusCode).json({ message: error.message })
    }
    return next(error)
  }
})
router.get('/students', ...requireAdmin, async (req, res, next) => {
  try {
    const page = Number.parseInt(req.query.page ?? '1', 10)
    const pageSize = Number.parseInt(req.query.pageSize ?? '25', 10)
    const tab = req.query.tab ?? 'all'
    const filterType = req.query.filterType ?? 'all'
    const approvalStatus = req.query.approvalStatus ?? 'all'
    const collegeId = req.query.collegeId
    const search = req.query.search
    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      return res.status(400).json({ message: 'Select a valid student page.' })
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ message: 'Student page size must be between 1 and 100.' })
    }
    if (!['all', 'independent', 'college'].includes(tab)) {
      return res.status(400).json({ message: 'Select a valid student category.' })
    }
    if (!['all', 'independent', 'college'].includes(filterType)) {
      return res.status(400).json({ message: 'Select a valid student filter.' })
    }
    if (typeof approvalStatus !== 'string' || !approvalStatuses.has(approvalStatus)) {
      return res.status(400).json({ message: 'Select a valid approval status.' })
    }
    if (collegeId !== undefined &&
      (typeof collegeId !== 'string' || !/^[a-f\d]{24}$/i.test(collegeId))) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    if (search !== undefined && (typeof search !== 'string' || search.length > 200)) {
      return res.status(400).json({ message: 'Student search must be 200 characters or fewer.' })
    }

    const sharedProjection = {
      fullName: 1,
      username: 1,
      email: 1,
      role: 1,
      status: 1,
      createdAt: 1,
      department: 1,
      batch: 1,
      approvalStatus: 1,
    }
    const match = {}
    const selectedTypes = [...new Set([tab, filterType].filter((value) => value !== 'all'))]
    if (selectedTypes.length > 1) {
      match.studentType = { $in: [] }
    } else if (selectedTypes.length === 1) {
      match.studentType = selectedTypes[0]
    }
    if (collegeId) match.collegeId = new mongoose.Types.ObjectId(collegeId)
    if (approvalStatus !== 'all') {
      const approvalCondition = approvalStatus === 'pending'
        ? { $or: [{ approvalStatus: 'pending' }, { approvalStatus: { $exists: false }, status: 'pending' }] }
        : approvalStatus === 'rejected'
          ? { $or: [{ approvalStatus: 'rejected' }, { approvalStatus: { $exists: false }, status: 'rejected' }] }
          : {
              $or: [
                { approvalStatus: 'approved' },
                { approvalStatus: { $exists: false }, status: 'active' },
              ],
            }
      match.$and = [{ studentType: 'independent' }, approvalCondition]
    }
    const normalizedSearch = search?.trim()
    if (normalizedSearch) {
      const expression = new RegExp(escapeRegex(normalizedSearch), 'i')
      const searchCondition = { $or: [
        { fullName: expression },
        { username: expression },
        { email: expression },
        { studentId: expression },
      ] }
      if (match.$and) match.$and.push(searchCondition)
      else match.$or = searchCondition.$or
    }

    const [result] = await Student.aggregate([
      { $match: { role: 'student' } },
      {
        $project: {
          ...sharedProjection,
          studentId: 1,
          studentType: { $literal: 'independent' },
          collegeId: { $literal: null },
          approvalStatus: {
            $ifNull: ['$approvalStatus', { $cond: [{ $eq: ['$status', 'active'] }, 'approved', '$status'] }],
          },
          referralCodeUsed: { $ifNull: ['$registrationDetails.referralCode', null] },
        },
      },
      {
        $unionWith: {
          coll: CollegeStudent.collection.name,
          pipeline: [
            { $match: { role: 'student' } },
            {
              $project: {
                ...sharedProjection,
                studentId: 1,
                studentType: { $literal: 'college' },
                collegeId: 1,
                referralCodeUsed: { $literal: null },
                approvalStatus: { $literal: null },
              },
            },
          ],
        },
      },
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      {
        $lookup: {
          from: College.collection.name,
          localField: 'collegeId',
          foreignField: '_id',
          as: 'college',
        },
      },
      { $unwind: { path: '$college', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          ...sharedProjection,
          studentId: 1,
          studentType: 1,
          collegeId: 1,
          referralCodeUsed: 1,
          collegeName: '$college.name',
        },
      },
      {
        $facet: {
          students: [
            { $sort: { createdAt: -1, _id: 1 } },
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ])
    const students = result?.students ?? []
    const independentStudentIds = students
      .filter((student) => student.studentType === 'independent')
      .map((student) => student._id)
    const generatedCodes = independentStudentIds.length
      ? await ReferralCode.find({ generatedBy: { $in: independentStudentIds } })
        .select('code generatedBy createdAt expiresAt status usedBy')
        .sort({ createdAt: -1 })
        .lean()
      : []
    const codesByOwner = new Map()
    const now = new Date()
    for (const code of generatedCodes) {
      const ownerId = String(code.generatedBy)
      if (!codesByOwner.has(ownerId)) codesByOwner.set(ownerId, [])
      codesByOwner.get(ownerId).push({
        code: code.code,
        createdAt: code.createdAt || null,
        expiresAt: code.expiresAt || null,
        status: code.usedBy || code.status === 'used'
          ? 'Used'
          : code.status === 'expired' || (code.expiresAt && code.expiresAt <= now)
            ? 'Expired'
            : 'Active',
      })
    }
    return res.json({
      students: students.map((student) => ({
        ...student,
        referralCodeUsed: student.referralCodeUsed || null,
        generatedReferralCodes: codesByOwner.get(String(student._id)) || [],
      })),
      total: result?.total?.[0]?.count ?? 0,
      page,
      pageSize,
    })
  } catch (error) {
    return next(error)
  }
})
router.patch('/students/bulk', ...requireAdmin, async (req, res, next) => {
  try {
    const { collegeId, studentIds, department, batch } = req.body ?? {}
    if (typeof collegeId !== 'string' || !mongoose.isValidObjectId(collegeId)) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    if (!Array.isArray(studentIds) || !studentIds.length || studentIds.length > 5000 ||
      studentIds.some((id) => !mongoose.isValidObjectId(id)) ||
      new Set(studentIds.map(String)).size !== studentIds.length) {
      return res.status(400).json({ message: 'Select between 1 and 5,000 unique students.' })
    }
    const update = {}
    if (department !== undefined) {
      if (typeof department !== 'string' || department.trim().length > 120) {
        return res.status(400).json({ message: 'Department must be 120 characters or fewer.' })
      }
      update.department = department.trim()
    }
    if (batch !== undefined) {
      if (typeof batch !== 'string' || batch.trim().length > 80) {
        return res.status(400).json({ message: 'Batch must be 80 characters or fewer.' })
      }
      update.batch = batch.trim()
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ message: 'Enter at least one field to update.' })
    }

    const selectedCollegeId = new mongoose.Types.ObjectId(collegeId)
    const selectedIds = studentIds.map((id) => new mongoose.Types.ObjectId(id))
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const eligible = await CollegeStudent.countDocuments({
          _id: { $in: selectedIds },
          collegeId: selectedCollegeId,
          studentType: 'college',
          role: 'student',
        }).session(session)
        if (eligible !== selectedIds.length) {
          const error = new Error('One or more selected students do not belong to this college.')
          error.statusCode = 409
          throw error
        }
        await CollegeStudent.updateMany(
          {
            _id: { $in: selectedIds },
            collegeId: selectedCollegeId,
            studentType: 'college',
            role: 'student',
          },
          { $set: update },
          { session, runValidators: true },
        )
      })
    } finally {
      await session.endSession()
    }
    return res.json({ message: `Updated ${selectedIds.length} college students.`, updated: selectedIds.length })
  } catch (error) {
    if (error?.statusCode === 409) return res.status(409).json({ message: error.message })
    return next(error)
  }
})
router.patch('/students/:studentId', ...requireAdmin, async (req, res, next) => {
  try {
    const { studentId } = req.params
    const { studentType } = req.query
    const { fullName, email, username } = req.body ?? {}
    if (!mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ message: 'Select a valid student.' })
    }
    if (!['independent', 'college'].includes(studentType)) {
      return res.status(400).json({ message: 'Select a valid student type.' })
    }
    if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 120) {
      return res.status(400).json({ message: 'Enter a student name between 1 and 120 characters.' })
    }
    if (typeof email !== 'string' || email.trim().length > 254 || !emailPattern.test(email.trim())) {
      return res.status(400).json({ message: 'Enter a valid email address.' })
    }
    if (typeof username !== 'string' || !usernamePattern.test(username.trim())) {
      return res.status(400).json({
        message: 'Use a username with 3–30 letters, numbers, dots, underscores, or hyphens.',
      })
    }

    const AccountModel = studentType === 'college' ? CollegeStudent : Student
    const accountCollection = AccountModel.collection.name
    const accountId = new mongoose.Types.ObjectId(studentId)
    const student = await AccountModel.findOne({ _id: accountId, role: 'student', studentType })
      .select('_id')
      .lean()
    if (!student) return res.status(404).json({ message: 'The student was not found.' })

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()
    const identifierExistsElsewhere = async (field, value) => {
      let identityQuery = AccountIdentity.findOne({ [field]: value, accountId: { $ne: accountId } })
      if (field === 'username') identityQuery = identityQuery.collation({ locale: 'en', strength: 2 })
      if (await identityQuery.select('_id').lean()) return true

      for (const Model of Object.values(accountModelsByCollection)) {
        const filter = { [field]: value }
        if (Model.collection.name === accountCollection) filter._id = { $ne: accountId }
        let accountQuery = Model.findOne(filter)
        if (field === 'username') accountQuery = accountQuery.collation({ locale: 'en', strength: 2 })
        if (await accountQuery.select('_id').lean()) return true
      }
      return false
    }
    const [emailTaken, usernameTaken] = await Promise.all([
      identifierExistsElsewhere('email', normalizedEmail),
      identifierExistsElsewhere('username', normalizedUsername),
    ])
    if (emailTaken) return res.status(409).json({ message: 'An account with this email already exists.' })
    if (usernameTaken) return res.status(409).json({ message: 'This username is already taken.' })

    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const currentIdentity = await AccountIdentity.findOne({
          accountCollection,
          accountId,
        }).session(session)
        if (currentIdentity) {
          currentIdentity.email = normalizedEmail
          currentIdentity.username = normalizedUsername
          await currentIdentity.save({ session })
        } else {
          await AccountIdentity.create([{
            email: normalizedEmail,
            username: normalizedUsername,
            accountCollection,
            accountId,
          }], { session })
        }
        const update = await AccountModel.updateOne(
          { _id: accountId, role: 'student', studentType },
          { $set: { fullName: fullName.trim(), email: normalizedEmail, username: normalizedUsername } },
          { session, runValidators: true },
        )
        if (!update.matchedCount) {
          const error = new Error('The student was not found.')
          error.statusCode = 404
          throw error
        }
      })
    } finally {
      await session.endSession()
    }

    return res.json({
      message: 'Student details updated successfully.',
      student: {
        id: studentId,
        fullName: fullName.trim(),
        email: normalizedEmail,
        username: normalizedUsername,
        studentType,
      },
    })
  } catch (error) {
    if (error?.code === 11000) {
      if (error.keyPattern?.email || error.keyValue?.email) {
        return res.status(409).json({ message: 'An account with this email already exists.' })
      }
      if (error.keyPattern?.username || error.keyValue?.username) {
        return res.status(409).json({ message: 'This username is already taken.' })
      }
      return res.status(409).json({ message: 'An account with these details already exists.' })
    }
    if ([404, 409].includes(error?.statusCode)) {
      return res.status(error.statusCode).json({ message: error.message })
    }
    return next(error)
  }
})
router.delete('/students/bulk', ...requireAdmin, async (req, res, next) => {
  try {
    const { collegeId, studentIds } = req.body ?? {}
    if (typeof collegeId !== 'string' || !mongoose.isValidObjectId(collegeId)) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    if (!Array.isArray(studentIds) || !studentIds.length || studentIds.length > 5000 ||
      studentIds.some((id) => !mongoose.isValidObjectId(id)) ||
      new Set(studentIds.map(String)).size !== studentIds.length) {
      return res.status(400).json({ message: 'Select between 1 and 5,000 unique students.' })
    }
    const selectedCollegeId = new mongoose.Types.ObjectId(collegeId)
    const selectedIds = studentIds.map((id) => new mongoose.Types.ObjectId(id))
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const eligibleStudents = await CollegeStudent.find({
          _id: { $in: selectedIds },
          collegeId: selectedCollegeId,
          studentType: 'college',
          role: 'student',
        }).select('_id').session(session).lean()
        if (eligibleStudents.length !== selectedIds.length) {
          const error = new Error('One or more selected students do not belong to this college. No records were deleted.')
          error.statusCode = 409
          throw error
        }
        await AccountIdentity.deleteMany({
          accountCollection: CollegeStudent.collection.name,
          accountId: { $in: selectedIds },
        }, { session })
        await Enrollment.deleteMany({ userId: { $in: selectedIds } }, { session })
        await CollegeStudent.deleteMany({
          _id: { $in: selectedIds },
          collegeId: selectedCollegeId,
          studentType: 'college',
          role: 'student',
        }, { session })
      })
    } finally {
      await session.endSession()
    }
    return res.json({
      message: `Deleted ${selectedIds.length} college students, their login identities, and enrollment records.`,
      deleted: selectedIds.length,
    })
  } catch (error) {
    if (error?.statusCode === 409) return res.status(409).json({ message: error.message })
    return next(error)
  }
})
router.delete('/students/:studentId', ...requireAdmin, async (req, res, next) => {
  try {
    const { studentId } = req.params
    const { studentType } = req.query
    if (!mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ message: 'Select a valid student.' })
    }
    if (!['independent', 'college'].includes(studentType)) {
      return res.status(400).json({ message: 'Select a valid student type.' })
    }

    const AccountModel = studentType === 'college' ? CollegeStudent : Student
    const accountId = new mongoose.Types.ObjectId(studentId)
    const session = await mongoose.startSession()
    let student
    try {
      await session.withTransaction(async () => {
        student = await AccountModel.findOne({ _id: accountId, role: 'student', studentType })
          .select('_id approvalStatus status')
          .session(session)
          .lean()
        if (!student) {
          const error = new Error('The student was not found.')
          error.statusCode = 404
          throw error
        }
        if (studentType === 'independent' &&
          (student.approvalStatus === 'rejected' || student.status === 'rejected')) {
          const error = new Error('Rejected independent student accounts cannot be permanently deleted.')
          error.statusCode = 409
          throw error
        }
        await AccountIdentity.deleteOne({
          accountCollection: AccountModel.collection.name,
          accountId,
        }, { session })
        await Enrollment.deleteMany({ userId: accountId }, { session })
        await AccountModel.deleteOne({ _id: accountId, role: 'student', studentType }, { session })
      })
    } finally {
      await session.endSession()
    }
    if (!student) return res.status(404).json({ message: 'The student was not found.' })
    return res.json({
      message: 'Student, login identity, and enrollment records deleted.',
      student: { id: String(student._id) },
    })
  } catch (error) {
    if (error?.statusCode === 404) {
      return res.status(404).json({ message: error.message })
    }
    if (error?.statusCode === 409) {
      return res.status(409).json({ message: error.message })
    }
    return next(error)
  }
})
router.get('/referral-codes/:code/details', ...requireAdmin, async (req, res, next) => {
  try {
    const codeValue = req.params.code
    if (typeof codeValue !== 'string' || codeValue.length < 8 || codeValue.length > 64) {
      return res.status(400).json({ message: 'Select a valid referral code.' })
    }

    const code = await ReferralCode.findOne({ code: codeValue })
      .select('code generatedBy createdAt expiresAt status usedBy')
      .lean()
    if (!code) return res.status(404).json({ message: 'The referral code was not found.' })

    const [owner, referredStudents] = await Promise.all([
      Student.findById(code.generatedBy).select('fullName studentId').lean(),
      Student.find({
        role: 'student',
        studentType: 'independent',
        'registrationDetails.referralCode': code.code,
      })
        .select('fullName email studentId createdAt status approvalStatus')
        .sort({ createdAt: 1 })
        .lean(),
    ])
    const now = new Date()
    const serializedStudents = referredStudents.map((student) => {
      const accountStatus = String(student.approvalStatus || student.status || '').toLowerCase()
      return {
        id: String(student._id),
        fullName: student.fullName || '',
        studentId: student.studentId || '',
        email: student.email || '',
        registeredAt: student.createdAt || null,
        status: accountStatus === 'approved' || accountStatus === 'active'
          ? 'Approved'
          : accountStatus === 'rejected'
            ? 'Rejected'
            : accountStatus === 'pending' || accountStatus === 'awaiting_approval'
              ? 'Pending'
              : accountStatus.replaceAll('_', ' ') || 'Unknown',
      }
    })
    const referralStatus = code.usedBy || code.status === 'used'
      ? 'Used'
      : code.status === 'expired' || (code.expiresAt && code.expiresAt <= now)
        ? 'Expired'
        : 'Active'

    return res.json({
      code: code.code,
      generatedBy: {
        fullName: owner?.fullName || '',
        studentId: owner?.studentId || '',
      },
      createdAt: code.createdAt || null,
      expiresAt: code.expiresAt || null,
      status: referralStatus,
      referredStudents: serializedStudents,
      summary: {
        totalReferrals: serializedStudents.length,
        successfulRegistrations: serializedStudents.filter(({ status }) => status === 'Approved').length,
        pendingRegistrations: serializedStudents.filter(({ status }) => status === 'Pending').length,
      },
    })
  } catch (error) {
    return next(error)
  }
})
router.get('/students/:studentId/referral-codes', ...requireAdmin, async (req, res, next) => {
  try {
    const { studentId } = req.params
    const { studentType } = req.query
    if (!mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ message: 'Select a valid student.' })
    }
    if (!['independent', 'college'].includes(studentType)) {
      return res.status(400).json({ message: 'Select a valid student type.' })
    }

    const AccountModel = studentType === 'college' ? CollegeStudent : Student
    const student = await AccountModel.findOne({
      _id: studentId,
      role: 'student',
      studentType,
    }).select('_id').lean()
    if (!student) return res.status(404).json({ message: 'The student was not found.' })

    const codes = studentType === 'independent'
      ? await ReferralCode.find({ generatedBy: student._id })
        .select('code createdAt expiresAt status usedBy usedAt registrationStatus')
        .sort({ createdAt: -1 })
        .lean()
      : []
    const codeValues = codes.map(({ code }) => code)
    const usedStudentIds = codes.flatMap((code) => {
      const usedBy = code.usedBy == null
        ? []
        : Array.isArray(code.usedBy) ? code.usedBy : [code.usedBy]
      return usedBy.map((student) => student?._id || student).filter(Boolean)
    })
    const [independentStudents, collegeStudents] = codeValues.length
      ? await Promise.all([
        Student.find({
          $or: [
            { _id: { $in: usedStudentIds } },
            {
              role: 'student',
              studentType: 'independent',
              'registrationDetails.referralCode': { $in: codeValues },
            },
          ],
        })
          .select('fullName email studentId createdAt status approvalStatus registrationDetails.referralCode')
          .sort({ createdAt: 1, _id: 1 })
          .lean(),
        usedStudentIds.length
          ? CollegeStudent.find({
            _id: { $in: usedStudentIds },
            role: 'student',
            studentType: 'college',
          })
            .select('fullName email studentId createdAt status')
            .sort({ createdAt: 1, _id: 1 })
            .lean()
          : [],
      ])
      : [[], []]

    const studentsById = new Map(
      [...independentStudents, ...collegeStudents]
        .map((referredStudent) => [String(referredStudent._id), referredStudent]),
    )
    const studentsByCode = new Map(codes.map(({ code }) => [code, new Map()]))
    for (const referral of codes) {
      const usedBy = referral.usedBy == null
        ? []
        : Array.isArray(referral.usedBy) ? referral.usedBy : [referral.usedBy]
      const studentsForCode = studentsByCode.get(referral.code)
      for (const usedStudent of usedBy) {
        const studentId = String(usedStudent?._id || usedStudent)
        const referredStudent = studentsById.get(studentId)
        if (referredStudent) studentsForCode.set(studentId, referredStudent)
      }
    }
    for (const referredStudent of independentStudents) {
      const code = referredStudent.registrationDetails?.referralCode
      if (studentsByCode.has(code)) studentsByCode.get(code).set(String(referredStudent._id), referredStudent)
    }

    const now = new Date()
    return res.json({
      student: {
        id: String(student._id),
        studentType,
      },
      codes: codes.map((code) => {
        const hasUsedBy = code.usedBy != null &&
          (!Array.isArray(code.usedBy) || code.usedBy.length > 0)
        const status = hasUsedBy || code.status === 'used'
          ? 'used'
          : code.status === 'expired' || (code.expiresAt && code.expiresAt <= now)
            ? 'expired'
            : 'active'
        return {
          code: code.code,
          createdAt: code.createdAt || null,
          expiresAt: code.expiresAt || null,
          status,
          usedAt: code.usedAt || null,
          registrationStatus: code.registrationStatus || null,
          hasUsedBy,
          usedBy: [...studentsByCode.get(code.code).values()].map((referredStudent) => {
            const accountStatus = String(
              referredStudent.approvalStatus || referredStudent.status || '',
            ).toLowerCase()
            const accountRegistrationStatus = (
              accountStatus === 'approved' || accountStatus === 'active'
                ? 'approved'
                : accountStatus === 'rejected'
                  ? 'rejected'
                  : accountStatus === 'pending' || accountStatus === 'awaiting_approval'
                    ? 'awaiting_approval'
                    : null
            )
            const registrationStatus = accountRegistrationStatus || code.registrationStatus || null
            return {
              id: String(referredStudent._id),
              fullName: referredStudent.fullName || '',
              studentId: referredStudent.studentId || '',
              email: referredStudent.email || '',
              registeredAt: referredStudent.createdAt || null,
              registrationStatus,
            }
          }),
        }
      }),
    })
  } catch (error) {
    return next(error)
  }
})
router.get('/students/:studentId/details', ...requireAdmin, async (req, res, next) => {
  try {
    const { studentId } = req.params
    const { studentType } = req.query
    if (!mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ message: 'Select a valid student.' })
    }
    if (!['independent', 'college'].includes(studentType)) {
      return res.status(400).json({ message: 'Select a valid student type.' })
    }

    const AccountModel = studentType === 'college' ? CollegeStudent : Student
    const studentQuery = AccountModel.findOne({
      _id: studentId,
      role: 'student',
      studentType,
    }).select(
      studentType === 'independent'
        ? 'fullName username email studentId studentType collegeId createdAt status approvalStatus registrationDetails.referralCode'
        : 'fullName username email studentId studentType collegeId createdAt status approvalStatus',
    )
    const student = await studentQuery.lean()
    if (!student) return res.status(404).json({ message: 'The student was not found.' })

    const [college, enrollmentRecords, ownedReferralCodes] = await Promise.all([
      studentType === 'college' ? College.findById(student.collegeId).select('name').lean() : null,
      Enrollment.find({ userId: student._id, status: { $ne: 'cancelled' } })
        .select('courseId assignedBy status')
        .sort({ createdAt: -1 })
        .lean(),
      studentType === 'independent'
        ? ReferralCode.find({ generatedBy: student._id })
          .select('code createdAt expiresAt status usedBy usedAt registrationStatus')
          .sort({ createdAt: -1 })
          .lean()
        : [],
    ])
    const referralCodes = ownedReferralCodes.map((code) => code.code)
    const referredStudents = referralCodes.length
      ? await Student.find({
        role: 'student',
        studentType: 'independent',
        'registrationDetails.referralCode': { $in: referralCodes },
      })
        .select('fullName email username studentId createdAt status approvalStatus registrationDetails.referralCode')
        .lean()
      : []
    const referredStudentsByCode = new Map()
    for (const referredStudent of referredStudents) {
      const code = referredStudent.registrationDetails?.referralCode
      if (!referredStudentsByCode.has(code)) referredStudentsByCode.set(code, [])
      referredStudentsByCode.get(code).push(referredStudent)
    }
    const now = new Date()
    const referralDetails = {
      codes: ownedReferralCodes.map((code) => ({
        code: code.code,
        createdAt: code.createdAt || null,
        expiresAt: code.expiresAt || null,
        generatedBy: {
          fullName: student.fullName || '',
          studentId: student.studentId || '',
        },
        status: code.usedBy || code.status === 'used'
          ? 'Used'
          : code.status === 'expired' || (code.expiresAt && code.expiresAt <= now)
            ? 'Expired'
            : 'Active',
        referredStudents: (referredStudentsByCode.get(code.code) || []).map((referredStudent) => {
          const accountStatus = String(
            referredStudent.approvalStatus || referredStudent.status || '',
          ).toLowerCase()
          return {
            id: String(referredStudent._id),
            fullName: referredStudent.fullName || '',
            studentId: referredStudent.studentId || '',
            email: referredStudent.email || '',
            registeredAt: referredStudent.createdAt || null,
            status: accountStatus === 'approved' || accountStatus === 'active'
              ? 'Approved'
              : accountStatus === 'rejected'
                ? 'Rejected'
                : accountStatus === 'pending' || accountStatus === 'awaiting_approval'
                  ? 'Pending'
                  : accountStatus.replaceAll('_', ' ') || 'Unknown',
          }
        }),
      })),
    }
    referralDetails.referredStudents = referralDetails.codes
      .flatMap(({ referredStudents: codeStudents }) => codeStudents)
    const successfulRegistrations = referralDetails.referredStudents
      .filter(({ status }) => status === 'Approved' || status === 'Active').length
    const pendingRegistrations = referralDetails.referredStudents
      .filter(({ status }) => status === 'Pending').length

    const enrollmentByCourse = new Map()
    for (const enrollment of enrollmentRecords) {
      const courseId = String(enrollment.courseId)
      const existing = enrollmentByCourse.get(courseId)
      const isCompleted = enrollment.status === 'completed'
      const isAssigned = String(enrollment.assignedBy) !== String(student._id)
      if (!existing) {
        enrollmentByCourse.set(courseId, {
          courseId,
          status: enrollment.status,
          source: isAssigned ? 'assigned' : 'enrolled',
        })
        continue
      }
      if (isCompleted) existing.status = 'completed'
      if (isAssigned) existing.source = 'assigned'
    }

    const courseIds = [...enrollmentByCourse.keys()]
    const courses = courseIds.length
      ? await Course.find({ _id: { $in: courseIds } })
        .select('title status')
        .lean()
      : []
    const coursesById = new Map(courses.map((course) => [String(course._id), course]))
    const courseProgress = [...enrollmentByCourse.values()].map((enrollment) => {
      const course = coursesById.get(enrollment.courseId)
      return {
        courseId: enrollment.courseId,
        title: course?.title || 'Course unavailable',
        source: enrollment.source,
        status: enrollment.status,
        progressPercent: enrollment.status === 'completed' ? 100 : null,
      }
    })
    const assignedCourses = courseProgress.filter(({ source }) => source === 'assigned')
    const enrolledCourses = courseProgress.filter(({ source }) => source === 'enrolled')
    const completedCourses = courseProgress.filter(({ status }) => status === 'completed')
    const totalCourses = courseProgress.length

    return res.json({
      student: {
        id: String(student._id),
        fullName: student.fullName || '',
        username: student.username || '',
        email: student.email || '',
        studentId: student.studentId || '',
        studentType: student.studentType,
        collegeName: studentType === 'college' ? college?.name || '' : null,
        collegeId: studentType === 'college' ? String(student.collegeId) : null,
        createdAt: student.createdAt || null,
        status: student.status || 'unknown',
        referralCodeUsed: studentType === 'independent'
          ? student.registrationDetails?.referralCode || null
          : null,
      },
      summary: {
        coursesAssigned: assignedCourses.length,
        coursesEnrolled: enrolledCourses.length,
        coursesCompleted: completedCourses.length,
        overallCompletionPercentage: totalCourses
          ? Math.round((completedCourses.length / totalCourses) * 100)
          : null,
        studentsReferred: referralDetails.referredStudents.length,
        successfulReferrals: successfulRegistrations,
        pendingReferrals: pendingRegistrations,
      },
      courseProgress,
      referralDetails,
      quizResults: [],
      assignmentResults: [],
      certificates: [],
    })
  } catch (error) {
    return next(error)
  }
})
router.post('/students', ...requireAdmin, async (req, res, next) => {
  try {
    const {
      fullName,
      email,
      username,
      password,
      studentType,
      studentId,
      collegeId,
    } = req.body ?? {}
    if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 120) {
      return res.status(400).json({ message: 'Enter a student name between 1 and 120 characters.' })
    }
    if (typeof email !== 'string' || email.trim().length > 254 || !emailPattern.test(email.trim())) {
      return res.status(400).json({ message: 'Enter a valid email address.' })
    }
    if (typeof username !== 'string' || !usernamePattern.test(username.trim())) {
      return res.status(400).json({
        message: 'Use a username with 3–30 letters, numbers, dots, underscores, or hyphens.',
      })
    }
    if (
      typeof password !== 'string' ||
      password.length < 8 ||
      Buffer.byteLength(password, 'utf8') > 72
    ) {
      return res.status(400).json({ message: 'Use a password of at least 8 characters.' })
    }
    if (!['independent', 'college'].includes(studentType)) {
      return res.status(400).json({ message: 'Select Independent or College student type.' })
    }
    if (studentId !== undefined &&
      (typeof studentId !== 'string' || studentId.trim().length > 100)) {
      return res.status(400).json({ message: 'Student ID must be 100 characters or fewer.' })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()
    const normalizedStudentId = typeof studentId === 'string' ? studentId.trim() : ''
    let selectedCollegeId
    if (studentType === 'college') {
      if (!normalizedStudentId) {
        return res.status(400).json({ message: 'Enter a student ID for college students.' })
      }
      if (typeof collegeId !== 'string' || !/^[a-f\d]{24}$/i.test(collegeId)) {
        return res.status(400).json({ message: 'Select a valid college.' })
      }
      selectedCollegeId = new mongoose.Types.ObjectId(collegeId)
      const college = await College.findById(selectedCollegeId).select('_id').lean()
      if (!college) return res.status(400).json({ message: 'The selected college does not exist.' })
    } else if (collegeId !== undefined && collegeId !== '') {
      return res.status(400).json({ message: 'Independent students cannot be assigned a college.' })
    }

    const [existingEmail, existingUsername, existingStudentId] = await Promise.all([
      accountIdentifierExists('email', normalizedEmail),
      accountIdentifierExists('username', normalizedUsername),
      normalizedStudentId
        ? Promise.all([
          Student.findOne({ studentId: normalizedStudentId })
            .collation({ locale: 'en', strength: 2 }).select('_id').lean(),
          CollegeStudent.findOne({ studentId: normalizedStudentId })
            .collation({ locale: 'en', strength: 2 }).select('_id').lean(),
        ]).then((matches) => matches.some(Boolean))
        : false,
    ])
    if (existingEmail) return res.status(409).json({ message: 'An account with this email already exists.' })
    if (existingUsername) return res.status(409).json({ message: 'This username is already taken.' })
    if (existingStudentId) return res.status(409).json({ message: 'This student ID already exists.' })

    const AccountModel = studentType === 'college' ? CollegeStudent : Student
    const accountCollection = AccountModel.collection.name
    const accountId = new mongoose.Types.ObjectId()
    const passwordHash = await bcrypt.hash(password, 12)
    const session = await mongoose.startSession()
    let student
    try {
      await session.withTransaction(async () => {
        const duplicate = await AccountIdentity.findOne({
          $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
        }).session(session)
        if (duplicate?.email === normalizedEmail) {
          const error = new Error('An account with this email already exists.')
          error.statusCode = 409
          throw error
        }
        if (duplicate?.username === normalizedUsername) {
          const error = new Error('This username is already taken.')
          error.statusCode = 409
          throw error
        }
        if (normalizedStudentId) {
          const [independentMatch, collegeMatch] = await Promise.all([
            Student.findOne({ studentId: normalizedStudentId })
              .collation({ locale: 'en', strength: 2 }).select('_id').session(session).lean(),
            CollegeStudent.findOne({ studentId: normalizedStudentId })
              .collation({ locale: 'en', strength: 2 }).select('_id').session(session).lean(),
          ])
          if (independentMatch || collegeMatch) {
            const error = new Error('This student ID already exists.')
            error.statusCode = 409
            throw error
          }
        }
        if (selectedCollegeId) {
          await assertCollegeStudentCapacity(selectedCollegeId, session)
        }

        await AccountIdentity.create(
          [{
            email: normalizedEmail,
            username: normalizedUsername,
            accountCollection,
            accountId,
          }],
          { session },
        )
        ;[student] = await AccountModel.create(
          [{
            _id: accountId,
            fullName: fullName.trim(),
            email: normalizedEmail,
            username: normalizedUsername,
            passwordHash,
            role: 'student',
            studentType,
            ...(normalizedStudentId ? { studentId: normalizedStudentId } : {}),
            ...(selectedCollegeId ? { collegeId: selectedCollegeId } : {}),
            status: studentType === 'independent' ? 'pending' : 'active',
            isActive: studentType !== 'independent',
            ...(studentType === 'independent' ? { approvalStatus: 'pending' } : {}),
            permissions: [],
          }],
          { session },
        )
        if (studentType === 'independent') {
          await Notification.create(
            [{
              recipientRole: 'main_admin',
              type: 'independent_student_registered',
              title: 'Independent student application',
              message: `${student.fullName} submitted an independent student application.`,
              link: '/admin/dashboard?section=independent-approvals',
              metadata: { studentId: String(accountId), email: normalizedEmail },
            }],
            { session },
          )
        }
      })
    } finally {
      await session.endSession()
    }

    return res.status(201).json({
      message: studentType === 'independent'
        ? 'Independent student created and awaiting administrator approval.'
        : 'Student created successfully.',
      student: {
        _id: String(student._id),
        fullName: student.fullName,
        email: student.email,
        username: student.username,
        studentId: student.studentId || '',
        studentType: student.studentType,
        collegeId: student.collegeId ? String(student.collegeId) : null,
        status: student.status,
        approvalStatus: student.approvalStatus,
        createdAt: student.createdAt,
      },
    })
  } catch (error) {
    if (error?.code === 11000) {
      if (error.keyPattern?.email || error.keyValue?.email) {
        return res.status(409).json({ message: 'An account with this email already exists.' })
      }
      if (error.keyPattern?.username || error.keyValue?.username) {
        return res.status(409).json({ message: 'This username is already taken.' })
      }
      if (error.keyPattern?.studentId || error.keyValue?.studentId) {
        return res.status(409).json({ message: 'This student ID already exists.' })
      }
      return res.status(409).json({ message: 'An account with these details already exists.' })
    }
    if (error?.statusCode === 409) {
      return res.status(409).json({ message: error.message })
    }
    return next(error)
  }
})
router.get('/reports/lookup', ...requireAdmin, async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
    if (search.length < 2 || search.length > 100) {
      return res.json({ students: [] })
    }

    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const expression = new RegExp(escapedSearch, 'i')
    const filter = {
      role: 'student',
      $or: [
        { fullName: expression },
        { username: expression },
        { email: expression },
      ],
    }
    const [independentStudents, collegeStudents] = await Promise.all([
      Student.find(filter)
        .select('fullName username email')
        .sort({ fullName: 1 })
        .limit(25)
        .lean(),
      CollegeStudent.find(filter)
        .select('fullName username email collegeId')
        .sort({ fullName: 1 })
        .limit(25)
        .lean(),
    ])
    const collegeIds = [...new Set(
      collegeStudents.map((student) => String(student.collegeId)).filter(Boolean),
    )].map((id) => new mongoose.Types.ObjectId(id))
    const colleges = collegeIds.length
      ? await College.find({ _id: { $in: collegeIds } }).select('name code').lean()
      : []
    const collegesById = new Map(colleges.map((college) => [String(college._id), college]))
    const students = [
      ...independentStudents.map((student) => ({
        id: String(student._id),
        name: student.fullName || student.username || student.email,
        email: student.email,
        studentType: 'independent',
        accountCollection: Student.collection.name,
      })),
      ...collegeStudents.map((student) => {
        const college = collegesById.get(String(student.collegeId))
        return {
          id: String(student._id),
          name: student.fullName || student.username || student.email,
          email: student.email,
          studentType: 'college',
          accountCollection: CollegeStudent.collection.name,
          collegeId: String(student.collegeId),
          collegeName: college?.name || '',
        }
      }),
    ].sort((left, right) => left.name.localeCompare(right.name)).slice(0, 25)

    return res.json({ students })
  } catch (error) {
    return next(error)
  }
})
router.get('/reports/progress/summary', ...requireAdmin, async (req, res, next) => {
  try {
    const now = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    start.setUTCDate(start.getUTCDate() - 29)
    const enrollments = await Enrollment.find({ status: { $ne: 'cancelled' } })
      .select('_id userId courseId collegeId status completedLessonIds startedLessonIds lessonCompletionDates createdAt')
      .populate('userId', 'role collegeId')
      .sort({ createdAt: -1, _id: -1 })
      .lean()
    const relatedEnrollments = enrollments.filter((enrollment) => {
      const student = enrollment.userId
      return student
        && student.role === 'student'
        && (enrollment.collegeId
          ? String(student.collegeId) === String(enrollment.collegeId)
          : !student.collegeId)
    })
    const latestByStudentCourse = new Map()
    for (const enrollment of relatedEnrollments) {
      const studentType = enrollment.collegeId ? 'college' : 'independent'
      const key = `${studentType}:${String(enrollment.collegeId || '')}:${String(enrollment.userId._id)}:${String(enrollment.courseId)}`
      const current = latestByStudentCourse.get(key)
      if (!current || new Date(enrollment.createdAt || 0) > new Date(current.createdAt || 0)) {
        latestByStudentCourse.set(key, enrollment)
      }
    }
    const currentEnrollments = [...latestByStudentCourse.values()]
    const courseIds = [...new Set(currentEnrollments.map(({ courseId }) => String(courseId)).filter(Boolean))]
    const [courses, quizAttempts] = await Promise.all([
      courseIds.length
        ? Course.find({ _id: { $in: courseIds } })
          .select('title modules.lessons._id modules.contentItems._id modules.contentItems.type')
          .lean()
        : Promise.resolve([]),
      relatedEnrollments.length
        ? QuizAttempt.find({
          status: 'submitted',
          submittedAt: { $gte: start, $lte: now },
          enrollmentId: { $in: relatedEnrollments.map(({ _id }) => _id) },
        }).select('enrollmentId userId courseId submittedAt').lean()
        : Promise.resolve([]),
    ])
    const coursesById = new Map(courses.map((course) => [String(course._id), course]))
    const relatedEnrollmentsById = new Map(
      relatedEnrollments.map((enrollment) => [String(enrollment._id), enrollment]),
    )
    const progressBuckets = [
      { label: '0%', count: 0 },
      { label: '1–24%', count: 0 },
      { label: '25–49%', count: 0 },
      { label: '50–74%', count: 0 },
      { label: '75–99%', count: 0 },
      { label: '100%', count: 0 },
    ]
    const courseStatuses = { completed: 0, inProgress: 0, notStarted: 0 }
    const activityByDate = new Map()
    let unavailableCourseRecords = 0
    let untrackedCourseRecords = 0
    const addActivity = (dateValue, field) => {
      const date = reportDateKey(dateValue)
      if (!date) return
      const entry = activityByDate.get(date) || { date, completedLessons: 0, quizSubmissions: 0 }
      entry[field] += 1
      activityByDate.set(date, entry)
    }

    for (const enrollment of currentEnrollments) {
      const course = coursesById.get(String(enrollment.courseId))
      if (!course) {
        unavailableCourseRecords += 1
        continue
      }
      const progress = getReportCourseProgress(enrollment, course)
      if (progress.completionPercent === null) {
        untrackedCourseRecords += 1
      } else {
        const bucketIndex = progress.completionPercent === 0
          ? 0
          : progress.completionPercent < 25
            ? 1
            : progress.completionPercent < 50
              ? 2
              : progress.completionPercent < 75
                ? 3
                : progress.completionPercent < 100
                  ? 4
                  : 5
        progressBuckets[bucketIndex].count += 1
      }
      if (progress.status === 'completed') courseStatuses.completed += 1
      else if (progress.status === 'in_progress') courseStatuses.inProgress += 1
      else courseStatuses.notStarted += 1

      const completedIds = new Set((enrollment.completedLessonIds || []).map(String))
      const lessonIds = new Set(progress.lessons.map(({ id }) => id))
      const completionDates = enrollment.lessonCompletionDates instanceof Map
        ? [...enrollment.lessonCompletionDates.entries()]
        : Object.entries(enrollment.lessonCompletionDates || {})
      for (const [lessonId, completedAt] of completionDates) {
        if (lessonIds.has(String(lessonId)) && completedIds.has(String(lessonId))) {
          const date = reportDateKey(completedAt)
          if (date && date >= reportDateKey(start) && date <= reportDateKey(now)) {
            addActivity(completedAt, 'completedLessons')
          }
        }
      }
    }
    for (const attempt of quizAttempts) {
      const enrollment = relatedEnrollmentsById.get(String(attempt.enrollmentId))
      if (
        !enrollment ||
        String(attempt.userId) !== String(enrollment.userId._id) ||
        String(attempt.courseId) !== String(enrollment.courseId)
      ) continue
      addActivity(attempt.submittedAt, 'quizSubmissions')
    }

    return res.json({
      periodDays: 30,
      progressBuckets,
      courseStatuses,
      activityOverTime: [...activityByDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
      unavailableCourseRecords,
      untrackedCourseRecords,
      certificateRecordsAvailable: true,
    })
  } catch (error) {
    return next(error)
  }
})
router.get('/reports/progress/submissions/:submissionId/file', ...requireAdmin, async (req, res, next) => {
  try {
    const { submissionId } = req.params
    if (!mongoose.isValidObjectId(submissionId)) {
      return res.status(400).json({ message: 'Select a valid submission.' })
    }
    const submission = await AssignmentSubmission.findOne({ _id: submissionId })
      .select('+fileData')
      .lean()
    if (!submission) return res.status(404).json({ message: 'The submission was not found.' })
    const enrollmentFilter = {
      _id: submission.enrollmentId,
      userId: submission.userId,
      courseId: submission.courseId,
      status: { $ne: 'cancelled' },
      ...(submission.collegeId
        ? { collegeId: submission.collegeId }
        : { $or: [{ collegeId: { $exists: false } }, { collegeId: null }] }),
    }
    const enrollment = await Enrollment.findOne(enrollmentFilter).select('_id').lean()
    if (!enrollment) return res.status(404).json({ message: 'The submission was not found.' })
    const allowedContentTypes = new Set([
      'application/pdf',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ])
    const fileData = toMongoBuffer(submission.fileData)
    if (
      !fileData
      || fileData.length < 1
      || fileData.length > 10 * 1024 * 1024
      || !allowedContentTypes.has(submission.contentType)
    ) {
      return res.status(404).json({ message: 'The submission file is unavailable.' })
    }
    const safeFileName = String(submission.fileName || 'submission')
      .replace(/[\r\n"\\/]/g, '_')
      .replace(/[^\w .()-]/g, '_')
      .slice(0, 180) || 'submission'
    res.set({
      'Content-Type': submission.contentType,
      'Content-Length': String(fileData.length),
      'Content-Disposition': `attachment; filename="${safeFileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    return res.send(fileData)
  } catch (error) {
    return next(error)
  }
})

router.put('/reports/progress/submissions/:submissionId/evaluation', ...requireAdmin, async (req, res, next) => {
  try {
    const { submissionId } = req.params
    if (!mongoose.isValidObjectId(submissionId)) {
      return res.status(400).json({ message: 'Select a valid submission.' })
    }
    const { marksObtained, feedback = '', correctness = 'not_applicable', evaluationStatus } = req.body || {}
    if (
      typeof marksObtained !== 'number'
      || !Number.isFinite(marksObtained)
      || marksObtained < 0
      || typeof feedback !== 'string'
      || feedback.length > 5000
      || !['correct', 'partially_correct', 'incorrect', 'not_applicable'].includes(correctness)
      || (evaluationStatus !== undefined && !['evaluated', 're_evaluation_required'].includes(evaluationStatus))
    ) {
      return res.status(400).json({ message: 'Enter valid evaluation marks, feedback, correctness, and status.' })
    }
    const submission = await AssignmentSubmission.findOne({ _id: submissionId })
      .select('userId collegeId enrollmentId courseId assignmentId')
      .lean()
    if (!submission) return res.status(404).json({ message: 'The submission was not found.' })
    const enrollmentFilter = {
      _id: submission.enrollmentId,
      userId: submission.userId,
      courseId: submission.courseId,
      status: { $ne: 'cancelled' },
      ...(submission.collegeId
        ? { collegeId: submission.collegeId }
        : { $or: [{ collegeId: { $exists: false } }, { collegeId: null }] }),
    }
    const enrollment = await Enrollment.findOne(enrollmentFilter).select('_id').lean()
    if (!enrollment) return res.status(404).json({ message: 'The submission was not found.' })
    const course = await Course.findById(submission.courseId)
      .select('assignments._id assignments.title assignments.description assignments.points modules.contentItems._id modules.contentItems.type modules.contentItems.title modules.contentItems.description modules.contentItems.content modules.contentItems.points')
      .lean()
    const assignment = getReportAssignment(course, submission.assignmentId)
    if (!assignment) return res.status(404).json({ message: 'The assignment was not found in this course.' })
    if (assignment.maximumMarks === null) {
      return res.status(409).json({ message: 'Maximum marks are unavailable for this assignment.' })
    }
    if (marksObtained > assignment.maximumMarks) {
      return res.status(400).json({ message: 'Marks cannot exceed the assignment maximum.' })
    }
    const evaluatedAt = new Date()
    const evaluation = {
      marksObtained,
      feedback: feedback.trim(),
      correctness,
      evaluationStatus: evaluationStatus || 'evaluated',
      evaluatedAt,
      evaluatorId: new mongoose.Types.ObjectId(req.auth.id),
    }
    const updatedSubmission = await AssignmentSubmission.findOneAndUpdate(
      { _id: submission._id },
      {
        $set: {
          marksObtained,
          feedback: evaluation.feedback,
          correctness,
          evaluationStatus: evaluation.evaluationStatus,
          evaluatedAt,
          evaluatorId: evaluation.evaluatorId,
        },
        $push: { evaluationHistory: evaluation },
      },
      { new: true, runValidators: true },
    ).select('-fileData').lean()
    if (!updatedSubmission) return res.status(404).json({ message: 'The submission was not found.' })
    return res.json({ submission: getReportSubmission(updatedSubmission, course) })
  } catch (error) {
    return next(error)
  }
})

router.get('/reports/progress/:studentType/:studentId', ...requireAdmin, async (req, res, next) => {
  try {
    const { studentType, studentId } = req.params
    if (!mongoose.isValidObjectId(studentId) || !['independent', 'college'].includes(studentType)) {
      return res.status(400).json({ message: 'Select a valid student.' })
    }
    const AccountModel = studentType === 'college' ? CollegeStudent : Student
    const student = await AccountModel.findOne({
      _id: studentId,
      role: 'student',
    }).select('fullName username email studentId studentType collegeId').lean()
    if (!student) return res.status(404).json({ message: 'The student was not found.' })

    const enrollmentFilter = {
      userId: student._id,
      status: { $ne: 'cancelled' },
      ...(studentType === 'college'
        ? { collegeId: student.collegeId }
        : { $or: [{ collegeId: { $exists: false } }, { collegeId: null }] }),
    }
    const enrollmentRecords = await Enrollment.find(enrollmentFilter)
      .sort({ createdAt: -1 })
      .lean()
    const latestEnrollments = []
    const seenCourses = new Set()
    for (const enrollment of enrollmentRecords) {
      const courseId = String(enrollment.courseId || '')
      if (!courseId || seenCourses.has(courseId)) continue
      seenCourses.add(courseId)
      latestEnrollments.push(enrollment)
    }
    const courseIds = [...new Set(latestEnrollments.map(({ courseId }) => String(courseId)).filter(Boolean))]
    const enrollmentIds = latestEnrollments.map(({ _id }) => _id)
    const certificateFilter = {
      $or: [
        {
          studentId: student._id,
          studentType,
          ...(studentType === 'college'
            ? { collegeId: student.collegeId }
            : { collegeId: { $exists: false } }),
        },
        { userId: student._id },
      ],
    }
    const [courses, quizAttempts, assignmentSubmissions, college, certificates] = await Promise.all([
      courseIds.length
        ? Course.find({ _id: { $in: courseIds } })
          .select([
            'title',
            'modules.lessons._id',
            'modules.lessons.title',
            'modules.contentItems._id',
            'modules.contentItems.title',
            'modules.contentItems.type',
            'modules.quiz._id',
            'modules.quiz.title',
            'modules.contentItems.quiz._id',
            'modules.contentItems.quiz.title',
            'quizzes._id',
            'quizzes.title',
            'assignments._id',
            'assignments.title',
            'assignments.description',
            'assignments.points',
            'modules.contentItems._id',
            'modules.contentItems.type',
            'modules.contentItems.title',
            'modules.contentItems.description',
            'modules.contentItems.content',
            'modules.contentItems.points',
          ].join(' '))
          .lean()
        : Promise.resolve([]),
      enrollmentIds.length
        ? QuizAttempt.find({
          userId: student._id,
          enrollmentId: { $in: enrollmentIds },
        })
          .select('enrollmentId userId courseId quizId status startedAt submittedAt createdAt earnedPoints totalPoints scorePercentage correctAnswers passed answers +questionSnapshot')
          .sort({ createdAt: -1 })
          .lean()
        : Promise.resolve([]),
      enrollmentIds.length
        ? AssignmentSubmission.find({
          userId: student._id,
          enrollmentId: { $in: enrollmentIds },
          courseId: { $in: courseIds },
          ...(studentType === 'college'
            ? { collegeId: student.collegeId }
            : { $or: [{ collegeId: { $exists: false } }, { collegeId: null }] }),
        })
          .select('enrollmentId userId collegeId courseId assignmentId fileName contentType fileSize submittedAt marksObtained evaluationStatus correctness feedback evaluatedAt evaluatorId evaluationHistory')
          .sort({ submittedAt: -1 })
          .lean()
        : Promise.resolve([]),
      studentType === 'college'
        ? College.findById(student.collegeId).select('name').lean()
        : Promise.resolve(null),
      Certificate.find(certificateFilter).lean(),
    ])
    const legacyCertificates = certificates.filter((certificate) => (
      !certificate.studentId || !certificate.studentType
    ))
    const legacyEnrollmentIds = [...new Set(legacyCertificates
      .map(({ enrollmentId }) => String(enrollmentId || ''))
      .filter(Boolean))]
    const legacyEnrollments = legacyEnrollmentIds.length
      ? await Enrollment.find({
        _id: { $in: legacyEnrollmentIds },
        userId: student._id,
        ...(studentType === 'college'
          ? { collegeId: student.collegeId }
          : { $or: [{ collegeId: { $exists: false } }, { collegeId: null }] }),
      })
        .select('_id courseId')
        .lean()
      : []
    const legacyEnrollmentsById = new Map(
      legacyEnrollments.map((enrollment) => [String(enrollment._id), enrollment]),
    )
    const reportCertificates = certificates.filter((certificate) => {
      if (certificate.studentId && certificate.studentType) {
        return certificate.studentType === studentType
          && String(certificate.studentId) === String(student._id)
      }
      const enrollment = legacyEnrollmentsById.get(String(certificate.enrollmentId || ''))
      return String(certificate.userId) === String(student._id)
        && enrollment
        && String(enrollment.courseId) === String(certificate.courseId)
    })
    const coursesById = new Map(courses.map((course) => [String(course._id), course]))
    const enrollmentsById = new Map(latestEnrollments.map((enrollment) => [String(enrollment._id), enrollment]))
    const relatedQuizAttempts = quizAttempts.filter((attempt) => {
      const enrollment = enrollmentsById.get(String(attempt.enrollmentId))
      return enrollment
        && String(attempt.userId) === String(student._id)
        && String(attempt.courseId) === String(enrollment.courseId)
        && (studentType === 'college'
          ? String(enrollment.collegeId) === String(student.collegeId)
            && (!attempt.collegeId || String(attempt.collegeId) === String(student.collegeId))
          : !enrollment.collegeId && !attempt.collegeId)
    })
    const relatedSubmissions = assignmentSubmissions.filter((submission) => {
      const enrollment = enrollmentsById.get(String(submission.enrollmentId))
      return enrollment
        && String(submission.userId) === String(student._id)
        && String(submission.courseId) === String(enrollment.courseId)
        && (studentType === 'college'
          ? String(enrollment.collegeId) === String(student.collegeId)
            && (!submission.collegeId || String(submission.collegeId) === String(student.collegeId))
          : !enrollment.collegeId && !submission.collegeId)
    })
    const courseMarksByEnrollment = new Map()
    const courseProgress = latestEnrollments.map((enrollment) => {
      const course = coursesById.get(String(enrollment.courseId))
      const progress = getReportCourseProgress(enrollment, course)
      const enrollmentQuizAttempts = relatedQuizAttempts.filter(
        (attempt) => String(attempt.enrollmentId) === String(enrollment._id),
      )
      const enrollmentSubmissions = relatedSubmissions.filter(
        (submission) => String(submission.enrollmentId) === String(enrollment._id),
      )
      const courseMarks = calculateCourseMarksSummary(enrollmentQuizAttempts, enrollmentSubmissions, course)
      courseMarksByEnrollment.set(String(enrollment._id), courseMarks)
      const completedIds = new Set((enrollment.completedLessonIds || []).map(String))
      const startedIds = new Set((enrollment.startedLessonIds || []).map(String))
      const completionDates = enrollment.lessonCompletionDates instanceof Map
        ? enrollment.lessonCompletionDates
        : new Map(Object.entries(enrollment.lessonCompletionDates || {}))
      const courseQuizAttempts = relatedQuizAttempts
        .filter((attempt) => String(attempt.enrollmentId) === String(enrollment._id))
        .map((attempt) => ({
          id: String(attempt._id),
          quizId: String(attempt.quizId),
          quizName: getReportQuizTitle(course, attempt.quizId) || 'Quiz unavailable',
          status: attempt.status,
          startedAt: attempt.startedAt || null,
          submittedAt: attempt.submittedAt || null,
          questionCount: attempt.questionSnapshot?.length
            || attempt.answers?.length
            || 0,
          correctAnswers: Number.isFinite(attempt.correctAnswers) ? attempt.correctAnswers : null,
          earnedPoints: Number.isFinite(attempt.earnedPoints) ? attempt.earnedPoints : null,
          totalPoints: Number.isFinite(attempt.totalPoints) ? attempt.totalPoints : null,
          scorePercentage: Number.isFinite(attempt.scorePercentage)
            ? attempt.scorePercentage
            : Number.isFinite(attempt.earnedPoints) && Number.isFinite(attempt.totalPoints) && attempt.totalPoints > 0
              ? Math.round((attempt.earnedPoints / attempt.totalPoints) * 100)
              : null,
          passed: typeof attempt.passed === 'boolean' ? attempt.passed : null,
          questions: (attempt.questionSnapshot || []).map((question) => ({
            questionId: String(question.questionId),
            prompt: question.prompt,
            type: question.type,
            options: question.options || [],
            correctOptionIndices: question.correctOptionIndices || [],
            marks: Number.isFinite(question.marks) ? question.marks : null,
            explanation: question.explanation || '',
          })),
          answers: (attempt.answers || []).map((answer) => ({
            questionId: String(answer.questionId),
            selectedOptionIndices: answer.selectedOptionIndices || [],
            correctOptionIndices: answer.correctOptionIndices || [],
            explanation: answer.explanation || '',
          })),
        }))
      const courseSubmissions = relatedSubmissions
        .filter((submission) => String(submission.enrollmentId) === String(enrollment._id))
        .map((submission) => getReportSubmission(submission, course))
        .filter(Boolean)
      return {
        enrollmentId: String(enrollment._id),
        courseId: String(enrollment.courseId),
        courseName: course?.title || 'Course unavailable',
        enrolledAt: enrollment.createdAt || null,
        status: progress.status,
        completionPercent: progress.completionPercent,
        completedLessonCount: progress.completedLessons.length,
        pendingLessonCount: progress.pendingLessons.length,
        totalLessonCount: progress.lessons.length,
        lessons: progress.lessons.map(({ id, title }) => {
          const completedAt = completionDates.get(id) || null
          return {
            id,
            title,
            status: completedIds.has(id) ? 'completed' : startedIds.has(id) ? 'in_progress' : 'not_started',
            completedAt: completedIds.has(id) ? completedAt : null,
          }
        }),
        completedLessons: progress.completedLessons.map(({ id, title }) => ({ id, title })),
        pendingLessons: progress.pendingLessons.map(({ id, title }) => ({ id, title })),
        quizAttempts: courseQuizAttempts,
        submissions: courseSubmissions,
        assignmentSummary: (() => {
          const assignmentIds = new Set(getReportAssignments(course).map(({ _id }) => String(_id)))
          if (!assignmentIds.size) return null
          const submittedAssignmentIds = new Set(courseSubmissions.map(({ assignmentId }) => assignmentId))
          return {
            submittedCount: [...submittedAssignmentIds].filter((id) => assignmentIds.has(id)).length,
            totalCount: assignmentIds.size,
          }
        })(),
        marksSummary: courseMarks.summary,
      }
    })
    const trackedCourses = courseProgress.filter(({ completionPercent }) => completionPercent !== null)
    const courseMarkCalculations = [...courseMarksByEnrollment.values()]
    const courseMarks = courseMarkCalculations.map(({ summary }) => summary).filter(Boolean)
    const performanceAmbiguous = courseMarkCalculations.some(({ ambiguous }) => ambiguous)
    const performanceHasResults = courseMarkCalculations.some(({ hasResults }) => hasResults)
    const overallPerformance = !performanceHasResults || performanceAmbiguous
      ? null
      : (() => {
        const marksObtained = courseMarks.reduce((sum, marks) => sum + marks.marksObtained, 0)
        const maximumMarks = courseMarks.reduce((sum, marks) => sum + marks.maximumMarks, 0)
        return {
          marksObtained,
          maximumMarks,
          percentage: maximumMarks > 0 ? Math.round((marksObtained / maximumMarks) * 100) : null,
        }
      })()
    const quizResults = relatedQuizAttempts.map((attempt) => {
      const course = coursesById.get(String(attempt.courseId))
      const scorePercentage = Number.isFinite(attempt.scorePercentage)
        ? attempt.scorePercentage
        : Number.isFinite(attempt.earnedPoints) && Number.isFinite(attempt.totalPoints) && attempt.totalPoints > 0
          ? Math.round((attempt.earnedPoints / attempt.totalPoints) * 100)
          : null
      return {
        id: String(attempt._id),
        courseName: course?.title || 'Course unavailable',
        quizName: getReportQuizTitle(course, attempt.quizId) || 'Quiz unavailable',
        status: attempt.status,
        scorePercentage,
        earnedPoints: Number.isFinite(attempt.earnedPoints) ? attempt.earnedPoints : null,
        totalPoints: Number.isFinite(attempt.totalPoints) ? attempt.totalPoints : null,
        passed: typeof attempt.passed === 'boolean' ? attempt.passed : null,
        startedAt: attempt.startedAt || null,
        submittedAt: attempt.submittedAt || null,
      }
    })
    const progressHistory = []
    for (const [index, enrollment] of latestEnrollments.entries()) {
      const course = coursesById.get(String(enrollment.courseId))
      const courseName = course?.title || 'Course unavailable'
      const lessonsById = new Map(getReportCourseLessons(course).map((lesson) => [lesson.id, lesson]))
      if (enrollment.createdAt) {
        progressHistory.push({
          type: 'Course enrolled',
          title: `Enrolled in ${courseName}`,
          courseName,
          date: enrollment.createdAt,
          key: `enrollment:${index}`,
        })
      }
      const completedIds = new Set((enrollment.completedLessonIds || []).map(String))
      const completionDates = enrollment.lessonCompletionDates instanceof Map
        ? [...enrollment.lessonCompletionDates.entries()]
        : Object.entries(enrollment.lessonCompletionDates || {})
      for (const [lessonId, completedAt] of completionDates) {
        const lesson = lessonsById.get(String(lessonId))
        if (!lesson || !completedIds.has(String(lessonId)) || !completedAt) continue
        progressHistory.push({
          type: 'Lesson completed',
          title: lesson.title,
          courseName,
          date: completedAt,
          key: `lesson:${enrollment._id}:${lessonId}`,
        })
      }
    }
    for (const attempt of relatedQuizAttempts) {
      const courseName = coursesById.get(String(attempt.courseId))?.title || 'Course unavailable'
      if (attempt.startedAt) {
        progressHistory.push({
          type: 'Quiz started',
          title: getReportQuizTitle(coursesById.get(String(attempt.courseId)), attempt.quizId) || 'Quiz unavailable',
          courseName,
          date: attempt.startedAt,
          key: `quiz-start:${attempt._id}`,
        })
      }
      if (attempt.submittedAt) {
        progressHistory.push({
          type: 'Quiz submitted',
          title: getReportQuizTitle(coursesById.get(String(attempt.courseId)), attempt.quizId) || 'Quiz unavailable',
          courseName,
          date: attempt.submittedAt,
          key: `quiz-submit:${attempt._id}`,
        })
      }
    }
    progressHistory.sort((left, right) => new Date(right.date) - new Date(left.date))

    return res.json({
      student: {
        id: String(student._id),
        name: student.fullName || student.username || '',
        email: student.email || '',
        studentId: student.studentId || '',
        studentType,
        collegeName: college?.name || null,
      },
      summary: {
        enrolledCourses: courseProgress.length,
        completedCourses: courseProgress.filter(({ status }) => status === 'completed').length,
        inProgressCourses: courseProgress.filter(({ status }) => status === 'in_progress').length,
        notStartedCourses: courseProgress.filter(({ status }) => status === 'not_started').length,
        overallCompletionPercent: trackedCourses.length
          ? Math.round(trackedCourses.reduce((sum, course) => sum + course.completionPercent, 0) / trackedCourses.length)
          : null,
      },
      overallPerformance,
      courseProgress,
      quizResults,
      progressHistory,
      certificates: reportCertificates.map((certificate) => ({
        id: String(certificate._id),
        certificateId: certificate.certificateId,
        name: certificate.name || `${certificate.courseName} Certificate of Completion`,
        courseId: String(certificate.courseId),
        courseName: certificate.courseName,
        issuedAt: certificate.issuedAt || certificate.completedAt || certificate.createdAt,
        viewUrl: certificate.viewUrl || `/certificates/${certificate.certificateId}/view`,
        downloadUrl: certificate.downloadUrl || `/certificates/${certificate.certificateId}/download`,
      })).sort((left, right) => new Date(right.issuedAt) - new Date(left.issuedAt)),
      certificateRecordsAvailable: true,
    })
  } catch (error) {
    return next(error)
  }
})
router.get('/reports', ...requireAdmin, async (req, res, next) => {
  try {
    const { type, collegeId, studentId, accountCollection } = req.query
    const validTypes = new Set(['college', 'student', 'college_students', 'all'])
    if (typeof type !== 'string' || !validTypes.has(type)) {
      return res.status(400).json({ message: 'Select a supported report type.' })
    }

    const pageValue = typeof req.query.page === 'string' ? req.query.page : '0'
    if (!/^\d+$/.test(pageValue) || Number(pageValue) > 100000) {
      return res.status(400).json({ message: 'Select a valid report page.' })
    }
    const page = Number(pageValue)
    let college
    if (type === 'college' || type === 'college_students') {
      if (typeof collegeId !== 'string' || !mongoose.isValidObjectId(collegeId)) {
        return res.status(400).json({ message: 'Select a valid college for this report.' })
      }
      college = await College.findById(collegeId).select('name code status contactName contactEmail contactPhone').lean()
      if (!college) return res.status(404).json({ message: 'The selected college was not found.' })
    }

    let studentPages = []
    let hasMore = false
    if (type === 'student') {
      if (
        typeof studentId !== 'string' ||
        !mongoose.isValidObjectId(studentId) ||
        !['students', 'clg_students'].includes(accountCollection)
      ) {
        return res.status(400).json({ message: 'Select a valid student.' })
      }
      const StudentModel = accountCollection === Student.collection.name ? Student : CollegeStudent
      const student = await StudentModel.findById(studentId)
        .select('fullName username email status studentType collegeId createdAt role')
        .lean()
      if (!student || student.role !== 'student') {
        return res.status(404).json({ message: 'The selected student was not found.' })
      }
      studentPages = [{ student, studentType: accountCollection === 'students' ? 'independent' : 'college' }]
    } else {
      const collegeStudentFilter = {
        role: 'student',
        ...(college ? { collegeId: college._id } : {}),
      }
      const [independentPage, collegePage] = await Promise.all([
        type === 'all'
          ? Student.find({ role: 'student' })
            .select('fullName username email status studentType createdAt')
            .sort({ createdAt: 1, _id: 1 })
            .skip(page * reportPageSize)
            .limit(reportPageSize + 1)
            .lean()
          : Promise.resolve([]),
        CollegeStudent.find(collegeStudentFilter)
          .select('fullName username email status studentType collegeId createdAt')
          .sort({ createdAt: 1, _id: 1 })
          .skip(page * reportPageSize)
          .limit(reportPageSize + 1)
          .lean(),
      ])
      const independentHasMore = type === 'all' && independentPage.length > reportPageSize
      const collegeHasMore = collegePage.length > reportPageSize
      hasMore = independentHasMore || collegeHasMore
      studentPages = [
        ...independentPage.slice(0, reportPageSize).map((student) => ({ student, studentType: 'independent' })),
        ...collegePage.slice(0, reportPageSize).map((student) => ({ student, studentType: 'college' })),
      ]
    }

    const independentIds = studentPages
      .filter(({ studentType }) => studentType === 'independent')
      .map(({ student }) => student._id)
    const collegeStudents = studentPages.filter(({ studentType }) => studentType === 'college')
    const collegeStudentIds = collegeStudents.map(({ student }) => student._id)
    const enrollmentQuery = (filter) => Enrollment.find(filter)
      .populate('courseId', 'title')
      .populate('collegeId', 'name code')
      .lean()
    const [independentEnrollments, collegeEnrollments, studentColleges] = await Promise.all([
      independentIds.length
        ? enrollmentQuery({
          userId: { $in: independentIds },
          $or: [{ collegeId: { $exists: false } }, { collegeId: null }],
        })
        : Promise.resolve([]),
      collegeStudentIds.length
        ? enrollmentQuery({
          userId: { $in: collegeStudentIds },
          ...(college ? { collegeId: college._id } : { collegeId: { $exists: true, $ne: null } }),
        })
        : Promise.resolve([]),
      collegeStudentIds.length
        ? College.find({
          _id: { $in: [...new Set(collegeStudents.map(({ student }) => String(student.collegeId)))]
            .filter(Boolean)
            .map((id) => new mongoose.Types.ObjectId(id)) },
        }).select('name code').lean()
        : Promise.resolve([]),
    ])
    const collegesById = new Map(studentColleges.map((item) => [String(item._id), item]))
    const enrollmentsByStudent = new Map()
    for (const enrollment of [...independentEnrollments, ...collegeEnrollments]) {
      const studentType = enrollment.collegeId ? 'college' : 'independent'
      const key = `${studentType}:${String(enrollment.userId)}`
      const enrollments = enrollmentsByStudent.get(key) || []
      enrollments.push(enrollment)
      enrollmentsByStudent.set(key, enrollments)
    }

    const rows = studentPages.flatMap(({ student, studentType }) => {
      const studentIdValue = String(student._id)
      const studentCollege = student.collegeId
        ? collegesById.get(String(student.collegeId))
        : undefined
      const enrollments = enrollmentsByStudent.get(`${studentType}:${studentIdValue}`) || []
      const records = enrollments.length ? enrollments : [null]
      return records.map((enrollment) => ({
        recordType: 'Student',
        studentId: studentIdValue,
        studentName: student.fullName || student.username || '',
        studentEmail: student.email || '',
        studentType,
        studentStatus: student.status || '',
        registeredAt: student.createdAt || '',
        collegeId: student.collegeId ? String(student.collegeId) : '',
        collegeName: enrollment?.collegeId?.name || studentCollege?.name || '',
        collegeCode: enrollment?.collegeId?.code || studentCollege?.code || '',
        courseId: enrollment?.courseId?._id ? String(enrollment.courseId._id) : '',
        courseTitle: enrollment?.courseId?.title || '',
        enrollmentStatus: enrollment?.status || '',
        enrolledAt: enrollment?.createdAt || '',
      }))
    })

    let summary
    if (college && page === 0) {
      const [studentCount, subAdminCount, enrollmentCount] = await Promise.all([
        CollegeStudent.countDocuments({ role: 'student', collegeId: college._id }),
        CollegeAdmin.countDocuments({ role: 'college_admin', collegeId: college._id }),
        Enrollment.countDocuments({ collegeId: college._id }),
      ])
      summary = {
        collegeId: String(college._id),
        collegeName: college.name,
        collegeCode: college.code,
        collegeStatus: college.status || 'active',
        contactName: college.contactName || '',
        contactEmail: college.contactEmail || '',
        contactPhone: college.contactPhone || '',
        totalCollegeStudents: studentCount,
        totalSubAdmins: subAdminCount,
        totalEnrollments: enrollmentCount,
      }
    }

    return res.json({ type, page, hasMore, summary, rows })
  } catch (error) {
    return next(error)
  }
})
router.post('/students/import/preview', ...requireAdmin, async (req, res, next) => {
  try {
    const { csvText, collegeId } = req.body ?? {}
    if (typeof collegeId !== 'string' || !/^[a-f\d]{24}$/i.test(collegeId)) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    const selectedCollegeId = new mongoose.Types.ObjectId(collegeId)
    const college = await mongoose.connection.db.collection('colleges')
      .findOne({ _id: selectedCollegeId }, { projection: { _id: 1 } })
    if (!college) return res.status(400).json({ message: 'The selected college does not exist.' })

    let rows
    try {
      rows = parseStudentCsv(csvText)
    } catch (error) {
      return res.status(400).json({ message: error.message })
    }
    if (rows.length > 500) {
      return res.status(400).json({ message: 'Import is limited to 500 students per file.' })
    }

    const studentLimit = await configuredCollegeStudentLimit(selectedCollegeId)
    const registeredStudents = studentLimit === null
      ? null
      : await registeredCollegeStudentCount(selectedCollegeId)
    const remainingSlots = studentLimit === null
      ? null
      : Math.max(0, studentLimit - registeredStudents)
    let validRowsWithinLimit = 0
    const seenEmails = new Set()
    const seenStudentIds = new Set()
    const preview = []
    for (const row of rows) {
      const { fullName = '', studentId = '', email = '', department = '', batch = '' } = row
      const normalizedEmail = email.toLowerCase()
      const normalizedStudentId = studentId.toLowerCase()
      const username = studentId ? makeImportUsername(studentId) : ''
      const errors = []
      if (row.error) errors.push(row.error)
      if (!fullName || fullName.length > 120) errors.push('Full Name is required and must be 120 characters or fewer.')
      if (!studentId || studentId.length > 100) errors.push('Student ID is required and must be 100 characters or fewer.')
      if (!emailPattern.test(email) || email.length > 254) errors.push('Enter a valid email address.')
      if (!department || department.length > 120) errors.push('Department is required and must be 120 characters or fewer.')
      if (!batch || batch.length > 80) errors.push('Batch is required and must be 80 characters or fewer.')
      if (seenEmails.has(normalizedEmail)) errors.push('Email is duplicated in this file.')
      if (seenStudentIds.has(normalizedStudentId)) errors.push('Student ID is duplicated in this file.')
      if (email) seenEmails.add(normalizedEmail)
      if (studentId) seenStudentIds.add(normalizedStudentId)
      if (!errors.length) {
        const [existingEmail, existingStudentId, existingUsername] = await Promise.all([
          accountIdentifierExists('email', normalizedEmail),
          CollegeStudent.findOne({ studentId }).collation({ locale: 'en', strength: 2 }).select('_id').lean(),
          accountIdentifierExists('username', username),
        ])
        if (existingEmail) errors.push('Email already belongs to an LMS account.')
        if (existingStudentId) errors.push('Student ID already exists.')
        if (existingUsername) errors.push('Generated username conflicts with an LMS account.')
      }
      if (!errors.length && remainingSlots !== null) {
        if (validRowsWithinLimit >= remainingSlots) {
          errors.push(`The configured student limit of ${studentLimit} has been reached.`)
        } else {
          validRowsWithinLimit += 1
        }
      }
      preview.push({
        row: row.rowNumber,
        fullName,
        studentId,
        email,
        department,
        batch,
        errors,
      })
    }
    return res.json({
      preview,
      summary: {
        total: preview.length,
        valid: preview.filter((row) => row.errors.length === 0).length,
        invalid: preview.filter((row) => row.errors.length > 0).length,
      },
    })
  } catch (error) {
    return next(error)
  }
})
router.get('/engagement', ...requireAdmin, async (req, res, next) => {
  try {
    const period = req.query.period ?? '30d'
    const periods = {
      '7d': { days: 7, granularity: 'day' },
      '30d': { days: 30, granularity: 'day' },
      '3m': { months: 3, granularity: 'month' },
      '6m': { months: 6, granularity: 'month' },
    }
    if (typeof period !== 'string' || !Object.hasOwn(periods, period)) {
      return res.status(400).json({ message: 'Select a supported engagement period.' })
    }

    const now = new Date()
    const { days, months, granularity } = periods[period]
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    if (days) {
      start.setUTCDate(start.getUTCDate() - days + 1)
    } else {
      start.setUTCDate(1)
      start.setUTCMonth(start.getUTCMonth() - months + 1)
    }

    const format = granularity === 'day' ? '%Y-%m-%d' : '%Y-%m'
    const engagement = await Enrollment.aggregate([
      { $match: { createdAt: { $gte: start, $lte: now } } },
      {
        $group: {
          _id: { $dateToString: { format, date: '$createdAt', timezone: 'UTC' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])

    return res.json({
      period,
      granularity,
      engagement: engagement.map(({ _id, count }) => ({ date: _id, count })),
    })
  } catch (error) {
    return next(error)
  }
})
export default router
