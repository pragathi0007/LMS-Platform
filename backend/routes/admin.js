import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import AccountIdentity from '../models/AccountIdentity.js'
import College from '../models/College.js'
import Course from '../models/Course.js'
import Enrollment from '../models/Enrollment.js'
import {
  CollegeAdmin,
  CollegeStudent,
  Student,
  accountModelsByCollection,
} from '../models/account-models.js'
import { authenticate, requireRoles } from '../middleware/auth.js'
import { normalizeCourseDetails } from '../utils/course-validation.js'
import { sendCollegeAdminActivationEmail } from '../utils/email.js'
import { parseStudentCsv } from '../utils/student-csv.js'

const router = Router()
const requireAdmin = [authenticate, requireRoles('main_admin')]
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/
const activationLifetimeMs = 24 * 60 * 60 * 1000

async function accountIdentifierExists(field, value) {
  const identity = await AccountIdentity.exists({ [field]: value })
  if (identity) return true
  for (const AccountModel of Object.values(accountModelsByCollection)) {
    if (await AccountModel.exists({ [field]: value })) return true
  }
  return false
}

function makeImportUsername(studentId) {
  const digest = createHash('sha256').update(studentId.toLowerCase()).digest('hex').slice(0, 20)
  return `college-${digest}`
}

router.get('/colleges', ...requireAdmin, async (req, res, next) => {
  try {
    const colleges = await College.find({ status: { $in: [null, 'active'] } })
      .select('name code collegeName title address city state country contactName contactPhone contactEmail status')
      .sort({ name: 1 })
      .limit(500)
      .lean()
    return res.json({
      colleges: colleges.map((college) => ({
        id: String(college._id),
        name: college.name || college.collegeName || college.title || 'Unnamed college',
        code: college.code,
        address: college.address,
        city: college.city,
        state: college.state,
        country: college.country,
        contactName: college.contactName,
        contactPhone: college.contactPhone,
        contactEmail: college.contactEmail,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/colleges', ...requireAdmin, async (req, res, next) => {
  try {
    const { name, code, address, city, state, country, contactName, contactPhone, contactEmail } = req.body ?? {}
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
      return res.status(400).json({ message: 'Enter a college name of up to 200 characters.' })
    }
    if (typeof code !== 'string' || !/^[a-zA-Z0-9-]{2,40}$/.test(code.trim())) {
      return res.status(400).json({ message: 'Enter a college code with 2–40 letters, numbers, or hyphens.' })
    }
    for (const [field, value, maxLength] of [
      ['address', address, 500],
      ['city', city, 120],
      ['state', state, 120],
      ['country', country, 120],
      ['contactName', contactName, 120],
      ['contactPhone', contactPhone, 40],
    ]) {
      if (value !== undefined && (typeof value !== 'string' || value.length > maxLength)) {
        return res.status(400).json({ message: `College ${field} must be ${maxLength} characters or fewer.` })
      }
    }
    if (contactEmail !== undefined && contactEmail !== '' &&
      (typeof contactEmail !== 'string' || contactEmail.length > 254 || !emailPattern.test(contactEmail.trim()))) {
      return res.status(400).json({ message: 'Enter a valid college contact email.' })
    }

    const college = await College.create({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      address: typeof address === 'string' ? address.trim() : '',
      city: typeof city === 'string' ? city.trim() : '',
      state: typeof state === 'string' ? state.trim() : '',
      country: typeof country === 'string' ? country.trim() : '',
      contactName: typeof contactName === 'string' ? contactName.trim() : '',
      contactPhone: typeof contactPhone === 'string' ? contactPhone.trim() : '',
      contactEmail: typeof contactEmail === 'string' ? contactEmail.trim().toLowerCase() : '',
    })
    return res.status(201).json({
      message: 'College created successfully.',
      college: { id: String(college._id), name: college.name },
    })
  } catch (error) {
    return next(error)
  }
})

function createActivationToken() {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + activationLifetimeMs),
  }
}

async function deliverActivationEmail(account, token, res, isNewAccount = false) {
  try {
    await sendCollegeAdminActivationEmail({
      email: account.email,
      fullName: account.fullName,
      token,
    })
    return res.status(isNewAccount ? 201 : 200).json({
      message: 'College sub-admin created and activation email sent.',
      account: { id: String(account._id), email: account.email, collegeId: String(account.collegeId) },
      activationEmailSent: true,
    })
  } catch (error) {
    console.error(JSON.stringify({
      event: 'college_admin.activation_email_failed',
      accountId: String(account._id),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: typeof error?.code === 'string' ? error.code : undefined,
    }))
    return res.status(503).json({
      message: 'The account was created, but the activation email could not be sent. Configure SMTP and retry activation.',
      accountId: String(account._id),
      activationEmailSent: false,
    })
  }
}

router.post('/colleges/:collegeId/sub-admins', ...requireAdmin, async (req, res, next) => {
  try {
    const { collegeId } = req.params
    const { fullName, email, username } = req.body ?? {}
    if (!mongoose.isValidObjectId(collegeId)) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 120) {
      return res.status(400).json({ message: 'Enter a sub-admin name of up to 120 characters.' })
    }
    if (
      typeof email !== 'string' ||
      email.trim().length > 254 ||
      !emailPattern.test(email.trim())
    ) {
      return res.status(400).json({ message: 'Enter a valid sub-admin email address.' })
    }
    if (typeof username !== 'string' || !usernamePattern.test(username.trim())) {
      return res.status(400).json({ message: 'Use a username with 3–30 letters, numbers, dots, underscores, or hyphens.' })
    }

    const selectedCollegeId = new mongoose.Types.ObjectId(collegeId)
    if (!await College.exists({
      _id: selectedCollegeId,
      status: { $in: [null, 'active'] },
    })) {
      return res.status(404).json({ message: 'The selected college does not exist or is inactive.' })
    }
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()
    const [existingEmail, existingUsername] = await Promise.all([
      accountIdentifierExists('email', normalizedEmail),
      accountIdentifierExists('username', normalizedUsername),
    ])
    if (existingEmail) return res.status(409).json({ message: 'An account with this email already exists.' })
    if (existingUsername) return res.status(409).json({ message: 'This username is already taken.' })

    const accountId = new mongoose.Types.ObjectId()
    const { token, tokenHash, expiresAt } = createActivationToken()
    const session = await mongoose.startSession()
    let account
    try {
      await session.withTransaction(async () => {
        await AccountIdentity.create(
          [{
            email: normalizedEmail,
            username: normalizedUsername,
            accountCollection: CollegeAdmin.collection.name,
            accountId,
          }],
          { session },
        )
        ;[account] = await CollegeAdmin.create(
          [{
            _id: accountId,
            fullName: fullName.trim(),
            email: normalizedEmail,
            username: normalizedUsername,
            role: 'college_admin',
            collegeId: selectedCollegeId,
            status: 'invitation_pending',
            isActive: false,
            activationTokenHash: tokenHash,
            activationTokenExpiresAt: expiresAt,
          }],
          { session },
        )
      })
    } finally {
      await session.endSession()
    }
    return await deliverActivationEmail(account, token, res, true)
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'The email or username is already assigned to an LMS account.' })
    }
    return next(error)
  }
})

