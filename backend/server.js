import { config, requireJwtSecret } from './config/env.js'
import cors from 'cors'
import express from 'express'
import { connectToDatabase } from './config/db.js'
import authRouter from './routes/auth.js'
import adminRouter from './routes/admin.js'
import learningRouter from './routes/learning.js'
import supportRouter from './routes/support.js'
import settingsRouter from './routes/settings.js'
import referralsRouter from './routes/referrals.js'
import notificationsRouter from './routes/notifications.js'

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

async function startServer() {
  try {
    requireJwtSecret()
    await connectToDatabase()
    app.listen(config.port, () => {
      console.log(`LMS backend listening on port ${config.port}.`)
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('JWT_SECRET is not configured')) {
      console.error('JWT_SECRET is not configured; the backend was not started.')
    } else {
      const errorName = error instanceof Error ? error.name : 'Unknown error'
      console.error(
        `Backend startup failed (${errorName}). Check JWT_SECRET, MONGO_URI, and Atlas network access.`,
      )
    }
    process.exit(1)
  }
}

startServer()
