import bcrypt from 'bcryptjs'
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import mongoose from 'mongoose'
import AccountIdentity from '../models/AccountIdentity.js'
import SupportTicket from '../models/SupportTicket.js'
import { accountModelsByCollection, roleForAccountCollection } from '../models/account-models.js'
import College from '../models/College.js'
import { authenticate } from '../middleware/auth.js'
import { config } from '../config/env.js'
import { findTakenEmails, findTakenUsernames } from '../utils/account-identity-availability.js'
import {
  logEmailDeliveryFailure,
  sendStudentEmailChangeVerificationEmail,
} from '../utils/email.js'
import {
  cancelStudentOtp,
  getOtpRateLimitDelay,
  issueStudentOtpChallenge,
  maskEmail,
  readChallengeToken,
  resendStudentOtp,
  TwoFactorError,
  verifyStudentOtp,
} from '../utils/two-factor.js'

const router = Router()
const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const passwordMaxBytes = 72
const emailCodeLifetimeMs = 15 * 60 * 1000
const emailCodeResendDelayMs = 60 * 1000
const emailCodeMaxAttempts = 5

router.use(authenticate)

function getAccountModel(req, res) {
  const AccountModel = accountModelsByCollection[req.auth.accountCollection]
  if (!AccountModel || roleForAccountCollection(req.auth.accountCollection) !== req.auth.role) {
    res.status(403).json({ message: 'Account settings are not available for this account.' })
    return null
  }
  return AccountModel
}

function getAccountType(user) {
  if (user.role === 'student') {
    if (user.studentType === 'college') return 'College Student'
    if (user.studentType === 'independent') return 'Independent Student'
    return 'Not recorded'
  }
  if (user.role === 'college_admin') return 'College Admin'
  if (user.role === 'main_admin') return 'Platform Admin'
  return 'Not available'
}

function serializeSettings(user, identity) {
  return {
    id: String(user._id),
    fullName: user.fullName || '',
    username: user.username,
    email: user.email,
    pendingEmail: identity?.pendingEmail || null,
    role: user.role,
    accountType: getAccountType(user),
    collegeName: null,
    googleConnected: Boolean(identity?.googleSub),
    googleEmail: identity?.googleSub ? identity.googleEmail || user.email : null,
    hasPassword: Boolean(user.passwordHash),
    twoFactorEnabled: user.role === 'student' ? user.twoFactorEnabled === true : null,
    twoFactorEnabledAt: user.role === 'student' ? user.twoFactorEnabledAt || null : null,
  }
}

function sendRateLimited(res, retryAfterSeconds, message) {
  if (!retryAfterSeconds) return false
  res.set('Retry-After', String(retryAfterSeconds))
  res.status(429).json({ message, retryAfterSeconds })
  return true
}

function respondTwoFactorError(res, error) {
  if (!(error instanceof TwoFactorError) && !error?.statusCode) return false
  if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds))
  res.status(error.statusCode).json({
    message: error.message,
    ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
  })
  return true
}

router.get('/', async (req, res, next) => {
  try {
    const AccountModel = getAccountModel(req, res)
    if (!AccountModel) return
    const [user, identity] = await Promise.all([
      AccountModel.findById(req.auth.id).select('+passwordHash'),
      AccountIdentity.findOne({
        accountCollection: AccountModel.collection.name,
        accountId: req.auth.id,
      }).select('+googleSub +googleEmail +pendingEmail'),
    ])
    if (!user || !identity) return res.status(404).json({ message: 'Account settings could not be found.' })
    const account = serializeSettings(user, identity)
    if (user.collegeId) {
      const college = await College.findById(user.collegeId).select('name').lean()
      account.collegeName = college?.name || null
    }
    return res.json({ account })
  } catch (error) {
    return next(error)
  }
})

