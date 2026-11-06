import mongoose from 'mongoose'

const lessonSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, trim: true, maxlength: 20000 },
    videoUrl: { type: String, trim: true, maxlength: 2048 },
    order: { type: Number, min: 0, default: 0 },
  },
  { _id: true },
)

const moduleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000 },
    order: { type: Number, min: 0, default: 0 },
    lessons: { type: [lessonSchema], default: [] },
  },
  { _id: true },
)

const assignmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 10000 },
    dueDate: { type: Date },
    points: { type: Number, min: 0, default: 0 },
  },
  { _id: true },
)

const quizQuestionSchema = new mongoose.Schema(
  {
    prompt: { type: String, required: true, trim: true, maxlength: 2000 },
    options: { type: [String], required: true, validate: (options) => options.length >= 2 && options.length <= 10 },
    correctOptionIndex: { type: Number, required: true, min: 0, select: false },
  },
  { _id: true },
)

const quizSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 10000 },
    questions: { type: [quizQuestionSchema], default: [] },
  },
  { _id: true },
)

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 10000 },
    modules: { type: [moduleSchema], default: [] },
    assignments: { type: [assignmentSchema], default: [] },
    quizzes: { type: [quizSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
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
