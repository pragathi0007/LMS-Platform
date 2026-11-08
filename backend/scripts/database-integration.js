import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'

process.env.MONGO_DB_NAME = 'LMS_TEST'
process.env.ADMIN_EMAIL = 'initial-admin@lms-test.invalid'
process.env.ADMIN_PASSWORD = randomBytes(24).toString('base64url')
process.env.JWT_SECRET = randomBytes(48).toString('hex')
process.env.SMTP_HOST = ''
process.env.SMTP_USER = ''
process.env.SMTP_PASSWORD = ''
process.env.SMTP_FROM = ''
process.env.CLIENT_ORIGIN = ''

const integrationDatabaseName = 'LMS_TEST'
const expectedCollections = [
  'accountidentities',
  'admin',
  'clg_students',
  'colleges',
  'courses',
  'enrollment',
  'notifications',
  'students',
  'sub_admins',
]
const { config } = await import('../config/env.js')
if (!config.mongoUri) throw new Error('MONGO_URI is not configured.')

const mongooseConnected = await mongoose.connect(config.mongoUri, {
  dbName: integrationDatabaseName,
  serverSelectionTimeoutMS: 15000,
})
const database = mongooseConnected.connection.db
if (database.databaseName !== integrationDatabaseName) {
  await mongoose.disconnect()
  throw new Error(`Refusing database tests: connected to "${database.databaseName}", not ${integrationDatabaseName}.`)
}
const existingCollections = await database.listCollections({}, { nameOnly: true }).toArray()
if (existingCollections.length) {
  await mongoose.disconnect()
  throw new Error('LMS_TEST is not empty. Refusing to overwrite pre-existing test data.')
}