router.post('/two-factor/challenge', async (req, res, next) => {
  try {
    if (req.auth.role !== 'student') {
      return res.status(403).json({ message: 'Two-factor settings are available only for student accounts.' })
    }
    const action = req.body?.action
    if (!['enable', 'disable'].includes(action)) {
      return res.status(400).json({ message: 'Choose whether to enable or disable two-factor authentication.' })
    }
    if (sendRateLimited(res, getOtpRateLimitDelay(req, 'request'), 'Too many verification requests. Please wait before trying again.')) return

    const AccountModel = getAccountModel(req, res)
    if (!AccountModel) return
    const user = await AccountModel.findById(req.auth.id)
    if (!user || user.email !== req.auth.user.email) {
      return res.status(404).json({ message: 'The student account could not be found.' })
    }
    if (action === 'enable' && user.twoFactorEnabled) {
      return res.status(409).json({ message: 'Two-factor authentication is already enabled.' })
    }
    if (action === 'disable' && !user.twoFactorEnabled) {
      return res.status(409).json({ message: 'Two-factor authentication is already disabled.' })
    }

    const challenge = await issueStudentOtpChallenge({
      user,
      accountCollection: req.auth.accountCollection,
      purpose: action === 'enable' ? 'settings_enable' : 'settings_disable',
    })
    return res.json({ ...challenge, action })
  } catch (error) {
    if (respondTwoFactorError(res, error)) return
    return next(error)
  }
})

router.post('/two-factor/resend', async (req, res, next) => {
  try {
    if (req.auth.role !== 'student') {
      return res.status(403).json({ message: 'Two-factor settings are available only for student accounts.' })
    }
    if (sendRateLimited(res, getOtpRateLimitDelay(req, 'request'), 'Too many verification requests. Please wait before trying again.')) return
    const challengeToken = req.body?.challengeToken
    const payload = readChallengeToken(challengeToken, null, req.auth)
    if (!['settings_enable', 'settings_disable'].includes(payload.purpose)) {
      return res.status(400).json({ message: 'The verification session is invalid.' })
    }
    const AccountModel = getAccountModel(req, res)
    if (!AccountModel) return
    const user = await AccountModel.findById(req.auth.id)
    if (!user || user.email !== req.auth.user.email) {
      return res.status(404).json({ message: 'The student account could not be found.' })
    }
    if (
      (payload.purpose === 'settings_enable' && user.twoFactorEnabled) ||
      (payload.purpose === 'settings_disable' && !user.twoFactorEnabled)
    ) {
      return res.status(409).json({ message: 'The two-factor setting changed. Refresh account settings and try again.' })
    }
    const challenge = await resendStudentOtp({
      challengeToken,
      purpose: payload.purpose,
      authenticatedUser: req.auth,
    })
    return res.json(challenge)
  } catch (error) {
    if (respondTwoFactorError(res, error)) return
    return next(error)
  }
})

router.post('/two-factor/verify', async (req, res, next) => {
  try {
    if (req.auth.role !== 'student') {
      return res.status(403).json({ message: 'Two-factor settings are available only for student accounts.' })
    }
    if (sendRateLimited(res, getOtpRateLimitDelay(req, 'verify'), 'Too many verification attempts. Please wait before trying again.')) return
    const challengeToken = req.body?.challengeToken
    const payload = readChallengeToken(challengeToken, null, req.auth)
    if (!['settings_enable', 'settings_disable'].includes(payload.purpose)) {
      return res.status(400).json({ message: 'The verification session is invalid.' })
    }
    const AccountModel = getAccountModel(req, res)
    if (!AccountModel) return
    const user = await AccountModel.findById(req.auth.id)
    if (!user || user.email !== req.auth.user.email) {
      return res.status(404).json({ message: 'The student account could not be found.' })
    }
    if (
      (payload.purpose === 'settings_enable' && user.twoFactorEnabled) ||
      (payload.purpose === 'settings_disable' && !user.twoFactorEnabled)
    ) {
      return res.status(409).json({ message: 'The two-factor setting changed. Refresh account settings and try again.' })
    }

    await verifyStudentOtp({
      challengeToken,
      code: req.body?.code,
      purpose: payload.purpose,
      authenticatedUser: req.auth,
    })
    user.twoFactorEnabled = payload.purpose === 'settings_enable'
    user.twoFactorEnabledAt = user.twoFactorEnabled ? new Date() : undefined
    await user.save()
    return res.json({
      message: user.twoFactorEnabled
        ? 'Two-factor authentication is now enabled.'
        : 'Two-factor authentication has been disabled.',
      account: {
        twoFactorEnabled: user.twoFactorEnabled,
        twoFactorEnabledAt: user.twoFactorEnabledAt || null,
        twoFactorEmail: maskEmail(user.email),
      },
    })
  } catch (error) {
    if (respondTwoFactorError(res, error)) return
    return next(error)
  }
})

