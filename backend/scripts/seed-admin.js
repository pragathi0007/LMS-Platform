import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectToDatabase } from '../config/db.js'
import User from '../models/User.js'

const backendDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
dotenv.config({ path: path.join(backendDirectory, '.env'), quiet: true })

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
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

  const existingAdmin = await User.findOne({ username: 'admin' })
  if (existingAdmin) {
    if (existingAdmin.role !== 'admin') {
      throw new Error('The username "admin" is already assigned to a non-admin account.')
    }
    console.log('Admin account already exists; no changes made.')
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  try {
    await User.create({
      username: 'admin',
      email,
      passwordHash,
      role: 'admin',
      status: 'active',
      permissions: ['*'],
    })
    console.log('Admin account created successfully.')
  } catch (error) {
    if (error?.code === 11000) {
      const adminCreatedConcurrently = await User.exists({ username: 'admin', role: 'admin' })
      if (adminCreatedConcurrently) {
        console.log('Admin account already exists; no changes made.')
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
