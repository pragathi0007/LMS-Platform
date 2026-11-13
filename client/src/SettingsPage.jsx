import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from './api-base-url.js'
import AdminCertificateTemplateSettings from './AdminCertificateTemplateSettings.jsx'
import './SettingsPage.css'

const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/

function maskEmail(email) {
  const [localPart, domain] = String(email || '').split('@')
  if (!localPart || !domain) return ''
  return `${localPart[0]}${'*'.repeat(Math.max(3, Math.min(8, localPart.length - 1)))}@${domain}`
}

function getToken() {
  const storedAuth = sessionStorage.getItem('lms.auth')
  let token
  try {
    token = storedAuth ? JSON.parse(storedAuth)?.token : null
  } catch {
    throw new Error('Your saved session is invalid. Please sign in again.')
  }
  if (typeof token !== 'string' || !token) throw new Error('Your session has expired. Please sign in again.')
  return token
}

async function settingsRequest(path, options = {}) {
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${getToken()}`)
  if (options.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_BASE_URL}/settings${path}`, { ...options, headers })
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    const error = new Error(result.message || 'The settings request could not be completed.')
    error.status = response.status
    throw error
  }
  return response
}

function SettingsSection({ title, description, children, className = '' }) {
  return (
    <section className={`settings-section ${className}`.trim()}>
      <header className="settings-section__heading">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  )
}

function ComingSoon({ children }) {
  return <p className="settings-coming-soon"><span>Coming soon</span>{children}</p>
}

