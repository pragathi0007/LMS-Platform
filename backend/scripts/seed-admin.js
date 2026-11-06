import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { config } from '../config/env.js'
import { connectToDatabase } from '../config/db.js'
import AccountIdentity from '../models/AccountIdentity.js'
import { Admin } from '../models/account-models.js'

async function seedAdmin() {
  const email = config.adminEmail?.trim().toLowerCase()
  const password = config.adminPassword
  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env before seeding.')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_EMAIL must be a valid email address.')
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters.')
  }
  await connectToDatabase()

  const existingAdmin = await Admin.findOne({ username: 'admin' })
  if (existingAdmin) {
    console.log('Admin account already exists; no changes made.')
    return
  }

  const duplicate = await AccountIdentity.findOne({
    $or: [{ email }, { username: 'admin' }],
  })
  if (duplicate) {
    throw new Error('The admin email or username is already assigned to another account.')
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const accountId = new mongoose.Types.ObjectId()
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      await AccountIdentity.create(
        [{ email, username: 'admin', accountCollection: Admin.collection.name, accountId }],
        { session },
      )
      await Admin.create(
        [{
          _id: accountId,
          username: 'admin',
          email,
          passwordHash,
          status: 'active',
          permissions: ['*'],
        }],
        { session },
      )
    })
    console.log('Admin account created successfully.')
  } catch (error) {
    if (error?.code === 11000) {
      const adminCreatedConcurrently = await Admin.exists({ username: 'admin' })
      if (adminCreatedConcurrently) {
        console.log('Admin account already exists; no changes made.')
        return
      }
    }
    throw error
  } finally {
    await session.endSession()
  }
}

try {
  await seedAdmin()
} catch (error) {
  console.error(`Admin seed failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