router.post('/college-admins/:id/activation', ...requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'The sub-admin account is invalid.' })
    }
    const account = await CollegeAdmin.findOne({
      _id: req.params.id,
      role: 'college_admin',
      status: 'invitation_pending',
    })
    if (!account) {
      return res.status(404).json({ message: 'A pending sub-admin account was not found.' })
    }

    const { token, tokenHash, expiresAt } = createActivationToken()
    account.activationTokenHash = tokenHash
    account.activationTokenExpiresAt = expiresAt
    await account.save()
    return await deliverActivationEmail(account, token, res)
  } catch (error) {
    return next(error)
  }
})

router.get('/courses', ...requireAdmin, async (req, res, next) => {
  try {
    const courses = await Course.find({})
      .select('title description modules assignments quizzes status createdAt +quizzes.questions.correctOptionIndex')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
    return res.json({ courses })
  } catch (error) {
    return next(error)
  }
})

router.post('/courses', ...requireAdmin, async (req, res, next) => {
  try {
    const result = normalizeCourseDetails(req.body)
    if (result.error) return res.status(400).json({ message: result.error })
    const course = await Course.create({ ...result.value, createdBy: req.auth.id })
    return res.status(201).json({ message: 'Course saved successfully.', course })
  } catch (error) {
    return next(error)
  }
})

router.get('/enrollments', ...requireAdmin, async (req, res, next) => {
  try {
    const enrollments = await Enrollment.find({})
      .populate('userId', 'fullName email username studentType collegeId')
      .populate('courseId', 'title')
      .populate('collegeId', 'name')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
    return res.json({ enrollments })
  } catch (error) {
    return next(error)
  }
})

