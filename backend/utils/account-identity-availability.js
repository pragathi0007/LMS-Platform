import mongoose from 'mongoose'
import AccountIdentity from '../models/AccountIdentity.js'
import { accountModelsByCollection } from '../models/account-models.js'

function exactMatchPatterns(values) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()))]
    .map((value) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))
}

function withoutCurrentAccount(query, excludedAccount) {
  if (!excludedAccount) return query
  const accountId = new mongoose.Types.ObjectId(excludedAccount.accountId)
  return {
    ...query,
    $nor: [{
      accountCollection: excludedAccount.accountCollection,
      accountId,
    }],
  }
}

async function findTakenValues(field, values, { excludedAccount, includePendingEmail = false } = {}) {
  const patterns = exactMatchPatterns(values)
  if (!patterns.length) return new Set()
  const valueQuery = includePendingEmail
    ? {
      $or: [
        { email: { $in: patterns } },
        { pendingEmail: { $in: patterns } },
        { googleEmail: { $in: patterns } },
      ],
    }
    : { [field]: { $in: patterns } }
  const identityQuery = withoutCurrentAccount(valueQuery, excludedAccount)
  const database = mongoose.connection.db
  if (!database) throw new Error('The database is not connected.')

  const resultSets = await Promise.all([
    AccountIdentity.find(identityQuery).select('+googleEmail username email pendingEmail').lean(),
    ...Object.values(accountModelsByCollection).map((AccountModel) => {
      const currentCollection = AccountModel.collection.name === excludedAccount?.accountCollection
      const collectionQuery = {
        [field]: { $in: patterns },
        ...(currentCollection
          ? { _id: { $ne: new mongoose.Types.ObjectId(excludedAccount.accountId) } }
          : {}),
      }
      return database.collection(AccountModel.collection.name)
        .find(collectionQuery, { projection: { [field]: 1, _id: 0 } })
        .toArray()
    }),
  ])
  const fields = includePendingEmail ? ['email', 'pendingEmail', 'googleEmail'] : [field]

  return new Set(resultSets.flatMap((accounts) => accounts.flatMap((account) =>
    fields
      .map((candidateField) => account[candidateField])
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim().toLowerCase()),
  )))
}

export function findTakenUsernames(usernames, options) {
  return findTakenValues('username', usernames, options)
}

export function findTakenEmails(emails, options) {
  return findTakenValues('email', emails, { ...options, includePendingEmail: true })
}