router.post('/two-factor/cancel', async (req, res, next) => {
  try {
    if (req.auth.role !== 'student') {
      return res.status(403).json({ message: 'Two-factor settings are available only for student accounts.' })
    }
    const challengeToken = req.body?.challengeToken
    const payload = readChallengeToken(challengeToken, null, req.auth)
    if (!['settings_enable', 'settings_disable'].includes(payload.purpose)) {
      return res.status(400).json({ message: 'The verification session is invalid.' })
    }
    await cancelStudentOtp({
      challengeToken,
      purpose: payload.purpose,
      authenticatedUser: req.auth,
    })
    return res.json({ message: 'The two-factor change was cancelled.' })
  } catch (error) {
    if (respondTwoFactorError(res, error)) return
    return next(error)
  }
})

router.get('/username-availability', async (req, res, next) => {
  try {
    const { username } = req.query
    if (typeof username !== 'string') {
      return res.status(400).json({ message: 'Enter a username to check.' })
    }
    const normalizedUsername = username.trim().toLowerCase()
    if (!usernamePattern.test(normalizedUsername)) {
      return res.status(400).json({
        message: 'Use a username with 3–30 letters, numbers, dots, underscores, or hyphens.',
      })
    }
    const takenUsernames = await findTakenUsernames([normalizedUsername], {
      excludedAccount: {
        accountCollection: req.auth.accountCollection,
        accountId: req.auth.id,
      },
    })
    const available = !takenUsernames.has(normalizedUsername)
    return res.json({
      available,
      isCurrent: available && normalizedUsername === req.auth.user.username?.toLowerCase(),
    })
  } catch (error) {
    return next(error)
  }
})

router.patch('/profile', async (req, res, next) => {
  try {
    const AccountModel = getAccountModel(req, res)
    if (!AccountModel) return
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ message: 'Enter valid account details.' })
    }
    const allowedFields = new Set(['fullName', 'username'])
    if (Object.keys(body).some((field) => !allowedFields.has(field))) {
      return res.status(400).json({ message: 'Only your display name and username can be changed here.' })
    }

    const updates = {}
    if (Object.hasOwn(body, 'fullName')) {
      if (typeof body.fullName !== 'string' || body.fullName.trim().length < 2 || body.fullName.trim().length > 120) {
        return res.status(400).json({ message: 'Display name must be between 2 and 120 characters.' })
      }
      updates.fullName = body.fullName.trim()
    }
    if (Object.hasOwn(body, 'username')) {
      if (typeof body.username !== 'string' || !usernamePattern.test(body.username.trim())) {
        return res.status(400).json({ message: 'Username must be 3–30 characters and use only letters, numbers, dots, underscores, or hyphens.' })
      }
      updates.username = body.username.trim().toLowerCase()
    }
    if (!Object.keys(updates).length) return res.status(400).json({ message: 'No account changes were provided.' })

    if (updates.username) {
      const takenUsernames = await findTakenUsernames([updates.username], {
        excludedAccount: {
          accountCollection: req.auth.accountCollection,
          accountId: req.auth.id,
        },
      })
      if (takenUsernames.has(updates.username)) {
        return res.status(409).json({ message: 'That username is already taken. Try another username.' })
      }
    }

    const session = await mongoose.startSession()
    let updatedUser
    let updatedIdentity
    try {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await session.withTransaction(async () => {
            const user = await AccountModel.findById(req.auth.id).session(session)
            const identity = await AccountIdentity.findOne({
              accountCollection: AccountModel.collection.name,
              accountId: req.auth.id,
            }).select('+googleSub +googleEmail +pendingEmail').session(session)
            if (!user || !identity) {
              const error = new Error('Account settings could not be found.')
              error.statusCode = 404
              throw error
            }
            if (user.email !== identity.email || user.username.toLowerCase() !== identity.username) {
              const error = new Error('The account identity does not match the student account. Contact support before updating account details.')
              error.statusCode = 409
              throw error
            }
            if (updates.username && updates.username !== user.username) {
              const conflict = await AccountIdentity.findOne({
                username: updates.username,
                $nor: [{
                  accountCollection: AccountModel.collection.name,
                  accountId: user._id,
                }],
              })
                .collation({ locale: 'en', strength: 2 })
                .session(session)
              if (conflict) {
                const error = new Error('That username is already taken.')
                error.statusCode = 409
                throw error
              }
              user.username = updates.username
              identity.username = updates.username
            }
            if (updates.fullName) user.fullName = updates.fullName
            await user.save({ session })
            await identity.save({ session })
            updatedUser = user
            updatedIdentity = identity
          })
          break
        } catch (error) {
          if (error?.code !== 117 || attempt >= 3) throw error
          await new Promise((resolve) => setTimeout(resolve, attempt * 50))
        }
      }
    } finally {
      await session.endSession()
    }
    return res.json({ account: serializeSettings(updatedUser, updatedIdentity) })
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ message: error.message })
    if (error?.code === 11000) return res.status(409).json({ message: 'That username is already taken.' })
    return next(error)
  }
})

