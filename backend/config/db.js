import mongoose from 'mongoose'

export async function connectToDatabase() {
  const uri = process.env.MONGO_URI
  if (!uri) {
    throw new Error('MONGO_URI is not set.')
  }

  await mongoose.connect(uri)
  console.log('Connected to MongoDB Atlas.')
}
