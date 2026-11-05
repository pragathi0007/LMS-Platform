import mongoose from 'mongoose'

const accountFields = {
  fullName: { type: String, trim: true, maxlength: 120 },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, select: false },
  status: {
    type: String,
    enum: ['active', 'approved', 'pending', 'rejected', 'inactive', 'suspended'],
    default: 'active',
    lowercase: true,
  },
  approvalStatus: { type: String, lowercase: true },
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

const instructorFields = {
  professionalDetails: {
    professionalTitle: { type: String, trim: true, maxlength: 100 },
    countryCode: { type: String, trim: true, maxlength: 5 },
    phone: { type: String, trim: true, maxlength: 30 },
    expertise: { type: [String], default: [] },
    subjects: { type: [String], default: [] },
    customSubjects: { type: [String], default: [] },
    experience: { type: String, trim: true, maxlength: 30 },
    languages: { type: [String], default: [] },
    customLanguage: { type: String, trim: true, maxlength: 60 },
    profilePicture: {
      data: Buffer,
      contentType: { type: String, trim: true },
    },
  },
}

export const Student = createAccountModel('Student', 'students', 'student')
export const Instructor = createAccountModel('Instructor', 'instructors', 'instructor', instructorFields)
export const Admin = createAccountModel('Admin', 'admins', 'admin')

export const accountModelsByRole = Object.freeze({
  student: Student,
  instructor: Instructor,
  admin: Admin,
})
