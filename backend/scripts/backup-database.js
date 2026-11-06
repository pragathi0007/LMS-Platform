import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { once } from 'node:events'
import mongoose from 'mongoose'
import { config } from '../config/env.js'

const databaseName = 'LMS'
const backupDirectory = process.env.LMS_BACKUP_DIR
const BSON = mongoose.mongo.BSON

if (!config.mongoUri) throw new Error('MONGO_URI is not configured.')
if (!backupDirectory) throw new Error('Set LMS_BACKUP_DIR to a protected backup directory outside the repository.')

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function deploymentFingerprint() {
  const hostname = new URL(config.mongoUri).hostname.toLowerCase()
  return hash(hostname)
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain')
}

function verifyBson(buffer) {
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

await mkdir(backupDirectory, { recursive: true })
if ((await readdir(backupDirectory)).length) {
  throw new Error('LMS_BACKUP_DIR must be empty so the backup cannot overwrite existing files.')
}

await mongoose.connect(config.mongoUri, { dbName: databaseName, serverSelectionTimeoutMS: 15000 })
try {
  const database = mongoose.connection.db
  if (database.databaseName !== databaseName) {
    throw new Error(`Refusing backup: connected to unexpected database "${database.databaseName}".`)
  }

  const collections = await database.listCollections({}, { nameOnly: false }).toArray()
  const manifest = {
    database: databaseName,
    deploymentFingerprint: deploymentFingerprint(),
    createdAt: new Date().toISOString(),
    collections: [],
    verified: false,
  }

  for (const collectionInfo of collections) {
    const name = collectionInfo.name
    if (name.startsWith('system.')) continue
    const collection = database.collection(name)
    const indexes = await collection.listIndexes().toArray()
    const metadata = { collection: collectionInfo, indexes }
    const metadataText = BSON.EJSON.stringify(metadata, { relaxed: false })
    const metadataFile = `${name}.metadata.json`
    await writeFile(path.join(backupDirectory, metadataFile), metadataText, { flag: 'wx' })

    const bsonFile = `${name}.bson`
    const stream = createWriteStream(path.join(backupDirectory, bsonFile), { flags: 'wx' })
    const digest = createHash('sha256')
    let documentCount = 0
    for await (const document of collection.find({}).sort({ _id: 1 }).batchSize(500)) {
      const bytes = BSON.serialize(document)
      digest.update(bytes)
      await writeChunk(stream, bytes)
      documentCount += 1
    }
    stream.end()
    await once(stream, 'finish')

    const bsonPath = path.join(backupDirectory, bsonFile)
    const bsonStats = await stat(bsonPath)
    const bsonBytes = await readFile(bsonPath)
    const verifiedCount = verifyBson(bsonBytes)
    const verifiedHash = hash(bsonBytes)
    const sourceDigestAfter = createHash('sha256')
    let sourceCountAfter = 0
    for await (const document of collection.find({}).sort({ _id: 1 }).batchSize(500)) {
      sourceDigestAfter.update(BSON.serialize(document))
      sourceCountAfter += 1
    }
    if (
      verifiedCount !== documentCount ||
      sourceCountAfter !== documentCount ||
      verifiedHash !== digest.digest('hex') ||
      sourceDigestAfter.digest('hex') !== verifiedHash
    ) {
      throw new Error(`Backup verification failed for collection "${name}".`)
    }

    manifest.collections.push({
      name,
      documentCount,
      indexCount: indexes.length,
      metadataFile,
      bsonFile,
      bsonBytes: bsonStats.size,
      bsonSha256: verifiedHash,
    })
  }

  manifest.verified = true
  manifest.verification = 'All BSON documents decoded; per-collection counts, byte hashes, index metadata, and post-copy source counts recorded.'
  const manifestPath = path.join(backupDirectory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({
    database: database.databaseName,
    backupDirectory: path.resolve(backupDirectory),
    collectionCount: manifest.collections.length,
    documentCount: manifest.collections.reduce((total, item) => total + item.documentCount, 0),
    manifestSha256: hash(await readFile(manifestPath)),
    verified: manifest.verified,
  }))
} finally {
  await mongoose.disconnect()
}
