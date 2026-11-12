import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const envFilePath = path.join(backendDirectory, '.env')
const defaultCourseVideoMaxBytes = 2 * 1024 * 1024 * 1024
const defaultCourseResourceMaxBytes = 50 * 1024 * 1024

function positiveSafeInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

dotenv.config({ path: envFilePath, quiet: true })

export const config = Object.freeze({
  backendDirectory,
  envFilePath,
  mongoUri: process.env.MONGO_URI,
  mongoDbName: process.env.MONGO_DB_NAME,
  jwtSecret: process.env.JWT_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  clientOrigin: process.env.CLIENT_ORIGIN,
  emailUser: process.env.EMAIL_USER,
  emailPass: process.env.EMAIL_PASS,
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM,
  geminiApiKey: process.env.GEMINI_API_KEY?.trim(),
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
  courseVideoMaxBytes: positiveSafeInteger(process.env.COURSE_VIDEO_MAX_BYTES, defaultCourseVideoMaxBytes),
  courseResourceMaxBytes: positiveSafeInteger(process.env.COURSE_RESOURCE_MAX_BYTES, defaultCourseResourceMaxBytes),
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT || 5000,
})

export function requireJwtSecret() {
  if (typeof config.jwtSecret !== 'string' || !config.jwtSecret.trim()) {
    throw new Error('JWT_SECRET is not configured in Server/.env or the process environment.')
  }
  return config.jwtSecret
}
