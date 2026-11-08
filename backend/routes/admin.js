import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import mongoose from 'mongoose'
import AccountIdentity from '../models/AccountIdentity.js'
import Notification from '../models/Notification.js'
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
import {
  emailNotificationsConfigured,
  sendCollegeAdminActivationEmail,
  sendIndependentStudentDecisionEmail,
} from '../utils/email.js'
import { parseStudentCsv } from '../utils/student-csv.js'

const router = Router()
const requireAdmin = [authenticate, requireRoles('main_admin')]
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/
const activationLifetimeMs = 24 * 60 * 60 * 1000
const reportPageSize = 200
const approvalStatuses = new Set(['pending', 'approved', 'rejected', 'all'])

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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

router.get('/independent-student-approvals', ...requireAdmin, async (req, res, next) => {
  try {
    const status = req.query.status ?? 'pending'
    const page = Number.parseInt(req.query.page ?? '1', 10)
    const pageSize = Number.parseInt(req.query.pageSize ?? '25', 10)
    if (typeof status !== 'string' || !approvalStatuses.has(status)) {
      return res.status(400).json({ message: 'Select a valid approval status.' })
    }
    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      return res.status(400).json({ message: 'Select a valid application page.' })
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ message: 'Application page size must be between 1 and 100.' })
    }

    const statusFilter = (selectedStatus) => {
      if (selectedStatus === 'pending') {
        return { $or: [{ approvalStatus: 'pending' }, { approvalStatus: { $exists: false }, status: 'pending' }] }
      }
      if (selectedStatus === 'rejected') {
        return { $or: [{ approvalStatus: 'rejected' }, { approvalStatus: { $exists: false }, status: 'rejected' }] }
      }
      return {
        $or: [
          { approvalStatus: 'approved' },
          { approvalStatus: { $exists: false }, status: 'active' },
        ],
      }
    }
    const query = { role: 'student', studentType: 'independent' }
    if (status !== 'all') Object.assign(query, statusFilter(status))
    const [students, total, pendingCount] = await Promise.all([
      Student.find(query)
        .select('fullName email username studentId createdAt studentType status approvalStatus rejectionReason')
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      Student.countDocuments(query),
      Student.countDocuments({
        role: 'student',
        studentType: 'independent',
        ...statusFilter('pending'),
      }),
    ])
    return res.json({
      students: students.map((student) => ({
        ...student,
        _id: String(student._id),
        approvalStatus: student.approvalStatus || (student.status === 'active' ? 'approved' : student.status),
        studentType: 'independent',
      })),
      total,
      page,
      pageSize,
      pendingCount,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/independent-students/:studentId/approval-details', ...requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ message: 'Select a valid independent student.' })
    }
    const student = await Student.findOne({
      _id: req.params.studentId,
      role: 'student',
      studentType: 'independent',
    })
      .select('fullName email username studentId createdAt studentType status approvalStatus rejectionReason')
      .lean()
    if (!student) return res.status(404).json({ message: 'The independent student was not found.' })

    return res.json({
      student: {
        ...student,
        _id: String(student._id),
        studentType: 'independent',
        approvalStatus: student.approvalStatus || (student.status === 'active' ? 'approved' : student.status),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.patch('/independent-students/:studentId/approval', ...requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.studentId)) {
      return res.status(400).json({ message: 'Select a valid independent student.' })
    }
    const { decision, reason } = req.body ?? {}
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ message: 'Select approve or reject.' })
    }
    if (decision === 'reject' && reason !== undefined &&
      (typeof reason !== 'string' || reason.trim().length > 1000)) {
      return res.status(400).json({ message: 'The rejection reason must be 1,000 characters or fewer.' })
    }

    const studentId = new mongoose.Types.ObjectId(req.params.studentId)
    const session = await mongoose.startSession()
    let student
    try {
      await session.withTransaction(async () => {
        student = await Student.findOneAndUpdate(
          {
            _id: studentId,
            role: 'student',
            studentType: 'independent',
            $or: [
              { approvalStatus: 'pending' },
              { approvalStatus: { $exists: false }, status: 'pending' },
            ],
          },
          decision === 'approve'
            ? {
                $set: {
                  approvalStatus: 'approved',
                  status: 'active',
                  isActive: true,
                  approvedAt: new Date(),
                  approvedBy: req.auth.id,
                },
                $unset: { rejectionReason: '', rejectedAt: '', rejectedBy: '' },
              }
            : {
                $set: {
                  approvalStatus: 'rejected',
                  status: 'rejected',
                  isActive: false,
                  rejectedAt: new Date(),
                  rejectedBy: req.auth.id,
                  rejectionReason: typeof reason === 'string' ? reason.trim() : '',
                },
                $unset: { approvedAt: '', approvedBy: '' },
              },
          { new: true, runValidators: true, session },
        ).lean()
        if (!student) {
          const exists = await Student.exists({
            _id: studentId,
            role: 'student',
            studentType: 'independent',
          }).session(session)
          const error = new Error(
            exists ? 'This application has already been reviewed.' : 'The independent student was not found.',
          )
          error.statusCode = exists ? 409 : 404
          throw error
        }

        const approved = decision === 'approve'
        await Notification.create(
          [{
            recipientRole: 'student',
            recipientId: studentId,
            type: approved ? 'independent_student_approved' : 'independent_student_rejected',
            title: approved ? 'Account approved' : 'Account application rejected',
            message: approved
              ? 'Your independent student account has been approved. You can now log in.'
              : typeof reason === 'string' && reason.trim()
                ? `Your independent student application was rejected. Reason: ${reason.trim()}`
                : 'Your independent student application was rejected.',
            link: '/student/dashboard',
            metadata: { approvalStatus: approved ? 'approved' : 'rejected' },
          }],
          { session },
        )
      })
    } finally {
      await session.endSession()
    }

    let message = decision === 'approve'
      ? 'The independent student was approved.'
      : 'The independent student application was rejected.'
    if (emailNotificationsConfigured()) {
      try {
        await sendIndependentStudentDecisionEmail({
          email: student.email,
          fullName: student.fullName,
          approved: decision === 'approve',
          reason: student.rejectionReason,
        })
      } catch (emailError) {
        console.error(JSON.stringify({
          event: 'notification.student_email.failed',
          type: decision === 'approve' ? 'approved' : 'rejected',
          errorName: emailError instanceof Error ? emailError.name : 'UnknownError',
          errorCode: typeof emailError?.code === 'string' ? emailError.code : undefined,
        }))
        message += ' The decision was saved, but the email notification could not be sent.'
      }
    }

    return res.json({
      message,
      student: {
        id: String(student._id),
        approvalStatus: student.approvalStatus,
        status: student.status,
        rejectionReason: student.rejectionReason,
      },
    })
  } catch (error) {
    if ([404, 409].includes(error?.statusCode)) {
      return res.status(error.statusCode).json({ message: error.message })
    }
    return next(error)
  }
})

