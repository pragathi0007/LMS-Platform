import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { config } from './config/env.js'
import { connectToDatabase } from './config/db.js'
import User from './models/User.js'

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
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('ADMIN_PASSWORD must be no more than 72 bytes.')
  }

  await connectToDatabase()

  const existingAdmin = await User.findOne({ role: 'admin' })
  if (existingAdmin) {
    console.log('An admin account already exists; no changes made.')
    return
  }

  const conflictingUser = await User.findOne({
    $or: [{ username: 'admin' }, { email }],
  })
  if (conflictingUser) {
    throw new Error('The username "admin" or configured email is already assigned to another account.')
  }

  const passwordHash = await bcrypt.hash(password, 12)
  try {
    await User.create({
      username: 'admin',
      email,
      passwordHash,
      role: 'admin',
      status: 'active',
      isActive: true,
      permissions: ['*'],
    })
    console.log('Admin account created successfully.')
  } catch (error) {
    if (error?.code === 11000) {
      const adminCreatedConcurrently = await User.exists({ role: 'admin' })
      if (adminCreatedConcurrently) {
        console.log('An admin account already exists; no changes made.')
        return
      }
    }
    throw error
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
