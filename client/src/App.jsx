import React, { useEffect, useRef, useState } from 'react'
import AdminDashboard from './AdminDashboard.jsx'
import InstructorDashboard from './InstructorDashboard.jsx'
import StudentDashboard from './StudentDashboard.jsx'
import { useLocation } from 'react-router-dom'
import './App.css'

const expertiseAreas = [
  'Business & Management',
  'Computer Science',
  'Data Science & Analytics',
  'Design & Creative Arts',
  'Education',
  'Engineering',
  'Finance & Accounting',
  'Health & Wellness',
  'Languages',
  'Marketing & Communication',
  'Mathematics',
  'Personal Development',
  'Science',
]
const subjectsByExpertise = {
  'Business & Management': ['Entrepreneurship', 'Leadership', 'Project Management', 'Human Resources', 'Operations'],
  'Computer Science': ['Web Development', 'Mobile Development', 'Programming', 'Cybersecurity', 'Cloud Computing'],
  'Data Science & Analytics': ['Data Analysis', 'Machine Learning', 'Artificial Intelligence', 'Data Visualization', 'Statistics'],
  'Design & Creative Arts': ['Graphic Design', 'UX/UI Design', 'Illustration', 'Photography', 'Video Editing'],
  Education: ['Curriculum Design', 'Instructional Design', 'Early Childhood Education', 'Special Education'],
  Engineering: ['Mechanical Engineering', 'Electrical Engineering', 'Civil Engineering', 'Robotics'],
  'Finance & Accounting': ['Financial Planning', 'Bookkeeping', 'Investment Analysis', 'Tax Accounting'],
  'Health & Wellness': ['Nutrition', 'Fitness', 'Mental Wellness', 'Public Health'],
  Languages: ['English Language Learning', 'Spanish', 'French', 'Language Teaching'],
  'Marketing & Communication': ['Digital Marketing', 'Content Marketing', 'Social Media', 'Public Relations'],
  Mathematics: ['Algebra', 'Calculus', 'Geometry', 'Applied Mathematics'],
  'Personal Development': ['Communication Skills', 'Career Development', 'Productivity', 'Public Speaking'],
  Science: ['Biology', 'Chemistry', 'Physics', 'Environmental Science'],
}
const teachingLanguages = ['English', 'Spanish', 'French', 'German', 'Hindi', 'Mandarin', 'Portuguese', 'Other']
const countryCodes = [
  { country: 'United States / Canada', code: '+1' },
  { country: 'United Kingdom', code: '+44' },
  { country: 'India', code: '+91' },
  { country: 'Australia', code: '+61' },
  { country: 'New Zealand', code: '+64' },
  { country: 'Germany', code: '+49' },
  { country: 'France', code: '+33' },
  { country: 'Other', code: '+' },
]

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Unable to read the profile picture.'))
    }
    reader.onerror = () => reject(new Error('Unable to read the profile picture.'))
    reader.readAsDataURL(file)
  })
}

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
  student: '/user/dashboard',
  instructor: '/instructor/dashboard',
  admin: '/admin/dashboard',
}
const DASHBOARD_API_ROLES = {
  student: 'user',
  instructor: 'instructor',
  admin: 'admin',
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
    <a className="brand" href="#" aria-label="aiHustle home">
      <img src="/logo.png" alt="aiHustle" />
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

function InstructorRegistrationForm({ onMessage }) {
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [values, setValues] = useState({
    fullName: '',
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    countryCode: '+1',
    phone: '',
    professionalTitle: '',
    expertise: [],
    subjects: [],
    customSubjects: [],
    customSubject: '',
    experience: '',
    languages: [],
    customLanguage: '',
    termsAccepted: false,
  })
  const [profilePicture, setProfilePicture] = useState(null)
  const [photoError, setPhotoError] = useState('')
  const [photoPreview, setPhotoPreview] = useState('')
  const [expertiseSearch, setExpertiseSearch] = useState('')
  const [selectionErrors, setSelectionErrors] = useState({})
  const [fieldErrors, setFieldErrors] = useState({})
  const passwordStrength = getPasswordStrength(values.password)

  useEffect(() => {
    if (!profilePicture) {
      setPhotoPreview('')
      return undefined
    }

    const previewUrl = URL.createObjectURL(profilePicture)
    setPhotoPreview(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [profilePicture])

  function updateValue(event) {
    const { name, value, type, checked } = event.currentTarget
    event.currentTarget.setCustomValidity('')
    setValues((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
    setFieldErrors((current) => ({ ...current, [name]: '' }))
  }

  function toggleSelection(name, option) {
    if (name === 'expertise') {
      setValues((current) => {
        const expertise = current.expertise.includes(option)
          ? current.expertise.filter((item) => item !== option)
          : [...current.expertise, option]
        const availableSubjects = expertise.flatMap((area) => subjectsByExpertise[area])

        return {
          ...current,
          expertise,
          subjects: [
            ...current.subjects.filter((subject) => current.customSubjects.includes(subject)),
            ...current.subjects.filter((subject) => availableSubjects.includes(subject)),
          ],
        }
      })
      setSelectionErrors((current) => ({ ...current, expertise: '', subjects: '' }))
      setFieldErrors((current) => ({ ...current, expertise: '', subjects: '' }))
      return
    }

    setValues((current) => ({
      ...current,
      [name]: current[name].includes(option)
        ? current[name].filter((item) => item !== option)
        : [...current[name], option],
      ...(name === 'languages' && option === 'Other' && current.languages.includes(option)
        ? { customLanguage: '' }
        : {}),
    }))
    setSelectionErrors((current) => ({ ...current, [name]: '' }))
    setFieldErrors((current) => ({ ...current, [name]: '' }))
  }

  function addCustomSubject(event) {
    const subject = values.customSubject.trim()
    const input = event.currentTarget.form.elements.customSubject
    const isDuplicate = [...values.subjects, ...values.customSubjects].some(
      (item) => item.toLowerCase() === subject.toLowerCase(),
    )
    if (!subject) {
      input.setCustomValidity('')
      return
    }

    input.setCustomValidity(
      isDuplicate ? 'This subject or skill has already been added.' : '',
    )

    if (!input.reportValidity()) return

    setValues((current) => ({
      ...current,
      subjects: [...current.subjects, subject],
      customSubjects: [...current.customSubjects, subject],
      customSubject: '',
    }))
    setSelectionErrors((current) => ({ ...current, subjects: '' }))
    setFieldErrors((current) => ({ ...current, subjects: '' }))
  }

  function removeCustomSubject(subject) {
    setValues((current) => ({
      ...current,
      subjects: current.subjects.filter((item) => item !== subject),
      customSubjects: current.customSubjects.filter((item) => item !== subject),
    }))
  }

  function handlePhotoChange(event) {
    const file = event.currentTarget.files?.[0]
    setPhotoError('')

    if (!file) {
      setProfilePicture(null)
      return
    }

    if (!file.type.startsWith('image/')) {
      setPhotoError('Choose an image file, such as a JPG or PNG.')
      event.currentTarget.value = ''
      setProfilePicture(null)
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Your profile picture must be 5 MB or smaller.')
      event.currentTarget.value = ''
      setProfilePicture(null)
      return
    }

    setProfilePicture(file)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const form = event.currentTarget

    if (step === 1) {
      const password = form.elements.password
      const confirmPassword = form.elements.confirmPassword
      const username = form.elements.username
      password.setCustomValidity(
        passwordStrength >= 3
          ? ''
          : 'Use at least 8 characters and meet 3 of these: uppercase and lowercase letters, a number, and a symbol.',
      )
      username.setCustomValidity(
        /^[a-zA-Z0-9._-]{3,30}$/.test(values.username)
          ? ''
          : 'Use 3–30 letters, numbers, dots, underscores, or hyphens.',
      )
      confirmPassword.setCustomValidity(
        values.password === values.confirmPassword ? '' : 'Your passwords do not match.',
      )

      if (!form.reportValidity()) return
      setStep(2)
      return
    }

    const nextSelectionErrors = {
      expertise: values.expertise.length ? '' : 'Select at least one area of expertise.',
      subjects:
        values.subjects.some((subject) => !values.customSubjects.includes(subject)) ||
        values.customSubjects.length > 0
          ? ''
          : 'Select or add at least one subject or skill.',
      languages: values.languages.length
        ? values.languages.includes('Other') && !values.customLanguage.trim()
          ? 'Enter the other language you teach.'
          : ''
        : 'Select at least one teaching language.',
    }
    const phone = form.elements.phone
    const phoneDigits = values.phone.replace(/\D/g, '')
    const nextFieldErrors = {
      professionalTitle: values.professionalTitle.trim() ? '' : 'Enter your professional title.',
      phone:
        phoneDigits.length >= 7 && phoneDigits.length <= 15 && /^[0-9\s().-]+$/.test(values.phone.trim())
          ? ''
          : 'Enter a phone number containing 7–15 digits.',
      experience: values.experience ? '' : 'Select your teaching experience.',
      customLanguage:
        values.languages.includes('Other') && !values.customLanguage.trim()
          ? 'Enter the other language you teach.'
          : '',
    }
    phone.setCustomValidity(
      phoneDigits.length >= 7 && phoneDigits.length <= 15 && /^[0-9\s().-]+$/.test(values.phone.trim())
        ? ''
        : 'Enter a phone number with 7–15 digits. Spaces, parentheses, dots, and hyphens are allowed.',
    )
    if (form.elements.customSubject) {
      form.elements.customSubject.setCustomValidity('')
    }
    if (values.languages.includes('Other')) {
      const customLanguage = form.elements.customLanguage
      customLanguage.setCustomValidity(
        values.customLanguage.trim() ? '' : 'Enter the other language you teach.',
      )
    }
    setSelectionErrors(nextSelectionErrors)
    setFieldErrors(nextFieldErrors)

    if (
      !form.reportValidity() ||
      nextSelectionErrors.expertise ||
      nextSelectionErrors.subjects ||
      nextSelectionErrors.languages ||
      Object.values(nextFieldErrors).some(Boolean)
    ) return

    setIsSubmitting(true)
    onMessage('')
    try {
      const profilePictureData = profilePicture
        ? await readFileAsDataUrl(profilePicture)
        : undefined
      const result = await registerAccount({
        role: 'instructor',
        fullName: values.fullName,
        email: values.email,
        username: values.username,
        password: values.password,
        confirmPassword: values.confirmPassword,
        termsAccepted: values.termsAccepted,
        instructorDetails: {
          countryCode: values.countryCode,
          phone: values.phone,
          professionalTitle: values.professionalTitle,
          expertise: values.expertise,
          subjects: values.subjects,
          customSubjects: values.customSubjects,
          experience: values.experience,
          languages: values.languages,
          customLanguage: values.customLanguage,
          profilePicture: profilePictureData
            ? {
                dataUrl: profilePictureData,
                contentType: profilePicture.type,
              }
            : undefined,
        },
      })
      onMessage(result.message || 'Your instructor application is awaiting admin approval.')
    } catch (error) {
      if (error?.fieldErrors && typeof error.fieldErrors === 'object' && !Array.isArray(error.fieldErrors)) {
        setFieldErrors((current) => ({ ...current, ...error.fieldErrors }))
        setSelectionErrors((current) => ({
          ...current,
          expertise: error.fieldErrors.expertise || current.expertise,
          subjects: error.fieldErrors.subjects || current.subjects,
          languages: error.fieldErrors.languages || current.languages,
        }))
      }
      onMessage(
        error instanceof TypeError
          ? 'Could not connect to the server. Check that the backend is running and try again.'
          : error instanceof Error
            ? error.message
            : 'Instructor registration failed. Please try again.',
        'error',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const filteredExpertise = expertiseAreas.filter((area) =>
    area.toLowerCase().includes(expertiseSearch.trim().toLowerCase()),
  )

  return (
    <form className="auth-form instructor-form" onSubmit={handleSubmit} noValidate>
      <div className="form-heading">
        <p className="eyebrow">INSTRUCTOR APPLICATION</p>
        <h1 id="instructor-step-title">
          {step === 1 ? 'Create your account.' : 'Share your expertise.'}
        </h1>
        <p className="form-subtitle">
          {step === 1
            ? 'Start with your account details. You can add your teaching profile next.'
            : 'Tell us about your experience and how you’ll help learners grow.'}
        </p>
        {fieldErrors.professionalDetails && (
          <span className="field-error" role="alert">{fieldErrors.professionalDetails}</span>
        )}
      </div>

      <ol className="registration-progress" aria-label="Registration progress">
        {['Account Details', 'Professional Details'].map((label, index) => {
          const itemStep = index + 1
          return (
            <li
              key={label}
              className={step === itemStep ? 'is-current' : step > itemStep ? 'is-complete' : ''}
              aria-current={step === itemStep ? 'step' : undefined}
            >
              <span className="progress-step-number">{step > itemStep ? '✓' : itemStep}</span>
              <span>{label}</span>
            </li>
          )
        })}
      </ol>

      {step === 1 ? (
        <>
          <div className="form-fields instructor-grid">
            <div className="field">
              <label htmlFor="instructor-full-name">Full name</label>
              <input
                id="instructor-full-name"
                name="fullName"
                type="text"
                autoComplete="name"
                minLength={2}
                maxLength={100}
                value={values.fullName}
                onChange={updateValue}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="instructor-email">Email address</label>
              <input
                id="instructor-email"
                name="email"
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={updateValue}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="instructor-username">Username</label>
              <input
                id="instructor-username"
                name="username"
                type="text"
                autoComplete="username"
                minLength={3}
                maxLength={30}
                title="Use 3–30 letters, numbers, dots, underscores, or hyphens."
                value={values.username}
                onChange={updateValue}
                required
              />
            </div>
            <div className="field profile-picture-field">
              <label htmlFor="profile-picture">Profile picture <span>(optional)</span></label>
              <div className="profile-picture-control">
                <div className="profile-picture-preview" aria-hidden="true">
                  {photoPreview
                    ? <img src={photoPreview} alt="" />
                    : <span>{values.fullName.trim().charAt(0).toUpperCase() || '＋'}</span>}
                </div>
                <div className="profile-picture-copy">
                  <label className="upload-button" htmlFor="profile-picture">Choose a photo</label>
                  <span>JPG or PNG, up to 5 MB</span>
                  <input
                    id="profile-picture"
                    name="profilePicture"
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    aria-describedby={photoError ? 'profile-picture-error' : 'profile-picture-help'}
                  />
                </div>
              </div>
              <span id="profile-picture-help" className="field-hint">A clear, friendly headshot works best.</span>
              {photoError && <span id="profile-picture-error" className="field-error" role="alert">{photoError}</span>}
            </div>
            <PasswordField
              id="instructor-password"
              name="password"
              label="Password"
              value={values.password}
              onChange={updateValue}
              autoComplete="new-password"
              strength={passwordStrength}
            />
            <PasswordField
              id="instructor-confirm-password"
              name="confirmPassword"
              label="Confirm password"
              value={values.confirmPassword}
              onChange={updateValue}
              autoComplete="new-password"
            />
          </div>
          <button className="primary-button" type="submit">
            Continue to professional details <span aria-hidden="true">→</span>
          </button>
        </>
      ) : (
        <>
          <div className="form-fields instructor-grid">
            <div className="field">
              <label htmlFor="instructor-phone">Phone number</label>
              <div className="phone-input">
                <select
                  id="instructor-country-code"
                  name="countryCode"
                  aria-label="Phone country code"
                  value={values.countryCode}
                  onChange={updateValue}
                  aria-describedby={fieldErrors.countryCode ? 'country-code-error' : undefined}
                >
                  {countryCodes.map(({ country, code }) => (
                    <option key={`${country}-${code}`} value={code}>{code} — {country}</option>
                  ))}
                </select>
                <input
                  id="instructor-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel-national"
                  inputMode="tel"
                  title="Enter 7–15 digits; spaces, parentheses, dots, and hyphens are allowed."
                  placeholder="Phone number"
                  value={values.phone}
                  onChange={updateValue}
                  required
                  aria-describedby={fieldErrors.phone ? 'instructor-phone-error' : undefined}
                />
              </div>
              {fieldErrors.countryCode && <span id="country-code-error" className="field-error" role="alert">{fieldErrors.countryCode}</span>}
              {fieldErrors.phone && <span id="instructor-phone-error" className="field-error" role="alert">{fieldErrors.phone}</span>}
            </div>
            <div className="field">
              <label htmlFor="professional-title">Professional title</label>
              <input
                id="professional-title"
                name="professionalTitle"
                type="text"
                placeholder="e.g. Senior Product Designer"
                maxLength={100}
                value={values.professionalTitle}
                onChange={updateValue}
                required
                aria-describedby={fieldErrors.professionalTitle ? 'professional-title-error' : undefined}
              />
              {fieldErrors.professionalTitle && <span id="professional-title-error" className="field-error" role="alert">{fieldErrors.professionalTitle}</span>}
            </div>
            <fieldset className="field selection-field full-span">
              <legend>Area of expertise <span className="required-mark">*</span></legend>
              <p className="field-hint">Search and select all that apply.</p>
              <input
                className="expertise-search"
                type="search"
                aria-label="Search areas of expertise"
                placeholder="Search expertise"
                value={expertiseSearch}
                onChange={(event) => setExpertiseSearch(event.currentTarget.value)}
              />
              <div className="choice-grid expertise-choices">
                {filteredExpertise.length ? filteredExpertise.map((area) => (
                  <label className="choice-chip" key={area}>
                    <input
                      type="checkbox"
                      checked={values.expertise.includes(area)}
                      onChange={() => toggleSelection('expertise', area)}
                    />
                    <span>{area}</span>
                  </label>
                )) : <span className="field-hint">No matching areas. Try another search.</span>}
              </div>
              {(selectionErrors.expertise || fieldErrors.expertise) && <span className="field-error" role="alert">{selectionErrors.expertise || fieldErrors.expertise}</span>}
            </fieldset>
            <fieldset className="field selection-field full-span">
              <legend>Specific subjects / skills <span className="required-mark">*</span></legend>
              <p className="field-hint">Choose from the subjects for your selected expertise areas, or add your own.</p>
              {values.expertise.length ? (
                <div className="subject-category-list">
                  {values.expertise.map((area) => (
                    <div className="subject-category" key={area}>
                      <p className="subject-category-title">{area}</p>
                      <div className="choice-grid">
                        {subjectsByExpertise[area].map((subject) => (
                          <label className="choice-chip" key={subject}>
                            <input
                              type="checkbox"
                              name="subjects"
                              value={subject}
                              checked={values.subjects.includes(subject)}
                              onChange={() => toggleSelection('subjects', subject)}
                            />
                            <span>{subject}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="field-hint">Select an area of expertise to see related subjects and skills.</p>
              )}
              {values.expertise.length > 0 && (
                <div className="custom-subject-entry">
                  <input
                    id="custom-subject"
                    name="customSubject"
                    type="text"
                    maxLength={80}
                    placeholder="Add a custom subject or skill"
                    value={values.customSubject}
                    onChange={updateValue}
                  />
                  <button className="back-button" type="button" onClick={addCustomSubject}>Add</button>
                </div>
              )}
              {values.customSubjects.length > 0 && (
                <div className="choice-grid custom-subject-list" aria-label="Custom subjects">
                  {values.customSubjects.map((subject) => (
                    <span className="custom-subject-item" key={subject}>
                      <input type="hidden" name="subjects" value={subject} />
                      <input type="hidden" name="customSubjects" value={subject} />
                      <button
                        className="custom-subject-chip"
                        type="button"
                        onClick={() => removeCustomSubject(subject)}
                        aria-label={`Remove custom subject ${subject}`}
                      >
                        {subject}<span aria-hidden="true"> ×</span>
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {(selectionErrors.subjects || fieldErrors.subjects) && <span className="field-error" role="alert">{selectionErrors.subjects || fieldErrors.subjects}</span>}
            </fieldset>
            <div className="field">
              <label htmlFor="teaching-experience">Teaching experience</label>
              <select
                id="teaching-experience"
                name="experience"
                value={values.experience}
                onChange={updateValue}
                required
                aria-describedby={fieldErrors.experience ? 'teaching-experience-error' : undefined}
              >
                <option value="">Select experience</option>
                <option value="fresher">Fresher / No Experience</option>
                <option value="less-than-1">Less than 1 year</option>
                <option value="1-3">1–3 years</option>
                <option value="3-5">3–5 years</option>
                <option value="5-10">5–10 years</option>
                <option value="10+">10+ years</option>
              </select>
              {fieldErrors.experience && <span id="teaching-experience-error" className="field-error" role="alert">{fieldErrors.experience}</span>}
            </div>
            <fieldset className="field selection-field full-span">
              <legend>Teaching languages <span className="required-mark">*</span></legend>
              <div className="choice-grid language-choices">
                {teachingLanguages.map((language) => (
                  <label className="choice-chip" key={language}>
                    <input
                      type="checkbox"
                      checked={values.languages.includes(language)}
                      onChange={() => toggleSelection('languages', language)}
                    />
                    <span>{language}</span>
                  </label>
                ))}
              </div>
              {values.languages.includes('Other') && (
                <div className="field custom-language-field">
                  <label htmlFor="custom-language">Other teaching language</label>
                  <input
                    id="custom-language"
                    name="customLanguage"
                    type="text"
                    maxLength={60}
                    placeholder="Enter a language"
                    value={values.customLanguage}
                    onChange={updateValue}
                    required
                    aria-describedby={fieldErrors.customLanguage ? 'custom-language-error' : undefined}
                  />
                  {fieldErrors.customLanguage && <span id="custom-language-error" className="field-error" role="alert">{fieldErrors.customLanguage}</span>}
                </div>
              )}
              {(selectionErrors.languages || fieldErrors.languages) && <span className="field-error" role="alert">{selectionErrors.languages || fieldErrors.languages}</span>}
            </fieldset>
            <label className="terms-checkbox full-span">
              <input
                name="termsAccepted"
                type="checkbox"
                checked={values.termsAccepted}
                onChange={updateValue}
                required
              />
              <span>I agree to the <a href="#instructor-terms">Instructor Terms &amp; Conditions</a>.</span>
            </label>
          </div>
          <p className="approval-note">
            <span className="approval-dot" aria-hidden="true" />
            Instructor accounts are reviewed and require admin approval.
          </p>
          <div className="wizard-actions">
            <button className="back-button" type="button" onClick={() => setStep(1)} disabled={isSubmitting}>Back</button>
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting application…' : 'Submit instructor application'} <span aria-hidden="true">→</span>
            </button>
          </div>
        </>
      )}
    </form>
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
  const isInstructor = role === 'Instructor'

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
    if (isRegistering || role === 'Admin' || !GOOGLE_CLIENT_ID) return undefined

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
  }, [isRegistering, role])

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
      const response = await fetch(`${API_BASE_URL}/auth/${isRegistering ? 'register' : 'login'}`, {
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
              role: role.toLowerCase(),
            }),
      })
      const result = await readApiResponse(response)

      if (!response.ok) {
        throw new Error(
          typeof result.message === 'string'
            ? result.message
            : `${isRegistering ? 'Registration' : 'Login'} failed. Please try again.`,
        )
      }

      if (isRegistering) {
        if (response.status !== 201 || typeof result.user?.id !== 'string') {
          throw new Error('The server could not confirm account creation. Please try again.')
        }

        onRegistrationSuccess('Your account was created successfully. You can now log in.')
        return
      }

      const expectedRole = role.toLowerCase()
      if (
        typeof result.token !== 'string' ||
        typeof result.user?.id !== 'string' ||
        result.user.role !== expectedRole
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
      role: role.toLowerCase(),
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
        {isRegistering && <p className="eyebrow">CREATE YOUR ACCOUNT</p>}
        <h1>{isRegistering ? title : 'Login'}</h1>
        <p className="form-subtitle">
          {isRegistering
            ? isInstructor
              ? 'Share your expertise with a community ready to learn.'
              : 'Build a learning habit that takes you somewhere new.'
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

      {!isRegistering && role !== 'Admin' && (
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

function DashboardPage({ role }) {
  const [user, setUser] = useState(null)
  const [error, setError] = useState('')
  const roleLabels = { student: 'Student', instructor: 'Instructor', admin: 'Admin' }

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
          (role === 'instructor' && !userIsActive)
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

  if (role === 'admin' && user) {
    return <AdminDashboard email={user.email} onLogout={signOut} />
  }
  if (role === 'instructor' && user) {
    return (
      <InstructorDashboard
        fullName={user.fullName}
        email={user.email}
        onLogout={signOut}
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
  const [mode, setMode] = useState('login')
  const [message, setMessage] = useState(null)
  const [isDark, setIsDark] = useState(false)
  const isRegistering = mode === 'register'
  const selectedRole = 'Student'
  const dashboardRole = location.pathname.startsWith('/user/')
    ? 'student'
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

  if (dashboardRole) {
    return <DashboardPage role={dashboardRole} />
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
            key={`${mode}-${selectedRole}`}
            mode={mode}
            role={selectedRole}
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
        <div className="form-bottom"><span>Made for curious minds</span><span>© 2025 Morrow Learning</span></div>
      </section>
    </main>
  )
}

export default App
