import mongoose from 'mongoose'

const resourceSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 200 },
    url: { type: String, trim: true, maxlength: 2048 },
    publicId: { type: String, trim: true, maxlength: 255 },
    resourceType: { type: String, enum: ['raw', 'image', 'video'], default: 'raw' },
    format: { type: String, trim: true, maxlength: 20 },
    bytes: { type: Number, min: 0 },
  },
  { _id: true },
)

const attentionCheckQuestionSchema = new mongoose.Schema(
  {
    prompt: { type: String, required: true, trim: true, maxlength: 2000 },
    type: { type: String, enum: ['multiple-choice', 'multiple-select', 'true-false'], default: 'multiple-choice' },
    options: { type: [String], required: true, validate: (options) => options.length >= 2 && options.length <= 10 },
    selectedForPlayback: { type: Boolean, default: false },
    correctOptionIndices: { type: [Number], required: true, select: false },
  },
  { _id: true },
)

const attentionCheckSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    questionsDuringVideo: { type: Number, min: 1, max: 100, default: 1 },
    minIntervalSeconds: { type: Number, min: 10, max: 7200, default: 120 },
    maxIntervalSeconds: { type: Number, min: 10, max: 7200, default: 300 },
    questions: { type: [attentionCheckQuestionSchema], default: [] },
  },
  { _id: false },
)

const lessonSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 10000 },
    content: { type: String, trim: true, maxlength: 20000 },
    videoUrl: { type: String, trim: true, maxlength: 2048 },
    videoPublicId: { type: String, trim: true, maxlength: 255 },
    videoFormat: { type: String, trim: true, maxlength: 20 },
    videoBytes: { type: Number, min: 0 },
    durationSeconds: { type: Number, min: 0, default: 0 },
    requiredForCertificate: { type: Boolean, default: true },
    resources: { type: [resourceSchema], default: [] },
    attentionCheck: { type: attentionCheckSchema, default: undefined },
    order: { type: Number, min: 0, default: 0 },
  },
  { _id: true, timestamps: true },
)

const moduleQuizQuestionSchema = new mongoose.Schema(
  {
    prompt: { type: String, required: true, trim: true, maxlength: 2000 },
    type: { type: String, enum: ['multiple-choice', 'multiple-select', 'true-false'], default: 'multiple-choice' },
    options: { type: [String], required: true, validate: (options) => options.length >= 2 && options.length <= 10 },
    correctOptionIndices: { type: [Number], required: true, select: false },
    explanation: { type: String, trim: true, maxlength: 5000 },
    marks: { type: Number, min: 1, default: 1 },
    order: { type: Number, min: 0, default: 0 },
  },
  { _id: true },
)

const moduleQuizSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 200 },
    passingPercentage: { type: Number, min: 1, max: 100, default: 70 },
    maxAttempts: { type: Number, min: 1, max: 20, default: 3 },
    timeLimitMinutes: { type: Number, min: 0, max: 600, default: 0 },
    requiredForCertificate: { type: Boolean, default: true },
    questions: { type: [moduleQuizQuestionSchema], default: [] },
  },
  { _id: true },
)

const moduleContentItemSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['video-lesson', 'quiz', 'assignment', 'note'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 10000 },
    content: { type: String, trim: true, maxlength: 20000 },
    videoUrl: { type: String, trim: true, maxlength: 2048 },
    videoPublicId: { type: String, trim: true, maxlength: 255 },
    videoFormat: { type: String, trim: true, maxlength: 20 },
    videoBytes: { type: Number, min: 0 },
    durationSeconds: { type: Number, min: 0, default: 0 },
    resources: { type: [resourceSchema], default: [] },
    dueDate: { type: Date },
    points: { type: Number, min: 0, default: 0 },
    requiredForCertificate: { type: Boolean, default: true },
    attentionCheck: { type: attentionCheckSchema, default: undefined },
    quiz: { type: moduleQuizSchema, default: undefined },
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
    quiz: { type: moduleQuizSchema, default: undefined },
    contentItems: { type: [moduleContentItemSchema], default: [] },
  },
  { _id: true },
)

const assignmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 10000 },
    dueDate: { type: Date },
    points: { type: Number, min: 0, default: 0 },
    requiredForCertificate: { type: Boolean, default: true },
  },
  { _id: true },
)

const quizQuestionSchema = new mongoose.Schema(
  {
    prompt: { type: String, required: true, trim: true, maxlength: 2000 },
    options: { type: [String], required: true, validate: (options) => options.length >= 2 && options.length <= 10 },
    correctOptionIndex: { type: Number, required: true, min: 0, select: false },
    explanation: { type: String, trim: true, maxlength: 5000 },
  },
  { _id: true },
)

const quizSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 10000 },
    passingPercentage: { type: Number, min: 1, max: 100, default: 70 },
    maxAttempts: { type: Number, min: 1, max: 20, default: 3 },
    timeLimitMinutes: { type: Number, min: 0, max: 600, default: 0 },
    requiredForCertificate: { type: Boolean, default: true },
    questions: { type: [quizQuestionSchema], default: [] },
  },
  { _id: true },
)

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 10000 },
    detailedDescription: { type: String, trim: true, maxlength: 10000 },
    category: { type: String, trim: true, maxlength: 80, default: 'Other' },
    difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced', 'all-levels'], default: 'beginner' },
    thumbnailUrl: { type: String, trim: true, maxlength: 2048 },
    thumbnailPublicId: { type: String, trim: true, maxlength: 255 },
    learningObjectives: { type: [String], default: [] },
    prerequisites: { type: [String], default: [] },
    estimatedDurationMinutes: { type: Number, min: 0, default: 0 },
    generateCertificate: { type: Boolean, default: true },
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
