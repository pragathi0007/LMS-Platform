import test from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { deleteStudentAccountData } from '../routes/settings.js'
import settingsRouter from '../routes/settings.js'
import { Student, Admin, CollegeAdmin } from '../models/account-models.js'
import AccountIdentity from '../models/AccountIdentity.js'
import Enrollment from '../models/Enrollment.js'
import AssignmentSubmission from '../models/AssignmentSubmission.js'
import QuizAttempt from '../models/QuizAttempt.js'
import QuizAttemptState from '../models/QuizAttemptState.js'
import Certificate from '../models/Certificate.js'
import Notification from '../models/Notification.js'
import VideoAttentionResponse from '../models/VideoAttentionResponse.js'
import RefreshSession from '../models/RefreshSession.js'
import StudentProfile from '../models/StudentProfile.js'
import ReferralCode from '../models/ReferralCode.js'
import ReferralCodeUserLimit from '../models/ReferralCodeUserLimit.js'
import ReferralCodeDailyLimit from '../models/ReferralCodeDailyLimit.js'
import Feedback from '../models/Feedback.js'
import Complaint from '../models/Complaint.js'
import SupportTicket from '../models/SupportTicket.js'

function stub(target, method, implementation) {
  const original = target[method]
  target[method] = implementation
  return () => {
    target[method] = original
  }
}

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(data) {
      this.body = data
      return this
    },
    set(key, value) {
      this.headers[key] = value
      return this
    },
  }
  return res
}

// Find the delete handler registered on settingsRouter
const deleteRouteLayer = settingsRouter.stack.find(
  (layer) => layer.route && layer.route.path === '/account' && layer.route.methods.delete,
)
const deleteHandler = deleteRouteLayer?.route?.stack?.[0]?.handle

test('account deletion rejects privileged main_admin accounts with 403', async () => {
  const req = {
    auth: { id: 'admin123', role: 'main_admin', accountCollection: 'admin' },
    body: { confirmText: 'DELETE' },
  }
  const res = mockResponse()
  await deleteHandler(req, res, () => {})
  assert.equal(res.statusCode, 403)
  assert.match(res.body.message, /Platform administrator accounts cannot be deleted/)
})

test('account deletion rejects privileged college_admin accounts with 403', async () => {
  const req = {
    auth: { id: 'cadm123', role: 'college_admin', accountCollection: 'sub_admins' },
    body: { confirmText: 'DELETE' },
  }
  const res = mockResponse()
  await deleteHandler(req, res, () => {})
  assert.equal(res.statusCode, 403)
  assert.match(res.body.message, /College administrator accounts cannot be deleted/)
})

test('account deletion requires explicit "DELETE" confirmation text', async () => {
  const req = {
    auth: { id: 'stu123', role: 'student', accountCollection: 'students' },
    body: { confirmText: 'not-delete' },
  }
  const res = mockResponse()
  await deleteHandler(req, res, () => {})
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /Please type DELETE to confirm/)
})

test('account deletion requires password and verifies it when user has a password', async () => {
  const dummyPasswordHash = await bcrypt.hash('CorrectPass123', 10)
  const studentId = new mongoose.Types.ObjectId()

  const restoreFind = stub(Student, 'findById', () => ({
    select: () => Promise.resolve({
      _id: studentId,
      role: 'student',
      passwordHash: dummyPasswordHash,
    }),
  }))

  try {
    // Missing password
    const reqMissing = {
      auth: { id: String(studentId), role: 'student', accountCollection: 'students' },
      body: { confirmText: 'DELETE' },
    }
    const resMissing = mockResponse()
    await deleteHandler(reqMissing, resMissing, () => {})
    assert.equal(resMissing.statusCode, 400)
    assert.match(resMissing.body.message, /Enter your password to confirm/)

    // Wrong password
    const reqWrong = {
      auth: { id: String(studentId), role: 'student', accountCollection: 'students' },
      body: { confirmText: 'DELETE', password: 'WrongPassword' },
    }
    const resWrong = mockResponse()
    await deleteHandler(reqWrong, resWrong, () => {})
    assert.equal(resWrong.statusCode, 400)
    assert.match(resWrong.body.message, /password you entered is incorrect/)
  } finally {
    restoreFind()
  }
})

