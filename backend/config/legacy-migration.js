import mongoose from 'mongoose'
import AccountIdentity from '../models/AccountIdentity.js'
import { accountModelsByRole } from '../models/account-models.js'

const legacyRoles = new Map([
  ['student', 'student'],
  ['user', 'student'],
  ['instructor', 'instructor'],
  ['admin', 'admin'],
])

function legacyMigrationError(message) {
  const error = new Error(message)
  error.code = 'LEGACY_MIGRATION_REQUIRED'
  return error
}

export async function assertLegacyAccountsMigrated() {
  const database = mongoose.connection.db
  const legacyCollectionExists = await database.listCollections({ name: 'users' }).hasNext()
  if (!legacyCollectionExists) return

  const legacyUsers = database.collection('users')
  for await (const legacyAccount of legacyUsers.find(
    {},
    { projection: { role: 1, email: 1, username: 1, passwordHash: 1 } },
  )) {
    const role = legacyRoles.get(String(legacyAccount.role || '').toLowerCase())
    const AccountModel = role ? accountModelsByRole[role] : null
    if (!AccountModel) {
      throw legacyMigrationError('Legacy users contain an unsupported role; resolve it before starting authentication.')
    }

    const [identity, account] = await Promise.all([
      AccountIdentity.findOne({
        accountCollection: AccountModel.collection.name,
        accountId: legacyAccount._id,
        migratedFromLegacy: true,
      }).lean(),
      database.collection(AccountModel.collection.name).findOne(
        { _id: legacyAccount._id },
        { projection: { role: 1, email: 1, username: 1, passwordHash: 1 } },
      ),
    ])
    if (
      !identity ||
      !account ||
      account.role !== role ||
      String(account.email).trim().toLowerCase() !== String(legacyAccount.email).trim().toLowerCase() ||
      String(account.username).trim().toLowerCase() !== String(legacyAccount.username).trim().toLowerCase() ||
      account.passwordHash !== legacyAccount.passwordHash ||
      identity.email !== String(legacyAccount.email).trim().toLowerCase() ||
      identity.username !== String(legacyAccount.username).trim().toLowerCase()
    ) {
      throw legacyMigrationError('Legacy accounts have not all been copied. Run `npm run migrate:users`, review the report, then run `npm run migrate:users -- --apply` before starting the backend.')
    }
  }
}
