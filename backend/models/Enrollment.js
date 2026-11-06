import mongoose from 'mongoose'

const enrollmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref() {
        return this.collegeId ? 'CollegeStudent' : 'Student'
      },
      required: true,
    },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled'],
      default: 'active',
      required: true,
    },
  },
  { autoCreate: false, autoIndex: false, timestamps: true, collection: 'enrollment' },
)

const Enrollment =
  mongoose.models.Enrollment || mongoose.model('Enrollment', enrollmentSchema, 'enrollment')

export default Enrollment