test('deleteStudentAccountData deletes all related records and cleans up references', async () => {
  const studentId = new mongoose.Types.ObjectId()
  const operations = []

  const restores = [
    stub(AccountIdentity, 'deleteOne', async (filter) => { operations.push(['AccountIdentity.deleteOne', filter]) }),
    stub(RefreshSession, 'deleteMany', async (filter) => { operations.push(['RefreshSession.deleteMany', filter]) }),
    stub(Enrollment, 'deleteMany', async (filter) => { operations.push(['Enrollment.deleteMany', filter]) }),
    stub(AssignmentSubmission, 'deleteMany', async (filter) => { operations.push(['AssignmentSubmission.deleteMany', filter]) }),
    stub(QuizAttempt, 'deleteMany', async (filter) => { operations.push(['QuizAttempt.deleteMany', filter]) }),
    stub(QuizAttemptState, 'deleteMany', async (filter) => { operations.push(['QuizAttemptState.deleteMany', filter]) }),
    stub(Certificate, 'deleteMany', async (filter) => { operations.push(['Certificate.deleteMany', filter]) }),
    stub(Notification, 'deleteMany', async (filter) => { operations.push(['Notification.deleteMany', filter]) }),
    stub(VideoAttentionResponse, 'deleteMany', async (filter) => { operations.push(['VideoAttentionResponse.deleteMany', filter]) }),
    stub(StudentProfile, 'deleteOne', async (filter) => { operations.push(['StudentProfile.deleteOne', filter]) }),
    stub(Feedback, 'deleteMany', async (filter) => { operations.push(['Feedback.deleteMany', filter]) }),
    stub(SupportTicket, 'deleteMany', async (filter) => { operations.push(['SupportTicket.deleteMany', filter]) }),
    stub(Complaint, 'deleteMany', async (filter) => { operations.push(['Complaint.deleteMany', filter]) }),
    stub(ReferralCode, 'updateMany', async (filter, update) => { operations.push(['ReferralCode.updateMany', filter, update]) }),
    stub(ReferralCode, 'deleteMany', async (filter) => { operations.push(['ReferralCode.deleteMany', filter]) }),
    stub(ReferralCodeUserLimit, 'deleteMany', async (filter) => { operations.push(['ReferralCodeUserLimit.deleteMany', filter]) }),
    stub(ReferralCodeDailyLimit, 'deleteMany', async (filter) => { operations.push(['ReferralCodeDailyLimit.deleteMany', filter]) }),
    stub(Student, 'deleteOne', async (filter) => { operations.push(['Student.deleteOne', filter]) }),
  ]

  try {
    await deleteStudentAccountData(Student, studentId)

    const opNames = operations.map((op) => op[0])
    assert.ok(opNames.includes('AccountIdentity.deleteOne'))
    assert.ok(opNames.includes('RefreshSession.deleteMany'))
    assert.ok(opNames.includes('Enrollment.deleteMany'))
    assert.ok(opNames.includes('AssignmentSubmission.deleteMany'))
    assert.ok(opNames.includes('QuizAttempt.deleteMany'))
    assert.ok(opNames.includes('QuizAttemptState.deleteMany'))
    assert.ok(opNames.includes('Certificate.deleteMany'))
    assert.ok(opNames.includes('Notification.deleteMany'))
    assert.ok(opNames.includes('VideoAttentionResponse.deleteMany'))
    assert.ok(opNames.includes('StudentProfile.deleteOne'))
    assert.ok(opNames.includes('Feedback.deleteMany'))
    assert.ok(opNames.includes('SupportTicket.deleteMany'))
    assert.ok(opNames.includes('Complaint.deleteMany'))
    assert.ok(opNames.includes('ReferralCode.updateMany'))
    assert.ok(opNames.includes('ReferralCode.deleteMany'))
    assert.ok(opNames.includes('ReferralCodeUserLimit.deleteMany'))
    assert.ok(opNames.includes('ReferralCodeDailyLimit.deleteMany'))
    assert.ok(opNames.includes('Student.deleteOne'))

    // Verify filter targets the exact user id
    const identityOp = operations.find((op) => op[0] === 'AccountIdentity.deleteOne')
    assert.deepEqual(identityOp[1], { accountCollection: 'students', accountId: studentId })

    const studentOp = operations.find((op) => op[0] === 'Student.deleteOne')
    assert.deepEqual(studentOp[1], { _id: studentId })

    const refUpdateOp = operations.find((op) => op[0] === 'ReferralCode.updateMany')
    assert.deepEqual(refUpdateOp[1], { usedBy: studentId })
  } finally {
    restores.forEach((r) => r())
  }
})

