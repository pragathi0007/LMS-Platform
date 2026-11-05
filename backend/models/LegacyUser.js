import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true, maxlength: 120 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    professionalDetails: { type: String, trim: true, maxlength: 2000 },
    role: {
      type: String,
      enum: ['student', 'instructor', 'admin'],
      required: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ['active', 'approved', 'pending', 'rejected', 'inactive', 'suspended'],
      default: 'active',
      lowercase: true,
    },
    approvalStatus: { type: String, lowercase: true },
    isActive: { type: Boolean, default: true },
    permissions: { type: [String], default: [] },
  },
  { timestamps: true },
)

const LegacyUser =
  mongoose.models.LegacyUser || mongoose.model('LegacyUser', userSchema, 'users')

export default LegacyUser
