import mongoose from 'mongoose'

const accountIdentitySchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    googleSub: { type: String, unique: true, sparse: true, select: false },
    accountCollection: {
      type: String,
      required: true,
      enum: ['users', 'students', 'instructors', 'admins', 'admin'],
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

const AccountIdentity =
  mongoose.models.AccountIdentity ||
  mongoose.model('AccountIdentity', accountIdentitySchema, 'accountidentities')

export default AccountIdentity
