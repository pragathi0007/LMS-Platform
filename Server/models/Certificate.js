import mongoose from 'mongoose'

const certificateSchema = new mongoose.Schema(
  {
    certificateId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      match: /^AIH-(?:[A-F0-9]{32}|\d{4}-[A-Z0-9]{12})$/,
    },
    studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    studentType: { type: String, enum: ['independent', 'college'], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId },
    collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
    studentName: { type: String, required: true, trim: true, maxlength: 120 },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    courseName: { type: String, required: true, trim: true, maxlength: 200 },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    name: { type: String, required: true, trim: true, maxlength: 240 },
    issuedAt: { type: Date, required: true, default: Date.now },
    completedAt: { type: Date },
    viewUrl: { type: String, required: true, maxlength: 2048 },
    downloadUrl: { type: String, required: true, maxlength: 2048 },
    templateId: { type: String, trim: true, default: 'builtin' },
    requirementSnapshot: { type: [String], default: [] },
  },
  {
    autoCreate: false,
    autoIndex: false,
    timestamps: true,
    collection: 'certificates',
  },
)

certificateSchema.index(
  { studentType: 1, studentId: 1, courseId: 1 },
  {
    unique: true,
    name: 'unique_student_course_certificate',
    partialFilterExpression: {
      studentType: { $type: 'string' },
      studentId: { $type: 'objectId' },
      courseId: { $type: 'objectId' },
    },
  },
)
certificateSchema.index({ studentType: 1, studentId: 1, issuedAt: -1 })
certificateSchema.index(
  { userId: 1, courseId: 1 },
  {
    unique: true,
    name: 'unique_user_course_certificate',
    partialFilterExpression: {
      userId: { $type: 'objectId' },
      courseId: { $type: 'objectId' },
    },
  },
)

const Certificate = mongoose.models.Certificate
  || mongoose.model('Certificate', certificateSchema, 'certificates')

export default Certificate
