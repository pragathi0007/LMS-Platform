import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { openAsBlob } from 'node:fs'
import { open, unlink } from 'node:fs/promises'
import mongoose from 'mongoose'
import path from 'node:path'
import cloudinary from '../config/cloudinary.js'
import { config } from '../config/env.js'
import AccountIdentity from '../models/AccountIdentity.js'
import College from '../models/College.js'
import Course from '../models/Course.js'
import Enrollment from '../models/Enrollment.js'
import {
  CollegeAdmin,
  CollegeStudent,
  Student,
  accountModelsByCollection,
} from '../models/account-models.js'
import { authenticate, requireRoles } from '../middleware/auth.js'
import { receiveCourseResource, receiveCourseVideo } from '../middleware/course-media-upload.js'
import { normalizeCourseDetails } from '../utils/course-validation.js'
import { sendCollegeAdminActivationEmail } from '../utils/email.js'
import { generateQuizQuestions } from '../utils/quiz-question-generator.js'
import { parseStudentCsv } from '../utils/student-csv.js'

const router = Router()
const requireAdmin = [authenticate, requireRoles('main_admin')]
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/
const activationLifetimeMs = 24 * 60 * 60 * 1000

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

router.get('/colleges', ...requireAdmin, async (req, res, next) => {
  try {
    const colleges = await College.find({ status: { $in: [null, 'active'] } })
      .select('name code collegeName title address city state country contactName contactPhone contactEmail status')
      .sort({ name: 1 })
      .limit(500)
      .lean()
    return res.json({
      colleges: colleges.map((college) => ({
        id: String(college._id),
        name: college.name || college.collegeName || college.title || 'Unnamed college',
        code: college.code,
        address: college.address,
        city: college.city,
        state: college.state,
        country: college.country,
        contactName: college.contactName,
        contactPhone: college.contactPhone,
        contactEmail: college.contactEmail,
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
      return res.status(400).json({ message: 'Enter a college code with 2–40 letters, numbers, or hyphens.' })
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
    const { fullName, email, username } = req.body ?? {}
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
      return res.status(400).json({ message: 'Use a username with 3–30 letters, numbers, dots, underscores, or hyphens.' })
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
          learningObjectives prerequisites estimatedDurationMinutes
          modules._id modules.title modules.description modules.order modules.lessons
          modules.quiz._id modules.quiz.title modules.quiz.passingPercentage modules.quiz.maxAttempts
          modules.quiz.timeLimitMinutes modules.quiz.questions.prompt modules.quiz.questions.type
          modules.quiz.questions.options modules.quiz.questions.marks modules.quiz.questions.order
          +modules.quiz.questions.correctOptionIndices
          modules.contentItems._id modules.contentItems.type modules.contentItems.title
          modules.contentItems.description modules.contentItems.content modules.contentItems.videoUrl
          modules.contentItems.videoPublicId modules.contentItems.videoFormat modules.contentItems.videoBytes
          modules.contentItems.durationSeconds modules.contentItems.resources modules.contentItems.dueDate
          modules.contentItems.points modules.contentItems.quiz._id modules.contentItems.quiz.title
          modules.contentItems.quiz.passingPercentage modules.contentItems.quiz.maxAttempts
          modules.contentItems.quiz.timeLimitMinutes modules.contentItems.quiz.questions.prompt
          modules.contentItems.quiz.questions.type modules.contentItems.quiz.questions.options
          modules.contentItems.quiz.questions.marks modules.contentItems.quiz.questions.order
          +modules.contentItems.quiz.questions.correctOptionIndices modules.contentItems.order
          assignments status createdAt quizzes.title quizzes.description
          quizzes.questions.prompt quizzes.questions.options +quizzes.questions.correctOptionIndex
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
    const existing = await Course.findById(courseId).select('assignments quizzes').lean()
    if (!existing) return res.status(404).json({ message: 'The course was not found.' })
    const result = normalizeCourseDetails({
      ...req.body,
      assignments: req.body?.assignments ?? existing.assignments ?? [],
      quizzes: req.body?.quizzes ?? existing.quizzes ?? [],
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
    const enrollments = await Enrollment.find({})
      .populate('userId', 'fullName email username studentType collegeId')
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
        if (error?.code === 11000) {
          failures.push({ row: row.rowNumber, email, studentId, reason: 'Email, username, or Student ID already exists.' })
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
      totalCollegeStudents,
      totalCourses,
      totalEnrollments,
      recentIndependentStudents,
      recentCollegeStudents,
    ] =
      await Promise.all([
        Student.countDocuments({ role: 'student' }),
        CollegeStudent.countDocuments({ role: 'student' }),
        Course.countDocuments(),
        Enrollment.countDocuments(),
        Student.find({ role: 'student' })
          .select('fullName username email role status studentType createdAt')
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
        CollegeStudent.find({ role: 'student' })
          .select('fullName username email role status studentType collegeId createdAt')
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
      ])
    const recentRegistrations = [...recentIndependentStudents, ...recentCollegeStudents]
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, 20)

    return res.json({
      stats: {
        totalStudents: totalIndependentStudents + totalCollegeStudents,
        totalCourses,
        totalEnrollments,
      },
      recentRegistrations,
      dataAvailability: {
        courses: true,
        enrollmentActivity: Boolean(await Enrollment.exists({})),
        courseCompletion: false,
      },
    })
  } catch (error) {
    return next(error)
  }
})

export default router
