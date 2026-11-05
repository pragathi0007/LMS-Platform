import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'
import { config } from '../config/env.js'
import AccountIdentity from '../models/AccountIdentity.js'
import { accountModelsByRole } from '../models/account-models.js'
import { authenticate, requireRoles } from '../middleware/auth.js'

const router = Router()
const registrationRoles = new Set(['student', 'instructor'])
const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const instructorExperiences = new Set(['fresher', 'less-than-1', '1-3', '3-5', '5-10', '10+'])

function isStringArray(value, { minLength = 1, maxItems = 30 } = {}) {
  return (
    Array.isArray(value) &&
    value.length >= minLength &&
    value.length <= maxItems &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 80)
  )
}

function validateInstructorDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return 'Complete the instructor profile details.'
  }

  const phoneDigits = typeof details.phone === 'string' ? details.phone.replace(/\D/g, '') : ''
  if (
    typeof details.countryCode !== 'string' ||
    !/^\+\d{1,4}$/.test(details.countryCode.trim()) ||
    phoneDigits.length < 7 ||
    phoneDigits.length > 15 ||
    !/^[0-9\s().-]+$/.test(details.phone.trim())
  ) {
    return 'Enter a valid phone country code and phone number.'
  }
  if (
    typeof details.professionalTitle !== 'string' ||
    details.professionalTitle.trim().length < 2 ||
    details.professionalTitle.trim().length > 100
  ) {
    return 'Enter a professional title between 2 and 100 characters.'
  }
  if (
    !isStringArray(details.expertise) ||
    !isStringArray(details.subjects) ||
    !isStringArray(details.languages, { maxItems: 8 })
  ) {
    return 'Select at least one expertise area, subject, and teaching language.'
  }
  if (!instructorExperiences.has(details.experience)) {
    return 'Select a valid teaching experience level.'
  }
  if (
    details.languages.includes('Other') &&
    (typeof details.customLanguage !== 'string' || !details.customLanguage.trim())
  ) {
    return 'Enter the other teaching language.'
  }
  if (
    !Array.isArray(details.customSubjects) ||
    details.customSubjects.length > 30 ||
    details.customSubjects.some(
      (subject) => typeof subject !== 'string' || !subject.trim() || subject.length > 80,
    )
  ) {
    return 'Check the custom subjects in your instructor profile.'
  }
  if (details.profilePicture !== undefined) {
    const picture = details.profilePicture
    if (
      !picture ||
      typeof picture !== 'object' ||
      !['image/jpeg', 'image/png'].includes(picture.contentType) ||
      typeof picture.dataUrl !== 'string' ||
      picture.dataUrl.length > 7_000_000
    ) {
      return 'Use a JPG or PNG profile picture no larger than 5 MB.'
    }

    const match = picture.dataUrl.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/)
    if (!match || match[1] !== picture.contentType) {
      return 'The profile picture is not a valid JPG or PNG image.'
    }
    if (Buffer.from(match[2], 'base64').length > 5 * 1024 * 1024) {
      return 'The profile picture must be 5 MB or smaller.'
    }
  }
  return ''
}

const allowedRoles = new Set(Object.keys(accountModelsByRole))

function isAllowedGoogleOrigin(origin) {
  if (!origin) return false
  if (origin === config.clientOrigin) return true
  return config.nodeEnv !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
}

function createAuthToken(user) {
  return jwt.sign(
    { role: user.role, permissions: user.permissions },
    config.jwtSecret,
    { subject: String(user._id), expiresIn: '1h' },
  )
}

