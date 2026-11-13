import mongoose from 'mongoose'

const refreshSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    accountCollection: { type: String, enum: ['students', 'clg_students'], required: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true },
  },
  { autoCreate: false, autoIndex: false, timestamps: true, collection: 'refresh_sessions' },
)

refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const RefreshSession = mongoose.models.RefreshSession
  || mongoose.model('RefreshSession', refreshSessionSchema, 'refresh_sessions')

export default RefreshSession
