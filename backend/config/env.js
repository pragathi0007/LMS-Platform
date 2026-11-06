import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const envFilePath = path.join(backendDirectory, '.env')

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
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_PASSWORD,
  smtpFrom: process.env.SMTP_FROM,
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT || 5000,
})

export function requireJwtSecret() {
  if (typeof config.jwtSecret !== 'string' || !config.jwtSecret.trim()) {
    throw new Error('JWT_SECRET is not configured in backend/.env or the process environment.')
  }
  return config.jwtSecret
}