function SettingsPage({
  user,
  onAccountUpdated,
  themePreference,
  onSetTheme,
  onLogout,
  standalone = false,
}) {
  const hasCachedAccount = Boolean(user?.id && user?.username && user?.email)
  const [account, setAccount] = useState(() => hasCachedAccount ? user : null)
  const [name, setName] = useState(() => hasCachedAccount ? user.fullName || '' : '')
  const [username, setUsername] = useState(() => hasCachedAccount ? user.username : '')
  const [emailInput, setEmailInput] = useState(() => hasCachedAccount ? user.email : '')
  const [verificationCode, setVerificationCode] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(
    () => typeof user?.twoFactorEnabled === 'boolean' ? user.twoFactorEnabled : null,
  )
  const [twoFactorEnabledAt, setTwoFactorEnabledAt] = useState(user?.twoFactorEnabledAt || null)
  const [twoFactorEmail, setTwoFactorEmail] = useState(() => maskEmail(user?.email))
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorError, setTwoFactorError] = useState('')
  const [twoFactorNotice, setTwoFactorNotice] = useState('')
  const [isRequestingTwoFactor, setIsRequestingTwoFactor] = useState(false)
  const [isVerifyingTwoFactor, setIsVerifyingTwoFactor] = useState(false)
  const [isResendingTwoFactor, setIsResendingTwoFactor] = useState(false)
  const [twoFactorResendCountdown, setTwoFactorResendCountdown] = useState(0)
  const [usernameState, setUsernameState] = useState(() => hasCachedAccount ? 'current' : 'idle')
  const [profileError, setProfileError] = useState('')
  const [profileNotice, setProfileNotice] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [emailNotice, setEmailNotice] = useState('')
  const [isRequestingEmailCode, setIsRequestingEmailCode] = useState(false)
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordNotice, setPasswordNotice] = useState('')
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [pageError, setPageError] = useState('')
  const [isLoading, setIsLoading] = useState(!hasCachedAccount)
  const [exportState, setExportState] = useState({ loading: false, error: '', notice: '' })

  useEffect(() => {
    let active = true
    settingsRequest('/')
      .then((response) => response.json())
      .then(({ account: result }) => {
        if (active) {
          setAccount(result)
          setName(result.fullName)
          setUsername(result.username)
          setEmailInput(result.email)
          setPendingEmail(result.pendingEmail || '')
          setUsernameState('current')
          setTwoFactorEnabled(result.twoFactorEnabled === true)
          setTwoFactorEnabledAt(result.twoFactorEnabledAt || null)
          setTwoFactorEmail(maskEmail(result.email))
        }
      })
      .catch((error) => {
        if (active) setPageError(error instanceof Error ? error.message : 'Account settings could not be loaded.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!twoFactorChallenge || twoFactorResendCountdown <= 0) return undefined
    const timerId = window.setTimeout(
      () => setTwoFactorResendCountdown((current) => Math.max(0, current - 1)),
      1000,
    )
    return () => window.clearTimeout(timerId)
  }, [twoFactorChallenge, twoFactorResendCountdown])

  useEffect(() => {
    if (!account || !username.trim()) {
      setUsernameState('idle')
      return undefined
    }
    const normalized = username.trim().toLowerCase()
    if (normalized === account.username) {
      setUsernameState('current')
      return undefined
    }
    if (!usernamePattern.test(normalized)) {
      setUsernameState('invalid')
      return undefined
    }
    const controller = new AbortController()
    setUsernameState('checking')
    const timeoutId = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ username: normalized })
        const response = await settingsRequest(`/username-availability?${query}`, { signal: controller.signal })
        const result = await response.json()
        if (controller.signal.aborted) return
        if (typeof result.available !== 'boolean' || typeof result.isCurrent !== 'boolean') {
          throw new Error('The server returned an invalid username availability response.')
        }
        setUsernameState(result.isCurrent ? 'current' : result.available ? 'available' : 'taken')
      } catch (error) {
        if (error.name !== 'AbortError') setUsernameState('error')
      }
    }, 450)
    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [username, account])

  async function saveProfile(event) {
    event.preventDefault()
    setProfileError('')
    setProfileNotice('')
    if (name.trim().length < 2 || name.trim().length > 120) {
      setProfileError('Display name must be between 2 and 120 characters.')
      return
    }
    if (!usernamePattern.test(username.trim())) {
      setProfileError('Username must be 3–30 characters and use only letters, numbers, dots, underscores, or hyphens.')
      return
    }
    if (!['available', 'current'].includes(usernameState)) {
      setProfileError('Choose a username confirmed to be available before saving.')
      return
    }
    setIsSavingProfile(true)
    try {
      const response = await settingsRequest('/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName: name, username }),
      })
      const result = await response.json()
      setAccount(result.account)
      setName(result.account.fullName)
      setUsername(result.account.username)
      setEmailInput(result.account.email)
      setPendingEmail(result.account.pendingEmail || '')
      onAccountUpdated?.(result.account)
      setProfileNotice('Your account information has been saved.')
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Account information could not be saved.')
    } finally {
      setIsSavingProfile(false)
    }
  }

  async function requestEmailChange() {
    setEmailError('')
    setEmailNotice('')
    const newEmail = emailInput.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 254) {
      setEmailError('Enter a valid email address.')
      return
    }
    if (newEmail === account?.email?.toLowerCase()) {
      setEmailError('Enter a new email address to request a change.')
      return
    }
    setIsRequestingEmailCode(true)
    try {
      const response = await settingsRequest('/email-change/request', {
        method: 'POST',
        body: JSON.stringify({ email: newEmail }),
      })
      const result = await response.json()
      setPendingEmail(result.account.pendingEmail || '')
      setEmailNotice(result.message)
      setVerificationCode('')
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : 'The verification code could not be sent.')
    } finally {
      setIsRequestingEmailCode(false)
    }
  }

  async function verifyEmailChange() {
    setEmailError('')
    setEmailNotice('')
    if (!/^\d{8}$/.test(verificationCode.trim())) {
      setEmailError('Enter the 8-digit verification code.')
      return
    }
    setIsVerifyingEmail(true)
    try {
      const response = await settingsRequest('/email-change/verify', {
        method: 'POST',
        body: JSON.stringify({ code: verificationCode.trim() }),
      })
      const result = await response.json()
      setAccount(result.account)
      setName(result.account.fullName)
      setUsername(result.account.username)
      setEmailInput(result.account.email)
      setPendingEmail('')
      setVerificationCode('')
      setTwoFactorEmail(maskEmail(result.account.email))
      onAccountUpdated?.(result.account)
      setEmailNotice(result.message)
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : 'The email address could not be verified.')
    } finally {
      setIsVerifyingEmail(false)
    }
  }

  async function changePassword(event) {
    event.preventDefault()
    setPasswordError('')
    setPasswordNotice('')
    if (newPassword.length < 8 || new TextEncoder().encode(newPassword).length > 72) {
      setPasswordError('New password must be at least 8 characters and no more than 72 UTF-8 bytes.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The new passwords do not match.')
      return
    }
    if (newPassword === currentPassword) {
      setPasswordError('Choose a new password different from your current password.')
      return
    }
    setIsSavingPassword(true)
    try {
      const response = await settingsRequest('/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const result = await response.json()
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordNotice(result.message)
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Password could not be changed.')
    } finally {
      setIsSavingPassword(false)
    }
  }

  async function beginTwoFactorChange(action) {
    if (action === 'disable' && !window.confirm('Disable email two-factor authentication for this account?')) return
    setTwoFactorError('')
    setTwoFactorNotice('')
    setIsRequestingTwoFactor(true)
    try {
      const response = await settingsRequest('/two-factor/challenge', {
        method: 'POST',
        body: JSON.stringify({ action }),
      })
      const result = await response.json()
      setTwoFactorChallenge(result)
      setTwoFactorCode('')
      setTwoFactorResendCountdown(result.resendAfterSeconds || 60)
      setTwoFactorEmail(result.maskedEmail || twoFactorEmail)
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : 'The security code could not be sent.')
    } finally {
      setIsRequestingTwoFactor(false)
    }
  }

  async function resendTwoFactorCode() {
    if (!twoFactorChallenge?.challengeToken) return
    setTwoFactorError('')
    setTwoFactorNotice('')
    setIsResendingTwoFactor(true)
    try {
      const response = await settingsRequest('/two-factor/resend', {
        method: 'POST',
        body: JSON.stringify({ challengeToken: twoFactorChallenge.challengeToken }),
      })
      const result = await response.json()
      setTwoFactorChallenge(result)
      setTwoFactorResendCountdown(result.resendAfterSeconds || 60)
      setTwoFactorEmail(result.maskedEmail || twoFactorEmail)
      setTwoFactorCode('')
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : 'The security code could not be resent.')
    } finally {
      setIsResendingTwoFactor(false)
    }
  }

  async function verifyTwoFactorChange(event) {
    event.preventDefault()
    setTwoFactorError('')
    setTwoFactorNotice('')
    if (!/^\d{6}$/.test(twoFactorCode)) {
      setTwoFactorError('Enter the 6-digit verification code.')
      return
    }
    setIsVerifyingTwoFactor(true)
    try {
      const response = await settingsRequest('/two-factor/verify', {
        method: 'POST',
        body: JSON.stringify({
          challengeToken: twoFactorChallenge.challengeToken,
          code: twoFactorCode,
        }),
      })
      const result = await response.json()
      setTwoFactorEnabled(result.account.twoFactorEnabled)
      setTwoFactorEnabledAt(result.account.twoFactorEnabledAt)
      setTwoFactorEmail(result.account.twoFactorEmail || twoFactorEmail)
      setTwoFactorChallenge(null)
      setTwoFactorCode('')
      setTwoFactorNotice(result.message)
      onAccountUpdated?.({
        twoFactorEnabled: result.account.twoFactorEnabled,
        twoFactorEnabledAt: result.account.twoFactorEnabledAt,
      })
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : 'The security code could not be verified.')
    } finally {
      setIsVerifyingTwoFactor(false)
    }
  }

  async function cancelTwoFactorChange() {
    if (!twoFactorChallenge?.challengeToken) return
    setTwoFactorError('')
    try {
      await settingsRequest('/two-factor/cancel', {
        method: 'POST',
        body: JSON.stringify({ challengeToken: twoFactorChallenge.challengeToken }),
      })
      setTwoFactorChallenge(null)
      setTwoFactorCode('')
      setTwoFactorResendCountdown(0)
    } catch (error) {
      if (error.status === 410) {
        setTwoFactorChallenge(null)
        setTwoFactorCode('')
        setTwoFactorResendCountdown(0)
        setTwoFactorError('The verification request expired. You can start again.')
        return
      }
      setTwoFactorError(error instanceof Error ? error.message : 'The security request could not be cancelled.')
    }
  }

  async function downloadData() {
    setExportState({ loading: true, error: '', notice: '' })
    try {
      const response = await settingsRequest('/data-export')
      const blob = await response.blob()
      if (!blob.size) throw new Error('The data report was empty and could not be downloaded.')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'lms-account-data.json'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExportState({ loading: false, error: '', notice: 'Your account data report was generated and downloaded.' })
    } catch (error) {
      setExportState({
        loading: false,
        error: error instanceof Error ? error.message : 'Your data report could not be generated.',
        notice: '',
      })
    }
  }

  const savedAccount = account || user
  const usernameMessage = {
    checking: 'Checking username availability…',
    available: 'Username available',
    taken: 'Username already taken',
    invalid: 'Use 3–30 letters, numbers, dots, underscores, or hyphens.',
    error: 'Could not check username availability. Try again.',
  }[usernameState]
  const accountType = account?.accountType || (
    user?.role === 'main_admin' || user?.role === 'college_admin'
      ? user.collegeId ? 'College Admin' : 'Platform Admin'
      : user?.studentType === 'college' ? 'College Student' : 'Independent Student'
  )
  const dashboardPath = {
    student: '/student/dashboard',
    main_admin: '/admin/dashboard',
    college_admin: '/college-admin/dashboard',
  }[user?.role] || '/student/dashboard'

  return (
    <div className={`settings-page${standalone ? ' settings-page--standalone' : ''}`}>
      {standalone && (
        <>
          <Link className="admin-back-dashboard" to={dashboardPath}>
            <span aria-hidden="true">←</span> Back to Dashboard
          </Link>
          <header className="settings-page__standalone-heading">
          <span className="student-eyebrow">ACCOUNT PREFERENCES</span>
          <h1>Settings</h1>
          <p>Manage your account, security, and appearance.</p>
          </header>
        </>
      )}
      <div className={standalone ? 'main-admin-settings__content-card' : undefined}>
      {isLoading ? <p className="settings-loading" role="status">Loading account settings…</p> : !account ? (
        <p className="settings-message is-error" role="alert">
          {pageError || 'Account details could not be loaded. Refresh the page or sign in again before changing settings.'}
        </p>
      ) : (
        <>
          <SettingsSection
            title="Account Information"
            description={user?.role === 'student'
              ? 'Update your display name and username. Email changes take effect after verification.'
              : 'Review and update your account details. Your email and account permissions are managed by the platform.'}
          >
            <form className="settings-form" onSubmit={saveProfile} noValidate>
              <div className="settings-account-summary">
                <div className="settings-avatar" aria-hidden="true">
                  {(savedAccount?.fullName || 'U').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                </div>
                <div><strong>{savedAccount?.fullName || 'Account holder'}</strong><span>{savedAccount?.email || 'Email unavailable'}</span></div>
                <span className="settings-account-type">{accountType}</span>
              </div>
              <div className="settings-form__grid">
                <div className="settings-field-group settings-account-field--name">
                  <label htmlFor="settings-display-name">Display name</label>
                  <input id="settings-display-name" value={name} onChange={(event) => { setName(event.currentTarget.value); setProfileNotice('') }} autoComplete="name" required minLength={2} maxLength={120} />
                </div>
                <div className="settings-field-group settings-account-field--username">
                  <label htmlFor="settings-username">Username</label>
                  <input id="settings-username" value={username} onChange={(event) => { setUsername(event.currentTarget.value); setUsernameState('idle'); setProfileNotice('') }} autoComplete="username" required minLength={3} maxLength={30} aria-describedby={usernameMessage ? 'settings-username-status' : undefined} />
                  {usernameMessage && <small id="settings-username-status" className={`settings-field-status is-${usernameState}`} role="status">{usernameMessage}</small>}
                </div>
                {user?.role === 'student' ? (
                  <div className="settings-field-group settings-account-field--email">
                    <label htmlFor="settings-email">Email</label>
                    <input
                      id="settings-email"
                      type="email"
                      value={emailInput}
                      onChange={(event) => {
                        setEmailInput(event.currentTarget.value)
                        setEmailError('')
                        setEmailNotice('')
                      }}
                      autoComplete="email"
                      aria-describedby="settings-email-note"
                    />
                    <small id="settings-email-note">
                      {pendingEmail ? `Verification code sent to ${pendingEmail}. It expires in 15 minutes; your current email stays active until verification.` : 'A verification code is required before a new email becomes active.'}
                    </small>
                    <button className="settings-secondary-button" type="button" onClick={requestEmailChange} disabled={isRequestingEmailCode || isVerifyingEmail}>
                      {isRequestingEmailCode ? 'Sending code…' : 'Send verification code'}
                    </button>
                    {pendingEmail && (
                      <span className="settings-email-verification">
                        <input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={verificationCode}
                          onChange={(event) => setVerificationCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 8))}
                          placeholder="8-digit code"
                          aria-label="Email verification code"
                          maxLength={8}
                        />
                        <button className="settings-secondary-button" type="button" onClick={verifyEmailChange} disabled={isRequestingEmailCode || isVerifyingEmail}>
                          {isVerifyingEmail ? 'Verifying…' : 'Verify email'}
                        </button>
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="settings-field-group settings-account-field--email">
                    <label htmlFor="settings-email-readonly">Email</label>
                    <input id="settings-email-readonly" value={savedAccount?.email || ''} readOnly />
                  </div>
                )}
                <div className="settings-field-group settings-account-field--type">
                  <label htmlFor="settings-account-type">Account type</label>
                  <input id="settings-account-type" value={accountType || 'Not available'} readOnly />
                </div>
                {accountType?.startsWith('College') && (
                  <label>College<input value={account?.collegeName || 'College name not available'} readOnly /></label>
                )}
              </div>
              <div className="settings-photo-row">
                <div><strong>Profile photo</strong><span>Profile image storage is not configured for this application.</span></div>
                <span className="settings-pill">Coming soon</span>
              </div>
              {profileError && <p className="settings-message is-error" role="alert">{profileError}</p>}
              {profileNotice && <p className="settings-message is-success" role="status">{profileNotice}</p>}
              {emailError && <p className="settings-message is-error" role="alert">{emailError}</p>}
              {emailNotice && <p className="settings-message is-success" role="status">{emailNotice}</p>}
              <button className="student-button" type="submit" disabled={isSavingProfile || isLoading || !['available', 'current'].includes(usernameState)}>
                {isSavingProfile ? 'Saving…' : 'Save account information'}
              </button>
            </form>
          </SettingsSection>

          <SettingsSection title="Appearance" description="Choose a theme for the LMS. Your preference applies across pages and is saved on this device.">
            <fieldset className="settings-theme-options">
              <legend className="settings-sr-only">Choose appearance</legend>
              {[
                ['light', 'Light mode', 'Warm cream backgrounds and dark text'],
                ['dark', 'Dark mode', 'A darker palette for low-light settings'],
              ].map(([value, title, detail]) => (
                <label className={`settings-theme-option${themePreference === value ? ' is-selected' : ''}`} key={value}>
                  <input type="radio" name="theme" value={value} checked={themePreference === value} onChange={() => onSetTheme(value)} />
                  <span><strong>{title}</strong><small>{detail}</small></span>
                </label>
              ))}
            </fieldset>
          </SettingsSection>

          {user?.role === 'main_admin' && (
            <SettingsSection
              title="Certificate Management"
              description="Upload, preview, and replace the background used on automatically generated student certificates."
            >
              <AdminCertificateTemplateSettings onLogout={onLogout} />
            </SettingsSection>
          )}

          <SettingsSection title="Change Password" description="Use a unique password. Passwords must be at least 8 characters and are securely hashed.">
            {account?.hasPassword ? (
              <form className="settings-form settings-password-form" onSubmit={changePassword}>
                <label>Current password<input type={showPasswords ? 'text' : 'password'} value={currentPassword} onChange={(event) => setCurrentPassword(event.currentTarget.value)} autoComplete="current-password" required /></label>
                <label>New password<input type={showPasswords ? 'text' : 'password'} value={newPassword} onChange={(event) => setNewPassword(event.currentTarget.value)} autoComplete="new-password" minLength={8} required /></label>
                <label>Confirm new password<input type={showPasswords ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} autoComplete="new-password" required /></label>
                <label className="settings-checkbox"><input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.currentTarget.checked)} />Show passwords</label>
                <ul className="settings-password-rules"><li className={newPassword.length >= 8 ? 'is-met' : ''}>At least 8 characters</li><li className={newPassword && newPassword === confirmPassword ? 'is-met' : ''}>New passwords match</li><li>Maximum 72 UTF-8 bytes</li></ul>
                {passwordError && <p className="settings-message is-error" role="alert">{passwordError}</p>}
                {passwordNotice && <p className="settings-message is-success" role="status">{passwordNotice}</p>}
                <button className="student-button" type="submit" disabled={isSavingPassword}>{isSavingPassword ? 'Updating…' : 'Change password'}</button>
              </form>
            ) : <ComingSoon>This Google-connected account does not have a password. Secure password setup for Google-only accounts is not available yet.</ComingSoon>}
          </SettingsSection>

          {user?.role === 'student' && (
            <SettingsSection
              title="Two-Factor Authentication"
              description="When enabled, we’ll email a one-time security code after your password or Google sign-in."
            >
              <div className="settings-two-factor">
                <div className="settings-two-factor__summary">
                  <div>
                    <strong>Registered email</strong>
                    <span>{twoFactorEmail || 'Email unavailable'}</span>
                  </div>
                  <span className={`settings-pill${twoFactorEnabled ? ' is-connected' : ''}`}>
                    {twoFactorEnabled === null ? 'Checking status…' : twoFactorEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                {twoFactorChallenge ? (
                  <form className="settings-two-factor__verification" onSubmit={verifyTwoFactorChange}>
                    <p>
                      Enter the 6-digit code sent to <strong>{twoFactorChallenge.maskedEmail || twoFactorEmail}</strong>.
                      The code expires in 5 minutes.
                    </p>
                    <label htmlFor="settings-two-factor-code">Email verification code</label>
                    <input
                      id="settings-two-factor-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={twoFactorCode}
                      onChange={(event) => {
                        setTwoFactorCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))
                        setTwoFactorError('')
                      }}
                      placeholder="6-digit code"
                      maxLength={6}
                      required
                    />
                    <div className="settings-two-factor__actions">
                      <button className="student-button" type="submit" disabled={isVerifyingTwoFactor || isResendingTwoFactor}>
                        {isVerifyingTwoFactor ? 'Verifying…' : 'Verify code'}
                      </button>
                      <button
                        className="settings-secondary-button"
                        type="button"
                        onClick={resendTwoFactorCode}
                        disabled={isVerifyingTwoFactor || isResendingTwoFactor || twoFactorResendCountdown > 0}
                      >
                        {isResendingTwoFactor ? 'Sending…' : twoFactorResendCountdown > 0 ? `Resend code in ${twoFactorResendCountdown}s` : 'Resend code'}
                      </button>
                      <button className="settings-secondary-button" type="button" onClick={cancelTwoFactorChange} disabled={isVerifyingTwoFactor || isResendingTwoFactor}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <label className="settings-two-factor__toggle">
                    <input
                      type="checkbox"
                      checked={twoFactorEnabled === true}
                      disabled={twoFactorEnabled === null || isLoading || isRequestingTwoFactor}
                      onChange={(event) => beginTwoFactorChange(event.currentTarget.checked ? 'enable' : 'disable')}
                    />
                    <span>
                      <strong>{twoFactorEnabled ? 'Two-factor authentication is on' : 'Enable email two-factor authentication'}</strong>
                      <small>
                        {twoFactorEnabled
                          ? `A security code is required at every login${twoFactorEnabledAt ? ` · enabled ${new Date(twoFactorEnabledAt).toLocaleDateString()}` : ''}.`
                          : 'A 6-digit security code will be required at each login.'}
                      </small>
                    </span>
                    {isRequestingTwoFactor && <span className="settings-two-factor__spinner" role="status">Sending…</span>}
                  </label>
                )}
                {twoFactorError && <p className="settings-message is-error" role="alert">{twoFactorError}</p>}
                {twoFactorNotice && <p className="settings-message is-success" role="status">{twoFactorNotice}</p>}
              </div>
            </SettingsSection>
          )}

          <SettingsSection title="Connected Accounts" description="Only linked authentication providers are shown.">
            <div className="settings-connected-account">
              <span className="settings-google-mark" aria-hidden="true">G</span>
              <div><strong>Google</strong><span>{account?.googleConnected ? `Connected${account.googleEmail ? ` · ${account.googleEmail}` : ''}` : 'Not connected'}</span></div>
              <span className={`settings-pill${account?.googleConnected ? ' is-connected' : ''}`}>{account?.googleConnected ? 'Connected' : 'Not connected'}</span>
            </div>
            <p className="settings-note">Account linking and unlinking are managed securely during sign-in. Settings does not offer unlinking.</p>
          </SettingsSection>

          <SettingsSection title="Active Sessions" description="Your current sign-in uses a stateless access token.">
            <ComingSoon>The platform does not yet track or revoke individual device sessions. No device or location data is shown.</ComingSoon>
          </SettingsSection>

          <SettingsSection title="Your LMS Data" description="Generate a copy of account details and LMS records currently available for your account.">
            <p className="settings-note">The report includes your account information and support requests, when available. Enrollment, course-progress, purchase, and achievement records are not currently connected.</p>
            {exportState.error && <p className="settings-message is-error" role="alert">{exportState.error}</p>}
            {exportState.notice && <p className="settings-message is-success" role="status">{exportState.notice}</p>}
            <button className="student-button student-button--quiet" type="button" onClick={downloadData} disabled={exportState.loading || isLoading}>
              {exportState.loading ? 'Preparing report…' : 'Download my data'}
            </button>
          </SettingsSection>

          <SettingsSection title="Delete Account" description="This action is not currently available." className="settings-delete-section">
            <div className="settings-delete-warning">
              <strong>Account deletion is unavailable</strong>
              <p>Account deletion requires a documented data-retention policy and a complete review of account relationships. College-managed accounts also require an approved college account policy. No account data will be deleted from this page.</p>
            </div>
          </SettingsSection>
        </>
      )}
      </div>
    </div>
  )
}

export default SettingsPage