function hashEmailVerificationCode(identityId, code) {
  if (typeof config.jwtSecret !== 'string' || !config.jwtSecret.trim()) {
    const error = new Error('Email verification is not configured.')
    error.statusCode = 503
    throw error
  }
  return createHmac('sha256', config.jwtSecret)
    .update(`${identityId}:${code}`)
    .digest('hex')
}

function isMatchingVerificationCode(identityId, code, savedHash) {
  if (typeof savedHash !== 'string') return false
  const submittedHash = Buffer.from(hashEmailVerificationCode(identityId, code), 'hex')
  const expectedHash = Buffer.from(savedHash, 'hex')
  return submittedHash.length === expectedHash.length && timingSafeEqual(submittedHash, expectedHash)
}

function clearPendingEmail(identity) {
  identity.pendingEmail = undefined
  identity.pendingEmailVerificationCodeHash = undefined
  identity.pendingEmailVerificationExpiresAt = undefined
  identity.pendingEmailVerificationRequestedAt = undefined
  identity.pendingEmailVerificationAttempts = 0
}

router.post('/email-change/request', async (req, res, next) => {
  try {
    if (req.auth.role !== 'student') {
      return res.status(403).json({ message: 'Email changes are available only for student accounts.' })
    }
    const AccountModel = getAccountModel(req, res)
    if (!AccountModel) return
    const newEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    if (newEmail.length > 254 || !emailPattern.test(newEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address.' })
    }

    const [user, identity] = await Promise.all([
      AccountModel.findById(req.auth.id),
      AccountIdentity.findOne({
        accountCollection: AccountModel.collection.name,
        accountId: req.auth.id,
      }).select('+googleSub +googleEmail +pendingEmail +pendingEmailVerificationRequestedAt'),
    ])
    if (!user || !identity) return res.status(404).json({ message: 'Account settings could not be found.' })
    if (user.email !== identity.email || user.username.toLowerCase() !== identity.username) {
      return res.status(409).json({ message: 'The account identity does not match the student account. Contact support before requesting an email change.' })
    }
    if (newEmail === user.email.toLowerCase()) {
      return res.status(400).json({ message: 'That is already your current email address.' })
    }
    if (
      identity.pendingEmailVerificationRequestedAt &&
      Date.now() - identity.pendingEmailVerificationRequestedAt.getTime() < emailCodeResendDelayMs
    ) {
      return res.status(429).json({ message: 'Please wait a minute before requesting another verification code.' })
    }

    const takenEmails = await findTakenEmails([newEmail], {
      excludedAccount: {
        accountCollection: req.auth.accountCollection,
        accountId: req.auth.id,
      },
    })
    if (takenEmails.has(newEmail)) {
      return res.status(409).json({ message: 'That email address is already registered to another account.' })
    }

    const code = String(randomInt(10_000_000, 100_000_000))
    const codeHash = hashEmailVerificationCode(identity._id, code)
    const now = new Date()
    identity.pendingEmail = newEmail
    identity.pendingEmailVerificationCodeHash = codeHash
    identity.pendingEmailVerificationExpiresAt = new Date(now.getTime() + emailCodeLifetimeMs)
    identity.pendingEmailVerificationRequestedAt = now
    identity.pendingEmailVerificationAttempts = 0
    await identity.save()

    try {
      await sendStudentEmailChangeVerificationEmail({
        email: newEmail,
        fullName: user.fullName,
        code,
      })
    } catch (emailError) {
      logEmailDeliveryFailure({
        event: 'notification.student_email_change_email.failed',
        accountId: user._id,
        error: emailError,
      })
      await AccountIdentity.updateOne(
        { _id: identity._id, pendingEmailVerificationCodeHash: codeHash },
        {
          $unset: {
            pendingEmail: '',
            pendingEmailVerificationCodeHash: '',
            pendingEmailVerificationExpiresAt: '',
            pendingEmailVerificationRequestedAt: '',
          },
          $set: { pendingEmailVerificationAttempts: 0 },
        },
      )
      return res.status(503).json({
        message: emailError?.code === 'RESEND_NOT_CONFIGURED'
          ? 'Email verification is not configured. Contact support before changing your email.'
          : 'The verification email could not be sent. Check your email address and try again.',
      })
    }
    return res.json({
      message: `A verification code was sent to ${newEmail}. Your current email remains active until you verify it.`,
      account: serializeSettings(user, identity),
    })
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ message: error.message })
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'That email address is already registered to another account.' })
    }
    return next(error)
  }
})

