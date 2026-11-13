const invalidSessionMessages = new Set([
  'a valid access token is required.',
  'the access token is invalid.',
  'the access token is invalid or expired.',
  'authentication is required.',
])

let refreshRequest

export function isInvalidSessionResponse(response, result) {
  const message = typeof result?.message === 'string'
    ? result.message.trim().toLowerCase()
    : ''
  return response.status === 401 && invalidSessionMessages.has(message)
}

export async function refreshAuthSession(apiBaseUrl) {
  if (!refreshRequest) {
    refreshRequest = (async () => {
      const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      const result = await response.json().catch(() => null)
      if (response.status === 401 || response.status === 403) return null
      if (!response.ok) throw new Error(result?.message || 'Your session could not be refreshed.')
      if (typeof result?.token !== 'string' || typeof result.user?.id !== 'string') {
        throw new Error('The server returned invalid session refresh details.')
      }
      sessionStorage.setItem('lms.auth', JSON.stringify({ token: result.token, user: result.user }))
      return { token: result.token, user: result.user }
    })().finally(() => {
      refreshRequest = undefined
    })
  }
  return refreshRequest
}

export async function fetchWithAuth(url, options, apiBaseUrl, token) {
  const send = (accessToken) => fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const response = await send(token)
  if (response.status !== 401) return response
  const result = await response.clone().json().catch(() => null)
  if (!isInvalidSessionResponse(response, result)) return response
  const refreshed = await refreshAuthSession(apiBaseUrl)
  return refreshed ? send(refreshed.token) : response
}
