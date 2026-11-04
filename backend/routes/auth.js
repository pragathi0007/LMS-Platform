import bcrypt from 'bcryptjs'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'

const router = Router()
const allowedRoles = new Set(['student', 'instructor', 'admin'])

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
    if (!process.env.JWT_SECRET) {
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
      process.env.JWT_SECRET,
      { subject: String(user._id), expiresIn: '1h' },
    )

    return res.json({
      token,
      user: {
        id: String(user._id),
        username: user.username,
        email: user.email,
        role: user.role,
      },
    })
  } catch (error) {
    return next(error)
  }
})

export default router
