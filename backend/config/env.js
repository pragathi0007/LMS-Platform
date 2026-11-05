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
  jwtSecret: process.env.JWT_SECRET,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  clientOrigin: process.env.CLIENT_ORIGIN,
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT || 5000,
})

export function requireJwtSecret() {
  if (typeof config.jwtSecret !== 'string' || !config.jwtSecret.trim()) {
    throw new Error('JWT_SECRET is not configured in backend/.env or the process environment.')
  }
  return config.jwtSecret
}
