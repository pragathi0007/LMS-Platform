import mongoose from 'mongoose'

const accountIdentitySchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    googleSub: { type: String, unique: true, sparse: true, select: false },
    googleEmail: { type: String, lowercase: true, trim: true, select: false },
    pendingEmail: { type: String, lowercase: true, trim: true, select: false },
    pendingEmailVerificationCodeHash: { type: String, select: false },
    pendingEmailVerificationExpiresAt: { type: Date, select: false },
    pendingEmailVerificationRequestedAt: { type: Date, select: false },
    pendingEmailVerificationAttempts: { type: Number, default: 0, select: false },
    accountCollection: {
      type: String,
      required: true,
      enum: ['admin', 'sub_admins', 'students', 'clg_students'],
    },
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
    migratedFromLegacy: { type: Boolean, default: false },
  },
  { autoCreate: false, autoIndex: false, timestamps: true, collection: 'accountidentities' },
)

accountIdentitySchema.index(
  { username: 1 },
  {
    unique: true,
    name: 'username_case_insensitive_unique',
    collation: { locale: 'en', strength: 2 },
  },
)
accountIdentitySchema.index({ accountCollection: 1, accountId: 1 }, { unique: true })
accountIdentitySchema.index(
  { googleEmail: 1 },
  {
    unique: true,
    sparse: true,
    name: 'google_email_case_insensitive_unique',
    collation: { locale: 'en', strength: 2 },
  },
)

const AccountIdentity =
  mongoose.models.AccountIdentity ||
  mongoose.model('AccountIdentity', accountIdentitySchema, 'accountidentities')

export default AccountIdentity
