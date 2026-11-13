import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { createHash, createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { Writable } from 'node:stream'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import nodemailer from 'nodemailer'
import { OAuth2Client } from 'google-auth-library'
import { normalizeCourseDetails } from '../utils/course-validation.js'
import { generateQuizQuestions } from '../utils/quiz-question-generator.js'

process.env.JWT_SECRET = 'test-only-route-secret'
process.env.GEMINI_API_KEY = 'test-only-gemini-key'
process.env.RESEND_API_KEY = 'test-only-resend-key'
process.env.EMAIL_FROM = 'Morrow Learning <security@example.invalid>'
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
process.env.CLOUDINARY_API_KEY = 'test-cloudinary-key'
process.env.CLOUDINARY_API_SECRET = 'test-only-cloudinary-secret'
process.env.COURSE_VIDEO_MAX_BYTES = '128'
process.env.COURSE_RESOURCE_MAX_BYTES = '128'
process.env.EMAIL_USER = 'test-mailbox@example.invalid'
process.env.EMAIL_PASS = 'test-only-gmail-app-password'
process.env.GOOGLE_CLIENT_ID = 'test-google-client.apps.googleusercontent.com'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.CLIENT_ORIGIN = 'http://localhost:5173'

const [
  { default: adminRouter },
  { default: learningRouter },
  { default: authRouter },
  { default: settingsRouter },
  { default: notificationsRouter },
  { default: certificatesRouter },
  { default: supportRouter },
  { AccountIdentity },
  { accountModelsByRole, CollegeAdmin, Admin, CollegeStudent, Student, matchesStoredAccountRole },
  { default: College },
  { default: Course },
  { default: Enrollment },
  { default: AssignmentSubmission },
  { default: QuizAttempt },
  { default: ReferralCode },
  { default: Notification },
  { default: EmailOtpChallenge },
  { default: RegistrationEmailVerification },
  { default: Certificate },
  { default: SupportTicket },
  { default: QuizAttemptState },
  { default: VideoAttentionResponse },
  { default: CertificateTemplate },
  { default: RefreshSession },
] = await Promise.all([
  import('../routes/admin.js'),
  import('../routes/learning.js'),
  import('../routes/auth.js'),
  import('../routes/settings.js'),
  import('../routes/notifications.js'),
  import('../routes/certificates.js'),
  import('../routes/support.js'),
  import('../models/AccountIdentity.js').then((module) => ({ AccountIdentity: module.default })),
  import('../models/account-models.js'),
  import('../models/College.js'),
  import('../models/Course.js'),
  import('../models/Enrollment.js'),
  import('../models/AssignmentSubmission.js'),
  import('../models/QuizAttempt.js'),
  import('../models/ReferralCode.js'),
  import('../models/Notification.js'),
  import('../models/EmailOtpChallenge.js'),
  import('../models/RegistrationEmailVerification.js'),
  import('../models/Certificate.js'),
  import('../models/SupportTicket.js'),
  import('../models/QuizAttemptState.js'),
  import('../models/VideoAttentionResponse.js'),
  import('../models/CertificateTemplate.js'),
  import('../models/RefreshSession.js'),
])

const app = express()
app.set('trust proxy', true)
app.use(express.json())
app.use('/api/admin', adminRouter)
app.use('/api/auth', authRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/certificates', certificatesRouter)
app.use('/api/support', supportRouter)
app.use('/api', learningRouter)
const server = app.listen(0)
await new Promise((resolve) => server.once('listening', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}/api`
const { default: cloudinary } = await import('../config/cloudinary.js')
const nativeFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  if (String(url) === 'https://api.resend.com/emails') {
    return { ok: true, status: 200, json: async () => ({ id: 'test-email-id' }) }
  }
  return nativeFetch(url, options)
}

test('stored account roles match canonical collections', () => {
  assert.equal(matchesStoredAccountRole('admin', 'main_admin'), true)
  assert.equal(matchesStoredAccountRole('admin', 'admin'), false)
  assert.equal(matchesStoredAccountRole('admin', 'student'), false)
  assert.equal(matchesStoredAccountRole('students', 'student'), true)
  assert.equal(matchesStoredAccountRole('students', 'user'), false)
  assert.equal(matchesStoredAccountRole('clg_students', 'student'), true)
})
test('notification feed is authenticated and scoped to the current account role and ID', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000020'
  const filters = []
  const restores = [
    stub(Admin, 'findById', async (id) => ({
      _id: id, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findById', async (id) => ({
      _id: id, role: 'student', studentType: 'independent', status: 'active',
      approvalStatus: 'approved', isActive: true,
    })),
    stub(Notification, 'find', (filter) => {
      filters.push(filter)
      return {
        sort() { return this },
        limit() { return this },
        lean: async () => [],
      }
    }),
  ]
  try {
    const adminResponse = await request('/notifications/me', {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(adminResponse.status, 200)

    const studentResponse = await request('/notifications/me', {
      role: 'student',
      subject: studentId,
    })
    assert.equal(studentResponse.status, 200)
    assert.deepEqual(filters, [
      { recipientRole: 'main_admin' },
      { recipientRole: 'student', recipientId: studentId },
    ])
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('main admins can update ticket priority and preserve its change history', async () => {
  const adminId = '68a000000000000000000010'
  const ticket = {
    ticketId: 'LMS-TEST-PRIORITY',
    priority: 'Low',
    priorityHistory: [],
    save: async function saveTicket() { return this },
  }
  const restores = [
    stub(Admin, 'findById', async (id) => ({
      _id: id,
      role: 'main_admin',
      status: 'active',
      isActive: true,
      permissions: ['*'],
    })),
    stub(SupportTicket, 'findOne', (filter) => {
      assert.deepEqual(filter, { ticketId: ticket.ticketId })
      return queryResult(ticket)
    }),
  ]
  try {
    const response = await request(`/support/admin/tickets/${ticket.ticketId}/priority`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { priority: 'High' },
    })
    const result = await response.json()

    assert.equal(response.status, 200, JSON.stringify(result))
    assert.equal(result.ticket.priority, 'High')
    assert.equal(result.ticket.priorityHistory.length, 1)
    assert.equal(result.ticket.priorityHistory[0].from, 'Low')
    assert.equal(result.ticket.priorityHistory[0].to, 'High')
    assert.equal(result.ticket.priorityHistory[0].changedBy, adminId)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

after(async () => {
  globalThis.fetch = nativeFetch
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

function stub(target, name, implementation) {
  const original = target[name]
  target[name] = implementation
  return () => { target[name] = original }
}

function tokenFor(role, subject, accountCollection) {
  const collection = accountCollection || {
    main_admin: 'admin',
    college_admin: 'sub_admins',
    student: 'students',
  }[role]
  return jwt.sign({ role, accountCollection: collection }, process.env.JWT_SECRET, { subject, expiresIn: '5m' })
}

function queryResult(value) {
  const result = Promise.resolve(value)
  result.select = () => result
  result.sort = () => result
  result.limit = () => result
  result.skip = () => result
  result.populate = () => result
  result.lean = () => result
  result.session = () => result
  result.collation = () => result
  return result
}

function stubDatabase(database) {
  const original = mongoose.connection.db
  mongoose.connection.db = database
  return () => { mongoose.connection.db = original }
}

async function request(path, { role, subject, accountCollection, token, body, method, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      ...(token || role ? { Authorization: `Bearer ${token || tokenFor(role, subject, accountCollection)}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

async function mediaRequest(path, { role = 'main_admin', subject = '68a000000000000000000010', fileName, mimeType, contents } = {}) {
  const form = new FormData()
  form.append('file', new Blob([contents], { type: mimeType }), fileName)
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenFor(role, subject)}` },
    body: form,
  })
}

async function uploadCertificateTemplate({ subject, fileName, contents }) {
  const form = new FormData()
  form.append('template', new Blob([contents], { type: 'image/png' }), fileName)
  return fetch(`${baseUrl}/admin/certificate-template`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenFor('main_admin', subject)}` },
    body: form,
  })
}

