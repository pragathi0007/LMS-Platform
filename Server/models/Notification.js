import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema(
  {
    recipientRole: { type: String, enum: ['main_admin', 'student'], required: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId },
    type: {
      type: String,
      enum: ['independent_student_registered', 'independent_student_approved', 'independent_student_rejected'],
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 1200 },
    link: { type: String, trim: true, maxlength: 300 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { autoCreate: false, autoIndex: false, timestamps: true, collection: 'notifications' },
)

notificationSchema.index({ recipientRole: 1, recipientId: 1, createdAt: -1 })

const Notification =
  mongoose.models.Notification ||
  mongoose.model('Notification', notificationSchema, 'notifications')

export default Notification
