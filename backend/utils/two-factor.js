import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { config } from '../config/env.js'
import EmailOtpChallenge from '../models/EmailOtpChallenge.js'
import { accountModelsByCollection } from '../models/account-models.js'
import { assertResendConfigured, sendStudentTwoFactorCodeEmail } from './email.js'

const otpLifetimeMs = 5 * 60 * 1000
const challengeLifetime = '15m'
const cleanupLifetimeMs = 60 * 60 * 1000
const resendCooldownMs = 60 * 1000
const maxOtpAttempts = 5
const requestRateLimit = { limit: 5, windowMs: 15 * 60 * 1000 }
const verifyRateLimit = { limit: 20, windowMs: 15 * 60 * 1000 }
const rateLimitBuckets = new Map()
const studentCollections = new Set(['students', 'clg_students'])

export class TwoFactorError extends Error {
  constructor(statusCode, message, retryAfterSeconds) {
    super(message)
    this.statusCode = statusCode
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function getOtpRateLimitDelay(req, action) {
  const now = Date.now()
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key)
  }

  const limit = action === 'verify' ? verifyRateLimit : requestRateLimit
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const key = `${action}:${ip}`
  let bucket = rateLimitBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + limit.windowMs }
    rateLimitBuckets.set(key, bucket)
  }
  if (bucket.count >= limit.limit) return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  bucket.count += 1
  return 0
}

export function maskEmail(email) {
  const [localPart, domain] = String(email || '').split('@')
  if (!localPart || !domain) return ''
  const visible = localPart.length > 1 ? localPart[0] : ''
  return `${visible}${'*'.repeat(Math.max(3, Math.min(8, localPart.length - visible.length)))}@${domain}`
}

function hashOtp(challengeId, code) {
  if (typeof config.jwtSecret !== 'string' || !config.jwtSecret.trim()) {
    throw new TwoFactorError(503, 'Authentication is not configured.')
  }
  return createHmac('sha256', config.jwtSecret)
    .update(`student-email-2fa:${challengeId}:${code}`)
    .digest('hex')
}

function otpMatches(challengeId, code, storedHash) {
  if (typeof storedHash !== 'string') return false
  const submitted = Buffer.from(hashOtp(challengeId, code), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  return submitted.length === expected.length && timingSafeEqual(submitted, expected)
}

function createChallengeToken(challenge) {
  if (!config.jwtSecret?.trim()) throw new TwoFactorError(503, 'Authentication is not configured.')
  return jwt.sign(
    {
      scope: 'student_email_otp',
      purpose: challenge.purpose,
      accountCollection: challenge.accountCollection,
    },
    config.jwtSecret,
    {
      subject: String(challenge.studentId),
      jwtid: String(challenge._id),
      expiresIn: challengeLifetime,
    },
  )
}

export function readChallengeToken(token, expectedPurpose, authenticatedUser) {
  if (typeof token !== 'string' || !token || !config.jwtSecret?.trim()) {
    throw new TwoFactorError(400, 'The verification session is invalid or expired. Start again.')
  }

  let payload
  try {
    payload = jwt.verify(token, config.jwtSecret)
  } catch {
    throw new TwoFactorError(410, 'The verification session expired. Start again.')
  }
  if (
    typeof payload === 'string' ||
    payload.scope !== 'student_email_otp' ||
    (expectedPurpose && payload.purpose !== expectedPurpose) ||
    !['login', 'settings_enable', 'settings_disable'].includes(payload.purpose) ||
    typeof payload.sub !== 'string' ||
    !mongoose.isValidObjectId(payload.sub) ||
    typeof payload.jti !== 'string' ||
    !mongoose.isValidObjectId(payload.jti) ||
    !studentCollections.has(payload.accountCollection) ||
    (authenticatedUser && (
      payload.sub !== authenticatedUser.id ||
      payload.accountCollection !== authenticatedUser.accountCollection
    ))
  ) {
    throw new TwoFactorError(400, 'The verification session is invalid or expired. Start again.')
  }
  return payload
}

async function deliverChallenge(challenge, user) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const now = new Date()
  challenge.hashedOtp = hashOtp(challenge._id, code)
  challenge.expiresAt = new Date(now.getTime() + otpLifetimeMs)
  challenge.cleanupAt = new Date(now.getTime() + cleanupLifetimeMs)
  challenge.lastSentAt = now
  challenge.attempts = 0
  challenge.verifiedAt = undefined
  await challenge.save()

  try {
    await sendStudentTwoFactorCodeEmail({
      email: user.email,
      fullName: user.fullName,
      code,
    })
  } catch (error) {
    await EmailOtpChallenge.updateOne(
      { _id: challenge._id, verifiedAt: null },
      { $set: { attempts: maxOtpAttempts } },
    )
    if (error?.code === 'RESEND_NOT_CONFIGURED') {
      throw new TwoFactorError(503, 'Email verification is not configured. Set RESEND_API_KEY and EMAIL_FROM in backend/.env.')
    }
    throw new TwoFactorError(503, 'The security code could not be sent. Please try again later.')
  }
}

