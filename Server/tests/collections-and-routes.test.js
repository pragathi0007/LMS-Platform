import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { createHash, createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { OAuth2Client } from 'google-auth-library'
import { generateQuizQuestions } from '../utils/quiz-question-generator.js'

process.env.JWT_SECRET = 'test-only-route-secret'
process.env.OPENAI_API_KEY = 'test-only-openai-key'
process.env.RESEND_API_KEY = 'test-only-resend-key'
process.env.EMAIL_FROM = 'Morrow Learning <security@example.invalid>'
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
process.env.CLOUDINARY_API_KEY = 'test-cloudinary-key'
process.env.CLOUDINARY_API_SECRET = 'test-only-cloudinary-secret'
process.env.COURSE_VIDEO_MAX_BYTES = '128'
process.env.COURSE_RESOURCE_MAX_BYTES = '128'
process.env.GOOGLE_CLIENT_ID = 'test-google-client.apps.googleusercontent.com'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.SMTP_HOST = ''
process.env.SMTP_PORT = '587'
process.env.SMTP_SECURE = 'false'
process.env.SMTP_USER = 'test-user'
process.env.SMTP_PASSWORD = 'test-password'
process.env.SMTP_FROM = 'test@example.invalid'
process.env.CLIENT_ORIGIN = 'http://localhost:5173'

const [
  { default: adminRouter },
  { default: learningRouter },
  { default: authRouter },
  { default: settingsRouter },
  { AccountIdentity },
  { accountModelsByRole, CollegeAdmin, Admin, CollegeStudent, Student, matchesStoredAccountRole },
  { default: College },
  { default: Course },
  { default: Enrollment },
  { default: EmailOtpChallenge },
] = await Promise.all([
  import('../routes/admin.js'),
  import('../routes/learning.js'),
  import('../routes/auth.js'),
  import('../routes/settings.js'),
  import('../models/AccountIdentity.js').then((module) => ({ AccountIdentity: module.default })),
  import('../models/account-models.js'),
  import('../models/College.js'),
  import('../models/Course.js'),
  import('../models/Enrollment.js'),
  import('../models/EmailOtpChallenge.js'),
])

const app = express()
app.set('trust proxy', true)
app.use(express.json())
app.use('/api/admin', adminRouter)
app.use('/api/auth', authRouter)
app.use('/api/settings', settingsRouter)
app.use('/api', learningRouter)
const server = app.listen(0)
await new Promise((resolve) => server.once('listening', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}/api`
const { default: cloudinary } = await import('../config/cloudinary.js')

test('stored account roles match canonical collections', () => {
  assert.equal(matchesStoredAccountRole('admin', 'main_admin'), true)
  assert.equal(matchesStoredAccountRole('admin', 'admin'), false)
  assert.equal(matchesStoredAccountRole('admin', 'student'), false)
  assert.equal(matchesStoredAccountRole('students', 'student'), true)
  assert.equal(matchesStoredAccountRole('students', 'user'), false)
  assert.equal(matchesStoredAccountRole('clg_students', 'student'), true)
})

after(async () => {
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

async function request(path, { role, subject, accountCollection, body, method, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      ...(role ? { Authorization: `Bearer ${tokenFor(role, subject, accountCollection)}` } : {}),
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

test('models target the requested collections', () => {
  assert.equal(Admin.collection.name, 'admin')
  assert.equal(College.collection.name, 'colleges')
  assert.equal(CollegeAdmin.collection.name, 'sub_admins')
  assert.equal(Student.collection.name, 'students')
  assert.equal(CollegeStudent.collection.name, 'clg_students')
  assert.equal(Course.collection.name, 'courses')
  assert.equal(Course.schema.path('category').instance, 'String')
  assert.equal(Course.schema.path('assignments').schema.path('category'), undefined)
  assert.equal(Course.schema.path('modules').schema.path('lessons').schema.options.timestamps, true)
  assert.equal(Enrollment.collection.name, 'enrollment')
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
  assert.ok(College.schema.indexes().some(([keys, options]) => keys.code === 1 && options.unique))
  assert.equal(Course.schema.path('assignments').instance, 'Array')
  assert.equal(Course.schema.path('quizzes').instance, 'Array')
  assert.equal(Course.schema.path('quizzes').schema.paths.questions.schema.path('correctOptionIndex').options.select, false)
  assert.equal(Course.schema.path('modules').schema.path('quiz').schema.path('questions').schema.path('correctOptionIndices').options.select, false)
  assert.notEqual(String(new College({ name: 'First' })._id), String(new College({ name: 'Second' })._id))
})

test('student username availability excludes the authenticated student and checks every account collection', async () => {
  const studentId = new mongoose.Types.ObjectId()
  const student = {
    _id: studentId,
    role: 'student',
    studentType: 'independent',
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
    assert.match((await response.json()).message, /Email verification is not configured/)
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

test('independent registration writes to students and maps the identity', async () => {
  let savedStudent
  let savedIdentity
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
    stub(mongoose, 'startSession', async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    })),
  ]
  try {
    const response = await request('/auth/register', {
      body: {
        fullName: 'Independent Student',
        email: 'independent@example.invalid',
        username: 'independent-student',
        password: 'a-strong-password',
        confirmPassword: 'a-strong-password',
        role: 'student',
        accountType: 'independent',
      },
    })
    assert.equal(response.status, 201)
    assert.equal(savedStudent.role, 'student')
    assert.equal(savedStudent.studentType, 'independent')
    assert.equal(savedStudent.collegeId, undefined)
    assert.equal(savedIdentity.accountCollection, 'students')
    assert.equal(String(savedIdentity.accountId), String(savedStudent._id))
    assert.equal(Student.collection.name, 'students')
    assert.equal(AccountIdentity.collection.name, 'accountidentities')
  } finally {
    for (const restore of restores.reverse()) restore()
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
      status: 'active',
      isActive: true,
      passwordHash,
    })
    result.select = () => result
    return result
  })
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
            content: 'Content',
            videoUrl: 'https://res.cloudinary.com/test/video/upload/lesson.mp4',
            videoPublicId: 'aihustle/courses/course/modules/module/lesson',
            videoFormat: 'mp4',
            videoBytes: 1200,
            durationSeconds: 94,
            resources: [{ title: 'Notes', url: 'https://res.cloudinary.com/test/raw/upload/notes.pdf', publicId: 'aihustle/courses/course/modules/module/notes.pdf', resourceType: 'raw', format: 'pdf', bytes: 420 }],
          }],
          quiz: {
            title: 'Module quiz',
            questions: [{ prompt: 'Choose both', type: 'multiple-select', options: ['A', 'B'], correctOptionIndices: [0, 1], marks: 2 }],
          },
          contentItems: [
            { type: 'video-lesson', title: 'Ordered video', videoUrl: 'https://example.com/video.mp4', content: 'Lesson text' },
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
    assert.equal(savedDocument.createdBy, '68a000000000000000000010')
    assert.equal(savedDocument.modules[0].lessons[0].title, 'Lesson')
    assert.equal(savedDocument.modules[0].lessons[0].videoPublicId, 'aihustle/courses/course/modules/module/lesson')
    assert.equal(savedDocument.modules[0].lessons[0].videoBytes, 1200)
    assert.equal(savedDocument.modules[0].lessons[0].durationSeconds, 94)
    assert.equal(savedDocument.modules[0].lessons[0].resources[0].bytes, 420)
    assert.deepEqual(savedDocument.modules[0].quiz.questions[0].correctOptionIndices, [0, 1])
    assert.equal(savedDocument.modules[0].quiz.questions[0].marks, 2)
    assert.deepEqual(savedDocument.modules[0].contentItems.map((item) => item.type), ['video-lesson', 'quiz', 'assignment', 'note'])
    assert.deepEqual(savedDocument.modules[0].contentItems[1].quiz.questions[0].correctOptionIndices, [0])
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

test('admin course listing uses a non-conflicting projection for quiz fields', async () => {
  let projection
  const query = {
    select(value) {
      projection = value
      return this
    },
    sort() {
      return this
    },
    limit() {
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
    stub(Enrollment, 'countDocuments', async () => 12),
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
    assert.ok(projection.includes('modules.lessons'))
    assert.ok(projection.includes('+modules.quiz.questions.correctOptionIndices'))
    assert.equal(projection.split(/\s+/).includes('modules'), false)
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
  let submittedRequest
  const client = {
    chat: {
      completions: {
        create: async (requestBody) => {
          submittedRequest = requestBody
          return { choices: [{ message: { content: JSON.stringify({ questions: expectedQuestions }) } }] }
        },
      },
    },
  }
  const questions = await generateQuizQuestions({
    lessonContent: 'Lesson content for the quiz.',
    questionCount: 3,
    difficulty: 'intermediate',
    questionTypes: ['multiple-choice', 'multiple-select', 'true-false'],
  }, client)

  assert.equal(submittedRequest.model, 'gpt-4o-mini')
  assert.equal(submittedRequest.response_format.type, 'json_schema')
  assert.equal(questions.length, 3)
  assert.deepEqual(questions.map((question) => question.type), ['multiple-choice', 'multiple-select', 'true-false'])
  assert.deepEqual(questions[1].correctOptionIndices, [0, 2])
  assert.equal(questions[2].marks, 1)
  assert.deepEqual(questions.map((question) => question.order), [0, 1, 2])
})

test('quiz question generation rejects invalid structured model output', async () => {
  const client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                questions: [{ prompt: 'Select an answer.', type: 'multiple-select', options: ['A', 'B', 'C', 'D'], correctOptionIndices: [0] }],
              }),
            },
          }],
        }),
      },
    },
  }
  await assert.rejects(
    generateQuizQuestions({
      lessonContent: 'Lesson content.',
      questionCount: 1,
      difficulty: 'beginner',
      questionTypes: ['multiple-select'],
    }, client),
    /invalid format/i,
  )
})

test('admin quiz generation returns editable questions and surfaces sanitized provider errors', async () => {
  const { getOpenAIClient } = await import('../config/openai.js')
  const client = getOpenAIClient()
  assert.ok(client)
  let completionResult = {
    choices: [{
      message: {
        content: JSON.stringify({
          questions: [{
            prompt: 'Which fact is correct?',
            type: 'multiple-choice',
            options: ['A', 'B', 'C', 'D'],
            correctOptionIndices: [1],
          }],
        }),
      },
    }],
  }
  const restores = [
    stub(Admin, 'findById', () => queryResult({
      _id: '68a000000000000000000010',
      role: 'main_admin',
      status: 'active',
      isActive: true,
    })),
    stub(client.chat.completions, 'create', async () => {
      if (completionResult instanceof Error) throw completionResult
      return completionResult
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

    completionResult = new Error('Invalid API key sk-test-secret-value')
    completionResult.status = 401
    completionResult.code = 'invalid_api_key'
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
    assert.equal(failure.message.includes('sk-test-secret-value'), false)
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
  const query = {
    select() {
      return this
    },
    sort() {
      return this
    },
    limit() {
      return this
    },
    lean: async () => [{
      _id: '68a000000000000000000030',
      title: 'Published course',
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
        lessons: [{ title: 'Lesson' }],
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
    const result = await response.json()
    assert.equal(result.courses[0].title, 'Published course')
    assert.equal('correctOptionIndex' in result.courses[0].quizzes[0].questions[0], false)
    assert.equal('correctOptionIndices' in result.courses[0].modules[0].quiz.questions[0], false)
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
  ]
  try {
    const response = await request(`/admin/colleges/${collegeId}/sub-admins`, {
      role: 'main_admin',
      subject: '68a000000000000000000010',
      body: { fullName: 'Sub Admin', email: 'subadmin@example.invalid', username: 'sub-admin' },
    })
    assert.equal(response.status, 503)
    const result = await response.json()
    assert.equal(result.activationEmailSent, false)
    assert.equal(result.accountId, String(savedAccount._id))
    assert.equal(savedAccount.role, 'college_admin')
    assert.equal(savedAccount.status, 'invitation_pending')
    assert.equal(savedAccount.isActive, false)
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
  const restoreIndependentStudent = stub(Student, 'findById', async () => ({
    _id: '68a000000000000000000031',
    role: 'student',
    studentType: 'independent',
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
      populate() { return this },
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
  } finally {
    restoreIndependentStudent()
    restoreCollegeStudent()
    restoreEnrollments()
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
