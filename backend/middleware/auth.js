import jwt from 'jsonwebtoken'
import { config } from '../config/env.js'
import { accountModelsByRole } from '../models/account-models.js'

const allowedRoles = new Set(Object.keys(accountModelsByRole))

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

    const AccountModel = accountModelsByRole[payload.role]
    const user = await AccountModel.findById(payload.sub)
    if (!user || user.role !== payload.role) {
      return res.status(401).json({ message: 'The access token is invalid.' })
    }

    const status = String(user.status || user.approvalStatus || '').toLowerCase()
    if (user.role === 'instructor' && !['active', 'approved'].includes(status)) {
      const message = status === 'rejected'
        ? 'Your instructor account was not approved.'
        : 'Your instructor account is awaiting admin approval.'
      return res.status(403).json({ message })
    }
    if (
      (user.role === 'instructor' && user.isActive !== true) ||
      user.isActive === false ||
      !['active', 'approved'].includes(status)
    ) {
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
        isActive: user.isActive,
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