export async function issueStudentOtpChallenge({ user, accountCollection, purpose }) {
  assertResendConfigured()
  if (!studentCollections.has(accountCollection) || !user?._id || !user.email) {
    throw new TwoFactorError(403, 'Email verification is available only for student accounts.')
  }

  let challenge = await EmailOtpChallenge.findOne({
    studentId: user._id,
    accountCollection,
    purpose,
    verifiedAt: null,
    invalidatedAt: null,
  }).sort({ createdAt: -1 })

  if (challenge) {
    const retryAfterSeconds = Math.ceil(
      (challenge.lastSentAt.getTime() + resendCooldownMs - Date.now()) / 1000,
    )
    if (retryAfterSeconds > 0) {
      return {
        challengeToken: createChallengeToken(challenge),
        maskedEmail: maskEmail(user.email),
        resendAfterSeconds: retryAfterSeconds,
      }
    }
    const lastSentAt = challenge.lastSentAt
    challenge = await EmailOtpChallenge.findOneAndUpdate(
      { _id: challenge._id, verifiedAt: null, invalidatedAt: null, lastSentAt },
      { $set: { lastSentAt: new Date() } },
      { new: true },
    )
    if (!challenge) {
      throw new TwoFactorError(429, 'A code was just requested. Please wait before trying again.', 60)
    }
  } else {
    challenge = new EmailOtpChallenge({
      studentId: user._id,
      accountCollection,
      purpose,
      hashedOtp: 'pending',
      expiresAt: new Date(),
      cleanupAt: new Date(Date.now() + cleanupLifetimeMs),
      attempts: 0,
      lastSentAt: new Date(0),
    })
  }

  await deliverChallenge(challenge, user)
  return {
    challengeToken: createChallengeToken(challenge),
    maskedEmail: maskEmail(user.email),
    resendAfterSeconds: 60,
  }
}

export async function resendStudentOtp({ challengeToken, purpose, authenticatedUser }) {
  assertResendConfigured()
  const payload = readChallengeToken(challengeToken, purpose, authenticatedUser)
  const challenge = await EmailOtpChallenge.findOne({
    _id: payload.jti,
    studentId: payload.sub,
    accountCollection: payload.accountCollection,
    purpose,
    verifiedAt: null,
    invalidatedAt: null,
  })
  if (!challenge) throw new TwoFactorError(410, 'This verification request expired. Start again.')

  const retryAfterSeconds = Math.ceil(
    (challenge.lastSentAt.getTime() + resendCooldownMs - Date.now()) / 1000,
  )
  if (retryAfterSeconds > 0) {
    throw new TwoFactorError(429, 'Please wait before requesting another code.', retryAfterSeconds)
  }

  const accountModel = accountModelsByCollection[payload.accountCollection]
  const user = await accountModel.findById(payload.sub)
  if (!user || !user.email) throw new TwoFactorError(404, 'The student account could not be found.')

  const claimedChallenge = await EmailOtpChallenge.findOneAndUpdate(
    { _id: challenge._id, verifiedAt: null, invalidatedAt: null, lastSentAt: challenge.lastSentAt },
    { $set: { lastSentAt: new Date() } },
    { new: true },
  )
  if (!claimedChallenge) {
    throw new TwoFactorError(429, 'A code was just requested. Please wait before trying again.', 60)
  }
  await deliverChallenge(claimedChallenge, user)
  return {
    challengeToken: createChallengeToken(claimedChallenge),
    maskedEmail: maskEmail(user.email),
    resendAfterSeconds: 60,
  }
}

export async function verifyStudentOtp({ challengeToken, code, purpose, authenticatedUser }) {
  const payload = readChallengeToken(challengeToken, purpose, authenticatedUser)
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new TwoFactorError(400, 'Enter the 6-digit verification code.')
  }

  const challenge = await EmailOtpChallenge.findOne({
    _id: payload.jti,
    studentId: payload.sub,
    accountCollection: payload.accountCollection,
    purpose,
    verifiedAt: null,
    invalidatedAt: null,
  }).select('+hashedOtp')
  if (!challenge) throw new TwoFactorError(409, 'This code has already been used or the request is invalid.')
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new TwoFactorError(410, 'The verification code expired. Request a new code.')
  }
  if (challenge.attempts >= maxOtpAttempts) {
    throw new TwoFactorError(429, 'Too many incorrect codes. Request a new code.')
  }

  const matches = otpMatches(challenge._id, code, challenge.hashedOtp)
  if (!matches) {
    const updated = await EmailOtpChallenge.findOneAndUpdate(
      { _id: challenge._id, verifiedAt: null, invalidatedAt: null, attempts: { $lt: maxOtpAttempts } },
      { $inc: { attempts: 1 } },
      { new: true },
    )
    if (!updated || updated.attempts >= maxOtpAttempts) {
      throw new TwoFactorError(429, 'Too many incorrect codes. Request a new code.')
    }
    throw new TwoFactorError(400, 'That verification code is incorrect.')
  }

  const verified = await EmailOtpChallenge.findOneAndUpdate(
    {
      _id: challenge._id,
      hashedOtp: challenge.hashedOtp,
      verifiedAt: null,
      invalidatedAt: null,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: maxOtpAttempts },
    },
    { $set: { verifiedAt: new Date() } },
    { new: true },
  )
  if (!verified) throw new TwoFactorError(409, 'This code has already been used or expired.')
  return payload
}

export async function cancelStudentOtp({ challengeToken, purpose, authenticatedUser }) {
  const payload = readChallengeToken(challengeToken, purpose, authenticatedUser)
  await EmailOtpChallenge.updateOne(
    {
      _id: payload.jti,
      studentId: payload.sub,
      accountCollection: payload.accountCollection,
      purpose,
      verifiedAt: null,
      invalidatedAt: null,
    },
    { $set: { invalidatedAt: new Date() } },
  )
}
