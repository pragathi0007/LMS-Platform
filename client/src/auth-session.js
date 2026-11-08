const invalidSessionMessages = new Set([
  'a valid access token is required.',
  'the access token is invalid.',
  'the access token is invalid or expired.',
  'authentication is required.',
])

export function isInvalidSessionResponse(response, result) {
  const message = typeof result?.message === 'string'
    ? result.message.trim().toLowerCase()
    : ''
  return response.status === 401 && invalidSessionMessages.has(message)
}