router.get('/students', ...requireAdmin, async (req, res, next) => {
  try {
    const page = Number.parseInt(req.query.page ?? '1', 10)
    const pageSize = Number.parseInt(req.query.pageSize ?? '25', 10)
    const tab = req.query.tab ?? 'all'
    const filterType = req.query.filterType ?? 'all'
    const approvalStatus = req.query.approvalStatus ?? 'all'
    const collegeId = req.query.collegeId
    const search = req.query.search
    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      return res.status(400).json({ message: 'Select a valid student page.' })
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ message: 'Student page size must be between 1 and 100.' })
    }
    if (!['all', 'independent', 'college'].includes(tab)) {
      return res.status(400).json({ message: 'Select a valid student category.' })
    }
    if (!['all', 'independent', 'college'].includes(filterType)) {
      return res.status(400).json({ message: 'Select a valid student filter.' })
    }
    if (typeof approvalStatus !== 'string' || !approvalStatuses.has(approvalStatus)) {
      return res.status(400).json({ message: 'Select a valid approval status.' })
    }
    if (collegeId !== undefined &&
      (typeof collegeId !== 'string' || !/^[a-f\d]{24}$/i.test(collegeId))) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    if (search !== undefined && (typeof search !== 'string' || search.length > 200)) {
      return res.status(400).json({ message: 'Student search must be 200 characters or fewer.' })
    }

    const sharedProjection = {
      fullName: 1,
      username: 1,
      email: 1,
      role: 1,
      status: 1,
      createdAt: 1,
      department: 1,
      batch: 1,
      approvalStatus: 1,
    }
    const match = {}
    const selectedTypes = [...new Set([tab, filterType].filter((value) => value !== 'all'))]
    if (selectedTypes.length > 1) {
      match.studentType = { $in: [] }
    } else if (selectedTypes.length === 1) {
      match.studentType = selectedTypes[0]
    }
    if (collegeId) match.collegeId = new mongoose.Types.ObjectId(collegeId)
    if (approvalStatus !== 'all') {
      const approvalCondition = approvalStatus === 'pending'
        ? { $or: [{ approvalStatus: 'pending' }, { approvalStatus: { $exists: false }, status: 'pending' }] }
        : approvalStatus === 'rejected'
          ? { $or: [{ approvalStatus: 'rejected' }, { approvalStatus: { $exists: false }, status: 'rejected' }] }
          : {
              $or: [
                { approvalStatus: 'approved' },
                { approvalStatus: { $exists: false }, status: 'active' },
              ],
            }
      match.$and = [{ studentType: 'independent' }, approvalCondition]
    }
    const normalizedSearch = search?.trim()
    if (normalizedSearch) {
      const expression = new RegExp(escapeRegex(normalizedSearch), 'i')
      const searchCondition = { $or: [
        { fullName: expression },
        { username: expression },
        { email: expression },
        { studentId: expression },
      ] }
      if (match.$and) match.$and.push(searchCondition)
      else match.$or = searchCondition.$or
    }

    const [result] = await Student.aggregate([
      { $match: { role: 'student' } },
      {
        $project: {
          ...sharedProjection,
          studentId: 1,
          studentType: { $literal: 'independent' },
          collegeId: { $literal: null },
          approvalStatus: {
            $ifNull: ['$approvalStatus', { $cond: [{ $eq: ['$status', 'active'] }, 'approved', '$status'] }],
          },
        },
      },
      {
        $unionWith: {
          coll: CollegeStudent.collection.name,
          pipeline: [
            { $match: { role: 'student' } },
            {
              $project: {
                ...sharedProjection,
                studentId: 1,
                studentType: { $literal: 'college' },
                collegeId: 1,
                approvalStatus: { $literal: null },
              },
            },
          ],
        },
      },
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      {
        $lookup: {
          from: College.collection.name,
          localField: 'collegeId',
          foreignField: '_id',
          as: 'college',
        },
      },
      { $unwind: { path: '$college', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          ...sharedProjection,
          studentId: 1,
          studentType: 1,
          collegeId: 1,
          collegeName: '$college.name',
        },
      },
      {
        $facet: {
          students: [
            { $sort: { createdAt: -1, _id: 1 } },
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ])
    const students = result?.students ?? []
    return res.json({
      students,
      total: result?.total?.[0]?.count ?? 0,
      page,
      pageSize,
    })
  } catch (error) {
    return next(error)
  }
})

