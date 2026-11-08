import mongoose from 'mongoose'
import { config } from './env.js'
import { Admin, CollegeAdmin, CollegeStudent, Student } from '../models/account-models.js'
import AccountIdentity from '../models/AccountIdentity.js'
import Course from '../models/Course.js'
import College from '../models/College.js'
import Enrollment from '../models/Enrollment.js'
import SupportTicket from '../models/SupportTicket.js'
import EmailOtpChallenge from '../models/EmailOtpChallenge.js'
import ReferralCode from '../models/ReferralCode.js'
import ReferralCodeDailyLimit from '../models/ReferralCodeDailyLimit.js'
import Notification from '../models/Notification.js'

const requiredModels = [
  Admin,
  CollegeAdmin,
  Student,
  CollegeStudent,
  AccountIdentity,
  Course,
  College,
  Enrollment,
  SupportTicket,
  EmailOtpChallenge,
  ReferralCode,
  ReferralCodeDailyLimit,
  Notification,
]

export async function connectToDatabase() {
  if (!config.mongoUri) {
    throw new Error('MONGO_URI is not set.')
  }

  await mongoose.connect(
    config.mongoUri,
    config.mongoDbName ? { dbName: config.mongoDbName } : {},
  )
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