async function studentAssignmentUpload(path, { studentId, fileName, mimeType, contents }) {
  const form = new FormData()
  form.append('file', new Blob([contents], { type: mimeType }), fileName)
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenFor('student', studentId)}` },
    body: form,
  })
}

function challengeMatches(challenge, filter) {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = challenge[key]
    if (expected === null) {
      if (actual != null) return false
      continue
    }
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !mongoose.isValidObjectId(expected)) {
      if ('$lt' in expected && !(actual < expected.$lt)) return false
      if ('$gt' in expected && !(actual > expected.$gt)) return false
      if ('$ne' in expected && actual === expected.$ne) return false
      continue
    }
    if (actual instanceof Date && expected instanceof Date) {
      if (actual.getTime() !== expected.getTime()) return false
    } else if (['_id', 'studentId'].includes(key)) {
      if (String(actual) !== String(expected)) return false
    } else if (actual !== expected) {
      return false
    }
  }
  return true
}

function installRegistrationEmailVerificationTestDoubles() {
  const documents = new Map()
  const restores = [
    stub(RegistrationEmailVerification.prototype, 'save', async function saveVerification() {
      if (!this.createdAt) this.createdAt = new Date()
      documents.set(String(this._id), this)
      return this
    }),
    stub(RegistrationEmailVerification, 'findOne', (filter) => queryResult(
      [...documents.values()].find((document) => challengeMatches(document, filter)) || null,
    )),
    stub(RegistrationEmailVerification, 'findOneAndUpdate', async (filter, update) => {
      const document = [...documents.values()].find((item) => challengeMatches(item, filter))
      if (!document) return null
      for (const [key, value] of Object.entries(update.$set || {})) document[key] = value
      for (const [key, value] of Object.entries(update.$inc || {})) document[key] += value
      return document
    }),
    stub(RegistrationEmailVerification, 'updateOne', async (filter, update) => {
      const document = [...documents.values()].find((item) => challengeMatches(item, filter))
      if (!document) return { matchedCount: 0 }
      for (const [key, value] of Object.entries(update.$set || {})) document[key] = value
      return { matchedCount: 1 }
    }),
  ]
  return {
    documents,
    restore: () => restores.reverse().forEach((restore) => restore()),
  }
}

function installOtpTestDoubles() {
  const documents = new Map()
  const restores = [
    stub(EmailOtpChallenge.prototype, 'save', async function saveChallenge() {
      if (!this.createdAt) this.createdAt = new Date()
      documents.set(String(this._id), this)
      return this
    }),
    stub(EmailOtpChallenge, 'findOne', (filter) => {
      let sortSpec = null
      const query = {
        sort(value) {
          sortSpec = value
          return this
        },
        select() {
          return this
        },
        then(resolve, reject) {
          const matches = [...documents.values()].filter((document) => challengeMatches(document, filter))
          if (sortSpec?.createdAt) {
            matches.sort((left, right) => (
              right.createdAt.getTime() - left.createdAt.getTime()
            ) * sortSpec.createdAt)
          }
          return Promise.resolve(matches[0] || null).then(resolve, reject)
        },
      }
      return query
    }),
    stub(EmailOtpChallenge, 'findOneAndUpdate', async (filter, update) => {
      const document = [...documents.values()].find((item) => challengeMatches(item, filter))
      if (!document) return null
      for (const [key, value] of Object.entries(update.$set || {})) document[key] = value
      for (const [key, value] of Object.entries(update.$inc || {})) document[key] += value
      return document
    }),
    stub(EmailOtpChallenge, 'updateOne', async (filter, update) => {
      const document = [...documents.values()].find((item) => challengeMatches(item, filter))
      if (!document) return { matchedCount: 0 }
      for (const [key, value] of Object.entries(update.$set || {})) document[key] = value
      return { matchedCount: 1 }
    }),
    stub(RefreshSession, 'create', async () => ({})),
  ]
  return {
    documents,
    restore: () => restores.reverse().forEach((restore) => restore()),
  }
}

function stubResendProvider(sentCodes) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(baseUrl)) return originalFetch(url, options)
    assert.equal(url, 'https://api.resend.com/emails')
    const payload = JSON.parse(options.body)
    const match = payload.text.match(/code is (\d{6})/)
    assert.ok(match, 'email body contains a six-digit OTP')
    sentCodes.push(match[1])
    return { ok: true, status: 200 }
  }
  return () => { globalThis.fetch = originalFetch }
}

function stubResendApi(handler) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://api.resend.com/emails') {
      return handler(JSON.parse(options.body), options)
    }
    return originalFetch(url, options)
  }
  return () => { globalThis.fetch = originalFetch }
}

function stubGmailTransport(handler) {
  const original = nodemailer.createTransport
  nodemailer.createTransport = (options) => ({
    sendMail: async (message) => handler(message, options),
  })
  return () => { nodemailer.createTransport = original }
}

test('models target the requested collections', () => {
  assert.equal(Admin.collection.name, 'admin')
  assert.equal(College.collection.name, 'colleges')
  assert.equal(CollegeAdmin.collection.name, 'sub_admins')
  assert.equal(Student.collection.name, 'students')
  assert.equal(CollegeStudent.collection.name, 'clg_students')
  assert.equal(Course.collection.name, 'courses')
  assert.equal(Course.schema.path('category').instance, 'String')
  assert.equal(Course.schema.path('generateCertificate').defaultValue, true)
  assert.equal(Course.schema.path('assignments').schema.path('category'), undefined)
  assert.equal(Course.schema.path('modules').schema.path('lessons').schema.options.timestamps, true)
  assert.equal(Enrollment.collection.name, 'enrollment')
  assert.equal(AssignmentSubmission.collection.name, 'assignment_submissions')
  assert.equal(AssignmentSubmission.schema.path('reviewStatus').defaultValue, 'pending')
  assert.equal(QuizAttempt.collection.name, 'quiz_attempts')
  assert.equal(VideoAttentionResponse.collection.name, 'video_attention_responses')
  assert.equal(Certificate.collection.name, 'certificates')
  assert.equal(CertificateTemplate.collection.name, 'certificate_templates')
  assert.equal(Certificate.schema.path('templateId').defaultValue, 'builtin')
  assert.equal(CertificateTemplate.schema.path('activeTemplateId').instance, 'String')
  assert.equal(CertificateTemplate.schema.path('imageData').options.select, false)
  assert.ok(Certificate.schema.indexes().some(([keys, options]) =>
    keys.userId === 1 && keys.courseId === 1 && options.unique,
  ))
  assert.equal(RefreshSession.collection.name, 'refresh_sessions')
  assert.equal(VideoAttentionResponse.schema.path('correctOptionIndices').options.select, false)
  assert.ok(AssignmentSubmission.schema.path('fileData').options.select === false)
  assert.ok(AssignmentSubmission.schema.path('evaluationHistory').schema.path('evaluatorId'))
  assert.ok(AssignmentSubmission.schema.path('evaluationHistory').schema.path('evaluationStatus'))
  assert.equal(
    AssignmentSubmission.schema.path('evaluationStatus').enumValues.join(','),
    'pending,evaluated,re_evaluation_required',
  )
  assert.equal(AccountIdentity.collection.name, 'accountidentities')
  assert.ok(AccountIdentity.schema.indexes().some(([keys, options]) =>
    keys.username === 1 && options.unique && options.collation?.strength === 2,
  ))
  assert.ok(AccountIdentity.schema.indexes().some(([keys, options]) =>
    keys.googleEmail === 1 && options.unique && options.collation?.strength === 2,
  ))
  assert.deepEqual(Object.keys(accountModelsByRole).sort(), ['college_admin', 'main_admin', 'student'])
  assert.equal(new Student({ role: 'student', studentType: 'independent' }).studentType, 'independent')
  assert.equal(new CollegeStudent({ role: 'student', collegeId: new mongoose.Types.ObjectId() }).studentType, 'college')
  assert.equal(new Admin({ username: 'admin', email: 'admin@example.invalid' }).role, 'main_admin')
  assert.equal(Student.schema.path('collegeId'), undefined)
  assert.equal(Student.schema.path('twoFactorEnabled').defaultValue, false)
  assert.equal(CollegeStudent.schema.path('twoFactorEnabled').defaultValue, false)
  assert.ok(EmailOtpChallenge.schema.indexes().some(([keys, options]) =>
    keys.cleanupAt === 1 && options.expireAfterSeconds === 0,
  ))
  assert.equal(EmailOtpChallenge.schema.path('hashedOtp').options.select, false)
  assert.equal(RegistrationEmailVerification.collection.name, 'registrationemailverifications')
  assert.ok(RegistrationEmailVerification.schema.indexes().some(([keys, options]) =>
    keys.email === 1 && options.unique,
  ))
  assert.ok(RegistrationEmailVerification.schema.indexes().some(([keys, options]) =>
    keys.cleanupAt === 1 && options.expireAfterSeconds === 0,
  ))
  assert.equal(RegistrationEmailVerification.schema.path('hashedOtp').options.select, false)
  assert.ok(College.schema.indexes().some(([keys, options]) => keys.code === 1 && options.unique))
  assert.equal(Course.schema.path('assignments').instance, 'Array')
  assert.equal(Course.schema.path('quizzes').instance, 'Array')
  assert.equal(Course.schema.path('quizzes').schema.paths.questions.schema.path('correctOptionIndex').options.select, false)
  assert.equal(Course.schema.path('modules').schema.path('quiz').schema.path('questions').schema.path('correctOptionIndices').options.select, false)
  assert.equal(Certificate.collection.name, 'certificates')
  assert.ok(Certificate.schema.indexes().some(([keys, options]) =>
    keys.studentType === 1
      && keys.studentId === 1
      && keys.courseId === 1
      && options.unique
      && options.partialFilterExpression.studentType.$type === 'string'
      && options.partialFilterExpression.studentId.$type === 'objectId',
  ))
  assert.equal(Certificate.schema.path('userId').instance, 'ObjectId')
  assert.equal(Certificate.schema.path('studentName').options.required, true)
  assert.equal(Certificate.schema.path('courseName').options.required, true)
  assert.equal(Certificate.schema.path('issuedAt').instance, 'Date')
  assert.equal(Course.schema.path('modules').schema.path('lessons').schema.path('attentionCheck').schema.path('questions').schema.path('correctOptionIndices').options.select, false)
  assert.equal(Course.schema.path('modules').schema.path('contentItems').schema.path('attentionCheck').schema.path('questions').schema.path('correctOptionIndices').options.select, false)
  assert.notEqual(String(new College({ name: 'First' })._id), String(new College({ name: 'Second' })._id))
})

test('student can refresh an expired access token and enroll while unauthenticated enrollment remains denied', async () => {
  const studentId = new mongoose.Types.ObjectId()
  const courseId = '68a000000000000000000034'
  const enrollmentId = '68a000000000000000000035'
  const user = {
    _id: studentId,
    fullName: 'Session Student',
    email: 'session-student@example.invalid',
    username: 'session-student',
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
    passwordHash: await bcrypt.hash('correct-horse-battery', 4),
  }
  let savedSession
  const restores = [
    stub(AccountIdentity, 'findOne', () => queryResult({
      accountCollection: 'students',
      accountId: studentId,
      email: user.email,
      username: user.username,
    })),
    stub(Student, 'findById', () => queryResult(user)),
    stub(Student, 'findOne', () => queryResult({ _id: studentId })),
    stub(RefreshSession, 'create', async (document) => {
      savedSession = { ...document, _id: new mongoose.Types.ObjectId() }
      return savedSession
    }),
    stub(RefreshSession, 'findOne', (filter) => queryResult(
      savedSession?.tokenHash === filter.tokenHash && savedSession.expiresAt > new Date()
        ? savedSession
        : null,
    )),
    stub(RefreshSession, 'updateOne', async () => ({ matchedCount: 1 })),
    stub(Course, 'findOne', () => queryResult({ _id: courseId })),
    stub(Enrollment, 'findOne', () => queryResult(null)),
    stub(Enrollment, 'create', async (documents) => [{ ...documents[0], _id: enrollmentId }]),
  ]

  try {
    const unauthenticated = await request('/enrollments', { body: { courseId } })
    assert.equal(unauthenticated.status, 401)

    const login = await request('/auth/login', {
      body: { identifier: user.email, password: 'correct-horse-battery', role: 'student' },
    })
    assert.equal(login.status, 200, await login.clone().text())
    const cookie = login.headers.get('set-cookie')
    assert.match(cookie || '', /lms\.refresh=[A-Za-z0-9_-]{43}/)
    assert.match(cookie || '', /HttpOnly/i)
    assert.match(cookie || '', /Path=\/api\/auth/i)

    const expiredToken = jwt.sign(
      { role: 'student', accountCollection: 'students' },
      process.env.JWT_SECRET,
      { subject: String(studentId), expiresIn: '-1s' },
    )
    const expiredEnrollment = await request('/enrollments', {
      token: expiredToken,
      body: { courseId },
    })
    assert.equal(expiredEnrollment.status, 401)

    const refresh = await request('/auth/refresh', {
      method: 'POST',
      headers: {
        Origin: process.env.CLIENT_ORIGIN,
        Cookie: cookie.split(';')[0],
      },
    })
    assert.equal(refresh.status, 200, await refresh.clone().text())
    const refreshed = await refresh.json()
    assert.equal(jwt.verify(refreshed.token, process.env.JWT_SECRET).sub, String(studentId))
    assert.equal(refreshed.user.id, String(studentId))
    assert.equal(savedSession.userId.toString(), String(studentId))

    const enrollment = await request('/enrollments', {
      token: refreshed.token,
      body: { courseId },
    })
    assert.equal(enrollment.status, 201)
    assert.equal((await enrollment.json()).enrollment._id, enrollmentId)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('attention check validation rejects invalid intervals', () => {
  const result = normalizeCourseDetails({
    title: 'Course',
    modules: [{
      title: 'Module',
      lessons: [{
        title: 'Legacy video',
        attentionCheck: { enabled: false, minIntervalSeconds: 90, maxIntervalSeconds: 30, questions: [] },
      }],
    }],
  })

  assert.match(result.error, /attention check intervals/i)
})

test('attention check validation requires the exact number of selected playback questions', () => {
  const questions = [
    { prompt: 'Question one?', options: ['A', 'B'], correctOptionIndices: [0], selectedForPlayback: true },
    { prompt: 'Question two?', options: ['C', 'D'], correctOptionIndices: [1], selectedForPlayback: false },
  ]
  const makeCourse = (selectedForPlayback) => normalizeCourseDetails({
    title: 'Course',
    modules: [{
      title: 'Module',
      contentItems: [{
        type: 'video-lesson',
        title: 'Video',
        attentionCheck: {
          enabled: true,
          questionsDuringVideo: 2,
          minIntervalSeconds: 10,
          maxIntervalSeconds: 90,
          questions: questions.map((question, index) => ({
            ...question,
            selectedForPlayback: selectedForPlayback[index],
          })),
        },
      }],
    }],
  })

  assert.match(makeCourse([true, false]).error, /select exactly 2/i)
  const valid = makeCourse([true, true])
  assert.equal(valid.error, undefined)
  assert.equal(valid.value.modules[0].contentItems[0].attentionCheck.questionsDuringVideo, 2)
  assert.deepEqual(valid.value.modules[0].contentItems[0].attentionCheck.questions.map((question) => question.selectedForPlayback), [true, true])
})

test('student username availability excludes the authenticated student and checks every account collection', async () => {
  const studentId = new mongoose.Types.ObjectId()
  const student = {
    _id: studentId,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
    username: 'current-name',
  }
  const restores = [
    stub(Student, 'findById', () => queryResult(student)),
    stub(AccountIdentity, 'find', () => queryResult([])),
  ]
  const restoreDb = stubDatabase({
    collection: (collectionName) => ({
      find: (query) => ({
        toArray: async () => {
          if (collectionName === 'students') {
            assert.equal(String(query._id.$ne), String(studentId))
            return []
          }
          return collectionName === 'admin' && query.username.$in[0].test('PlatformOwner')
            ? [{ username: 'platformowner' }]
            : []
        },
      }),
    }),
  })
  try {
    const currentResponse = await request('/settings/username-availability?username=CURRENT-NAME', {
      role: 'student',
      subject: String(studentId),
    })
    assert.equal(currentResponse.status, 200)
    assert.deepEqual(await currentResponse.json(), { available: true, isCurrent: true })

    const takenResponse = await request('/settings/username-availability?username=PlatformOwner', {
      role: 'student',
      subject: String(studentId),
    })
    assert.equal(takenResponse.status, 200)
    assert.deepEqual(await takenResponse.json(), { available: false, isCurrent: false })
  } finally {
    restoreDb()
    for (const restore of restores.reverse()) restore()
  }
})

test('student profile update changes the existing account and identity and authenticates with the new username', async () => {
  const studentId = new mongoose.Types.ObjectId()
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4)
  const student = {
    _id: studentId,
    fullName: 'Original Student',
    username: 'original-name',
    email: 'original-name@example.invalid',
    passwordHash,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
    save: async function save() { return this },
  }
  const identity = {
    _id: new mongoose.Types.ObjectId(),
    accountCollection: 'students',
    accountId: studentId,
    email: student.email,
    username: student.username,
    save: async function save() { return this },
  }
  let transactionAttempts = 0
  const restores = [
    stub(Student, 'findById', () => queryResult(student)),
    stub(AccountIdentity, 'find', () => queryResult([])),
    stub(RefreshSession, 'create', async () => ({})),
    stub(AccountIdentity, 'findOne', (query) => {
      if (query.username) return queryResult(null)
      if (query.$or) {
        const [usernameQuery] = query.$or
        return queryResult(usernameQuery.username === 'renamed-student' ? identity : null)
      }
      return queryResult(identity)
    }),
    stub(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => {
        transactionAttempts += 1
        if (transactionAttempts === 1) {
          throw Object.assign(new Error('conflicting operation'), { code: 117 })
        }
        return callback()
      },
      endSession: async () => {},
    })),
  ]
  const restoreDb = stubDatabase({
    collection: () => ({ find: () => ({ toArray: async () => [] }) }),
  })
  try {
    const updateResponse = await request('/settings/profile', {
      role: 'student',
      subject: String(studentId),
      method: 'PATCH',
      body: { fullName: 'Updated Student', username: 'Renamed-Student' },
    })
    assert.equal(updateResponse.status, 200)
    const updated = await updateResponse.json()
    assert.equal(updated.account.fullName, 'Updated Student')
    assert.equal(updated.account.username, 'renamed-student')
    assert.equal(student._id.toString(), String(updated.account.id))
    assert.equal(student.fullName, 'Updated Student')
    assert.equal(student.username, 'renamed-student')
    assert.equal(identity.username, 'renamed-student')
    assert.equal(transactionAttempts, 2)

    const loginResponse = await request('/auth/login', {
      body: {
        identifier: 'renamed-student',
        password: 'correct-horse-battery',
        role: 'student',
      },
    })
    assert.equal(loginResponse.status, 200)
    const oldUsernameResponse = await request('/auth/login', {
      body: {
        identifier: 'original-name',
        password: 'correct-horse-battery',
        role: 'student',
      },
    })
    assert.equal(oldUsernameResponse.status, 401)
  } finally {
    restoreDb()
    for (const restore of restores.reverse()) restore()
  }
})

test('student email verification updates the existing account and preserves its Google login identity', async () => {
  const studentId = new mongoose.Types.ObjectId()
  const identityId = new mongoose.Types.ObjectId()
  const code = '12345678'
  const codeHash = createHmac('sha256', process.env.JWT_SECRET)
    .update(`${identityId}:${code}`)
    .digest('hex')
  const student = {
    _id: studentId,
    fullName: 'Google Student',
    username: 'google-student',
    email: 'old-email@example.invalid',
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
    save: async function save() { return this },
  }
  const identity = {
    _id: identityId,
    accountCollection: 'students',
    accountId: studentId,
    email: student.email,
    username: student.username,
    googleSub: 'verified-google-subject',
    pendingEmail: 'new-email@example.invalid',
    pendingEmailVerificationCodeHash: codeHash,
    pendingEmailVerificationExpiresAt: new Date(Date.now() + 60_000),
    pendingEmailVerificationAttempts: 0,
    save: async function save() { return this },
  }
  const restores = [
    stub(Student, 'findById', () => queryResult(student)),
    stub(AccountIdentity, 'findOne', () => queryResult(identity)),
    stub(AccountIdentity, 'find', () => queryResult([])),
    stub(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
  ]
  const restoreDb = stubDatabase({
    collection: () => ({ find: () => ({ toArray: async () => [] }) }),
  })
  try {
    const response = await request('/settings/email-change/verify', {
      role: 'student',
      subject: String(studentId),
      body: { code },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.account.email, 'new-email@example.invalid')
    assert.equal(student.email, 'new-email@example.invalid')
    assert.equal(identity.email, 'new-email@example.invalid')
    assert.equal(identity.googleEmail, 'old-email@example.invalid')
    assert.equal(identity.googleSub, 'verified-google-subject')
    assert.equal(identity.pendingEmail, undefined)
    assert.equal(identity.pendingEmailVerificationCodeHash, undefined)
  } finally {
    restoreDb()
    for (const restore of restores.reverse()) restore()
  }
})

test('student email request leaves the current email unchanged when verification email cannot be sent', async () => {
  const studentId = new mongoose.Types.ObjectId()
  const identity = {
    _id: new mongoose.Types.ObjectId(),
    accountCollection: 'students',
    accountId: studentId,
    email: 'current-email@example.invalid',
    username: 'student-email',
    save: async function save() { return this },
  }
  const student = {
    _id: studentId,
    fullName: 'Email Student',
    email: identity.email,
    username: identity.username,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
  }
  const restores = [
    stub(Student, 'findById', () => queryResult(student)),
    stub(AccountIdentity, 'findOne', () => queryResult(identity)),
    stub(AccountIdentity, 'find', () => queryResult([])),
    stub(AccountIdentity, 'updateOne', async (query) => {
      assert.equal(query._id, identity._id)
      identity.pendingEmail = undefined
      identity.pendingEmailVerificationCodeHash = undefined
      return { matchedCount: 1 }
    }),
    stubResendApi(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Test Resend recipient rejected' }),
    })),
  ]
  const restoreDb = stubDatabase({
    collection: () => ({ find: () => ({ toArray: async () => [] }) }),
  })
  try {
    const response = await request('/settings/email-change/request', {
      role: 'student',
      subject: String(studentId),
      body: { email: 'new-email@example.invalid' },
    })
    assert.equal(response.status, 503)
    assert.match((await response.json()).message, /verification email could not be sent/)
    assert.equal(student.email, 'current-email@example.invalid')
    assert.equal(identity.email, 'current-email@example.invalid')
    assert.equal(identity.pendingEmail, undefined)
  } finally {
    restoreDb()
    for (const restore of restores.reverse()) restore()
  }
})

test('admin college create saves to colleges with a Mongo ObjectId', async () => {
  let savedDocument
  const restoreAdmin = stub(Admin, 'findById', async () => ({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const restoreCreate = stub(College, 'create', async (document) => {
    savedDocument = new College(document)
    return savedDocument
  })
  try {
    const response = await request('/admin/colleges', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: { name: 'Test College', code: 'TEST' },
    })
    assert.equal(response.status, 201)
    const result = await response.json()
    assert.match(result.college.id, /^[a-f\d]{24}$/)
    assert.equal(savedDocument.name, 'Test College')
    assert.ok(savedDocument._id instanceof mongoose.Types.ObjectId)
    assert.equal(College.collection.name, 'colleges')
  } finally {
    restoreCreate()
    restoreAdmin()
  }
})

test('Main Admin college list returns separate student and distinct enrollment counts', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = new mongoose.Types.ObjectId('68a000000000000000000031')
  const college = {
    _id: collegeId,
    name: 'Saved College',
    code: 'SAVED',
    status: 'active',
  }
  let collegeFilter
  let aggregation
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(College, 'find', (filter) => {
      collegeFilter = filter
      return queryResult([college])
    }),
    stub(CollegeStudent, 'aggregate', async (pipeline) => {
      aggregation = pipeline
      return [{ _id: collegeId, totalStudents: 17, enrolledStudents: 12 }]
    }),
  ]

  try {
    const response = await request('/admin/colleges?includeInactive=true', {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(collegeFilter, {})
    assert.deepEqual(
      aggregation[0].$match.collegeId.$in.map(String),
      [collegeId.toString(), collegeId.toString()],
    )
    assert.equal('role' in aggregation[0].$match, false)
    assert.equal('studentType' in aggregation[0].$match, false)
    assert.equal(aggregation[1].$lookup.from, 'enrollment')
    assert.equal(aggregation[1].$lookup.pipeline[1].$limit, 1)
    assert.deepEqual(
      aggregation[1].$lookup.pipeline[0].$match.$expr.$and[0].$eq.map((expression) => expression.$convert.to),
      ['string', 'string'],
    )
    assert.deepEqual(result.colleges, [{
      id: collegeId.toString(),
      name: 'Saved College',
      code: 'SAVED',
      address: '',
      city: '',
      state: '',
      country: '',
      contactName: '',
      contactPhone: '',
      contactEmail: '',
      status: 'active',
      totalStudents: 17,
      enrolledStudents: 12,
    }])
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('college details returns saved college, student, course, enrollment, and sub-admin data', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = new mongoose.Types.ObjectId('68a000000000000000000032')
  const subAdminId = new mongoose.Types.ObjectId('68a000000000000000000033')
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000034')
  const courseId = new mongoose.Types.ObjectId('68a000000000000000000035')
  const enrollmentId = new mongoose.Types.ObjectId('68a000000000000000000036')
  let selectedSubAdminFields
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(College, 'findById', () => queryResult({
      _id: collegeId,
      name: 'Details College',
      code: 'DETAIL',
      contactEmail: 'contact@example.invalid',
      status: 'inactive',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    })),
    stub(CollegeStudent, 'find', (filter) => {
      assert.equal(String(filter.collegeId), collegeId.toString())
      return queryResult([{
        _id: studentId,
        fullName: 'College Student',
        email: 'student@example.invalid',
        username: 'student-1',
        studentId: 'STU-1',
        department: 'Engineering',
        batch: '2026',
        status: 'active',
      }])
    }),
    stub(Enrollment, 'find', (filter) => {
      assert.equal(filter.userId.$in[0].toString(), studentId.toString())
      assert.deepEqual(filter.status, { $ne: 'cancelled' })
      return queryResult([{
        _id: enrollmentId,
        userId: studentId,
        courseId: { _id: courseId, title: 'AI Fundamentals', status: 'published' },
        assignedBy: subAdminId,
        status: 'active',
        createdAt: new Date('2026-01-04T00:00:00.000Z'),
      }])
    }),
    stub(CollegeAdmin, 'find', () => {
      const query = queryResult([{
        _id: subAdminId,
        fullName: 'College Sub-Admin',
        email: 'subadmin@example.invalid',
        username: 'college-admin',
        status: 'active',
        isActive: true,
        studentLimit: 500,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        activationTokenHash: 'never-return',
      }])
      query.select = (fields) => {
        selectedSubAdminFields = fields
        return query
      }
      return query
    }),
  ]

  try {
    const response = await request(`/admin/colleges/${collegeId}/details`, {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.college.name, 'Details College')
    assert.equal(result.college.contactEmail, 'contact@example.invalid')
    assert.equal(result.college.totalStudents, 1)
    assert.equal(result.college.enrolledStudents, 1)
    assert.equal(result.college.studentLimit, 500)
    assert.equal(result.college.studentLimitSubAdminId, subAdminId.toString())
    assert.equal(result.college.studentLimitSubAdminName, 'College Sub-Admin')
    assert.equal(result.college.students[0].email, 'student@example.invalid')
    assert.deepEqual(result.college.courses, [{
      id: courseId.toString(),
      title: 'AI Fundamentals',
      status: 'published',
      enrolledStudents: 1,
    }])
    assert.equal(result.college.enrollments[0].studentId, studentId.toString())
    assert.equal(result.college.enrollments[0].courseTitle, 'AI Fundamentals')
    assert.equal(result.college.subAdmins[0].id, subAdminId.toString())
    assert.equal(result.college.subAdmins[0].email, 'subadmin@example.invalid')
    assert.equal('activationTokenHash' in result.college.subAdmins[0], false)
    assert.doesNotMatch(selectedSubAdminFields, /token/i)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('Main Admin student details returns owned referral codes and their actual referred students', async () => {
  const adminId = '68a000000000000000000010'
  const ownerId = new mongoose.Types.ObjectId('68a000000000000000000081')
  const approvedId = new mongoose.Types.ObjectId('68a000000000000000000082')
  const pendingId = new mongoose.Types.ObjectId('68a000000000000000000083')
  const rejectedId = new mongoose.Types.ObjectId('68a000000000000000000084')
  const now = new Date()
  let referralQuery
  let referredStudentQuery
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findById', async (id) => ({
      _id: id, role: 'student', studentType: 'independent', status: 'active', isActive: true,
    })),
    stub(Student, 'findOne', (filter) => {
      assert.equal(String(filter._id), String(ownerId))
      assert.equal(filter.studentType, 'independent')
      return queryResult({
        _id: ownerId,
        fullName: 'Referral Owner',
        username: 'referral-owner',
        email: 'owner@example.invalid',
        studentId: 'OWNER-01',
        studentType: 'independent',
        registrationDetails: { referralCode: 'CODE-USED-AT-REGISTRATION' },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        status: 'active',
        approvalStatus: 'approved',
      })
    }),
    stub(ReferralCode, 'find', (filter) => {
      referralQuery = filter
      return queryResult([
        {
          code: 'ACTIVE-REFERRAL',
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
          expiresAt: new Date(now.getTime() + 86400000),
          status: 'active',
          usedBy: null,
        },
        {
          code: 'USED-APPROVED',
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
          expiresAt: new Date(now.getTime() + 86400000),
          status: 'used',
          usedBy: approvedId,
          usedAt: new Date('2026-10-03T00:00:00.000Z'),
        },
        {
          code: 'USED-PENDING',
          createdAt: new Date('2026-10-04T00:00:00.000Z'),
          expiresAt: new Date(now.getTime() + 86400000),
          status: 'used',
          usedBy: pendingId,
          usedAt: new Date('2026-10-05T00:00:00.000Z'),
        },
        {
          code: 'USED-REJECTED',
          createdAt: new Date('2026-10-06T00:00:00.000Z'),
          expiresAt: new Date(now.getTime() + 86400000),
          status: 'used',
          usedBy: rejectedId,
          usedAt: new Date('2026-10-07T00:00:00.000Z'),
        },
        {
          code: 'EXPIRED-REFERRAL',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          expiresAt: new Date(now.getTime() - 86400000),
          status: 'active',
          usedBy: null,
        },
      ])
    }),
    stub(Student, 'find', (filter) => {
      referredStudentQuery = filter
      assert.equal(filter.role, 'student')
      assert.equal(filter.studentType, 'independent')
      assert.deepEqual(filter['registrationDetails.referralCode'].$in, [
        'ACTIVE-REFERRAL',
        'USED-APPROVED',
        'USED-PENDING',
        'USED-REJECTED',
        'EXPIRED-REFERRAL',
      ])
      return queryResult([
        {
          _id: approvedId,
          fullName: 'Approved Referral',
          email: 'approved@example.invalid',
          studentId: 'REF-APPROVED',
          registrationDetails: { referralCode: 'USED-APPROVED' },
          createdAt: new Date('2026-10-03T00:00:00.000Z'),
          status: 'active',
          approvalStatus: 'approved',
        },
        {
          _id: pendingId,
          fullName: 'Pending Referral',
          email: 'pending@example.invalid',
          studentId: 'REF-PENDING',
          registrationDetails: { referralCode: 'USED-PENDING' },
          createdAt: new Date('2026-10-05T00:00:00.000Z'),
          status: 'pending',
          approvalStatus: 'pending',
        },
        {
          _id: rejectedId,
          fullName: 'Rejected Referral',
          email: 'rejected@example.invalid',
          studentId: 'REF-REJECTED',
          registrationDetails: { referralCode: 'USED-REJECTED' },
          createdAt: new Date('2026-10-07T00:00:00.000Z'),
          status: 'rejected',
          approvalStatus: 'rejected',
        },
      ])
    }),
    stub(Enrollment, 'find', () => queryResult([])),
  ]
  try {
    const response = await request(`/admin/students/${ownerId}/details?studentType=independent`, {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(referralQuery, { generatedBy: ownerId })
    assert.equal(referredStudentQuery['registrationDetails.referralCode'].$in.length, 5)
    assert.equal(result.student.studentId, 'OWNER-01')
    assert.equal(result.student.referralCodeUsed, 'CODE-USED-AT-REGISTRATION')
    assert.deepEqual(result.referralDetails.codes.map(({ code, status }) => ({ code, status })), [
      { code: 'ACTIVE-REFERRAL', status: 'Active' },
      { code: 'USED-APPROVED', status: 'Used' },
      { code: 'USED-PENDING', status: 'Used' },
      { code: 'USED-REJECTED', status: 'Used' },
      { code: 'EXPIRED-REFERRAL', status: 'Expired' },
    ])
    assert.deepEqual(
      result.referralDetails.referredStudents.map(({ fullName, studentId, status }) => ({ fullName, studentId, status })),
      [
        { fullName: 'Approved Referral', studentId: 'REF-APPROVED', status: 'Approved' },
        { fullName: 'Pending Referral', studentId: 'REF-PENDING', status: 'Pending' },
        { fullName: 'Rejected Referral', studentId: 'REF-REJECTED', status: 'Rejected' },
      ],
    )
    assert.deepEqual(
      result.referralDetails.codes.find(({ code }) => code === 'USED-APPROVED').referredStudents,
      [{
        id: String(approvedId),
        fullName: 'Approved Referral',
        studentId: 'REF-APPROVED',
        email: 'approved@example.invalid',
        registeredAt: '2026-10-03T00:00:00.000Z',
        status: 'Approved',
      }],
    )
    assert.deepEqual(result.referralDetails.codes[0].generatedBy, {
      fullName: 'Referral Owner',
      studentId: 'OWNER-01',
    })
    assert.equal(result.summary.studentsReferred, 3)
    assert.equal(result.summary.successfulReferrals, 1)
    assert.equal(result.summary.pendingReferrals, 1)

    const forbiddenResponse = await request(`/admin/students/${ownerId}/details?studentType=independent`, {
      role: 'student',
      subject: String(ownerId),
    })
    assert.equal(forbiddenResponse.status, 403)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('Main Admin can update a positive student limit only for a Sub-Admin in that college', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = '68a000000000000000000050'
  const subAdminId = '68a000000000000000000051'
  let updateFilter
  let updateDocument
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(CollegeAdmin, 'findById', async () => ({
      _id: '68a000000000000000000055',
      role: 'college_admin',
      status: 'active',
      isActive: true,
    })),
    stub(CollegeAdmin, 'findOneAndUpdate', (filter, update) => {
      updateFilter = filter
      updateDocument = update
      return queryResult({
        _id: new mongoose.Types.ObjectId(subAdminId),
        fullName: 'College Sub-Admin',
        email: 'subadmin@example.invalid',
        username: 'college-admin',
        studentLimit: update.$set?.studentLimit,
      })
    }),
  ]
  try {
    const response = await request(`/admin/colleges/${collegeId}/sub-admins/${subAdminId}/student-limit`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { studentLimit: 100 },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.subAdmin.studentLimit, 100)
    assert.equal(String(updateFilter.collegeId), collegeId)
    assert.equal(String(updateFilter._id), subAdminId)
    assert.equal(updateFilter.role, 'college_admin')
    assert.deepEqual(updateDocument, { $set: { studentLimit: 100 } })

    const forbiddenResponse = await request(`/admin/colleges/${collegeId}/sub-admins/${subAdminId}/student-limit`, {
      role: 'college_admin',
      subject: '68a000000000000000000055',
      method: 'PATCH',
      body: { studentLimit: 200 },
    })
    assert.equal(forbiddenResponse.status, 403)
    assert.deepEqual(updateDocument, { $set: { studentLimit: 100 } })
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student limit update validates limits and rejects a Sub-Admin from another college', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = '68a000000000000000000052'
  const subAdminId = '68a000000000000000000053'
  let updateCalled = false
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(CollegeAdmin, 'findOneAndUpdate', () => {
      updateCalled = true
      return queryResult(null)
    }),
  ]
  try {
    for (const studentLimit of [0, null, -1, 1.5]) {
      const invalidResponse = await request(`/admin/colleges/${collegeId}/sub-admins/${subAdminId}/student-limit`, {
        role: 'main_admin',
        subject: adminId,
        method: 'PATCH',
        body: { studentLimit },
      })
      assert.equal(invalidResponse.status, 400)
      assert.match((await invalidResponse.json()).message, /positive whole number/)
    }
    assert.equal(updateCalled, false)

    const wrongCollegeResponse = await request(`/admin/colleges/${collegeId}/sub-admins/${subAdminId}/student-limit`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { studentLimit: 20 },
    })
    assert.equal(wrongCollegeResponse.status, 404)
    assert.equal(updateCalled, true)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('independent registration writes to students and maps the identity', async () => {
  let savedStudent
  let savedIdentity
  let savedNotification
  const verificationStore = installRegistrationEmailVerificationTestDoubles()
  const verifiedAt = new Date()
  const verification = new RegistrationEmailVerification({
    email: 'independent@example.invalid',
    hashedOtp: 'test-otp-hash',
    expiresAt: new Date(verifiedAt.getTime() - 1),
    verificationExpiresAt: new Date(verifiedAt.getTime() + 30 * 60 * 1000),
    cleanupAt: new Date(verifiedAt.getTime() + 24 * 60 * 60 * 1000),
    requestWindowStartedAt: verifiedAt,
    lastSentAt: verifiedAt,
    verifiedAt,
  })
  verificationStore.documents.set(String(verification._id), verification)
  const emailVerificationToken = jwt.sign(
    { scope: 'registration_email_verified', email: 'independent@example.invalid' },
    process.env.JWT_SECRET,
    { subject: String(verification._id), expiresIn: '30m' },
  )
  const restoreDb = stubDatabase({
    collection: () => ({ find: () => ({ toArray: async () => [] }) }),
  })
  const restores = [
    stub(AccountIdentity, 'find', () => queryResult([])),
    stub(Admin, 'findOne', () => queryResult(null)),
    stub(CollegeAdmin, 'findOne', () => queryResult(null)),
    stub(Student, 'findOne', () => queryResult(null)),
    stub(CollegeStudent, 'findOne', () => queryResult(null)),
    stub(AccountIdentity, 'findOne', () => queryResult(null)),
    stub(AccountIdentity, 'create', async (documents) => {
      savedIdentity = documents[0]
      return documents
    }),
    stub(Student, 'create', async (documents) => {
      savedStudent = documents[0]
      return [{ ...documents[0] }]
    }),
    stub(Notification, 'create', async (documents) => {
      savedNotification = documents[0]
      return documents
    }),
    stub(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
    stubGmailTransport(async () => {}),
  ]
  try {
    const response = await request('/auth/register', {
      body: {
        fullName: 'Independent Student',
        email: 'independent@example.invalid',
        username: 'independent-student',
        password: 'a-strong-password',
        confirmPassword: 'a-strong-password',
        emailVerificationToken,
        role: 'student',
        accountType: 'independent',
        registrationDetails: {
          fullName: 'Ignored submitted copy',
          email: 'ignored@example.invalid',
          username: 'ignored-user',
          referralCode: ' abcd1234 ',
          educationQualification: 'Other',
          customQualification: 'Specialized diploma',
          userExpectations: 'Learn practical skills.',
          location: 'Toronto',
          livingWithWhom: 'Other',
          customLivingArrangement: 'Roommates',
          password: 'must-not-be-saved',
          passwordHash: 'must-not-be-saved',
          approvalStatus: 'approved',
        },
      },
    })
    assert.equal(response.status, 201)
    assert.equal(savedStudent.role, 'student')
    assert.equal(savedStudent.studentType, 'independent')
    assert.equal(savedStudent.collegeId, undefined)
    assert.deepEqual(savedStudent.registrationDetails, {
      fullName: 'Independent Student',
      email: 'independent@example.invalid',
      username: 'independent-student',
      referralCode: ' abcd1234 ',
      educationQualification: 'Other',
      customQualification: 'Specialized diploma',
      userExpectations: 'Learn practical skills.',
      location: 'Toronto',
      livingWithWhom: 'Other',
      customLivingArrangement: 'Roommates',
    })
    assert.equal(savedIdentity.accountCollection, 'students')
    assert.equal(String(savedIdentity.accountId), String(savedStudent._id))
    assert.equal(savedNotification.recipientRole, 'main_admin')
    assert.equal(savedNotification.type, 'independent_student_registered')
    assert.equal(Student.collection.name, 'students')
    assert.equal(AccountIdentity.collection.name, 'accountidentities')
  } finally {
    for (const restore of restores.reverse()) restore()
    verificationStore.restore()
    restoreDb()
  }
})

test('independent registration rejects requests without a server-issued verified-email token', async () => {
  const response = await request('/auth/register', {
    body: {
      fullName: 'Unverified Student',
      email: 'unverified@example.invalid',
      username: 'unverified-student',
      password: 'a-strong-password',
      confirmPassword: 'a-strong-password',
      role: 'student',
      accountType: 'independent',
    },
  })
  assert.equal(response.status, 400)
  assert.match((await response.json()).message, /verify your email/i)
})

test('registration email OTP is hashed, expires, is resend-safe, and can be used only once', async () => {
  const store = installRegistrationEmailVerificationTestDoubles()
  const restoreDb = stubDatabase({
    collection: () => ({ find: () => ({ toArray: async () => [] }) }),
  })
  const restoreIdentityFind = stub(AccountIdentity, 'find', () => queryResult([]))
  const sentCodes = []
  const restoreResend = stubResendProvider(sentCodes)
  const headers = { 'x-forwarded-for': '198.51.100.31' }
  try {
    const email = 'otp-registration@example.invalid'
    const firstSend = await request('/auth/registration/email/send', { body: { email }, headers })
    assert.equal(firstSend.status, 200)
    assert.equal(sentCodes.length, 1)
    assert.match(sentCodes[0], /^\d{6}$/)
    const [verification] = store.documents.values()
    assert.equal(verification.email, email)
    assert.match(verification.hashedOtp, /^[a-f\d]{64}$/)
    assert.notEqual(verification.hashedOtp, sentCodes[0])
    assert.ok(verification.expiresAt.getTime() > Date.now())
    const firstHash = verification.hashedOtp

    const shortCodeResponse = await request('/auth/registration/email/verify', {
      body: { email, code: '12345' },
      headers,
    })
    assert.equal(shortCodeResponse.status, 400)
    assert.match((await shortCodeResponse.json()).message, /6-digit/i)

    const cooldownResponse = await request('/auth/registration/email/send', { body: { email }, headers })
    assert.equal(cooldownResponse.status, 429)

    verification.lastSentAt = new Date(Date.now() - 61_000)
    const resend = await request('/auth/registration/email/send', { body: { email }, headers })
    assert.equal(resend.status, 200)
    assert.equal(sentCodes.length, 2)
    assert.notEqual(verification.hashedOtp, firstHash)

    const oldCodeResponse = await request('/auth/registration/email/verify', {
      body: { email, code: sentCodes[0] },
      headers,
    })
    assert.equal(oldCodeResponse.status, 400)
    assert.match((await oldCodeResponse.json()).message, /incorrect/i)

    const verifyResponse = await request('/auth/registration/email/verify', {
      body: { email, code: sentCodes[1] },
      headers,
    })
    assert.equal(verifyResponse.status, 200)
    const verified = await verifyResponse.json()
    assert.match(verified.emailVerificationToken, /^[\w-]+\.[\w-]+\.[\w-]+$/)
    assert.equal(verification.verifiedAt instanceof Date, true)

    const reusedResponse = await request('/auth/registration/email/verify', {
      body: { email, code: sentCodes[1] },
      headers,
    })
    assert.equal(reusedResponse.status, 400)
    assert.match((await reusedResponse.json()).message, /already been used/i)

  } finally {
    restoreResend()
    restoreIdentityFind()
    store.restore()
    restoreDb()
  }
})

test('registration email verification rejects expired codes and locks after five incorrect attempts', async () => {
  const store = installRegistrationEmailVerificationTestDoubles()
  const restoreDb = stubDatabase({
    collection: () => ({ find: () => ({ toArray: async () => [] }) }),
  })
  const restoreIdentityFind = stub(AccountIdentity, 'find', () => queryResult([]))
  const sentCodes = []
  const restoreResend = stubResendProvider(sentCodes)
  try {
    const expiredEmail = 'expired-registration@example.invalid'
    const expiredHeaders = { 'x-forwarded-for': '198.51.100.32' }
    const expiredSend = await request('/auth/registration/email/send', {
      body: { email: expiredEmail },
      headers: expiredHeaders,
    })
    assert.equal(expiredSend.status, 200)
    const expiredChallenge = [...store.documents.values()].find((item) => item.email === expiredEmail)
    expiredChallenge.expiresAt = new Date(Date.now() - 1)
    const expiredResponse = await request('/auth/registration/email/verify', {
      body: { email: expiredEmail, code: sentCodes[0] },
      headers: expiredHeaders,
    })
    assert.equal(expiredResponse.status, 410)
    assert.match((await expiredResponse.json()).message, /expired/i)

    const attemptEmail = 'attempts-registration@example.invalid'
    const attemptHeaders = { 'x-forwarded-for': '198.51.100.33' }
    const sendResponse = await request('/auth/registration/email/send', {
      body: { email: attemptEmail },
      headers: attemptHeaders,
    })
    assert.equal(sendResponse.status, 200)
    const actualCode = sentCodes[1]
    const incorrectCode = actualCode === '000000' ? '000001' : '000000'
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await request('/auth/registration/email/verify', {
        body: { email: attemptEmail, code: incorrectCode },
        headers: attemptHeaders,
      })
      assert.equal(response.status, 400)
      assert.match((await response.json()).message, /incorrect/i)
    }
    const lockedResponse = await request('/auth/registration/email/verify', {
      body: { email: attemptEmail, code: incorrectCode },
      headers: attemptHeaders,
    })
    assert.equal(lockedResponse.status, 429)
    assert.match((await lockedResponse.json()).message, /too many attempts/i)
    const attemptChallenge = [...store.documents.values()].find((item) => item.email === attemptEmail)
    assert.equal(attemptChallenge.invalidatedAt instanceof Date, true)
  } finally {
    restoreResend()
    restoreIdentityFind()
    store.restore()
    restoreDb()
  }
})

test('registration email verification limits repeated code requests and binds the proof to its email', async () => {
  const store = installRegistrationEmailVerificationTestDoubles()
  const restoreDb = stubDatabase({
    collection: () => ({ find: () => ({ toArray: async () => [] }) }),
  })
  const restoreIdentityFind = stub(AccountIdentity, 'find', () => queryResult([]))
  const sentCodes = []
  const restoreResend = stubResendProvider(sentCodes)
  try {
    const email = 'limited-registration@example.invalid'
    const headers = { 'x-forwarded-for': '198.51.100.34' }
    const first = await request('/auth/registration/email/send', { body: { email }, headers })
    assert.equal(first.status, 200)
    const challenge = [...store.documents.values()][0]
    challenge.lastSentAt = new Date(Date.now() - 61_000)
    challenge.requestCount = 5
    challenge.requestWindowStartedAt = new Date()
    const limited = await request('/auth/registration/email/send', { body: { email }, headers })
    assert.equal(limited.status, 429)
    assert.match((await limited.json()).message, /too many verification code requests/i)

    const otherEmail = 'other-registration@example.invalid'
    const otherHeaders = { 'x-forwarded-for': '198.51.100.35' }
    const otherSend = await request('/auth/registration/email/send', {
      body: { email: otherEmail },
      headers: otherHeaders,
    })
    assert.equal(otherSend.status, 200)
    const otherChallenge = [...store.documents.values()].find((item) => item.email === otherEmail)
    const verifiedAt = new Date()
    otherChallenge.verifiedAt = verifiedAt
    otherChallenge.verificationExpiresAt = new Date(verifiedAt.getTime() + 30 * 60 * 1000)
    const otherToken = jwt.sign(
      { scope: 'registration_email_verified', email: otherEmail },
      process.env.JWT_SECRET,
      { subject: String(otherChallenge._id), expiresIn: '30m' },
    )
    const mismatchedRegistration = await request('/auth/register', {
      body: {
        fullName: 'Email Mismatch',
        email: 'different-registration@example.invalid',
        username: 'email-mismatch',
        password: 'a-strong-password',
        confirmPassword: 'a-strong-password',
        emailVerificationToken: otherToken,
        role: 'student',
        accountType: 'independent',
      },
    })
    assert.equal(mismatchedRegistration.status, 400)
    assert.match((await mismatchedRegistration.json()).message, /verify this email/i)
  } finally {
    restoreResend()
    restoreIdentityFind()
    store.restore()
    restoreDb()
  }
})

test('registration email code requests are rate-limited per IP', async () => {
  const store = installRegistrationEmailVerificationTestDoubles()
  const restoreDb = stubDatabase({
    collection: () => ({ find: () => ({ toArray: async () => [] }) }),
  })
  const restoreIdentityFind = stub(AccountIdentity, 'find', () => queryResult([]))
  const sentCodes = []
  const restoreResend = stubResendProvider(sentCodes)
  const headers = { 'x-forwarded-for': '198.51.100.36' }
  try {
    for (let index = 0; index < 5; index += 1) {
      const response = await request('/auth/registration/email/send', {
        body: { email: `ip-limited-${index}@example.invalid` },
        headers,
      })
      assert.equal(response.status, 200)
    }
    const limited = await request('/auth/registration/email/send', {
      body: { email: 'ip-limited-final@example.invalid' },
      headers,
    })
    assert.equal(limited.status, 429)
    assert.match((await limited.json()).message, /too many verification requests/i)
    assert.equal(sentCodes.length, 5)
    assert.equal(store.documents.size, 5)
  } finally {
    restoreResend()
    restoreIdentityFind()
    store.restore()
    restoreDb()
  }
})

test('login resolves the identity mapping and issues only the canonical role and collection', async () => {
  const accountId = new mongoose.Types.ObjectId()
  const email = 'mapped-student@example.invalid'
  const username = 'mapped-student'
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4)
  const restoreIdentity = stub(AccountIdentity, 'findOne', () => queryResult({
    accountCollection: 'students',
    accountId,
    email,
    username,
  }))
  const restoreStudent = stub(Student, 'findById', () => {
    const result = Promise.resolve({
      _id: accountId,
      email,
      username,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      approvalStatus: 'approved',
      isActive: true,
      passwordHash,
    })
    result.select = () => result
    return result
  })
  const restoreRefreshSession = stub(RefreshSession, 'create', async () => ({}))
  try {
    const response = await request('/auth/login', {
      body: { identifier: email, password: 'correct-horse-battery', role: 'student' },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.user.role, 'student')
    const payload = jwt.verify(result.token, process.env.JWT_SECRET)
    assert.equal(payload.role, 'student')
    assert.equal(payload.accountCollection, 'students')
  } finally {
    restoreRefreshSession()
    restoreStudent()
    restoreIdentity()
  }
})

test('password login with student two-factor enabled requires OTP before issuing an access token', async () => {
  const accountId = new mongoose.Types.ObjectId()
  const email = 'otp-student@example.invalid'
  const username = 'otp-student'
  const sentCodes = []
  const otpStore = installOtpTestDoubles()
  const restoreEmail = stubResendProvider(sentCodes)
  const user = {
    _id: accountId,
    fullName: 'OTP Student',
    email,
    username,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
    twoFactorEnabled: true,
    passwordHash: await bcrypt.hash('correct-horse-battery', 4),
  }
  const restores = [
    stub(AccountIdentity, 'findOne', () => queryResult({
      accountCollection: 'students',
      accountId,
      email,
      username,
    })),
    stub(Student, 'findById', () => queryResult(user)),
  ]
  const otpHeaders = { 'X-Forwarded-For': '198.51.100.10' }
  try {
    const loginResponse = await request('/auth/login', {
      headers: otpHeaders,
      body: { identifier: email, password: 'correct-horse-battery', role: 'student' },
    })
    assert.equal(loginResponse.status, 200)
    const challenge = await loginResponse.json()
    assert.equal(challenge.requiresTwoFactor, true)
    assert.equal(typeof challenge.challengeToken, 'string')
    assert.equal(Object.hasOwn(challenge, 'token'), false)
    assert.equal(sentCodes.length, 1)

    const savedChallenge = [...otpStore.documents.values()][0]
    assert.ok(savedChallenge)
    assert.notEqual(savedChallenge.hashedOtp, sentCodes[0])

    const invalidResponse = await request('/auth/two-factor/verify', {
      headers: otpHeaders,
      body: { challengeToken: challenge.challengeToken, code: '000000' },
    })
    assert.equal(invalidResponse.status, 400)
    assert.equal(savedChallenge.attempts, 1)

    const verifyResponse = await request('/auth/two-factor/verify', {
      headers: otpHeaders,
      body: { challengeToken: challenge.challengeToken, code: sentCodes[0] },
    })
    assert.equal(verifyResponse.status, 200)
    const authenticated = await verifyResponse.json()
    assert.equal(jwt.verify(authenticated.token, process.env.JWT_SECRET).role, 'student')
    assert.equal(authenticated.user.twoFactorEnabled, true)

    const replayResponse = await request('/auth/two-factor/verify', {
      headers: otpHeaders,
      body: { challengeToken: challenge.challengeToken, code: sentCodes[0] },
    })
    assert.equal(replayResponse.status, 409)
  } finally {
    restores.reverse().forEach((restore) => restore())
    restoreEmail()
    otpStore.restore()
  }
})

test('student OTP resends honor cooldown and reset the limited attempt counter', async () => {
  const accountId = new mongoose.Types.ObjectId()
  const email = 'otp-limits@example.invalid'
  const username = 'otp-limits'
  const sentCodes = []
  const otpStore = installOtpTestDoubles()
  const restoreEmail = stubResendProvider(sentCodes)
  const user = {
    _id: accountId,
    email,
    username,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
    twoFactorEnabled: true,
    passwordHash: await bcrypt.hash('correct-horse-battery', 4),
  }
  const restores = [
    stub(AccountIdentity, 'findOne', () => queryResult({
      accountCollection: 'students',
      accountId,
      email,
      username,
    })),
    stub(Student, 'findById', () => queryResult(user)),
  ]
  const otpHeaders = { 'X-Forwarded-For': '198.51.100.13' }
  try {
    const login = await request('/auth/login', {
      headers: otpHeaders,
      body: { identifier: email, password: 'correct-horse-battery', role: 'student' },
    })
    const challenge = await login.json()
    assert.equal(challenge.requiresTwoFactor, true)
    assert.equal(sentCodes.length, 1)

    const tooSoon = await request('/auth/two-factor/resend', {
      headers: otpHeaders,
      body: { challengeToken: challenge.challengeToken },
    })
    assert.equal(tooSoon.status, 429)
    assert.ok((await tooSoon.json()).retryAfterSeconds > 0)

    const storedChallenge = [...otpStore.documents.values()][0]
    storedChallenge.lastSentAt = new Date(Date.now() - 61_000)
    const resent = await request('/auth/two-factor/resend', {
      headers: otpHeaders,
      body: { challengeToken: challenge.challengeToken },
    })
    assert.equal(resent.status, 200)
    const refreshedChallenge = await resent.json()
    assert.equal(sentCodes.length, 2)

    const wrongCode = sentCodes[1] === '000000' ? '000001' : '000000'
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await request('/auth/two-factor/verify', {
        headers: otpHeaders,
        body: { challengeToken: refreshedChallenge.challengeToken, code: wrongCode },
      })
      assert.equal(response.status, attempt === 5 ? 429 : 400)
    }

    storedChallenge.lastSentAt = new Date(Date.now() - 61_000)
    const freshCodeResponse = await request('/auth/two-factor/resend', {
      headers: otpHeaders,
      body: { challengeToken: refreshedChallenge.challengeToken },
    })
    assert.equal(freshCodeResponse.status, 200)
    const freshChallenge = await freshCodeResponse.json()
    assert.equal(storedChallenge.attempts, 0)

    const verified = await request('/auth/two-factor/verify', {
      headers: otpHeaders,
      body: { challengeToken: freshChallenge.challengeToken, code: sentCodes[2] },
    })
    assert.equal(verified.status, 200)

    const expiredLogin = await request('/auth/login', {
      headers: otpHeaders,
      body: { identifier: email, password: 'correct-horse-battery', role: 'student' },
    })
    const expiredChallenge = await expiredLogin.json()
    const expiredDocument = [...otpStore.documents.values()].find((document) =>
      String(document._id) === jwt.verify(expiredChallenge.challengeToken, process.env.JWT_SECRET).jti,
    )
    expiredDocument.expiresAt = new Date(Date.now() - 1000)
    const expiredVerification = await request('/auth/two-factor/verify', {
      headers: otpHeaders,
      body: { challengeToken: expiredChallenge.challengeToken, code: sentCodes[3] },
    })
    assert.equal(expiredVerification.status, 410)
  } finally {
    restores.reverse().forEach((restore) => restore())
    restoreEmail()
    otpStore.restore()
  }
})

test('Google login requires OTP for enabled students and retains normal login when disabled', async () => {
  const originalGetToken = OAuth2Client.prototype.getToken
  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken
  OAuth2Client.prototype.getToken = async () => ({ tokens: { id_token: 'test-id-token' } })
  OAuth2Client.prototype.verifyIdToken = async () => ({
    getPayload: () => ({
      sub: 'google-subject-for-tests',
      email: 'google-student@example.invalid',
      email_verified: true,
    }),
  })

  const sentCodes = []
  const otpStore = installOtpTestDoubles()
  const restoreEmail = stubResendProvider(sentCodes)
  const accountId = new mongoose.Types.ObjectId()
  const identity = {
    _id: new mongoose.Types.ObjectId(),
    email: 'google-student@example.invalid',
    username: 'google-student',
    googleSub: 'google-subject-for-tests',
    googleEmail: 'google-student@example.invalid',
    accountCollection: 'students',
    accountId,
  }
  let user = {
    _id: accountId,
    fullName: 'Google Student',
    email: identity.email,
    username: identity.username,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
    twoFactorEnabled: true,
  }
  const restores = [
    stub(AccountIdentity, 'findOne', () => queryResult(identity)),
    stub(Student, 'findById', () => queryResult(user)),
    stub(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
  ]
  const googleRequest = () => request('/auth/google', {
    headers: {
      Origin: process.env.CLIENT_ORIGIN,
      'X-Requested-With': 'XmlHttpRequest',
      'X-Forwarded-For': '198.51.100.11',
    },
    body: { code: 'test-authorization-code', role: 'student' },
  })
  try {
    const challengeResponse = await googleRequest()
    assert.equal(challengeResponse.status, 200)
    const challenge = await challengeResponse.json()
    assert.equal(challenge.requiresTwoFactor, true)
    assert.equal(Object.hasOwn(challenge, 'token'), false)
    assert.equal(sentCodes.length, 1)

    user = { ...user, twoFactorEnabled: false }
    const normalResponse = await googleRequest()
    assert.equal(normalResponse.status, 200)
    const normalLogin = await normalResponse.json()
    assert.equal(typeof normalLogin.token, 'string')
    assert.equal(normalLogin.requiresTwoFactor, undefined)
  } finally {
    restores.reverse().forEach((restore) => restore())
    restoreEmail()
    otpStore.restore()
    OAuth2Client.prototype.getToken = originalGetToken
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken
  }
})

test('student settings enable and disable two-factor only after email OTP verification', async () => {
  const studentId = new mongoose.Types.ObjectId()
  const sentCodes = []
  const otpStore = installOtpTestDoubles()
  const restoreEmail = stubResendProvider(sentCodes)
  const user = {
    _id: studentId,
    fullName: 'Settings Student',
    email: 'settings-student@example.invalid',
    username: 'settings-student',
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
    twoFactorEnabled: false,
    save: async function save() { return this },
  }
  const restoreStudent = stub(Student, 'findById', () => queryResult(user))
  const auth = { role: 'student', subject: String(studentId), accountCollection: 'students' }
  const otpHeaders = { 'X-Forwarded-For': '198.51.100.12' }
  try {
    const enableResponse = await request('/settings/two-factor/challenge', {
      ...auth,
      headers: otpHeaders,
      body: { action: 'enable' },
    })
    assert.equal(enableResponse.status, 200)
    const enableChallenge = await enableResponse.json()
    assert.equal(user.twoFactorEnabled, false)

    const wrongOtp = sentCodes[0] === '000000' ? '000001' : '000000'
    const wrongCode = await request('/settings/two-factor/verify', {
      ...auth,
      headers: otpHeaders,
      body: { challengeToken: enableChallenge.challengeToken, code: wrongOtp },
    })
    assert.equal(wrongCode.status, 400)
    assert.equal(user.twoFactorEnabled, false)

    const enabled = await request('/settings/two-factor/verify', {
      ...auth,
      headers: otpHeaders,
      body: { challengeToken: enableChallenge.challengeToken, code: sentCodes[0] },
    })
    assert.equal(enabled.status, 200)
    assert.equal(user.twoFactorEnabled, true)
    assert.equal((await enabled.json()).account.twoFactorEmail, 's********@example.invalid')

    const disableResponse = await request('/settings/two-factor/challenge', {
      ...auth,
      headers: otpHeaders,
      body: { action: 'disable' },
    })
    assert.equal(disableResponse.status, 200)
    const disableChallenge = await disableResponse.json()
    assert.equal(user.twoFactorEnabled, true)

    const disabled = await request('/settings/two-factor/verify', {
      ...auth,
      headers: otpHeaders,
      body: { challengeToken: disableChallenge.challengeToken, code: sentCodes[1] },
    })
    assert.equal(disabled.status, 200)
    assert.equal(user.twoFactorEnabled, false)
    assert.equal((await disabled.json()).account.twoFactorEnabled, false)
  } finally {
    restoreStudent()
    restoreEmail()
    otpStore.restore()
  }
})

test('login rejects old generic role aliases', async () => {
  const response = await request('/auth/login', {
    body: { identifier: 'student', password: 'password', role: 'user' },
  })
  assert.equal(response.status, 400)
})

test('admin course create stores nested modules and lessons in courses', async () => {
  let savedDocument
  const restoreAdmin = stub(Admin, 'findById', async () => ({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const restoreCreate = stub(Course, 'create', async (document) => {
    savedDocument = document
    return { ...document, _id: '68a000000000000000000020' }
  })
  try {
    const response = await request('/admin/courses', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: {
        title: 'Course',
        status: 'published',
        modules: [{
          title: 'Module',
          lessons: [{
            title: 'Lesson',
            description: 'Lesson description',
            content: 'Content',
            videoUrl: 'https://res.cloudinary.com/test/video/upload/lesson.mp4',
            videoPublicId: 'aihustle/courses/course/modules/module/lesson',
            videoFormat: 'mp4',
            videoBytes: 1200,
            durationSeconds: 190,
            attentionCheck: {
              enabled: true,
              questionsDuringVideo: 1,
              minIntervalSeconds: 30,
              maxIntervalSeconds: 75,
              questions: [{
                prompt: 'What did the lesson cover?',
                options: ['A', 'B'],
                correctOptionIndices: [1],
                selectedForPlayback: true,
              }],
            },
            resources: [{ title: 'Notes', url: 'https://res.cloudinary.com/test/raw/upload/notes.pdf', publicId: 'aihustle/courses/course/modules/module/notes.pdf', resourceType: 'raw', format: 'pdf', bytes: 420 }],
          }],
          quiz: {
            title: 'Module quiz',
            questions: [{ prompt: 'Choose both', type: 'multiple-select', options: ['A', 'B'], correctOptionIndices: [0, 1], marks: 2 }],
          },
          contentItems: [
            {
              type: 'video-lesson',
              title: 'Ordered video',
              videoUrl: 'https://example.com/video.mp4',
              content: 'Lesson text',
              attentionCheck: {
                enabled: true,
                minIntervalSeconds: 45,
                maxIntervalSeconds: 120,
                questions: [{
                  prompt: 'Which statement is true?',
                  options: ['True', 'False'],
                  type: 'true-false',
                  correctOptionIndices: [0],
                }],
              },
            },
            { type: 'quiz', title: 'Ordered quiz', quiz: { title: 'Ordered quiz', questions: [{ prompt: 'True?', type: 'true-false', options: ['True', 'False'], correctOptionIndices: [0] }] } },
            { type: 'assignment', title: 'Ordered assignment', description: 'Submit the exercise', points: 15 },
            { type: 'note', title: 'Ordered notes', content: 'Reference notes' },
          ],
        }],
        assignments: [{ title: 'Assignment', points: 10 }],
        quizzes: [{ title: 'Quiz', questions: [{ prompt: 'Question', options: ['A', 'B'], correctOptionIndex: 1 }] }],
      },
    })
    assert.equal(response.status, 201)
    assert.equal(savedDocument.generateCertificate, true)
    assert.equal(savedDocument.createdBy, '68a000000000000000000010')
    assert.equal(savedDocument.modules[0].lessons[0].title, 'Lesson')
    assert.equal(savedDocument.modules[0].lessons[0].description, 'Lesson description')
    assert.equal(savedDocument.modules[0].lessons[0].videoPublicId, 'aihustle/courses/course/modules/module/lesson')
    assert.equal(savedDocument.modules[0].lessons[0].videoBytes, 1200)
    assert.equal(savedDocument.modules[0].lessons[0].durationSeconds, 190)
    assert.equal(savedDocument.modules[0].lessons[0].attentionCheck.enabled, true)
    assert.equal(savedDocument.modules[0].lessons[0].attentionCheck.questionsDuringVideo, 1)
    assert.equal(savedDocument.modules[0].lessons[0].attentionCheck.minIntervalSeconds, 30)
    assert.equal(savedDocument.modules[0].lessons[0].attentionCheck.maxIntervalSeconds, 75)
    assert.equal(savedDocument.modules[0].lessons[0].attentionCheck.questions[0].selectedForPlayback, true)
    assert.deepEqual(savedDocument.modules[0].lessons[0].attentionCheck.questions[0].correctOptionIndices, [1])
    assert.equal(savedDocument.modules[0].lessons[0].resources[0].bytes, 420)
    assert.deepEqual(savedDocument.modules[0].quiz.questions[0].correctOptionIndices, [0, 1])
    assert.equal(savedDocument.modules[0].quiz.questions[0].marks, 2)
    assert.deepEqual(savedDocument.modules[0].contentItems.map((item) => item.type), ['video-lesson', 'quiz', 'assignment', 'note'])
    assert.deepEqual(savedDocument.modules[0].contentItems[1].quiz.questions[0].correctOptionIndices, [0])
    assert.equal(savedDocument.modules[0].contentItems[0].attentionCheck.questionsDuringVideo, 1)
    assert.equal(savedDocument.modules[0].contentItems[0].attentionCheck.questions[0].selectedForPlayback, true)
    assert.deepEqual(savedDocument.modules[0].contentItems[0].attentionCheck.questions[0].correctOptionIndices, [0])
    assert.equal(savedDocument.assignments[0].title, 'Assignment')
    assert.equal(savedDocument.quizzes[0].questions[0].correctOptionIndex, 1)
    assert.equal(Course.collection.name, 'courses')
  } finally {
    restoreCreate()
    restoreAdmin()
  }
})

test('admin course creation rejects malformed lesson resources', async () => {
  const restoreAdmin = stub(Admin, 'findById', () => queryResult({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  try {
    const response = await request('/admin/courses', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: {
        title: 'Course',
        modules: [{ title: 'Module', lessons: [{ title: 'Lesson', resources: 'not-an-array' }] }],
      },
    })
    assert.equal(response.status, 400)
    assert.match((await response.json()).message, /check lesson/i)
  } finally {
    restoreAdmin()
  }
})

test('admin course listing uses a non-conflicting projection for lessons and quiz fields', async () => {
  let projection
  let listLimit
  let enrollmentPipeline
  const query = {
    select(value) {
      projection = value
      return this
    },
    sort() {
      return this
    },
    limit(value) {
      listLimit = value
      return this
    },
    lean: async () => [],
  }
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Course, 'find', () => query),
    stub(Course, 'countDocuments', async (filter) => filter.status === 'published' ? 2 : filter.status === 'draft' ? 1 : 3),
    stub(Enrollment, 'aggregate', (pipeline) => {
      enrollmentPipeline = pipeline
      return Promise.resolve([{ total: 12 }])
    }),
  ]
  try {
    const response = await request('/admin/courses', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      courses: [],
      stats: { totalCourses: 3, publishedCourses: 2, draftCourses: 1, totalEnrolledStudents: 12 },
    })
    assert.ok(projection.includes('quizzes.questions.correctOptionIndex'))
    assert.equal(projection.split(/\s+/).includes('quizzes'), false)
    assert.ok(projection.includes('modules.lessons.title'))
    assert.ok(projection.includes('modules.lessons.videoUrl'))
    assert.ok(projection.includes('modules.lessons.resources'))
    assert.equal(projection.split(/\s+/).includes('modules.lessons'), false)
    assert.ok(projection.includes('+modules.lessons.attentionCheck.questions.correctOptionIndices'))
    assert.ok(projection.includes('modules.lessons.attentionCheck.questionsDuringVideo'))
    assert.ok(projection.includes('modules.lessons.attentionCheck.questions.selectedForPlayback'))
    assert.ok(projection.includes('+modules.quiz.questions.correctOptionIndices'))
    assert.equal(projection.split(/\s+/).includes('modules.contentItems'), false)
    assert.ok(projection.includes('modules.contentItems.title'))
    assert.ok(projection.includes('modules.contentItems.attentionCheck.questions.prompt'))
    assert.ok(projection.includes('+modules.contentItems.attentionCheck.questions.correctOptionIndices'))
    assert.ok(projection.includes('modules.contentItems.attentionCheck.questionsDuringVideo'))
    assert.ok(projection.includes('modules.contentItems.attentionCheck.questions.selectedForPlayback'))
    assert.ok(projection.includes('modules.contentItems.quiz.questions.prompt'))
    assert.ok(projection.includes('+modules.contentItems.quiz.questions.correctOptionIndices'))
    assert.equal(projection.split(/\s+/).includes('modules'), false)
    assert.equal(listLimit, undefined)
    assert.deepEqual(enrollmentPipeline, [
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: { userId: '$userId', collegeId: { $ifNull: ['$collegeId', null] } } } },
      { $count: 'total' },
    ])
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('admin course updates retain the course document and preserve legacy assignments and quizzes', async () => {
  const courseId = '68a000000000000000000020'
  let update
  let options
  const existing = {
    assignments: [{ _id: new mongoose.Types.ObjectId('68a000000000000000000021'), title: 'Legacy assignment', points: 10 }],
    quizzes: [{
      _id: new mongoose.Types.ObjectId('68a000000000000000000022'),
      title: 'Legacy quiz',
      questions: [{ _id: new mongoose.Types.ObjectId('68a000000000000000000023'), prompt: 'Legacy question', options: ['A', 'B'], correctOptionIndex: 1 }],
    }],
  }
  const existingQuery = {
    select() { return this },
    lean: async () => existing,
  }
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Course, 'findById', () => existingQuery),
    stub(Course, 'findByIdAndUpdate', async (id, value, updateOptions) => {
      assert.equal(String(id), courseId)
      update = value
      options = updateOptions
      return { _id: id, ...value.$set }
    }),
  ]
  try {
    const response = await request(`/admin/courses/${courseId}`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      method: 'PUT',
      body: {
        title: 'Updated course',
        description: 'Short course description',
        modules: [{ title: 'Module', lessons: [{ title: 'Lesson', videoUrl: 'https://cdn.example.invalid/lesson.mp4' }] }],
      },
    })
    assert.equal(response.status, 200)
    assert.equal(update.$set.title, 'Updated course')
    assert.equal(update.$set.assignments[0].title, 'Legacy assignment')
    assert.equal(update.$set.assignments[0]._id, '68a000000000000000000021')
    assert.equal(update.$set.quizzes[0].title, 'Legacy quiz')
    assert.equal(update.$set.quizzes[0]._id, '68a000000000000000000022')
    assert.equal(update.$set.quizzes[0].questions[0]._id, '68a000000000000000000023')
    assert.equal(options.new, true)
    assert.equal(options.runValidators, true)
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('admin course publishing rejects courses without lessons', async () => {
  const courseId = '68a000000000000000000020'
  const courseQuery = {
    select() { return this },
    lean: async () => ({ modules: [{ lessons: [] }] }),
  }
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Course, 'findById', () => courseQuery),
  ]
  try {
    const response = await request(`/admin/courses/${courseId}/status`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      method: 'PATCH',
      body: { status: 'published' },
    })
    assert.equal(response.status, 400)
    assert.match((await response.json()).message, /at least one module and one lesson/i)
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('Main Admin quiz question generation validates request options', async () => {
  const restoreAdmin = stub(Admin, 'findById', () => queryResult({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  try {
    const response = await request('/admin/courses/generate-quiz-questions', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: {
        lessonContent: 'A sufficiently long lesson body for generating quiz questions.',
        questionCount: 21,
        difficulty: 'intermediate',
        questionTypes: ['multiple-choice'],
      },
    })
    assert.equal(response.status, 400)
    assert.match((await response.json()).message, /question count from 1 to 20/i)
  } finally {
    restoreAdmin()
  }
})

test('quiz question generation returns structured draft questions without persistence', async () => {
  const expectedQuestions = [
    { prompt: 'Which statement is correct?', type: 'multiple-choice', options: ['A', 'B', 'C', 'D'], correctOptionIndices: [1] },
    { prompt: 'Select both valid options.', type: 'multiple-select', options: ['A', 'B', 'C', 'D'], correctOptionIndices: [0, 2] },
    { prompt: 'The statement is true.', type: 'true-false', options: ['True', 'False'], correctOptionIndices: [0] },
  ]
  let submittedUrl
  let submittedRequest
  let submittedHeaders
  const fetchImpl = async (url, options) => {
    submittedUrl = url
    submittedHeaders = options.headers
    submittedRequest = JSON.parse(options.body)
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: expectedQuestions }) }] } }],
    }), { status: 200 })
  }
  const questions = await generateQuizQuestions({
    lessonContent: 'Lesson content for the quiz.',
    questionCount: 3,
    difficulty: 'intermediate',
    questionTypes: ['multiple-choice', 'multiple-select', 'true-false'],
  }, { apiKey: 'test-only-gemini-key', fetchImpl })

  assert.equal(submittedUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
  assert.equal(submittedHeaders['x-goog-api-key'], 'test-only-gemini-key')
  assert.equal(submittedRequest.generationConfig.responseMimeType, 'application/json')
  assert.deepEqual(submittedRequest.generationConfig.responseSchema.properties.questions.items.properties.type.enum, [
    'multiple-choice',
    'multiple-select',
    'true-false',
  ])
  assert.match(submittedRequest.contents[0].parts[0].text, /Lesson content for the quiz/)
  assert.equal(questions.length, 3)
  assert.deepEqual(questions.map((question) => question.type), ['multiple-choice', 'multiple-select', 'true-false'])
  assert.deepEqual(questions[1].correctOptionIndices, [0, 2])
  assert.equal(questions[2].marks, 1)
  assert.deepEqual(questions.map((question) => question.order), [0, 1, 2])
})

test('quiz question generation rejects invalid structured model output', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            questions: [{ prompt: 'Select an answer.', type: 'multiple-select', options: ['A', 'B', 'C', 'D'], correctOptionIndices: [0] }],
          }),
        }],
      },
    }],
  }), { status: 200 })
  await assert.rejects(
    generateQuizQuestions({
      lessonContent: 'Lesson content.',
      questionCount: 1,
      difficulty: 'beginner',
      questionTypes: ['multiple-select'],
    }, { apiKey: 'test-only-gemini-key', fetchImpl }),
    /invalid format/i,
  )
})

test('quiz question generation reports Gemini API errors without exposing the API key', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    error: { message: 'Invalid API key test-only-gemini-key', status: 'UNAUTHENTICATED' },
  }), { status: 401 })
  await assert.rejects(
    generateQuizQuestions({
      lessonContent: 'Lesson content.',
      questionCount: 1,
      difficulty: 'beginner',
      questionTypes: ['multiple-choice'],
    }, { apiKey: 'test-only-gemini-key', fetchImpl }),
    (error) => error.status === 401 && error.message.includes('test-only-gemini-key'),
  )
})

test('quiz question generation requires a configured Gemini API key', async () => {
  await assert.rejects(
    generateQuizQuestions({
      lessonContent: 'Lesson content.',
      questionCount: 1,
      difficulty: 'beginner',
      questionTypes: ['multiple-choice'],
    }),
    /Gemini API key is not configured/i,
  )
})

test('admin quiz generation returns editable questions and surfaces sanitized provider errors', async () => {
  let providerResult = {
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            questions: [{
              prompt: 'Which fact is correct?',
              type: 'multiple-choice',
              options: ['A', 'B', 'C', 'D'],
              correctOptionIndices: [1],
            }],
          }),
        }],
      },
    }],
  }
  const originalFetch = globalThis.fetch
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(globalThis, 'fetch', async (url, options) => {
      if (String(url).startsWith(baseUrl)) return originalFetch(url, options)
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
      return new Response(JSON.stringify(providerResult), {
        status: providerResult.error ? 401 : 200,
      })
    }),
  ]
  try {
    const response = await request('/admin/courses/generate-quiz-questions', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: {
        lessonContent: 'Python is a programming language.',
        questionCount: 1,
        difficulty: 'beginner',
        questionTypes: ['multiple-choice'],
      },
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).questions[0].prompt, 'Which fact is correct?')

    providerResult = {
      error: { message: 'Invalid API key test-only-gemini-key', status: 'UNAUTHENTICATED' },
    }
    const failedResponse = await request('/admin/courses/generate-quiz-questions', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: {
        lessonContent: 'Python is a programming language.',
        questionCount: 1,
        difficulty: 'beginner',
        questionTypes: ['multiple-choice'],
      },
    })
    assert.equal(failedResponse.status, 502)
    const failure = await failedResponse.json()
    assert.match(failure.message, /Invalid API key \[redacted\]/)
    assert.equal(failure.message.includes('test-only-gemini-key'), false)
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('admin draft course deletion removes the course and its unreferenced Cloudinary assets', async () => {
  const courseId = '68a000000000000000000020'
  const course = {
    _id: courseId,
    status: 'draft',
    thumbnailPublicId: 'aihustle/courses/course-assets/thumbnail',
    modules: [{
      lessons: [{
        videoPublicId: 'aihustle/courses/module/video',
        resources: [{ publicId: 'aihustle/courses/module/notes.pdf', resourceType: 'raw' }],
      }],
    }],
  }
  const deletedAssets = []
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Course, 'findById', () => queryResult(course)),
    stub(Course, 'findOneAndDelete', (filter) => {
      assert.equal(String(filter._id), courseId)
      assert.equal(filter.status, 'draft')
      return queryResult(course)
    }),
    stub(Course, 'exists', async () => null),
    stub(cloudinary.uploader, 'destroy', async (publicId, options) => {
      deletedAssets.push({ publicId, resourceType: options.resource_type })
      return { result: 'ok' }
    }),
  ]
  try {
    const response = await request(`/admin/courses/${courseId}`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      method: 'DELETE',
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      message: 'Draft course deleted.',
      assetCleanupFailed: false,
    })
    assert.deepEqual(deletedAssets, [
      { publicId: 'aihustle/courses/course-assets/thumbnail', resourceType: 'image' },
      { publicId: 'aihustle/courses/module/video', resourceType: 'video' },
      { publicId: 'aihustle/courses/module/notes.pdf', resourceType: 'raw' },
    ])
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('admin course deletion refuses published courses', async () => {
  const courseId = '68a000000000000000000020'
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Course, 'findById', () => queryResult({ _id: courseId, status: 'published' })),
    stub(Course, 'findOneAndDelete', () => {
      assert.fail('Published courses must not be deleted.')
    }),
  ]
  try {
    const response = await request(`/admin/courses/${courseId}`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      method: 'DELETE',
    })
    assert.equal(response.status, 400)
    assert.match((await response.json()).message, /only draft courses/i)
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('admin draft course deletion reports Cloudinary cleanup failures after deleting the course', async () => {
  const courseId = '68a000000000000000000020'
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Course, 'findById', () => queryResult({
      _id: courseId,
      status: 'draft',
      thumbnailPublicId: 'aihustle/courses/course-assets/thumbnail',
      modules: [],
    })),
    stub(Course, 'findOneAndDelete', () => queryResult({
      _id: courseId,
      status: 'draft',
      thumbnailPublicId: 'aihustle/courses/course-assets/thumbnail',
      modules: [],
    })),
    stub(Course, 'exists', async () => null),
    stub(cloudinary.uploader, 'destroy', async () => { throw new Error('provider unavailable') }),
  ]
  try {
    const response = await request(`/admin/courses/${courseId}`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      method: 'DELETE',
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      message: 'Draft course deleted, but some associated Cloudinary files could not be removed.',
      assetCleanupFailed: true,
    })
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('Main Admin Cloudinary health check reports provider status without exposing details', async () => {
  const restoreAdmin = stub(Admin, 'findById', () => queryResult({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const restorePing = stub(cloudinary.api, 'ping', async () => ({ status: 'ok' }))
  try {
    const response = await request('/admin/cloudinary/health', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { connected: true })
  } finally {
    restorePing()
    restoreAdmin()
  }
})

test('Cloudinary health check sanitizes provider errors and rejects non-admin roles', async () => {
  const restoreAdmin = stub(Admin, 'findById', () => queryResult({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const restorePing = stub(cloudinary.api, 'ping', async () => { throw new Error('private provider details') })
  try {
    const failedResponse = await request('/admin/cloudinary/health', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(failedResponse.status, 503)
    assert.deepEqual(await failedResponse.json(), {
      connected: false,
      message: 'Cloudinary is currently unavailable.',
    })

    const restoreStudent = stub(Student, 'findById', () => queryResult({
      _id: '68a000000000000000000040',
      role: 'student',
      status: 'active',
      isActive: true,
    }))
    try {
      const forbidden = await request('/admin/cloudinary/health', {
        role: 'student',
        subject: '68a000000000000000000040',
      })
      assert.equal(forbidden.status, 403)
    } finally {
      restoreStudent()
    }
  } finally {
    restorePing()
    restoreAdmin()
  }
})

test('admin course thumbnail signatures are server-generated and do not expose the Cloudinary secret', async () => {
  const restoreAdmin = stub(Admin, 'findById', () => queryResult({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  try {
    const response = await request('/admin/course-assets/signature', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: { resourceType: 'image' },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    const signatureInput = `folder=${result.folder}&public_id=${result.publicId}&timestamp=${result.timestamp}test-only-cloudinary-secret`
    assert.equal(result.signature, createHash('sha1').update(signatureInput).digest('hex'))
    assert.equal(result.cloudName, 'test-cloud')
    assert.equal(result.apiKey, 'test-cloudinary-key')
    assert.equal(JSON.stringify(result).includes('test-only-cloudinary-secret'), false)
  } finally {
    restoreAdmin()
  }
})

test('Main Admin video uploads use Cloudinary video storage and clean up temporary files', async () => {
  const courseId = '68a000000000000000000020'
  const moduleId = '68a000000000000000000021'
  let uploadedPath
  let cloudinaryRequest
  const originalFetch = globalThis.fetch
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Course, 'findById', () => ({ select() { return this }, lean: async () => ({ _id: courseId }) })),
    stub(globalThis, 'fetch', async (url, options) => {
      if (String(url).includes('api.cloudinary.com')) {
        cloudinaryRequest = { url: String(url), body: options.body }
        return new Response(JSON.stringify({
        secure_url: 'https://res.cloudinary.com/test/video/upload/lesson.mp4',
        public_id: `aihustle/courses/${courseId}/modules/${moduleId}/lesson`,
        duration: 94.2,
        format: 'mp4',
        bytes: 16,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return originalFetch(url, options)
    }),
  ]
  try {
    const response = await mediaRequest(`/admin/courses/${courseId}/modules/${moduleId}/media/video`, {
      fileName: 'lesson.mp4',
      mimeType: 'application/octet-stream',
      contents: Buffer.from('0000ftypisom0000'),
    })
    assert.equal(response.status, 201)
    const result = await response.json()
    assert.equal(result.url, 'https://res.cloudinary.com/test/video/upload/lesson.mp4')
    assert.equal(result.duration, 94.2)
    assert.equal(result.resourceType, 'video')
    assert.equal(cloudinaryRequest.url, `https://api.cloudinary.com/v1_1/test-cloud/video/upload`)
    assert.equal(cloudinaryRequest.body.get('folder'), `aihustle/courses/${courseId}/modules/${moduleId}`)
    assert.equal(cloudinaryRequest.body.get('api_key'), 'test-cloudinary-key')
    assert.ok(cloudinaryRequest.body.get('signature'))
    assert.equal(cloudinaryRequest.body.get('file').name, 'lesson.mp4')
    assert.equal(JSON.stringify(result).includes('test-only-cloudinary-secret'), false)
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('Main Admin video upload exposes a sanitized Cloudinary error message', async () => {
  const courseId = '68a000000000000000000020'
  const moduleId = '68a000000000000000000021'
  const originalFetch = globalThis.fetch
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Course, 'findById', () => ({ select() { return this }, lean: async () => ({ _id: courseId }) })),
    stub(globalThis, 'fetch', async (url, options) => {
      if (String(url).includes('api.cloudinary.com')) {
        return new Response(JSON.stringify({ error: { message: 'Video uploads are disabled for this account.' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return originalFetch(url, options)
    }),
  ]
  try {
    const response = await mediaRequest(`/admin/courses/${courseId}/modules/${moduleId}/media/video`, {
      fileName: 'lesson.mp4',
      mimeType: 'video/mp4',
      contents: Buffer.from('0000ftypisom0000'),
    })
    assert.equal(response.status, 502)
    const result = await response.json()
    assert.equal(result.message, 'Cloudinary upload failed: Video uploads are disabled for this account.')
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('Main Admin resource uploads store PDFs as Cloudinary raw assets', async () => {
  const courseId = '68a000000000000000000020'
  const moduleId = '68a000000000000000000021'
  let uploadOptions
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Course, 'findById', () => ({ select() { return this }, lean: async () => ({ _id: courseId }) })),
    stub(cloudinary.uploader, 'upload', async (_filePath, options) => {
      uploadOptions = options
      return { secure_url: 'https://res.cloudinary.com/test/raw/upload/notes.pdf', public_id: `${options.folder}/${options.public_id}`, bytes: 9, format: 'pdf' }
    }),
  ]
  try {
    const response = await mediaRequest(`/admin/courses/${courseId}/modules/${moduleId}/media/resource`, {
      fileName: 'notes.pdf',
      mimeType: 'application/pdf',
      contents: Buffer.from('%PDF-1.7\n'),
    })
    assert.equal(response.status, 201)
    assert.equal((await response.json()).resourceType, 'raw')
    assert.equal(uploadOptions.resource_type, 'raw')
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('course media uploads reject invalid signatures and oversized files', async () => {
  const courseId = '68a000000000000000000020'
  const moduleId = '68a000000000000000000021'
  const restoreAdmin = stub(Admin, 'findById', () => queryResult({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const restoreCourse = stub(Course, 'findById', () => ({ select() { return this }, lean: async () => ({ _id: courseId }) }))
  try {
    const invalidVideo = await mediaRequest(`/admin/courses/${courseId}/modules/${moduleId}/media/video`, {
      fileName: 'lesson.mp4',
      mimeType: 'video/mp4',
      contents: Buffer.from('not an mp4 file'),
    })
    assert.equal(invalidVideo.status, 415)
    const oversizedVideo = await mediaRequest(`/admin/courses/${courseId}/modules/${moduleId}/media/video`, {
      fileName: 'lesson.mp4',
      mimeType: 'video/mp4',
      contents: Buffer.concat([Buffer.from('0000ftypisom'), Buffer.alloc(117)]),
    })
    assert.equal(oversizedVideo.status, 413)
    const oversizedPdf = await mediaRequest(`/admin/courses/${courseId}/modules/${moduleId}/media/resource`, {
      fileName: 'notes.pdf',
      mimeType: 'application/pdf',
      contents: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(124)]),
    })
    assert.equal(oversizedPdf.status, 413)
  } finally {
    restoreCourse()
    restoreAdmin()
  }
})

test('course media uploads reject student accounts before accepting files', async () => {
  const restoreStudent = stub(Student, 'findById', () => queryResult({
    _id: '68a000000000000000000040',
    role: 'student',
    status: 'active',
    isActive: true,
  }))
  try {
    const response = await mediaRequest('/admin/courses/68a000000000000000000020/modules/68a000000000000000000021/media/video', {
      role: 'student',
      subject: '68a000000000000000000040',
      fileName: 'lesson.mp4',
      mimeType: 'video/mp4',
      contents: Buffer.from('0000ftypisom0000'),
    })
    assert.equal(response.status, 403)
  } finally {
    restoreStudent()
  }
})

test('course media deletion leaves assets referenced by another course untouched', async () => {
  let destroyCalled = false
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Course, 'exists', async () => true),
    stub(cloudinary.uploader, 'destroy', async () => { destroyCalled = true; return { result: 'ok' } }),
  ]
  try {
    const response = await request('/admin/course-assets/delete', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: { publicId: 'aihustle/courses/shared-video', resourceType: 'video' },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { deleted: false, shared: true })
    assert.equal(destroyCalled, false)
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('student course listing stays on the published student API and omits quiz answers', async () => {
  let filter
  let projection
  let limited = false
  const query = {
    select(value) {
      projection = value
      return this
    },
    sort() {
      return this
    },
    limit() {
      limited = true
      return this
    },
    lean: async () => [{
      _id: '68a000000000000000000030',
      title: 'Published course',
      description: 'Learn Python from the published course.',
      category: 'Programming',
      thumbnailUrl: 'https://res.cloudinary.com/test/image/upload/python.jpg',
      quizzes: [{
        title: 'Quiz',
        questions: [{
          prompt: 'Question',
          options: ['A', 'B'],
          correctOptionIndex: 1,
        }],
      }],
      modules: [{
        title: 'Module',
        lessons: [{
          title: 'Legacy lesson',
          attentionCheck: {
            enabled: true,
            minIntervalSeconds: 30,
            maxIntervalSeconds: 120,
            questions: [{ prompt: 'Question', options: ['A', 'B'], correctOptionIndices: [1] }],
          },
        }],
        contentItems: [{
          type: 'video-lesson',
          title: 'Content item lesson',
          attentionCheck: {
            enabled: true,
            minIntervalSeconds: 45,
            maxIntervalSeconds: 180,
            questions: [{ prompt: 'Question', options: ['A', 'B'], correctOptionIndices: [0] }],
          },
        }],
        quiz: {
          title: 'Module quiz',
          questions: [{ prompt: 'Question', options: ['A', 'B'], correctOptionIndices: [1] }],
        },
      }],
    }],
  }
  const restores = [
    stub(Student, 'findById', () => queryResult({
      _id: '68a000000000000000000040',
      role: 'student',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Course, 'find', (value) => {
      filter = value
      return query
    }),
  ]
  try {
    const response = await request('/courses', {
      role: 'student',
      subject: '68a000000000000000000040',
    })
    assert.equal(response.status, 200)
    assert.deepEqual(filter, { status: 'published' })
    assert.equal(projection, 'title description detailedDescription category difficulty thumbnailUrl learningObjectives prerequisites estimatedDurationMinutes modules assignments quizzes status createdAt')
    assert.equal(limited, false)
    const result = await response.json()
    assert.equal(result.courses[0].title, 'Published course')
    assert.equal(result.courses[0].category, 'Programming')
    assert.equal(result.courses[0].thumbnailUrl, 'https://res.cloudinary.com/test/image/upload/python.jpg')
    assert.equal('correctOptionIndex' in result.courses[0].quizzes[0].questions[0], false)
    assert.equal('correctOptionIndices' in result.courses[0].modules[0].quiz.questions[0], false)
    assert.deepEqual(result.courses[0].modules[0].lessons[0].attentionCheck, {
      enabled: true,
      questionsDuringVideo: 1,
      minIntervalSeconds: 30,
      maxIntervalSeconds: 120,
    })
    assert.deepEqual(result.courses[0].modules[0].contentItems[0].attentionCheck, {
      enabled: true,
      questionsDuringVideo: 1,
      minIntervalSeconds: 45,
      maxIntervalSeconds: 180,
    })
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('student can discover a published course, enroll, and see it in My Courses', async () => {
  const studentId = '68a000000000000000000061'
  const courseId = '68a000000000000000000062'
  const enrollmentId = '68a000000000000000000063'
  let publishedCourse = null
  const savedEnrollment = {
    _id: enrollmentId,
    userId: studentId,
    courseId,
    assignedBy: studentId,
    status: 'active',
    completedLessonIds: [],
  }
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Student, 'findById', async () => ({
      _id: studentId,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Student, 'findOne', () => queryResult({ _id: studentId })),
    stub(Course, 'create', async (document) => {
      publishedCourse = { ...document, _id: courseId }
      return publishedCourse
    }),
    stub(Course, 'find', () => ({
      select() { return this },
      sort() { return this },
      lean: async () => publishedCourse ? [publishedCourse] : [],
    })),
    stub(Course, 'findOne', () => queryResult({ _id: courseId })),
    stub(Enrollment, 'findOne', () => queryResult(null)),
    stub(Enrollment, 'create', async (documents) => [{ ...documents[0], _id: enrollmentId }]),
    stub(Enrollment, 'find', () => ({
      populate() { return this },
      sort() { return this },
      lean: async () => publishedCourse ? [{ ...savedEnrollment, courseId: publishedCourse }] : [],
    })),
  ]

  try {
    const emptyAvailableResponse = await request('/courses', {
      role: 'student',
      subject: studentId,
    })
    assert.equal(emptyAvailableResponse.status, 200)
    assert.deepEqual((await emptyAvailableResponse.json()).courses, [])

    const publishResponse = await request('/admin/courses', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: {
        title: 'Python',
        description: 'Learn Python.',
        category: 'Programming',
        difficulty: 'beginner',
        thumbnailUrl: 'https://res.cloudinary.com/test/image/upload/python.jpg',
        learningObjectives: ['Write Python programs'],
        prerequisites: ['None'],
        estimatedDurationMinutes: 5,
        status: 'published',
        modules: [{ title: 'Python basics', lessons: [{ title: 'Introduction', content: 'Start here.' }] }],
      },
    })
    assert.equal(publishResponse.status, 201)
    assert.equal(publishedCourse.status, 'published')

    const availableResponse = await request('/courses', {
      role: 'student',
      subject: studentId,
    })
    assert.equal(availableResponse.status, 200)
    const availableResult = await availableResponse.json()
    assert.equal(availableResult.courses[0].title, 'Python')
    assert.equal(availableResult.courses[0].thumbnailUrl, publishedCourse.thumbnailUrl)
    assert.deepEqual(availableResult.courses[0].learningObjectives, ['Write Python programs'])
    assert.deepEqual(availableResult.courses[0].prerequisites, ['None'])

    const enrollmentResponse = await request('/enrollments', {
      role: 'student',
      subject: studentId,
      body: { courseId },
    })
    assert.equal(enrollmentResponse.status, 201)
    assert.equal((await enrollmentResponse.json()).enrollment._id, enrollmentId)

    const myCoursesResponse = await request('/enrollments/me', {
      role: 'student',
      subject: studentId,
    })
    assert.equal(myCoursesResponse.status, 200)
    const myCoursesResult = await myCoursesResponse.json()
    assert.equal(myCoursesResult.enrollments[0].courseId._id, courseId)
    assert.equal(myCoursesResult.enrollments[0].status, 'active')
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('college student import saves to clg_students and maps the identity', async () => {
  const collegeId = '68a000000000000000000064'
  let savedStudent
  let savedIdentity
  const restoreAdmin = stub(Admin, 'findById', async () => ({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const restoreDb = stubDatabase({
    collection: () => ({ findOne: async () => ({ _id: new mongoose.Types.ObjectId(collegeId) }) }),
  })
  const restores = [
    stub(AccountIdentity, 'exists', async () => false),
    stub(CollegeStudent, 'exists', async () => false),
    stub(CollegeStudent, 'findOne', () => queryResult(null)),
    stub(Student, 'exists', async () => false),
    stub(CollegeAdmin, 'exists', async () => false),
    stub(Admin, 'exists', async () => false),
    stub(CollegeAdmin, 'find', () => queryResult([])),
    stub(CollegeStudent, 'create', async (documents) => {
      savedStudent = documents[0]
      return [{ ...documents[0] }]
    }),
    stub(AccountIdentity, 'create', async (documents) => {
      savedIdentity = documents[0]
      return documents
    }),
    stub(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
  ]
  try {
    const response = await request('/admin/students/import', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: {
        collegeId,
        csvText: 'Full Name,Student ID,Email,Department,Batch\nCollege Student,S-100,student@example.invalid,Science,2026',
      },
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).summary.imported, 1)
    assert.equal(savedStudent.role, 'student')
    assert.equal(savedStudent.studentType, 'college')
    assert.equal(String(savedStudent.collegeId), collegeId)
    assert.equal(CollegeStudent.collection.name, 'clg_students')
    assert.equal(savedIdentity.accountCollection, 'clg_students')
    assert.equal(String(savedIdentity.accountId), String(savedStudent._id))
  } finally {
    for (const restore of restores.reverse()) restore()
    restoreDb()
    restoreAdmin()
  }
})

test('college student CSV import rejects students beyond the configured Sub-Admin limit', async () => {
  const collegeId = '68a000000000000000000065'
  let studentCreated = false
  const restoreAdmin = stub(Admin, 'findById', async () => ({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const restoreDb = stubDatabase({
    collection: () => ({ findOne: async () => ({ _id: new mongoose.Types.ObjectId(collegeId) }) }),
  })
  const restores = [
    stub(AccountIdentity, 'exists', async () => false),
    stub(CollegeStudent, 'exists', async () => false),
    stub(CollegeStudent, 'findOne', () => queryResult(null)),
    stub(Student, 'exists', async () => false),
    stub(CollegeAdmin, 'exists', async () => false),
    stub(Admin, 'exists', async () => false),
    stub(CollegeAdmin, 'find', () => queryResult([{ studentLimit: 0 }])),
    stub(CollegeStudent, 'countDocuments', () => queryResult(0)),
    stub(AccountIdentity, 'create', async (documents) => documents),
    stub(CollegeStudent, 'create', async () => { studentCreated = true }),
    stub(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
  ]
  try {
    const response = await request('/admin/students/import', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: {
        collegeId,
        csvText: 'Full Name,Student ID,Email,Department,Batch\nOver Limit,C-101,over-limit@example.invalid,Science,2026',
      },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.summary.imported, 0)
    assert.equal(result.summary.failed, 1)
    assert.match(result.failures[0].reason, /configured student limit of 0/)
    assert.equal(studentCreated, false)
  } finally {
    restores.reverse().forEach((restore) => restore())
    restoreDb()
    restoreAdmin()
  }
})

test('college sub-admin invite records the account in sub_admins and identity mapping', async () => {
  const collegeId = '68a000000000000000000061'
  let savedIdentity
  let savedAccount
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(College, 'exists', async () => true),
    stub(AccountIdentity, 'exists', async () => false),
    stub(CollegeStudent, 'exists', async () => false),
    stub(Student, 'exists', async () => false),
    stub(CollegeAdmin, 'exists', async () => false),
    stub(Admin, 'exists', async () => false),
    stub(CollegeAdmin, 'create', async (documents) => {
      savedAccount = documents[0]
      return [{ ...documents[0] }]
    }),
    stub(AccountIdentity, 'create', async (documents) => {
      savedIdentity = documents[0]
      return [documents[0]]
    }),
    stub(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
    stubResendApi(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Test Resend recipient rejected' }),
    })),
  ]
  try {
    const response = await request(`/admin/colleges/${collegeId}/sub-admins`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: {
        fullName: 'Sub Admin',
        email: 'subadmin@example.invalid',
        username: 'sub-admin',
        studentLimit: 500,
      },
    })
    assert.equal(response.status, 503)
    const result = await response.json()
    assert.equal(result.activationEmailSent, false)
    assert.equal(result.accountId, String(savedAccount._id))
    assert.equal(savedAccount.role, 'college_admin')
    assert.equal(savedAccount.status, 'invitation_pending')
    assert.equal(savedAccount.isActive, false)
    assert.equal(savedAccount.studentLimit, 500)
    assert.equal(savedAccount.passwordHash, undefined)
    assert.match(savedAccount.activationTokenHash, /^[a-f\d]{64}$/)
    assert.equal(String(savedAccount.collegeId), collegeId)
    assert.equal(savedIdentity.accountCollection, 'sub_admins')
    assert.equal(String(savedIdentity.accountId), String(savedAccount._id))
    assert.equal(CollegeAdmin.collection.name, 'sub_admins')
    assert.equal(AccountIdentity.collection.name, 'accountidentities')
  } finally {
    for (const restore of restores.reverse()) restore()
  }
})

test('college sub-admin invite requires a positive whole-number student registration limit', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = '68a000000000000000000066'
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
  ]
  try {
    for (const studentLimit of [undefined, 0, -1, 1.5, '5']) {
      const response = await request(`/admin/colleges/${collegeId}/sub-admins`, {
        role: 'main_admin',
        subject: adminId,
        body: {
          fullName: 'Sub Admin',
          email: 'subadmin@example.invalid',
          username: 'sub-admin',
          ...(studentLimit === undefined ? {} : { studentLimit }),
        },
      })
      assert.equal(response.status, 400)
      assert.match((await response.json()).message, /positive whole-number/)
    }
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('college sub-admin dashboard returns assigned limit and college-wide student slots', async () => {
  const collegeId = '68a000000000000000000067'
  const adminId = '68a000000000000000000068'
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000069')
  const restores = [
    stub(CollegeAdmin, 'findById', () => queryResult({
      _id: new mongoose.Types.ObjectId(adminId),
      role: 'college_admin',
      status: 'active',
      isActive: true,
      collegeId: new mongoose.Types.ObjectId(collegeId),
      studentLimit: 500,
    })),
    stub(College, 'findById', () => queryResult({ _id: new mongoose.Types.ObjectId(collegeId), name: 'Dashboard College' })),
    stub(CollegeStudent, 'find', () => queryResult([{ _id: studentId }])),
    stub(CollegeAdmin, 'find', () => queryResult([{ studentLimit: 500 }])),
    stub(CollegeStudent, 'countDocuments', async (filter) => {
      assert.equal(String(filter.collegeId), collegeId)
      assert.equal(filter.studentType, 'college')
      return 350
    }),
    stub(Course, 'find', () => queryResult([])),
    stub(Enrollment, 'find', () => queryResult([])),
  ]
  try {
    const response = await request('/college/dashboard', {
      role: 'college_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.studentLimit, 500)
    assert.equal(result.totalStudents, 350)
    assert.equal(result.remainingSlots, 150)
    assert.equal(result.students.length, 1)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('college sub-admin can add a student only within the assigned college limit', async () => {
  const collegeId = '68a000000000000000000070'
  const adminId = '68a000000000000000000071'
  const restores = [
    stub(CollegeAdmin, 'findById', () => queryResult({
      _id: new mongoose.Types.ObjectId(adminId),
      role: 'college_admin',
      status: 'active',
      isActive: true,
      collegeId: new mongoose.Types.ObjectId(collegeId),
      studentLimit: 500,
    })),
    stub(CollegeAdmin, 'find', () => queryResult([{ studentLimit: 500 }])),
    stub(CollegeStudent, 'countDocuments', () => queryResult(10)),
    stub(AccountIdentity, 'exists', async () => false),
    stub(AccountIdentity, 'findOne', () => queryResult(null)),
    stub(AccountIdentity, 'create', async () => []),
    stub(CollegeAdmin, 'exists', async () => false),
    stub(CollegeStudent, 'exists', async () => false),
    stub(Student, 'exists', async () => false),
    stub(Admin, 'exists', async () => false),
    stub(Student, 'findOne', () => queryResult(null)),
    stub(CollegeStudent, 'findOne', () => queryResult(null)),
    stub(CollegeStudent, 'create', async (documents) => documents),
    stub(mongoose, 'startSession', () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
  ]
  try {
    const response = await request('/college/students', {
      role: 'college_admin',
      subject: adminId,
      method: 'POST',
      body: {
        fullName: 'College Student',
        email: 'college.student@example.invalid',
        username: 'college-student',
        password: 'secure-password',
        studentId: 'CS-100',
      },
    })
    assert.equal(response.status, 201)
    const result = await response.json()
    assert.equal(result.student.studentId, 'CS-100')
    assert.equal(result.student.email, 'college.student@example.invalid')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('college sub-admin bulk import rejects students when the college limit is reached', async () => {
  const collegeId = '68a000000000000000000072'
  const adminId = '68a000000000000000000073'
  let studentCreated = false
  const restores = [
    stub(CollegeAdmin, 'findById', () => queryResult({
      _id: new mongoose.Types.ObjectId(adminId),
      role: 'college_admin',
      status: 'active',
      isActive: true,
      collegeId: new mongoose.Types.ObjectId(collegeId),
      studentLimit: 1,
    })),
    stub(CollegeAdmin, 'find', () => queryResult([{ studentLimit: 1 }])),
    stub(CollegeStudent, 'countDocuments', () => queryResult(1)),
    stub(AccountIdentity, 'exists', async () => false),
    stub(CollegeStudent, 'findOne', () => queryResult(null)),
    stub(Student, 'findOne', () => queryResult(null)),
    stub(CollegeAdmin, 'exists', async () => false),
    stub(CollegeStudent, 'exists', async () => false),
    stub(Student, 'exists', async () => false),
    stub(Admin, 'exists', async () => false),
    stub(CollegeStudent, 'create', async () => { studentCreated = true }),
    stub(mongoose, 'startSession', () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
  ]
  try {
    const response = await request('/college/students/import', {
      role: 'college_admin',
      subject: adminId,
      method: 'POST',
      body: {
        csvText: 'Full Name,Student ID,Email,Department,Batch\nNew Student,CS-200,new.student@example.invalid,Engineering,2026',
      },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.summary.imported, 0)
    assert.equal(result.summary.failed, 1)
    assert.match(result.failures[0].reason, /configured student limit of 1/)
    assert.equal(studentCreated, false)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('activation consumes an expiring token and only stores a password hash', async () => {
  const activationToken = 'one-time-activation-token-value-long-enough'
  let updateFilter
  let updateDocument
  const restoreActivation = stub(CollegeAdmin, 'findOneAndUpdate', (filter, update) => {
    updateFilter = filter
    updateDocument = update
    const result = Promise.resolve({ _id: '68a000000000000000000063' })
    result.select = () => result
    return result
  })
  try {
    const response = await request('/auth/activate', {
      body: { token: activationToken, password: 'a-strong-password', confirmPassword: 'a-strong-password' },
    })
    assert.equal(response.status, 200)
    assert.equal(
      updateFilter.activationTokenHash,
      createHash('sha256').update(activationToken).digest('hex'),
    )
    assert.ok(updateFilter.activationTokenExpiresAt.$gt instanceof Date)
    assert.equal(updateFilter.status, 'invitation_pending')
    assert.equal(await bcrypt.compare('a-strong-password', updateDocument.$set.passwordHash), true)
    assert.notEqual(updateDocument.$set.passwordHash, 'a-strong-password')
    assert.equal(updateDocument.$set.status, 'active')
    assert.equal(updateDocument.$set.isActive, true)
    assert.ok('activationTokenHash' in updateDocument.$unset)
  } finally {
    restoreActivation()
  }
})

test('independent student enrollment saves to enrollment without collegeId', async () => {
  const studentId = '68a000000000000000000030'
  const courseId = '68a000000000000000000040'
  let savedDocument
  const restoreStudentAuth = stub(Student, 'findById', async () => ({
    _id: studentId,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
  }))
  const restoreStudentLookup = stub(Student, 'findOne', (query) => {
    assert.equal(query.role, 'student')
    const result = Promise.resolve({ _id: studentId, studentType: 'independent' })
    result.select = () => result
    result.lean = () => result
    return result
  })
  const restoreCourse = stub(Course, 'findOne', () => {
    const result = Promise.resolve({ _id: courseId })
    result.select = () => result
    return result
  })
  const restoreExisting = stub(Enrollment, 'findOne', () => {
    const result = Promise.resolve(null)
    result.select = () => result
    return result
  })
  const restoreCreate = stub(Enrollment, 'create', async (documents) => {
    savedDocument = documents[0]
    return [{ ...documents[0], _id: '68a000000000000000000050' }]
  })
  try {
    const response = await request('/enrollments', {
      role: 'student',
      subject: studentId,
      body: { courseId, userId: '68a000000000000000000031' },
    })
    assert.equal(response.status, 201)
    assert.equal(String(savedDocument.userId), studentId)
    assert.equal(String(savedDocument.courseId), courseId)
    assert.equal(savedDocument.status, 'active')
    assert.equal(Object.hasOwn(savedDocument, 'collegeId'), false)
    assert.equal(Enrollment.collection.name, 'enrollment')
  } finally {
    restoreCreate()
    restoreExisting()
    restoreCourse()
    restoreStudentLookup()
    restoreStudentAuth()
  }
})

test('college student cannot self-enroll', async () => {
  const studentId = '68a000000000000000000032'
  const restoreStudentAuth = stub(CollegeStudent, 'findById', async () => ({
    _id: studentId,
    role: 'student',
    studentType: 'college',
    collegeId: '68a000000000000000000033',
    status: 'active',
    isActive: true,
  }))
  const restoreEnrollment = stub(Enrollment, 'create', async () => {
    assert.fail('College students must be assigned courses by their sub-admin.')
  })
  try {
    const response = await request('/enrollments', {
      role: 'student',
      subject: studentId,
      accountCollection: 'clg_students',
      body: { courseId: '68a000000000000000000034' },
    })
    assert.equal(response.status, 403)
  } finally {
    restoreEnrollment()
    restoreStudentAuth()
  }
})

test('student enrollment list is scoped to the authenticated student account type', async () => {
  const enrollmentQueries = []
  const populateCalls = []
  const restoreIndependentStudent = stub(Student, 'findById', async () => ({
    _id: '68a000000000000000000031',
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
  }))
  const restoreCollegeStudent = stub(CollegeStudent, 'findById', async () => ({
    _id: '68a000000000000000000032',
    role: 'student',
    studentType: 'college',
    collegeId: '68a000000000000000000099',
    status: 'active',
    isActive: true,
  }))
  const restoreEnrollments = stub(Enrollment, 'find', (query) => {
    enrollmentQueries.push(query)
    return {
      populate(...args) { populateCalls.push(args); return this },
      sort() { return this },
      lean() { return Promise.resolve([]) },
    }
  })

  try {
    const independentResponse = await request('/enrollments/me', {
      role: 'student',
      subject: '68a000000000000000000031',
      accountCollection: 'students',
    })
    assert.equal(independentResponse.status, 200)

    const collegeResponse = await request('/enrollments/me', {
      role: 'student',
      subject: '68a000000000000000000032',
      accountCollection: 'clg_students',
    })
    assert.equal(collegeResponse.status, 200)

    assert.deepEqual(enrollmentQueries[0], {
      userId: '68a000000000000000000031',
      collegeId: { $exists: false },
      status: { $ne: 'cancelled' },
    })
    assert.deepEqual(enrollmentQueries[1], {
      userId: '68a000000000000000000032',
      collegeId: '68a000000000000000000099',
      status: { $ne: 'cancelled' },
    })
    assert.deepEqual(populateCalls[0], [
      'courseId',
      'title description detailedDescription category difficulty thumbnailUrl estimatedDurationMinutes modules assignments quizzes status',
    ])
  } finally {
    restoreIndependentStudent()
    restoreCollegeStudent()
    restoreEnrollments()
  }
})

test('student enrollment response includes playable course data without quiz answers', async () => {
  const studentId = '68a000000000000000000031'
  const lessonId = '68a000000000000000000052'
  const legacyLessonId = '68a000000000000000000053'
  const restoreStudent = stub(Student, 'findById', async () => ({
    _id: studentId,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
  }))
  const restoreEnrollments = stub(Enrollment, 'find', () => ({
    populate() { return this },
    sort() { return this },
    lean: async () => [{
      _id: '68a000000000000000000051',
      completedLessonIds: [lessonId],
      startedLessonIds: [lessonId],
      lessonCompletionDates: { [lessonId]: new Date('2026-11-11T00:00:00.000Z') },
      courseId: {
        _id: '68a000000000000000000040',
        title: 'Enrolled course',
        category: 'Science',
        difficulty: 'intermediate',
        thumbnailUrl: 'https://res.cloudinary.com/test/video/upload/course.jpg',
        modules: [{
          title: 'Module 1',
          lessons: [{
            _id: legacyLessonId,
            title: 'Legacy lesson',
            videoUrl: 'https://res.cloudinary.com/test/video/upload/legacy.mp4',
            durationSeconds: 190,
            attentionCheck: {
              enabled: true,
              questionsDuringVideo: 1,
              minIntervalSeconds: 30,
              maxIntervalSeconds: 75,
              questions: [{ selectedForPlayback: true }],
            },
          }],
          contentItems: [
            {
              _id: lessonId,
              type: 'video-lesson',
              title: 'Lesson 1',
              videoUrl: 'https://res.cloudinary.com/test/video/upload/lesson.mp4',
              durationSeconds: 190,
              attentionCheck: {
                enabled: true,
                questionsDuringVideo: 1,
                minIntervalSeconds: 30,
                maxIntervalSeconds: 75,
                questions: [{ selectedForPlayback: true }],
              },
            },
            { type: 'quiz', quiz: { questions: [{ prompt: 'Question', correctOptionIndices: [1] }] } },
          ],
        }],
      },
    }],
  }))
  try {
    const response = await request('/enrollments/me', {
      role: 'student',
      subject: studentId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.enrollments[0].courseId._id, '68a000000000000000000040')
    assert.equal(result.enrollments[0].courseId.thumbnailUrl, 'https://res.cloudinary.com/test/video/upload/course.jpg')
    assert.equal(result.enrollments[0].courseId.category, 'Science')
    assert.equal(result.enrollments[0].courseId.difficulty, 'intermediate')
    assert.equal(result.enrollments[0].courseId.modules[0].contentItems[0].videoUrl, 'https://res.cloudinary.com/test/video/upload/lesson.mp4')
    assert.equal(result.enrollments[0].courseId.modules[0].contentItems[0].durationSeconds, 190)
    assert.deepEqual(result.enrollments[0].courseId.modules[0].contentItems[0].attentionCheck, {
      enabled: true,
      questionsDuringVideo: 1,
      minIntervalSeconds: 30,
      maxIntervalSeconds: 75,
    })
    assert.equal(result.enrollments[0].courseId.modules[0].lessons[0].durationSeconds, 190)
    assert.deepEqual(result.enrollments[0].courseId.modules[0].lessons[0].attentionCheck, {
      enabled: true,
      questionsDuringVideo: 1,
      minIntervalSeconds: 30,
      maxIntervalSeconds: 75,
    })
    assert.deepEqual(result.enrollments[0].completedLessonIds, [lessonId])
    assert.deepEqual(result.enrollments[0].startedLessonIds, [lessonId])
    assert.equal(result.enrollments[0].lessonCompletionDates[lessonId], '2026-11-11T00:00:00.000Z')
    assert.equal('correctOptionIndices' in result.enrollments[0].courseId.modules[0].contentItems[1].quiz.questions[0], false)
  } finally {
    restoreEnrollments()
    restoreStudent()
  }
})

test('student learning summary counts enrolled courses, lesson progress, assignments, and consecutive activity days', async () => {
  const studentId = '68a000000000000000000031'
  const today = new Date()
  today.setUTCHours(12, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  let enrollmentQuery
  const restoreStudent = stub(Student, 'findById', async () => ({
    _id: studentId,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
  }))
  const restoreEnrollments = stub(Enrollment, 'find', (query) => {
    enrollmentQuery = query
    return {
      populate() { return this },
      sort() { return this },
      lean: async () => [
        {
          _id: '68a000000000000000000071',
          completedLessonIds: ['68a000000000000000000081'],
          startedLessonIds: ['68a000000000000000000081', '68a000000000000000000082'],
          lessonCompletionDates: { '68a000000000000000000081': today },
          courseId: {
            _id: '68a000000000000000000061',
            assignments: [{ _id: '68a000000000000000000091' }],
            modules: [{
              contentItems: [
                { _id: '68a000000000000000000081', type: 'video-lesson' },
                { _id: '68a000000000000000000082', type: 'video-lesson' },
                { type: 'assignment' },
              ],
            }],
          },
        },
        {
          _id: '68a000000000000000000072',
          completedLessonIds: ['68a000000000000000000083'],
          startedLessonIds: ['68a000000000000000000083'],
          lessonCompletionDates: { '68a000000000000000000083': yesterday },
          courseId: {
            _id: '68a000000000000000000062',
            assignments: [],
            modules: [{ lessons: [{ _id: '68a000000000000000000083' }], contentItems: [] }],
          },
        },
      ],
    }
  })
  const restoreAssignmentSubmissions = stub(AssignmentSubmission, 'find', (query) => {
    assert.deepEqual(query, {
      userId: studentId,
      enrollmentId: { $in: ['68a000000000000000000071', '68a000000000000000000072'] },
    })
    return {
      select() { return this },
      lean: async () => [],
    }
  })

  try {
    const response = await request('/learning/summary', {
      role: 'student',
      subject: studentId,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(enrollmentQuery, {
      userId: studentId,
      collegeId: { $exists: false },
      status: { $ne: 'cancelled' },
    })
    const { summary } = await response.json()
    assert.deepEqual(summary, {
      enrolledCourses: 2,
      pendingAssignments: 2,
      completedCourses: 1,
      learningStreak: 2,
      completedLessons: 2,
      inProgressLessons: 1,
      notStartedLessons: 0,
      totalLessons: 3,
      completionPercentage: 67,
    })
  } finally {
    restoreEnrollments()
    restoreAssignmentSubmissions()
    restoreStudent()
  }
})

test('student learning content returns the enrolled course with every published module item and hides quiz answers', async () => {
  const studentId = '68a000000000000000000031'
  const courseId = '68a000000000000000000041'
  const enrollmentId = '68a000000000000000000051'
  const questionId = '68a000000000000000000052'
  const assignmentId = '68a000000000000000000057'
  const course = {
    _id: courseId,
    title: 'Mixed content course',
    status: 'published',
    quizzes: [],
    assignments: [],
    modules: [{
      _id: '68a000000000000000000053',
      title: 'Module 1',
      contentItems: [
        {
          _id: '68a000000000000000000054',
          type: 'video-lesson',
          title: 'Video',
          attentionCheck: {
            enabled: true,
            minIntervalSeconds: 10,
            maxIntervalSeconds: 60,
            questions: [{ prompt: 'Question?', options: ['A', 'B'], correctOptionIndices: [0] }],
          },
        },
        { _id: '68a000000000000000000055', type: 'quiz', title: 'Quiz', quiz: { _id: '68a000000000000000000056', questions: [{ _id: questionId, prompt: 'Question?', options: ['A', 'B'], correctOptionIndices: [0] }] } },
        { _id: '68a000000000000000000057', type: 'assignment', title: 'Assignment', dueDate: new Date('2026-12-01T00:00:00.000Z'), points: 10 },
        { _id: '68a000000000000000000058', type: 'note', title: 'Notes', resources: [{ title: 'Handout', url: 'https://res.cloudinary.com/test/raw/upload/handout.pdf', resourceType: 'raw', format: 'pdf' }] },
      ],
    }],
  }
  const restores = [
    stub(Student, 'findById', async () => ({
      _id: studentId,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Enrollment, 'findOne', (query) => {
      assert.deepEqual(query, {
        userId: studentId,
        courseId,
        collegeId: { $exists: false },
        status: { $ne: 'cancelled' },
      })
      return {
        sort() { return this },
        lean: async () => ({
          _id: enrollmentId,
          userId: studentId,
          courseId,
          lessonPlaybackPositions: { '68a000000000000000000054': 42 },
        }),
      }
    }),
    stub(Course, 'findById', (id) => {
      assert.equal(String(id), courseId)
      return { select() { return this }, lean: async () => course }
    }),
    stub(AssignmentSubmission, 'find', (query) => {
      assert.deepEqual(query, { userId: studentId, enrollmentId })
      return {
        select(fields) {
          assert.match(fields, /reviewStatus/)
          return this
        },
        sort(sort) {
          assert.deepEqual(sort, { submittedAt: -1, _id: -1 })
          return this
        },
        lean: async () => [{
          _id: '68a000000000000000000060',
          assignmentId,
          fileName: 'work.pdf',
          reviewStatus: 'pending',
        }],
      }
    }),
    stub(QuizAttempt, 'find', () => ({
      select() { return this },
      sort() { return this },
      lean: async () => [],
    })),
  ]

  try {
    const response = await request(`/courses/${courseId}/learning-content`, {
      role: 'student',
      subject: studentId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.enrollment._id, enrollmentId)
    assert.deepEqual(result.enrollment.lessonPlaybackPositions, { '68a000000000000000000054': 42 })
    assert.deepEqual(result.enrollment.courseId.modules[0].contentItems.map((item) => item.type), [
      'video-lesson',
      'quiz',
      'assignment',
      'note',
    ])
    assert.equal(result.enrollment.courseId.modules[0].contentItems[2].points, 10)
    assert.equal(result.enrollment.courseId.modules[0].contentItems[3].resources[0].url, 'https://res.cloudinary.com/test/raw/upload/handout.pdf')
    assert.equal('correctOptionIndices' in result.enrollment.courseId.modules[0].contentItems[1].quiz.questions[0], false)
    assert.deepEqual(result.enrollment.courseId.modules[0].contentItems[0].attentionCheck, {
      enabled: true,
      questionsDuringVideo: 1,
      minIntervalSeconds: 10,
      maxIntervalSeconds: 60,
    })
    assert.equal(result.assignmentSubmissions[0].assignmentId, assignmentId)
    assert.equal(result.assignmentSubmissions[0].reviewStatus, 'pending')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student attention checks serve private questions from legacy and content item video lessons', async () => {
  const studentId = '68a000000000000000000031'
  const courseId = '68a000000000000000000041'
  const enrollmentId = '68a000000000000000000051'
  const legacyLessonId = '68a000000000000000000054'
  const contentItemLessonId = '68a000000000000000000059'
  const course = {
    _id: courseId,
    modules: [{
      lessons: [{
        _id: legacyLessonId,
        title: 'Legacy video',
        attentionCheck: {
          enabled: true,
          questionsDuringVideo: 1,
          minIntervalSeconds: 10,
          maxIntervalSeconds: 60,
          questions: [{ _id: '68a000000000000000000055', prompt: 'Legacy question?', options: ['A', 'B'], correctOptionIndices: [1], selectedForPlayback: true }],
        },
      }],
      contentItems: [{
        _id: contentItemLessonId,
        type: 'video-lesson',
        title: 'Modern video',
        attentionCheck: {
          enabled: true,
          questionsDuringVideo: 1,
          minIntervalSeconds: 10,
          maxIntervalSeconds: 60,
          questions: [{ _id: '68a000000000000000000056', prompt: 'Modern question?', options: ['C', 'D'], correctOptionIndices: [0], selectedForPlayback: true }],
        },
      }],
    }],
  }
  const createdResponses = []
  let createdId = 0
  const restores = [
    stub(Student, 'findById', () => queryResult({
      _id: studentId,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Enrollment, 'findOne', () => ({
      sort() { return this },
      lean: async () => ({ _id: enrollmentId, userId: studentId, courseId }),
    })),
    stub(Course, 'findById', () => ({ select() { return this }, lean: async () => course })),
    stub(VideoAttentionResponse, 'findOne', () => ({
      select() { return this },
      lean: async () => null,
    })),
    stub(VideoAttentionResponse, 'find', () => ({
      select() { return this },
      lean: async () => [],
    })),
    stub(VideoAttentionResponse, 'create', async (document) => {
      const saved = { ...document, _id: new mongoose.Types.ObjectId(String(++createdId).padStart(24, '0')) }
      createdResponses.push(saved)
      return saved
    }),
  ]

  try {
    for (const [lessonId, sessionId] of [
      [legacyLessonId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      [contentItemLessonId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
      [legacyLessonId, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
    ]) {
      const response = await request(`/courses/${courseId}/attention-checks/${lessonId}/start`, {
        role: 'student',
        subject: studentId,
        body: { sessionId, triggerIndex: 0, positionSeconds: 35 },
      })
      assert.equal(response.status, 201)
      const result = await response.json()
      assert.equal(result.question.prompt, lessonId === legacyLessonId ? 'Legacy question?' : 'Modern question?')
      assert.deepEqual(result.question.options, lessonId === legacyLessonId ? ['A', 'B'] : ['C', 'D'])
      assert.equal('correctOptionIndices' in result.question, false)
      assert.equal('correctOptionIndices' in result, false)
    }
    assert.equal(createdResponses.length, 3)
    assert.deepEqual(createdResponses.map((entry) => entry.videoPositionSeconds), [35, 35, 35])
    assert.notEqual(createdResponses[0].sessionId, createdResponses[2].sessionId)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student attention check refresh restores the existing pending response in its playback session', async () => {
  const studentId = '68a000000000000000000031'
  const courseId = '68a000000000000000000041'
  const enrollmentId = '68a000000000000000000051'
  const lessonId = '68a000000000000000000054'
  const responseId = '68a000000000000000000064'
  const sessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const presentedAt = new Date(Date.now() - 3000)
  const savedResponse = {
    _id: new mongoose.Types.ObjectId(responseId),
    status: 'presented',
    presentedAt,
    questionId: '68a000000000000000000056',
    questionPrompt: 'Previously presented?',
    questionType: 'multiple-choice',
    options: ['A', 'B'],
  }
  const course = {
    modules: [{
      lessons: [{
        _id: lessonId,
        title: 'Video',
        attentionCheck: {
          enabled: true,
          questionsDuringVideo: 1,
          minIntervalSeconds: 10,
          maxIntervalSeconds: 60,
          questions: [{
            _id: savedResponse.questionId,
            prompt: 'Previously presented?',
            type: 'multiple-choice',
            options: ['A', 'B'],
            correctOptionIndices: [0],
            selectedForPlayback: true,
          }],
        },
      }],
    }],
  }
  let createdResponseCount = 0
  const restores = [
    stub(Student, 'findById', () => queryResult({
      _id: studentId,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Enrollment, 'findOne', () => ({
      sort() { return this },
      lean: async () => ({ _id: enrollmentId, userId: studentId, courseId }),
    })),
    stub(Course, 'findById', () => ({ select() { return this }, lean: async () => course })),
    stub(VideoAttentionResponse, 'findOne', (query) => {
      assert.equal(query.sessionId, sessionId)
      assert.equal(query.triggerIndex, 0)
      return { select() { return this }, lean: async () => savedResponse }
    }),
    stub(VideoAttentionResponse, 'create', async () => {
      createdResponseCount += 1
      return savedResponse
    }),
  ]

  try {
    const response = await request(`/courses/${courseId}/attention-checks/${lessonId}/start`, {
      role: 'student',
      subject: studentId,
      body: { sessionId, triggerIndex: 0, positionSeconds: 35 },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.responseId, responseId)
    assert.equal(result.question.prompt, 'Previously presented?')
    assert.equal(result.presentedAt, presentedAt.toISOString())
    assert.equal('correctOptionIndices' in result.question, false)
    assert.equal(createdResponseCount, 0)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student attention check submissions persist selected answers and server response time', async () => {
  const studentId = '68a000000000000000000031'
  const courseId = '68a000000000000000000041'
  const enrollmentId = '68a000000000000000000051'
  const lessonId = '68a000000000000000000054'
  const responseId = '68a000000000000000000055'
  const attentionResponse = {
    presentedAt: new Date(Date.now() - 1500),
    questionType: 'multiple-select',
    options: ['A', 'B', 'C'],
    correctOptionIndices: [0, 2],
    selectedOptionIndices: [],
    async save() {},
  }
  const restores = [
    stub(Student, 'findById', () => queryResult({
      _id: studentId,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Enrollment, 'findOne', () => ({
      sort() { return this },
      lean: async () => ({ _id: enrollmentId, userId: studentId, courseId }),
    })),
    stub(VideoAttentionResponse, 'findOne', (query) => {
      assert.equal(String(query._id), responseId)
      assert.equal(query.status, undefined)
      return { select: async () => attentionResponse }
    }),
  ]

  try {
    const response = await request(`/courses/${courseId}/attention-checks/${lessonId}/submit`, {
      role: 'student',
      subject: studentId,
      body: { responseId, selectedOptionIndices: [2, 0] },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.recorded, true)
    assert.equal(result.isCorrect, true)
    assert.equal('correctOptionIndices' in result, false)
    assert.ok(result.responseTimeMs >= 1000)
    assert.equal(attentionResponse.status, 'answered')
    assert.deepEqual(attentionResponse.selectedOptionIndices, [2, 0])

    attentionResponse.presentedAt = new Date(Date.now() - 11_000)
    const duplicate = await request(`/courses/${courseId}/attention-checks/${lessonId}/submit`, {
      role: 'student',
      subject: studentId,
      body: { responseId, selectedOptionIndices: [0, 2] },
    })
    assert.equal(duplicate.status, 200)
    assert.equal((await duplicate.json()).status, 'answered')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student attention checks record incorrect and unanswered responses using the server deadline', async () => {
  const studentId = '68a000000000000000000031'
  const courseId = '68a000000000000000000041'
  const enrollmentId = '68a000000000000000000051'
  const lessonId = '68a000000000000000000054'
  const incorrectResponseId = '68a000000000000000000061'
  const timeoutResponseId = '68a000000000000000000062'
  const lateAnswerResponseId = '68a000000000000000000063'
  const emptyTimeoutResponseId = '68a000000000000000000065'
  const earlyEmptyResponseId = '68a000000000000000000066'
  const createPresentedResponse = (presentedAt) => ({
    presentedAt,
    questionType: 'multiple-choice',
    options: ['A', 'B'],
    correctOptionIndices: [0],
    selectedOptionIndices: [],
    async save() {},
  })
  const responses = new Map([
    [incorrectResponseId, createPresentedResponse(new Date(Date.now() - 1500))],
    [timeoutResponseId, createPresentedResponse(new Date(Date.now() - 11_000))],
    [lateAnswerResponseId, createPresentedResponse(new Date(Date.now() - 11_000))],
    [emptyTimeoutResponseId, createPresentedResponse(new Date(Date.now() - 11_000))],
    [earlyEmptyResponseId, createPresentedResponse(new Date())],
  ])
  const restores = [
    stub(Student, 'findById', () => queryResult({
      _id: studentId,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Enrollment, 'findOne', () => ({
      sort() { return this },
      lean: async () => ({ _id: enrollmentId, userId: studentId, courseId }),
    })),
    stub(VideoAttentionResponse, 'findOne', (query) => ({
      select: async () => responses.get(String(query._id)),
    })),
  ]

  try {
    const incorrect = await request(`/courses/${courseId}/attention-checks/${lessonId}/submit`, {
      role: 'student',
      subject: studentId,
      body: { responseId: incorrectResponseId, selectedOptionIndices: [1] },
    })
    assert.equal(incorrect.status, 200)
    assert.equal((await incorrect.json()).isCorrect, false)
    assert.equal(responses.get(incorrectResponseId).status, 'answered')

    const earlyEmpty = await request(`/courses/${courseId}/attention-checks/${lessonId}/submit`, {
      role: 'student',
      subject: studentId,
      body: { responseId: earlyEmptyResponseId, selectedOptionIndices: [] },
    })
    assert.equal(earlyEmpty.status, 409)
    assert.match((await earlyEmpty.json()).message, /response window is still active/i)

    for (const [responseId, body] of [
      [timeoutResponseId, { responseId: timeoutResponseId, notAnswered: true }],
      [lateAnswerResponseId, { responseId: lateAnswerResponseId, selectedOptionIndices: [0] }],
      [emptyTimeoutResponseId, { responseId: emptyTimeoutResponseId, selectedOptionIndices: [] }],
    ]) {
      const response = await request(`/courses/${courseId}/attention-checks/${lessonId}/submit`, {
        role: 'student',
        subject: studentId,
        body,
      })
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.recorded, true)
      assert.equal(result.status, 'not_answered')
      assert.equal(result.isCorrect, false)
      assert.equal(result.responseTimeMs, 10_000)
      assert.deepEqual(responses.get(responseId).selectedOptionIndices, [])
    }
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('only main admins can list video attention check response reports', async () => {
  const adminId = '68a000000000000000000010'
  let projection = ''
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: adminId,
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Student, 'findById', () => queryResult({
      _id: '68a000000000000000000031',
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(VideoAttentionResponse, 'find', () => ({
      select(value) {
        projection = value
        return this
      },
      populate() { return this },
      sort() { return this },
      limit() { return this },
      lean: async () => [],
    })),
  ]

  try {
    const response = await request('/admin/video-attention-responses', { role: 'main_admin', subject: adminId })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { responses: [] })
    assert.equal(projection.includes('correctOptionIndices'), false)
    const denied = await request('/admin/video-attention-responses', { role: 'student', subject: '68a000000000000000000031' })
    assert.equal(denied.status, 403)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student quiz attempts start, score on the server, and reject duplicate submissions', async () => {
  const studentId = '68a000000000000000000031'
  const courseId = '68a000000000000000000061'
  const enrollmentId = '68a000000000000000000062'
  const quizId = '68a000000000000000000063'
  const questionId = '68a000000000000000000064'
  const multipleSelectId = '68a000000000000000000065'
  const trueFalseId = '68a000000000000000000067'
  const additionalQuestionIds = Array.from({ length: 7 }, () => new mongoose.Types.ObjectId().toString())
  const questions = [
    { _id: new mongoose.Types.ObjectId(questionId), prompt: 'Select the correct answer', options: ['Incorrect', 'Correct'], correctOptionIndices: [], correctOptionIndex: 1, explanation: 'The course material defines this answer.', marks: 1 },
    { _id: new mongoose.Types.ObjectId(multipleSelectId), prompt: 'Select both correct answers', type: 'multiple-select', options: ['A', 'B', 'C'], correctOptionIndices: [0, 2], marks: 2 },
    { _id: new mongoose.Types.ObjectId(trueFalseId), prompt: 'True?', type: 'true-false', options: ['True', 'False'], correctOptionIndices: [1], marks: 1 },
    ...additionalQuestionIds.map((id, index) => ({
      _id: new mongoose.Types.ObjectId(id),
      prompt: `Select the correct answer ${index + 4}`,
      type: 'multiple-choice',
      options: ['Incorrect', 'Correct'],
      correctOptionIndices: [1],
      marks: 1,
    })),
  ]
  const correctAnswers = [
    { questionId, selectedOptionIndices: [1] },
    { questionId: multipleSelectId, selectedOptionIndices: [0, 2] },
    { questionId: trueFalseId, selectedOptionIndices: [0] },
    ...additionalQuestionIds.map((id) => ({ questionId: id, selectedOptionIndices: [1] })),
  ]
  let currentQuizQuestions = questions
  let savedAttempt
  let currentAttempt
  let savedAttemptCount = 0
  let savedState
  const restores = [
    stub(Student, 'findById', async () => ({
      _id: studentId,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Enrollment, 'findOne', () => ({
      sort() { return this },
      lean: async () => ({ _id: enrollmentId, userId: studentId, courseId }),
    })),
    stub(Course, 'findById', () => ({
      select() { return this },
      lean: async () => ({
        _id: courseId,
        quizzes: [{
          _id: quizId,
          questions: [{
            _id: new mongoose.Types.ObjectId('68a000000000000000000070'),
            prompt: 'Stale course-level question',
            options: ['A', 'B'],
            correctOptionIndices: [0],
          }],
        }],
        modules: [{
          quiz: {
            _id: quizId,
            questions: [{
              _id: new mongoose.Types.ObjectId('68a000000000000000000068'),
              prompt: 'Stale legacy question',
              options: ['A', 'B'],
              correctOptionIndices: [0],
            }],
          },
          contentItems: [{
            type: 'quiz',
            requiredForCertificate: false,
            quiz: {
              _id: quizId,
              maxAttempts: 2,
              passingPercentage: 70,
              timeLimitMinutes: 5,
              questions: currentQuizQuestions,
            },
          }],
        }],
      }),
    })),
    stub(QuizAttempt, 'find', () => ({
      select() { return this },
      sort() { return this },
      lean: async () => [],
    })),
    stub(QuizAttempt, 'create', async (document) => {
      savedAttempt = document
      savedAttemptCount += 1
      currentAttempt = {
        ...document,
        _id: '68a000000000000000000066',
        startedAt: new Date(),
      }
      return currentAttempt
    }),
    stub(QuizAttemptState, 'findOne', () => queryResult(savedState)),
    stub(QuizAttemptState, 'findOneAndUpdate', (query, update, options = {}) => {
      if (!savedState && options.upsert) {
        savedState = {
          ...update.$setOnInsert,
          _id: new mongoose.Types.ObjectId(),
        }
      } else if (!savedState) {
        return queryResult(null)
      } else if (query.cycleNumber && query.cycleNumber !== savedState.cycleNumber) {
        return queryResult(null)
      } else if (query.passed?.$ne === true && savedState.passed) {
        return queryResult(null)
      }
      if (savedState) {
        for (const [key, value] of Object.entries(update.$inc || {})) {
          savedState[key] = (savedState[key] || 0) + value
        }
        Object.assign(savedState, update.$set || {})
      }
      return queryResult(savedState)
    }),
    stub(QuizAttempt, 'findOne', (query) => queryResult(
      query.status === 'started' && currentAttempt?.status === 'started' ? currentAttempt : null,
    )),
    stub(QuizAttempt, 'findOneAndUpdate', async (_query, update) => {
      if (currentAttempt?.status !== 'started') return null
      Object.assign(currentAttempt, update.$set)
      return currentAttempt
    }),
    stub(Certificate, 'findOne', () => queryResult(null)),
  ]

  try {
    const startedResponse = await request(`/courses/${courseId}/quizzes/${quizId}/attempts/start`, {
      role: 'student',
      subject: studentId,
      body: { enrollmentId },
    })
    assert.equal(startedResponse.status, 201)
    const started = await startedResponse.json()
    assert.equal(started.attempt.status, 'started')
    assert.equal(started.attempt.timeLimitMinutes, 5)
    assert.equal(started.attempt.maxAttempts, 3)
    assert.equal(started.quizStatus.attemptsRemaining, 2)
    assert.deepEqual(started.questions.map((question) => question._id), correctAnswers.map((answer) => answer.questionId))
    assert.equal(savedAttempt.userId, studentId)
    assert.equal(savedAttempt.enrollmentId, enrollmentId)
    assert.equal(savedAttempt.status, 'started')
    assert.equal(savedAttemptCount, 1)

    const invalidSingleSelect = await request(`/courses/${courseId}/quizzes/${quizId}/attempts/${currentAttempt._id}/submit`, {
      role: 'student',
      subject: studentId,
      body: {
        answers: [
          { ...correctAnswers[0], selectedOptionIndices: [0, 1] },
          ...correctAnswers.slice(1),
        ],
      },
    })
    assert.equal(invalidSingleSelect.status, 400)

    currentQuizQuestions = [{
      _id: new mongoose.Types.ObjectId('68a000000000000000000069'),
      prompt: 'Question changed after attempt started',
      options: ['A', 'B'],
      correctOptionIndices: [1],
    }]
    const response = await request(`/courses/${courseId}/quizzes/${quizId}/attempts/${currentAttempt._id}/submit`, {
      role: 'student',
      subject: studentId,
      body: {
        answers: correctAnswers.map((answer) => ({
          ...answer,
          questionId: answer.questionId === questionId ? questionId.toUpperCase() : answer.questionId,
        })),
      },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.attempt.scorePercentage, 91)
    assert.equal(result.attempt.passed, true)
    assert.equal(result.attempt.attemptsMade, 1)
    assert.equal(result.quizStatus.passed, true)
    assert.equal(result.quizStatus.attemptsRemaining, 0)
    assert.equal(result.attempt.correctAnswers, 9)
    assert.equal(result.attempt.incorrectAnswers, 1)
    assert.equal(result.attempt.answers.length, 10)
    assert.equal(result.attempt.questions.length, 10)
    assert.ok(result.attempt.timeTakenSeconds <= 5 * 60)
    assert.equal(savedAttemptCount, 1)
    assert.deepEqual(result.attempt.answers[0].correctOptionIndices, [1])
    assert.equal(result.attempt.answers[0].explanation, 'The course material defines this answer.')
    assert.deepEqual(result.attempt.answers[1].correctOptionIndices, [0, 2])
    assert.deepEqual(result.attempt.answers[2].correctOptionIndices, [1])

    const duplicateSubmission = await request(`/courses/${courseId}/quizzes/${quizId}/attempts/${currentAttempt._id}/submit`, {
      role: 'student',
      subject: studentId,
      body: { answers: [] },
    })
    assert.equal(duplicateSubmission.status, 409)

    const exhaustedAttempts = await request(`/courses/${courseId}/quizzes/${quizId}/attempts/start`, {
      role: 'student',
      subject: studentId,
      body: { enrollmentId },
    })
    assert.equal(exhaustedAttempts.status, 409)
    assert.equal(savedAttemptCount, 1)

    const statusResponse = await request(`/courses/${courseId}/quizzes/${quizId}/attempts/status`, {
      role: 'student',
      subject: studentId,
    })
    assert.equal(statusResponse.status, 200)
    assert.equal((await statusResponse.json()).quizStatus.passed, true)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student quiz locks after three failures and resets the cycle after 24 hours', async () => {
  const studentId = '68a000000000000000000031'
  const courseId = '68a000000000000000000081'
  const enrollmentId = '68a000000000000000000082'
  const quizId = '68a000000000000000000083'
  const questionId = '68a000000000000000000084'
  let state
  let currentAttempt
  const quiz = {
    _id: quizId,
    maxAttempts: 1,
    passingPercentage: 70,
    questions: [{
      _id: questionId,
      prompt: 'Choose the correct answer',
      options: ['Wrong', 'Right'],
      correctOptionIndices: [1],
    }],
  }
  const restores = [
    stub(Student, 'findById', async () => ({
      _id: studentId,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Enrollment, 'findOne', () => ({
      sort() { return this },
      lean: async () => ({ _id: enrollmentId, userId: studentId, courseId }),
    })),
    stub(Course, 'findById', () => ({
      select() { return this },
      lean: async () => ({
        _id: courseId,
        modules: [{ contentItems: [{ type: 'quiz', quiz }] }],
      }),
    })),
    stub(QuizAttempt, 'find', () => ({
      select() { return this },
      sort() { return this },
      lean: async () => [],
    })),
    stub(QuizAttempt, 'create', async (document) => {
      currentAttempt = {
        ...document,
        _id: new mongoose.Types.ObjectId().toString(),
        startedAt: new Date(),
      }
      return currentAttempt
    }),
    stub(QuizAttempt, 'findOne', (query) => queryResult(
      query.status === 'started'
        && currentAttempt?._id === String(query._id)
        && currentAttempt.status === 'started'
        ? currentAttempt
        : null,
    )),
    stub(QuizAttempt, 'findOneAndUpdate', (_query, update) => {
      if (currentAttempt?.status !== 'started') return queryResult(null)
      Object.assign(currentAttempt, update.$set)
      return queryResult(currentAttempt)
    }),
    stub(QuizAttemptState, 'findOne', () => queryResult(state)),
    stub(QuizAttemptState, 'findOneAndUpdate', (query, update, options = {}) => {
      if (!state && options.upsert) {
        state = { ...update.$setOnInsert, _id: new mongoose.Types.ObjectId() }
      } else if (!state
        || (query.cycleNumber && query.cycleNumber !== state.cycleNumber)
        || (query.attemptsUsed?.$lt !== undefined && state.attemptsUsed >= query.attemptsUsed.$lt)
        || (query.passed?.$ne === true && state.passed)
        || (query.lockedUntil instanceof Date
          && new Date(state.lockedUntil).getTime() !== query.lockedUntil.getTime())) {
        return queryResult(null)
      }
      for (const [key, value] of Object.entries(update.$inc || {})) {
        state[key] = (state[key] || 0) + value
      }
      Object.assign(state, update.$set || {})
      return queryResult(state)
    }),
  ]

  try {
    let thirdFailure
    for (let index = 1; index <= 3; index += 1) {
      const startResponse = await request(`/courses/${courseId}/quizzes/${quizId}/attempts/start`, {
        role: 'student',
        subject: studentId,
        body: { enrollmentId },
      })
      assert.equal(startResponse.status, 201)
      const started = await startResponse.json()
      assert.equal(started.attempt.attemptNumber, index)
      assert.equal(started.attempt.maxAttempts, 3)

      const submitResponse = await request(
        `/courses/${courseId}/quizzes/${quizId}/attempts/${started.attempt._id}/submit`,
        {
          role: 'student',
          subject: studentId,
          body: { answers: [{ questionId, selectedOptionIndices: [0] }] },
        },
      )
      assert.equal(submitResponse.status, 200)
      const submitted = await submitResponse.json()
      assert.equal(submitted.attempt.passed, false)
      if (index === 3) thirdFailure = submitted
    }

    assert.equal(thirdFailure.quizStatus.attemptsRemaining, 0)
    assert.equal(
      new Date(thirdFailure.quizStatus.lockedUntil).getTime() - new Date(thirdFailure.attempt.submittedAt).getTime(),
      24 * 60 * 60 * 1000,
    )

    const lockedStart = await request(`/courses/${courseId}/quizzes/${quizId}/attempts/start`, {
      role: 'student',
      subject: studentId,
      body: { enrollmentId },
    })
    assert.equal(lockedStart.status, 423)

    state.lockedUntil = new Date(Date.now() - 1)
    const statusResponse = await request(`/courses/${courseId}/quizzes/${quizId}/attempts/status`, {
      role: 'student',
      subject: studentId,
    })
    assert.equal(statusResponse.status, 200)
    const resetStatus = (await statusResponse.json()).quizStatus
    assert.equal(resetStatus.attemptsUsed, 0)
    assert.equal(resetStatus.attemptsRemaining, 3)
    assert.equal(resetStatus.cycleNumber, 2)

    const restarted = await request(`/courses/${courseId}/quizzes/${quizId}/attempts/start`, {
      role: 'student',
      subject: studentId,
      body: { enrollmentId },
    })
    assert.equal(restarted.status, 201)
    assert.equal((await restarted.json()).attempt.attemptNumber, 1)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student assignment upload is stored only for an assignment in the enrolled course', async () => {
  const studentId = '68a000000000000000000031'
  const courseId = '68a000000000000000000071'
  const enrollmentId = '68a000000000000000000072'
  const assignmentId = '68a000000000000000000073'
  let savedSubmission
  const restores = [
    stub(Student, 'findById', async () => ({
      _id: studentId,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Enrollment, 'findOne', () => ({
      sort() { return this },
      lean: async () => ({ _id: enrollmentId, userId: studentId, courseId }),
    })),
    stub(Course, 'findById', () => ({
      select() { return this },
      lean: async () => ({
        assignments: [{ _id: assignmentId, title: 'Submit report' }],
        modules: [],
      }),
    })),
    stub(AssignmentSubmission, 'create', async (document) => {
      savedSubmission = document
      return { ...document, _id: '68a000000000000000000074', submittedAt: new Date('2026-11-11T00:00:00.000Z') }
    }),
  ]
  try {
    const response = await studentAssignmentUpload(
      `/courses/${courseId}/assignments/${assignmentId}/submissions`,
      {
        studentId,
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        contents: Buffer.from('%PDF-1.7\nstudent work'),
      },
    )
    assert.equal(response.status, 201)
    const result = await response.json()
    assert.equal(result.submission.fileName, 'report.pdf')
    assert.equal(savedSubmission.userId, studentId)
    assert.equal(savedSubmission.enrollmentId, enrollmentId)
    assert.equal(savedSubmission.assignmentId, assignmentId)
    assert.equal(savedSubmission.fileData.toString('ascii', 0, 5), '%PDF-')
    assert.equal('fileData' in result.submission, false)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student assignment download is restricted to the enrolled owner and returns the saved file', async () => {
  const studentId = '68a000000000000000000031'
  const submissionId = '68a000000000000000000081'
  const enrollmentId = '68a000000000000000000082'
  const fileContents = Buffer.from('%PDF-1.7\nsubmitted work')
  const fileData = new mongoose.mongo.BSON.Binary(fileContents)
  const restores = [
    stub(Student, 'findById', async () => ({
      _id: studentId,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(AssignmentSubmission, 'findOne', (query) => {
      assert.deepEqual(query, { _id: submissionId, userId: studentId })
      return {
        select() { return this },
        lean: async () => ({
          _id: submissionId,
          userId: studentId,
          enrollmentId,
          fileName: 'report.pdf',
          contentType: 'application/pdf',
          fileSize: fileContents.length,
          fileData,
        }),
      }
    }),
    stub(Enrollment, 'findOne', (query) => {
      assert.deepEqual(query, {
        _id: enrollmentId,
        userId: studentId,
        collegeId: { $exists: false },
        status: { $ne: 'cancelled' },
      })
      return {
        select() { return this },
        lean: async () => ({ _id: enrollmentId }),
      }
    }),
  ]

  try {
    const response = await request(`/assignment-submissions/${submissionId}/download`, {
      role: 'student',
      subject: studentId,
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/pdf')
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="report.pdf"')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fileContents)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student lesson progress updates only a lesson in the student enrollment', async () => {
  const studentId = '68a000000000000000000031'
  const enrollmentId = '68a000000000000000000051'
  const lessonId = '68a000000000000000000052'
  let enrollmentQuery
  let updateQuery
  let updateDocument
  const restoreStudent = stub(Student, 'findById', async () => ({
    _id: studentId,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
  }))
  const restoreEnrollmentFind = stub(Enrollment, 'findOne', (query) => {
    enrollmentQuery = query
    return {
      populate() { return this },
      lean: async () => ({
        _id: enrollmentId,
        userId: studentId,
        completedLessonIds: [],
        startedLessonIds: [],
        lessonPlaybackPositions: {},
        lessonCompletionDates: {},
        courseId: {
          modules: [{
            contentItems: [{ _id: lessonId, type: 'video-lesson' }],
          }],
        },
      }),
    }
  })
  const restoreEnrollmentUpdate = stub(Enrollment, 'updateOne', async (query, update) => {
    updateQuery = query
    updateDocument = update
    return { matchedCount: 1 }
  })
  const restoreCertificateFind = stub(Certificate, 'findOne', () => queryResult(null))

  try {
    const response = await request(`/enrollments/${enrollmentId}/progress`, {
      role: 'student',
      subject: studentId,
      method: 'PATCH',
      body: { lessonId, completed: true },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      completedLessonIds: [lessonId],
      startedLessonIds: [lessonId],
      lessonPlaybackPositions: {},
    })
    assert.deepEqual(enrollmentQuery, {
      _id: enrollmentId,
      userId: studentId,
      collegeId: { $exists: false },
      status: { $ne: 'cancelled' },
    })
    assert.deepEqual(updateQuery, enrollmentQuery)
    assert.deepEqual(updateDocument.$addToSet, {
      startedLessonIds: lessonId,
      completedLessonIds: lessonId,
    })
    assert.ok(updateDocument.$set[`lessonCompletionDates.${lessonId}`] instanceof Date)
  } finally {
    restoreCertificateFind()
    restoreEnrollmentUpdate()
    restoreEnrollmentFind()
    restoreStudent()
  }
})

for (const studentType of ['independent', 'college']) {
  test(`${studentType} course completion issues one certificate only after every lesson is complete`, async () => {
    const studentId = new mongoose.Types.ObjectId()
    const collegeId = studentType === 'college' ? new mongoose.Types.ObjectId() : null
    const courseId = new mongoose.Types.ObjectId()
    const enrollmentId = new mongoose.Types.ObjectId()
    const lessonIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()]
    const studentName = `${studentType} learner`
    const enrollment = {
      _id: enrollmentId,
      userId: studentId,
      ...(collegeId ? { collegeId } : {}),
      completedLessonIds: [],
      startedLessonIds: [],
      courseId: {
        _id: courseId,
        title: 'Verified completion course',
        modules: [{
          contentItems: lessonIds.map((_id, index) => ({
            _id,
            type: 'video-lesson',
            title: `Lesson ${index + 1}`,
          })),
        }],
      },
    }
    let savedCertificate
    let certificateUpserts = 0
    const accountModel = studentType === 'college' ? CollegeStudent : Student
    const restores = [
      stub(accountModel, 'findById', async () => ({
        _id: studentId,
        fullName: studentName,
        username: `${studentType}-learner`,
        role: 'student',
        studentType,
        ...(collegeId ? { collegeId } : {}),
        status: 'active',
        approvalStatus: studentType === 'independent' ? 'approved' : undefined,
        isActive: true,
      })),
      stub(Enrollment, 'findOne', (filter) => {
        assert.equal(String(filter.userId), String(studentId))
        if (collegeId) assert.equal(String(filter.collegeId), String(collegeId))
        else assert.deepEqual(filter.collegeId, { $exists: false })
        return {
          populate() { return this },
          lean: async () => enrollment,
        }
      }),
      stub(Enrollment, 'updateOne', async (_filter, update) => {
        const completedLessonId = update.$addToSet?.completedLessonIds
        if (completedLessonId && !enrollment.completedLessonIds.some((id) => String(id) === String(completedLessonId))) {
          enrollment.completedLessonIds.push(completedLessonId)
        }
        return { matchedCount: 1 }
      }),
      stub(Certificate, 'findOne', (filter) => {
        assert.deepEqual(filter, {
          userId: studentId,
          courseId,
          $or: [{ studentId: { $exists: false } }, { studentId: null }],
        })
        return queryResult(null)
      }),
      stub(Certificate, 'findOneAndUpdate', (filter, update, options) => {
        certificateUpserts += 1
        assert.deepEqual(filter, {
          studentType,
          studentId,
          courseId,
        })
        assert.equal(options.upsert, true)
        if (!savedCertificate) {
          savedCertificate = {
            _id: new mongoose.Types.ObjectId(),
            ...update.$setOnInsert,
          }
        }
        return queryResult(savedCertificate)
      }),
    ]

    try {
      const requestOptions = {
        role: 'student',
        subject: String(studentId),
        accountCollection: studentType === 'college' ? 'clg_students' : 'students',
        method: 'PATCH',
      }
      const firstLessonResponse = await request(`/enrollments/${enrollmentId}/progress`, {
        ...requestOptions,
        body: { lessonId: String(lessonIds[0]), completed: true },
      })
      assert.equal(firstLessonResponse.status, 200)
      assert.equal(savedCertificate, undefined)

      const finalLessonResponse = await request(`/enrollments/${enrollmentId}/progress`, {
        ...requestOptions,
        body: { lessonId: String(lessonIds[1]), completed: true },
      })
      assert.equal(finalLessonResponse.status, 200)
      assert.equal(savedCertificate.studentName, studentName)
      assert.equal(savedCertificate.courseName, 'Verified completion course')
      assert.equal(String(savedCertificate.studentId), String(studentId))
      assert.equal(String(savedCertificate.userId), String(studentId))
      assert.equal(String(savedCertificate.courseId), String(courseId))
      assert.equal(String(savedCertificate.enrollmentId), String(enrollmentId))
      assert.match(savedCertificate.certificateId, /^AIH-[A-F0-9]{32}$/)
      const issuedCertificateId = savedCertificate.certificateId
      assert.equal(savedCertificate.viewUrl, `/certificates/${savedCertificate.certificateId}/view`)
      assert.equal(savedCertificate.downloadUrl, `/certificates/${savedCertificate.certificateId}/download`)
      assert.ok(savedCertificate.issuedAt instanceof Date)
      assert.equal(certificateUpserts, 1)

      const duplicateCompletionResponse = await request(`/enrollments/${enrollmentId}/progress`, {
        ...requestOptions,
        body: { lessonId: String(lessonIds[1]), completed: true },
      })
      assert.equal(duplicateCompletionResponse.status, 200)
      assert.equal(certificateUpserts, 2)
      assert.equal(savedCertificate.certificateId, issuedCertificateId)
    } finally {
      restores.reverse().forEach((restore) => restore())
    }
  })
}

test('completing a course with an existing legacy certificate does not issue a duplicate', async () => {
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000561')
  const enrollmentId = new mongoose.Types.ObjectId('68a000000000000000000562')
  const courseId = new mongoose.Types.ObjectId('68a000000000000000000563')
  const lessonId = new mongoose.Types.ObjectId('68a000000000000000000564')
  const certificateId = 'AIH-2026-ABCDEF123456'
  const course = {
    _id: courseId,
    title: 'Previously Certified Course',
    modules: [{ contentItems: [{ _id: lessonId, type: 'video-lesson' }] }],
  }
  const enrollment = {
    _id: enrollmentId,
    userId: studentId,
    courseId: course,
    completedLessonIds: [lessonId],
  }
  const legacyCertificate = {
    _id: new mongoose.Types.ObjectId('68a000000000000000000565'),
    userId: studentId,
    enrollmentId,
    courseId,
    certificateId,
    studentName: 'Independent Learner',
    courseName: course.title,
    completedAt: new Date('2026-10-12T12:00:00.000Z'),
  }
  let upsertCount = 0
  const restores = [
    stub(Student, 'findById', async (id) => ({
      _id: id,
      fullName: 'Independent Learner',
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      approvalStatus: 'approved',
      isActive: true,
    })),
    stub(Enrollment, 'findOne', () => queryResult(enrollment)),
    stub(Enrollment, 'updateOne', async () => ({ matchedCount: 1 })),
    stub(Certificate, 'findOne', (filter) => {
      assert.deepEqual(filter, {
        userId: studentId,
        courseId,
        $or: [{ studentId: { $exists: false } }, { studentId: null }],
      })
      return queryResult(legacyCertificate)
    }),
    stub(Certificate, 'findOneAndUpdate', () => {
      upsertCount += 1
      throw new Error('A duplicate certificate must not be inserted.')
    }),
  ]
  try {
    const response = await request(`/enrollments/${enrollmentId}/progress`, {
      role: 'student',
      accountCollection: 'students',
      subject: String(studentId),
      method: 'PATCH',
      body: { lessonId: String(lessonId), completed: true },
    })
    assert.equal(response.status, 200)
    assert.equal(upsertCount, 0)
    assert.equal(legacyCertificate.certificateId, certificateId)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('certificate view and download are authenticated, scoped, and render saved certificate details', async () => {
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000531')
  const courseId = new mongoose.Types.ObjectId('68a000000000000000000532')
  const certificateId = `AIH-${'D'.repeat(32)}`
  const certificate = {
    certificateId,
    studentId,
    studentType: 'independent',
    studentName: 'Learner & One',
    courseId,
    courseName: 'Systems <Design>',
    issuedAt: new Date('2026-10-11T12:00:00.000Z'),
  }
  const restores = [
    stub(Student, 'findById', async (id) => ({
      _id: id,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Admin, 'findById', async (id) => ({
      _id: id,
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Certificate, 'findOne', (filter) => {
      if (filter.studentId) {
        return queryResult(String(filter.studentId) === String(studentId) ? certificate : null)
      }
      if (filter.userId) {
        return queryResult(String(filter.userId) === String(studentId) ? certificate : null)
      }
      return queryResult(certificate)
    }),
  ]
  try {
    const viewResponse = await request(`/certificates/${certificateId}/view`, {
      role: 'student',
      subject: String(studentId),
    })
    assert.equal(viewResponse.status, 200)
    assert.match(viewResponse.headers.get('content-type'), /image\/svg\+xml/)
    assert.match(viewResponse.headers.get('content-disposition'), /^inline;/)
    const svg = await viewResponse.text()
    assert.match(svg, /Learner &amp; One/)
    assert.match(svg, /Systems &lt;Design&gt;/)
    assert.doesNotMatch(svg, /<Design>/)
    assert.match(svg, new RegExp(certificateId))

    const downloadResponse = await request(`/certificates/${certificateId}/download`, {
      role: 'student',
      subject: String(studentId),
    })
    assert.equal(downloadResponse.status, 200)
    assert.match(downloadResponse.headers.get('content-disposition'), /^attachment;/)

    const unrelatedStudentResponse = await request(`/certificates/${certificateId}/view`, {
      role: 'student',
      subject: '68a000000000000000000533',
    })
    assert.equal(unrelatedStudentResponse.status, 404)

    const adminResponse = await request(`/certificates/${certificateId}/view`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(adminResponse.status, 200)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('college students can view their existing legacy certificate without weakening ownership checks', async () => {
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000551')
  const collegeId = new mongoose.Types.ObjectId('68a000000000000000000552')
  const enrollmentId = new mongoose.Types.ObjectId('68a000000000000000000553')
  const courseId = new mongoose.Types.ObjectId('68a000000000000000000554')
  const certificateId = 'AIH-2026-UVWXYZ123456'
  const completedAt = new Date('2026-10-12T12:00:00.000Z')
  const legacyCertificate = {
    certificateId,
    userId: studentId,
    enrollmentId,
    courseId,
    studentName: 'College Learner',
    courseName: 'Legacy Course',
    completedAt,
  }
  const restores = [
    stub(CollegeStudent, 'findById', async (id) => ({
      _id: id,
      role: 'student',
      studentType: 'college',
      collegeId,
      status: 'active',
      isActive: true,
    })),
    stub(Admin, 'findById', async (id) => ({
      _id: id,
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Certificate, 'findOne', (filter) => {
      if (filter.userId) {
        return queryResult(String(filter.userId) === String(studentId) ? legacyCertificate : null)
      }
      if (filter.studentId) return queryResult(null)
      return queryResult(legacyCertificate)
    }),
    stub(Enrollment, 'findOne', (filter) => {
      assert.deepEqual(filter, {
        _id: enrollmentId,
        userId: String(studentId),
        courseId,
        collegeId: String(collegeId),
      })
      return queryResult({ _id: enrollmentId })
    }),
  ]
  try {
    const viewResponse = await request(`/certificates/${certificateId}/view`, {
      role: 'student',
      accountCollection: 'clg_students',
      subject: String(studentId),
    })
    assert.equal(viewResponse.status, 200)
    assert.match(await viewResponse.text(), /Issued October 12, 2026/)

    const downloadResponse = await request(`/certificates/${certificateId}/download`, {
      role: 'student',
      accountCollection: 'clg_students',
      subject: String(studentId),
    })
    assert.equal(downloadResponse.status, 200)
    assert.match(downloadResponse.headers.get('content-disposition'), /^attachment;/)

    const unrelatedStudentResponse = await request(`/certificates/${certificateId}/view`, {
      role: 'student',
      accountCollection: 'clg_students',
      subject: '68a000000000000000000555',
    })
    assert.equal(unrelatedStudentResponse.status, 404)

    const adminResponse = await request(`/certificates/${certificateId}/view`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(adminResponse.status, 200)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student lesson start is persisted without marking the lesson complete', async () => {
  const studentId = '68a000000000000000000031'
  const enrollmentId = '68a000000000000000000051'
  const lessonId = '68a000000000000000000052'
  let updateDocument
  const restoreStudent = stub(Student, 'findById', async () => ({
    _id: studentId,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
  }))
  const restoreEnrollmentFind = stub(Enrollment, 'findOne', () => ({
    populate() { return this },
    lean: async () => ({
      _id: enrollmentId,
      userId: studentId,
      completedLessonIds: [],
      startedLessonIds: [],
      courseId: {
        modules: [{ contentItems: [{ _id: lessonId, type: 'video-lesson' }] }],
      },
    }),
  }))
  const restoreEnrollmentUpdate = stub(Enrollment, 'updateOne', async (_query, update) => {
    updateDocument = update
    return { matchedCount: 1 }
  })

  try {
    const response = await request(`/enrollments/${enrollmentId}/progress`, {
      role: 'student',
      subject: studentId,
      method: 'PATCH',
      body: { lessonId, started: true },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      completedLessonIds: [],
      startedLessonIds: [lessonId],
      lessonPlaybackPositions: {},
    })
    assert.deepEqual(updateDocument, { $addToSet: { startedLessonIds: lessonId } })
  } finally {
    restoreEnrollmentUpdate()
    restoreEnrollmentFind()
    restoreStudent()
  }
})

test('student video playback position is stored per lesson and validated', async () => {
  const studentId = '68a000000000000000000031'
  const enrollmentId = '68a000000000000000000051'
  const lessonId = '68a000000000000000000052'
  let updateDocument
  const restoreStudent = stub(Student, 'findById', async () => ({
    _id: studentId,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
  }))
  const restoreEnrollmentFind = stub(Enrollment, 'findOne', () => ({
    populate() { return this },
    lean: async () => ({
      _id: enrollmentId,
      userId: studentId,
      completedLessonIds: [],
      startedLessonIds: [],
      lessonPlaybackPositions: { [lessonId]: 18 },
      courseId: {
        modules: [{ contentItems: [{ _id: lessonId, type: 'video-lesson' }] }],
      },
    }),
  }))
  const restoreEnrollmentUpdate = stub(Enrollment, 'updateOne', async (_query, update) => {
    updateDocument = update
    return { matchedCount: 1 }
  })

  try {
    const response = await request(`/enrollments/${enrollmentId}/progress`, {
      role: 'student',
      subject: studentId,
      method: 'PATCH',
      body: { lessonId, positionSeconds: 37 },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      completedLessonIds: [],
      startedLessonIds: [lessonId],
      lessonPlaybackPositions: { [lessonId]: 37 },
    })
    assert.deepEqual(updateDocument, {
      $addToSet: { startedLessonIds: lessonId },
      $set: { [`lessonPlaybackPositions.${lessonId}`]: 37 },
    })

    const invalidResponse = await request(`/enrollments/${enrollmentId}/progress`, {
      role: 'student',
      subject: studentId,
      method: 'PATCH',
      body: { lessonId, positionSeconds: 43201 },
    })
    assert.equal(invalidResponse.status, 400)
  } finally {
    restoreEnrollmentUpdate()
    restoreEnrollmentFind()
    restoreStudent()
  }
})

test('student lesson progress cannot access another student enrollment', async () => {
  const studentId = '68a000000000000000000031'
  const enrollmentId = '68a000000000000000000051'
  const restoreStudent = stub(Student, 'findById', async () => ({
    _id: studentId,
    role: 'student',
    studentType: 'independent',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
  }))
  const restoreEnrollmentFind = stub(Enrollment, 'findOne', () => ({
    populate() { return this },
    lean: async () => null,
  }))
  const restoreEnrollmentUpdate = stub(Enrollment, 'updateOne', async () => {
    assert.fail('Progress must not update an enrollment owned by another student.')
  })

  try {
    const response = await request(`/enrollments/${enrollmentId}/progress`, {
      role: 'student',
      subject: studentId,
      method: 'PATCH',
      body: { lessonId: '68a000000000000000000052', completed: true },
    })
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { message: 'The enrollment was not found.' })
  } finally {
    restoreEnrollmentUpdate()
    restoreEnrollmentFind()
    restoreStudent()
  }
})

test('college sub-admin cannot assign a student outside their college', async () => {
  const collegeId = '68a000000000000000000060'
  const studentId = '68a000000000000000000070'
  let studentQuery
  const restoreSubAdmin = stub(CollegeAdmin, 'findById', async () => ({
    _id: '68a000000000000000000080',
    role: 'college_admin',
    collegeId,
    status: 'active',
    isActive: true,
  }))
  const restoreStudent = stub(CollegeStudent, 'findOne', (query) => {
    studentQuery = query
    const result = Promise.resolve(null)
    result.select = () => result
    return result
  })
  const restoreCourse = stub(Course, 'findOne', () => {
    const result = Promise.resolve({ _id: '68a000000000000000000090' })
    result.select = () => result
    return result
  })
  const restoreEnrollment = stub(Enrollment, 'create', async () => {
    assert.fail('An out-of-college enrollment must not be written.')
  })
  try {
    const response = await request('/college/enrollments', {
      role: 'college_admin',
      subject: '68a000000000000000000080',
      body: { studentId, courseId: '68a000000000000000000090' },
    })
    assert.equal(response.status, 404)
    assert.equal(String(studentQuery.collegeId), collegeId)
    assert.equal(String(studentQuery._id), studentId)
  } finally {
    restoreEnrollment()
    restoreCourse()
    restoreStudent()
    restoreSubAdmin()
  }
})
test('main admin can update student account details and create a missing login identity', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000020'
  const savedIdentity = []
  let updatedStudent
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  }
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId,
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Student, 'findOne', (query) => query._id && !query._id.$ne
      ? queryResult({ _id: new mongoose.Types.ObjectId(studentId) })
      : queryResult(null)),
    stub(CollegeStudent, 'findOne', () => queryResult(null)),
    stub(CollegeAdmin, 'findOne', () => queryResult(null)),
    stub(Admin, 'findOne', () => queryResult(null)),
    stub(AccountIdentity, 'findOne', () => queryResult(null)),
    stub(AccountIdentity, 'create', async (records) => { savedIdentity.push(...records) }),
    stub(Student, 'updateOne', async (filter, update) => {
      updatedStudent = { filter, update }
      return { matchedCount: 1 }
    }),
    stub(mongoose, 'startSession', async () => session),
  ]
  try {
    const response = await request(`/admin/students/${studentId}?studentType=independent`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { fullName: 'Updated Learner', email: 'learner@example.com', username: 'updated.learner' },
    })
    assert.equal(response.status, 200, JSON.stringify(await response.json()))
    assert.equal(updatedStudent.update.$set.fullName, 'Updated Learner')
    assert.equal(updatedStudent.update.$set.email, 'learner@example.com')
    assert.equal(savedIdentity.length, 1)
    assert.equal(savedIdentity[0].accountCollection, 'students')
    assert.equal(String(savedIdentity[0].accountId), studentId)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('pending independent student login is blocked with the approval message', async () => {
  const accountId = new mongoose.Types.ObjectId()
  const email = 'pending-student@example.invalid'
  const username = 'pending-student'
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4)
  const restores = [
    stub(AccountIdentity, 'findOne', () => queryResult({
      accountCollection: 'students', accountId, email, username,
    })),
    stub(Student, 'findById', () => queryResult({
      _id: accountId, email, username, role: 'student', studentType: 'independent',
      status: 'pending', approvalStatus: 'pending', isActive: false, passwordHash,
    })),
  ]
  try {
    const response = await request('/auth/login', {
      body: { identifier: email, password: 'correct-horse-battery', role: 'student' },
    })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).message, 'Your account is awaiting approval from the administrator.')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('rejected independent student login explains the decision and reason', async () => {
  const accountId = new mongoose.Types.ObjectId()
  const email = 'rejected-student@example.invalid'
  const username = 'rejected-student'
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4)
  const restores = [
    stub(AccountIdentity, 'findOne', () => queryResult({
      accountCollection: 'students', accountId, email, username,
    })),
    stub(Student, 'findById', () => queryResult({
      _id: accountId, email, username, role: 'student', studentType: 'independent',
      status: 'rejected', approvalStatus: 'rejected', isActive: false,
      rejectionReason: 'Please provide a valid student ID.', passwordHash,
    })),
  ]
  try {
    const response = await request('/auth/login', {
      body: { identifier: email, password: 'correct-horse-battery', role: 'student' },
    })
    assert.equal(response.status, 403)
    assert.equal(
      (await response.json()).message,
      'Your account application was rejected. Reason: Please provide a valid student ID.',
    )
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('approved independent student can log in normally', async () => {
  const accountId = new mongoose.Types.ObjectId()
  const email = 'approved-student@example.invalid'
  const username = 'approved-student'
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4)
  const restores = [
    stub(AccountIdentity, 'findOne', () => queryResult({
      accountCollection: 'students', accountId, email, username,
    })),
    stub(Student, 'findById', () => queryResult({
      _id: accountId, email, username, role: 'student', studentType: 'independent',
      status: 'active', approvalStatus: 'approved', isActive: true, passwordHash,
    })),
  ]
  try {
    const response = await request('/auth/login', {
      body: { identifier: email, password: 'correct-horse-battery', role: 'student' },
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).user.approvalStatus, 'approved')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('independent student without a recorded approval cannot log in', async () => {
  const accountId = new mongoose.Types.ObjectId()
  const email = 'unreviewed-student@example.invalid'
  const username = 'unreviewed-student'
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4)
  const restores = [
    stub(AccountIdentity, 'findOne', () => queryResult({
      accountCollection: 'students', accountId, email, username,
    })),
    stub(Student, 'findById', () => queryResult({
      _id: accountId, email, username, role: 'student',
      status: 'active', isActive: true, passwordHash,
    })),
  ]
  try {
    const response = await request('/auth/login', {
      body: { identifier: email, password: 'correct-horse-battery', role: 'student' },
    })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).message, 'Your account is awaiting approval from the administrator.')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('Main Admin login remains active', async () => {
  const accountId = new mongoose.Types.ObjectId()
  const email = 'main-admin@example.invalid'
  const username = 'main-admin'
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4)
  const restores = [
    stub(AccountIdentity, 'findOne', () => queryResult({
      accountCollection: 'admin', accountId, email, username,
    })),
    stub(Admin, 'findById', () => {
      const result = Promise.resolve({
        _id: accountId, email, username, role: 'main_admin', status: 'active',
        isActive: true, passwordHash,
      })
      result.select = () => result
      return result
    }),
  ]
  try {
    const response = await request('/auth/login', {
      body: { identifier: email, password: 'correct-horse-battery', role: 'main_admin' },
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).user.role, 'main_admin')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('Main Admin can approve a pending independent student and notify the student', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000020'
  const notifications = []
  let saved = false
  let approvalAttempt = 0
  let loggedEmailFailure
  let updateFilter
  let updateDocument
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  }
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOneAndUpdate', (filter, update) => {
      updateFilter = filter
      updateDocument = update
      approvalAttempt += 1
      if (approvalAttempt > 1) return queryResult(null)
      saved = true
      return queryResult({
        _id: new mongoose.Types.ObjectId(studentId),
        email: 'approved@example.invalid',
        fullName: 'Approved Student',
        approvalStatus: 'approved',
        status: 'active',
      })
    }),
    stub(Student, 'exists', () => queryResult({ _id: studentId })),
    stub(Notification, 'create', async (records) => { notifications.push(...records) }),
    stub(mongoose, 'startSession', async () => session),
    stubResendApi(async (message) => {
      assert.equal(saved, true)
      assert.deepEqual(message.to, ['approved@example.invalid'])
      assert.equal(message.subject, 'Your AIHustle Registration Has Been Approved!')
      return { ok: true, status: 200, json: async () => ({ id: 'test-approval-email' }) }
    }),
    stub(console, 'error', (message) => { loggedEmailFailure = message }),
  ]
  try {
    const response = await request(`/admin/independent-students/${studentId}/approval`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { decision: 'approve' },
    })
    assert.equal(response.status, 200)
    assert.equal(updateFilter.studentType, 'independent')
    assert.equal(updateDocument.$set.approvalStatus, 'approved')
    assert.equal(updateDocument.$set.status, 'active')
    assert.equal(updateDocument.$set.approvedBy, adminId)
    assert.equal(notifications[0].recipientRole, 'student')
    assert.equal(String(notifications[0].recipientId), studentId)
    assert.equal(saved, true)
    assert.equal(loggedEmailFailure, undefined)

    const duplicateResponse = await request(`/admin/independent-students/${studentId}/approval`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { decision: 'approve' },
    })
    assert.equal(duplicateResponse.status, 409)
    assert.equal(approvalAttempt, 2)
    assert.equal(notifications.length, 1)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('independent student approval stays successful when its confirmation email fails', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000025'
  let saved = false
  let loggedEmailFailure
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  }
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOneAndUpdate', () => {
      saved = true
      return queryResult({
        _id: new mongoose.Types.ObjectId(studentId),
        email: 'approved@example.invalid',
        fullName: 'Approved Student',
        approvalStatus: 'approved',
        status: 'active',
      })
    }),
    stub(Notification, 'create', async () => {}),
    stub(mongoose, 'startSession', async () => session),
    stub(console, 'error', (message) => { loggedEmailFailure = message }),
    stubResendApi(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Test Resend recipient rejected' }),
    })),
  ]
  try {
    const response = await request(`/admin/independent-students/${studentId}/approval`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { decision: 'approve' },
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).student.approvalStatus, 'approved')
    assert.equal(saved, true)
    assert.match(loggedEmailFailure, /notification\.independent_student_approve_email\.failed/)
    assert.match(loggedEmailFailure, /RESEND_SEND_FAILED/)
    assert.match(loggedEmailFailure, /Test Resend recipient rejected/)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('Main Admin can reject a pending independent student and save the optional reason', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000021'
  const notifications = []
  let saved = false
  let updateDocument
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  }
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOneAndUpdate', (_filter, update) => {
      updateDocument = update
      saved = true
      return queryResult({
        _id: new mongoose.Types.ObjectId(studentId),
        email: 'rejected@example.invalid',
        fullName: 'Rejected Student',
        approvalStatus: 'rejected',
        status: 'rejected',
        rejectionReason: 'Please provide a valid student ID.',
      })
    }),
    stub(Notification, 'create', async (records) => { notifications.push(...records) }),
    stub(mongoose, 'startSession', async () => session),
    stubResendApi(async (message) => {
      assert.equal(saved, true)
      assert.deepEqual(message.to, ['rejected@example.invalid'])
      assert.equal(message.subject, 'Update on your AIHustle LMS account application')
      assert.match(message.text, /Please provide a valid student ID/)
      return { ok: true, status: 200, json: async () => ({ id: 'test-rejection-email' }) }
    }),
  ]
  try {
    const response = await request(`/admin/independent-students/${studentId}/approval`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { decision: 'reject', reason: '  Please provide a valid student ID.  ' },
    })
    assert.equal(response.status, 200)
    assert.equal(updateDocument.$set.approvalStatus, 'rejected')
    assert.equal(updateDocument.$set.status, 'rejected')
    assert.equal(updateDocument.$set.isActive, false)
    assert.equal(updateDocument.$set.rejectedBy, adminId)
    assert.equal(updateDocument.$set.rejectionReason, 'Please provide a valid student ID.')
    assert.match(notifications[0].message, /Please provide a valid student ID/)
    assert.equal(saved, true)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('independent student rejection remains saved when its Resend notification fails', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000026'
  let saved = false
  let loggedEmailFailure
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  }
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOneAndUpdate', () => {
      saved = true
      return queryResult({
        _id: new mongoose.Types.ObjectId(studentId),
        email: 'rejected@example.invalid',
        fullName: 'Rejected Student',
        approvalStatus: 'rejected',
        status: 'rejected',
        rejectionReason: 'Incomplete application.',
      })
    }),
    stub(Notification, 'create', async () => {}),
    stub(mongoose, 'startSession', async () => session),
    stub(console, 'error', (message) => { loggedEmailFailure = message }),
    stubResendApi(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ message: 'Test Resend failure' }),
    })),
  ]
  try {
    const response = await request(`/admin/independent-students/${studentId}/approval`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { decision: 'reject', reason: 'Incomplete application.' },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.match(result.message, /decision was saved/i)
    assert.equal(result.student.approvalStatus, 'rejected')
    assert.equal(saved, true)
    assert.match(loggedEmailFailure, /notification\.independent_student_reject_email\.failed/)
    assert.match(loggedEmailFailure, /RESEND_SEND_FAILED/)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('approval list returns pending count and newest independent applications first', async () => {
  const adminId = '68a000000000000000000010'
  const createdAt = new Date()
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'find', () => queryResult([
      { _id: '68a000000000000000000023', fullName: 'Latest', status: 'pending', approvalStatus: 'pending', createdAt },
    ])),
    stub(Student, 'countDocuments', async () => 1),
  ]
  try {
    const response = await request('/admin/independent-student-approvals?status=pending', {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.pendingCount, 1)
    assert.equal(result.students[0].fullName, 'Latest')
    assert.equal(result.students[0].approvalStatus, 'pending')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('Main Admin approval details returns saved registration fields without authentication data', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000028'
  const studentDocument = {
    _id: new mongoose.Types.ObjectId(studentId),
    fullName: 'Saved Student',
    email: 'saved@example.invalid',
    username: 'saved-student',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    status: 'active',
    approvalStatus: 'approved',
    approvedAt: new Date('2026-10-02T00:00:00Z'),
    studentType: 'independent',
    referral_code: 'LMS-APPLICATION-REFERRAL',
    educationQualification: 'Undergraduate',
    passwordHash: 'never-return-this',
    registrationDetails: {
      fullName: 'Untrusted duplicate',
      email: 'untrusted@example.invalid',
      username: 'untrusted',
      qualification: 'Other',
      custom_qualification: 'Specialized diploma',
      user_expectations: 'Learn practical skills.',
      location: 'Toronto',
      living_with_whom: 'Other',
      custom_living_arrangement: 'Roommates',
      password: 'never-return-this',
      passwordHash: 'never-return-this',
      accessToken: 'never-return-this',
    },
  }
  let selectedFields
  let studentQuery
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOne', (filter) => {
      studentQuery = filter
      const result = queryResult(studentDocument)
      result.select = (fields) => {
        selectedFields = fields
        return result
      }
      return result
    }),
  ]

  try {
    const response = await request(`/admin/independent-students/${studentId}/approval-details`, {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(studentQuery.studentType, 'independent')
    assert.match(selectedFields, /registrationDetails/)
    assert.match(selectedFields, /approvedAt/)
    assert.doesNotMatch(selectedFields, /password|token|secret/i)
    assert.deepEqual(result.student.registrationDetails, {
      educationQualification: 'Other',
      customQualification: 'Specialized diploma',
      userExpectations: 'Learn practical skills.',
      location: 'Toronto',
      livingWithWhom: 'Other',
      customLivingArrangement: 'Roommates',
      referralCode: 'LMS-APPLICATION-REFERRAL',
      fullName: 'Saved Student',
      email: 'saved@example.invalid',
      username: 'saved-student',
    })
    assert.equal(result.student.fullName, 'Saved Student')
    assert.equal(result.student.email, 'saved@example.invalid')
    assert.equal(result.student.username, 'saved-student')
    assert.equal(result.student.approvedAt, '2026-10-02T00:00:00.000Z')
    assert.equal(result.student.approvalStatus, 'approved')
    assert.equal('passwordHash' in result.student, false)
    assert.equal(result.student.registrationDetails.password, undefined)
    assert.equal(result.student.registrationDetails.accessToken, undefined)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('College Sub-Admin cannot read independent student approval details', async () => {
  const subAdminId = '68a000000000000000000011'
  const studentId = '68a000000000000000000029'
  let detailsRead = false
  const restores = [
    stub(CollegeAdmin, 'findById', async () => ({
      _id: subAdminId, role: 'college_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOne', () => {
      detailsRead = true
      return queryResult(null)
    }),
  ]

  try {
    const response = await request(`/admin/independent-students/${studentId}/approval-details`, {
      role: 'college_admin',
      subject: subAdminId,
      accountCollection: 'sub_admins',
    })
    assert.equal(response.status, 403)
    assert.equal(detailsRead, false)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('College Sub-Admin cannot approve an independent student', async () => {
  const subAdminId = '68a000000000000000000011'
  const studentId = '68a000000000000000000020'
  let changed = false
  const restores = [
    stub(CollegeAdmin, 'findById', async () => ({
      _id: subAdminId, role: 'college_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOneAndUpdate', async () => { changed = true }),
  ]
  try {
    const response = await request(`/admin/independent-students/${studentId}/approval`, {
      role: 'college_admin',
      subject: subAdminId,
      method: 'PATCH',
      body: { decision: 'approve' },
    })

    assert.equal(response.status, 403)
    assert.equal(changed, false)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('college students cannot trigger independent approval or email', async () => {
  const studentId = '68a000000000000000000026'
  let changed = false
  const restores = [
    stub(CollegeStudent, 'findById', () => queryResult({
      _id: studentId,
      role: 'student',
      studentType: 'college',
      status: 'active',
      isActive: true,
    })),
    stub(Student, 'findOneAndUpdate', async () => { changed = true }),
  ]
  try {
    const response = await request(`/admin/independent-students/${studentId}/approval`, {
      role: 'student',
      subject: studentId,
      accountCollection: 'clg_students',
      method: 'PATCH',
      body: { decision: 'approve' },
    })
    assert.equal(response.status, 403)
    assert.equal(changed, false)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('rejected independent accounts cannot be permanently deleted from student management', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000024'
  let deleted = false
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  }
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOne', () => queryResult({
      _id: new mongoose.Types.ObjectId(studentId),
      approvalStatus: 'rejected',
      status: 'rejected',
    })),
    stub(Student, 'deleteOne', async () => { deleted = true }),
    stub(mongoose, 'startSession', async () => session),
  ]
  try {
    const response = await request(`/admin/students/${studentId}?studentType=independent`, {
      role: 'main_admin',
      subject: adminId,
      method: 'DELETE',
    })
    assert.equal(response.status, 409)
    assert.equal(deleted, false)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('pending independent student token cannot access protected learning APIs', async () => {
  const studentId = '68a000000000000000000020'
  const restoreStudent = stub(Student, 'findById', async () => ({
    _id: studentId,
    role: 'student',
    studentType: 'independent',
    status: 'pending',
    approvalStatus: 'pending',
    isActive: false,
  }))
  try {
    const response = await request('/courses', {
      role: 'student',
      subject: studentId,
      accountCollection: 'students',
    })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).message, 'Your account is awaiting approval from the administrator.')
  } finally {
    restoreStudent()
  }
})

test('independent student token without approval cannot access protected learning APIs', async () => {
  const studentId = '68a000000000000000000021'
  const restoreStudent = stub(Student, 'findById', async () => ({
    _id: studentId,
    role: 'student',
    status: 'active',
    isActive: true,
  }))
  try {
    const response = await request('/courses', {
      role: 'student',
      subject: studentId,
      accountCollection: 'students',
    })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).message, 'Your account is awaiting approval from the administrator.')
  } finally {
    restoreStudent()
  }
})

test('college student login remains active without independent approval fields', async () => {
  const accountId = new mongoose.Types.ObjectId()
  const email = 'college-student@example.invalid'
  const username = 'college-student'
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4)
  const restores = [
    stub(AccountIdentity, 'findOne', () => queryResult({
      accountCollection: 'clg_students', accountId, email, username,
    })),
    stub(CollegeStudent, 'findById', () => queryResult({
      _id: accountId, email, username, role: 'student', studentType: 'college',
      status: 'active', isActive: true, passwordHash,
    })),
  ]
  try {
    const response = await request('/auth/login', {
      body: { identifier: email, password: 'correct-horse-battery', role: 'student' },
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).user.studentType, 'college')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student update rejects a duplicate email without changing account data', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000020'
  let updated = false
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId,
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Student, 'findOne', (query) => query._id && !query._id.$ne
      ? queryResult({ _id: new mongoose.Types.ObjectId(studentId) })
      : queryResult(null)),
    stub(CollegeStudent, 'findOne', () => queryResult(null)),
    stub(CollegeAdmin, 'findOne', () => queryResult(null)),
    stub(Admin, 'findOne', () => queryResult(null)),
    stub(AccountIdentity, 'findOne', (query) => query.email
      ? queryResult({ _id: new mongoose.Types.ObjectId('68a000000000000000000099') })
      : queryResult(null)),
    stub(Student, 'updateOne', async () => { updated = true; return { matchedCount: 1 } }),
  ]
  try {
    const response = await request(`/admin/students/${studentId}?studentType=independent`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { fullName: 'Updated Learner', email: 'used@example.com', username: 'updated.learner' },
    })
    assert.equal(response.status, 409)
    assert.equal(updated, false)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('main admin permanent deletion removes the student, identity, and enrollments but not courses', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000020'
  const operations = []
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  }
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId,
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Student, 'findOne', () => queryResult({ _id: new mongoose.Types.ObjectId(studentId) })),
    stub(AccountIdentity, 'deleteOne', async (filter) => { operations.push(['identity', filter]) }),
    stub(Enrollment, 'deleteMany', async (filter) => { operations.push(['enrollments', filter]) }),
    stub(Student, 'deleteOne', async (filter) => { operations.push(['student', filter]) }),
    stub(mongoose, 'startSession', async () => session),
  ]
  try {
    const response = await request(`/admin/students/${studentId}?studentType=independent`, {
      role: 'main_admin',
      subject: adminId,
      method: 'DELETE',
    })
    assert.equal(response.status, 200)
    assert.deepEqual(operations.map(([name]) => name), ['identity', 'enrollments', 'student'])
    assert.equal(String(operations[1][1].userId), studentId)
    assert.equal(String(operations[2][1]._id), studentId)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('bulk college student deletion handles one student and routes to the bulk endpoint', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = new mongoose.Types.ObjectId('68a000000000000000000040')
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000041')
  const operations = []
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  }
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(CollegeStudent, 'find', (filter) => {
      assert.deepEqual(filter._id.$in.map(String), [studentId.toString()])
      assert.equal(String(filter.collegeId), collegeId.toString())
      assert.equal(filter.studentType, 'college')
      assert.equal(filter.role, 'student')
      return queryResult([{ _id: studentId }])
    }),
    stub(AccountIdentity, 'deleteMany', async (filter) => { operations.push(['identity', filter]) }),
    stub(Enrollment, 'deleteMany', async (filter) => { operations.push(['enrollments', filter]) }),
    stub(CollegeStudent, 'deleteMany', async (filter) => { operations.push(['students', filter]) }),
    stub(mongoose, 'startSession', async () => session),
  ]
  try {
    const response = await request('/admin/students/bulk', {
      role: 'main_admin',
      subject: adminId,
      method: 'DELETE',
      body: { collegeId: collegeId.toString(), studentIds: [studentId.toString()] },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.deleted, 1)
    assert.match(result.message, /Deleted 1 college students/)
    assert.deepEqual(operations.map(([name]) => name), ['identity', 'enrollments', 'students'])
    assert.equal(operations[0][1].accountCollection, 'clg_students')
    assert.deepEqual(operations[0][1].accountId.$in.map(String), [studentId.toString()])
    assert.deepEqual(operations[1][1].userId.$in.map(String), [studentId.toString()])
    assert.deepEqual(operations[2][1]._id.$in.map(String), [studentId.toString()])
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('bulk college student deletion handles multiple/all selected students in that college', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = new mongoose.Types.ObjectId('68a000000000000000000042')
  const studentIds = [
    new mongoose.Types.ObjectId('68a000000000000000000043'),
    new mongoose.Types.ObjectId('68a000000000000000000044'),
    new mongoose.Types.ObjectId('68a000000000000000000045'),
  ]
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  }
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(CollegeStudent, 'find', (filter) => {
      assert.deepEqual(filter._id.$in.map(String), studentIds.map(String))
      assert.equal(String(filter.collegeId), collegeId.toString())
      return queryResult(studentIds.map((_id) => ({ _id })))
    }),
    stub(AccountIdentity, 'deleteMany', async () => ({})),
    stub(Enrollment, 'deleteMany', async () => ({})),
    stub(CollegeStudent, 'deleteMany', async () => ({})),
    stub(mongoose, 'startSession', async () => session),
  ]
  try {
    const response = await request('/admin/students/bulk', {
      role: 'main_admin',
      subject: adminId,
      method: 'DELETE',
      body: { collegeId: collegeId.toString(), studentIds: studentIds.map(String) },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.deleted, 3)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('bulk college student deletion rejects invalid IDs without deleting records', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = '68a000000000000000000046'
  let sessionStarted = false
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(mongoose, 'startSession', async () => { sessionStarted = true; throw new Error('Should not start a transaction') }),
  ]
  try {
    const response = await request('/admin/students/bulk', {
      role: 'main_admin',
      subject: adminId,
      method: 'DELETE',
      body: { collegeId, studentIds: ['not-an-object-id'] },
    })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).message, 'Select between 1 and 5,000 unique students.')
    assert.equal(sessionStarted, false)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('bulk college student deletion rejects students outside the selected college atomically', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = new mongoose.Types.ObjectId('68a000000000000000000047')
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000048')
  const otherCollegeId = new mongoose.Types.ObjectId('68a000000000000000000049')
  const storedStudent = { _id: studentId, collegeId: otherCollegeId, studentType: 'college', role: 'student' }
  let deletionAttempted = false
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  }
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(CollegeStudent, 'find', (filter) => {
      assert.equal(String(filter.collegeId), collegeId.toString())
      assert.notEqual(String(storedStudent.collegeId), String(filter.collegeId))
      return queryResult([])
    }),
    stub(AccountIdentity, 'deleteMany', async () => { deletionAttempted = true }),
    stub(Enrollment, 'deleteMany', async () => { deletionAttempted = true }),
    stub(CollegeStudent, 'deleteMany', async () => { deletionAttempted = true }),
    stub(mongoose, 'startSession', async () => session),
  ]
  try {
    const response = await request('/admin/students/bulk', {
      role: 'main_admin',
      subject: adminId,
      method: 'DELETE',
      body: { collegeId: collegeId.toString(), studentIds: [studentId.toString()] },
    })
    assert.equal(response.status, 409)
    assert.match((await response.json()).message, /do not belong to this college/)
    assert.equal(deletionAttempted, false)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('main admin student listing searches both collections and applies combined filters', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = '68a000000000000000000033'
  let pipeline
  const restoreAdmin = stub(Admin, 'findById', async () => ({
    _id: adminId,
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const restoreAggregate = stub(Student, 'aggregate', async (value) => {
    pipeline = value
    return [{
      students: [{
        _id: '68a000000000000000000099',
        fullName: 'College Student',
        studentId: 'C-100',
        studentType: 'college',
        referralCodeUsed: null,
      }, {
        _id: '68a000000000000000000098',
        fullName: 'Independent Student',
        studentId: 'I-100',
        studentType: 'independent',
        referralCodeUsed: 'LMS-USED-CODE',
      }],
      total: [{ count: 1 }],
    }]
  })
  const restoreReferralCodes = stub(ReferralCode, 'find', (filter) => {
    assert.deepEqual(filter, { generatedBy: { $in: ['68a000000000000000000098'] } })
    return queryResult([{
      code: 'LMS-GENERATED-CODE',
      generatedBy: '68a000000000000000000098',
      createdAt: new Date('2026-11-09T10:00:00.000Z'),
      expiresAt: new Date('2026-11-24T10:00:00.000Z'),
      status: 'active',
      usedBy: null,
    }, {
      code: 'LMS-GENERATED-CODE-2',
      generatedBy: '68a000000000000000000098',
      createdAt: new Date('2026-11-09T11:00:00.000Z'),
      expiresAt: new Date('2026-11-24T11:00:00.000Z'),
      status: 'active',
      usedBy: null,
    }])
  })

  try {
    const response = await request(
      `/admin/students?search=C-1&tab=college&filterType=college&collegeId=${collegeId}&page=2&pageSize=10`,
      { role: 'main_admin', subject: adminId },
    )
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.total, 1)
    assert.equal(result.page, 2)
    assert.equal(result.pageSize, 10)
    assert.equal(result.students[0].studentId, 'C-100')
    assert.deepEqual(result.students[0].generatedReferralCodes, [])
    assert.equal(result.students[0].referralCodeUsed, null)
    assert.deepEqual(result.students[1].generatedReferralCodes.map(({ code }) => code), [
      'LMS-GENERATED-CODE',
      'LMS-GENERATED-CODE-2',
    ])
    assert.equal(result.students[1].referralCodeUsed, 'LMS-USED-CODE')
    assert.equal(pipeline.some((stage) => stage.$project?.registrationDetails === 1), false)
    assert.equal(pipeline.some((stage) => stage.$unionWith?.coll === CollegeStudent.collection.name), true)
    const match = pipeline.find((stage) => stage.$match?.studentType)
    assert.equal(match.$match.studentType, 'college')
    assert.equal(String(match.$match.collegeId), collegeId)
    assert.ok(match.$match.$or.some((clause) => clause.studentId instanceof RegExp))
    const studentIdSearch = match.$match.$or.find((clause) => clause.studentId)
    assert.equal(studentIdSearch.studentId.source, 'C-1')
    assert.equal(studentIdSearch.studentId.ignoreCase, true)
    const pagination = pipeline.find((stage) => stage.$facet).$facet.students
    assert.deepEqual(pagination[0].$sort, { createdAt: -1, _id: 1 })
    assert.equal(pagination[1].$skip, 10)
    assert.equal(pagination[2].$limit, 10)
  } finally {
    restoreReferralCodes()
    restoreAggregate()
    restoreAdmin()
  }
})

test('Main Admin can load exact referral code details and redeemed students', async () => {
  const adminId = '68a000000000000000000010'
  const codeOwnerId = new mongoose.Types.ObjectId('68a000000000000000000071')
  const friendId = new mongoose.Types.ObjectId('68a000000000000000000072')
  const code = {
    code: 'LMS-EXACT-REFERRAL',
    generatedBy: codeOwnerId,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    expiresAt: new Date('2026-11-16T10:00:00.000Z'),
    status: 'used',
    usedBy: friendId,
  }
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(ReferralCode, 'findOne', (filter) => {
      assert.deepEqual(filter, { code: 'LMS-EXACT-REFERRAL' })
      return queryResult(code)
    }),
    stub(Student, 'findById', (id) => {
      assert.equal(String(id), String(codeOwnerId))
      return queryResult({ _id: codeOwnerId, fullName: 'Code Owner', studentId: 'OWNER-1' })
    }),
    stub(Student, 'find', (filter) => {
      assert.deepEqual(filter, {
        role: 'student',
        studentType: 'independent',
        'registrationDetails.referralCode': 'LMS-EXACT-REFERRAL',
      })
      return queryResult([{
        _id: friendId,
        fullName: 'Referred Student',
        email: 'referred@example.invalid',
        studentId: 'FRIEND-1',
        createdAt: new Date('2026-11-02T10:00:00.000Z'),
        status: 'pending',
        approvalStatus: 'pending',
      }])
    }),
  ]
  try {
    const response = await request('/admin/referral-codes/LMS-EXACT-REFERRAL/details', {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.code, code.code)
    assert.deepEqual(result.generatedBy, { fullName: 'Code Owner', studentId: 'OWNER-1' })
    assert.equal(result.status, 'Used')
    assert.equal(result.referredStudents[0].fullName, 'Referred Student')
    assert.deepEqual(result.summary, {
      totalReferrals: 1,
      successfulRegistrations: 0,
      pendingRegistrations: 1,
    })
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('Main Admin referral code table loads every generated code and matches all registrations by exact code', async () => {
  const adminId = '68a000000000000000000010'
  const independentId = new mongoose.Types.ObjectId('68a000000000000000000091')
  const collegeStudentId = new mongoose.Types.ObjectId('68a000000000000000000092')
  const firstReferralId = new mongoose.Types.ObjectId('68a000000000000000000093')
  const secondReferralId = new mongoose.Types.ObjectId('68a000000000000000000094')
  const thirdReferralId = new mongoose.Types.ObjectId('68a000000000000000000095')
  const codes = [
    {
      code: 'LMS-OWNER-CODE-1',
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      status: 'used',
      usedBy: firstReferralId,
      usedAt: new Date('2026-11-03T08:30:00.000Z'),
      registrationStatus: 'approved',
    },
    {
      code: 'LMS-OWNER-CODE-2',
      createdAt: new Date('2026-11-02T11:30:00.000Z'),
      status: 'used',
      usedBy: collegeStudentId,
      usedAt: new Date('2026-11-05T10:30:00.000Z'),
      registrationStatus: 'approved',
    },
  ]
  let referralCodeFindCount = 0
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOne', (filter) => {
      assert.equal(String(filter._id), String(independentId))
      assert.equal(filter.studentType, 'independent')
      return queryResult({ _id: independentId })
    }),
    stub(CollegeStudent, 'findOne', (filter) => {
      assert.equal(String(filter._id), String(collegeStudentId))
      assert.equal(filter.studentType, 'college')
      return queryResult({ _id: collegeStudentId })
    }),
    stub(ReferralCode, 'find', (filter) => {
      referralCodeFindCount += 1
      assert.deepEqual(filter, { generatedBy: independentId })
      return queryResult(codes)
    }),
    stub(Student, 'find', (filter) => {
      assert.deepEqual(filter, {
        $or: [
          { _id: { $in: [firstReferralId, collegeStudentId] } },
          {
            role: 'student',
            studentType: 'independent',
            'registrationDetails.referralCode': {
              $in: ['LMS-OWNER-CODE-1', 'LMS-OWNER-CODE-2'],
            },
          },
        ],
      })
      return queryResult([
        {
          _id: firstReferralId,
          fullName: 'First Referred Student',
          email: 'first@example.invalid',
          studentId: 'REF-101',
          createdAt: new Date('2026-11-03T08:00:00.000Z'),
          status: 'active',
          approvalStatus: 'approved',
          registrationDetails: { referralCode: 'LMS-OWNER-CODE-1' },
        },
        {
          _id: secondReferralId,
          fullName: 'Second Referred Student',
          email: 'second@example.invalid',
          studentId: 'REF-102',
          createdAt: new Date('2026-11-04T09:00:00.000Z'),
          status: 'pending',
          approvalStatus: 'pending',
          registrationDetails: { referralCode: 'LMS-OWNER-CODE-1' },
        },
        {
          _id: thirdReferralId,
          fullName: 'Third Referred Student',
          email: 'third@example.invalid',
          studentId: 'REF-103',
          createdAt: new Date('2026-11-05T10:00:00.000Z'),
          status: 'active',
          registrationDetails: { referralCode: 'LMS-OWNER-CODE-2' },
        },
      ])
    }),
    stub(CollegeStudent, 'find', (filter) => {
      assert.deepEqual(filter, {
        _id: { $in: [firstReferralId, collegeStudentId] },
        role: 'student',
        studentType: 'college',
      })
      return queryResult([{
        _id: collegeStudentId,
        fullName: 'College Referred Student',
        email: 'college@example.invalid',
        studentId: 'COL-104',
        createdAt: new Date('2026-11-06T11:00:00.000Z'),
        status: 'active',
      }])
    }),
  ]
  try {
    const response = await request(`/admin/students/${independentId}/referral-codes?studentType=independent`, {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(result.codes.map(({ code }) => code), ['LMS-OWNER-CODE-1', 'LMS-OWNER-CODE-2'])
    assert.equal(result.codes[0].status, 'used')
    assert.equal(result.codes[0].registrationStatus, 'approved')
    assert.equal(result.codes[0].hasUsedBy, true)
    assert.equal(result.codes[0].usedAt, '2026-11-03T08:30:00.000Z')
    assert.equal(result.codes[0].usedBy[0].email, 'first@example.invalid')
    assert.deepEqual(result.codes[0].usedBy.map(({ fullName, studentId, registeredAt }) => ({
      fullName,
      studentId,
      registeredAt,
      registrationStatus: result.codes[0].usedBy.find((student) => student.fullName === fullName)?.registrationStatus,
    })), [
      {
        fullName: 'First Referred Student',
        studentId: 'REF-101',
        registeredAt: '2026-11-03T08:00:00.000Z',
        registrationStatus: 'approved',
      },
      {
        fullName: 'Second Referred Student',
        studentId: 'REF-102',
        registeredAt: '2026-11-04T09:00:00.000Z',
        registrationStatus: 'awaiting_approval',
      },
    ])
    assert.equal(result.codes[1].usedBy.find((student) => student.fullName === 'Third Referred Student').registrationStatus, 'approved')
    assert.equal(result.codes[1].usedBy.find((student) => student.fullName === 'College Referred Student').email, 'college@example.invalid')

    const collegeResponse = await request(`/admin/students/${collegeStudentId}/referral-codes?studentType=college`, {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(collegeResponse.status, 200)
    const collegeResult = await collegeResponse.json()
    assert.deepEqual(collegeResult.codes, [])
    assert.equal(referralCodeFindCount, 1)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('main admin creates independent students with a hashed password and login identity', async () => {
  const adminId = '68a000000000000000000010'
  let savedStudent
  let savedIdentity
  let savedNotification
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId,
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(AccountIdentity, 'exists', async () => null),
    stub(Admin, 'exists', async () => null),
    stub(CollegeAdmin, 'exists', async () => null),
    stub(Student, 'exists', async () => null),
    stub(CollegeStudent, 'exists', async () => null),
    stub(AccountIdentity, 'findOne', () => queryResult(null)),
    stub(Student, 'findOne', () => queryResult(null)),
    stub(CollegeStudent, 'findOne', () => queryResult(null)),
    stub(AccountIdentity, 'create', async (documents) => {
      savedIdentity = documents[0]
      return documents
    }),
    stub(Notification, 'create', async (documents) => {
      savedNotification = documents[0]
      return documents
    }),
    stub(Student, 'create', async (documents) => {
      savedStudent = documents[0]
      return [{ ...documents[0], createdAt: new Date('2026-11-06T00:00:00.000Z') }]
    }),
    stub(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
  ]

  try {
    const response = await request('/admin/students', {
      role: 'main_admin',
      subject: adminId,
      body: {
        fullName: 'Independent Learner',
        email: ' Independent@Example.invalid ',
        username: 'Independent.Learner',
        password: 'a-strong-password',
        studentType: 'independent',
        studentId: 'I-100',
      },
    })
    assert.equal(response.status, 201)
    const result = await response.json()
    assert.equal(result.student.studentType, 'independent')
    assert.equal(result.student.studentId, 'I-100')
    assert.equal(savedStudent.email, 'independent@example.invalid')
    assert.equal(savedStudent.username, 'independent.learner')
    assert.equal(savedStudent.role, 'student')
    assert.equal(savedStudent.status, 'pending')
    assert.equal(savedStudent.isActive, false)
    assert.equal(savedStudent.approvalStatus, 'pending')
    assert.equal(await bcrypt.compare('a-strong-password', savedStudent.passwordHash), true)
    assert.equal(savedIdentity.accountCollection, 'students')
    assert.equal(String(savedIdentity.accountId), String(savedStudent._id))
    assert.equal(savedNotification.type, 'independent_student_registered')
    assert.equal(savedNotification.recipientRole, 'main_admin')
    assert.equal(savedNotification.metadata.email, 'independent@example.invalid')
    assert.equal(Student.collection.name, 'students')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('main admin creates college students in clg_students with their college identity mapping', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = '68a000000000000000000033'
  let savedStudent
  let savedIdentity
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId,
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(AccountIdentity, 'exists', async () => null),
    stub(Admin, 'exists', async () => null),
    stub(CollegeAdmin, 'exists', async () => null),
    stub(Student, 'exists', async () => null),
    stub(CollegeStudent, 'exists', async () => null),
    stub(CollegeAdmin, 'find', (filter) => {
      assert.equal(String(filter.collegeId), collegeId)
      return queryResult([{ studentLimit: 500 }])
    }),
    stub(CollegeStudent, 'countDocuments', (filter) => {
      assert.equal(String(filter.collegeId), collegeId)
      return queryResult(349)
    }),
    stub(College, 'findById', () => queryResult({ _id: collegeId })),
    stub(AccountIdentity, 'findOne', () => queryResult(null)),
    stub(Student, 'findOne', () => queryResult(null)),
    stub(CollegeStudent, 'findOne', () => queryResult(null)),
    stub(AccountIdentity, 'create', async (documents) => {
      savedIdentity = documents[0]
      return documents
    }),
    stub(CollegeStudent, 'create', async (documents) => {
      savedStudent = documents[0]
      return [{ ...documents[0], createdAt: new Date('2026-11-06T00:00:00.000Z') }]
    }),
    stub(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
  ]

  try {
    const response = await request('/admin/students', {
      role: 'main_admin',
      subject: adminId,
      body: {
        fullName: 'College Learner',
        email: 'college@example.invalid',
        username: 'college-learner',
        password: 'a-strong-password',
        studentType: 'college',
        studentId: 'C-100',
        collegeId,
      },
    })
    assert.equal(response.status, 201)
    const result = await response.json()
    assert.equal(result.student.studentType, 'college')
    assert.equal(result.student.collegeId, collegeId)
    assert.equal(String(savedStudent.collegeId), collegeId)
    assert.equal(savedIdentity.accountCollection, 'clg_students')
    assert.equal(String(savedIdentity.accountId), String(savedStudent._id))
    assert.equal(CollegeStudent.collection.name, 'clg_students')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('college student creation enforces the configured Sub-Admin limit without affecting independent students', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = '68a000000000000000000054'
  let studentCreated = false
  let identityCreated = false
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(AccountIdentity, 'exists', async () => false),
    stub(Admin, 'exists', async () => false),
    stub(CollegeAdmin, 'exists', async () => false),
    stub(Student, 'exists', async () => false),
    stub(CollegeStudent, 'exists', async () => false),
    stub(CollegeAdmin, 'find', () => queryResult([{ studentLimit: 1 }])),
    stub(CollegeStudent, 'countDocuments', () => queryResult(1)),
    stub(College, 'findById', () => queryResult({ _id: collegeId })),
    stub(AccountIdentity, 'findOne', () => queryResult(null)),
    stub(Student, 'findOne', () => queryResult(null)),
    stub(CollegeStudent, 'findOne', () => queryResult(null)),
    stub(AccountIdentity, 'create', async () => { identityCreated = true }),
    stub(CollegeStudent, 'create', async () => { studentCreated = true }),
    stub(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
  ]
  try {
    const response = await request('/admin/students', {
      role: 'main_admin',
      subject: adminId,
      body: {
        fullName: 'Over Limit Learner',
        email: 'over-limit@example.invalid',
        username: 'over-limit-learner',
        password: 'a-strong-password',
        studentType: 'college',
        studentId: 'C-101',
        collegeId,
      },
    })
    assert.equal(response.status, 409)
    assert.match((await response.json()).message, /reached its configured student limit of 1/)
    assert.equal(identityCreated, false)
    assert.equal(studentCreated, false)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student creation requires valid details and rejects duplicate email, username, and student ID', async () => {
  const adminId = '68a000000000000000000010'
  const restoreAdmin = stub(Admin, 'findById', async () => ({
    _id: adminId,
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const responseWithoutRequiredFields = await request('/admin/students', {
    role: 'main_admin',
    subject: adminId,
    body: {},
  })
  assert.equal(responseWithoutRequiredFields.status, 400)
  assert.match((await responseWithoutRequiredFields.json()).message, /student name/i)

  try {
    for (const [field, expectedMessage] of [
      ['email', /email already exists/i],
      ['username', /username is already taken/i],
      ['studentId', /student ID already exists/i],
    ]) {
      const restores = [
        stub(AccountIdentity, 'exists', async (query) => query[field] ? { _id: 'existing' } : null),
        stub(Admin, 'exists', async () => null),
        stub(CollegeAdmin, 'exists', async () => null),
        stub(Student, 'exists', async () => null),
        stub(CollegeStudent, 'exists', async () => null),
        stub(Student, 'findOne', (query) => queryResult(query.studentId ? { _id: 'existing' } : null)),
        stub(CollegeStudent, 'findOne', () => queryResult(null)),
      ]
      try {
        const duplicateResponse = await request('/admin/students', {
          role: 'main_admin',
          subject: adminId,
          body: {
            fullName: 'Duplicate Student',
            email: field === 'email' ? 'existing@example.invalid' : 'available@example.invalid',
            username: field === 'username' ? 'existing-user' : 'available-user',
            password: 'a-strong-password',
            studentType: 'independent',
            ...(field === 'studentId' ? { studentId: 'duplicate-id' } : {}),
          },
        })
        assert.equal(duplicateResponse.status, 409)
        assert.match((await duplicateResponse.json()).message, expectedMessage)
      } finally {
        restores.reverse().forEach((restore) => restore())
      }
    }
  } finally {
    restoreAdmin()
  }
})

test('student listing is restricted to main administrators', async () => {
  const restoreStudent = stub(Student, 'findById', async () => ({
    _id: '68a000000000000000000020',
    role: 'student',
    status: 'active',
    isActive: true,
  }))
  try {
    const response = await request('/admin/students', {
      role: 'student',
      subject: '68a000000000000000000020',
    })
    assert.equal(response.status, 403)
  } finally {
    restoreStudent()
  }
})

test('student detail endpoint does not expose details to students', async () => {
  const studentId = '68a000000000000000000020'
  const restoreStudent = stub(Student, 'findById', async () => ({
    _id: studentId,
    role: 'student',
    approvalStatus: 'approved',
    status: 'active',
    isActive: true,
  }))
  try {
    const response = await request(`/admin/students/${studentId}/details?studentType=independent`, {
      role: 'student',
      subject: studentId,
    })
    assert.equal(response.status, 403)
    assert.match((await response.json()).message, /permission/i)
  } finally {
    restoreStudent()
  }
})

test('main admin student details resolve college, deduplicate courses, and calculate completion from enrollment status', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000020'
  const collegeId = '68a000000000000000000030'
  const assignedCourseId = '68a000000000000000000040'
  const enrolledCourseId = '68a000000000000000000050'
  let enrollmentQuery
  let courseQuery
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId,
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(CollegeStudent, 'findOne', (query) => {
      assert.equal(String(query._id), studentId)
      assert.equal(query.studentType, 'college')
      return queryResult({
        _id: new mongoose.Types.ObjectId(studentId),
        fullName: 'College Learner',
        studentId: 'C-100',
        username: 'college.learner',
        email: 'college@example.invalid',
        studentType: 'college',
        collegeId: new mongoose.Types.ObjectId(collegeId),
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        status: 'active',
      })
    }),
    stub(Student, 'findOne', () => {
      assert.fail('College student details must use the clg_students collection.')
    }),
    stub(College, 'findById', (id) => {
      assert.equal(String(id), collegeId)
      return queryResult({ _id: id, name: 'Test College' })
    }),
    stub(Enrollment, 'find', (query) => {
      enrollmentQuery = query
      return queryResult([
        {
          courseId: new mongoose.Types.ObjectId(assignedCourseId),
          assignedBy: new mongoose.Types.ObjectId('68a000000000000000000060'),
          status: 'active',
        },
        {
          courseId: new mongoose.Types.ObjectId(assignedCourseId),
          assignedBy: new mongoose.Types.ObjectId(studentId),
          status: 'completed',
        },
        {
          courseId: new mongoose.Types.ObjectId(enrolledCourseId),
          assignedBy: new mongoose.Types.ObjectId(studentId),
          status: 'active',
        },
      ])
    }),
    stub(Course, 'find', (query) => {
      courseQuery = query
      return queryResult([
        { _id: new mongoose.Types.ObjectId(assignedCourseId), title: 'Assigned Course' },
        { _id: new mongoose.Types.ObjectId(enrolledCourseId), title: 'Self-Enrolled Course' },
      ])
    }),
  ]

  try {
    const response = await request(`/admin/students/${studentId}/details?studentType=college`, {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(result.student, {
      id: studentId,
      fullName: 'College Learner',
      username: 'college.learner',
      email: 'college@example.invalid',
      studentId: 'C-100',
      studentType: 'college',
      collegeName: 'Test College',
      collegeId,
      createdAt: '2026-01-02T00:00:00.000Z',
      status: 'active',
      referralCodeUsed: null,
    })
    assert.equal(String(enrollmentQuery.userId), studentId)
    assert.deepEqual(enrollmentQuery.status, { $ne: 'cancelled' })
    assert.equal(courseQuery._id.$in.length, 2)
    assert.deepEqual(result.summary, {
      coursesAssigned: 1,
      coursesEnrolled: 1,
      coursesCompleted: 1,
      overallCompletionPercentage: 50,
      studentsReferred: 0,
      successfulReferrals: 0,
      pendingReferrals: 0,
    })
    assert.deepEqual(
      result.courseProgress.map(({ title, source, status, progressPercent }) => [
        title,
        source,
        status,
        progressPercent,
      ]),
      [
        ['Assigned Course', 'assigned', 'completed', 100],
        ['Self-Enrolled Course', 'enrolled', 'active', null],
      ],
    )
    assert.deepEqual(result.quizResults, [])
    assert.deepEqual(result.assignmentResults, [])
    assert.deepEqual(result.certificates, [])
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('main admin independent student details do not query or expose college records', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000020'
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId,
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Student, 'findOne', (query) => {
      assert.equal(String(query._id), studentId)
      assert.equal(query.studentType, 'independent')
      return queryResult({
        _id: new mongoose.Types.ObjectId(studentId),
        fullName: 'Independent Learner',
        studentType: 'independent',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        status: 'active',
      })
    }),
    stub(ReferralCode, 'find', () => queryResult([])),
    stub(CollegeStudent, 'findOne', () => {
      assert.fail('Independent student details must use the students collection.')
    }),
    stub(College, 'findById', () => {
      assert.fail('Independent students have no college to resolve.')
    }),
    stub(Enrollment, 'find', () => queryResult([])),
    stub(Course, 'find', () => {
      assert.fail('No course lookup is needed when there are no enrollments.')
    }),
  ]
  try {
    const response = await request(`/admin/students/${studentId}/details?studentType=independent`, {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.student.collegeName, null)
    assert.equal(result.student.collegeId, null)
    assert.deepEqual(result.summary, {
      coursesAssigned: 0,
      coursesEnrolled: 0,
      coursesCompleted: 0,
      overallCompletionPercentage: null,
      studentsReferred: 0,
      successfulReferrals: 0,
      pendingReferrals: 0,
    })
    assert.deepEqual(result.courseProgress, [])
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('main admin overview returns database-backed statistics and chart records', async () => {
  const adminId = '68a000000000000000000010'
  const restoreAdmin = stub(Admin, 'findById', async () => ({
    _id: adminId,
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const restoreStudentCount = stub(Student, 'countDocuments', async (filter) => {
    if (filter?.$or) return 12
    assert.deepEqual(filter, { role: 'student' })
    return 12
  })
  const restoreCollegeStudentCount = stub(CollegeStudent, 'countDocuments', async (filter) => {
    assert.deepEqual(filter, { role: 'student' })
    return 8
  })
  const restoreCollegeCount = stub(College, 'countDocuments', async () => 3)
  const restoreCourseCount = stub(Course, 'countDocuments', async () => 5)
  const restoreEnrollmentCount = stub(Enrollment, 'countDocuments', async (filter) => {
    if (filter?.status === 'completed') return 4
    if (filter?.status === 'active') return 6
    return 11
  })
  const restoreEnrollmentAggregate = stub(Enrollment, 'aggregate', async (pipeline) => {
    assert.deepEqual(pipeline[0], {
      $match: {
        userId: { $exists: true, $ne: null },
        status: { $ne: 'cancelled' },
      },
    })
    assert.deepEqual(pipeline[1].$lookup, {
      from: 'courses',
      localField: 'courseId',
      foreignField: '_id',
      as: 'course',
    })
    assert.ok(pipeline.some((stage) => stage.$addFields?._courseLessonIds))
    const lessonProgress = pipeline.find((stage) => stage.$addFields?._completedLessonCount)
    assert.deepEqual(lessonProgress.$addFields._completedLessonCount, {
      $size: {
        $setIntersection: [
          { $ifNull: ['$completedLessonIds', []] },
          '$_courseLessonIds',
        ],
      },
    })
    return [{
      enrolledStudents: 7,
      completedStudents: 2,
      inProgressStudents: 3,
      notStartedStudents: 2,
    }]
  })
  const restoreEnrollmentExists = stub(Enrollment, 'exists', async () => true)
  const restoreIndependentStudents = stub(Student, 'find', () => queryResult([{
    _id: 'student-1',
    fullName: 'Independent Learner',
    role: 'student',
    createdAt: new Date('2026-11-05T00:00:00.000Z'),
  }]))
  const restoreCollegeStudents = stub(CollegeStudent, 'find', () => queryResult([]))
  const restoreCourses = stub(Course, 'find', () => queryResult([{
    _id: 'course-1',
    title: 'Database-backed course',
    status: 'published',
    createdAt: new Date('2026-11-04T00:00:00.000Z'),
  }]))

  try {
    const response = await request('/admin/overview', {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(result.stats, {
      totalStudents: 20,
      pendingIndependentStudents: 12,
      totalColleges: 3,
      totalCourses: 5,
      totalEnrollments: 11,
      enrolledStudents: 7,
    })
    assert.deepEqual(result.recentCourses.map(({ title }) => title), ['Database-backed course'])
    assert.deepEqual(result.courseCompletion, {
      completed: 4,
      inProgress: 6,
      enrolledStudents: 7,
      completedStudents: 2,
      inProgressStudents: 3,
      notStartedStudents: 2,
    })
    assert.equal(result.dataAvailability.courseCompletion, true)
  } finally {
    restoreCourses()
    restoreCollegeStudents()
    restoreIndependentStudents()
    restoreEnrollmentAggregate()
    restoreEnrollmentCount()
    restoreEnrollmentExists()
    restoreCourseCount()
    restoreCollegeCount()
    restoreCollegeStudentCount()
    restoreStudentCount()
    restoreAdmin()
  }
})

test('main admin engagement endpoint groups MongoDB enrollment records by selected period', async () => {
  const adminId = '68a000000000000000000010'
  const restoreAdmin = stub(Admin, 'findById', async () => ({
    _id: adminId,
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const pipelines = []
  const restoreEngagement = stub(Enrollment, 'aggregate', async (pipeline) => {
    pipelines.push(pipeline)
    const format = pipeline[1].$group._id.$dateToString.format
    return [{ _id: format === '%Y-%m' ? '2026-11' : '2026-11-06', count: 4 }]
  })

  try {
    for (const [period, granularity, format] of [
      ['7d', 'day', '%Y-%m-%d'],
      ['30d', 'day', '%Y-%m-%d'],
      ['3m', 'month', '%Y-%m'],
      ['6m', 'month', '%Y-%m'],
    ]) {
      const response = await request(`/admin/engagement?period=${period}`, {
        role: 'main_admin',
        subject: adminId,
      })
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.period, period)
      assert.equal(result.granularity, granularity)
      assert.deepEqual(result.engagement, [{
        date: granularity === 'month' ? '2026-11' : '2026-11-06',
        count: 4,
      }])
      assert.deepEqual(pipelines.at(-1)[1].$group._id.$dateToString, {
        format,
        date: '$createdAt',
        timezone: 'UTC',
      })
      assert.ok(pipelines.at(-1)[0].$match.createdAt.$gte instanceof Date)
      assert.equal(pipelines.at(-1)[0].$match.createdAt.$lte instanceof Date, true)
    }

    const invalidResponse = await request('/admin/engagement?period=2y', {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(invalidResponse.status, 400)
    assert.equal(pipelines.length, 4)
  } finally {
    restoreEngagement()
    restoreAdmin()
  }
})

test('main admin all-student report includes independent and college students with their own enrollments', async () => {
  const independentId = new mongoose.Types.ObjectId('68a000000000000000000101')
  const collegeStudentId = new mongoose.Types.ObjectId('68a000000000000000000102')
  const collegeId = new mongoose.Types.ObjectId('68a000000000000000000103')
  const restoreAdmin = stub(Admin, 'findById', async () => ({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const restoreIndependent = stub(Student, 'find', () => queryResult([{
    _id: independentId,
    fullName: 'Independent Learner',
    email: 'independent@example.invalid',
    role: 'student',
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }]))
  const restoreCollegeStudent = stub(CollegeStudent, 'find', () => queryResult([{
    _id: collegeStudentId,
    fullName: 'College Learner',
    email: 'college@example.invalid',
    role: 'student',
    status: 'active',
    collegeId,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
  }]))
  const restoreCollege = stub(College, 'find', () => queryResult([{
    _id: collegeId,
    name: 'Test College',
    code: 'TEST',
  }]))
  const restoreEnrollment = stub(Enrollment, 'find', (filter) => queryResult(
    filter.$or
      ? [{
        userId: independentId,
        courseId: { _id: '68a000000000000000000201', title: 'Independent Course' },
        status: 'completed',
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      }]
      : [{
        userId: collegeStudentId,
        courseId: { _id: '68a000000000000000000202', title: 'College Course' },
        collegeId: { _id: collegeId, name: 'Test College', code: 'TEST' },
        status: 'active',
        createdAt: new Date('2026-02-02T00:00:00.000Z'),
      }],
  ))
  try {
    const response = await request('/admin/reports?type=all&page=0', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.hasMore, false)
    assert.deepEqual(
      result.rows.map((row) => [row.studentType, row.studentName, row.courseTitle]),
      [
        ['independent', 'Independent Learner', 'Independent Course'],
        ['college', 'College Learner', 'College Course'],
      ],
    )
    assert.equal(result.rows[1].collegeName, 'Test College')
  } finally {
    restoreEnrollment()
    restoreCollege()
    restoreCollegeStudent()
    restoreIndependent()
    restoreAdmin()
  }
})

test('main admin progress summary is calculated from active enrollment and quiz records', async () => {
  const independentStudentId = new mongoose.Types.ObjectId('68a000000000000000000401')
  const collegeStudentId = new mongoose.Types.ObjectId('68a000000000000000000402')
  const independentEnrollmentId = new mongoose.Types.ObjectId('68a000000000000000000403')
  const collegeEnrollmentId = new mongoose.Types.ObjectId('68a000000000000000000404')
  const completedCourseId = new mongoose.Types.ObjectId('68a000000000000000000405')
  const inProgressCourseId = new mongoose.Types.ObjectId('68a000000000000000000406')
  const lessonOneId = new mongoose.Types.ObjectId('68a000000000000000000407')
  const lessonTwoId = new mongoose.Types.ObjectId('68a000000000000000000408')
  const submittedAt = new Date(Date.now() - 60 * 60 * 1000)
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: '68a000000000000000000010', role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Enrollment, 'find', () => queryResult([
      {
        _id: independentEnrollmentId,
        userId: { _id: independentStudentId, role: 'student' },
        courseId: completedCourseId,
        status: 'completed',
        completedLessonIds: [lessonOneId, lessonTwoId],
        startedLessonIds: [],
        lessonCompletionDates: { [lessonOneId]: submittedAt },
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
      {
        _id: collegeEnrollmentId,
        userId: { _id: collegeStudentId, role: 'student', collegeId: '68a000000000000000000409' },
        courseId: inProgressCourseId,
        collegeId: '68a000000000000000000409',
        status: 'active',
        completedLessonIds: [],
        startedLessonIds: [lessonOneId],
        lessonCompletionDates: {},
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    ])),
    stub(Course, 'find', () => queryResult([
      {
        _id: completedCourseId,
        title: 'Completed course',
        modules: [{ contentItems: [
          { _id: lessonOneId, type: 'video-lesson', title: 'Lesson one' },
          { _id: lessonTwoId, type: 'video-lesson', title: 'Lesson two' },
        ] }],
      },
      {
        _id: inProgressCourseId,
        title: 'In-progress course',
        modules: [{ contentItems: [
          { _id: lessonOneId, type: 'video-lesson', title: 'Lesson one' },
          { _id: lessonTwoId, type: 'video-lesson', title: 'Lesson two' },
        ] }],
      },
    ])),
    stub(QuizAttempt, 'find', () => queryResult([{
      enrollmentId: independentEnrollmentId,
      userId: independentStudentId,
      courseId: completedCourseId,
      submittedAt,
    }])),
  ]
  try {
    const response = await request('/admin/reports/progress/summary', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(result.courseStatuses, { completed: 1, inProgress: 1, notStarted: 0 })
    assert.equal(result.progressBuckets.find(({ label }) => label === '100%').count, 1)
    assert.equal(result.progressBuckets.find(({ label }) => label === '0%').count, 1)
    assert.equal(result.activityOverTime.length, 1)
    assert.equal(result.activityOverTime[0].completedLessons, 1)
    assert.equal(result.activityOverTime[0].quizSubmissions, 1)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('main admin individual progress report includes lessons, quiz scores, and relationship-scoped activity', async () => {
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000501')
  const collegeId = new mongoose.Types.ObjectId('68a000000000000000000502')
  const enrollmentId = new mongoose.Types.ObjectId('68a000000000000000000503')
  const courseId = new mongoose.Types.ObjectId('68a000000000000000000504')
  const completedLessonId = new mongoose.Types.ObjectId('68a000000000000000000505')
  const pendingLessonId = new mongoose.Types.ObjectId('68a000000000000000000506')
  const quizId = new mongoose.Types.ObjectId('68a000000000000000000507')
  const attemptId = new mongoose.Types.ObjectId('68a000000000000000000508')
  const assignmentId = new mongoose.Types.ObjectId('68a00000000000000000050a')
  const submissionId = new mongoose.Types.ObjectId('68a00000000000000000050b')
  const enrolledAt = new Date('2026-10-01T10:00:00.000Z')
  const completedAt = new Date('2026-10-02T10:00:00.000Z')
  const submittedAt = new Date('2026-10-03T10:00:00.000Z')
  const certificateIssuedAt = new Date('2026-10-04T10:00:00.000Z')
  const certificateId = `AIH-${'A'.repeat(32)}`
  let enrollmentFilter
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: '68a000000000000000000010', role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(CollegeStudent, 'findOne', () => queryResult({
      _id: studentId,
      fullName: 'College Learner',
      email: 'learner@example.invalid',
      role: 'student',
      studentType: 'college',
      collegeId,
    })),
    stub(Enrollment, 'find', (filter) => {
      enrollmentFilter = filter
      return queryResult([{
        _id: enrollmentId,
        userId: studentId,
        courseId,
        collegeId,
        status: 'active',
        completedLessonIds: [completedLessonId],
        startedLessonIds: [pendingLessonId],
        lessonCompletionDates: { [completedLessonId]: completedAt },
        createdAt: enrolledAt,
      }])
    }),
    stub(Course, 'find', () => queryResult([{
      _id: courseId,
      title: 'AI Fundamentals',
      modules: [{
        contentItems: [
          { _id: completedLessonId, type: 'video-lesson', title: 'Introduction' },
          { _id: pendingLessonId, type: 'video-lesson', title: 'Practice' },
          { type: 'quiz', title: 'Knowledge check', quiz: { _id: quizId, title: 'Knowledge check' } },
        ],
      }],
      assignments: [{ _id: assignmentId, title: 'Reflection', description: 'Reflect on the lesson.', points: 10 }],
    }])),
    stub(QuizAttempt, 'find', () => queryResult([{
      _id: attemptId,
      enrollmentId,
      userId: studentId,
      courseId,
      quizId,
      status: 'submitted',
      startedAt: new Date('2026-10-03T09:00:00.000Z'),
      submittedAt,
      earnedPoints: 8,
      totalPoints: 10,
      scorePercentage: 80,
      correctAnswers: 1,
      passed: true,
      questionSnapshot: [{
        questionId: new mongoose.Types.ObjectId('68a00000000000000000050c'),
        prompt: 'What did you learn?',
        options: ['A', 'B'],
        correctOptionIndices: [1],
        marks: 2,
      }],
      answers: [{
        questionId: new mongoose.Types.ObjectId('68a00000000000000000050c'),
        selectedOptionIndices: [1],
        correctOptionIndices: [1],
      }],
    }])),
    stub(AssignmentSubmission, 'find', (filter) => {
      assert.deepEqual(filter, {
        userId: studentId,
        enrollmentId: { $in: [enrollmentId] },
        courseId: { $in: [String(courseId)] },
        collegeId,
      })
      return queryResult([{
        _id: submissionId,
        enrollmentId,
        userId: studentId,
        collegeId,
        courseId,
        assignmentId,
        fileName: 'reflection.pdf',
        contentType: 'application/pdf',
        fileSize: 128,
        submittedAt,
        marksObtained: 8,
        evaluationStatus: 'evaluated',
        correctness: 'partially_correct',
        feedback: 'Good work.',
        evaluatedAt: submittedAt,
        evaluatorId: new mongoose.Types.ObjectId('68a00000000000000000050d'),
        evaluationHistory: [{
          marksObtained: 8,
          feedback: 'Good work.',
          correctness: 'partially_correct',
          evaluatedAt: submittedAt,
          evaluatorId: new mongoose.Types.ObjectId('68a00000000000000000050d'),
        }],
      }, {
        _id: new mongoose.Types.ObjectId('68a00000000000000000050e'),
        enrollmentId: new mongoose.Types.ObjectId('68a00000000000000000050f'),
        userId: studentId,
        collegeId,
        courseId,
        assignmentId,
      }])
    }),
    stub(College, 'findById', () => queryResult({ name: 'Example College' })),
    stub(Certificate, 'find', (filter) => {
      assert.deepEqual(filter, {
        $or: [
          { studentId, studentType: 'college', collegeId },
          { userId: studentId },
        ],
      })
      return queryResult([{
        _id: new mongoose.Types.ObjectId('68a000000000000000000509'),
        certificateId,
        studentName: 'College Learner',
        studentType: 'college',
        studentId,
        collegeId,
        courseId,
        courseName: 'AI Fundamentals',
        name: 'AI Fundamentals Certificate of Completion',
        issuedAt: certificateIssuedAt,
        viewUrl: `/certificates/${certificateId}/view`,
        downloadUrl: `/certificates/${certificateId}/download`,
      }])
    }),
  ]
  try {
    const response = await request(`/admin/reports/progress/college/${studentId}`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(response.status, 200)
    assert.deepEqual(enrollmentFilter, {
      userId: studentId,
      status: { $ne: 'cancelled' },
      collegeId,
    })
    const result = await response.json()
    assert.equal(result.student.collegeName, 'Example College')
    assert.equal(result.courseProgress[0].completionPercent, 50)
    assert.deepEqual(result.courseProgress[0].lessons[0], {
      id: String(completedLessonId),
      title: 'Introduction',
      status: 'completed',
      completedAt: completedAt.toISOString(),
    })
    assert.deepEqual(result.courseProgress[0].completedLessons.map(({ title }) => title), ['Introduction'])
    assert.deepEqual(result.courseProgress[0].pendingLessons.map(({ title }) => title), ['Practice'])
    assert.equal(result.courseProgress[0].quizAttempts[0].questions[0].prompt, 'What did you learn?')
    assert.deepEqual(result.courseProgress[0].quizAttempts[0].answers[0].selectedOptionIndices, [1])
    assert.equal(result.courseProgress[0].quizAttempts[0].questionCount, 1)
    assert.equal(result.courseProgress[0].quizAttempts[0].correctAnswers, 1)
    assert.equal(result.courseProgress[0].quizAttempts[0].earnedPoints, 8)
    assert.equal(result.courseProgress[0].quizAttempts[0].totalPoints, 10)
    assert.equal(result.courseProgress[0].quizAttempts[0].scorePercentage, 80)
    assert.equal(result.courseProgress[0].quizAttempts[0].passed, true)
    assert.equal(result.courseProgress[0].submissions.length, 1)
    assert.equal(result.courseProgress[0].submissions[0].assignmentName, 'Reflection')
    assert.equal(result.courseProgress[0].submissions[0].maximumMarks, 10)
    assert.equal(result.courseProgress[0].submissions[0].marksObtained, 8)
    assert.equal('fileData' in result.courseProgress[0].submissions[0], false)
    assert.deepEqual(result.courseProgress[0].marksSummary, {
      marksObtained: 16,
      maximumMarks: 20,
      percentage: 80,
    })
    assert.deepEqual(result.courseProgress[0].assignmentSummary, {
      submittedCount: 1,
      totalCount: 1,
    })
    assert.deepEqual(result.overallPerformance, {
      marksObtained: 16,
      maximumMarks: 20,
      percentage: 80,
    })
    assert.equal(result.quizResults[0].quizName, 'Knowledge check')
    assert.equal(result.quizResults[0].scorePercentage, 80)
    assert.ok(result.progressHistory.some(({ type }) => type === 'Lesson completed'))
    assert.ok(result.progressHistory.some(({ type }) => type === 'Quiz submitted'))
    assert.deepEqual(result.certificates, [{
      id: '68a000000000000000000509',
      certificateId,
      name: 'AI Fundamentals Certificate of Completion',
      courseId: String(courseId),
      courseName: 'AI Fundamentals',
      issuedAt: certificateIssuedAt.toISOString(),
      viewUrl: `/certificates/${certificateId}/view`,
      downloadUrl: `/certificates/${certificateId}/download`,
    }])
    assert.equal(result.certificateRecordsAvailable, true)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('main admin independent progress report scopes per-course lessons, attempts, and submissions', async () => {
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000511')
  const enrollmentId = new mongoose.Types.ObjectId('68a000000000000000000512')
  const courseId = new mongoose.Types.ObjectId('68a000000000000000000513')
  const lessonId = new mongoose.Types.ObjectId('68a000000000000000000514')
  const assignmentId = new mongoose.Types.ObjectId('68a000000000000000000515')
  const submittedAt = new Date('2026-10-12T10:00:00.000Z')
  const earlierSubmittedAt = new Date('2026-10-11T10:00:00.000Z')
  const otherEnrollmentId = new mongoose.Types.ObjectId('68a000000000000000000516')
  const quizId = new mongoose.Types.ObjectId('68a000000000000000000518')
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: '68a000000000000000000010', role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOne', () => queryResult({
      _id: studentId, fullName: 'Independent Learner', role: 'student', studentType: 'independent',
    })),
    stub(Enrollment, 'find', () => queryResult([{
      _id: enrollmentId,
      userId: studentId,
      courseId,
      status: 'active',
      completedLessonIds: [lessonId],
      lessonCompletionDates: { [lessonId]: submittedAt },
    }])),
    stub(Course, 'find', () => queryResult([{
      _id: courseId,
      title: 'Independent Course',
      modules: [{ lessons: [{ _id: lessonId, title: 'Lesson One' }] }],
      assignments: [{ _id: assignmentId, title: 'Task', description: 'Do the task.', points: 5 }],
    }])),
    stub(QuizAttempt, 'find', (filter) => {
      assert.equal(String(filter.userId), String(studentId))
      assert.deepEqual(filter.enrollmentId, { $in: [enrollmentId] })
      return queryResult([{
        _id: new mongoose.Types.ObjectId('68a000000000000000000517'),
        userId: studentId,
        enrollmentId,
        courseId,
        quizId,
        status: 'submitted',
        submittedAt: earlierSubmittedAt,
        earnedPoints: 1,
        totalPoints: 5,
      }, {
        _id: new mongoose.Types.ObjectId('68a00000000000000000051c'),
        userId: studentId,
        enrollmentId,
        courseId,
        quizId,
        status: 'submitted',
        submittedAt,
        earnedPoints: 4,
        totalPoints: 5,
      }, {
        _id: new mongoose.Types.ObjectId('68a000000000000000000519'),
        userId: studentId,
        enrollmentId: otherEnrollmentId,
        courseId,
        status: 'submitted',
        earnedPoints: 5,
        totalPoints: 5,
      }])
    }),
    stub(AssignmentSubmission, 'find', () => queryResult([{
      _id: new mongoose.Types.ObjectId('68a00000000000000000051a'),
      userId: studentId,
      enrollmentId,
      courseId,
      assignmentId,
      fileName: 'earlier.pdf',
      contentType: 'application/pdf',
      fileSize: 64,
      submittedAt: earlierSubmittedAt,
      marksObtained: 1,
      evaluationStatus: 'evaluated',
    }, {
      _id: new mongoose.Types.ObjectId('68a00000000000000000051d'),
      userId: studentId,
      enrollmentId,
      courseId,
      assignmentId,
      fileName: 'task.pdf',
      contentType: 'application/pdf',
      fileSize: 64,
      submittedAt,
      marksObtained: 4,
      evaluationStatus: 'evaluated',
    }, {
      _id: new mongoose.Types.ObjectId('68a00000000000000000051b'),
      userId: studentId,
      enrollmentId: otherEnrollmentId,
      courseId,
      assignmentId,
      fileName: 'other.pdf',
    }])),
    stub(Certificate, 'find', () => queryResult([])),
  ]
  try {
    const response = await request(`/admin/reports/progress/independent/${studentId}`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.courseProgress[0].lessons[0].status, 'completed')
    assert.equal(result.courseProgress[0].quizAttempts.length, 2)
    assert.equal(result.courseProgress[0].submissions.length, 2)
    assert.equal(result.courseProgress[0].submissions[1].instructions, 'Do the task.')
    assert.equal(result.courseProgress[0].submissions[1].maximumMarks, 5)
    assert.deepEqual(result.courseProgress[0].assignmentSummary, {
      submittedCount: 1,
      totalCount: 1,
    })
    assert.deepEqual(result.courseProgress[0].marksSummary, {
      marksObtained: 8,
      maximumMarks: 10,
      percentage: 80,
    })
    assert.deepEqual(result.overallPerformance, {
      marksObtained: 8,
      maximumMarks: 10,
      percentage: 80,
    })
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('Main Admin submission file download checks enrollment relationship and returns safe headers', async () => {
  const adminId = '68a000000000000000000010'
  const submissionId = '68a000000000000000000531'
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000532')
  const enrollmentId = new mongoose.Types.ObjectId('68a000000000000000000533')
  const courseId = new mongoose.Types.ObjectId('68a000000000000000000534')
  const fileContents = Buffer.from('%PDF-1.7\nwork')
  const fileData = new mongoose.mongo.BSON.Binary(fileContents)
  let enrollmentExists = false
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(AssignmentSubmission, 'findOne', () => queryResult({
      _id: submissionId,
      userId: studentId,
      enrollmentId,
      courseId,
      fileName: 'report".pdf',
      contentType: 'application/pdf',
      fileSize: fileContents.length,
      fileData,
    })),
    stub(Enrollment, 'findOne', (filter) => {
      assert.equal(String(filter._id), String(enrollmentId))
      assert.equal(String(filter.userId), String(studentId))
      assert.equal(String(filter.courseId), String(courseId))
      return queryResult(enrollmentExists ? { _id: enrollmentId } : null)
    }),
  ]
  try {
    const denied = await request(`/admin/reports/progress/submissions/${submissionId}/file`, {
      role: 'main_admin', subject: adminId,
    })
    assert.equal(denied.status, 404)
    enrollmentExists = true
    const response = await request(`/admin/reports/progress/submissions/${submissionId}/file`, {
      role: 'main_admin', subject: adminId,
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="report_.pdf"')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fileContents)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('Main Admin evaluation validates bounds, requires Main Admin, and appends evaluation history', async () => {
  const adminId = '68a000000000000000000010'
  const studentId = '68a000000000000000000541'
  const submissionId = '68a000000000000000000542'
  const enrollmentId = new mongoose.Types.ObjectId('68a000000000000000000543')
  const courseId = new mongoose.Types.ObjectId('68a000000000000000000544')
  const assignmentId = new mongoose.Types.ObjectId('68a000000000000000000545')
  const history = [{
    marksObtained: 2,
    feedback: 'First review',
    correctness: 'partially_correct',
    evaluationStatus: 'evaluated',
    evaluatedAt: new Date('2026-10-01T10:00:00.000Z'),
    evaluatorId: new mongoose.Types.ObjectId('68a000000000000000000546'),
  }]
  let savedHistory = [...history]
  let capturedUpdate
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findById', async () => ({
      _id: studentId,
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      approvalStatus: 'approved',
      isActive: true,
    })),
    stub(AssignmentSubmission, 'findOne', () => queryResult({
      _id: submissionId,
      userId: studentId,
      enrollmentId,
      courseId,
      assignmentId,
    })),
    stub(Enrollment, 'findOne', () => queryResult({ _id: enrollmentId })),
    stub(Course, 'findById', () => queryResult({
      _id: courseId,
      assignments: [{ _id: assignmentId, title: 'Written task', description: 'Write clearly.', points: 5 }],
    })),
    stub(AssignmentSubmission, 'findOneAndUpdate', (_filter, update) => {
      capturedUpdate = update
      savedHistory.push(update.$push.evaluationHistory)
      return queryResult({
        _id: submissionId,
        userId: studentId,
        enrollmentId,
        courseId,
        assignmentId,
        fileName: 'work.pdf',
        contentType: 'application/pdf',
        fileSize: 10,
        submittedAt: new Date('2026-10-02T10:00:00.000Z'),
        ...update.$set,
        evaluationHistory: [...savedHistory],
      })
    }),
  ]
  try {
    for (const marksObtained of [-1, 6]) {
      const invalid = await request(`/admin/reports/progress/submissions/${submissionId}/evaluation`, {
        role: 'main_admin',
        subject: adminId,
        method: 'PUT',
        body: { marksObtained },
      })
      assert.equal(invalid.status, 400)
    }
    for (const invalidEvaluation of [
      { marksObtained: 4, correctness: 'unknown' },
      { marksObtained: 4, evaluationStatus: 'pending' },
      { marksObtained: 4, feedback: 42 },
    ]) {
      const invalid = await request(`/admin/reports/progress/submissions/${submissionId}/evaluation`, {
        role: 'main_admin',
        subject: adminId,
        method: 'PUT',
        body: invalidEvaluation,
      })
      assert.equal(invalid.status, 400)
    }
    const nonAdmin = await request(`/admin/reports/progress/submissions/${submissionId}/evaluation`, {
      role: 'student',
      subject: studentId,
      method: 'PUT',
      body: { marksObtained: 4 },
    })
    assert.equal(nonAdmin.status, 403)
    const response = await request(`/admin/reports/progress/submissions/${submissionId}/evaluation`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PUT',
      body: { marksObtained: 4, feedback: '  Clear and complete.  ', correctness: 'correct' },
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.submission.marksObtained, 4)
    assert.equal(result.submission.maximumMarks, 5)
    assert.equal(result.submission.feedback, 'Clear and complete.')
    assert.equal(result.submission.evaluationStatus, 'evaluated')
    assert.equal(result.submission.evaluationHistory.length, 2)
    assert.equal(result.submission.evaluationHistory[1].evaluationStatus, 'evaluated')
    assert.equal(capturedUpdate.$push.evaluationHistory.evaluatorId.toString(), adminId)
    assert.equal(capturedUpdate.$set.evaluatorId.toString(), adminId)
    assert.equal(capturedUpdate.$set.evaluationStatus, 'evaluated')

    const reEvaluation = await request(`/admin/reports/progress/submissions/${submissionId}/evaluation`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PUT',
      body: {
        marksObtained: 3,
        feedback: 'Review requested.',
        correctness: 'partially_correct',
        evaluationStatus: 're_evaluation_required',
      },
    })
    assert.equal(reEvaluation.status, 200)
    const updated = await reEvaluation.json()
    assert.equal(updated.submission.evaluationStatus, 're_evaluation_required')
    assert.equal(updated.submission.evaluationHistory.length, 3)
    assert.equal(updated.submission.evaluationHistory[2].evaluationStatus, 're_evaluation_required')
    assert.equal(capturedUpdate.$set.evaluationStatus, 're_evaluation_required')
    assert.equal(capturedUpdate.$push.evaluationHistory.evaluationStatus, 're_evaluation_required')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('main admin individual progress report loads only the independent student certificates', async () => {
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000521')
  const issuedAt = new Date('2026-10-10T12:00:00.000Z')
  const certificateId = `AIH-${'C'.repeat(32)}`
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: '68a000000000000000000010', role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOne', () => queryResult({
      _id: studentId,
      fullName: 'Independent Learner',
      username: 'independent-learner',
      email: 'independent@example.invalid',
      role: 'student',
      studentType: 'independent',
    })),
    stub(Enrollment, 'find', () => queryResult([])),
    stub(Certificate, 'find', (filter) => {
      assert.deepEqual(filter, {
        $or: [
          { studentId, studentType: 'independent', collegeId: { $exists: false } },
          { userId: studentId },
        ],
      })
      return queryResult([{
        _id: new mongoose.Types.ObjectId('68a000000000000000000522'),
        studentId,
        studentType: 'independent',
        certificateId,
        name: 'Verified Course Certificate of Completion',
        courseId: new mongoose.Types.ObjectId('68a000000000000000000523'),
        courseName: 'Verified Course',
        issuedAt,
        viewUrl: `/certificates/${certificateId}/view`,
        downloadUrl: `/certificates/${certificateId}/download`,
      }])
    }),
  ]
  try {
    const response = await request(`/admin/reports/progress/independent/${studentId}`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.certificateRecordsAvailable, true)
    assert.equal(result.certificates.length, 1)
    assert.equal(result.certificates[0].certificateId, certificateId)
    assert.equal(result.certificates[0].courseName, 'Verified Course')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('main admin progress report includes existing legacy certificates through their enrollment relationship', async () => {
  const studentId = new mongoose.Types.ObjectId('68a000000000000000000541')
  const enrollmentId = new mongoose.Types.ObjectId('68a000000000000000000542')
  const courseId = new mongoose.Types.ObjectId('68a000000000000000000543')
  const certificateId = 'AIH-2026-ABCDEF123456'
  const completedAt = new Date('2026-10-11T12:00:00.000Z')
  const enrollment = {
    _id: enrollmentId,
    userId: studentId,
    courseId,
    status: 'completed',
    completedLessonIds: [],
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
  }
  const legacyCertificate = {
    _id: new mongoose.Types.ObjectId('68a000000000000000000544'),
    userId: studentId,
    enrollmentId,
    courseId,
    certificateId,
    studentName: 'Independent Learner',
    courseName: 'Previously Completed Course',
    completedAt,
  }
  let enrollmentFindCount = 0
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: '68a000000000000000000010', role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Student, 'findOne', () => queryResult({
      _id: studentId,
      fullName: 'Independent Learner',
      email: 'learner@example.invalid',
      role: 'student',
      studentType: 'independent',
    })),
    stub(Enrollment, 'find', (filter) => {
      enrollmentFindCount += 1
      if (enrollmentFindCount === 1) {
        assert.deepEqual(filter, {
          userId: studentId,
          status: { $ne: 'cancelled' },
          $or: [{ collegeId: { $exists: false } }, { collegeId: null }],
        })
        return queryResult([enrollment])
      }
      assert.deepEqual(filter, {
        _id: { $in: [String(enrollmentId)] },
        userId: studentId,
        $or: [{ collegeId: { $exists: false } }, { collegeId: null }],
      })
      return queryResult([{ _id: enrollmentId, courseId }])
    }),
    stub(Course, 'find', () => queryResult([{
      _id: courseId,
      title: 'Previously Completed Course',
      modules: [],
    }])),
    stub(QuizAttempt, 'find', () => queryResult([])),
    stub(AssignmentSubmission, 'find', () => queryResult([])),
    stub(Certificate, 'find', (filter) => {
      assert.deepEqual(filter, {
        $or: [
          { studentId, studentType: 'independent', collegeId: { $exists: false } },
          { userId: studentId },
        ],
      })
      return queryResult([legacyCertificate])
    }),
  ]
  try {
    const response = await request(`/admin/reports/progress/independent/${studentId}`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(result.certificates, [{
      id: String(legacyCertificate._id),
      certificateId,
      name: 'Previously Completed Course Certificate of Completion',
      courseId: String(courseId),
      courseName: 'Previously Completed Course',
      issuedAt: completedAt.toISOString(),
      viewUrl: `/certificates/${certificateId}/view`,
      downloadUrl: `/certificates/${certificateId}/download`,
    }])
    assert.equal(result.courseProgress[0].assignmentSummary, null)
    assert.equal(enrollmentFindCount, 2)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('student certificate endpoint automatically issues a locked certificate when all required activities are complete', async () => {
  const studentId = '68a000000000000000000091'
  const courseId = '68a000000000000000000092'
  const enrollmentId = '68a000000000000000000093'
  const videoId = '68a000000000000000000094'
  const quizId = '68a000000000000000000095'
  const certificateId = '68a000000000000000000096'
  const course = {
    _id: courseId,
    title: 'Exact course title',
    thumbnailUrl: 'https://cdn.example.invalid/course.png',
    modules: [{
      contentItems: [
        { _id: videoId, type: 'video-lesson', title: 'Required video' },
        { _id: new mongoose.Types.ObjectId(), type: 'quiz', title: 'Required quiz', quiz: { _id: quizId, questions: [{ prompt: 'Question' }] } },
      ],
    }],
    assignments: [],
    quizzes: [],
  }
  const enrollment = {
    _id: enrollmentId,
    userId: studentId,
    courseId: course,
    completedLessonIds: [videoId],
  }
  let insertedCertificate
  const restores = [
    stub(Student, 'findById', (id) => queryResult({
      _id: id,
      fullName: 'Ada Lovelace',
      username: 'ada',
      email: 'ada@example.invalid',
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Enrollment, 'find', () => ({
      populate() { return this },
      sort() { return this },
      lean: async () => [enrollment],
    })),
    stub(Certificate, 'findOne', () => queryResult(null)),
    stub(Certificate, 'findOneAndUpdate', (_query, update) => {
      insertedCertificate = update.$setOnInsert
      return queryResult({ _id: certificateId, ...insertedCertificate })
    }),
    stub(CertificateTemplate, 'findById', () => queryResult({ activeTemplateId: 'template-current' })),
    stub(QuizAttempt, 'find', () => queryResult([{ quizId }])),
  ]

  try {
    const response = await request('/certificates', { role: 'student', subject: studentId })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.certificates[0].eligible, true)
    assert.equal(result.certificates[0].courseName, 'Exact course title')
    assert.deepEqual(result.certificates[0].progress, { completedActivities: 2, totalActivities: 2, percentage: 100 })
    assert.equal(result.certificates[0].thumbnailUrl, 'https://cdn.example.invalid/course.png')
    assert.equal(result.certificates[0].certificate.studentName, 'Ada Lovelace')
    assert.equal(result.certificates[0].certificate.courseName, 'Exact course title')
    assert.equal(insertedCertificate.userId, studentId)
    assert.equal(insertedCertificate.courseId, courseId)
    assert.equal(insertedCertificate.templateId, 'template-current')
    assert.doesNotMatch(JSON.stringify(result), /correctOptionIndex|correctOptionIndices/)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('Main Admin enrollment list includes active students and their actual enrollment records', async () => {
  const adminId = '68a000000000000000000010'
  const collegeId = '68a000000000000000000030'
  const createdAt = new Date('2026-10-12T08:30:00.000Z')
  const enrollment = {
    _id: '68a000000000000000000040',
    userId: {
      _id: '68a000000000000000000041',
      fullName: 'College Student',
      studentId: 'STU-41',
      email: 'student@example.invalid',
      studentType: 'college',
    },
    courseId: { _id: '68a000000000000000000042', title: 'AI Fundamentals' },
    collegeId: { _id: collegeId, name: 'Example College' },
    status: 'active',
    createdAt,
  }
  let enrollmentFilter
  const restores = [
    stub(Admin, 'findById', async () => ({
      _id: adminId, role: 'main_admin', status: 'active', isActive: true,
    })),
    stub(Enrollment, 'find', (filter) => {
      enrollmentFilter = filter
      return queryResult([enrollment])
    }),
  ]
  try {
    const response = await request('/admin/enrollments', {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(enrollmentFilter, { status: { $ne: 'cancelled' } })
    const result = await response.json()
    assert.equal(result.enrollments.length, 1)
    assert.equal(result.enrollments[0].userId.studentId, 'STU-41')
    assert.equal(result.enrollments[0].userId.email, 'student@example.invalid')
    assert.equal(result.enrollments[0].courseId.title, 'AI Fundamentals')
    assert.equal(result.enrollments[0].collegeId.name, 'Example College')
    assert.equal(result.enrollments[0].createdAt, createdAt.toISOString())
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('certificate PDF access is limited to the owning student', async () => {
  const ownerId = '68a000000000000000000101'
  const otherStudentId = '68a000000000000000000102'
  const certificateId = '68a000000000000000000103'
  const certificate = {
    _id: certificateId,
    userId: ownerId,
    templateId: 'template-archived',
    certificateId: 'AIH-2025-ABCDEF012345',
    studentName: 'Ada Lovelace',
    courseName: 'Exact Course Name',
    completedAt: new Date('2025-03-15T00:00:00.000Z'),
  }
  const templateLookups = []
  const templateImageFixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
  let templateImageData = templateImageFixture
  let templateSecureUrl = ''
  const originalFetch = globalThis.fetch
  const restores = [
    stub(Student, 'findById', (id) => queryResult({
      _id: id,
      fullName: 'Student',
      username: 'student',
      email: 'student@example.invalid',
      role: 'student',
      studentType: 'independent',
      approvalStatus: 'approved',
      status: 'active',
      isActive: true,
    })),
    stub(Certificate, 'findOne', (query) => queryResult(String(query.userId) === ownerId ? certificate : null)),
    stub(CertificateTemplate, 'findById', (id) => {
      templateLookups.push(String(id))
      return queryResult({
        imageData: templateImageData,
        secureUrl: templateSecureUrl,
      })
    }),
    stub(globalThis, 'fetch', async (url, options) => {
      if (String(url).startsWith(baseUrl)) return originalFetch(url, options)
      assert.equal(String(url), templateSecureUrl)
      return new Response(templateImageFixture, { status: 200, headers: { 'content-type': 'image/png' } })
    }),
  ]

  try {
    const ownerResponse = await request(`/certificates/${certificateId}/pdf`, { role: 'student', subject: ownerId })
    assert.equal(ownerResponse.status, 200)
    assert.equal(ownerResponse.headers.get('content-type'), 'application/pdf')
    assert.equal(Buffer.from(await ownerResponse.arrayBuffer()).subarray(0, 5).toString('ascii'), '%PDF-')
    assert.deepEqual(templateLookups, ['default', 'template-archived'])

    templateImageData = new mongoose.mongo.BSON.Binary(templateImageFixture)
    const bsonBinaryTemplateResponse = await request(`/certificates/${certificateId}/pdf`, {
      role: 'student',
      subject: ownerId,
    })
    assert.equal(bsonBinaryTemplateResponse.status, 200)
    assert.equal(Buffer.from(await bsonBinaryTemplateResponse.arrayBuffer()).subarray(0, 5).toString('ascii'), '%PDF-')

    templateImageData = null
    templateSecureUrl = 'https://res.cloudinary.com/test-cloud/image/upload/certificate.png'
    const cloudinaryTemplateResponse = await request(`/certificates/${certificateId}/pdf?download=true`, {
      role: 'student',
      subject: ownerId,
    })
    assert.equal(cloudinaryTemplateResponse.status, 200)
    assert.equal(cloudinaryTemplateResponse.headers.get('content-type'), 'application/pdf')
    assert.match(cloudinaryTemplateResponse.headers.get('content-disposition'), /attachment/)
    assert.equal(Buffer.from(await cloudinaryTemplateResponse.arrayBuffer()).subarray(0, 5).toString('ascii'), '%PDF-')

    const otherResponse = await request(`/certificates/${certificateId}/pdf`, { role: 'student', subject: otherStudentId })
    assert.equal(otherResponse.status, 404)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('approving a required assignment submission can issue the student certificate', async () => {
  const adminId = '68a000000000000000000111'
  const studentId = '68a000000000000000000112'
  const courseId = '68a000000000000000000113'
  const enrollmentId = '68a000000000000000000114'
  const submissionId = '68a000000000000000000115'
  const assignmentId = '68a000000000000000000116'
  const certificateId = '68a000000000000000000117'
  const course = {
    _id: courseId,
    title: 'Assignment course',
    modules: [{
      contentItems: [{ _id: assignmentId, type: 'assignment', title: 'Final assignment' }],
    }],
    assignments: [],
    quizzes: [],
  }
  let certificateDocument
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: adminId,
      username: 'admin',
      email: 'admin@example.invalid',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(Student, 'findById', () => queryResult({
      _id: studentId,
      fullName: 'Ada Lovelace',
      role: 'student',
      status: 'active',
      isActive: true,
    })),
    stub(AssignmentSubmission, 'findByIdAndUpdate', async (_id, update) => ({
      _id: submissionId,
      userId: studentId,
      enrollmentId,
      courseId,
      assignmentId,
      ...update.$set,
    })),
    stub(AssignmentSubmission, 'find', () => {
      const result = Promise.resolve([{ assignmentId, reviewStatus: 'approved', submittedAt: new Date() }])
      result.select = () => result
      result.sort = () => result
      result.lean = () => result
      return result
    }),
    stub(Enrollment, 'findById', () => ({
      populate() { return this },
      lean: async () => ({ _id: enrollmentId, userId: studentId, courseId: course, status: 'active' }),
    })),
    stub(Certificate, 'findOne', () => queryResult(null)),
    stub(Certificate, 'findOneAndUpdate', (_query, update) => {
      certificateDocument = update.$setOnInsert
      return queryResult({ _id: certificateId, ...certificateDocument })
    }),
    stub(CertificateTemplate, 'findById', () => queryResult({ activeTemplateId: 'template-current' })),
  ]

  try {
    const response = await request(`/admin/assignment-submissions/${submissionId}/review`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { reviewStatus: 'approved' },
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).reviewStatus, 'approved')
    assert.equal(certificateDocument.studentName, 'Ada Lovelace')
    assert.equal(certificateDocument.courseName, 'Assignment course')
    assert.equal(certificateDocument.templateId, 'template-current')
    assert.deepEqual(certificateDocument.requirementSnapshot, ['assignment:Final assignment'])
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('assignment approval does not evaluate certificate eligibility for a different enrollment course', async () => {
  const adminId = '68a000000000000000000121'
  const studentId = '68a000000000000000000122'
  const courseId = '68a000000000000000000123'
  const otherCourseId = '68a000000000000000000124'
  const enrollmentId = '68a000000000000000000125'
  const submissionId = '68a000000000000000000126'
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: adminId,
      username: 'admin',
      email: 'admin@example.invalid',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(AssignmentSubmission, 'findByIdAndUpdate', async (_id, update) => ({
      _id: submissionId,
      userId: studentId,
      enrollmentId,
      courseId,
      assignmentId: '68a000000000000000000127',
      ...update.$set,
    })),
    stub(Enrollment, 'findById', () => ({
      populate() { return this },
      lean: async () => ({
        _id: enrollmentId,
        userId: studentId,
        courseId: { _id: otherCourseId, title: 'Different course' },
        status: 'active',
      }),
    })),
    stub(Student, 'findById', () => {
      throw new Error('Certificate eligibility must not be checked for a different course')
    }),
  ]

  try {
    const response = await request(`/admin/assignment-submissions/${submissionId}/review`, {
      role: 'main_admin',
      subject: adminId,
      method: 'PATCH',
      body: { reviewStatus: 'approved' },
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).reviewStatus, 'approved')
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('replacing the active certificate template preserves existing certificate template references', async () => {
  const adminId = '68a000000000000000000131'
  const legacyImage = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const defaultTemplate = {
    _id: 'default',
    imageData: legacyImage,
    contentType: 'image/png',
    fileName: 'previous-template.png',
    fileSize: legacyImage.length,
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  }
  const versions = new Map()
  const backfills = []
  const cloudinaryUploads = []
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: adminId,
      username: 'admin',
      email: 'admin@example.invalid',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(CertificateTemplate, 'findById', (id) => queryResult(
      String(id) === 'default' ? defaultTemplate : versions.get(String(id)) || null,
    )),
    stub(CertificateTemplate, 'create', async (document) => {
      versions.set(document._id, document)
      return document
    }),
    stub(CertificateTemplate, 'findByIdAndUpdate', (id, update) => {
      const template = String(id) === 'default' ? defaultTemplate : versions.get(String(id))
      if (!template) return null
      Object.assign(template, update.$set)
      return queryResult(template)
    }),
    stub(cloudinary.uploader, 'upload_stream', (options, callback) => {
      const chunks = []
      const stream = new Writable({
        write(chunk, _encoding, done) {
          chunks.push(Buffer.from(chunk))
          done()
        },
      })
      stream.on('finish', () => {
        const publicId = options.public_id
        cloudinaryUploads.push({ options, data: Buffer.concat(chunks) })
        callback(null, {
          secure_url: `https://res.cloudinary.com/test-cloud/image/upload/${publicId}.png`,
          public_id: publicId,
        })
      })
      return stream
    }),
    stub(CertificateTemplate, 'findOneAndUpdate', async (_query, update) => {
      Object.assign(defaultTemplate, update.$set, { updatedAt: new Date() })
      return defaultTemplate
    }),
    stub(Certificate, 'updateMany', async (filter, update) => {
      backfills.push({ filter, templateId: update.$set.templateId })
      return { acknowledged: true, modifiedCount: 1 }
    }),
  ]

  try {
    const migratedTemplateResponse = await request('/admin/certificate-template', {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(migratedTemplateResponse.status, 200)
    const migratedTemplate = await migratedTemplateResponse.json()
    assert.match(migratedTemplate.secureUrl, /^https:\/\/res\.cloudinary\.com\/test-cloud\/image\//)
    assert.equal(defaultTemplate.publicId, `legacy-${createHash('sha256')
      .update('default')
      .update(legacyImage)
      .digest('hex')}`)
    assert.deepEqual(defaultTemplate.imageData, legacyImage)

    const uploadCountAfterMigration = cloudinaryUploads.length
    const refreshedTemplateResponse = await request('/admin/certificate-template', {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(refreshedTemplateResponse.status, 200)
    assert.equal((await refreshedTemplateResponse.json()).secureUrl, migratedTemplate.secureUrl)
    assert.equal(cloudinaryUploads.length, uploadCountAfterMigration)

    const firstUpload = await uploadCertificateTemplate({
      subject: adminId,
      fileName: 'replacement-one.png',
      contents: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
    })
    assert.equal(firstUpload.status, 200)
    const firstResult = await firstUpload.json()
    const firstTemplateId = defaultTemplate.activeTemplateId
    assert.ok(firstTemplateId.startsWith('template-'))
    assert.equal(firstResult.fileName, 'replacement-one.png')
    assert.match(firstResult.secureUrl, /^https:\/\/res\.cloudinary\.com\/test-cloud\/image\//)
    assert.equal(versions.get(firstTemplateId).secureUrl, firstResult.secureUrl)
    assert.equal(versions.get(firstTemplateId).publicId, firstTemplateId)
    assert.deepEqual(cloudinaryUploads[1].data, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]))
    assert.equal(backfills[0].templateId, 'default')
    assert.deepEqual(defaultTemplate.imageData, legacyImage)

    const secondUpload = await uploadCertificateTemplate({
      subject: adminId,
      fileName: 'replacement-two.png',
      contents: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2]),
    })
    assert.equal(secondUpload.status, 200)
    const secondTemplateId = defaultTemplate.activeTemplateId
    assert.ok(secondTemplateId.startsWith('template-'))
    assert.notEqual(secondTemplateId, firstTemplateId)
    assert.equal(backfills[1].templateId, firstTemplateId)
    assert.equal(versions.get(firstTemplateId).fileName, 'replacement-one.png')
    assert.equal(versions.get(secondTemplateId).fileName, 'replacement-two.png')

    const activeTemplateResponse = await request('/admin/certificate-template', {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(activeTemplateResponse.status, 200)
    const activeTemplate = await activeTemplateResponse.json()
    assert.equal(activeTemplate.fileName, 'replacement-two.png')
    assert.equal(activeTemplate.secureUrl, versions.get(secondTemplateId).secureUrl)

    const previewResponse = await request('/admin/certificate-template/image', {
      role: 'main_admin',
      subject: adminId,
    })
    assert.equal(previewResponse.status, 200)
    assert.equal(previewResponse.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await previewResponse.arrayBuffer()), versions.get(secondTemplateId).imageData)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('all-student report pagination covers records beyond one page from both student collections', async () => {
  const collegeId = new mongoose.Types.ObjectId('68a000000000000000000303')
  const independentStudents = Array.from({ length: 201 }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    fullName: `Independent ${index}`,
    email: `independent-${index}@example.invalid`,
    role: 'student',
  }))
  const collegeStudents = Array.from({ length: 201 }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    fullName: `College ${index}`,
    email: `college-${index}@example.invalid`,
    role: 'student',
    collegeId,
  }))
  const pagedResult = (documents) => {
    let skip = 0
    let limit = documents.length
    const query = {
      select: () => query,
      sort: () => query,
      skip: (value) => { skip = value; return query },
      limit: (value) => { limit = value; return query },
      lean: () => Promise.resolve(documents.slice(skip, skip + limit)),
    }
    return query
  }
  const restoreAdmin = stub(Admin, 'findById', async () => ({
    _id: '68a000000000000000000010',
    role: 'main_admin',
    status: 'active',
    isActive: true,
  }))
  const restoreIndependent = stub(Student, 'find', () => pagedResult(independentStudents))
  const restoreCollegeStudent = stub(CollegeStudent, 'find', () => pagedResult(collegeStudents))
  const restoreCollege = stub(College, 'find', () => queryResult([]))
  const restoreEnrollment = stub(Enrollment, 'find', () => queryResult([]))
  try {
    const firstResponse = await request('/admin/reports?type=all&page=0', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    const secondResponse = await request('/admin/reports?type=all&page=1', {
      role: 'main_admin',
      subject: '68a000000000000000000010',
    })
    assert.equal(firstResponse.status, 200)
    assert.equal(secondResponse.status, 200)
    const firstPage = await firstResponse.json()
    const secondPage = await secondResponse.json()
    assert.equal(firstPage.rows.length, 400)
    assert.equal(firstPage.hasMore, true)
    assert.equal(secondPage.rows.length, 2)
    assert.equal(secondPage.hasMore, false)
  } finally {
    restoreEnrollment()
    restoreCollege()
    restoreCollegeStudent()
    restoreIndependent()
    restoreAdmin()
  }
})
