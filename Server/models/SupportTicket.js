import mongoose from 'mongoose'

const ticketStatuses = ['Open', 'In Progress', 'Waiting for User', 'Resolved', 'Closed']
const ticketCategories = [
  'Account and Login',
  'Course and Enrollment',
  'Assignments and Results',
  'Payments and Purchases',
  'Technical Issue',
  'Other',
]
const ticketPriorities = ['Low', 'Medium', 'High']

const attachmentSchema = new mongoose.Schema(
  {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true, maxlength: 120 },
    contentType: { type: String, required: true, enum: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] },
    size: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 },
    data: { type: Buffer, required: true, select: false },
  },
  { _id: false },
)

const replySchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    authorRole: { type: String, enum: ['student', 'admin'], required: true },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

const statusHistorySchema = new mongoose.Schema(
  {
    from: { type: String, enum: ticketStatuses },
    to: { type: String, enum: ticketStatuses, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    changedByRole: { type: String, enum: ['student', 'admin'], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

const priorityHistorySchema = new mongoose.Schema(
  {
    from: { type: String, enum: ticketPriorities },
    to: { type: String, enum: ticketPriorities, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    changedByRole: { type: String, enum: ['admin'], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

const supportTicketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userCollection: { type: String, enum: ['students', 'clg_students'], required: true },
    accountType: { type: String, enum: ['independent', 'college'], required: true },
    collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
    subject: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
    category: { type: String, required: true, enum: ticketCategories },
    priority: { type: String, required: true, enum: ticketPriorities },
    description: { type: String, required: true, trim: true, minlength: 10, maxlength: 10000 },
    attachment: { type: attachmentSchema },
    status: { type: String, required: true, enum: ticketStatuses, default: 'Open' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    replies: { type: [replySchema], default: [] },
    statusHistory: { type: [statusHistorySchema], default: [] },
    priorityHistory: { type: [priorityHistorySchema], default: [] },
  },
  { autoCreate: false, autoIndex: false, timestamps: true, collection: 'supporttickets' },
)

supportTicketSchema.index({ userId: 1, updatedAt: -1 })
supportTicketSchema.index({ collegeId: 1, updatedAt: -1 })
supportTicketSchema.index({ status: 1, category: 1, priority: 1, updatedAt: -1 })

const SupportTicket =
  mongoose.models.SupportTicket ||
  mongoose.model('SupportTicket', supportTicketSchema, 'supporttickets')

export { ticketCategories, ticketPriorities, ticketStatuses }
export default SupportTicket
