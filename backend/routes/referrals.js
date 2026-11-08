import { randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import { Router } from 'express'
import { authenticate, requireRoles } from '../middleware/auth.js'
import { Student } from '../models/account-models.js'
import ReferralCode from '../models/ReferralCode.js'
import ReferralCodeDailyLimit from '../models/ReferralCodeDailyLimit.js'

const router = Router()
const dailyGenerationLimit = 5
const codeLifetimeMs = 15 * 24 * 60 * 60 * 1000
const requireExternalUser = [
  authenticate,
  requireRoles('student'),
  (req, res, next) => {
    if (req.auth.user.studentType !== 'independent' || req.auth.accountCollection !== 'students') {
      return res.status(403).json({ message: 'Referral codes are available to External Users only.' })
    }
    return next()
  },
]

function getUtcDayStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function createRequestError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function registrationStatusForAccount(account) {
  const status = String(account?.approvalStatus || account?.status || '').toLowerCase()
  if (status === 'rejected') return 'rejected'
  if (status === 'active' || status === 'approved') return 'approved'
  return 'awaiting_approval'
}

function serializeCode(code, registrationStatus = code.registrationStatus) {
  const expired = code.status === 'expired' || code.expiresAt <= new Date()
  return {
    code: code.code,
    createdAt: code.createdAt,
    expiresAt: code.expiresAt,
    status: expired ? 'expired' : code.status,
    friendRegistered: Boolean(code.usedBy),
    usedAt: code.usedAt,
    registrationStatus: code.usedBy ? registrationStatus || 'awaiting_approval' : null,
  }
}

router.post('/validate', async (req, res, next) => {
  try {
    const rawCode = req.body?.code
    if (typeof rawCode !== 'string' || rawCode.trim().length < 8 || rawCode.trim().length > 64) {
      return res.status(400).json({ message: 'Enter a valid referral code.' })
    }

    const code = await ReferralCode.findOne({
      code: rawCode.trim().toUpperCase(),
      status: 'active',
      expiresAt: { $gt: new Date() },
      usedBy: null,
    }).select('expiresAt').lean()

    if (!code) {
      return res.status(400).json({ message: 'This referral code is invalid, expired, or already used.' })
    }
    return res.json({ valid: true, expiresAt: code.expiresAt })
  } catch (error) {
    return next(error)
  }
})

router.get('/me', ...requireExternalUser, async (req, res, next) => {
  try {
    const now = new Date()
    const generatedBy = new mongoose.Types.ObjectId(req.auth.id)
    await ReferralCode.updateMany(
      { generatedBy, status: 'active', expiresAt: { $lte: now } },
      { $set: { status: 'expired' } },
    )
    const codes = await ReferralCode.find({ generatedBy }).sort({ createdAt: -1 }).lean()
    const usedIds = codes.filter((code) => code.usedBy).map((code) => code.usedBy)
    const friends = usedIds.length
      ? await Student.find({ _id: { $in: usedIds }, studentType: 'independent' })
        .select('_id status approvalStatus')
        .lean()
      : []
    const friendsById = new Map(friends.map((friend) => [String(friend._id), friend]))

    const serializedCodes = await Promise.all(codes.map(async (code) => {
      const friend = code.usedBy ? friendsById.get(String(code.usedBy)) : null
      const registrationStatus = friend
        ? registrationStatusForAccount(friend)
        : code.registrationStatus
      if (code.usedBy && registrationStatus && registrationStatus !== code.registrationStatus) {
        await ReferralCode.updateOne(
          { _id: code._id, usedBy: code.usedBy },
          { $set: { registrationStatus } },
        )
      }
      return serializeCode(code, registrationStatus)
    }))
    const dayStart = getUtcDayStart(now)
    const generatedToday = codes.filter((code) => code.createdAt >= dayStart).length
    const stats = {
      totalGenerated: codes.length,
      generatedToday,
      dailyLimit: dailyGenerationLimit,
      successfullyUsed: codes.filter((code) => Boolean(code.usedBy)).length,
      active: serializedCodes.filter((code) => code.status === 'active').length,
      expired: serializedCodes.filter((code) => code.status === 'expired').length,
    }
    return res.json({ stats, codes: serializedCodes })
  } catch (error) {
    return next(error)
  }
})

router.post('/generate', ...requireExternalUser, async (req, res, next) => {
  const requestId = req.body?.requestId
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) {
    return res.status(400).json({ message: 'A valid generation request ID is required.' })
  }

  const generatedBy = new mongoose.Types.ObjectId(req.auth.id)
  const now = new Date()
  const dayStart = getUtcDayStart(now)
  let session

  try {
    const existing = await ReferralCode.findOne({ generatedBy, requestId }).lean()
    if (existing) return res.status(200).json({ code: serializeCode(existing), repeated: true })

    try {
      await ReferralCodeDailyLimit.updateOne(
        { generatedBy, dayStart },
        { $setOnInsert: { generatedBy, dayStart, count: 0 } },
        { upsert: true },
      )
    } catch (error) {
      if (error?.code !== 11000) throw error
    }

    let generated
    session = await mongoose.startSession()
    await session.withTransaction(async () => {
      const repeated = await ReferralCode.findOne({ generatedBy, requestId }).session(session).lean()
      if (repeated) {
        generated = repeated
        return
      }

      const limit = await ReferralCodeDailyLimit.findOneAndUpdate(
        { generatedBy, dayStart, count: { $lt: dailyGenerationLimit } },
        { $inc: { count: 1 } },
        { new: true, session },
      )
      if (!limit) {
        throw createRequestError(429, 'You have reached the daily limit of 5 referral codes. Try again after 00:00 UTC.')
      }

      const code = `LMS-${randomBytes(16).toString('hex').toUpperCase()}`
      const [created] = await ReferralCode.create(
        [{
          code,
          generatedBy,
          requestId,
          createdAt: now,
          expiresAt: new Date(now.getTime() + codeLifetimeMs),
          status: 'active',
        }],
        { session },
      )
      generated = created.toObject()
    })

    return res.status(201).json({ code: serializeCode(generated), repeated: false })
  } catch (error) {
    if (error?.statusCode === 429) {
      return res.status(429).json({ message: error.message, dailyLimit: dailyGenerationLimit })
    }
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'This generation request has already been processed.' })
    }
    return next(error)
  } finally {
    if (session) await session.endSession()
  }
})

export { dailyGenerationLimit, getUtcDayStart, registrationStatusForAccount }
export default router