test('account deletion strictly uses authenticated req.auth.id, ignoring client-supplied id', async () => {
  const authenticatedId = new mongoose.Types.ObjectId()
  const forgedTargetId = new mongoose.Types.ObjectId()
  let queriedId = null

  const restoreFind = stub(Student, 'findById', (id) => {
    queriedId = String(id)
    return {
      select: () => Promise.resolve({
        _id: authenticatedId,
        role: 'student',
        passwordHash: null, // Google-only account without password
      }),
    }
  })

  const restoreDeleteData = stub(mongoose, 'startSession', async () => ({
    withTransaction: async (cb) => cb(),
    endSession: async () => {},
  }))

  const restoreDeleteOne = stub(Student, 'deleteOne', async () => ({}))
  const restoreIdentity = stub(AccountIdentity, 'deleteOne', async () => ({}))
  const restoreEnrollment = stub(Enrollment, 'deleteMany', async () => ({}))
  const restoreSubmissions = stub(AssignmentSubmission, 'deleteMany', async () => ({}))
  const restoreQuizzes = stub(QuizAttempt, 'deleteMany', async () => ({}))
  const restoreQuizStates = stub(QuizAttemptState, 'deleteMany', async () => ({}))
  const restoreCerts = stub(Certificate, 'deleteMany', async () => ({}))
  const restoreNotifs = stub(Notification, 'deleteMany', async () => ({}))
  const restoreVideo = stub(VideoAttentionResponse, 'deleteMany', async () => ({}))
  const restoreSessions = stub(RefreshSession, 'deleteMany', async () => ({}))
  const restoreProfile = stub(StudentProfile, 'deleteOne', async () => ({}))
  const restoreFeedback = stub(Feedback, 'deleteMany', async () => ({}))
  const restoreTickets = stub(SupportTicket, 'deleteMany', async () => ({}))
  const restoreComplaints = stub(Complaint, 'deleteMany', async () => ({}))
  const restoreRefUpdate = stub(ReferralCode, 'updateMany', async () => ({}))
  const restoreRefDelete = stub(ReferralCode, 'deleteMany', async () => ({}))
  const restoreRefLimits = stub(ReferralCodeUserLimit, 'deleteMany', async () => ({}))
  const restoreRefDaily = stub(ReferralCodeDailyLimit, 'deleteMany', async () => ({}))

  try {
    const req = {
      auth: { id: String(authenticatedId), role: 'student', accountCollection: 'students' },
      body: { id: String(forgedTargetId), targetStudentId: String(forgedTargetId), confirmText: 'DELETE' },
    }
    const res = mockResponse()
    await deleteHandler(req, res, () => {})

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.deleted, true)
    assert.equal(queriedId, String(authenticatedId))
    assert.notEqual(queriedId, String(forgedTargetId))
  } finally {
    restoreFind()
    restoreDeleteData()
    restoreDeleteOne()
    restoreIdentity()
    restoreEnrollment()
    restoreSubmissions()
    restoreQuizzes()
    restoreQuizStates()
    restoreCerts()
    restoreNotifs()
    restoreVideo()
    restoreSessions()
    restoreProfile()
    restoreFeedback()
    restoreTickets()
    restoreComplaints()
    restoreRefUpdate()
    restoreRefDelete()
    restoreRefLimits()
    restoreRefDaily()
  }
})
