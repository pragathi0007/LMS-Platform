import bcrypt from 'bcryptjs'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config/env.js'
import User from '../models/User.js'
import { authenticate, requireRoles } from '../middleware/auth.js'

const router = Router()
const allowedRoles = new Set(['student', 'instructor', 'admin'])
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
    if (typeof confirmPassword !== 'string' || password !== confirmPassword) {
      return res.status(400).json({ message: 'Your passwords do not match.' })
    }
    if (normalizedRole === 'instructor') {
      if (instructorDetails) {
        if (termsAccepted !== true) {
          return res.status(400).json({ message: 'Accept the instructor terms to continue.' })
        }
        const detailsError = validateInstructorDetails(instructorDetails)
        if (detailsError) return res.status(400).json({ message: detailsError })
      } else {
        if (typeof professionalDetails !== 'string') {
          return res.status(400).json({ message: 'Enter your professional details.' })
        }
        if (!professionalDetails.trim() || professionalDetails.trim().length > 2000) {
          return res.status(400).json({
            message: 'Professional details must be between 1 and 2000 characters.',
          })
        }
      }
    }

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()
    const existing = await User.findOne({
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    }).select('email username')
    if (existing?.email === normalizedEmail) {
      return res.status(409).json({ message: 'That email address is already registered.' })
    }
    if (existing?.username === normalizedUsername) {
      return res.status(409).json({ message: 'That username is already taken.' })
    }

    const instructorProfile = normalizedRole === 'instructor' && instructorDetails
      ? {
          ...instructorDetails,
          countryCode: instructorDetails.countryCode.trim(),
          phone: instructorDetails.phone.trim(),
          professionalTitle: instructorDetails.professionalTitle.trim(),
          expertise: instructorDetails.expertise.map((item) => item.trim()),
          subjects: instructorDetails.subjects.map((item) => item.trim()),
          customSubjects: instructorDetails.customSubjects.map((item) => item.trim()),
          languages: instructorDetails.languages.map((item) => item.trim()),
          customLanguage: instructorDetails.customLanguage?.trim() || '',
          profilePicture: instructorDetails.profilePicture
            ? {
                data: Buffer.from(instructorDetails.profilePicture.dataUrl.split(',')[1], 'base64'),
                contentType: instructorDetails.profilePicture.contentType,
              }
            : undefined,
        }
      : undefined

    const passwordHash = await bcrypt.hash(password, 12)
    try {
      const user = await User.create({
        fullName: fullName.trim(),
        email: normalizedEmail,
        username: normalizedUsername,
        passwordHash,
        role: normalizedRole,
        status: normalizedRole === 'instructor' ? 'pending' : 'active',
        ...(instructorProfile ? { instructorDetails: instructorProfile } : {}),
        ...(typeof professionalDetails === 'string'
          ? { professionalDetails: professionalDetails.trim() }
          : {}),
      })

      return res.status(201).json({
        message: normalizedRole === 'instructor'
          ? 'Your instructor application was submitted and is pending admin approval.'
          : 'Your account was created successfully. You can now sign in.',
        user: {
          id: String(user._id),
          fullName: user.fullName,
          email: user.email,
          username: user.username,
          role: user.role,
          status: user.status,
        },
      })
    } catch (error) {
      if (error?.code === 11000) {
        const duplicateField = error.keyPattern?.email ? 'email' : error.keyPattern?.username ? 'username' : ''
        if (duplicateField === 'email') {
          return res.status(409).json({ message: 'That email address is already registered.' })
        }
        if (duplicateField === 'username') {
          return res.status(409).json({ message: 'That username is already taken.' })
        }
      }
      throw error
    }
  } catch (error) {
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
    const user = await User.findOne({
      $or: [{ username: normalizedIdentifier }, { email: normalizedIdentifier }],
    }).select('+passwordHash')

    const passwordMatches = user?.passwordHash
      ? await bcrypt.compare(password, user.passwordHash)
      : false
    if (!user || !passwordMatches || user.role !== requestedRole) {
      return res.status(401).json({ message: 'Invalid username/email or password.' })
    }

    const status = String(user.status || user.approvalStatus || '').toLowerCase()
    if (user.role === 'instructor' && status !== 'approved') {
      const message = status === 'rejected'
        ? 'Your instructor account was not approved.'
        : status === 'pending'
          ? 'Your instructor account is awaiting admin approval.'
          : 'Your instructor account is not active.'
      return res.status(403).json({ message })
    }
    if (user.isActive === false || !['active', 'approved'].includes(status)) {
      return res.status(403).json({ message: 'Your account is not active.' })
    }

    const token = jwt.sign(
      { role: user.role, permissions: user.permissions },
      config.jwtSecret,
      { subject: String(user._id), expiresIn: '1h' },
    )

    return res.json({
      token,
      user: {
        id: String(user._id),
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
      },
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
