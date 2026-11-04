import dotenv from 'dotenv'
import cors from 'cors'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectToDatabase } from './config/db.js'
import authRouter from './routes/auth.js'

const backendDirectory = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(backendDirectory, '.env') })

const app = express()
app.use(
  cors({
    origin(origin, callback) {
      const configuredOrigin = process.env.CLIENT_ORIGIN
      const isLocalDevelopmentOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '')
      if (!origin || origin === configuredOrigin || (!configuredOrigin && isLocalDevelopmentOrigin)) {
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

const port = process.env.PORT || 5000

async function startServer() {
  try {
    await connectToDatabase()
    app.listen(port, () => {
      console.log(`LMS backend listening on port ${port}.`)
    })
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'Unknown error'
    console.error(
      `Failed to connect to MongoDB; the server was not started (${errorName}). Check MONGO_URI and Atlas network access.`,
    )
    process.exit(1)
  }
}

startServer()
