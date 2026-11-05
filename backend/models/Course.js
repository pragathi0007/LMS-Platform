import mongoose from 'mongoose'

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 10000 },
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Instructor',
      required: true,
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
    },
  },
  { autoCreate: false, autoIndex: false, timestamps: true, collection: 'courses' },
)

const Course = mongoose.models.Course || mongoose.model('Course', courseSchema, 'courses')

export default Course
