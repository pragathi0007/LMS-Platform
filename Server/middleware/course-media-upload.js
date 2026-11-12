import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import multer from 'multer'
import { config } from '../config/env.js'

const videoTypes = new Map([
  ['.mp4', new Set(['video/mp4'])],
  ['.m4v', new Set(['video/mp4', 'video/x-m4v'])],
  ['.mov', new Set(['video/quicktime'])],
  ['.webm', new Set(['video/webm'])],
  ['.ogv', new Set(['video/ogg', 'application/ogg'])],
  ['.avi', new Set(['video/x-msvideo', 'video/avi'])],
  ['.mkv', new Set(['video/x-matroska'])],
])

const resourceTypes = new Map([
  ['.pdf', new Set(['application/pdf'])],
  ['.png', new Set(['image/png'])],
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])],
  ['.webp', new Set(['image/webp'])],
])

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    callback(null, tmpdir())
  },
  filename(_req, _file, callback) {
    callback(null, `aihustle-course-${randomUUID()}`)
  },
})

function fileFilter(allowedTypes, { allowUnknownMime = false } = {}) {
  return (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase()
    const acceptedMimes = allowedTypes.get(extension)
    const mimeIsUnknown = !file.mimetype || file.mimetype === 'application/octet-stream'
    if (!acceptedMimes || (!acceptedMimes.has(file.mimetype) && !(allowUnknownMime && mimeIsUnknown))) {
      const error = new Error('Choose a supported file whose extension matches its file type.')
      error.statusCode = 415
      callback(error)
      return
    }
    callback(null, true)
  }
}

function createUpload(allowedTypes, maxBytes, options) {
  return multer({
    storage,
    limits: { fileSize: maxBytes, files: 1, fields: 4, parts: 5 },
    fileFilter: fileFilter(allowedTypes, options),
  }).single('file')
}

function formatUploadLimit(maxBytes) {
  const gigabyte = 1024 ** 3
  if (maxBytes >= gigabyte) return `${Math.round(maxBytes / gigabyte)} GB`
  return `${Math.round(maxBytes / (1024 ** 2))} MB`
}

function handleUploadError(upload, maxBytes, fileLabel) {
  return (req, res, next) => upload(req, res, (error) => {
    if (!error) return next()
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: `The selected ${fileLabel} exceeds the ${formatUploadLimit(maxBytes)} upload limit.` })
    }
    if (error.statusCode === 415) return res.status(415).json({ message: error.message })
    if (error instanceof multer.MulterError) return res.status(400).json({ message: 'The upload request is invalid.' })
    return next(error)
  })
}

export const receiveCourseVideo = handleUploadError(
  createUpload(videoTypes, config.courseVideoMaxBytes, { allowUnknownMime: true }),
  config.courseVideoMaxBytes,
  'video',
)
export const receiveCourseResource = handleUploadError(
  createUpload(resourceTypes, config.courseResourceMaxBytes),
  config.courseResourceMaxBytes,
  'resource',
)