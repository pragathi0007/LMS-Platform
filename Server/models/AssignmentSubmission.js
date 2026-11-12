import mongoose from 'mongoose'

const evaluationSchema = new mongoose.Schema(
  {
    marksObtained: { type: Number, min: 0, required: true },
    feedback: { type: String, trim: true, maxlength: 5000, default: '' },
    correctness: {
      type: String,
      enum: ['correct', 'partially_correct', 'incorrect', 'not_applicable'],
      default: 'not_applicable',
    },
    evaluationStatus: {
      type: String,
      enum: ['evaluated', 're_evaluation_required'],
      default: 'evaluated',
    },
    evaluatedAt: { type: Date, required: true },
    evaluatorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { _id: false },
)

const assignmentSubmissionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true, maxlength: 180 },
    contentType: { type: String, required: true, enum: ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
    fileSize: { type: Number, required: true, min: 1, max: 10 * 1024 * 1024 },
    fileData: { type: Buffer, required: true, select: false },
    submittedAt: { type: Date, required: true, default: Date.now },
    marksObtained: { type: Number, min: 0 },
    evaluationStatus: {
      type: String,
      enum: ['pending', 'evaluated', 're_evaluation_required'],
      default: 'pending',
    },
    correctness: {
      type: String,
      enum: ['correct', 'partially_correct', 'incorrect', 'not_applicable'],
    },
    feedback: { type: String, trim: true, maxlength: 5000, default: '' },
    evaluatedAt: { type: Date },
    evaluatorId: { type: mongoose.Schema.Types.ObjectId },
    evaluationHistory: { type: [evaluationSchema], default: [] },
  },
  { autoCreate: false, autoIndex: false, timestamps: true, collection: 'assignment_submissions' },
)

assignmentSubmissionSchema.index({ enrollmentId: 1, assignmentId: 1, submittedAt: -1 })

const AssignmentSubmission = mongoose.models.AssignmentSubmission
  || mongoose.model('AssignmentSubmission', assignmentSubmissionSchema, 'assignment_submissions')

export default AssignmentSubmission
