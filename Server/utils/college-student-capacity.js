import { CollegeAdmin, CollegeStudent } from '../models/account-models.js'

export async function getCollegeStudentLimit(collegeId, session) {
  let query = CollegeAdmin.find({
    role: 'college_admin',
    collegeId,
    studentLimit: { $type: 'number' },
  }).select('studentLimit')
  if (session) query = query.session(session)
  const admins = await query.lean()
  const limits = admins
    .map(({ studentLimit }) => studentLimit)
    .filter((limit) => Number.isSafeInteger(limit) && limit >= 0)
  return limits.length ? Math.min(...limits) : null
}

export async function countCollegeStudents(collegeId, session) {
  let query = CollegeStudent.countDocuments({
    role: 'student',
    studentType: 'college',
    collegeId,
  })
  if (session) query = query.session(session)
  return query
}

export async function assertCollegeStudentCapacity(collegeId, session) {
  const studentLimit = await getCollegeStudentLimit(collegeId, session)
  if (studentLimit === null) return
  const studentCount = await countCollegeStudents(collegeId, session)
  if (studentCount >= studentLimit) {
    const error = new Error(`This college has reached its configured student limit of ${studentLimit}.`)
    error.statusCode = 409
    error.code = 'college_student_limit'
    throw error
  }
}
