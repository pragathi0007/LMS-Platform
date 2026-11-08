import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'

process.env.JWT_SECRET = 'test-only-referral-secret'

const [
  { default: authRouter, createReferralRedemptionFilter },
  { default: referralsRouter, dailyGenerationLimit, getUtcDayStart },
  { default: ReferralCode },
  { default: ReferralCodeDailyLimit },
  { default: Notification },
  { Student, CollegeStudent, Admin, CollegeAdmin },
  { default: AccountIdentity },
] = await Promise.all([
  import('../routes/auth.js'),
  import('../routes/referrals.js'),
  import('../models/ReferralCode.js'),
  import('../models/ReferralCodeDailyLimit.js'),
  import('../models/Notification.js'),
  import('../models/account-models.js'),
  import('../models/AccountIdentity.js'),
])

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)
app.use('/api/referrals', referralsRouter)
const server = app.listen(0)
await new Promise((resolve) => server.once('listening', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}/api`

const originalDate = globalThis.Date
let currentTime = originalDate.parse('2026-11-08T23:59:59.000Z')
class ControlledDate extends originalDate {
  constructor(...args) {
    super(...(args.length ? args : [currentTime]))
  }

  static now() {
    return currentTime
  }
}

const ownerId = new mongoose.Types.ObjectId()
const secondOwnerId = new mongoose.Types.ObjectId()
const collegeStudentId = new mongoose.Types.ObjectId()
const students = new Map([
  [String(ownerId), {
    _id: ownerId,
    role: 'student',
    studentType: 'independent',
    status: 'active',
    isActive: true,
  }],
  [String(secondOwnerId), {
    _id: secondOwnerId,
    role: 'student',
    studentType: 'independent',
    status: 'active',
    isActive: true,
  }],
])
const collegeStudents = new Map([
  [String(collegeStudentId), {
    _id: collegeStudentId,
    role: 'student',
    studentType: 'college',
    status: 'active',
    isActive: true,
  }],
])
const referralCodes = []
const dailyLimits = []
const savedAccounts = []
const savedIdentities = []

function valueMatches(actual, expected) {
  if (expected && typeof expected === 'object' && !(expected instanceof Date) && !mongoose.isValidObjectId(expected)) {
    if ('$gt' in expected && !(actual > expected.$gt)) return false
    if ('$gte' in expected && !(actual >= expected.$gte)) return false
    if ('$lt' in expected && !(actual < expected.$lt)) return false
    if ('$lte' in expected && !(actual <= expected.$lte)) return false
    if ('$ne' in expected && String(actual) === String(expected.$ne)) return false
    if ('$in' in expected && !expected.$in.some((item) => String(item) === String(actual))) return false
    return true
  }
  if (expected === null) return actual == null
  if (actual instanceof originalDate && expected instanceof originalDate) {
    return actual.getTime() === expected.getTime()
  }
  return String(actual) === String(expected)
}

function matches(document, filter) {
  return Object.entries(filter).every(([key, expected]) => valueMatches(document[key], expected))
}

function queryResult(getValue) {
  let sortSpec = null
  const query = {
    select() { return this },
    lean() { return this },
    session() { return this },
    sort(value) { sortSpec = value; return this },
    then(resolve, reject) {
      let value
      try {
        value = getValue()
        if (sortSpec && Array.isArray(value)) {
          const [[field, direction]] = Object.entries(sortSpec)
          value.sort((left, right) => (left[field] - right[field]) * direction)
        }
      } catch (error) {
        return Promise.reject(error).then(resolve, reject)
      }
      return Promise.resolve(value).then(resolve, reject)
    },
  }
  return query
}

const originals = []
function stub(target, name, implementation) {
  const original = target[name]
  target[name] = implementation
  originals.push(() => { target[name] = original })
}

const originalDb = mongoose.connection.db
mongoose.connection.db = {
  collection: () => ({ find: () => ({ toArray: async () => [] }) }),
}

stub(Student, 'findById', async (id) => students.get(String(id)) || null)
stub(Student, 'find', (filter) => queryResult(() => [...students.values()].filter((student) => matches(student, filter))))
stub(CollegeStudent, 'findById', async (id) => collegeStudents.get(String(id)) || null)
stub(ReferralCode, 'findOne', (filter) => queryResult(() => referralCodes.find((code) => matches(code, filter)) || null))
stub(ReferralCode, 'find', (filter) => queryResult(() => referralCodes.filter((code) => matches(code, filter))))
stub(ReferralCode, 'countDocuments', async (filter) => referralCodes.filter((code) => matches(code, filter)).length)
stub(ReferralCode, 'create', async (documents) => documents.map((document) => {
  const saved = { _id: new mongoose.Types.ObjectId(), usedBy: null, usedAt: null, registrationStatus: null, ...document }
  saved.toObject = () => ({ ...saved, toObject: undefined })
  referralCodes.push(saved)
  return saved
}))
stub(ReferralCode, 'findOneAndUpdate', (filter, update) => queryResult(() => {
  const document = referralCodes.find((code) => matches(code, filter))
  if (!document) return null
  Object.assign(document, update.$set || {})
  return document
}))
stub(ReferralCode, 'updateMany', async (filter, update) => {
  const documents = referralCodes.filter((code) => matches(code, filter))
  for (const document of documents) Object.assign(document, update.$set || {})
  return { modifiedCount: documents.length }
})
stub(ReferralCode, 'updateOne', async (filter, update) => {
  const document = referralCodes.find((code) => matches(code, filter))
  if (!document) return { matchedCount: 0 }
  Object.assign(document, update.$set || {})
  return { matchedCount: 1 }
})
stub(ReferralCodeDailyLimit, 'updateOne', async (filter, update) => {
  let document = dailyLimits.find((limit) => matches(limit, filter))
  if (!document && update.$setOnInsert) {
    document = { ...update.$setOnInsert }
    dailyLimits.push(document)
  }
  return { matchedCount: document ? 1 : 0 }
})
stub(ReferralCodeDailyLimit, 'findOneAndUpdate', (filter, update) => queryResult(() => {
  const document = dailyLimits.find((limit) => matches(limit, filter))
  if (!document) return null
  for (const [field, amount] of Object.entries(update.$inc || {})) document[field] += amount
  return document
}))
stub(AccountIdentity, 'find', () => queryResult(() => []))
stub(AccountIdentity, 'findOne', () => queryResult(() => null))
stub(AccountIdentity, 'create', async (documents) => {
  savedIdentities.push(...documents)
  return documents
})
stub(Student, 'findOne', () => queryResult(() => null))
stub(Student, 'create', async (documents) => {
  savedAccounts.push(...documents)
  for (const account of documents) students.set(String(account._id), account)
  return documents
})
stub(Notification, 'create', async (documents) => documents)
stub(Admin, 'findOne', () => queryResult(() => null))
stub(CollegeAdmin, 'findOne', () => queryResult(() => null))
stub(CollegeStudent, 'findOne', () => queryResult(() => null))
stub(mongoose, 'startSession', async () => ({
  withTransaction: async (callback) => callback(),
  endSession: async () => {},
}))

function tokenFor(id, role = 'student', accountCollection = 'students') {
  return jwt.sign({ role, accountCollection }, process.env.JWT_SECRET, { subject: String(id), expiresIn: '20d' })
}

async function request(path, { method, token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { response, result: await response.json() }
}

after(async () => {
  globalThis.Date = originalDate
  mongoose.connection.db = originalDb
  for (const restore of originals.reverse()) restore()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test('referral generation limits, UTC reset, redemption, history, and privacy', async () => {
  globalThis.Date = ControlledDate
  const ownerToken = tokenFor(ownerId)
  const secondOwnerToken = tokenFor(secondOwnerId)
  const collegeToken = tokenFor(collegeStudentId, 'student', 'clg_students')

  assert.equal(ReferralCode.collection.name, 'referralCodes')
  assert.ok(ReferralCode.schema.indexes().some(([keys, options]) => keys.code === 1 && options.unique))
  assert.ok(ReferralCode.schema.indexes().some(([keys]) => keys.generatedBy === 1 && keys.createdAt === -1))
  assert.ok(ReferralCode.schema.indexes().some(([keys]) => keys.expiresAt === 1))
  assert.ok(ReferralCode.schema.indexes().some(([keys, options]) =>
    keys.generatedBy === 1 && keys.requestId === 1 && options.unique,
  ))
  assert.ok(!ReferralCode.schema.indexes().some(([, options]) => options.expireAfterSeconds !== undefined))
  assert.equal(ReferralCodeDailyLimit.collection.name, 'referralCodeDailyLimits')
  assert.ok(ReferralCodeDailyLimit.schema.indexes().some(([keys, options]) =>
    keys.generatedBy === 1 && keys.dayStart === 1 && options.unique,
  ))
  assert.equal(dailyGenerationLimit, 5)
  assert.equal(
    getUtcDayStart(new originalDate('2026-11-08T23:59:59.999Z')).toISOString(),
    '2026-11-08T00:00:00.000Z',
  )

  const generated = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    request('/referrals/generate', {
      token: ownerToken,
      body: { requestId: `request-owner-${String(index).padStart(3, '0')}` },
    }),
  ))
  const successful = generated.filter(({ response }) => response.status === 201)
  assert.equal(successful.length, 5)
  assert.equal(generated.filter(({ response }) => response.status === 429).length, 1)
  const codes = successful.map(({ result }) => result.code)
  assert.equal(new Set(codes.map(({ code }) => code)).size, 5)
  assert.ok(codes.every(({ code }) => /^LMS-[A-F0-9]{32}$/.test(code)))
  assert.equal(
    new originalDate(codes[0].expiresAt).getTime() - new originalDate(codes[0].createdAt).getTime(),
    15 * 24 * 60 * 60 * 1000,
  )

  const firstSuccessfulIndex = generated.findIndex(({ response }) => response.status === 201)
  const repeated = await request('/referrals/generate', {
    token: ownerToken,
    body: { requestId: `request-owner-${String(firstSuccessfulIndex).padStart(3, '0')}` },
  })
  assert.equal(repeated.response.status, 200)
  assert.equal(repeated.result.repeated, true)
  assert.equal(referralCodes.filter((code) => String(code.generatedBy) === String(ownerId)).length, 5)

  const unauthenticated = await request('/referrals/me')
  assert.equal(unauthenticated.response.status, 401)
  const collegeDenied = await request('/referrals/me', { token: collegeToken })
  assert.equal(collegeDenied.response.status, 403)

  const midnightCode = await request('/referrals/generate', {
    token: ownerToken,
    body: { requestId: 'request-next-day-0001' },
  })
  assert.equal(midnightCode.response.status, 429)
  currentTime = originalDate.parse('2026-11-09T00:00:00.000Z')
  const afterReset = await request('/referrals/generate', {
    token: ownerToken,
    body: { requestId: 'request-next-day-0001' },
  })
  assert.equal(afterReset.response.status, 201)
  const resetStats = await request('/referrals/me', { token: ownerToken })
  assert.equal(resetStats.result.stats.generatedToday, 1)

  const codeToRedeem = codes[0].code
  const validation = await request('/referrals/validate', { body: { code: codeToRedeem.toLowerCase() } })
  assert.equal(validation.response.status, 200)
  assert.equal(validation.result.valid, true)

  const ownerRedemptionFilter = createReferralRedemptionFilter(
    codeToRedeem,
    ownerId,
    new ControlledDate(),
  )
  assert.equal(matches(referralCodes.find((code) => code.code === codeToRedeem), ownerRedemptionFilter), false)

  const registration = await request('/auth/register', {
    body: {
      fullName: 'Referred Friend',
      email: 'referred-friend@example.invalid',
      username: 'referred-friend',
      password: 'a-strong-password',
      confirmPassword: 'a-strong-password',
      role: 'student',
      accountType: 'independent',
      referralCode: codeToRedeem,
    },
  })
  assert.equal(registration.response.status, 201)
  const registeredAccountId = registration.result.user.id
  const redeemedDocument = referralCodes.find((code) => code.code === codeToRedeem)
  assert.equal(String(redeemedDocument.usedBy), registeredAccountId)
  assert.equal(redeemedDocument.status, 'used')
  assert.ok(redeemedDocument.usedAt instanceof originalDate)
  assert.equal(redeemedDocument.registrationStatus, 'awaiting_approval')

  const repeatedValidation = await request('/referrals/validate', { body: { code: codeToRedeem } })
  assert.equal(repeatedValidation.response.status, 400)
  const secondRedemption = await request('/auth/register', {
    body: {
      fullName: 'Another Friend',
      email: 'another-friend@example.invalid',
      username: 'another-friend',
      password: 'a-strong-password',
      confirmPassword: 'a-strong-password',
      role: 'student',
      accountType: 'independent',
      referralCode: codeToRedeem,
    },
  })
  assert.equal(secondRedemption.response.status, 400)

  const referredAccount = students.get(registeredAccountId)
  referredAccount.status = 'pending'
  referredAccount.approvalStatus = 'pending'
  let history = await request('/referrals/me', { token: ownerToken })
  const usedEntry = history.result.codes.find((entry) => entry.code === codeToRedeem)
  assert.equal(usedEntry.registrationStatus, 'awaiting_approval')
  referredAccount.status = 'active'
  referredAccount.approvalStatus = 'approved'
  history = await request('/referrals/me', { token: ownerToken })
  assert.equal(history.result.codes.find((entry) => entry.code === codeToRedeem).registrationStatus, 'approved')
  referredAccount.status = 'rejected'
  referredAccount.approvalStatus = 'rejected'
  history = await request('/referrals/me', { token: ownerToken })
  assert.equal(history.result.codes.find((entry) => entry.code === codeToRedeem).registrationStatus, 'rejected')

  const activeCodeToExpire = referralCodes.find((code) => code.code === codes[1].code)
  activeCodeToExpire.expiresAt = new ControlledDate(currentTime - 1)
  history = await request('/referrals/me', { token: ownerToken })
  assert.equal(history.result.codes.find((entry) => entry.code === codes[1].code).status, 'expired')
  const expiredValidation = await request('/referrals/validate', { body: { code: codes[1].code } })
  assert.equal(expiredValidation.response.status, 400)
  assert.ok(history.result.codes.some((entry) => entry.code === codeToRedeem && entry.status === 'used'))
  assert.equal(referralCodes.find((code) => code.code === codes[1].code).status, 'expired')
  assert.equal(history.result.codes.some((entry) => 'usedBy' in entry), false)

  const ownerHistory = await request('/referrals/me?userId=' + secondOwnerId, { token: ownerToken })
  assert.equal(ownerHistory.result.codes.length, 6)
  const ownerCodes = new Set(referralCodes
    .filter((entry) => String(entry.generatedBy) === String(ownerId))
    .map((entry) => entry.code))
  assert.ok(ownerHistory.result.codes.every((entry) => ownerCodes.has(entry.code)))
  const secondOwnerCode = await request('/referrals/generate', {
    token: secondOwnerToken,
    body: { requestId: 'second-owner-request-01' },
  })
  assert.equal(secondOwnerCode.response.status, 201)
  const privateHistory = await request('/referrals/me', { token: ownerToken })
  assert.equal(privateHistory.result.codes.some((entry) => entry.code === secondOwnerCode.result.code.code), false)
})