function serializeAccount(user) {
  return {
    id: String(user._id),
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
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

export function normalizeProfessionalDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return {
      details: null,
      fieldErrors: { professionalDetails: 'Enter the required professional details.' },
    }
  }

  const { professionalTitle, countryCode, phone, expertise, subjects, experience, languages, customLanguage } = details
  const fieldErrors = {}
  const stringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')

  if (
    typeof professionalTitle !== 'string' ||
    professionalTitle.trim().length < 2 ||
    professionalTitle.trim().length > 100
  ) {
    fieldErrors.professionalTitle = 'Enter a professional title between 2 and 100 characters.'
  }
  if (typeof countryCode !== 'string' || !/^\+\d{1,4}$/.test(countryCode.trim())) {
    fieldErrors.countryCode = 'Select a valid country calling code.'
  }
  if (
    typeof phone !== 'string' ||
    !/^[0-9\s().-]+$/.test(phone.trim()) ||
    phone.replace(/\D/g, '').length < 7 ||
    phone.replace(/\D/g, '').length > 15
  ) {
    fieldErrors.phone = 'Enter a phone number containing 7–15 digits.'
  }
  if (!stringArray(expertise) || expertise.length === 0 || expertise.some((item) => !item.trim() || item.length > 100)) {
    fieldErrors.expertise = 'Select at least one valid area of expertise.'
  }
  if (!stringArray(subjects) || subjects.length === 0 || subjects.some((item) => !item.trim() || item.length > 80)) {
    fieldErrors.subjects = 'Select or add at least one valid subject or skill.'
  }
  if (typeof experience !== 'string' || !instructorExperiences.has(experience)) {
    fieldErrors.experience = 'Select a valid teaching experience level.'
  }
  if (!stringArray(languages) || languages.length === 0 || languages.some((item) => !item.trim() || item.length > 60)) {
    fieldErrors.languages = 'Select at least one teaching language.'
  }
  if (
    Array.isArray(languages) &&
    languages.includes('Other') &&
    (typeof customLanguage !== 'string' || !customLanguage.trim() || customLanguage.trim().length > 60)
  ) {
    fieldErrors.customLanguage = 'Enter the other language you teach (up to 60 characters).'
  }
  const customSubjects = details.customSubjects ?? []
  if (
    !Array.isArray(customSubjects) ||
    customSubjects.length > 30 ||
    customSubjects.some((subject) => typeof subject !== 'string' || !subject.trim() || subject.length > 80)
  ) {
    fieldErrors.customSubjects = 'Check the custom subjects in your instructor profile.'
  }

  let profilePicture
  if (details.profilePicture !== undefined) {
    const picture = details.profilePicture
    const match =
      picture && typeof picture.dataUrl === 'string'
        ? picture.dataUrl.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/)
        : null
    if (
      !picture ||
      typeof picture !== 'object' ||
      !['image/jpeg', 'image/png'].includes(picture.contentType) ||
      !match ||
      match[1] !== picture.contentType ||
      Buffer.from(match[2], 'base64').length > 5 * 1024 * 1024
    ) {
      fieldErrors.profilePicture = 'Use a valid JPG or PNG profile picture no larger than 5 MB.'
    } else {
      profilePicture = {
        data: Buffer.from(match[2], 'base64'),
        contentType: picture.contentType,
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { details: null, fieldErrors }
  }

  return {
    fieldErrors,
    details: {
      professionalTitle: professionalTitle.trim(),
      countryCode: countryCode.trim(),
      phone: phone.trim(),
      expertise: [...new Set(expertise.map((item) => item.trim()))],
      subjects: [...new Set(subjects.map((item) => item.trim()))],
      customSubjects: customSubjects.map((item) => item.trim()),
      experience: experience.trim(),
      languages: [...new Set(languages.map((item) => item.trim()))],
      customLanguage: typeof customLanguage === 'string' ? customLanguage.trim() : '',
      ...(profilePicture && { profilePicture }),
    },
  }
}

router.post('/register', async (req, res, next) => {
  try {
    const {
      fullName,
      email,
      username,
      password,
      confirmPassword,
      role,
      instructorDetails,
      professionalDetails,
      termsAccepted,
    } = req.body ?? {}
    const submittedRole = typeof role === 'string' ? role.trim().toLowerCase() : ''
    const normalizedRole = submittedRole === 'user' ? 'student' : submittedRole

    if (!registrationRoles.has(normalizedRole)) {
      return res.status(400).json({ message: 'Choose student or instructor registration.' })
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
    if (normalizedRole !== 'student' && normalizedRole !== 'instructor') {
      return res.status(400).json({ message: 'Public registration is available for students and instructors only.' })
    }
    if (typeof confirmPassword !== 'string' || password !== confirmPassword) {
      return res.status(400).json({ message: 'Your passwords do not match.' })
    }
    const normalizedName = fullName.trim()
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()
    let normalizedProfessionalDetails
    if (normalizedRole === 'instructor') {
      if (termsAccepted !== true) {
        return res.status(400).json({ message: 'Accept the instructor terms to continue.' })
      }
      const professionalDetailsResult = normalizeProfessionalDetails(instructorDetails ?? professionalDetails)
      normalizedProfessionalDetails = professionalDetailsResult.details
      if (!normalizedProfessionalDetails) {
        return res.status(400).json({
          message: 'Complete the highlighted professional details.',
          fieldErrors: professionalDetailsResult.fieldErrors,
        })
      }
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const AccountModel = accountModelsByRole[normalizedRole]
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
            status: normalizedRole === 'instructor' ? 'pending' : 'active',
            ...(normalizedProfessionalDetails && { professionalDetails: normalizedProfessionalDetails }),
          }],
          { session },
        )
      })
    } finally {
      await session.endSession()
    }

    return res.status(201).json({
      message: normalizedRole === 'instructor'
        ? 'Instructor application submitted and pending admin approval.'
        : 'Account created successfully.',
      user: {
        id: String(account._id),
        fullName: account.fullName,
        email: account.email,
        username: account.username,
        role: account.role,
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

    const submittedRole = role.trim().toLowerCase()
    const requestedRole = submittedRole === 'user' ? 'student' : submittedRole
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
    const AccountModel = accountModelsByRole[requestedRole]
    failureStage = 'lookup_account'
    const session = await mongoose.startSession()
    let account

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
          if (identity.accountCollection !== AccountModel.collection.name) {
            throw createGoogleAuthError(403, 'This Google account is not associated with the selected role.')
          }
          failureStage = 'lookup_linked_account'
          account = await AccountModel.findById(identity.accountId).session(session)
          if (!account || account.email !== email || account.role !== requestedRole) {
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
        for (const [accountRole, Model] of Object.entries(accountModelsByRole)) {
          failureStage = `lookup_${accountRole}_account`
          matchingAccounts.push({
            role: accountRole,
            account: await Model.findOne({ email }).session(session),
          })
        }
        const existingAccounts = matchingAccounts.filter((result) => result.account)
        if (existingAccounts.length > 1) {
          throw createGoogleAuthError(409, 'Conflicting accounts use this Google email. Contact an administrator.')
        }
        if (existingAccounts.length === 1) {
          const [existing] = existingAccounts
          if (existing.role !== requestedRole) {
            throw createGoogleAuthError(403, 'This Google account is not associated with the selected role.')
          }
          account = existing.account
          failureStage = 'link_google_identity'
          await AccountIdentity.create(
            [{
              email,
              username: account.username,
              googleSub: payload.sub,
              accountCollection: AccountModel.collection.name,
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
    if (account.role === 'instructor' && status !== 'approved') {
      const message = status === 'rejected'
        ? 'Your instructor account was not approved.'
        : status === 'pending'
          ? 'Your instructor account is awaiting admin approval.'
          : 'Your instructor account is not active.'
      return res.status(403).json({ message })
    }
    if (account.isActive === false || !['active', 'approved'].includes(status)) {
      return res.status(403).json({ message: 'Your account is not active.' })
    }

    failureStage = 'issue_lms_token'
    return res.json({
      token: createAuthToken(account),
      user: serializeAccount(account),
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

    const selectedRole = role.trim().toLowerCase()
    const requestedRole = selectedRole === 'user' ? 'student' : selectedRole
    if (!allowedRoles.has(requestedRole)) {
      return res.status(400).json({ message: 'Choose a valid account type.' })
    }
    if (!config.jwtSecret || !config.jwtSecret.trim()) {
      return res.status(503).json({ message: 'Authentication is not configured.' })
    }

    const normalizedIdentifier = identifier.trim().toLowerCase()
    const AccountModel = accountModelsByRole[requestedRole]
    const user = await AccountModel.findOne({
      $or: [{ username: normalizedIdentifier }, { email: normalizedIdentifier }],
    }).select('+passwordHash')

    const passwordMatches = user?.passwordHash
      ? await bcrypt.compare(password, user.passwordHash)
      : false
    if (!user || !passwordMatches || user.role !== requestedRole) {
      return res.status(401).json({ message: 'Invalid username/email or password.' })
    }

    const status = String(user.status || user.approvalStatus || '').toLowerCase()
    if (user.role === 'instructor' && !['active', 'approved'].includes(status)) {
      const message = status === 'rejected'
        ? 'Your instructor account was not approved.'
        : status === 'pending'
          ? 'Your instructor account is awaiting admin approval.'
          : 'Your instructor account is not active.'
      return res.status(403).json({ message })
    }
    if (
      (user.role === 'instructor' && user.isActive !== true) ||
      user.isActive === false ||
      !['active', 'approved'].includes(status)
    ) {
      return res.status(403).json({ message: 'Your account is not active.' })
    }

    const token = createAuthToken(user)

    return res.json({
      token,
      user: serializeAccount(user),
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/me', authenticate, (req, res) => {
  return res.json({ user: req.auth.user })
})

router.get('/dashboard/user', authenticate, requireRoles('student'), (req, res) => {
  return res.json({ user: req.auth.user })
})

router.get('/dashboard/instructor', authenticate, requireRoles('instructor'), (req, res) => {
  return res.json({ user: req.auth.user })
})

router.get('/dashboard/admin', authenticate, requireRoles('admin'), (req, res) => {
  return res.json({ user: req.auth.user })
})

export default router