router.post('/students/import', ...requireAdmin, async (req, res, next) => {
  try {
    const { csvText, collegeId } = req.body ?? {}
    if (typeof collegeId !== 'string' || !/^[a-f\d]{24}$/i.test(collegeId)) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    const selectedCollegeId = new mongoose.Types.ObjectId(collegeId)
    const college = await mongoose.connection.db.collection('colleges')
      .findOne({ _id: selectedCollegeId }, { projection: { _id: 1 } })
    if (!college) return res.status(400).json({ message: 'The selected college does not exist.' })

    let rows
    try {
      rows = parseStudentCsv(csvText)
    } catch (error) {
      return res.status(400).json({ message: error.message })
    }
    if (rows.length > 500) {
      return res.status(400).json({ message: 'Import is limited to 500 students per CSV.' })
    }

    const imported = []
    const failures = []
    const seenEmails = new Set()
    const seenStudentIds = new Set()
    const seenUsernames = new Set()

    for (const row of rows) {
      if (row.error) {
        failures.push({ row: row.rowNumber, email: '', studentId: '', reason: row.error })
        continue
      }

      const { fullName, studentId, email, department, batch } = row
      const normalizedStudentId = studentId.toLowerCase()
      const username = makeImportUsername(studentId)
      const errors = []
      if (!fullName || fullName.length > 120) errors.push('Full Name is required and must be 120 characters or fewer.')
      if (!studentId || studentId.length > 100) errors.push('Student ID is required and must be 100 characters or fewer.')
      if (!emailPattern.test(email) || email.length > 254) errors.push('Enter a valid email address.')
      if (!department || department.length > 120) errors.push('Department is required and must be 120 characters or fewer.')
      if (!batch || batch.length > 80) errors.push('Batch is required and must be 80 characters or fewer.')
      if (seenEmails.has(email)) errors.push('Email is duplicated in this CSV.')
      if (seenStudentIds.has(normalizedStudentId)) errors.push('Student ID is duplicated in this CSV.')
      if (seenUsernames.has(username)) errors.push('Generated username is duplicated in this CSV.')
      if (email) seenEmails.add(email)
      if (studentId) seenStudentIds.add(normalizedStudentId)
      seenUsernames.add(username)

      if (!errors.length) {
        const [existingEmail, existingStudentId, existingUsername] = await Promise.all([
          accountIdentifierExists('email', email),
          CollegeStudent.findOne({ studentId }).collation({ locale: 'en', strength: 2 }).select('_id').lean(),
          accountIdentifierExists('username', username),
        ])
        if (existingEmail) errors.push('Email already belongs to an LMS account.')
        if (existingStudentId) errors.push('Student ID already exists.')
        if (existingUsername) errors.push('Generated username conflicts with an LMS account.')
      }

      if (errors.length) {
        failures.push({ row: row.rowNumber, email, studentId, reason: errors.join(' ') })
        continue
      }

      try {
        const passwordHash = await bcrypt.hash(randomBytes(48).toString('base64url'), 12)
        const accountId = new mongoose.Types.ObjectId()
        const session = await mongoose.startSession()
        let student
        try {
          await session.withTransaction(async () => {
            await AccountIdentity.create(
              [{
                email,
                username,
                accountCollection: CollegeStudent.collection.name,
                accountId,
              }],
              { session },
            )
            ;[student] = await CollegeStudent.create(
              [{
                _id: accountId,
                fullName,
                studentId,
                email,
                username,
                department,
                batch,
                studentType: 'college',
                collegeId: selectedCollegeId,
                passwordHash,
                role: 'student',
                status: 'invitation_pending',
                isActive: false,
                permissions: [],
              }],
              { session },
            )
          })
        } finally {
          await session.endSession()
        }
        imported.push({ row: row.rowNumber, email: student.email, studentId: student.studentId })
      } catch (error) {
        if (error?.code === 11000) {
          failures.push({ row: row.rowNumber, email, studentId, reason: 'Email, username, or Student ID already exists.' })
          continue
        }
        throw error
      }
    }

    return res.status(200).json({
      message: 'College student import completed. No invitation emails were sent.',
      summary: { total: rows.length, imported: imported.length, failed: failures.length },
      imported,
      failures,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/overview', ...requireAdmin, async (req, res, next) => {
  try {
    const [
      totalIndependentStudents,
      totalCollegeStudents,
      totalCourses,
      totalEnrollments,
      recentIndependentStudents,
      recentCollegeStudents,
    ] =
      await Promise.all([
        Student.countDocuments({ role: 'student' }),
        CollegeStudent.countDocuments({ role: 'student' }),
        Course.countDocuments(),
        Enrollment.countDocuments(),
        Student.find({ role: 'student' })
          .select('fullName username email role status studentType createdAt')
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
        CollegeStudent.find({ role: 'student' })
          .select('fullName username email role status studentType collegeId createdAt')
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
      ])
    const recentRegistrations = [...recentIndependentStudents, ...recentCollegeStudents]
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, 20)

    return res.json({
      stats: {
        totalStudents: totalIndependentStudents + totalCollegeStudents,
        totalCourses,
        totalEnrollments,
      },
      recentRegistrations,
      dataAvailability: {
        courses: true,
        enrollmentActivity: Boolean(await Enrollment.exists({})),
        courseCompletion: false,
      },
    })
  } catch (error) {
    return next(error)
  }
})

export default router
