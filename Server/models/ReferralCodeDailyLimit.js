import mongoose from 'mongoose'

const referralCodeDailyLimitSchema = new mongoose.Schema(
  {
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    dayStart: { type: Date, required: true },
    count: { type: Number, required: true, default: 0, min: 0, max: 5 },
  },
  {
    autoCreate: false,
    autoIndex: false,
    timestamps: true,
    collection: 'referralCodeDailyLimits',
  },
)

referralCodeDailyLimitSchema.index(
  { generatedBy: 1, dayStart: 1 },
  { unique: true, name: 'unique_referral_daily_limit' },
)

const ReferralCodeDailyLimit = mongoose.models.ReferralCodeDailyLimit
  || mongoose.model('ReferralCodeDailyLimit', referralCodeDailyLimitSchema, 'referralCodeDailyLimits')

export default ReferralCodeDailyLimit
