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
    instructorDetails: {
      countryCode: { type: String, trim: true },
      phone: { type: String, trim: true },
      professionalTitle: { type: String, trim: true, maxlength: 100 },
      expertise: [{ type: String, trim: true }],
      subjects: [{ type: String, trim: true }],
      customSubjects: [{ type: String, trim: true }],
      experience: { type: String, trim: true },
      languages: [{ type: String, trim: true }],
      customLanguage: { type: String, trim: true, maxlength: 60 },
      profilePicture: {
        data: Buffer,
        contentType: { type: String, trim: true },
      },
    },
  },
  { timestamps: true },
)

const User = mongoose.models.User || mongoose.model('User', userSchema)

export default User
