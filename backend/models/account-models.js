import mongoose from 'mongoose'

const accountFields = {
  fullName: { type: String, trim: true, maxlength: 120 },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, select: false },
  status: {
    type: String,
    enum: ['active', 'pending', 'inactive', 'suspended', 'invitation_pending'],
    default: 'active',
    lowercase: true,
  },
  isActive: { type: Boolean, default: true },
  permissions: { type: [String], default: [] },
}

function createAccountModel(modelName, collectionName, role, additionalFields = {}) {
  const schema = new mongoose.Schema(
    {
      ...accountFields,
      ...additionalFields,
      role: { type: String, enum: [role], default: role, required: true, immutable: true },
    },
    { autoCreate: false, autoIndex: false, timestamps: true, collection: collectionName },
  )

  return mongoose.models[modelName] || mongoose.model(modelName, schema, collectionName)
}

const independentStudentFields = {
  studentType: { type: String, enum: ['independent'], default: 'independent', required: true },
}

const collegeStudentFields = {
  studentType: { type: String, enum: ['college'], default: 'college', required: true },
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  studentId: { type: String, trim: true, maxlength: 100 },
  department: { type: String, trim: true, maxlength: 120 },
  batch: { type: String, trim: true, maxlength: 80 },
}

const collegeAdminFields = {
  collegeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'College',
    required: true,
  },
  activationTokenHash: { type: String, select: false },
  activationTokenExpiresAt: { type: Date, select: false },
}

export const Admin = createAccountModel('Admin', 'admin', 'main_admin')
export const CollegeAdmin = createAccountModel('CollegeAdmin', 'sub_admins', 'college_admin', collegeAdminFields)
export const Student = createAccountModel('Student', 'students', 'student', independentStudentFields)
export const CollegeStudent = createAccountModel('CollegeStudent', 'clg_students', 'student', collegeStudentFields)
CollegeStudent.schema.index(
  { collegeId: 1, studentId: 1 },
  {
    unique: true,
    sparse: true,
    collation: { locale: 'en', strength: 2 },
    name: 'unique_college_student_id',
  },
)

export const accountModelsByRole = Object.freeze({
  main_admin: Admin,
  college_admin: CollegeAdmin,
  student: Student,
})

export const accountModelsByCollection = Object.freeze({
  admin: Admin,
  sub_admins: CollegeAdmin,
  students: Student,
  clg_students: CollegeStudent,
})

export function roleForAccountCollection(collectionName) {
  switch (collectionName) {
    case 'admin':
      return 'main_admin'
    case 'sub_admins':
      return 'college_admin'
    case 'students':
    case 'clg_students':
      return 'student'
    default:
      return null
  }
}

export function matchesStoredAccountRole(collectionName, storedRole) {
  const expectedRole = roleForAccountCollection(collectionName)
  return storedRole === expectedRole
}
