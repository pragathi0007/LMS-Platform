import mongoose from 'mongoose'

const quizAttemptStateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    quizId: { type: mongoose.Schema.Types.ObjectId, required: true },
    cycleNumber: { type: Number, min: 1, default: 1, required: true },
    attemptsUsed: { type: Number, min: 0, max: 3, default: 0, required: true },
    passed: { type: Boolean, default: false, required: true },
    lockedUntil: { type: Date, default: null },
  },
  { autoCreate: false, autoIndex: false, timestamps: true, collection: 'quiz_attempt_states' },
)

quizAttemptStateSchema.index(
  { userId: 1, courseId: 1, quizId: 1 },
  { unique: true },
)

const QuizAttemptState = mongoose.models.QuizAttemptState
  || mongoose.model('QuizAttemptState', quizAttemptStateSchema, 'quiz_attempt_states')

export default QuizAttemptState
