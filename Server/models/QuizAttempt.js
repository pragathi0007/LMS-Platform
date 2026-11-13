import mongoose from 'mongoose'

const answerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    selectedOptionIndices: { type: [{ type: Number, min: 0 }], default: [] },
    correctOptionIndices: { type: [{ type: Number, min: 0 }], default: [] },
    explanation: { type: String, trim: true, maxlength: 5000 },
  },
  { _id: false },
)

const questionSnapshotSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    prompt: { type: String, required: true },
    type: { type: String, enum: ['multiple-choice', 'multiple-select', 'true-false'], default: 'multiple-choice' },
    options: { type: [{ type: String }], default: [] },
    correctOptionIndices: { type: [{ type: Number }], default: [] },
    marks: { type: Number, min: 1, default: 1 },
    explanation: { type: String, default: '' },
  },
  { _id: false },
)

const quizAttemptSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    quizId: { type: mongoose.Schema.Types.ObjectId, required: true },
    cycleNumber: { type: Number, min: 1 },
    attemptNumber: { type: Number, min: 1, max: 3 },
    status: { type: String, enum: ['started', 'submitted'], default: 'submitted', required: true },
    startedAt: { type: Date, default: Date.now, required: true },
    passingPercentage: { type: Number, min: 1, max: 100 },
    timeLimitMinutes: { type: Number, min: 0, max: 600, default: 0 },
    timeTakenSeconds: { type: Number, min: 0 },
    questionSnapshot: { type: [questionSnapshotSchema], default: [], select: false },
    answers: { type: [answerSchema], default: [] },
    earnedPoints: { type: Number, min: 0 },
    totalPoints: { type: Number, min: 0 },
    correctAnswers: { type: Number, min: 0 },
    incorrectAnswers: { type: Number, min: 0 },
    scorePercentage: { type: Number, min: 0, max: 100 },
    passed: { type: Boolean },
    submittedAt: { type: Date },
  },
  { autoCreate: false, autoIndex: false, timestamps: true, collection: 'quiz_attempts' },
)

const QuizAttempt = mongoose.models.QuizAttempt
  || mongoose.model('QuizAttempt', quizAttemptSchema, 'quiz_attempts')

export default QuizAttempt
