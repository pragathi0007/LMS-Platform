import bcrypt from 'bcryptjs'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config/env.js'
import User from '../models/User.js'
import { authenticate, requireRoles } from '../middleware/auth.js'

const router = Router()
const allowedRoles = new Set(['student', 'instructor', 'admin'])

router.post('/register', async (req, res, next) => {
  try {
    const {
      fullName,
      email,
      username,
      password,
      confirmPassword,
      professionalDetails,
      role,
    } = req.body ?? {}

    if (
      typeof fullName !== 'string' ||
      typeof email !== 'string' ||
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      typeof confirmPassword !== 'string' ||
      typeof role !== 'string'
    ) {
      return res.status(400).json({ message: 'Complete all required registration fields.' })
    }

    const normalizedName = fullName.trim()
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()
    const normalizedRole = role.trim().toLowerCase()

    if (!normalizedName || normalizedName.length > 120) {
      return res.status(400).json({ message: 'Enter a name between 1 and 120 characters.' })
    }
    if (
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      return res.status(400).json({ message: 'Enter a valid email address.' })
    }
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(normalizedUsername)) {
      return res.status(400).json({
        message: 'Use a username with 3–30 letters, numbers, dots, underscores, or hyphens.',
      })
    }
    if (normalizedRole !== 'user' && normalizedRole !== 'instructor') {
      return res.status(400).json({ message: 'Public registration is available for users and instructors only.' })
    }
    if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ message: 'Password must be at least 8 characters and no more than 72 bytes.' })
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Your passwords do not match.' })
    }

    let normalizedProfessionalDetails
    if (normalizedRole === 'instructor') {
      if (typeof professionalDetails !== 'string') {
        return res.status(400).json({ message: 'Enter your professional details.' })
      }
      normalizedProfessionalDetails = professionalDetails.trim()
      if (!normalizedProfessionalDetails || normalizedProfessionalDetails.length > 2000) {
        return res.status(400).json({ message: 'Professional details must be between 1 and 2000 characters.' })
      }
    }

    const duplicateEmail = await User.exists({ email: normalizedEmail })
    if (duplicateEmail) {
      return res.status(409).json({ message: 'An account with this email already exists.' })
    }
    const duplicateUsername = await User.exists({ username: normalizedUsername })
    if (duplicateUsername) {
      return res.status(409).json({ message: 'This username is already taken.' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await User.create({
      fullName: normalizedName,
      email: normalizedEmail,
      username: normalizedUsername,
      passwordHash,
      role: normalizedRole === 'user' ? 'student' : 'instructor',
      status: normalizedRole === 'instructor' ? 'pending' : 'active',
      ...(normalizedProfessionalDetails && { professionalDetails: normalizedProfessionalDetails }),
    })

    return res.status(201).json({
      message: normalizedRole === 'instructor'
        ? 'Instructor application submitted and pending admin approval.'
        : 'Account created successfully.',
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
      if (error.keyPattern?.email || error.keyValue?.email) {
        return res.status(409).json({ message: 'An account with this email already exists.' })
      }
      if (error.keyPattern?.username || error.keyValue?.username) {
        return res.status(409).json({ message: 'This username is already taken.' })
      }
    }
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Some registration details are invalid.' })
    }
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
