import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { createHash, randomBytes } from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'
import { config } from '../config/env.js'
import AccountIdentity from '../models/AccountIdentity.js'
import {
  accountModelsByCollection,
  accountModelsByRole,
  CollegeAdmin,
  matchesStoredAccountRole,
  roleForAccountCollection,
} from '../models/account-models.js'
import { authenticate, requireRoles } from '../middleware/auth.js'

const router = Router()
const registrationRoles = new Set(['student'])
const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const usernameCheckRateLimits = new Map()
const usernameCheckWindowMs = 60 * 1000
const usernameCheckMaxRequests = 30

const allowedRoles = new Set(['main_admin', 'college_admin', 'student'])

function isAllowedGoogleOrigin(origin) {
  if (!origin) return false
  if (origin === config.clientOrigin) return true
  return config.nodeEnv !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
}

function createAuthToken(user, accountCollection) {
  const role = roleForAccountCollection(accountCollection)
  if (!role) throw new Error('Cannot issue a token for an unsupported account collection.')
  return jwt.sign(
    { role, accountCollection, permissions: user.permissions },
    config.jwtSecret,
    { subject: String(user._id), expiresIn: '1h' },
  )
}

function serializeAccount(user, role = user.role) {
  return {
    id: String(user._id),
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    role,
    status: user.status,
    collegeId: user.collegeId ? String(user.collegeId) : undefined,
    studentType: user.studentType,
  }
}

