import { config, requireJwtSecret } from './config/env.js'
import cors from 'cors'
import express from 'express'
import { connectToDatabase } from './config/db.js'
import authRouter from './routes/auth.js'

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
app.use(express.json())
app.use('/api/auth', authRouter)

app.use((error, req, res, next) => {
  console.error(`Request failed (${error instanceof Error ? error.name : 'Unknown error'}).`)
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
