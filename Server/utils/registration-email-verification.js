import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { config } from '../config/env.js'

export function createRegistrationEmailOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashRegistrationEmailOtp(verificationId, email, code) {
  if (typeof config.jwtSecret !== 'string' || !config.jwtSecret.trim()) {
    const error = new Error('Authentication is not configured.')
    error.statusCode = 503
    throw error
  }
  return createHmac('sha256', config.jwtSecret)
    .update(`registration-email-otp:${verificationId}:${email}:${code}`)
    .digest('hex')
}

export function registrationEmailOtpMatches(verificationId, email, code, storedHash) {
  if (typeof storedHash !== 'string') return false
  const submitted = Buffer.from(hashRegistrationEmailOtp(verificationId, email, code), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  return submitted.length === expected.length && timingSafeEqual(submitted, expected)
}

export function createRegistrationEmailVerificationToken(verification) {
  if (!config.jwtSecret?.trim()) {
    const error = new Error('Authentication is not configured.')
    error.statusCode = 503
    throw error
  }
  return jwt.sign(
    { scope: 'registration_email_verified', email: verification.email },
    config.jwtSecret,
    { subject: String(verification._id), expiresIn: '30m' },
  )
}

export function readRegistrationEmailVerificationToken(token, email) {
  if (!config.jwtSecret?.trim()) {
    const error = new Error('Authentication is not configured.')
    error.statusCode = 503
    throw error
  }
  if (typeof token !== 'string' || !token) {
    const error = new Error('Please verify your email address before creating an account.')
    error.statusCode = 400
    throw error
  }

  let payload
  try {
    payload = jwt.verify(token, config.jwtSecret)
  } catch {
    const error = new Error('Email verification expired. Please request a new code.')
    error.statusCode = 400
    throw error
  }
  if (
    typeof payload === 'string' ||
    payload.scope !== 'registration_email_verified' ||
    payload.email !== email ||
    typeof payload.sub !== 'string' ||
    !mongoose.isValidObjectId(payload.sub)
  ) {
    const error = new Error('Please verify this email address before creating an account.')
    error.statusCode = 400
    throw error
  }
  return new mongoose.Types.ObjectId(payload.sub)
}
