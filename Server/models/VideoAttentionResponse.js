import mongoose from 'mongoose'

const videoAttentionResponseSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref() {
        return this.collegeId ? 'CollegeStudent' : 'Student'
      },
      required: true,
    },
    collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    lessonId: { type: mongoose.Schema.Types.ObjectId, required: true },
    lessonTitle: { type: String, required: true, maxlength: 200 },
    sessionId: { type: String, required: true, maxlength: 64 },
    triggerIndex: { type: Number, required: true, min: 0, max: 99 },
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    questionPrompt: { type: String, required: true, maxlength: 2000 },
    questionType: { type: String, enum: ['multiple-choice', 'multiple-select', 'true-false'], required: true },
    options: { type: [{ type: String }], required: true },
    correctOptionIndices: { type: [{ type: Number }], required: true, select: false },
    selectedOptionIndices: { type: [{ type: Number }], default: [] },
    videoPositionSeconds: { type: Number, required: true, min: 0, max: 43200 },
    presentedAt: { type: Date, required: true, default: Date.now },
    answeredAt: { type: Date },
    responseTimeMs: { type: Number, min: 0 },
    isCorrect: { type: Boolean },
    status: { type: String, enum: ['presented', 'answered', 'not_answered'], default: 'presented', required: true },
  },
  { autoCreate: false, autoIndex: false, timestamps: true, collection: 'video_attention_responses' },
)

videoAttentionResponseSchema.index({ userId: 1, enrollmentId: 1, lessonId: 1, sessionId: 1, triggerIndex: 1 }, { unique: true })

const VideoAttentionResponse = mongoose.models.VideoAttentionResponse
  || mongoose.model('VideoAttentionResponse', videoAttentionResponseSchema, 'video_attention_responses')

export default VideoAttentionResponse