router.post('/email-change/verify', async (req, res, next) => {
  try {
    if (req.auth.role !== 'student') {
      return res.status(403).json({ message: 'Email changes are available only for student accounts.' })
    }
    const AccountModel = getAccountModel(req, res)
    if (!AccountModel) return
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
    if (!/^\d{8}$/.test(code)) {
      return res.status(400).json({ message: 'Enter the 8-digit verification code.' })
    }

    const identity = await AccountIdentity.findOne({
      accountCollection: AccountModel.collection.name,
      accountId: req.auth.id,
    }).select('+pendingEmail +pendingEmailVerificationCodeHash +pendingEmailVerificationExpiresAt +pendingEmailVerificationAttempts')
    if (!identity?.pendingEmail || !identity.pendingEmailVerificationCodeHash) {
      return res.status(400).json({ message: 'Request a new email verification code first.' })
    }
    if (
      !(identity.pendingEmailVerificationExpiresAt instanceof Date) ||
      identity.pendingEmailVerificationExpiresAt <= new Date()
    ) {
      clearPendingEmail(identity)
      await identity.save()
      return res.status(410).json({ message: 'The verification code expired. Request a new code.' })
    }
    if (identity.pendingEmailVerificationAttempts >= emailCodeMaxAttempts) {
      return res.status(429).json({ message: 'Too many incorrect codes. Request a new verification code.' })
    }
    if (!isMatchingVerificationCode(identity._id, code, identity.pendingEmailVerificationCodeHash)) {
      await AccountIdentity.updateOne(
        { _id: identity._id, pendingEmailVerificationCodeHash: identity.pendingEmailVerificationCodeHash },
        { $inc: { pendingEmailVerificationAttempts: 1 } },
      )
      return res.status(400).json({ message: 'The verification code is incorrect.' })
    }

    const takenEmails = await findTakenEmails([identity.pendingEmail], {
      excludedAccount: {
        accountCollection: req.auth.accountCollection,
        accountId: req.auth.id,
      },
    })
    if (takenEmails.has(identity.pendingEmail)) {
      clearPendingEmail(identity)
      await identity.save()
      return res.status(409).json({ message: 'That email address is now registered to another account. Request a different email.' })
    }

    const session = await mongoose.startSession()
    let updatedUser
    let updatedIdentity
    try {
      await session.withTransaction(async () => {
        const user = await AccountModel.findById(req.auth.id).session(session)
        const currentIdentity = await AccountIdentity.findOne({
          accountCollection: AccountModel.collection.name,
          accountId: req.auth.id,
        }).select('+googleSub +googleEmail +pendingEmail +pendingEmailVerificationCodeHash +pendingEmailVerificationExpiresAt +pendingEmailVerificationAttempts').session(session)
        if (
          !user ||
          !currentIdentity ||
          user.email !== currentIdentity.email ||
          user.username.toLowerCase() !== currentIdentity.username ||
          currentIdentity.pendingEmail !== identity.pendingEmail ||
          currentIdentity.pendingEmailVerificationCodeHash !== identity.pendingEmailVerificationCodeHash ||
          !(currentIdentity.pendingEmailVerificationExpiresAt instanceof Date) ||
          currentIdentity.pendingEmailVerificationExpiresAt <= new Date()
        ) {
          const error = new Error('The verification code expired or was replaced. Request a new code.')
          error.statusCode = 409
          throw error
        }
        const previousEmail = user.email
        if (currentIdentity.googleSub && !currentIdentity.googleEmail) {
          currentIdentity.googleEmail = previousEmail
        }
        user.email = currentIdentity.pendingEmail
        currentIdentity.email = currentIdentity.pendingEmail
        clearPendingEmail(currentIdentity)
        await user.save({ session })
        await currentIdentity.save({ session })
        updatedUser = user
        updatedIdentity = currentIdentity
      })
    } finally {
      await session.endSession()
    }
    return res.json({
      message: 'Your email address has been verified and updated.',
      account: serializeSettings(updatedUser, updatedIdentity),
    })
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ message: error.message })
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'That email address is already registered to another account.' })
    }
    return next(error)
  }
})

