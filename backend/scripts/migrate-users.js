import mongoose from 'mongoose'
import { config } from '../config/env.js'
import AccountIdentity from '../models/AccountIdentity.js'
import { accountModelsByRole } from '../models/account-models.js'

const applyChanges = process.argv.includes('--apply')
const roleMap = new Map([
  ['student', 'student'],
  ['user', 'student'],
  ['instructor', 'instructor'],
  ['admin', 'admin'],
])

function normalizedKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function findSourceCollisions(accounts, field) {
  const seen = new Map()
  const conflicts = []
  for (const account of accounts) {
    const key = account[field]
    if (!key) continue
    const first = seen.get(key)
    if (first && String(first.document._id) !== String(account.document._id)) {
      conflicts.push({ id: String(account.document._id), reason: `duplicate legacy ${field}` })
    } else {
      seen.set(key, account)
    }
  }
  return conflicts
}

async function findConflictingTargetAccount(database, account, expectedCollection) {
  for (const AccountModel of Object.values(accountModelsByRole)) {
    const existing = await database.collection(AccountModel.collection.name).findOne({
      $or: [
        { _id: account.document._id },
        { email: account.email },
        { username: account.username },
      ],
    })
    if (existing && AccountModel.collection.name !== expectedCollection) {
      return true
    }
    if (
      existing &&
      (String(existing._id) !== String(account.document._id) ||
        normalizedKey(existing.email) !== account.email ||
        normalizedKey(existing.username) !== account.username)
    ) {
      return true
    }
  }
  return false
}

async function migrateUsers() {
  if (!config.mongoUri) throw new Error('MONGO_URI is not configured.')
  await mongoose.connect(config.mongoUri, { dbName: 'lms' })
  const database = mongoose.connection.db
  const hasUsers = await database.listCollections({ name: 'users' }).hasNext()
  if (!hasUsers) {
    console.log('No legacy users collection exists in lms; no migration is needed.')
    return
  }

  const sourceDocuments = await database.collection('users').find({}).toArray()
  const accounts = sourceDocuments.map((document) => {
    const role = roleMap.get(String(document.role || '').toLowerCase())
    return {
      document,
      role,
      email: normalizedKey(document.email),
      username: normalizedKey(document.username),
    }
  })

  const conflicts = []
  for (const account of accounts) {
    if (!account.role) conflicts.push({ id: String(account.document._id), reason: 'unsupported role' })
    if (!account.email || !account.username) {
      conflicts.push({ id: String(account.document._id), reason: 'missing email or username' })
    }
  }
  conflicts.push(...findSourceCollisions(accounts, 'email'))
  conflicts.push(...findSourceCollisions(accounts, 'username'))

  const plans = []
  for (const account of accounts) {
    if (!account.role || !account.email || !account.username) continue
    const AccountModel = accountModelsByRole[account.role]
    const collectionName = AccountModel.collection.name
    const identity = await AccountIdentity.findOne({
      $or: [{ email: account.email }, { username: account.username }, {
        accountCollection: collectionName,
        accountId: account.document._id,
      }],
    }).lean()
    const targetAccount = await database.collection(collectionName).findOne({ _id: account.document._id })

    if (
      identity &&
      targetAccount &&
      identity.accountCollection === collectionName &&
      String(identity.accountId) === String(account.document._id) &&
      identity.email === account.email &&
      identity.username === account.username &&
      identity.migratedFromLegacy === true &&
      normalizedKey(targetAccount.email) === account.email &&
      normalizedKey(targetAccount.username) === account.username &&
      targetAccount.role === account.role &&
      targetAccount.passwordHash === account.document.passwordHash
    ) {
      plans.push({ ...account, AccountModel, collectionName, alreadyMigrated: true })
      continue
    }

    if (
      identity ||
      targetAccount ||
      await findConflictingTargetAccount(database, account, collectionName)
    ) {
      conflicts.push({ id: String(account.document._id), reason: 'target account or identity conflict' })
      continue
    }
    plans.push({ ...account, AccountModel, collectionName, alreadyMigrated: false })
  }

  const counts = { student: 0, instructor: 0, admin: 0, alreadyMigrated: 0 }
  for (const plan of plans) {
    if (plan.alreadyMigrated) counts.alreadyMigrated += 1
    else counts[plan.role] += 1
  }
  console.log(JSON.stringify({ mode: applyChanges ? 'apply' : 'dry-run', sourceCount: sourceDocuments.length, planned: counts, conflictCount: conflicts.length }))
  for (const conflict of conflicts) {
    console.error(`Conflict for legacy account ${conflict.id}: ${conflict.reason}.`)
  }
  if (conflicts.length) {
    throw new Error('Resolve all migration conflicts before applying the migration.')
  }
  if (!applyChanges) {
    console.log('Dry run only. No documents, collections, or indexes were written.')
    return
  }

  for (const AccountModel of Object.values(accountModelsByRole)) {
    await AccountModel.createIndexes()
  }
  await AccountIdentity.createIndexes()

  for (const plan of plans) {
    if (plan.alreadyMigrated) continue
    const document = {
      ...plan.document,
      email: plan.email,
      username: plan.username,
      role: plan.role,
    }
    if (!document.status) {
      document.status = plan.role === 'instructor'
        ? String(document.approvalStatus || 'pending').toLowerCase()
        : 'active'
    }

    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        await AccountIdentity.create(
          [{
            email: plan.email,
            username: plan.username,
            accountCollection: plan.collectionName,
            accountId: plan.document._id,
            migratedFromLegacy: true,
          }],
          { session },
        )
        await database.collection(plan.collectionName).insertOne(document, { session })
      })
    } finally {
      await session.endSession()
    }
  }

  let verifiedCount = 0
  for (const account of accounts) {
    const role = account.role
    const AccountModel = role ? accountModelsByRole[role] : null
    if (!AccountModel) continue
    const [targetAccount, identity] = await Promise.all([
      database.collection(AccountModel.collection.name).findOne({ _id: account.document._id }),
      AccountIdentity.findOne({
        accountCollection: AccountModel.collection.name,
        accountId: account.document._id,
        migratedFromLegacy: true,
      }).lean(),
    ])
    if (
      !targetAccount ||
      !identity ||
      normalizedKey(targetAccount.email) !== account.email ||
      normalizedKey(targetAccount.username) !== account.username ||
      targetAccount.role !== role ||
      targetAccount.passwordHash !== account.document.passwordHash ||
      identity.email !== account.email ||
      identity.username !== account.username
    ) {
      throw new Error(`Post-migration verification failed for legacy account ${String(account.document._id)}.`)
    }
    verifiedCount += 1
  }

  console.log(`Migration copy and verification completed for ${verifiedCount} accounts. The legacy users collection was left unchanged.`)
}

try {
  await migrateUsers()
} catch (error) {
  console.error(`User migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
