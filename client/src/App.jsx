import React, { useEffect, useRef, useState } from 'react'
import AdminDashboard from './AdminDashboard.jsx'
import CollegeAdminDashboard from './CollegeAdminDashboard.jsx'
import StudentDashboard from './StudentDashboard.jsx'
import { useLocation } from 'react-router-dom'
import './App.css'

function getPasswordStrength(password) {
  return [
    password.length >= 8,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length
}
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/+$/, '')
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
let googleIdentityServicesPromise
const DASHBOARD_PATHS = {
  student: '/student/dashboard',
  main_admin: '/admin/dashboard',
  college_admin: '/college-admin/dashboard',
}
const DASHBOARD_API_ROLES = {
  student: 'student',
  main_admin: 'main_admin',
  college_admin: 'college_admin',
}
const AUTH_ROLE_KEYS = {
  Student: 'student',
  'Main Admin': 'main_admin',
  'College Sub-Admin': 'college_admin',
}

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve(window.google.accounts.oauth2)
  }
  if (!googleIdentityServicesPromise) {
    googleIdentityServicesPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = () => {
        if (window.google?.accounts?.oauth2) {
          resolve(window.google.accounts.oauth2)
        } else {
          googleIdentityServicesPromise = undefined
          reject(new Error('Google Sign-In could not be loaded. Please try again.'))
        }
      }
      script.onerror = () => {
        googleIdentityServicesPromise = undefined
        reject(new Error('Google Sign-In could not be loaded. Check your connection and try again.'))
      }
      document.head.appendChild(script)
    })
  }
  return googleIdentityServicesPromise
}

async function readApiResponse(response) {
  const responseText = await response.text()
  let result

  try {
    result = JSON.parse(responseText)
  } catch {
    const isGoogleEndpoint = new URL(response.url).pathname.endsWith('/auth/google')
    if (isGoogleEndpoint && response.status === 404) {
      throw new Error(
        'The backend does not recognize Google sign-in (HTTP 404). Restart the backend from the backend folder and try again.',
      )
    }
    throw new Error(
      `The server returned a non-JSON response (HTTP ${response.status}). Check the API URL and backend version.`,
    )
  }
  if (!result || typeof result !== 'object') {
    throw new Error('The server returned an invalid response. Please try again later.')
  }
  return result
}

async function registerAccount(payload) {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await readApiResponse(response)

  if (!response.ok) {
    const error = new Error(
      typeof result.message === 'string' ? result.message : 'Registration failed. Please try again.',
    )
    error.fieldErrors = result.fieldErrors
    throw error
  }

  return result
}

async function checkUsernameAvailability(username, signal) {
  const query = new URLSearchParams({ username })
  const response = await fetch(`${API_BASE_URL}/auth/check-username?${query}`, { signal })
  const result = await readApiResponse(response)

  if (!response.ok) {
    throw new Error(
      typeof result.message === 'string'
        ? result.message
        : 'Username availability could not be checked. Please try again.',
    )
  }
  if (typeof result.available !== 'boolean' || !Array.isArray(result.suggestions)) {
    throw new Error('The server returned an invalid username availability response.')
  }

  return result
}

function BrandMark() {
  return (
    <a className="brand" href="#" aria-label="LMS home">
      <img src="/logo.png" alt="LMS logo" />
    </a>
  )
}

function PasswordField({ id, name = id, label, value, onChange, autoComplete, strength }) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => {
            event.currentTarget.setCustomValidity('')
            onChange(event)
          }}
          autoComplete={autoComplete}
          minLength={8}
          required
        />
        <button
          className="visibility-toggle"
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {strength !== undefined && (
        <div className="password-strength" aria-live="polite">
          <div className="password-strength-bars" aria-hidden="true">
            {[1, 2, 3, 4].map((level) => (
              <span key={level} className={strength >= level ? `is-level-${strength}` : ''} />
            ))}
          </div>
          <span>
            {value.length === 0
              ? 'Use 8+ characters with a mix of letters, numbers, and symbols.'
              : ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][strength]}
          </span>
        </div>
      )}
    </div>
  )
}

