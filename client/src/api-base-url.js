const configuredApiBaseUrl = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:5000/api'
).replace(/\/+$/, '')

export const API_BASE_URL = /\/api$/i.test(configuredApiBaseUrl)
  ? configuredApiBaseUrl
  : `${configuredApiBaseUrl}/api`