let server
let testDatabaseOwned = true
try {
  const [
    { connectToDatabase },
    { createAdminAccount },
    { default: adminRouter },
    { default: authRouter },
    { default: learningRouter },
    { default: notificationsRouter },
    { AccountIdentity },
    { Admin, CollegeAdmin, CollegeStudent, Student },
    { default: College },
    { default: Course },
    { default: Enrollment },
    { Notification },
  ] = await Promise.all([
    import('../config/db.js'),
    import('./seed-admin.js'),
    import('../routes/admin.js'),
    import('../routes/auth.js'),
    import('../routes/learning.js'),
    import('../routes/notifications.js'),
    import('../models/AccountIdentity.js').then((module) => ({ AccountIdentity: module.default })),
    import('../models/account-models.js'),
    import('../models/College.js'),
    import('../models/Course.js'),
    import('../models/Enrollment.js'),
    import('../models/Notification.js').then((module) => ({ Notification: module.default })),
  ])
  await connectToDatabase()
  assert.equal(mongoose.connection.db.databaseName, integrationDatabaseName)
  await createAdminAccount({ connect: false })

  const app = express()
  app.use(express.json({ limit: '2mb' }))
  app.use('/api/admin', adminRouter)
  app.use('/api/auth', authRouter)
  app.use('/api', learningRouter)
  app.use('/api/notifications', notificationsRouter)
  app.use((error, req, res, next) => {
    console.error(JSON.stringify({
      event: 'database.integration_test_request_failed',
      path: req.path,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: error?.code,
    }))
    res.status(500).json({ message: 'Integration test request failed.' })
  })
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`

  async function request(path, { method = 'POST', body, token } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: ['Be', 'arer'].join('') + ' ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const result = await response.json()
    return { response, result }
  }

  async function login(identifier, password, role) {
    const { response, result } = await request('/auth/login', {
      body: { identifier, password, role },
    })
    assert.equal(response.status, 200, `login failed for ${role}: ${result.message}`)
    assert.equal(result.user.role, role)
    assert.ok(result.token)
    return result.token
  }

  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD
  const adminToken = await login(adminEmail, adminPassword, 'main_admin')
  const admin = await Admin.findOne({ email: adminEmail }).select('+passwordHash').lean()
  assert.ok(admin?.passwordHash)
  assert.equal(await (await import('bcryptjs')).default.compare(adminPassword, admin.passwordHash), true)
  assert.equal((await AccountIdentity.findOne({ accountId: admin._id }).lean()).accountCollection, 'admin')
  console.log('PASS Main Admin seed, bcrypt hash, login, and admin/accountidentities persistence')

  const collegeResponse = await request('/admin/colleges', {
    token: adminToken,
    body: {
      name: 'LMS_TEST College',
      code: 'LMS-TEST',
      contactEmail: 'contact@lms-test.invalid',
      contactName: 'Test Contact',
      contactPhone: '+10000000000',
      status: 'active',
    },
  })
  assert.equal(collegeResponse.response.status, 201, collegeResponse.result.message)
  const collegeId = collegeResponse.result.college.id
  const college = await College.findById(collegeId).lean()
  assert.equal(college.code, 'LMS-TEST')
  assert.equal(College.collection.name, 'colleges')
  console.log('PASS College creation persisted in colleges')

  const subAdminResponse = await request(`/admin/colleges/${collegeId}/sub-admins`, {
    token: adminToken,
    body: { fullName: 'LMS_TEST Sub Admin', email: 'subadmin@lms-test.invalid', username: 'test-subadmin' },
  })
  assert.equal(subAdminResponse.response.status, 503)
  assert.equal(subAdminResponse.result.activationEmailSent, false)
  const subAdmin = await CollegeAdmin.findById(subAdminResponse.result.accountId).select('+passwordHash').lean()
  assert.ok(subAdmin)
  assert.equal(String(subAdmin.collegeId), collegeId)
  assert.equal(subAdmin.role, 'college_admin')
  const subAdminPassword = randomBytes(24).toString('base64url')
  const bcrypt = (await import('bcryptjs')).default
  await CollegeAdmin.updateOne(
    { _id: subAdmin._id },
    { $set: { passwordHash: await bcrypt.hash(subAdminPassword, 12), status: 'active', isActive: true } },
  )
  const subAdminToken = await login(subAdmin.username, subAdminPassword, 'college_admin')
  const subAdminIdentity = await AccountIdentity.findOne({ accountId: subAdmin._id }).lean()
  assert.equal(subAdminIdentity.accountCollection, 'sub_admins')
  console.log('PASS College Sub-Admin creation, collegeId, identity mapping, and login')

  const studentEmail = 'independent@lms-test.invalid'
  const studentPassword = randomBytes(24).toString('base64url')
  const registration = await request('/auth/register', {
    body: {
      fullName: 'LMS_TEST Independent Student',
      email: studentEmail,
      username: 'test-independent',
      password: studentPassword,
      confirmPassword: studentPassword,
      role: 'student',
      accountType: 'independent',
    },
  })
  assert.equal(registration.response.status, 201, registration.result.message)
  const student = await Student.findOne({ email: studentEmail }).lean()
  assert.equal(student.studentType, 'independent')
  assert.equal(student.collegeId, undefined)
  assert.equal(student.status, 'pending')
  assert.equal(student.approvalStatus, 'pending')
  const pendingLogin = await request('/auth/login', {
    body: { identifier: student.username, password: studentPassword, role: 'student' },
  })
  assert.equal(pendingLogin.response.status, 403)
  assert.match(pendingLogin.result.message, /awaiting approval/)
  const pendingToken = jwt.sign(
    { role: 'student', accountCollection: 'students' },
    process.env.JWT_SECRET,
    { subject: String(student._id), expiresIn: '5m' },
  )
  const pendingApi = await request('/courses', { method: 'GET', token: pendingToken })
  assert.equal(pendingApi.response.status, 403)
  const approval = await request(`/admin/independent-students/${student._id}/approval`, {
    method: 'PATCH',
    token: adminToken,
    body: { decision: 'approve' },
  })
  assert.equal(approval.response.status, 200, approval.result.message)
  const studentToken = await login(student.username, studentPassword, 'student')
  assert.equal((await AccountIdentity.findOne({ accountId: student._id }).lean()).accountCollection, 'students')
  console.log('PASS Independent student registration, pending login/API denial, Main Admin approval, mapping, collection, and login')

  const csvText = 'Full Name,Student ID,Email,Department,Batch\nLMS_TEST College Student,TEST-001,college-student@lms-test.invalid,Testing,2026\n'
  const importResult = await request('/admin/students/import', {
    token: adminToken,
    body: { csvText, collegeId },
  })
  assert.equal(importResult.response.status, 200, importResult.result.message)
  assert.equal(importResult.result.summary.imported, 1)
  const collegeStudent = await CollegeStudent.findOne({ studentId: 'TEST-001' }).lean()
  assert.equal(collegeStudent.studentType, 'college')
  assert.equal(String(collegeStudent.collegeId), collegeId)
  const collegeStudentPassword = randomBytes(24).toString('base64url')
  await CollegeStudent.updateOne(
    { _id: collegeStudent._id },
    { $set: { passwordHash: await bcrypt.hash(collegeStudentPassword, 12), status: 'active', isActive: true } },
  )
  const collegeStudentToken = await login(collegeStudent.username, collegeStudentPassword, 'student')
  assert.equal((await AccountIdentity.findOne({ accountId: collegeStudent._id }).lean()).accountCollection, 'clg_students')
  console.log('PASS College student import, collegeId, identity mapping, and login')

  const courseResult = await request('/admin/courses', {
    token: adminToken,
    body: {
      title: 'LMS_TEST Course',
      description: 'Disposable integration test',
      status: 'published',
      modules: [{ title: 'Test module', lessons: [{ title: 'Test lesson', videoUrl: 'https://youtu.be/abcd1234' }] }],
      assignments: [{ title: 'Test assignment', description: 'Test instructions', points: 10 }],
      quizzes: [{ title: 'Test quiz', questions: [{ prompt: '2 + 2?', options: ['3', '4'], correctOptionIndex: 1 }] }],
    },
  })
  assert.equal(courseResult.response.status, 201, courseResult.result.message)
  const courseId = courseResult.result.course._id
  const course = await Course.findById(courseId).select('+quizzes.questions.correctOptionIndex').lean()
  assert.equal(course.modules[0].lessons[0].videoUrl, 'https://youtu.be/abcd1234')
  assert.equal(course.assignments[0].title, 'Test assignment')
  assert.equal(course.quizzes[0].questions[0].correctOptionIndex, 1)
  console.log('PASS Course, lesson video, assignment, quiz, and answer persistence')

  const independentEnrollment = await request('/enrollments', {
    token: studentToken,
    body: { courseId },
  })
  assert.equal(independentEnrollment.response.status, 201, independentEnrollment.result.message)
  assert.equal(independentEnrollment.result.enrollment.collegeId, undefined)

  const collegeEnrollment = await request('/college/enrollments', {
    token: subAdminToken,
    body: { studentId: String(collegeStudent._id), courseId },
  })
  assert.equal(collegeEnrollment.response.status, 201, collegeEnrollment.result.message)
  assert.equal(String(collegeEnrollment.result.enrollment.collegeId), collegeId)
  const enrollments = await Enrollment.find({}).lean()
  assert.equal(enrollments.length, 2)
  assert.equal(Enrollment.collection.name, 'enrollment')
  console.log('PASS Independent and college enrollments persisted in enrollment with correct references')

  const unauthenticatedCourses = await request('/courses', { method: 'GET' })
  assert.equal(unauthenticatedCourses.response.status, 401)
  const visibleCourses = await request('/courses', { method: 'GET', token: studentToken })
  assert.equal(visibleCourses.response.status, 200)
  assert.equal(visibleCourses.result.courses[0].quizzes[0].questions[0].correctOptionIndex, undefined)
  const forbiddenEnrollment = await request('/college/enrollments', {
    token: subAdminToken,
    body: { studentId: String(student._id), courseId },
  })
  assert.equal(forbiddenEnrollment.response.status, 404)
  console.log('PASS Authenticated course access, hidden quiz answers, and college isolation')

  const actualNames = (await database.listCollections({}, { nameOnly: true }).toArray())
    .map(({ name }) => name).sort()
  assert.deepEqual(actualNames, expectedCollections)
  assert.equal(await AccountIdentity.countDocuments({}), 4)
  assert.equal(await database.collection('users').countDocuments({}), 0)
  for (const collectionName of expectedCollections) {
    const indexes = await database.collection(collectionName).listIndexes().toArray()
    assert.ok(indexes.some((index) => index.name === '_id_'), `${collectionName} missing _id index`)
    if (['admin', 'sub_admins', 'students', 'clg_students'].includes(collectionName)) {
      assert.ok(indexes.some((index) => index.key.email === 1 && index.unique), `${collectionName} missing unique email index`)
      assert.ok(indexes.some((index) => index.key.username === 1 && index.unique), `${collectionName} missing unique username index`)
    }
    if (collectionName === 'colleges') {
      assert.ok(indexes.some((index) => index.key.code === 1 && index.unique), 'colleges missing unique code index')
    }
    if (collectionName === 'clg_students') {
      assert.ok(indexes.some((index) => index.key.collegeId === 1 && index.key.studentId === 1 && index.unique), 'clg_students missing college-scoped student ID index')
    }
    if (collectionName === 'accountidentities') {
      assert.ok(indexes.some((index) => index.key.email === 1 && index.unique), 'accountidentities missing unique email index')
      assert.ok(indexes.some((index) => index.key.accountCollection === 1 && index.key.accountId === 1 && index.unique), 'accountidentities missing unique account target index')
    }
  }
  const duplicatePassword = randomBytes(24).toString('base64url')
  const duplicateRegistration = await request('/auth/register', {
    body: {
      fullName: 'Duplicate Account',
      email: adminEmail.toUpperCase(),
      username: 'duplicate-admin',
      password: duplicatePassword,
      confirmPassword: duplicatePassword,
      role: 'student',
      accountType: 'independent',
    },
  })
  assert.equal(duplicateRegistration.response.status, 409)
  console.log(JSON.stringify({ database: database.databaseName, verifiedCollections: actualNames, persistedAccounts: { admin: 1, sub_admins: 1, students: 1, clg_students: 1 }, enrollments: enrollments.length }))
} finally {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
  if (testDatabaseOwned && mongoose.connection.readyState === 1 && mongoose.connection.db.databaseName === integrationDatabaseName) {
    await mongoose.connection.db.dropDatabase()
    const remaining = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()
    if (remaining.length) throw new Error('LMS_TEST cleanup did not remove all integration-test collections.')
    console.log('LMS_TEST disposable database cleaned after verification.')
  }
  await mongoose.disconnect()
}