router.post('/password', async (req, res, next) => {
  try {
    const AccountModel = getAccountModel(req, res)
    if (!AccountModel) return
    const { currentPassword, newPassword } = req.body ?? {}
    if (
      typeof currentPassword !== 'string' ||
      !currentPassword ||
      Buffer.byteLength(currentPassword, 'utf8') > passwordMaxBytes
    ) {
      return res.status(400).json({ message: 'Enter your current password.' })
    }
    if (
      typeof newPassword !== 'string' ||
      newPassword.length < 8 ||
      Buffer.byteLength(newPassword, 'utf8') > passwordMaxBytes
    ) {
      return res.status(400).json({ message: 'New password must be at least 8 characters and no more than 72 UTF-8 bytes.' })
    }
    const user = await AccountModel.findById(req.auth.id).select('+passwordHash')
    if (!user) return res.status(404).json({ message: 'Account could not be found.' })
    if (!user.passwordHash) {
      return res.status(409).json({ message: 'This account does not have a password. Password setup for Google-only accounts is not available yet.' })
    }
    if (!await bcrypt.compare(currentPassword, user.passwordHash)) {
      return res.status(400).json({ message: 'Your current password is incorrect.' })
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12)
    await user.save()
    return res.json({ message: 'Your password has been changed.' })
  } catch (error) {
    return next(error)
  }
})

router.get('/data-export', async (req, res, next) => {
  try {
    const AccountModel = getAccountModel(req, res)
    if (!AccountModel) return
    const user = await AccountModel.findById(req.auth.id)
    if (!user) return res.status(404).json({ message: 'Account could not be found.' })

    const supportRequests = req.auth.role === 'student'
      ? await SupportTicket.find({
          userId: req.auth.id,
          userCollection: req.auth.accountCollection,
        }).select('-attachment.data').sort({ createdAt: -1 }).lean()
      : []
    const report = {
      generatedAt: new Date().toISOString(),
      account: {
        id: String(user._id),
        name: user.fullName || '',
        username: user.username,
        email: user.email,
        role: user.role,
        accountType: getAccountType(user),
        createdAt: user.createdAt || null,
      },
      supportRequests: supportRequests.map((ticket) => ({
        ticketId: ticket.ticketId,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        description: ticket.description,
        status: ticket.status,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        replies: (ticket.replies || []).map((reply) => ({
          authorRole: reply.authorRole,
          message: reply.message,
          createdAt: reply.createdAt,
        })),
        statusHistory: (ticket.statusHistory || []).map((entry) => ({
          from: entry.from || null,
          to: entry.to,
          createdAt: entry.createdAt,
        })),
      })),
      unavailableData: ['enrollments', 'course progress', 'purchases', 'achievements'],
    }
    const date = new Date().toISOString().slice(0, 10)
    res.type('application/json')
    res.set('Content-Disposition', `attachment; filename="lms-account-data-${date}.json"`)
    return res.send(JSON.stringify(report, null, 2))
  } catch (error) {
    return next(error)
  }
})

export default router