function AuthForm({ mode, role, onMessage, onRegistrationSuccess }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState('idle')
  const [usernameSuggestions, setUsernameSuggestions] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false)
  const [googleClientLoadError, setGoogleClientLoadError] = useState('')
  const googleAttempt = useRef(null)
  const googleCodeHandler = useRef(null)
  const googleCodeClient = useRef(null)
  const onMessageRef = useRef(onMessage)
  const isRegistering = mode === 'register'
  const roleKey = AUTH_ROLE_KEYS[role]
  const isAdministrativeRole = roleKey === 'main_admin' || roleKey === 'college_admin'

  onMessageRef.current = onMessage

  useEffect(() => {
    if (!isRegistering) {
      setUsernameStatus('idle')
      setUsernameSuggestions([])
      return undefined
    }

    const normalizedUsername = username.trim().toLowerCase()
    if (!normalizedUsername) {
      setUsernameStatus('idle')
      setUsernameSuggestions([])
      return undefined
    }
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(normalizedUsername)) {
      setUsernameStatus('invalid')
      setUsernameSuggestions([])
      return undefined
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      setUsernameStatus('checking')
      try {
        const result = await checkUsernameAvailability(normalizedUsername, controller.signal)
        if (controller.signal.aborted) return
        setUsernameStatus(result.available ? 'available' : 'taken')
        setUsernameSuggestions(result.available ? [] : result.suggestions)
      } catch {
        if (!controller.signal.aborted) {
          setUsernameStatus('error')
          setUsernameSuggestions([])
        }
      }
    }, 450)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [isRegistering, username])

  useEffect(() => {
    if (isRegistering || isAdministrativeRole || !GOOGLE_CLIENT_ID) return undefined

    let cancelled = false
    loadGoogleIdentityServices()
      .then((googleOAuth) => {
        if (cancelled) return
        googleCodeClient.current = googleOAuth.initCodeClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile',
          ux_mode: 'popup',
          select_account: true,
          callback: (codeResponse) => googleCodeHandler.current?.(codeResponse),
          error_callback: (error) => {
            const attempt = googleAttempt.current
            if (!attempt?.active) return
            attempt.active = false
            window.clearTimeout(attempt.timeoutId)
            setIsGoogleSubmitting(false)
            onMessageRef.current(
              error.type === 'popup_closed'
                ? 'Google sign-in was cancelled.'
                : error.type === 'popup_failed_to_open'
                  ? 'The Google sign-in popup could not be opened. Allow popups and try again.'
                  : 'Google sign-in could not be started. Please try again.',
              'error',
            )
          },
        })
        setGoogleClientLoadError('')
      })
      .catch(() => {
        if (!cancelled) {
          setGoogleClientLoadError('Google Sign-In could not be loaded. Check your connection and refresh the page.')
        }
      })

    return () => {
      cancelled = true
      googleCodeClient.current = null
    }
  }, [isRegistering, isAdministrativeRole])

  async function handleSubmit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const identifier = form.elements.identifier

    if (!isRegistering && identifier.value.includes('@')) {
      identifier.setCustomValidity(
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.value)
          ? ''
          : 'Enter a valid email address or username.',
      )
    } else if (!isRegistering) {
      identifier.setCustomValidity(
        /^[a-zA-Z0-9._-]{3,30}$/.test(identifier.value)
          ? ''
          : 'Use 3–30 letters, numbers, dots, underscores, or hyphens.',
      )
    }

    if (isRegistering) {
      const usernameInput = form.elements.username
      const normalizedUsername = usernameInput.value.trim().toLowerCase()
      const usernameIsValid = /^[a-zA-Z0-9._-]{3,30}$/.test(normalizedUsername)
      usernameInput.setCustomValidity(
        !usernameIsValid
          ? 'Use 3–30 letters, numbers, dots, underscores, or hyphens.'
          : usernameStatus !== 'available' ||
              normalizedUsername !== username.trim().toLowerCase()
            ? 'Wait until this username is confirmed as available.'
            : '',
      )
    }

    if (!form.reportValidity()) return

    if (isRegistering && password !== confirmPassword) {
      onMessage('Your passwords don’t match. Please check and try again.', 'error')
      return
    }

    setIsSubmitting(true)
    onMessage('')
    try {
      let response
      let result
      let authenticatedRole = roleKey
      const loginRoles = ['student', 'main_admin', 'college_admin']
      for (const candidateRole of isRegistering ? ['student'] : loginRoles) {
        response = await fetch(`${API_BASE_URL}/auth/${isRegistering ? 'register' : 'login'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isRegistering
            ? {
                fullName: form.elements.fullName.value,
                email: form.elements.email.value,
                username: form.elements.username.value,
                password,
                confirmPassword,
                role: 'student',
                accountType: 'independent',
              }
            : {
                identifier: identifier.value,
                password,
                role: candidateRole,
              }),
        })
        result = await readApiResponse(response)
        if (response.ok) {
          authenticatedRole = candidateRole
          break
        }
        if (!isRegistering && response.status === 401) continue
        throw new Error(
          typeof result.message === 'string'
            ? result.message
            : `${isRegistering ? 'Registration' : 'Login'} failed. Please try again.`,
        )
      }

      if (!response.ok) {
        throw new Error('Invalid username/email or password.')
      }

      if (isRegistering) {
        if (response.status !== 201 || typeof result.user?.id !== 'string') {
          throw new Error('The server could not confirm account creation. Please try again.')
        }

        onRegistrationSuccess('Your account was created successfully. You can now log in.')
        return
      }

      if (
        typeof result.token !== 'string' ||
        typeof result.user?.id !== 'string' ||
        result.user.role !== authenticatedRole
      ) {
        throw new Error('The server returned incomplete or mismatched login details.')
      }

      sessionStorage.setItem('lms.auth', JSON.stringify({ token: result.token, user: result.user }))
      window.location.assign(DASHBOARD_PATHS[result.user.role])
    } catch (error) {
      onMessage(
        error instanceof TypeError
          ? 'Could not connect to the server. Check that the backend is running and try again.'
          : error instanceof Error
            ? error.message
            : `${isRegistering ? 'Registration' : 'Login'} failed. Please try again.`,
        'error',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    googleCodeHandler.current = async (codeResponse) => {
      const attempt = googleAttempt.current
      if (!attempt?.active) return
      attempt.codeReceived = true
      window.clearTimeout(attempt.timeoutId)
      if (typeof codeResponse?.error === 'string') {
        attempt.active = false
        setIsGoogleSubmitting(false)
        onMessage(
          codeResponse.error === 'access_denied'
            ? 'Google sign-in was cancelled.'
            : 'Google authorization failed. Please try again.',
          'error',
        )
        return
      }
      console.info('Google OAuth callback received', {
        hasAuthorizationCode: typeof codeResponse?.code === 'string' && Boolean(codeResponse.code),
      })
      if (typeof codeResponse?.code !== 'string' || !codeResponse.code) {
        attempt.active = false
        setIsGoogleSubmitting(false)
        onMessage('Google did not return an authorization code. Please try again.', 'error')
        return
      }

      try {
        const response = await fetch(`${API_BASE_URL}/auth/google`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XmlHttpRequest',
          },
          body: JSON.stringify({
            code: codeResponse.code,
            role: attempt.role,
          }),
        })
        const result = await readApiResponse(response)
        if (!response.ok) {
          if (result.message === 'A valid Google credential is required.') {
            throw new Error(
              'The backend is running an outdated Google sign-in route. Stop the LMS backend and restart it from the project backend folder.',
            )
          }
          throw new Error(
            typeof result.message === 'string'
              ? result.message
              : 'Google sign-in failed. Please try again.',
          )
        }

        if (
          typeof result.token !== 'string' ||
          typeof result.user?.id !== 'string' ||
          result.user.role !== attempt.role
        ) {
          throw new Error('The server returned incomplete or mismatched login details.')
        }

        attempt.active = false
        sessionStorage.setItem('lms.auth', JSON.stringify({ token: result.token, user: result.user }))
        window.location.assign(DASHBOARD_PATHS[result.user.role])
      } catch (error) {
        attempt.active = false
        onMessage(
          error instanceof TypeError
            ? 'Could not connect to the server. Check that the backend is running and try again.'
            : error instanceof Error
              ? error.message
              : 'Google sign-in failed. Please try again.',
          'error',
        )
      } finally {
        setIsGoogleSubmitting(false)
      }
    }
  }, [onMessage])

  function handleGoogleSignIn() {
    if (!GOOGLE_CLIENT_ID) {
      onMessage('Google sign-in is not configured for this frontend.', 'error')
      return
    }
    if (!googleCodeClient.current) {
      onMessage(googleClientLoadError || 'Google Sign-In is still loading. Please try again in a moment.', 'error')
      return
    }

    setIsGoogleSubmitting(true)
    onMessage('')
    googleAttempt.current = {
      role: roleKey,
      active: true,
      codeReceived: false,
      timeoutId: window.setTimeout(() => {
        const attempt = googleAttempt.current
        if (!attempt?.active || attempt.codeReceived) return
        attempt.active = false
        setIsGoogleSubmitting(false)
        onMessage('Google sign-in timed out. Please try again.', 'error')
      }, 120000),
    }
    try {
      googleCodeClient.current.requestCode()
    } catch {
      window.clearTimeout(googleAttempt.current.timeoutId)
      googleAttempt.current.active = false
      setIsGoogleSubmitting(false)
      onMessage('Google sign-in could not be started. Please try again.', 'error')
    }
  }

  const title = isRegistering
    ? 'Your next chapter starts here.'
    : isAdministrativeRole
      ? 'Welcome back.'
      : 'A little closer to your goals.'

  return (
    <form
      className={isRegistering ? 'auth-form' : 'auth-form login-form'}
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="form-heading">
        {isRegistering && <p className="eyebrow">CREATE YOUR ACCOUNT</p>}
        <h1>{isRegistering ? title : 'Login'}</h1>
        <p className="form-subtitle">
          {isRegistering
            ? 'Build a learning habit that takes you somewhere new.'
            : title}
        </p>
      </div>

      <div className="form-fields">
        {isRegistering && (
          <div className="field">
            <label htmlFor="full-name">Full name</label>
            <input id="full-name" name="fullName" type="text" autoComplete="name" required />
          </div>
        )}

        {isRegistering ? (
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="identifier">Username or email</label>
            <input
              id="identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              onChange={(event) => event.currentTarget.setCustomValidity('')}
              required
            />
          </div>
        )}

        {isRegistering && (
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              minLength={3}
              maxLength={30}
              title="Use 3–30 letters, numbers, dots, underscores, or hyphens."
              value={username}
              aria-describedby="username-availability"
              required
              onChange={(event) => {
                event.currentTarget.setCustomValidity('')
                setUsername(event.currentTarget.value)
                setUsernameSuggestions([])
                setUsernameStatus(
                  /^[a-zA-Z0-9._-]{3,30}$/.test(event.currentTarget.value.trim())
                    ? 'checking'
                    : event.currentTarget.value.trim()
                      ? 'invalid'
                      : 'idle',
                )
              }}
            />
            <div
              id="username-availability"
              className={`username-availability is-${usernameStatus}`}
              role="status"
              aria-live="polite"
            >
              {usernameStatus === 'checking' && (
                <><span className="username-availability__spinner" aria-hidden="true" />Checking username...</>
              )}
              {usernameStatus === 'available' && 'Username available'}
              {usernameStatus === 'taken' && 'Username already taken'}
              {usernameStatus === 'invalid' && 'Use 3–30 letters, numbers, dots, underscores, or hyphens.'}
              {usernameStatus === 'error' && 'Could not check availability. Please try again.'}
            </div>
            {usernameStatus === 'taken' && usernameSuggestions.length > 0 && (
              <div className="username-suggestions" aria-label="Available username suggestions">
                <span>Try one of these:</span>
                <div>
                  {usernameSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        setUsername(suggestion)
                        setUsernameStatus('checking')
                        setUsernameSuggestions([])
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={isRegistering ? 'new-password' : 'current-password'}
        />

        {isRegistering && (
          <PasswordField
            id="confirm-password"
            label="Confirm password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
          />
        )}

      </div>

      {!isRegistering && (
        <div className="form-options">
          <span className="secure-note">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v7h-9z" />
            </svg>
            Your account is secure
          </span>
          <button
            className="text-button"
            type="button"
            onClick={() => onMessage('Password recovery will be available when account services are connected.')}
          >
            Forgot password?
          </button>
        </div>
      )}

      <button
        className="primary-button"
        type="submit"
        disabled={
          isSubmitting ||
          isGoogleSubmitting ||
          (isRegistering && usernameStatus !== 'available')
        }
        aria-busy={isSubmitting || isGoogleSubmitting}
      >
        {isSubmitting
          ? isRegistering ? 'Creating account...' : 'Logging in...'
          : isRegistering ? 'Create account' : 'Log in'}
        {!isSubmitting && <span aria-hidden="true">→</span>}
      </button>

      {!isRegistering && !isAdministrativeRole && (
        <>
          <div className="separator"><span>or</span></div>
          <button
            className="google-button"
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isSubmitting || isGoogleSubmitting}
            aria-busy={isGoogleSubmitting}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.36-.18-2H10v3.78h5.39a4.62 4.62 0 0 1-2 3.03v2.52h3.23c1.89-1.74 2.98-4.3 2.98-7.33Z" />
              <path fill="#34A853" d="M10 20c2.7 0 4.97-.9 6.63-2.44l-3.23-2.52c-.9.6-2.04.95-3.4.95-2.61 0-4.83-1.76-5.62-4.13H1.04v2.6A10 10 0 0 0 10 20Z" />
              <path fill="#FBBC05" d="M4.38 11.86a6 6 0 0 1 0-3.72v-2.6H1.04a10 10 0 0 0 0 8.92l3.34-2.6Z" />
              <path fill="#EA4335" d="M10 3.96c1.47 0 2.78.5 3.82 1.5l2.86-2.86C14.96.99 12.7 0 10 0a10 10 0 0 0-8.96 5.54l3.34 2.6C5.17 5.72 7.39 3.96 10 3.96Z" />
            </svg>
            {isGoogleSubmitting ? 'Connecting to Google...' : 'Continue with Google'}
          </button>
        </>
      )}
    </form>
  )
}

function ActivationPage() {
  const location = useLocation()
  const token = new URLSearchParams(location.search).get('token') || ''
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function activateAccount(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    const form = event.currentTarget
    const password = form.elements.password.value
    const confirmPassword = form.elements.confirmPassword.value
    if (password !== confirmPassword) {
      setError('Your passwords do not match.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(`${API_BASE_URL}/auth/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.message || 'Account activation failed.')
      setMessage(result.message)
      form.reset()
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : 'Account activation failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="activation-page">
      <section className="dashboard-card">
        <BrandMark />
        <p className="dashboard-eyebrow">COLLEGE SUB-ADMIN</p>
        <h1>Create your password</h1>
        {!token ? (
          <p role="alert">This activation link is missing its token. Ask your administrator to send a new link.</p>
        ) : message ? (
          <>
            <p role="status">{message}</p>
            <a className="dashboard-button" href="/">Continue to login</a>
          </>
        ) : (
          <form className="activation-form" onSubmit={activateAccount}>
            <label htmlFor="activation-password">Password</label>
            <input id="activation-password" name="password" type="password" minLength="8" maxLength="72" autoComplete="new-password" required />
            <label htmlFor="activation-confirm-password">Confirm password</label>
            <input id="activation-confirm-password" name="confirmPassword" type="password" minLength="8" maxLength="72" autoComplete="new-password" required />
            {error && <p role="alert">{error}</p>}
            <button className="dashboard-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Activating…' : 'Activate account'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}

function DashboardPage({ role }) {
  const [user, setUser] = useState(null)
  const [error, setError] = useState('')
  const roleLabels = {
    student: 'Student',
    main_admin: 'Main Admin',
    college_admin: 'College Sub-Admin',
  }

  useEffect(() => {
    const controller = new AbortController()

    async function verifyDashboardAccess() {
      try {
        const storedAuth = sessionStorage.getItem('lms.auth')
        const auth = storedAuth ? JSON.parse(storedAuth) : null
        if (typeof auth?.token !== 'string') {
          window.location.replace('/')
          return
        }

        const response = await fetch(`${API_BASE_URL}/auth/dashboard/${DASHBOARD_API_ROLES[role]}`, {
          headers: { Authorization: `Bearer ${auth.token}` },
          signal: controller.signal,
        })
        const result = await readApiResponse(response)
        const userIsActive =
          result.user?.isActive === true &&
          ['active', 'approved'].includes(String(result.user?.status || '').toLowerCase())
        if (
          !response.ok ||
          result.user?.role !== role ||
          (role === 'college_admin' && !userIsActive)
        ) {
          sessionStorage.removeItem('lms.auth')
          window.location.replace('/')
          return
        }

        setUser(result.user)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError('We couldn’t verify your session. Check the connection and try again.')
        }
      }
    }

    verifyDashboardAccess()
    return () => controller.abort()
  }, [role])

  function signOut() {
    sessionStorage.removeItem('lms.auth')
    window.location.replace('/')
  }

  if (role === 'student') {
    return (
      <StudentDashboard
        user={user}
        loading={!user && !error}
        error={error}
        onRetry={() => window.location.reload()}
        onLogout={signOut}
      />
    )
  }

  if (role === 'main_admin' && user) {
    return <AdminDashboard email={user.email} onLogout={signOut} />
  }
  if (role === 'college_admin' && user) {
    return <CollegeAdminDashboard user={user} onLogout={signOut} />
  }
  return (
    <main className="dashboard-landing">
      <section className="dashboard-card" aria-live="polite">
        <BrandMark />
        {error ? (
          <>
            <h1>Session verification failed</h1>
            <p>{error}</p>
            <button className="dashboard-button" type="button" onClick={() => window.location.reload()}>
              Try again
            </button>
            <button className="dashboard-signout" type="button" onClick={signOut}>
              Return to login
            </button>
          </>
        ) : user ? (
          <>
            <p className="dashboard-eyebrow">{roleLabels[role]} ACCOUNT</p>
            <h1>Welcome{user.fullName ? `, ${user.fullName}` : ''}.</h1>
            <p>You’re signed in to your {roleLabels[role].toLowerCase()} learning space.</p>
            <button className="dashboard-button" type="button" onClick={signOut}>
              Log out
            </button>
          </>
        ) : (
          <p>Verifying your account…</p>
        )}
      </section>
    </main>
  )
}

function App() {
  const location = useLocation()
  const [mode, setMode] = useState('login')
  const [message, setMessage] = useState(null)
  const [isDark, setIsDark] = useState(false)
  const isRegistering = mode === 'register'
  const dashboardRole = Object.entries(DASHBOARD_PATHS)
    .find(([, path]) => path === location.pathname)?.[0]

  function switchMode(nextMode) {
    setMode(nextMode)
    setMessage(null)
  }

  function completeRegistration(text) {
    setMode('login')
    setMessage({ text, type: 'success' })
  }

  if (dashboardRole) {
    return <DashboardPage role={dashboardRole} />
  }
  if (location.pathname === '/activate') {
    return <ActivationPage />
  }

  return (
    <main className="auth-page" data-theme={isDark ? 'dark' : 'light'}>
      <button
        className="theme-toggle"
        type="button"
        aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
        onClick={() => setIsDark((current) => !current)}
      >
        {isDark ? (
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="3.5" />
            <path d="M10 1.8v2M10 16.2v2M18.2 10h-2M3.8 10h-2m14-5.8-1.4 1.4M5.6 14.4l-1.4 1.4m11.6 0-1.4-1.4M5.6 5.6 4.2 4.2" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M16.8 12.2A7.3 7.3 0 0 1 7.8 3.2a7.3 7.3 0 1 0 9 9Z" />
          </svg>
        )}
        <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
      </button>
      <section className="welcome-panel" aria-label="Welcome to Morrow">
        <div className="welcome-top">
          <BrandMark />
          <span className="welcome-note">A brighter way to grow</span>
        </div>

        <div className="welcome-copy">
          <span className="welcome-kicker"><span /> LEARN AT YOUR OWN PACE</span>
          <h2>Small steps.<br />Remarkable <span>things.</span></h2>
          <p>Make space for new ideas, meaningful skills, and the person you’re becoming.</p>
        </div>

        <div className="learning-card" aria-hidden="true">
          <div className="card-icon">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M7 6.5h11.5A3.5 3.5 0 0 1 22 10v15.5H10A3 3 0 0 1 7 22.5v-16Z" />
              <path d="M22 11h3v14.5h-3M11 12h7M11 16h7M11 20h5" />
            </svg>
          </div>
          <div className="card-copy">
            <span>YOUR LEARNING JOURNEY</span>
            <strong>Curiosity looks good on you.</strong>
          </div>
          <div className="card-sparkle">✳</div>
          <div className="progress-track"><span /></div>
          <div className="progress-label"><span>One lesson at a time</span><span>✦</span></div>
        </div>

        <div className="hero-features" aria-label="Learn, teach, and grow">
          <div className="hero-feature">
            <span className="feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="m2.5 9 9.5-5 9.5 5-9.5 5-9.5-5Z" />
                <path d="M6.5 11.2v4.3c3.2 2.7 7.8 2.7 11 0v-4.3M21.5 9v6" />
              </svg>
            </span>
            <strong>LEARN</strong>
            <span className="feature-description">Anytime, anywhere</span>
          </div>
          <div className="hero-feature">
            <span className="feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="9" cy="8" r="3" />
                <path d="M3.5 19v-1.5A5.5 5.5 0 0 1 9 12a5.5 5.5 0 0 1 5.5 5.5V19h-11Z" />
                <path d="M16 5.3a3 3 0 0 1 0 5.8m2 2a5.5 5.5 0 0 1 2.5 4.6V19h-4" />
              </svg>
            </span>
            <strong>TEACH</strong>
            <span className="feature-description">Share your knowledge</span>
          </div>
          <div className="hero-feature">
            <span className="feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 19V5M4 19h17" />
                <path d="m7 15 4-4 3 2 5-6M15.5 7H19v3.5" />
              </svg>
            </span>
            <strong>GROW</strong>
            <span className="feature-description">Build a better you</span>
          </div>
        </div>

        <span className="welcome-orbit orbit-one" aria-hidden="true" />
        <span className="welcome-orbit orbit-two" aria-hidden="true" />
      </section>

      <section className={`form-panel${isRegistering ? '' : ' form-panel--login'}`} aria-label="Account access">
        <div className="mobile-brand"><BrandMark /></div>
        <div className="auth-shell">
          <AuthForm
            key={mode}
            mode={mode}
            role="Student"
            onMessage={(text, type = 'success') => setMessage(text ? { text, type } : null)}
            onRegistrationSuccess={completeRegistration}
          />
          <div
            className="form-message"
            data-status={message?.type || 'success'}
            role={message?.type === 'error' ? 'alert' : 'status'}
            aria-live={message?.type === 'error' ? 'assertive' : 'polite'}
          >
            {message?.text || ''}
          </div>

          <p className="auth-mode-prompt">
            {isRegistering ? 'Already have an account?' : "Don't have an account?"}
            <button
              type="button"
              onClick={() => switchMode(isRegistering ? 'login' : 'register')}
            >
              {isRegistering ? 'Log in' : 'Sign up'}
            </button>
          </p>

          <p className="terms-note">
            By continuing, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.
          </p>
        </div>
        <div className="form-bottom"><span>Made for curious minds</span><span>© 2025 LMS</span></div>
      </section>
    </main>
  )
}

export default App