router.patch('/students/:studentId', ...requireAdmin, async (req, res, next) => {
  try {
    const { studentId } = req.params
    const { studentType } = req.query
    const { fullName, email, username } = req.body ?? {}
    if (!mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ message: 'Select a valid student.' })
    }
    if (!['independent', 'college'].includes(studentType)) {
      return res.status(400).json({ message: 'Select a valid student type.' })
    }
    if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 120) {
      return res.status(400).json({ message: 'Enter a student name between 1 and 120 characters.' })
    }
    if (typeof email !== 'string' || email.trim().length > 254 || !emailPattern.test(email.trim())) {
      return res.status(400).json({ message: 'Enter a valid email address.' })
    }
    if (typeof username !== 'string' || !usernamePattern.test(username.trim())) {
      return res.status(400).json({
        message: 'Use a username with 3–30 letters, numbers, dots, underscores, or hyphens.',
      })
    }

    const AccountModel = studentType === 'college' ? CollegeStudent : Student
    const accountCollection = AccountModel.collection.name
    const accountId = new mongoose.Types.ObjectId(studentId)
    const student = await AccountModel.findOne({ _id: accountId, role: 'student', studentType })
      .select('_id')
      .lean()
    if (!student) return res.status(404).json({ message: 'The student was not found.' })

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()
    const identifierExistsElsewhere = async (field, value) => {
      let identityQuery = AccountIdentity.findOne({ [field]: value, accountId: { $ne: accountId } })
      if (field === 'username') identityQuery = identityQuery.collation({ locale: 'en', strength: 2 })
      if (await identityQuery.select('_id').lean()) return true

      for (const Model of Object.values(accountModelsByCollection)) {
        const filter = { [field]: value }
        if (Model.collection.name === accountCollection) filter._id = { $ne: accountId }
        let accountQuery = Model.findOne(filter)
        if (field === 'username') accountQuery = accountQuery.collation({ locale: 'en', strength: 2 })
        if (await accountQuery.select('_id').lean()) return true
      }
      return false
    }
    const [emailTaken, usernameTaken] = await Promise.all([
      identifierExistsElsewhere('email', normalizedEmail),
      identifierExistsElsewhere('username', normalizedUsername),
    ])
    if (emailTaken) return res.status(409).json({ message: 'An account with this email already exists.' })
    if (usernameTaken) return res.status(409).json({ message: 'This username is already taken.' })

    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const currentIdentity = await AccountIdentity.findOne({
          accountCollection,
          accountId,
        }).session(session)
        if (currentIdentity) {
          currentIdentity.email = normalizedEmail
          currentIdentity.username = normalizedUsername
          await currentIdentity.save({ session })
        } else {
          await AccountIdentity.create([{
            email: normalizedEmail,
            username: normalizedUsername,
            accountCollection,
            accountId,
          }], { session })
        }
        const update = await AccountModel.updateOne(
          { _id: accountId, role: 'student', studentType },
          { $set: { fullName: fullName.trim(), email: normalizedEmail, username: normalizedUsername } },
          { session, runValidators: true },
        )
        if (!update.matchedCount) {
          const error = new Error('The student was not found.')
          error.statusCode = 404
          throw error
        }
      })
    } finally {
      await session.endSession()
    }

    return res.json({
      message: 'Student details updated successfully.',
      student: {
        id: studentId,
        fullName: fullName.trim(),
        email: normalizedEmail,
        username: normalizedUsername,
        studentType,
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
      return res.status(409).json({ message: 'An account with these details already exists.' })
    }
    if ([404, 409].includes(error?.statusCode)) {
      return res.status(error.statusCode).json({ message: error.message })
    }
    return next(error)
  }
})

router.patch('/students/bulk', ...requireAdmin, async (req, res, next) => {
  try {
    const { collegeId, studentIds, department, batch } = req.body ?? {}
    if (typeof collegeId !== 'string' || !mongoose.isValidObjectId(collegeId)) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    if (!Array.isArray(studentIds) || !studentIds.length || studentIds.length > 5000 ||
      studentIds.some((id) => !mongoose.isValidObjectId(id)) ||
      new Set(studentIds.map(String)).size !== studentIds.length) {
      return res.status(400).json({ message: 'Select between 1 and 5,000 unique students.' })
    }
    const update = {}
    if (department !== undefined) {
      if (typeof department !== 'string' || department.trim().length > 120) {
        return res.status(400).json({ message: 'Department must be 120 characters or fewer.' })
      }
      update.department = department.trim()
    }
    if (batch !== undefined) {
      if (typeof batch !== 'string' || batch.trim().length > 80) {
        return res.status(400).json({ message: 'Batch must be 80 characters or fewer.' })
      }
      update.batch = batch.trim()
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ message: 'Enter at least one field to update.' })
    }

    const selectedCollegeId = new mongoose.Types.ObjectId(collegeId)
    const selectedIds = studentIds.map((id) => new mongoose.Types.ObjectId(id))
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const eligible = await CollegeStudent.countDocuments({
          _id: { $in: selectedIds },
          collegeId: selectedCollegeId,
          studentType: 'college',
          role: 'student',
        }).session(session)
        if (eligible !== selectedIds.length) {
          const error = new Error('One or more selected students do not belong to this college.')
          error.statusCode = 409
          throw error
        }
        await CollegeStudent.updateMany(
          {
            _id: { $in: selectedIds },
            collegeId: selectedCollegeId,
            studentType: 'college',
            role: 'student',
          },
          { $set: update },
          { session, runValidators: true },
        )
      })
    } finally {
      await session.endSession()
    }
    return res.json({ message: `Updated ${selectedIds.length} college students.`, updated: selectedIds.length })
  } catch (error) {
    if (error?.statusCode === 409) return res.status(409).json({ message: error.message })
    return next(error)
  }
})

