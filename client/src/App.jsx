import React, { useCallback, useEffect, useRef, useState } from 'react'
import AdminSupport from './AdminSupport.jsx'
import AdminDashboard from './AdminDashboard.jsx'
import CollegeAdminDashboard from './CollegeAdminDashboard.jsx'
import SettingsPage from './SettingsPage.jsx'
import StudentDashboard from './StudentDashboard.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import WorkspaceTopbar from './WorkspaceTopbar.jsx'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { API_BASE_URL } from './api-base-url.js'
import { isInvalidSessionResponse } from './auth-session.js'
import './App.css'

function getPasswordStrength(password) {
  return [
    password.length >= 8,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length
}
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

async function validateReferralCode(code) {
  const response = await fetch(`${API_BASE_URL}/referrals/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const result = await readApiResponse(response)
  if (!response.ok || result.valid !== true) {
    throw new Error(
      typeof result.message === 'string'
        ? result.message
        : 'This referral code is invalid, expired, or already used.',
    )
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

function PasswordField({ id, name = id, label, value, onChange, autoComplete, strength, error }) {
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
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
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
      {error && <p id={`${id}-error`} className="field-error" role="alert">{error}</p>}
    </div>
  )
}

function AuthForm({ mode, role, onMessage, onRegistrationSuccess }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [username, setUsername] = useState('')
  const [registrationEmail, setRegistrationEmail] = useState('')
  const [registrationEmailCode, setRegistrationEmailCode] = useState('')
  const [registrationEmailChallengeAddress, setRegistrationEmailChallengeAddress] = useState('')
  const [registrationEmailVerificationToken, setRegistrationEmailVerificationToken] = useState('')
  const [registrationEmailError, setRegistrationEmailError] = useState('')
  const [registrationEmailStatus, setRegistrationEmailStatus] = useState('')
  const [registrationEmailResendCountdown, setRegistrationEmailResendCountdown] = useState(0)
  const [isSendingRegistrationEmailCode, setIsSendingRegistrationEmailCode] = useState(false)
  const [isVerifyingRegistrationEmailCode, setIsVerifyingRegistrationEmailCode] = useState(false)
  const [referralCode, setReferralCode] = useState(
    () => new URLSearchParams(window.location.search).get('referralCode') || '',
  )
  const [referralCodeStatus, setReferralCodeStatus] = useState('')
  const [referralCodeMessage, setReferralCodeMessage] = useState('')
  const [isCheckingReferralCode, setIsCheckingReferralCode] = useState(false)
  const [educationQualification, setEducationQualification] = useState('')
  const [customQualification, setCustomQualification] = useState('')
  const [livingWithWhom, setLivingWithWhom] = useState('')
  const [customLivingArrangement, setCustomLivingArrangement] = useState('')
  const [usernameStatus, setUsernameStatus] = useState('idle')
  const [usernameSuggestions, setUsernameSuggestions] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false)
  const [googleClientLoadError, setGoogleClientLoadError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [loginChallenge, setLoginChallenge] = useState(null)
  const [loginOtp, setLoginOtp] = useState('')
  const [loginOtpError, setLoginOtpError] = useState('')
  const [isVerifyingLoginOtp, setIsVerifyingLoginOtp] = useState(false)
  const [isResendingLoginOtp, setIsResendingLoginOtp] = useState(false)
  const [loginOtpResendCountdown, setLoginOtpResendCountdown] = useState(0)
  const googleAttempt = useRef(null)
  const googleCodeHandler = useRef(null)
  const googleCodeClient = useRef(null)
  const referralCodeInput = useRef(null)
  const onMessageRef = useRef(onMessage)
  const isRegistering = mode === 'register'
  const roleKey = AUTH_ROLE_KEYS[role]
  const isAdministrativeRole = roleKey === 'main_admin' || roleKey === 'college_admin'

  onMessageRef.current = onMessage

  async function checkRegistrationReferralCode(value) {
    const normalizedCode = value.trim().toUpperCase()
    if (!normalizedCode) {
      setReferralCodeStatus('')
      setReferralCodeMessage('')
      return
    }

    setIsCheckingReferralCode(true)
    setReferralCodeStatus('checking')
    setReferralCodeMessage('')
    try {
      await validateReferralCode(normalizedCode)
      if (referralCodeInput.current?.value.trim().toUpperCase() === normalizedCode) {
        setReferralCodeStatus('valid')
        setReferralCodeMessage('Referral code is valid.')
      }
    } catch (error) {
      if (referralCodeInput.current?.value.trim().toUpperCase() === normalizedCode) {
        setReferralCodeStatus('invalid')
        setReferralCodeMessage(error instanceof Error ? error.message : 'Referral code could not be validated.')
      }
    } finally {
      if (referralCodeInput.current?.value.trim().toUpperCase() === normalizedCode) {
        setIsCheckingReferralCode(false)
      }
    }
  }

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
    if (!loginChallenge) return undefined
    setLoginOtpResendCountdown(loginChallenge.resendAfterSeconds || 60)
    const timerId = window.setInterval(
      () => setLoginOtpResendCountdown((current) => Math.max(0, current - 1)),
      1000,
    )
    return () => window.clearInterval(timerId)
  }, [loginChallenge])

  useEffect(() => {
    if (!isRegistering || registrationEmailResendCountdown <= 0) return undefined
    const timerId = window.setTimeout(
      () => setRegistrationEmailResendCountdown((current) => Math.max(0, current - 1)),
      1000,
    )
    return () => window.clearTimeout(timerId)
  }, [isRegistering, registrationEmailResendCountdown])

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
            if (!attempt?.active || attempt.codeReceived) return
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

  function updateRegistrationEmail(value) {
    const normalizedEmail = value.trim().toLowerCase()
    if (normalizedEmail !== registrationEmailChallengeAddress) {
      setRegistrationEmailChallengeAddress('')
      setRegistrationEmailCode('')
      setRegistrationEmailVerificationToken('')
      setRegistrationEmailError('')
      setRegistrationEmailStatus('')
      setRegistrationEmailResendCountdown(0)
    }
    setRegistrationEmail(value)
  }

  async function sendRegistrationEmailCode() {
    const email = registrationEmail.trim().toLowerCase()
    setRegistrationEmailError('')
    setRegistrationEmailStatus('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegistrationEmailError('Enter a valid email address.')
      return
    }

    setIsSendingRegistrationEmailCode(true)
    try {
      const response = await fetch(`${API_BASE_URL}/auth/registration/email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) {
        if (typeof result.retryAfterSeconds === 'number') {
          setRegistrationEmailResendCountdown(result.retryAfterSeconds)
        }
        throw new Error(result.message || 'A verification code could not be sent.')
      }
      setRegistrationEmailChallengeAddress(email)
      setRegistrationEmailCode('')
      setRegistrationEmailVerificationToken('')
      setRegistrationEmailResendCountdown(result.resendAfterSeconds || 60)
      setRegistrationEmailStatus(result.message || 'Verification code sent.')
    } catch (error) {
      setRegistrationEmailError(error instanceof TypeError
        ? 'Could not connect to the server. Check that the backend is running and try again.'
        : error instanceof Error ? error.message : 'A verification code could not be sent.')
    } finally {
      setIsSendingRegistrationEmailCode(false)
    }
  }

  async function verifyRegistrationEmailCode() {
    const email = registrationEmail.trim().toLowerCase()
    setRegistrationEmailError('')
    setRegistrationEmailStatus('')
    if (!/^\d{6}$/.test(registrationEmailCode)) {
      setRegistrationEmailError('Enter the 6-digit verification code.')
      return
    }

    setIsVerifyingRegistrationEmailCode(true)
    try {
      const response = await fetch(`${API_BASE_URL}/auth/registration/email/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: registrationEmailCode }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.message || 'The verification code could not be checked.')
      if (typeof result.emailVerificationToken !== 'string') {
        throw new Error('The server did not confirm email verification. Please try again.')
      }
      setRegistrationEmailChallengeAddress(email)
      setRegistrationEmailVerificationToken(result.emailVerificationToken)
      setRegistrationEmailCode('')
      setRegistrationEmailStatus(result.message || 'Email verified successfully.')
    } catch (error) {
      setRegistrationEmailError(error instanceof TypeError
        ? 'Could not connect to the server. Check that the backend is running and try again.'
        : error instanceof Error ? error.message : 'The verification code could not be checked.')
    } finally {
      setIsVerifyingRegistrationEmailCode(false)
    }
  }

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
          : '',
      )
    }

    const nextFieldErrors = {}
    for (const field of form.querySelectorAll('input, select, textarea')) {
      if (!field.checkValidity()) {
        nextFieldErrors[field.name || field.id] = field.validationMessage
      }
    }
    if (isRegistering && confirmPassword && password !== confirmPassword) {
      nextFieldErrors.confirmPassword = 'Your passwords do not match.'
    }
    if (
      isRegistering &&
      (!registrationEmailVerificationToken ||
        registrationEmail.trim().toLowerCase() !== registrationEmailChallengeAddress)
    ) {
      if (!nextFieldErrors.email) {
        nextFieldErrors.emailVerification = 'Verify this email address before creating an account.'
      }
    }
    setFieldErrors(nextFieldErrors)
    if (Object.keys(nextFieldErrors).length > 0) {
      return
    }

    setIsSubmitting(true)
    onMessage('')
    try {
      let response
      let result
      let authenticatedRole = roleKey
      const registrationDetails = isRegistering
        ? Object.fromEntries(
            [...new FormData(form).entries()].filter(([name, value]) => (
              typeof value === 'string' &&
              !/(password|token|secret|credential|auth|otp|hash)/i.test(name)
            )),
          )
        : undefined
      const loginRoles = ['student', 'main_admin', 'college_admin']
      for (const candidateRole of isRegistering ? ['student'] : loginRoles) {
        response = await fetch(`${API_BASE_URL}/auth/${isRegistering ? 'register' : 'login'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isRegistering
            ? {
                fullName: form.elements.fullName.value,
                email: registrationEmail,
                username: form.elements.username.value,
                password,
                confirmPassword,
                emailVerificationToken: registrationEmailVerificationToken,
                role: 'student',
                accountType: 'independent',
                registrationDetails,
                ...(form.elements.referralCode.value.trim()
                  ? { referralCode: form.elements.referralCode.value.trim() }
                  : {}),
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

        onRegistrationSuccess(result.message || 'Your account was created and is awaiting administrator approval.')
        return
      }

      if (result.requiresTwoFactor === true) {
        if (typeof result.challengeToken !== 'string' || typeof result.maskedEmail !== 'string') {
          throw new Error('The server returned an invalid login verification request.')
        }
        setLoginChallenge(result)
        setLoginOtp('')
        setLoginOtpError('')
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

  async function verifyLoginOtp(event) {
    event.preventDefault()
    setLoginOtpError('')
    if (!/^\d{6}$/.test(loginOtp)) {
      setLoginOtpError('Enter the 6-digit verification code.')
      return
    }

    setIsVerifyingLoginOtp(true)
    try {
      const response = await fetch(`${API_BASE_URL}/auth/two-factor/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: loginChallenge.challengeToken, code: loginOtp }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.message || 'The verification code could not be checked.')
      if (
        typeof result.token !== 'string' ||
        typeof result.user?.id !== 'string' ||
        result.user.role !== 'student'
      ) {
        throw new Error('The server returned incomplete or mismatched login details.')
      }
      sessionStorage.setItem('lms.auth', JSON.stringify({ token: result.token, user: result.user }))
      window.location.assign(DASHBOARD_PATHS[result.user.role])
    } catch (error) {
      setLoginOtpError(
        error instanceof TypeError
          ? 'Could not connect to the server. Check that the backend is running and try again.'
          : error instanceof Error ? error.message : 'The verification code could not be checked.',
      )
    } finally {
      setIsVerifyingLoginOtp(false)
    }
  }

  async function resendLoginOtp() {
    if (!loginChallenge?.challengeToken) return
    setLoginOtpError('')
    setIsResendingLoginOtp(true)
    try {
      const response = await fetch(`${API_BASE_URL}/auth/two-factor/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: loginChallenge.challengeToken }),
      })
      const result = await readApiResponse(response)
      if (!response.ok) {
        if (typeof result.retryAfterSeconds === 'number') {
          setLoginOtpResendCountdown(result.retryAfterSeconds)
        }
        throw new Error(result.message || 'A new verification code could not be sent.')
      }
      setLoginChallenge(result)
      setLoginOtp('')
    } catch (error) {
      setLoginOtpError(error instanceof TypeError
        ? 'Could not connect to the server. Check that the backend is running and try again.'
        : error instanceof Error ? error.message : 'A new verification code could not be sent.')
    } finally {
      setIsResendingLoginOtp(false)
    }
  }

  async function cancelLoginOtp() {
    if (!loginChallenge?.challengeToken) {
      setLoginChallenge(null)
      return
    }
    setLoginOtpError('')
    try {
      const response = await fetch(`${API_BASE_URL}/auth/two-factor/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: loginChallenge.challengeToken }),
      })
      const result = await readApiResponse(response)
      if (response.status === 410) {
        setLoginChallenge(null)
        setLoginOtp('')
        return
      }
      if (!response.ok) throw new Error(result.message || 'The verification request could not be cancelled.')
    } catch (error) {
      setLoginOtpError(error instanceof TypeError
        ? 'Could not connect to the server. Check that the backend is running and try again.'
        : error instanceof Error ? error.message : 'The verification request could not be cancelled.')
      return
    }
    setLoginChallenge(null)
    setLoginOtp('')
    setLoginOtpError('')
  }

  useEffect(() => {
    googleCodeHandler.current = async (codeResponse) => {
      const attempt = googleAttempt.current
      if (!attempt?.active || attempt.codeReceived) return
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

        if (result.requiresTwoFactor === true) {
          if (typeof result.challengeToken !== 'string' || typeof result.maskedEmail !== 'string') {
            throw new Error('The server returned an invalid login verification request.')
          }
          attempt.active = false
          setLoginChallenge(result)
          setLoginOtp('')
          setLoginOtpError('')
          return
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
    if (googleAttempt.current?.active) return

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

  if (loginChallenge) {
    return (
      <section className="auth-form login-form login-otp" aria-labelledby="login-otp-title">
        <div className="form-heading">
          <p className="eyebrow">SECURE SIGN IN</p>
          <h1 id="login-otp-title">Check your email</h1>
          <p className="form-subtitle">Enter the 6-digit code sent to {loginChallenge.maskedEmail}.</p>
        </div>
        <form className="form-fields" onSubmit={verifyLoginOtp}>
          <div className="field">
            <label htmlFor="login-email-otp">Email verification code</label>
            <input
              id="login-email-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="6-digit code"
              value={loginOtp}
              onChange={(event) => {
                setLoginOtp(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))
                setLoginOtpError('')
              }}
              required
            />
          </div>
          <button className="primary-button" type="submit" disabled={isVerifyingLoginOtp || isResendingLoginOtp}>
            {isVerifyingLoginOtp ? 'Verifying code…' : 'Verify and log in'}
          </button>
        </form>
        {loginOtpError && <p className="form-message" data-status="error" role="alert">{loginOtpError}</p>}
        <div className="login-otp__actions">
          <button
            className="text-button"
            type="button"
            onClick={resendLoginOtp}
            disabled={isVerifyingLoginOtp || isResendingLoginOtp || loginOtpResendCountdown > 0}
          >
            {isResendingLoginOtp ? 'Sending code…' : loginOtpResendCountdown > 0 ? `Resend code in ${loginOtpResendCountdown}s` : 'Resend code'}
          </button>
          <button className="text-button" type="button" onClick={cancelLoginOtp} disabled={isVerifyingLoginOtp || isResendingLoginOtp}>
            Use another account
          </button>
        </div>
      </section>
    )
  }

  return (
    <form
      className={isRegistering ? 'auth-form' : 'auth-form login-form'}
      onSubmit={handleSubmit}
      onChange={(event) => {
        const fieldName = event.target.name || event.target.id
        const errorKeys = fieldName === 'email' ? ['email', 'emailVerification'] : [fieldName]
        setFieldErrors((current) => {
          if (!errorKeys.some((key) => current[key])) return current
          const next = { ...current }
          errorKeys.forEach((key) => delete next[key])
          return next
        })
      }}
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
            <input
              id="full-name"
              name="fullName"
              type="text"
              autoComplete="name"
              required
              aria-invalid={Boolean(fieldErrors.fullName)}
              aria-describedby={fieldErrors.fullName ? 'full-name-error' : undefined}
            />
            {fieldErrors.fullName && <p id="full-name-error" className="field-error" role="alert">{fieldErrors.fullName}</p>}
          </div>
        )}

        {isRegistering ? (
          <div className="field">
            <label htmlFor="email">Email address</label>
            <div className="registration-email-entry">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={registrationEmail}
                onChange={(event) => updateRegistrationEmail(event.currentTarget.value)}
                required
                aria-invalid={Boolean(fieldErrors.email || fieldErrors.emailVerification)}
                aria-describedby={fieldErrors.email ? 'email-field-error' : fieldErrors.emailVerification ? 'email-verification-error' : undefined}
              />
              <button
                className="registration-email-button"
                type="button"
                onClick={sendRegistrationEmailCode}
                disabled={
                  isSendingRegistrationEmailCode ||
                  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registrationEmail.trim()) ||
                  registrationEmailResendCountdown > 0
                }
              >
                {isSendingRegistrationEmailCode
                  ? 'Sending…'
                  : registrationEmailResendCountdown > 0
                    ? `${registrationEmailChallengeAddress ? 'Sent' : 'Try again'} (${registrationEmailResendCountdown}s)`
                    : registrationEmailChallengeAddress
                      ? 'Send new code'
                      : 'Send Verification Code'}
              </button>
            </div>
            {registrationEmailChallengeAddress && !registrationEmailVerificationToken && (
              <div className="registration-email-code">
                <label htmlFor="registration-email-code">6-digit verification code</label>
                <input
                  id="registration-email-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={registrationEmailCode}
                  onChange={(event) => setRegistrationEmailCode(
                    event.currentTarget.value.replace(/\D/g, '').slice(0, 6),
                  )}
                  aria-describedby="registration-email-message"
                />
                <div className="registration-email-actions">
                  <button
                    className="registration-email-button"
                    type="button"
                    onClick={verifyRegistrationEmailCode}
                    disabled={isVerifyingRegistrationEmailCode || registrationEmailCode.length !== 6}
                  >
                    {isVerifyingRegistrationEmailCode ? 'Verifying…' : 'Verify'}
                  </button>
                  <button
                    className="registration-email-resend"
                    type="button"
                    onClick={sendRegistrationEmailCode}
                    disabled={isSendingRegistrationEmailCode || registrationEmailResendCountdown > 0}
                  >
                    {registrationEmailResendCountdown > 0
                      ? `Resend Code (${registrationEmailResendCountdown}s)`
                      : 'Resend Code'}
                  </button>
                </div>
              </div>
            )}
            {registrationEmailVerificationToken && (
              <p className="registration-email-status is-verified" role="status" aria-live="polite">
                Email verified successfully.
              </p>
            )}
            {registrationEmailStatus && !registrationEmailVerificationToken && (
              <p id="registration-email-message" className="registration-email-status" role="status" aria-live="polite">
                {registrationEmailStatus}
              </p>
            )}
            {registrationEmailError && (
              <p
                id="registration-email-message"
                className="registration-email-status is-error"
                role="alert"
                aria-live="assertive"
              >
                {registrationEmailError}
              </p>
            )}
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
            <label htmlFor="registration-referral-code">Referral Code (optional)</label>
            <div className="referral-code-input">
              <input
                id="registration-referral-code"
                name="referralCode"
                type="text"
                autoComplete="off"
                maxLength={64}
                value={referralCode}
                ref={referralCodeInput}
                aria-describedby="registration-referral-status"
                onChange={(event) => {
                  setReferralCode(event.currentTarget.value)
                  setReferralCodeStatus('')
                  setReferralCodeMessage('')
                  setIsCheckingReferralCode(false)
                }}
                onBlur={(event) => checkRegistrationReferralCode(event.currentTarget.value)}
              />
              <button
                className="text-button"
                type="button"
                disabled={isCheckingReferralCode || !referralCode.trim()}
                onClick={() => checkRegistrationReferralCode(referralCodeInput.current?.value || '')}
              >
                {isCheckingReferralCode ? 'Checking…' : 'Check code'}
              </button>
            </div>
            <span
              id="registration-referral-status"
              className={`referral-code-status${referralCodeStatus ? ` is-${referralCodeStatus}` : ''}`}
              role="status"
              aria-live="polite"
            >
              {referralCodeMessage}
            </span>
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
              aria-invalid={Boolean(fieldErrors.username)}
              aria-describedby={fieldErrors.username
                ? 'username-availability username-field-error'
                : 'username-availability'}
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
            {fieldErrors.username && <p id="username-field-error" className="field-error" role="alert">{fieldErrors.username}</p>}
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
          error={fieldErrors.password}
        />

        {isRegistering && (
          <PasswordField
            id="confirm-password"
            name="confirmPassword"
            label="Confirm password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            error={fieldErrors.confirmPassword}
          />
        )}

        {isRegistering && (
          <>
            <div className="field">
              <label htmlFor="education-qualification">Education Qualification</label>
              <select
                id="education-qualification"
                name="educationQualification"
                value={educationQualification}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setEducationQualification(value)
                  if (value !== 'Other') setCustomQualification('')
                }}
              >
                <option value="">Select your qualification</option>
                <option value="School Student">School Student</option>
                <option value="Higher Secondary">Higher Secondary</option>
                <option value="Diploma">Diploma</option>
                <option value="Undergraduate">Undergraduate</option>
                <option value="Postgraduate">Postgraduate</option>
                <option value="Other">Other</option>
              </select>
              {educationQualification === 'Other' && (
                <>
                  <label htmlFor="custom-qualification">Please specify your qualification</label>
                  <input
                    id="custom-qualification"
                    name="customQualification"
                    type="text"
                    placeholder="Enter your qualification"
                    value={customQualification}
                    onChange={(event) => setCustomQualification(event.currentTarget.value)}
                  />
                </>
              )}
            </div>

            <div className="field">
              <label htmlFor="user-expectations">User Expectations</label>
              <textarea
                id="user-expectations"
                name="userExpectations"
                placeholder="What do you expect from the platform?"
                rows={3}
              />
            </div>

            <div className="field">
              <label htmlFor="location">Location</label>
              <input
                id="location"
                name="location"
                type="text"
                autoComplete="address-level2"
                placeholder="Enter your location"
              />
            </div>

            <div className="field">
              <label htmlFor="living-with-whom">Living With Whom</label>
              <select
                id="living-with-whom"
                name="livingWithWhom"
                value={livingWithWhom}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setLivingWithWhom(value)
                  if (value !== 'Other') setCustomLivingArrangement('')
                }}
              >
                <option value="">Select an option</option>
                <option value="Family">Family</option>
                <option value="Friends">Friends</option>
                <option value="Alone">Alone</option>
                <option value="Relatives">Relatives</option>
                <option value="Hostel / PG">Hostel / PG</option>
                <option value="Other">Other</option>
              </select>
              {livingWithWhom === 'Other' && (
                <>
                  <label htmlFor="custom-living-arrangement">Please specify</label>
                  <input
                    id="custom-living-arrangement"
                    name="customLivingArrangement"
                    type="text"
                    placeholder="Enter who you live with"
                    value={customLivingArrangement}
                    onChange={(event) => setCustomLivingArrangement(event.currentTarget.value)}
                  />
                </>
              )}
            </div>
          </>
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
      {fieldErrors.email && <p id="email-field-error" className="field-error" role="alert">{fieldErrors.email}</p>}
      {fieldErrors.emailVerification && <p id="email-verification-error" className="field-error" role="alert">{fieldErrors.emailVerification}</p>}
      <button
        className="primary-button"
        type="submit"
        disabled={
          isSubmitting ||
          isGoogleSubmitting
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

function getCachedDashboardUser(role) {
  try {
    const storedAuth = sessionStorage.getItem('lms.auth')
    const auth = storedAuth ? JSON.parse(storedAuth) : null
    const user = auth?.user
    if (
      typeof auth?.token !== 'string' ||
      !auth.token ||
      user?.role !== role ||
      typeof user.id !== 'string' ||
      !user.id
    ) {
      return null
    }
    return user
  } catch {
    return null
  }
}

function DashboardPage({ role, isDark, onToggleTheme, themePreference, onSetTheme }) {
  const location = useLocation()
  const [user, setUser] = useState(() => getCachedDashboardUser(role))
  const [error, setError] = useState('')
  const [mainAdminSidebarOpen, setMainAdminSidebarOpen] = useState(false)
  const [mainAdminSidebarCollapsed, setMainAdminSidebarCollapsed] = useState(true)
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
        if (isInvalidSessionResponse(response, result)) {
          sessionStorage.removeItem('lms.auth')
          window.location.replace('/')
          return
        }
        const userIsActive =
          result.user?.isActive === true &&
          ['active', 'approved'].includes(String(result.user?.status || '').toLowerCase())
        if (!response.ok) {
          setError(result.message || 'Your account could not access this dashboard.')
          return
        }
        if (result.user?.role !== role) {
          setError('This account does not match the selected dashboard role.')
          return
        }
        if (role === 'college_admin' && !userIsActive) {
          setError('Your college administrator account is not active.')
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

  const signOut = useCallback(() => {
    sessionStorage.removeItem('lms.auth')
    window.location.replace('/')
  }, [])

  function updateAccount(updatedAccount) {
    setUser((current) => current ? { ...current, ...updatedAccount } : current)
    const storedAuth = sessionStorage.getItem('lms.auth')
    if (!storedAuth) return
    try {
      const auth = JSON.parse(storedAuth)
      sessionStorage.setItem('lms.auth', JSON.stringify({
        ...auth,
        user: { ...auth.user, ...updatedAccount },
      }))
    } catch {
      sessionStorage.removeItem('lms.auth')
      window.location.replace('/')
    }
  }

  if (role === 'student') {
    return (
      <StudentDashboard
        user={user}
        loading={!user && !error}
        error={error}
        onRetry={() => window.location.reload()}
        onLogout={signOut}
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        themePreference={themePreference}
        onSetTheme={onSetTheme}
        onAccountUpdated={updateAccount}
      />
    )
  }

  if (role === 'main_admin' && user) {
    return (
      <AdminDashboard
        user={user}
        onAccountUpdated={updateAccount}
        onLogout={signOut}
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        themePreference={themePreference}
        onSetTheme={onSetTheme}
        sidebarOpen={mainAdminSidebarOpen}
        sidebarCollapsed={mainAdminSidebarCollapsed}
        onSidebarOpenChange={setMainAdminSidebarOpen}
        onSidebarCollapsedChange={setMainAdminSidebarCollapsed}
      />
    )
  }
  if (
    role === 'college_admin' &&
    user &&
    (location.pathname.startsWith('/admin/support') || location.pathname.startsWith('/college-admin/support'))
  ) {
    return (
      <AdminSupport
        user={user}
        onLogout={signOut}
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        dashboardPath="/college-admin/dashboard"
        supportPath="/college-admin/support"
        settingsPath="/college-admin/settings"
        roleLabel={roleLabels[role]}
      />
    )
  }
  if (role === 'college_admin' && user && location.pathname.startsWith('/college-admin/settings')) {
    return (
      <>
        <WorkspaceTopbar
          title="Settings"
          name={user.fullName}
          email={user.email}
          roleLabel={roleLabels[role]}
          dashboardPath="/college-admin/dashboard"
          helpPath="/college-admin/support"
          settingsPath="/college-admin/settings"
          isDark={isDark}
          onToggleTheme={onToggleTheme}
          onLogout={signOut}
        />
        <SettingsPage
          user={user}
          onAccountUpdated={updateAccount}
          themePreference={themePreference}
          onSetTheme={onSetTheme}
          standalone
        />
      </>
    )
  }
  if (role === 'college_admin' && user) {
    return (
      <CollegeAdminDashboard
        user={user}
        onLogout={signOut}
        isDark={isDark}
        onToggleTheme={onToggleTheme}
      />
    )
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
  const [mode, setMode] = useState(
    () => new URLSearchParams(window.location.search).get('mode') === 'register' ? 'register' : 'login',
  )
  const [message, setMessage] = useState(null)
  const [themePreference, setThemePreference] = useState(() => {
    const storedTheme = localStorage.getItem('lms.theme')
    return storedTheme === 'dark' ? 'dark' : 'light'
  })
  const isDark = themePreference === 'dark'
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
    localStorage.setItem('lms.theme', themePreference)
  }, [isDark, themePreference])
  const isRegistering = mode === 'register'
  const dashboardRole = location.pathname.startsWith('/student/')
    ? 'student'
    : location.pathname.startsWith('/admin/support') || location.pathname.startsWith('/admin/settings')
      ? 'main_admin'
      : location.pathname.startsWith('/college-admin/')
        ? 'college_admin'
        : Object.entries(DASHBOARD_PATHS)
          .find(([, path]) => path === location.pathname)?.[0]

  function switchMode(nextMode) {
    setMode(nextMode)
    setMessage(null)
  }

  function completeRegistration(text) {
    setMode('login')
    setMessage({ text, type: 'success' })
  }

  function toggleTheme() {
    setThemePreference(isDark ? 'light' : 'dark')
  }

  if (location.pathname === '/student') {
    return (
      <Navigate
        to={{ pathname: DASHBOARD_PATHS.student, search: location.search, hash: location.hash }}
        replace
      />
    )
  }

  if (location.pathname === '/user' || location.pathname.startsWith('/user/')) {
    const legacyPath = location.pathname.slice('/user'.length) || '/dashboard'
    return (
      <Navigate
        to={{
          pathname: `/student${legacyPath}`,
          search: location.search,
          hash: location.hash,
        }}
        replace
      />
    )
  }

  if (dashboardRole) {
    return (
      <DashboardPage
        role={dashboardRole}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        themePreference={themePreference}
        onSetTheme={setThemePreference}
      />
    )
  }
  if (location.pathname === '/activate') {
    return <ActivationPage />
  }

  return (
    <main
      className={`auth-page${isRegistering ? ' auth-page--register' : ''}`}
      data-theme={isDark ? 'dark' : 'light'}
    >
      <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
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

        {isRegistering && (
          <svg
            className="welcome-illustration"
            viewBox="0 0 500 250"
            fill="none"
            aria-hidden="true"
          >
            <ellipse cx="249" cy="216" rx="188" ry="15" fill="#E6E9DA" />
            <path d="M92 121V78a48 48 0 0 1 48-48h220a32 32 0 0 1 32 32v59" stroke="#D8DDCF" strokeWidth="2" />
            <path d="M111 120V79a29 29 0 0 1 29-29h57" stroke="#B8CDBE" strokeWidth="3" strokeLinecap="round" />
            <circle cx="372" cy="76" r="13" fill="#E7C976" opacity=".8" />
            <path d="M80 190h342" stroke="#C9A97C" strokeWidth="8" strokeLinecap="round" />
            <path d="m115 198-8 22m275-22 8 22" stroke="#A98761" strokeWidth="6" strokeLinecap="round" />
            <path d="M111 184h34v-25a17 17 0 0 0-17-17h-1a16 16 0 0 0-16 16v26Z" fill="#8BAE9C" />
            <path d="M128 143v-20" stroke="#8BAE9C" strokeWidth="4" strokeLinecap="round" />
            <path d="M127 125c-14-13-13-24-9-29 12 4 17 13 14 25m-2-2c2-17 11-24 18-24 2 13-4 23-16 29" stroke="#6F9B83" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M209 162c0-22 18-40 40-40h7c18 0 33 15 33 33v24h-80v-17Z" fill="#6F9B83" />
            <path d="M220 87c0-17 13-30 30-30s30 13 30 30v5c0 17-13 30-30 30s-30-13-30-30v-5Z" fill="#D9A985" />
            <path d="M219 89c-5-20 8-38 28-38 14 0 24 8 28 21-7-3-13-8-17-15-6 10-19 16-37 16l-2 16Z" fill="#45564D" />
            <path d="M223 105c8 10 18 15 31 16" stroke="#C88F6A" strokeWidth="3" strokeLinecap="round" />
            <path d="M250 129v15" stroke="#D9A985" strokeWidth="5" strokeLinecap="round" />
            <path d="M263 148h80l9 37h-97l8-37Z" fill="#DCE8E0" stroke="#7D9E8C" strokeWidth="3" strokeLinejoin="round" />
            <path d="M273 157h60" stroke="#A7BDB0" strokeWidth="3" strokeLinecap="round" />
            <path d="m242 159 24 23m69-1 16-16" stroke="#D9A985" strokeWidth="7" strokeLinecap="round" />
            <path d="M262 185h90" stroke="#718A7B" strokeWidth="4" strokeLinecap="round" />
            <path d="M359 180h39v-7h-39z" fill="#E7C976" />
            <path d="M364 170h34v-7h-34z" fill="#E9E5D6" />
            <path d="M371 160h27v-7h-27z" fill="#8BAE9C" />
            <path d="M387 146c6-11 13-15 19-14-1 8-7 14-17 17m-3-2c-2-11-8-16-14-16 0 8 5 14 14 18" stroke="#789B81" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M383 149v10m-9 0h19" stroke="#A98761" strokeWidth="3" strokeLinecap="round" />
            <path d="m173 74 4 9 10 1-7 6 2 9-9-5-8 5 2-9-7-6 10-1 3-9Z" fill="#E5C36F" opacity=".85" />
            <circle cx="315" cy="80" r="4" fill="#83A994" />
            <circle cx="188" cy="121" r="3" fill="#83A994" />
          </svg>
        )}

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
