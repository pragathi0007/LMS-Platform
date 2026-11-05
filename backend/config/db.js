import mongoose from 'mongoose'
import { config } from './env.js'
import { Admin, Instructor, Student } from '../models/account-models.js'
import AccountIdentity from '../models/AccountIdentity.js'
import Course from '../models/Course.js'

const requiredModels = [Student, Instructor, Admin, AccountIdentity, Course]

export async function connectToDatabase() {
  if (!config.mongoUri) {
    throw new Error('MONGO_URI is not set.')
  }

  await mongoose.connect(config.mongoUri, { dbName: 'lms' })
  const database = mongoose.connection.db
  for (const model of requiredModels) {
    const collectionExists = await database.listCollections({ name: model.collection.name }).hasNext()
    if (!collectionExists) {
      try {
        await database.createCollection(model.collection.name)
      } catch (error) {
        if (error?.code !== 48) throw error
      }
    }
    await model.createIndexes()
  }
  console.log('Connected to MongoDB Atlas.')
}