router.delete('/students/:studentId', ...requireAdmin, async (req, res, next) => {
  try {
    const { studentId } = req.params
    const { studentType } = req.query
    if (!mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ message: 'Select a valid student.' })
    }
    if (!['independent', 'college'].includes(studentType)) {
      return res.status(400).json({ message: 'Select a valid student type.' })
    }

    const AccountModel = studentType === 'college' ? CollegeStudent : Student
    const accountId = new mongoose.Types.ObjectId(studentId)
    const session = await mongoose.startSession()
    let student
    try {
      await session.withTransaction(async () => {
        student = await AccountModel.findOne({ _id: accountId, role: 'student', studentType })
          .select('_id approvalStatus status')
          .session(session)
          .lean()
        if (!student) {
          const error = new Error('The student was not found.')
          error.statusCode = 404
          throw error
        }
        if (studentType === 'independent' &&
          (student.approvalStatus === 'rejected' || student.status === 'rejected')) {
          const error = new Error('Rejected independent student accounts cannot be permanently deleted.')
          error.statusCode = 409
          throw error
        }
        await AccountIdentity.deleteOne({
          accountCollection: AccountModel.collection.name,
          accountId,
        }, { session })
        await Enrollment.deleteMany({ userId: accountId }, { session })
        await AccountModel.deleteOne({ _id: accountId, role: 'student', studentType }, { session })
      })
    } finally {
      await session.endSession()
    }
    if (!student) return res.status(404).json({ message: 'The student was not found.' })
    return res.json({
      message: 'Student, login identity, and enrollment records deleted.',
      student: { id: String(student._id) },
    })
  } catch (error) {
    if (error?.statusCode === 404) {
      return res.status(404).json({ message: error.message })
    }
    if (error?.statusCode === 409) {
      return res.status(409).json({ message: error.message })
    }
    return next(error)
  }
})

router.delete('/students/bulk', ...requireAdmin, async (req, res, next) => {
  try {
    const { collegeId, studentIds } = req.body ?? {}
    if (typeof collegeId !== 'string' || !mongoose.isValidObjectId(collegeId)) {
      return res.status(400).json({ message: 'Select a valid college.' })
    }
    if (!Array.isArray(studentIds) || !studentIds.length || studentIds.length > 5000 ||
      studentIds.some((id) => !mongoose.isValidObjectId(id)) ||
      new Set(studentIds.map(String)).size !== studentIds.length) {
      return res.status(400).json({ message: 'Select between 1 and 5,000 unique students.' })
    }
    const selectedCollegeId = new mongoose.Types.ObjectId(collegeId)
    const selectedIds = studentIds.map((id) => new mongoose.Types.ObjectId(id))
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const eligibleStudents = await CollegeStudent.find({
          _id: { $in: selectedIds },
          collegeId: selectedCollegeId,
          studentType: 'college',
          role: 'student',
        }).select('_id').session(session).lean()
        if (eligibleStudents.length !== selectedIds.length) {
          const error = new Error('One or more selected students do not belong to this college. No records were deleted.')
          error.statusCode = 409
          throw error
        }
        await AccountIdentity.deleteMany({
          accountCollection: CollegeStudent.collection.name,
          accountId: { $in: selectedIds },
        }, { session })
        await Enrollment.deleteMany({ userId: { $in: selectedIds } }, { session })
        await CollegeStudent.deleteMany({
          _id: { $in: selectedIds },
          collegeId: selectedCollegeId,
          studentType: 'college',
          role: 'student',
        }, { session })
      })
    } finally {
      await session.endSession()
    }
    return res.json({
      message: `Deleted ${selectedIds.length} college students, their login identities, and enrollment records.`,
      deleted: selectedIds.length,
    })
  } catch (error) {
    if (error?.statusCode === 409) return res.status(409).json({ message: error.message })
    return next(error)
  }
})

