import mongoose from 'mongoose'

const collegeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    address: { type: String, trim: true, maxlength: 500 },
    city: { type: String, trim: true, maxlength: 120 },
    state: { type: String, trim: true, maxlength: 120 },
    country: { type: String, trim: true, maxlength: 120 },
    contactName: { type: String, trim: true, maxlength: 120 },
    contactPhone: { type: String, trim: true, maxlength: 40 },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { autoCreate: false, autoIndex: false, strict: false, timestamps: true, collection: 'colleges' },
)
collegeSchema.index({ code: 1 }, { unique: true, name: 'unique_college_code' })

const College = mongoose.models.College || mongoose.model('College', collegeSchema, 'colleges')

export default College