function createGoogleAuthError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function getDuplicateField(error) {
  if (error?.keyPattern?.email || error?.keyValue?.email) return 'email'
  if (error?.keyPattern?.username || error?.keyValue?.username) return 'username'
  return null
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function limitUsernameChecks(req, res, next) {
  const now = Date.now()
  for (const [ip, limit] of usernameCheckRateLimits) {
    if (limit.resetAt <= now) usernameCheckRateLimits.delete(ip)
  }

  const key = req.ip || req.socket.remoteAddress || 'unknown'
  let limit = usernameCheckRateLimits.get(key)
  if (!limit || limit.resetAt <= now) {
    limit = { count: 0, resetAt: now + usernameCheckWindowMs }
    usernameCheckRateLimits.set(key, limit)
  }
  if (limit.count >= usernameCheckMaxRequests) {
    res.set('Retry-After', String(Math.ceil((limit.resetAt - now) / 1000)))
    return res.status(429).json({ message: 'Too many username checks. Please wait a moment and try again.' })
  }

  limit.count += 1
  return next()
}

function createUsernameSuggestions(username) {
  const stem = username.replace(/[._-]/g, '') || 'learner'
  const suffixes = ['07', '_25', '.ds', '_26', '2026']
  return [...new Set(suffixes.map((suffix) => {
    const availableStemLength = 30 - suffix.length
    return `${stem.slice(0, availableStemLength)}${suffix}`
  }))]
    .filter((suggestion) => usernamePattern.test(suggestion))
}

async function findTakenUsernames(usernames) {
  const candidates = [...new Set(usernames.map((username) => username.trim().toLowerCase()))]
  if (!candidates.length) return new Set()

  const patterns = candidates.map((username) => new RegExp(`^${escapeRegex(username)}$`, 'i'))
  const query = { username: { $in: patterns } }
  const collectionNames = new Set([
    ...Object.values(accountModelsByCollection).map((AccountModel) => AccountModel.collection.name),
  ])
  const database = mongoose.connection.db
  const resultSets = await Promise.all([
    AccountIdentity.find(query).select('username').lean(),
    ...[...collectionNames].map((collectionName) =>
      database.collection(collectionName).find(query, { projection: { username: 1, _id: 0 } }).toArray(),
    ),
  ])

  return new Set(
    resultSets
      .flat()
      .map((account) => typeof account.username === 'string' ? account.username.trim().toLowerCase() : '')
      .filter(Boolean),
  )
}

async function findExistingAccount(field, value) {
  for (const AccountModel of Object.values(accountModelsByCollection)) {
    const account = await AccountModel.findOne({ [field]: value }).select('_id').lean()
    if (account) return account
  }
  return null
}

router.get('/check-username', limitUsernameChecks, async (req, res, next) => {
  try {
    const { username } = req.query
    if (typeof username !== 'string') {
      return res.status(400).json({ message: 'Enter a username to check.' })
    }
    if (username.length > 256) {
      return res.status(400).json({ message: 'Usernames must be 30 characters or fewer.' })
    }

    const normalizedUsername = username.trim().toLowerCase()
    if (!usernamePattern.test(normalizedUsername)) {
      return res.status(400).json({
        message: 'Use a username with 3–30 letters, numbers, dots, underscores, or hyphens.',
      })
    }

    const suggestions = createUsernameSuggestions(normalizedUsername)
    const takenUsernames = await findTakenUsernames([normalizedUsername, ...suggestions])
    const available = !takenUsernames.has(normalizedUsername)
    const availableSuggestions = available
      ? []
      : suggestions.filter((suggestion) => !takenUsernames.has(suggestion)).slice(0, 5)

    return res.json({ available, suggestions: availableSuggestions })
  } catch (error) {
    return next(error)
  }
})

router.post('/register', async (req, res, next) => {
  try {
    const {
      fullName,
      email,
      username,
      password,
      confirmPassword,
      role,
      accountType,
      collegeId,
    } = req.body ?? {}
    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : ''

    if (!registrationRoles.has(normalizedRole)) {
      return res.status(400).json({ message: 'Public registration is available for independent students only.' })
    }
    if (
      (accountType !== undefined &&
        (typeof accountType !== 'string' || accountType.trim().toLowerCase() !== 'independent')) ||
      collegeId !== undefined
    ) {
      return res.status(400).json({ message: 'Public registration is available for independent students only.' })
    }
    if (
      typeof fullName !== 'string' ||
      fullName.trim().length < 1 ||
      fullName.trim().length > 120
    ) {
      return res.status(400).json({ message: 'Enter a full name between 1 and 120 characters.' })
    }
    if (
      typeof email !== 'string' ||
      email.trim().length > 254 ||
      !emailPattern.test(email.trim())
    ) {
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
    if (typeof confirmPassword !== 'string' || password !== confirmPassword) {
      return res.status(400).json({ message: 'Your passwords do not match.' })
    }
    const normalizedName = fullName.trim()
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()
    const AccountModel = accountModelsByRole[normalizedRole]
    const [existingAccount, takenUsernames] = await Promise.all([
      findExistingAccount('email', normalizedEmail),
      findTakenUsernames([normalizedUsername]),
    ])
    if (existingAccount) {
      return res.status(409).json({ message: 'An account with this email already exists.' })
    }
    if (takenUsernames.has(normalizedUsername)) {
      return res.status(409).json({ message: 'This username is already taken.' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const accountId = new mongoose.Types.ObjectId()
    const session = await mongoose.startSession()
    let account

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
        await AccountIdentity.create(
          [{
            email: normalizedEmail,
            username: normalizedUsername,
            accountCollection: AccountModel.collection.name,
            accountId,
          }],
          { session },
        )
        ;[account] = await AccountModel.create(
          [{
            _id: accountId,
            fullName: normalizedName,
            email: normalizedEmail,
            username: normalizedUsername,
            passwordHash,
            role: normalizedRole,
            studentType: 'independent',
            status: 'active',
          }],
          { session },
        )
      })
    } finally {
      await session.endSession()
    }

    return res.status(201).json({
      message: 'Account created successfully.',
      user: {
        id: String(account._id),
        fullName: account.fullName,
        email: account.email,
        username: account.username,
        role: 'student',
        status: account.status,
      },
    })
  } catch (error) {
    if (error?.code === 11000) {
      const duplicateField = getDuplicateField(error)
      if (duplicateField === 'email') {
        return res.status(409).json({ message: 'An account with this email already exists.' })
      }
      if (duplicateField === 'username') {
        return res.status(409).json({ message: 'This username is already taken.' })
      }
      return res.status(409).json({ message: 'An account with these details already exists.' })
    }
    if (error?.statusCode === 409) {
      return res.status(409).json({ message: error.message })
    }
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Some registration details are invalid.' })
    }
    return next(error)
  }
})

router.post('/google', async (req, res, next) => {
  let failureStage = 'validate_request'
  try {
    const { code, role } = req.body ?? {}
    console.info(JSON.stringify({
      event: 'auth.google.request',
      hasAuthorizationCode: typeof code === 'string' && Boolean(code.trim()),
      hasLegacyCredentialField:
        typeof req.body?.credential === 'string' && Boolean(req.body.credential.trim()),
      role: typeof role === 'string' ? role.trim().toLowerCase() : 'missing',
    }))
    if (typeof code !== 'string' || !code.trim() || code.length > 4096) {
      return res.status(400).json({ message: 'A valid Google authorization code is required.' })
    }
    if (typeof role !== 'string') {
      return res.status(400).json({ message: 'Choose a valid account type.' })
    }
    if (req.get('x-requested-with') !== 'XmlHttpRequest' || !isAllowedGoogleOrigin(req.get('origin'))) {
      return res.status(403).json({ message: 'The Google sign-in request could not be verified.' })
    }

    const requestedRole = role.trim().toLowerCase()
    if (!allowedRoles.has(requestedRole)) {
      return res.status(400).json({ message: 'Choose a valid account type.' })
    }
    if (!config.googleClientId || !config.googleClientId.trim()) {
      return res.status(503).json({ message: 'Google sign-in is not configured on the server.' })
    }
    if (!config.googleClientSecret || !config.googleClientSecret.trim()) {
      return res.status(503).json({
        message: 'Google sign-in is not configured. Set GOOGLE_CLIENT_SECRET in backend/.env.',
      })
    }
    if (!config.jwtSecret || !config.jwtSecret.trim()) {
      return res.status(503).json({ message: 'Authentication is not configured.' })
    }

    let payload
    failureStage = 'exchange_google_code'
    try {
      const googleOAuthClient = new OAuth2Client({
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        redirectUri: req.get('origin'),
      })
      const { tokens } = await googleOAuthClient.getToken(code.trim())
      if (typeof tokens.id_token !== 'string' || !tokens.id_token) {
        throw new Error('Google token exchange did not return an ID token.')
      }

      failureStage = 'verify_google_id_token'
      const ticket = await googleOAuthClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.googleClientId,
      })
      payload = ticket.getPayload()
    } catch (error) {
      const verificationMessage = error instanceof Error ? error.message.toLowerCase() : ''
      const failureReason =
        verificationMessage.includes('audience') || verificationMessage.includes('recipient')
          ? 'audience_mismatch'
          : verificationMessage.includes('expired')
            ? 'expired'
            : verificationMessage.includes('signature')
              ? 'invalid_signature'
              : failureStage === 'exchange_google_code'
                ? 'code_exchange_failed'
                : 'invalid_token'
      console.warn(JSON.stringify({
        event: 'auth.google.failed',
        stage: failureStage,
        failureReason,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode: typeof error?.code === 'string' ? error.code : undefined,
      }))
      return res.status(401).json({ message: 'Google authorization failed. Please try again.' })
    }

    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.email !== 'string' ||
      payload.email_verified !== true
    ) {
      return res.status(401).json({ message: 'Google did not provide a verified email address.' })
    }

    const email = payload.email.trim().toLowerCase()
    failureStage = 'lookup_account'
    const session = await mongoose.startSession()
    let account
    let accountCollection

    try {
      failureStage = 'lookup_email_identity'
      await session.withTransaction(async () => {
        const emailIdentity = await AccountIdentity.findOne({ email }).select('+googleSub').session(session)
        failureStage = 'lookup_google_subject_identity'
        const subjectIdentity = await AccountIdentity.findOne({ googleSub: payload.sub })
          .select('+googleSub')
          .session(session)
        if (
          (emailIdentity && subjectIdentity && !emailIdentity._id.equals(subjectIdentity._id)) ||
          (subjectIdentity && subjectIdentity.email !== email)
        ) {
          throw createGoogleAuthError(409, 'This Google account is already linked to a different LMS account.')
        }

        const identity = emailIdentity || subjectIdentity
        if (identity) {
          const AccountModel = accountModelsByCollection[identity.accountCollection]
          if (!AccountModel || roleForAccountCollection(identity.accountCollection) !== requestedRole) {
            throw createGoogleAuthError(403, 'This Google account is not associated with the selected role.')
          }
          accountCollection = identity.accountCollection
          failureStage = 'lookup_linked_account'
          account = await AccountModel.findById(identity.accountId).session(session)
          if (
            !account ||
            account.email !== email ||
            !matchesStoredAccountRole(identity.accountCollection, account.role)
          ) {
            throw createGoogleAuthError(401, 'The linked account could not be verified.')
          }
          if (identity.googleSub && identity.googleSub !== payload.sub) {
            throw createGoogleAuthError(409, 'This email is already linked to another Google account.')
          }
          if (!identity.googleSub) {
            failureStage = 'link_google_identity'
            const linkResult = await AccountIdentity.updateOne(
              {
                _id: identity._id,
                $or: [{ googleSub: { $exists: false } }, { googleSub: null }],
              },
              { $set: { googleSub: payload.sub } },
              { session },
            )
            if (linkResult.matchedCount !== 1) {
              throw createGoogleAuthError(409, 'This email is already linked to another Google account.')
            }
          }
          return
        }

        const matchingAccounts = []
        for (const [collectionName, Model] of Object.entries(accountModelsByCollection)) {
          failureStage = `lookup_${collectionName}_account`
          const match = await Model.findOne({ email }).session(session)
          if (match) matchingAccounts.push({ account: match, collectionName })
        }
        if (matchingAccounts.length > 1) {
          throw createGoogleAuthError(409, 'Conflicting accounts use this Google email. Contact an administrator.')
        }
        if (matchingAccounts.length === 1) {
          const [existing] = matchingAccounts
          if (
            roleForAccountCollection(existing.collectionName) !== requestedRole ||
            !matchesStoredAccountRole(existing.collectionName, existing.account.role)
          ) {
            throw createGoogleAuthError(403, 'This Google account is not associated with the selected role.')
          }
          account = existing.account
          accountCollection = existing.collectionName
          failureStage = 'link_google_identity'
          await AccountIdentity.create(
            [{
              email,
              username: account.username,
              googleSub: payload.sub,
              accountCollection,
              accountId: account._id,
            }],
            { session },
          )
          return
        }

        throw createGoogleAuthError(404, 'No LMS account exists for this Google email and selected role.')
      })
    } finally {
      await session.endSession()
    }

    const status = String(account.status || account.approvalStatus || '').toLowerCase()
    if (account.isActive === false || status !== 'active') {
      return res.status(403).json({ message: 'Your account is not active.' })
    }

    failureStage = 'issue_lms_token'
    return res.json({
      token: createAuthToken(account, accountCollection),
      user: serializeAccount(account, requestedRole),
    })
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message })
    }
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'This Google account is already linked to an LMS account.' })
    }
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'The Google account could not be linked.' })
    }
    console.error(JSON.stringify({
      event: 'auth.google.failed',
      stage: failureStage,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : undefined,
      errorCodeName: typeof error?.codeName === 'string' ? error.codeName : undefined,
      errorLabels: typeof error?.errorLabels === 'function' ? error.errorLabels() : undefined,
    }))
    return next(error)
  }
})

