import mongoose from 'mongoose'

const passwordResetTokenSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    accountCollection: {
      type: String,
      required: true,
      enum: ['admin', 'sub_admins', 'students', 'clg_students'],
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    cleanupAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  {
    autoCreate: false,
    autoIndex: false,
    timestamps: true,
    collection: 'passwordresettokens',
  },
)

passwordResetTokenSchema.index(
  { cleanupAt: 1 },
  { expireAfterSeconds: 0, name: 'password_reset_token_cleanup' },
)
passwordResetTokenSchema.index(
  { tokenHash: 1 },
  { unique: true, name: 'password_reset_token_hash_unique' },
)
passwordResetTokenSchema.index(
  { accountId: 1, usedAt: 1 },
  { name: 'password_reset_account_lookup' },
)

const PasswordResetToken =
  mongoose.models.PasswordResetToken ||
  mongoose.model('PasswordResetToken', passwordResetTokenSchema, 'passwordresettokens')

export default PasswordResetToken

