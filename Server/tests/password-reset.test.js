import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import nodemailer from 'nodemailer'
import authRouter from '../routes/auth.js'
import { Admin, CollegeAdmin, Student, CollegeStudent } from '../models/account-models.js'
import AccountIdentity from '../models/AccountIdentity.js'
import PasswordResetToken from '../models/PasswordResetToken.js'
import RefreshSession from '../models/RefreshSession.js'

function stub(target, method, implementation) {
  const original = target[method]
  target[method] = implementation
  return () => {
    target[method] = original
  }
}

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(data) {
      this.body = data
      return this
    },
    set(key, value) {
      this.headers[key] = value
      return this
    },
  }
  return res
}

function getRouteHandler(router, path, method) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()],
  )
  if (!layer) throw new Error(`Route handler not found for ${method.toUpperCase()} ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

const forgotPasswordHandler = getRouteHandler(authRouter, '/forgot-password', 'post')
const validateResetTokenHandler = getRouteHandler(authRouter, '/reset-password/validate', 'get')
const resetPasswordHandler = getRouteHandler(authRouter, '/reset-password', 'post')

test('forgot-password returns 400 when email is invalid or missing', async () => {
  const req1 = { body: {} }
  const res1 = mockResponse()
  await forgotPasswordHandler(req1, res1, () => {})
  assert.equal(res1.statusCode, 400)
  assert.equal(res1.body.message, 'Enter your registered email address.')

  const req2 = { body: { email: 'not-an-email' } }
  const res2 = mockResponse()
  await forgotPasswordHandler(req2, res2, () => {})
  assert.equal(res2.statusCode, 400)
  assert.equal(res2.body.message, 'Enter a valid email address.')
})

test('forgot-password rate limits after 5 requests from the same IP or email', async () => {
  const testIp = '198.51.100.42'
  const testEmail = `ratelimit-${Date.now()}@test.com`

  const restores = [
    stub(AccountIdentity, 'findOne', () => ({ lean: async () => null })),
    stub(Admin, 'findOne', () => ({ lean: async () => null })),
    stub(CollegeAdmin, 'findOne', () => ({ lean: async () => null })),
    stub(Student, 'findOne', () => ({ lean: async () => null })),
    stub(CollegeStudent, 'findOne', () => ({ lean: async () => null })),
  ]

  try {
    for (let i = 1; i <= 5; i++) {
      const req = { body: { email: testEmail }, ip: testIp }
      const res = mockResponse()
      await forgotPasswordHandler(req, res, () => {})
      assert.equal(res.statusCode, 200, `Request ${i} should succeed`)
    }

    // 6th request should be rate-limited
    const reqBlocked = { body: { email: testEmail }, ip: testIp }
    const resBlocked = mockResponse()
    await forgotPasswordHandler(reqBlocked, resBlocked, () => {})
    assert.equal(resBlocked.statusCode, 429)
    assert.match(resBlocked.body.message, /too many password reset requests/i)
    assert.ok(resBlocked.headers['Retry-After'], 'Retry-After header should be present')
  } finally {
    restores.forEach((r) => r())
  }
})

test('forgot-password returns generic success and does not reveal whether email exists', async () => {
  const nonExistentEmail = `nonexistent-${Date.now()}@test.com`

  const restores = [
    stub(AccountIdentity, 'findOne', () => ({ lean: async () => null })),
    stub(Admin, 'findOne', () => ({ lean: async () => null })),
    stub(CollegeAdmin, 'findOne', () => ({ lean: async () => null })),
    stub(Student, 'findOne', () => ({ lean: async () => null })),
    stub(CollegeStudent, 'findOne', () => ({ lean: async () => null })),
  ]

  try {
    const req = {
      body: { email: nonExistentEmail },
      ip: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    }
    const res = mockResponse()
    await forgotPasswordHandler(req, res, () => {})

    assert.equal(res.statusCode, 200)
    assert.match(res.body.message, /If an account with that email address exists/i)
  } finally {
    restores.forEach((r) => r())
  }
})

test('forgot-password creates hashed token and sends reset email for registered account', async () => {
  const testEmail = `student-forgot-${Date.now()}@test.com`
  const mockUserId = new mongoose.Types.ObjectId()
  const mockUser = {
    _id: mockUserId,
    email: testEmail,
    fullName: 'Jane Test Student',
    isActive: true,
  }

  let capturedSentMail = null
  const origCreateTransport = nodemailer.createTransport
  nodemailer.createTransport = () => ({
    sendMail: async (mailOptions) => {
      capturedSentMail = mailOptions
      return { messageId: 'test-reset-email-123' }
    },
  })

  let createdTokenData = null
  const restores = [
    stub(AccountIdentity, 'findOne', () => ({
      lean: async () => ({
        accountId: mockUserId,
        accountCollection: 'students',
        email: testEmail,
      }),
    })),
    stub(Student, 'findById', () => ({
      lean: async () => mockUser,
    })),
    stub(PasswordResetToken, 'create', async (data) => {
      createdTokenData = data
      return data
    }),
    stub(PasswordResetToken, 'updateMany', async () => ({ modifiedCount: 0 })),
  ]

  try {
    const req = {
      body: { email: testEmail },
      ip: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    }
    const res = mockResponse()
    await forgotPasswordHandler(req, res, () => {})

    assert.equal(res.statusCode, 200)
    assert.match(res.body.message, /If an account with that email address exists/i)

    assert.ok(createdTokenData, 'PasswordResetToken.create should be called')
    assert.equal(createdTokenData.email, testEmail)
    assert.equal(createdTokenData.accountId, mockUserId)
    assert.equal(createdTokenData.accountCollection, 'students')
    assert.ok(createdTokenData.tokenHash, 'Token hash should be saved')
    assert.ok(createdTokenData.expiresAt > new Date(), 'Expiry should be in the future')

    assert.ok(capturedSentMail, 'Nodemailer sendMail should be called')
    assert.equal(capturedSentMail.to, testEmail)
    assert.equal(capturedSentMail.subject, 'Reset your aiHustle LMS password')
    assert.match(capturedSentMail.text, /reset-password\?token=/i)

    const rawTokenMatch = capturedSentMail.text.match(/reset-password\?token=([a-f0-9]+)/i)
    assert.ok(rawTokenMatch, 'Raw token should be in reset email')
    const rawToken = rawTokenMatch[1]
    const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    assert.equal(createdTokenData.tokenHash, expectedHash, 'DB should store SHA-256 hash of the raw token')
  } finally {
    nodemailer.createTransport = origCreateTransport
    restores.forEach((r) => r())
  }
})

test('reset-password/validate validates valid, expired, and used tokens correctly', async () => {
  const rawToken = 'test-token-1234567890abcdef1234567890abcdef'
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const mockUserId = new mongoose.Types.ObjectId()

  // 1. Missing token
  const resMissing = mockResponse()
  await validateResetTokenHandler({ query: {} }, resMissing, () => {})
  assert.equal(resMissing.statusCode, 400)
  assert.equal(resMissing.body.valid, false)

  // 2. Token not found
  let restoreFindToken = stub(PasswordResetToken, 'findOne', () => ({
    lean: async () => null,
  }))
  const resNotFound = mockResponse()
  await validateResetTokenHandler({ query: { token: rawToken } }, resNotFound, () => {})
  assert.equal(resNotFound.statusCode, 400)
  assert.equal(resNotFound.body.valid, false)
  restoreFindToken()

  // 3. Token expired
  restoreFindToken = stub(PasswordResetToken, 'findOne', () => ({
    lean: async () => ({
      tokenHash,
      accountId: mockUserId,
      accountCollection: 'students',
      expiresAt: new Date(Date.now() - 60000), // 1 min ago
      usedAt: null,
    }),
  }))
  const resExpired = mockResponse()
  await validateResetTokenHandler({ query: { token: rawToken } }, resExpired, () => {})
  assert.equal(resExpired.statusCode, 400)
  assert.equal(resExpired.body.valid, false)
  assert.match(resExpired.body.message, /expired/i)
  restoreFindToken()

  // 4. Token already used
  restoreFindToken = stub(PasswordResetToken, 'findOne', () => ({
    lean: async () => ({
      tokenHash,
      accountId: mockUserId,
      accountCollection: 'students',
      expiresAt: new Date(Date.now() + 600000),
      usedAt: new Date(Date.now() - 30000),
    }),
  }))
  const resUsed = mockResponse()
  await validateResetTokenHandler({ query: { token: rawToken } }, resUsed, () => {})
  assert.equal(resUsed.statusCode, 400)
  assert.equal(resUsed.body.valid, false)
  assert.match(resUsed.body.message, /already been used/i)
  restoreFindToken()

  // 5. Valid token
  restoreFindToken = stub(PasswordResetToken, 'findOne', () => ({
    lean: async () => ({
      tokenHash,
      accountId: mockUserId,
      accountCollection: 'students',
      expiresAt: new Date(Date.now() + 600000),
      usedAt: null,
    }),
  }))
  const restoreExists = stub(Student, 'exists', async () => ({ _id: mockUserId }))
  const resValid = mockResponse()
  await validateResetTokenHandler({ query: { token: rawToken } }, resValid, () => {})
  assert.equal(resValid.statusCode, 200)
  assert.equal(resValid.body.valid, true)
  restoreFindToken()
  restoreExists()
})

test('reset-password validates input, hashes password with bcrypt, and marks token used', async () => {
  const rawToken = 'test-token-valid-reset-abcdef'
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const mockUserId = new mongoose.Types.ObjectId()

  // 1. Password length < 8
  const resShort = mockResponse()
  await resetPasswordHandler(
    { body: { token: rawToken, password: 'short', confirmPassword: 'short' } },
    resShort,
    () => {},
  )
  assert.equal(resShort.statusCode, 400)
  assert.match(resShort.body.message, /at least 8 characters/i)

  // 2. Passwords mismatch
  const resMismatch = mockResponse()
  await resetPasswordHandler(
    { body: { token: rawToken, password: 'newPassword123', confirmPassword: 'otherPassword123' } },
    resMismatch,
    () => {},
  )
  assert.equal(resMismatch.statusCode, 400)
  assert.match(resMismatch.body.message, /passwords do not match/i)

  // 3. Successful reset
  const tokenDoc = {
    tokenHash,
    accountId: mockUserId,
    accountCollection: 'students',
    expiresAt: new Date(Date.now() + 600000),
    usedAt: null,
    async save() {
      return this
    },
  }

  const userDoc = {
    _id: mockUserId,
    email: 'jane@test.com',
    passwordHash: 'oldHash',
    async save() {
      return this
    },
  }

  let deletedSessionsUserId = null
  const restores = [
    stub(PasswordResetToken, 'findOne', async () => tokenDoc),
    stub(PasswordResetToken, 'updateMany', async () => ({ modifiedCount: 1 })),
    stub(Student, 'findById', async () => userDoc),
    stub(RefreshSession, 'deleteMany', async (query) => {
      deletedSessionsUserId = query.userId
      return { deletedCount: 2 }
    }),
  ]

  try {
    const resSuccess = mockResponse()
    await resetPasswordHandler(
      { body: { token: rawToken, password: 'newSecretPassword123!', confirmPassword: 'newSecretPassword123!' } },
      resSuccess,
      () => {},
    )

    assert.equal(resSuccess.statusCode, 200)
    assert.match(resSuccess.body.message, /successfully reset/i)
    assert.ok(tokenDoc.usedAt instanceof Date, 'Token should be marked as used')
    assert.notEqual(userDoc.passwordHash, 'oldHash', 'Password hash should be updated')
    assert.ok(
      await bcrypt.compare('newSecretPassword123!', userDoc.passwordHash),
      'Bcrypt compare with new password should succeed',
    )
    assert.equal(deletedSessionsUserId, mockUserId, 'Refresh sessions should be revoked for user')

    // 4. Token reuse attempt should be rejected
    const resReuse = mockResponse()
    await resetPasswordHandler(
      { body: { token: rawToken, password: 'anotherPassword123!', confirmPassword: 'anotherPassword123!' } },
      resReuse,
      () => {},
    )
    assert.equal(resReuse.statusCode, 400)
    assert.match(resReuse.body.message, /already been used/i)
  } finally {
    restores.forEach((r) => r())
  }
})
