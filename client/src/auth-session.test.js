import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { fetchWithAuth } from './auth-session.js'

const originalFetch = globalThis.fetch
const originalSessionStorage = globalThis.sessionStorage

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalSessionStorage === undefined) delete globalThis.sessionStorage
  else globalThis.sessionStorage = originalSessionStorage
})

function installSessionStorage() {
  const values = new Map()
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  }
  return values
}

test('authenticated requests refresh an expired token and retry with the new token', async () => {
  const storedValues = installSessionStorage()
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    if (url.endsWith('/auth/refresh')) {
      return new Response(JSON.stringify({
        token: 'new-access-token',
        user: { id: 'student-1', role: 'student' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (requests.filter(({ url: requestUrl }) => requestUrl.endsWith('/enrollments')).length === 1) {
      return new Response(JSON.stringify({ message: 'The access token is invalid or expired.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ enrollment: { _id: 'enrollment-1' } }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const response = await fetchWithAuth(
    'https://lms.example/api/enrollments',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    'https://lms.example/api',
    'expired-access-token',
  )

  assert.equal(response.status, 201)
  assert.equal(requests.length, 3)
  assert.equal(requests[0].options.headers.Authorization, 'Bearer expired-access-token')
  assert.equal(requests[1].options.credentials, 'include')
  assert.equal(requests[2].options.headers.Authorization, 'Bearer new-access-token')
  assert.deepEqual(JSON.parse(storedValues.get('lms.auth')), {
    token: 'new-access-token',
    user: { id: 'student-1', role: 'student' },
  })
})

test('expired sessions without a refresh cookie remain rejected', async () => {
  installSessionStorage()
  const requests = []
  globalThis.fetch = async (url) => {
    requests.push(url)
    if (url.endsWith('/auth/refresh')) {
      return new Response(JSON.stringify({ message: 'Your session has expired. Sign in again.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ message: 'A valid access token is required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const response = await fetchWithAuth(
    'https://lms.example/api/enrollments',
    { method: 'POST', body: '{}' },
    'https://lms.example/api',
    'stale-access-token',
  )

  assert.equal(response.status, 401)
  assert.deepEqual(requests, [
    'https://lms.example/api/enrollments',
    'https://lms.example/api/auth/refresh',
  ])
})
