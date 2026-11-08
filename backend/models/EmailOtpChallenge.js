import mongoose from 'mongoose'

const emailOtpChallengeSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    accountCollection: {
      type: String,
      enum: ['students', 'clg_students'],
      required: true,
    },
    purpose: {
      type: String,
      enum: ['login', 'settings_enable', 'settings_disable'],
      required: true,
    },
    hashedOtp: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    cleanupAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    verifiedAt: { type: Date },
    invalidatedAt: { type: Date },
    lastSentAt: { type: Date, required: true },
  },
  {
    autoCreate: false,
    autoIndex: false,
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'emailotpchallenges',
  },
)

emailOtpChallengeSchema.index({ cleanupAt: 1 }, { expireAfterSeconds: 0, name: 'email_otp_cleanup' })
emailOtpChallengeSchema.index(
  { studentId: 1, accountCollection: 1, purpose: 1, createdAt: -1 },
  { name: 'student_email_otp_history' },
)

const EmailOtpChallenge =
  mongoose.models.EmailOtpChallenge ||
  mongoose.model('EmailOtpChallenge', emailOtpChallengeSchema, 'emailotpchallenges')

export default EmailOtpChallenge
