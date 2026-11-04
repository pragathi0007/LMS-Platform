import { useState } from 'react'
import './App.css'

const loginRoles = ['User', 'Instructor', 'Admin']
const registerRoles = ['User', 'Instructor']

function BrandMark() {
  return (
    <a className="brand" href="#" aria-label="aiHustle home">
      <img src="/logo.png" alt="aiHustle" />
    </a>
  )
}

function PasswordField({ id, label, value, onChange, autoComplete }) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
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
    </div>
  )
}

function RoleTabs({ roles, selectedRole, onSelect, label }) {
  return (
    <div className="role-tabs" role="tablist" aria-label={label}>
      {roles.map((role) => (
        <button
          key={role}
          type="button"
          role="tab"
          aria-selected={selectedRole === role}
          className={selectedRole === role ? 'role-tab is-selected' : 'role-tab'}
          onClick={() => onSelect(role)}
        >
          {role}
        </button>
      ))}
    </div>
  )
}

function AuthForm({ mode, role, onMessage }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const isRegistering = mode === 'register'
  const isInstructor = role === 'Instructor'

  function handleSubmit(event) {
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

    if (!form.reportValidity()) return

    if (isRegistering && password !== confirmPassword) {
      onMessage('Your passwords don’t match. Please check and try again.')
      return
    }

    onMessage(
      'Your details look good. Account access will be available when Morrow is connected to its authentication service.',
    )
  }

  const title = isRegistering
    ? isInstructor
      ? 'Teach what moves you.'
      : 'Your next chapter starts here.'
    : role === 'Admin'
      ? 'Welcome back, admin.'
      : role === 'Instructor'
        ? 'Good to have you back.'
        : 'A little closer to your goals.'

  return (
    <form
      className={isRegistering ? 'auth-form' : 'auth-form login-form'}
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="form-heading">
        <p className="eyebrow">{isRegistering ? 'CREATE YOUR ACCOUNT' : 'YOUR LEARNING SPACE'}</p>
        <h1>{title}</h1>
        <p className="form-subtitle">
          {isRegistering
            ? isInstructor
              ? 'Share your expertise with a community ready to learn.'
              : 'Build a learning habit that takes you somewhere new.'
            : ''}
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
              pattern="[a-zA-Z0-9._-]{3,30}"
              title="Use 3–30 letters, numbers, dots, underscores, or hyphens."
              required
            />
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

        {isRegistering && isInstructor && (
          <>
            <div className="field">
              <label htmlFor="professional-details">Professional details</label>
              <textarea
                id="professional-details"
                name="professionalDetails"
                rows="3"
                placeholder="Your field, experience, or areas of expertise"
                required
              />
            </div>
            <p className="approval-note">
              <span className="approval-dot" aria-hidden="true" />
              Instructor accounts are reviewed and require admin approval.
            </p>
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

      <button className="primary-button" type="submit">
        {isRegistering ? 'Create account' : `Log in as ${role.toLowerCase()}`}
        <span aria-hidden="true">→</span>
      </button>

      {!isRegistering && (
        <>
          <div className="separator"><span>or</span></div>
          <button
            className="google-button"
            type="button"
            onClick={() => onMessage('Google sign-in will be available when account services are connected.')}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.36-.18-2H10v3.78h5.39a4.62 4.62 0 0 1-2 3.03v2.52h3.23c1.89-1.74 2.98-4.3 2.98-7.33Z" />
              <path fill="#34A853" d="M10 20c2.7 0 4.97-.9 6.63-2.44l-3.23-2.52c-.9.6-2.04.95-3.4.95-2.61 0-4.83-1.76-5.62-4.13H1.04v2.6A10 10 0 0 0 10 20Z" />
              <path fill="#FBBC05" d="M4.38 11.86a6 6 0 0 1 0-3.72v-2.6H1.04a10 10 0 0 0 0 8.92l3.34-2.6Z" />
              <path fill="#EA4335" d="M10 3.96c1.47 0 2.78.5 3.82 1.5l2.86-2.86C14.96.99 12.7 0 10 0a10 10 0 0 0-8.96 5.54l3.34 2.6C5.17 5.72 7.39 3.96 10 3.96Z" />
            </svg>
            Continue with Google
          </button>
        </>
      )}
    </form>
  )
}

function App() {
  const [mode, setMode] = useState('login')
  const [loginRole, setLoginRole] = useState('User')
  const [registerRole, setRegisterRole] = useState('User')
  const [message, setMessage] = useState('')
  const [isDark, setIsDark] = useState(false)
  const isRegistering = mode === 'register'
  const selectedRole = isRegistering ? registerRole : loginRole

  function switchMode(nextMode) {
    setMode(nextMode)
    setMessage('')
  }

  function selectRole(role) {
    if (isRegistering) setRegisterRole(role)
    else setLoginRole(role)
    setMessage('')
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

        <div className="welcome-footer">
          <div className="avatar-stack" aria-hidden="true">
            <span>M</span><span>A</span><span>J</span><span>+</span>
          </div>
          <span>A community that learns together</span>
        </div>
        <span className="welcome-orbit orbit-one" aria-hidden="true" />
        <span className="welcome-orbit orbit-two" aria-hidden="true" />
      </section>

      <section className="form-panel" aria-label="Account access">
        <div className="mobile-brand"><BrandMark /></div>
        <div className="auth-shell">
          <div className="mode-switch" aria-label="Choose account action">
            <button
              type="button"
              className={!isRegistering ? 'mode-button active' : 'mode-button'}
              aria-pressed={!isRegistering}
              onClick={() => switchMode('login')}
            >
              Login
            </button>
            <button
              type="button"
              className={isRegistering ? 'mode-button active' : 'mode-button'}
              aria-pressed={isRegistering}
              onClick={() => switchMode('register')}
            >
              Create account
            </button>
          </div>

          <div className="role-section">
            <p className="role-label">{isRegistering ? 'I WANT TO JOIN AS A' : 'SIGN IN TO YOUR ACCOUNT AS'}</p>
            <RoleTabs
              roles={isRegistering ? registerRoles : loginRoles}
              selectedRole={selectedRole}
              onSelect={selectRole}
              label={isRegistering ? 'Registration role' : 'Login role'}
            />
          </div>

          <AuthForm
            key={`${mode}-${selectedRole}`}
            mode={mode}
            role={selectedRole}
            onMessage={setMessage}
          />
          <div className="form-message" role="status" aria-live="polite">
            {message}
          </div>

          <p className="terms-note">
            By continuing, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.
          </p>
        </div>
        <div className="form-bottom"><span>Made for curious minds</span><span>© 2025 Morrow Learning</span></div>
      </section>
    </main>
  )
}

export default App
