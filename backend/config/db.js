import mongoose from 'mongoose'
import { config } from './env.js'

export async function connectToDatabase() {
  if (!config.mongoUri) {
    throw new Error('MONGO_URI is not set.')
  }

  await mongoose.connect(config.mongoUri)
  console.log('Connected to MongoDB Atlas.')
}
