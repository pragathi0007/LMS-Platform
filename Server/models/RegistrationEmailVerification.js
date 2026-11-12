import mongoose from 'mongoose'

const registrationEmailVerificationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    hashedOtp: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    verificationExpiresAt: { type: Date, default: null },
    cleanupAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0, max: 5 },
    requestCount: { type: Number, default: 1, min: 1, max: 5 },
    requestWindowStartedAt: { type: Date, required: true },
    lastSentAt: { type: Date, required: true },
    verifiedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    invalidatedAt: { type: Date, default: null },
  },
  {
    autoCreate: false,
    autoIndex: false,
    timestamps: true,
    collection: 'registrationemailverifications',
  },
)

registrationEmailVerificationSchema.index(
  { email: 1 },
  { unique: true, name: 'registration_email_unique' },
)
registrationEmailVerificationSchema.index(
  { cleanupAt: 1 },
  { expireAfterSeconds: 0, name: 'registration_email_verification_cleanup' },
)

const RegistrationEmailVerification =
  mongoose.models.RegistrationEmailVerification ||
  mongoose.model(
    'RegistrationEmailVerification',
    registrationEmailVerificationSchema,
    'registrationemailverifications',
  )

export default RegistrationEmailVerification
