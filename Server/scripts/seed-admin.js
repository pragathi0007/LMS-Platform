import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { pathToFileURL } from 'node:url'
import { config } from '../config/env.js'
import { connectToDatabase } from '../config/db.js'
import AccountIdentity from '../models/AccountIdentity.js'
import { Admin } from '../models/account-models.js'

export async function createAdminAccount({
  email: configuredEmail = config.adminEmail,
  password = config.adminPassword,
  connect = true,
} = {}) {
  const email = configuredEmail?.trim().toLowerCase()
  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in Server/.env before seeding.')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_EMAIL must be a valid email address.')
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters.')
  }
  if (connect) await connectToDatabase()

  const existingAdmin = await Admin.findOne({ username: 'admin' })
  if (existingAdmin) {
    console.log('Admin account already exists; no changes made.')
    return existingAdmin
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
          role: 'main_admin',
          status: 'active',
          permissions: ['*'],
        }],
        { session },
      )
    })
    console.log('Admin account created successfully.')
    return await Admin.findOne({ _id: accountId })
  } catch (error) {
    if (error?.code === 11000) {
      const adminCreatedConcurrently = await Admin.exists({ username: 'admin' })
      if (adminCreatedConcurrently) {
        console.log('Admin account already exists; no changes made.')
        return await Admin.findOne({ username: 'admin' })
      }
    }
    throw error
  } finally {
    await session.endSession()
  }
}

export async function seedAdmin() {
  return createAdminAccount()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await seedAdmin()
  } catch (error) {
    console.error(`Admin seed failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}