router.get('/students/:studentId/details', ...requireAdmin, async (req, res, next) => {
  try {
    const { studentId } = req.params
    const { studentType } = req.query
    if (!mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ message: 'Select a valid student.' })
    }
    if (!['independent', 'college'].includes(studentType)) {
      return res.status(400).json({ message: 'Select a valid student type.' })
    }

    const AccountModel = studentType === 'college' ? CollegeStudent : Student
    const studentQuery = AccountModel.findOne({
      _id: studentId,
      role: 'student',
      studentType,
    }).select('fullName username email studentType collegeId createdAt status')
    const student = await studentQuery.lean()
    if (!student) return res.status(404).json({ message: 'The student was not found.' })

    const [college, enrollmentRecords] = await Promise.all([
      studentType === 'college' ? College.findById(student.collegeId).select('name').lean() : null,
      Enrollment.find({ userId: student._id, status: { $ne: 'cancelled' } })
        .select('courseId assignedBy status')
        .sort({ createdAt: -1 })
        .lean(),
    ])

    const enrollmentByCourse = new Map()
    for (const enrollment of enrollmentRecords) {
      const courseId = String(enrollment.courseId)
      const existing = enrollmentByCourse.get(courseId)
      const isCompleted = enrollment.status === 'completed'
      const isAssigned = String(enrollment.assignedBy) !== String(student._id)
      if (!existing) {
        enrollmentByCourse.set(courseId, {
          courseId,
          status: enrollment.status,
          source: isAssigned ? 'assigned' : 'enrolled',
        })
        continue
      }
      if (isCompleted) existing.status = 'completed'
      if (isAssigned) existing.source = 'assigned'
    }

    const courseIds = [...enrollmentByCourse.keys()]
    const courses = courseIds.length
      ? await Course.find({ _id: { $in: courseIds } })
        .select('title status')
        .lean()
      : []
    const coursesById = new Map(courses.map((course) => [String(course._id), course]))
    const courseProgress = [...enrollmentByCourse.values()].map((enrollment) => {
      const course = coursesById.get(enrollment.courseId)
      return {
        courseId: enrollment.courseId,
        title: course?.title || 'Course unavailable',
        source: enrollment.source,
        status: enrollment.status,
        progressPercent: enrollment.status === 'completed' ? 100 : null,
      }
    })
    const assignedCourses = courseProgress.filter(({ source }) => source === 'assigned')
    const enrolledCourses = courseProgress.filter(({ source }) => source === 'enrolled')
    const completedCourses = courseProgress.filter(({ status }) => status === 'completed')
    const totalCourses = courseProgress.length

    return res.json({
      student: {
        id: String(student._id),
        fullName: student.fullName || '',
        username: student.username || '',
        email: student.email || '',
        studentType: student.studentType,
        collegeName: studentType === 'college' ? college?.name || '' : null,
        collegeId: studentType === 'college' ? String(student.collegeId) : null,
        createdAt: student.createdAt || null,
        status: student.status || 'unknown',
      },
      summary: {
        coursesAssigned: assignedCourses.length,
        coursesEnrolled: enrolledCourses.length,
        coursesCompleted: completedCourses.length,
        overallCompletionPercentage: totalCourses
          ? Math.round((completedCourses.length / totalCourses) * 100)
          : null,
      },
      courseProgress,
      quizResults: [],
      assignmentResults: [],
      certificates: [],
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/students', ...requireAdmin, async (req, res, next) => {
  try {
    const {
      fullName,
      email,
      username,
      password,
      studentType,
      studentId,
      collegeId,
    } = req.body ?? {}
    if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 120) {
      return res.status(400).json({ message: 'Enter a student name between 1 and 120 characters.' })
    }
    if (typeof email !== 'string' || email.trim().length > 254 || !emailPattern.test(email.trim())) {
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
    if (!['independent', 'college'].includes(studentType)) {
      return res.status(400).json({ message: 'Select Independent or College student type.' })
    }
    if (studentId !== undefined &&
      (typeof studentId !== 'string' || studentId.trim().length > 100)) {
      return res.status(400).json({ message: 'Student ID must be 100 characters or fewer.' })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()
    const normalizedStudentId = typeof studentId === 'string' ? studentId.trim() : ''
    let selectedCollegeId
    if (studentType === 'college') {
      if (!normalizedStudentId) {
        return res.status(400).json({ message: 'Enter a student ID for college students.' })
      }
      if (typeof collegeId !== 'string' || !/^[a-f\d]{24}$/i.test(collegeId)) {
        return res.status(400).json({ message: 'Select a valid college.' })
      }
      selectedCollegeId = new mongoose.Types.ObjectId(collegeId)
      const college = await College.findById(selectedCollegeId).select('_id').lean()
      if (!college) return res.status(400).json({ message: 'The selected college does not exist.' })
    } else if (collegeId !== undefined && collegeId !== '') {
      return res.status(400).json({ message: 'Independent students cannot be assigned a college.' })
    }

    const [existingEmail, existingUsername, existingStudentId] = await Promise.all([
      accountIdentifierExists('email', normalizedEmail),
      accountIdentifierExists('username', normalizedUsername),
      normalizedStudentId
        ? Promise.all([
          Student.findOne({ studentId: normalizedStudentId })
            .collation({ locale: 'en', strength: 2 }).select('_id').lean(),
          CollegeStudent.findOne({ studentId: normalizedStudentId })
            .collation({ locale: 'en', strength: 2 }).select('_id').lean(),
        ]).then((matches) => matches.some(Boolean))
        : false,
    ])
    if (existingEmail) return res.status(409).json({ message: 'An account with this email already exists.' })
    if (existingUsername) return res.status(409).json({ message: 'This username is already taken.' })
    if (existingStudentId) return res.status(409).json({ message: 'This student ID already exists.' })

    const AccountModel = studentType === 'college' ? CollegeStudent : Student
    const accountCollection = AccountModel.collection.name
    const accountId = new mongoose.Types.ObjectId()
    const passwordHash = await bcrypt.hash(password, 12)
    const session = await mongoose.startSession()
    let student
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
        if (normalizedStudentId) {
          const [independentMatch, collegeMatch] = await Promise.all([
            Student.findOne({ studentId: normalizedStudentId })
              .collation({ locale: 'en', strength: 2 }).select('_id').session(session).lean(),
            CollegeStudent.findOne({ studentId: normalizedStudentId })
              .collation({ locale: 'en', strength: 2 }).select('_id').session(session).lean(),
          ])
          if (independentMatch || collegeMatch) {
            const error = new Error('This student ID already exists.')
            error.statusCode = 409
            throw error
          }
        }

        await AccountIdentity.create(
          [{
            email: normalizedEmail,
            username: normalizedUsername,
            accountCollection,
            accountId,
          }],
          { session },
        )
        ;[student] = await AccountModel.create(
          [{
            _id: accountId,
            fullName: fullName.trim(),
            email: normalizedEmail,
            username: normalizedUsername,
            passwordHash,
            role: 'student',
            studentType,
            ...(normalizedStudentId ? { studentId: normalizedStudentId } : {}),
            ...(selectedCollegeId ? { collegeId: selectedCollegeId } : {}),
            status: studentType === 'independent' ? 'pending' : 'active',
            isActive: studentType !== 'independent',
            ...(studentType === 'independent' ? { approvalStatus: 'pending' } : {}),
            permissions: [],
          }],
          { session },
        )
        if (studentType === 'independent') {
          await Notification.create(
            [{
              recipientRole: 'main_admin',
              type: 'independent_student_registered',
              title: 'Independent student application',
              message: `${student.fullName} submitted an independent student application.`,
              link: '/admin/dashboard?section=independent-approvals',
              metadata: { studentId: String(accountId), email: normalizedEmail },
            }],
            { session },
          )
        }
      })
    } finally {
      await session.endSession()
    }

    return res.status(201).json({
      message: studentType === 'independent'
        ? 'Independent student created and awaiting administrator approval.'
        : 'Student created successfully.',
      student: {
        _id: String(student._id),
        fullName: student.fullName,
        email: student.email,
        username: student.username,
        studentId: student.studentId || '',
        studentType: student.studentType,
        collegeId: student.collegeId ? String(student.collegeId) : null,
        status: student.status,
        approvalStatus: student.approvalStatus,
        createdAt: student.createdAt,
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
      if (error.keyPattern?.studentId || error.keyValue?.studentId) {
        return res.status(409).json({ message: 'This student ID already exists.' })
      }
      return res.status(409).json({ message: 'An account with these details already exists.' })
    }
    if (error?.statusCode === 409) {
      return res.status(409).json({ message: error.message })
    }
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
      .select('title description modules assignments status createdAt quizzes.title quizzes.description quizzes.questions.prompt quizzes.questions.options +quizzes.questions.correctOptionIndex')
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

router.get('/reports/lookup', ...requireAdmin, async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
    if (search.length < 2 || search.length > 100) {
      return res.json({ students: [] })
    }

    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const expression = new RegExp(escapedSearch, 'i')
    const filter = {
      role: 'student',
      $or: [
        { fullName: expression },
        { username: expression },
        { email: expression },
      ],
    }
    const [independentStudents, collegeStudents] = await Promise.all([
      Student.find(filter)
        .select('fullName username email')
        .sort({ fullName: 1 })
        .limit(25)
        .lean(),
      CollegeStudent.find(filter)
        .select('fullName username email collegeId')
        .sort({ fullName: 1 })
        .limit(25)
        .lean(),
    ])
    const collegeIds = [...new Set(
      collegeStudents.map((student) => String(student.collegeId)).filter(Boolean),
    )].map((id) => new mongoose.Types.ObjectId(id))
    const colleges = collegeIds.length
      ? await College.find({ _id: { $in: collegeIds } }).select('name code').lean()
      : []
    const collegesById = new Map(colleges.map((college) => [String(college._id), college]))
    const students = [
      ...independentStudents.map((student) => ({
        id: String(student._id),
        name: student.fullName || student.username || student.email,
        email: student.email,
        studentType: 'independent',
        accountCollection: Student.collection.name,
      })),
      ...collegeStudents.map((student) => {
        const college = collegesById.get(String(student.collegeId))
        return {
          id: String(student._id),
          name: student.fullName || student.username || student.email,
          email: student.email,
          studentType: 'college',
          accountCollection: CollegeStudent.collection.name,
          collegeId: String(student.collegeId),
          collegeName: college?.name || '',
        }
      }),
    ].sort((left, right) => left.name.localeCompare(right.name)).slice(0, 25)

    return res.json({ students })
  } catch (error) {
    return next(error)
  }
})

router.get('/reports', ...requireAdmin, async (req, res, next) => {
  try {
    const { type, collegeId, studentId, accountCollection } = req.query
    const validTypes = new Set(['college', 'student', 'college_students', 'all'])
    if (typeof type !== 'string' || !validTypes.has(type)) {
      return res.status(400).json({ message: 'Select a supported report type.' })
    }

    const pageValue = typeof req.query.page === 'string' ? req.query.page : '0'
    if (!/^\d+$/.test(pageValue) || Number(pageValue) > 100000) {
      return res.status(400).json({ message: 'Select a valid report page.' })
    }
    const page = Number(pageValue)
    let college
    if (type === 'college' || type === 'college_students') {
      if (typeof collegeId !== 'string' || !mongoose.isValidObjectId(collegeId)) {
        return res.status(400).json({ message: 'Select a valid college for this report.' })
      }
      college = await College.findById(collegeId).select('name code status contactName contactEmail contactPhone').lean()
      if (!college) return res.status(404).json({ message: 'The selected college was not found.' })
    }

    let studentPages = []
    let hasMore = false
    if (type === 'student') {
      if (
        typeof studentId !== 'string' ||
        !mongoose.isValidObjectId(studentId) ||
        !['students', 'clg_students'].includes(accountCollection)
      ) {
        return res.status(400).json({ message: 'Select a valid student.' })
      }
      const StudentModel = accountCollection === Student.collection.name ? Student : CollegeStudent
      const student = await StudentModel.findById(studentId)
        .select('fullName username email status studentType collegeId createdAt role')
        .lean()
      if (!student || student.role !== 'student') {
        return res.status(404).json({ message: 'The selected student was not found.' })
      }
      studentPages = [{ student, studentType: accountCollection === 'students' ? 'independent' : 'college' }]
    } else {
      const collegeStudentFilter = {
        role: 'student',
        ...(college ? { collegeId: college._id } : {}),
      }
      const [independentPage, collegePage] = await Promise.all([
        type === 'all'
          ? Student.find({ role: 'student' })
            .select('fullName username email status studentType createdAt')
            .sort({ createdAt: 1, _id: 1 })
            .skip(page * reportPageSize)
            .limit(reportPageSize + 1)
            .lean()
          : Promise.resolve([]),
        CollegeStudent.find(collegeStudentFilter)
          .select('fullName username email status studentType collegeId createdAt')
          .sort({ createdAt: 1, _id: 1 })
          .skip(page * reportPageSize)
          .limit(reportPageSize + 1)
          .lean(),
      ])
      const independentHasMore = type === 'all' && independentPage.length > reportPageSize
      const collegeHasMore = collegePage.length > reportPageSize
      hasMore = independentHasMore || collegeHasMore
      studentPages = [
        ...independentPage.slice(0, reportPageSize).map((student) => ({ student, studentType: 'independent' })),
        ...collegePage.slice(0, reportPageSize).map((student) => ({ student, studentType: 'college' })),
      ]
    }

    const independentIds = studentPages
      .filter(({ studentType }) => studentType === 'independent')
      .map(({ student }) => student._id)
    const collegeStudents = studentPages.filter(({ studentType }) => studentType === 'college')
    const collegeStudentIds = collegeStudents.map(({ student }) => student._id)
    const enrollmentQuery = (filter) => Enrollment.find(filter)
      .populate('courseId', 'title')
      .populate('collegeId', 'name code')
      .lean()
    const [independentEnrollments, collegeEnrollments, studentColleges] = await Promise.all([
      independentIds.length
        ? enrollmentQuery({
          userId: { $in: independentIds },
          $or: [{ collegeId: { $exists: false } }, { collegeId: null }],
        })
        : Promise.resolve([]),
      collegeStudentIds.length
        ? enrollmentQuery({
          userId: { $in: collegeStudentIds },
          ...(college ? { collegeId: college._id } : { collegeId: { $exists: true, $ne: null } }),
        })
        : Promise.resolve([]),
      collegeStudentIds.length
        ? College.find({
          _id: { $in: [...new Set(collegeStudents.map(({ student }) => String(student.collegeId)))]
            .filter(Boolean)
            .map((id) => new mongoose.Types.ObjectId(id)) },
        }).select('name code').lean()
        : Promise.resolve([]),
    ])
    const collegesById = new Map(studentColleges.map((item) => [String(item._id), item]))
    const enrollmentsByStudent = new Map()
    for (const enrollment of [...independentEnrollments, ...collegeEnrollments]) {
      const studentType = enrollment.collegeId ? 'college' : 'independent'
      const key = `${studentType}:${String(enrollment.userId)}`
      const enrollments = enrollmentsByStudent.get(key) || []
      enrollments.push(enrollment)
      enrollmentsByStudent.set(key, enrollments)
    }

    const rows = studentPages.flatMap(({ student, studentType }) => {
      const studentIdValue = String(student._id)
      const studentCollege = student.collegeId
        ? collegesById.get(String(student.collegeId))
        : undefined
      const enrollments = enrollmentsByStudent.get(`${studentType}:${studentIdValue}`) || []
      const records = enrollments.length ? enrollments : [null]
      return records.map((enrollment) => ({
        recordType: 'Student',
        studentId: studentIdValue,
        studentName: student.fullName || student.username || '',
        studentEmail: student.email || '',
        studentType,
        studentStatus: student.status || '',
        registeredAt: student.createdAt || '',
        collegeId: student.collegeId ? String(student.collegeId) : '',
        collegeName: enrollment?.collegeId?.name || studentCollege?.name || '',
        collegeCode: enrollment?.collegeId?.code || studentCollege?.code || '',
        courseId: enrollment?.courseId?._id ? String(enrollment.courseId._id) : '',
        courseTitle: enrollment?.courseId?.title || '',
        enrollmentStatus: enrollment?.status || '',
        enrolledAt: enrollment?.createdAt || '',
      }))
    })

    let summary
    if (college && page === 0) {
      const [studentCount, subAdminCount, enrollmentCount] = await Promise.all([
        CollegeStudent.countDocuments({ role: 'student', collegeId: college._id }),
        CollegeAdmin.countDocuments({ role: 'college_admin', collegeId: college._id }),
        Enrollment.countDocuments({ collegeId: college._id }),
      ])
      summary = {
        collegeId: String(college._id),
        collegeName: college.name,
        collegeCode: college.code,
        collegeStatus: college.status || 'active',
        contactName: college.contactName || '',
        contactEmail: college.contactEmail || '',
        contactPhone: college.contactPhone || '',
        totalCollegeStudents: studentCount,
        totalSubAdmins: subAdminCount,
        totalEnrollments: enrollmentCount,
      }
    }

    return res.json({ type, page, hasMore, summary, rows })
  } catch (error) {
    return next(error)
  }
})

router.post('/students/import/preview', ...requireAdmin, async (req, res, next) => {
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
      return res.status(400).json({ message: 'Import is limited to 500 students per file.' })
    }

    const seenEmails = new Set()
    const seenStudentIds = new Set()
    const preview = []
    for (const row of rows) {
      const { fullName = '', studentId = '', email = '', department = '', batch = '' } = row
      const normalizedEmail = email.toLowerCase()
      const normalizedStudentId = studentId.toLowerCase()
      const username = studentId ? makeImportUsername(studentId) : ''
      const errors = []
      if (row.error) errors.push(row.error)
      if (!fullName || fullName.length > 120) errors.push('Full Name is required and must be 120 characters or fewer.')
      if (!studentId || studentId.length > 100) errors.push('Student ID is required and must be 100 characters or fewer.')
      if (!emailPattern.test(email) || email.length > 254) errors.push('Enter a valid email address.')
      if (!department || department.length > 120) errors.push('Department is required and must be 120 characters or fewer.')
      if (!batch || batch.length > 80) errors.push('Batch is required and must be 80 characters or fewer.')
      if (seenEmails.has(normalizedEmail)) errors.push('Email is duplicated in this file.')
      if (seenStudentIds.has(normalizedStudentId)) errors.push('Student ID is duplicated in this file.')
      if (email) seenEmails.add(normalizedEmail)
      if (studentId) seenStudentIds.add(normalizedStudentId)
      if (!errors.length) {
        const [existingEmail, existingStudentId, existingUsername] = await Promise.all([
          accountIdentifierExists('email', normalizedEmail),
          CollegeStudent.findOne({ studentId }).collation({ locale: 'en', strength: 2 }).select('_id').lean(),
          accountIdentifierExists('username', username),
        ])
        if (existingEmail) errors.push('Email already belongs to an LMS account.')
        if (existingStudentId) errors.push('Student ID already exists.')
        if (existingUsername) errors.push('Generated username conflicts with an LMS account.')
      }
      preview.push({
        row: row.rowNumber,
        fullName,
        studentId,
        email,
        department,
        batch,
        errors,
      })
    }
    return res.json({
      preview,
      summary: {
        total: preview.length,
        valid: preview.filter((row) => row.errors.length === 0).length,
        invalid: preview.filter((row) => row.errors.length > 0).length,
      },
    })
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
                status: 'active',
                isActive: true,
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

router.get('/engagement', ...requireAdmin, async (req, res, next) => {
  try {
    const period = req.query.period ?? '30d'
    const periods = {
      '7d': { days: 7, granularity: 'day' },
      '30d': { days: 30, granularity: 'day' },
      '3m': { months: 3, granularity: 'month' },
      '6m': { months: 6, granularity: 'month' },
    }
    if (typeof period !== 'string' || !Object.hasOwn(periods, period)) {
      return res.status(400).json({ message: 'Select a supported engagement period.' })
    }

    const now = new Date()
    const { days, months, granularity } = periods[period]
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    if (days) {
      start.setUTCDate(start.getUTCDate() - days + 1)
    } else {
      start.setUTCDate(1)
      start.setUTCMonth(start.getUTCMonth() - months + 1)
    }

    const format = granularity === 'day' ? '%Y-%m-%d' : '%Y-%m'
    const engagement = await Enrollment.aggregate([
      { $match: { createdAt: { $gte: start, $lte: now } } },
      {
        $group: {
          _id: { $dateToString: { format, date: '$createdAt', timezone: 'UTC' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])

    return res.json({
      period,
      granularity,
      engagement: engagement.map(({ _id, count }) => ({ date: _id, count })),
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/overview', ...requireAdmin, async (req, res, next) => {
  try {
    const [
      totalIndependentStudents,
      pendingIndependentStudents,
      totalCollegeStudents,
      totalColleges,
      totalCourses,
      totalEnrollments,
      completedEnrollments,
      activeEnrollments,
      recentIndependentStudents,
      recentCollegeStudents,
      recentCourses,
    ] =
      await Promise.all([
        Student.countDocuments({
          role: 'student',
          studentType: 'independent',
          status: 'active',
          isActive: { $ne: false },
          $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }],
        }),
        Student.countDocuments({
          role: 'student',
          studentType: 'independent',
          $or: [
            { approvalStatus: 'pending' },
            { approvalStatus: { $exists: false }, status: 'pending' },
          ],
        }),
        CollegeStudent.countDocuments({ role: 'student', status: 'active', isActive: { $ne: false } }),
        College.countDocuments(),
        Course.countDocuments(),
        Enrollment.countDocuments(),
        Enrollment.countDocuments({ status: 'completed' }),
        Enrollment.countDocuments({ status: 'active' }),
        Student.find({ role: 'student' })
          .select('fullName username email role status studentType approvalStatus createdAt')
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
        CollegeStudent.find({ role: 'student' })
          .select('fullName username email role status studentType collegeId createdAt')
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
        Course.find({})
          .select('title status createdAt')
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
      ])
    const recentRegistrations = [...recentIndependentStudents, ...recentCollegeStudents]
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, 20)

    return res.json({
      stats: {
        totalStudents: totalIndependentStudents + totalCollegeStudents,
        pendingIndependentStudents,
        totalColleges,
        totalCourses,
        totalEnrollments,
      },
      recentRegistrations,
      recentCourses,
      courseCompletion: {
        completed: completedEnrollments,
        inProgress: activeEnrollments,
      },
      dataAvailability: {
        courses: true,
        courseCompletion: completedEnrollments + activeEnrollments > 0,
      },
    })
  } catch (error) {
    return next(error)
  }
})

export default router
