import jwt from 'jsonwebtoken'
import { config } from '../config/env.js'
import User from '../models/User.js'

const allowedRoles = new Set(['student', 'instructor', 'admin'])

export async function authenticate(req, res, next) {
  const authorization = req.get('authorization')
  const [scheme, token, ...extra] = authorization?.trim().split(/\s+/) ?? []

  if (scheme !== 'Bearer' || !token || extra.length) {
    return res.status(401).json({ message: 'A valid access token is required.' })
  }
  if (!config.jwtSecret || !config.jwtSecret.trim()) {
    return res.status(503).json({ message: 'Authentication is not configured.' })
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret)
    if (
      typeof payload === 'string' ||
      typeof payload.sub !== 'string' ||
      !allowedRoles.has(payload.role)
    ) {
      return res.status(401).json({ message: 'The access token is invalid.' })
    }

    const user = await User.findById(payload.sub)
    if (!user || user.role !== payload.role) {
      return res.status(401).json({ message: 'The access token is invalid.' })
    }

    const status = String(user.status || user.approvalStatus || '').toLowerCase()
    if (user.role === 'instructor' && status !== 'approved') {
      return res.status(403).json({ message: 'Your instructor account is awaiting admin approval.' })
    }
    if (user.isActive === false || !['active', 'approved'].includes(status)) {
      return res.status(403).json({ message: 'Your account is not active.' })
    }

    req.auth = {
      id: String(user._id),
      role: user.role,
      user: {
        id: String(user._id),
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    }
    return next()
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: 'The access token is invalid or expired.' })
    }
    return next(error)
  }
}

export function requireRoles(...roles) {
  const allowed = new Set(roles)
  return function authorizeRole(req, res, next) {
    if (!req.auth) {
      return res.status(401).json({ message: 'Authentication is required.' })
    }
    if (!allowed.has(req.auth.role)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource.' })
    }
    return next()
  }
}
