import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import mongoose from 'mongoose'
import { config } from '../config/env.js'
import AccountIdentity from '../models/AccountIdentity.js'
import { Admin, CollegeAdmin, CollegeStudent, Student } from '../models/account-models.js'
import College from '../models/College.js'
import Course from '../models/Course.js'
import Enrollment from '../models/Enrollment.js'
import { createAdminAccount } from './seed-admin.js'

const databaseName = 'LMS'
const backupDirectory = process.env.LMS_BACKUP_DIR
const expectedCollections = [
  'accountidentities',
  'admin',
  'clg_students',
  'colleges',
  'courses',
  'enrollment',
  'students',
  'sub_admins',
]
const models = [Admin, CollegeAdmin, Student, CollegeStudent, AccountIdentity, College, Course, Enrollment]
const BSON = mongoose.mongo.BSON

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function deploymentFingerprint() {
  const hostname = new URL(config.mongoUri).hostname.toLowerCase()
  return hash(hostname)
}

function decodeBson(buffer) {
  let offset = 0
  let count = 0
  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) throw new Error('Backup BSON ended before a document header.')
    const length = buffer.readInt32LE(offset)
    if (length < 5 || offset + length > buffer.length) throw new Error('Backup BSON contains an invalid document length.')
    BSON.deserialize(buffer.subarray(offset, offset + length))
    offset += length
    count += 1
  }
  return count
}

async function loadVerifiedBackup() {
  if (!backupDirectory) throw new Error('Set LMS_BACKUP_DIR to the verified pre-reset backup directory.')
  const manifestPath = path.join(backupDirectory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    manifest.database !== databaseName ||
    manifest.deploymentFingerprint !== deploymentFingerprint() ||
    manifest.verified !== true ||
    !Array.isArray(manifest.collections)
  ) {
    throw new Error('The backup manifest is not a verified backup of LMS.')
  }
  for (const item of manifest.collections) {
    const bson = await readFile(path.join(backupDirectory, item.bsonFile))
    const metadata = BSON.EJSON.parse(await readFile(path.join(backupDirectory, item.metadataFile), 'utf8'))
    if (
      bson.length !== item.bsonBytes ||
      hash(bson) !== item.bsonSha256 ||
      decodeBson(bson) !== item.documentCount ||
      metadata.collection?.name !== item.name ||
      metadata.indexes?.length !== item.indexCount
    ) {
      throw new Error(`Backup verification failed for "${item.name}".`)
    }
  }
  return manifest
}

async function getInventory(database) {
  const collections = await database.listCollections({}, { nameOnly: true }).toArray()
  const inventory = []
  for (const { name } of collections) {
    const digest = createHash('sha256')
    let documentCount = 0
    for await (const document of database.collection(name).find({}).sort({ _id: 1 }).batchSize(500)) {
      digest.update(BSON.serialize(document))
      documentCount += 1
    }
    inventory.push({ name, documentCount, bsonSha256: digest.digest('hex') })
  }
  return inventory.sort((left, right) => left.name.localeCompare(right.name))
}

function verifyMatchesBackup(inventory, manifest) {
  const expected = new Map(manifest.collections.map((item) => [item.name, item]))
  assert.deepEqual(inventory.map(({ name }) => name), [...expected.keys()].sort(), 'LMS collections changed since backup; refusing to reset.')
  for (const item of inventory) {
    const backup = expected.get(item.name)
    if (item.documentCount !== backup.documentCount || item.bsonSha256 !== backup.bsonSha256) {
      throw new Error(`LMS collection "${item.name}" changed since backup; refusing to reset.`)
    }
  }
}

async function createFreshStructure(database) {
  for (const name of expectedCollections) {
    await database.createCollection(name)
  }
  for (const model of models) await model.createIndexes()
}

async function resetDatabase() {
  const args = process.argv.slice(2)
  const planOnly = args.includes('--plan')
  const execute = args.includes('--execute')
  const confirmed = args.includes('--confirm=RESET-LMS-AFTER-BACKUP')
  if (planOnly === execute || (execute && !confirmed) || args.some((arg) => (
    !['--plan', '--execute', '--confirm=RESET-LMS-AFTER-BACKUP'].includes(arg)
  ))) {
    throw new Error(
      'Use --plan, or --execute --confirm=RESET-LMS-AFTER-BACKUP after reviewing the verified backup and deletion list.',
    )
  }
  if (!config.mongoUri) throw new Error('MONGO_URI is not configured.')
  if (
    typeof config.adminEmail !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.adminEmail.trim()) ||
    typeof config.adminPassword !== 'string' ||
    config.adminPassword.length < 12
  ) {
    throw new Error('Valid ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters are required before reset.')
  }
  const manifest = await loadVerifiedBackup()
  await mongoose.connect(config.mongoUri, { dbName: databaseName, serverSelectionTimeoutMS: 15000 })
  try {
    const database = mongoose.connection.db
    if (database.databaseName !== databaseName) {
      throw new Error(`Refusing reset: connected to unexpected database "${database.databaseName}".`)
    }
    const inventory = await getInventory(database)
    verifyMatchesBackup(inventory, manifest)
    console.log(JSON.stringify({
      database: databaseName,
      backupVerified: true,
      backupCreatedAt: manifest.createdAt,
      deleteDatabase: true,
      exactDeletionList: inventory,
    }))
    if (planOnly) return

    await database.dropDatabase()
    await createFreshStructure(database)
    await createAdminAccount({ connect: false })

    const actualNames = (await database.listCollections({}, { nameOnly: true }).toArray())
      .map(({ name }) => name).sort()
    assert.deepEqual(actualNames, expectedCollections, 'Fresh LMS contains unexpected or missing collections.')
    const mainAdmin = await Admin.findOne({ username: 'admin' }).select('+passwordHash').lean()
    assert.ok(mainAdmin?.passwordHash)
    assert.equal(mainAdmin.role, 'main_admin')
    const identity = await AccountIdentity.findOne({
      accountCollection: 'admin',
      accountId: mainAdmin._id,
    }).lean()
    assert.ok(identity)
    assert.equal(identity.email, mainAdmin.email)
    assert.equal(identity.username, mainAdmin.username)
    console.log(JSON.stringify({
      database: databaseName,
      resetCompleted: true,
      createdCollections: actualNames,
      initialMainAdminCreated: true,
      identityMappingVerified: true,
    }))
  } finally {
    await mongoose.disconnect()
  }
}

resetDatabase().catch((error) => {
  console.error(`LMS reset failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  process.exitCode = 1
})
