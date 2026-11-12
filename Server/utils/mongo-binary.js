export function toMongoBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value?._bsontype !== 'Binary' || typeof value.value !== 'function') return null

  const bytes = value.value(true)
  if (Buffer.isBuffer(bytes)) return bytes
  return ArrayBuffer.isView(bytes) ? Buffer.from(bytes) : null
}