router.post('/login', async (req, res, next) => {
  try {
    const { identifier, password, role } = req.body ?? {}
    if (
      typeof identifier !== 'string' ||
      typeof password !== 'string' ||
      typeof role !== 'string' ||
      !identifier.trim() ||
      !password
    ) {
      return res.status(400).json({ message: 'Enter your username or email and password.' })
    }

    const requestedRole = role.trim().toLowerCase()
    if (!allowedRoles.has(requestedRole)) {
      return res.status(400).json({ message: 'Choose a valid account type.' })
    }
    if (!config.jwtSecret || !config.jwtSecret.trim()) {
      return res.status(503).json({ message: 'Authentication is not configured.' })
    }

    const normalizedIdentifier = identifier.trim().toLowerCase()
    const identity = await AccountIdentity.findOne({
      $or: [{ username: normalizedIdentifier }, { email: normalizedIdentifier }],
    }).lean()
    const accountCollection = identity?.accountCollection
    const AccountModel = accountModelsByCollection[accountCollection]
    if (!identity || !AccountModel || roleForAccountCollection(accountCollection) !== requestedRole) {
      return res.status(401).json({ message: 'Invalid username/email or password.' })
    }
    const user = await AccountModel.findById(identity.accountId).select('+passwordHash')
    if (
      !user ||
      user.email !== identity.email ||
      user.username !== identity.username ||
      !matchesStoredAccountRole(accountCollection, user.role)
    ) {
      return res.status(401).json({ message: 'Invalid username/email or password.' })
    }

    const passwordMatches = user?.passwordHash
      ? await bcrypt.compare(password, user.passwordHash)
      : false
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid username/email or password.' })
    }

    const status = String(user.status || user.approvalStatus || '').toLowerCase()
    if (user.isActive === false || status !== 'active') {
      return res.status(403).json({ message: 'Your account is not active.' })
    }

    const token = createAuthToken(user, accountCollection)

    return res.json({
      token,
      user: serializeAccount(user, requestedRole),
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/activate', async (req, res, next) => {
  try {
    const { token, password, confirmPassword } = req.body ?? {}
    if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
      return res.status(400).json({ message: 'The activation link is invalid or expired.' })
    }
    if (
      typeof password !== 'string' ||
      password.length < 8 ||
      Buffer.byteLength(password, 'utf8') > 72
    ) {
      return res.status(400).json({ message: 'Use a password of 8–72 bytes.' })
    }
    if (typeof confirmPassword !== 'string' || password !== confirmPassword) {
      return res.status(400).json({ message: 'Your passwords do not match.' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const activationTokenHash = createHash('sha256').update(token).digest('hex')
    const account = await CollegeAdmin.findOneAndUpdate(
      {
        role: 'college_admin',
        status: 'invitation_pending',
        activationTokenHash,
        activationTokenExpiresAt: { $gt: new Date() },
      },
      {
        $set: { passwordHash, status: 'active', isActive: true },
        $unset: { activationTokenHash: '', activationTokenExpiresAt: '' },
      },
      { new: true, runValidators: true },
    ).select('fullName email username role status collegeId')

    if (!account) {
      return res.status(400).json({ message: 'The activation link is invalid, expired, or already used.' })
    }
    return res.json({ message: 'Your account is active. You can now log in.' })
  } catch (error) {
    return next(error)
  }
})

router.get('/me', authenticate, (req, res) => {
  return res.json({ user: req.auth.user })
})

router.get('/dashboard/student', authenticate, requireRoles('student'), (req, res) => {
  return res.json({ user: req.auth.user })
})

router.get('/dashboard/main_admin', authenticate, requireRoles('main_admin'), (req, res) => {
  return res.json({ user: req.auth.user })
})

router.get('/dashboard/college_admin', authenticate, requireRoles('college_admin'), (req, res) => {
  return res.json({ user: req.auth.user })
})

export default router
