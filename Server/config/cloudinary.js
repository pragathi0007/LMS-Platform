import { v2 as cloudinary } from 'cloudinary'
import { config } from './env.js'

cloudinary.config({
  cloud_name: config.cloudinaryCloudName,
  api_key: config.cloudinaryApiKey,
  api_secret: config.cloudinaryApiSecret,
  secure: true,
})

export default cloudinary