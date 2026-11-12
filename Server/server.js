import { config, requireJwtSecret } from './config/env.js'
import cors from 'cors'
import express from 'express'
import { connectToDatabase } from './config/db.js'
import cloudinary from './config/cloudinary.js'
import authRouter from './routes/auth.js'
import adminRouter from './routes/admin.js'
import learningRouter from './routes/learning.js'
import supportRouter from './routes/support.js'
import settingsRouter from './routes/settings.js'
import referralsRouter from './routes/referrals.js'
import notificationsRouter from './routes/notifications.js'
import certificatesRouter from './routes/certificates.js'

const app = express()
app.use(
  cors({
    origin(origin, callback) {
      const configuredOrigin = config.clientOrigin
      const isLocalDevelopmentOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '')
      const isAllowedLocalDevelopmentOrigin =
        config.nodeEnv !== 'production' && isLocalDevelopmentOrigin
      if (!origin || origin === configuredOrigin || isAllowedLocalDevelopmentOrigin) {
        return callback(null, true)
      }
      return callback(null, false)
    },
  }),
)
app.use(express.json({ limit: '8mb' }))
app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)
app.use('/api', learningRouter)
app.use('/api/support', supportRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/referrals', referralsRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/certificates', certificatesRouter)
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'API route not found.' })
})

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'The requested API endpoint was not found.' })
})

app.use((error, req, res, next) => {
  const diagnostic = {
    event: 'http.request.failed',
    method: req.method,
    path: req.path,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  }
  if (typeof error?.code === 'string' || typeof error?.code === 'number') {
    diagnostic.errorCode = error.code
  }
  if (typeof error?.codeName === 'string') {
    diagnostic.errorCodeName = error.codeName
  }
  if ([117, 31249].includes(error?.code) && typeof error?.message === 'string') {
    diagnostic.mongoMessage = error.message.slice(0, 500)
  }
  if (error?.keyPattern && typeof error.keyPattern === 'object') {
    diagnostic.mongoKeyFields = Object.keys(error.keyPattern)
  }
  console.error(JSON.stringify(diagnostic))
  if (error?.code === 11000) {
    return res.status(409).json({ message: 'An account with these details already exists.' })
  }
  res.status(500).json({ message: 'Something went wrong. Please try again.' })
})

async function verifyCloudinaryConnection() {
  if (
    !config.cloudinaryCloudName ||
    !config.cloudinaryApiKey ||
    !config.cloudinaryApiSecret
  ) {
    console.error('Cloudinary verification failed (CLOUDINARY_* settings are missing).')
    return
  }

  let timeoutId
  try {
    await Promise.race([
      cloudinary.api.resources({ resource_type: 'video', type: 'upload', max_results: 1 }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error('Cloudinary verification timed out.')
          error.code = 'CLOUDINARY_TIMEOUT'
          reject(error)
        }, 5000)
      }),
    ])
    console.log('Connected to Cloudinary.')
  } catch (error) {
    const result = Number.isInteger(error?.http_code)
      ? `HTTP ${error.http_code}`
      : error?.code === 'CLOUDINARY_TIMEOUT' ? 'timed out' : 'request failed'
    console.error(`Cloudinary verification failed (${result}).`)
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function redactMongoUris(value) {
  return String(value).replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, (uri) => {
    try {
      const parsed = new URL(uri)
      const port = parsed.port ? `:${parsed.port}` : ''
      return `${parsed.protocol}//${parsed.hostname}${port}${parsed.pathname}`
    } catch {
      return '[MongoDB connection string redacted]'
    }
  })
}

function logStartupFailure(error) {
  const cause = error?.cause instanceof Error ? error.cause : error
  const message = cause instanceof Error ? cause.message : String(cause)
  const indexName = message.match(/\bindex:\s+([^\s]+)/i)?.[1]
  const diagnostic = {
    event: 'backend.startup.failed',
    errorName: cause instanceof Error ? cause.name : 'UnknownError',
    errorMessage: redactMongoUris(message).slice(0, 1200),
    jwtSecretConfigured: Boolean(config.jwtSecret),
    mongoUriConfigured: Boolean(config.mongoUri),
    ...(error?.operation ? { operation: error.operation } : {}),
    ...(error?.collection ? { collection: error.collection } : {}),
    ...(cause?.code !== undefined ? { errorCode: cause.code } : {}),
    ...(cause?.codeName ? { errorCodeName: cause.codeName } : {}),
    ...(indexName ? { indexName } : {}),
    ...(cause?.keyPattern ? { keyFields: Object.keys(cause.keyPattern) } : {}),
  }
  console.error(JSON.stringify(diagnostic))
}

async function startServer() {
  try {
    requireJwtSecret()
    await connectToDatabase()
    app.listen(config.port, async () => {
      await verifyCloudinaryConnection()
      console.log(`LMS backend listening on port ${config.port}.`)
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('JWT_SECRET is not configured')) {
      console.error('JWT_SECRET is not configured; the backend was not started.')
    } else {
      logStartupFailure(error)
    }
    process.exit(1)
  }
}

startServer()
