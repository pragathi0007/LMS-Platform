import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from './api-base-url.js'
import { fetchWithAuth, isInvalidSessionResponse } from './auth-session.js'
import './StudentProfile.css'

function ProfileIcon({ name, size = 16 }) {
  const iconPaths = {
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    edit: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m14 7 3 3" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
    trash: <><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    check: <><path d="M20 6 9 17l-5-5" /></>,
    x: <><path d="M18 6 6 18M6 6l12 12" /></>,
    award: <><circle cx="12" cy="8" r="5" /><path d="m8.5 12-1 9 4.5-2.5 4.5 2.5-1-9" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8m-8 4h8" /></>,
    code: <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V4h8v3m-13 5h18m-11 0v2h4v-2" /></>,
    graduation: <><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1.1-1.1" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
    github: <><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></>,
    external: <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m4-3h6v6m-11 5L21 3" /></>,
    camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
    spark: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
    chart: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 5-6m-4 0h4v4" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name] || iconPaths.spark}
    </svg>
  )
}

const SKILL_CATEGORIES = [
  'Programming Languages',
  'Frontend Development',
  'Backend Development',
  'Databases',
  'Frameworks & Libraries',
  'Tools & Technologies',
  'Other Technical Skills',
]

const PROFICIENCY_LEVELS = ['Beginner', 'Intermediate', 'Advanced']

const EMPLOYMENT_TYPES = [
  'Internship',
  'Work experience',
  'Freelance work',
  'Leadership',
  'Volunteering',
  'Other',
]

function ensureSafeUrl(url) {
  if (!url || typeof url !== 'string') return ''
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

export default function StudentProfile({ user, onLogout, onAccountUpdated }) {
  const [profileData, setProfileData] = useState(null)
  const [accountData, setAccountData] = useState(null)
  const [platformCerts, setPlatformCerts] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [completion, setCompletion] = useState({ percentage: 0, steps: [], suggestions: [] })
  const [learningSummary, setLearningSummary] = useState(null)
  const [activeTab, setActiveTab] = useState('portfolio')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isDownloadingResume, setIsDownloadingResume] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Modals state
  const [activeModal, setActiveModal] = useState(null)
  const [editingItem, setEditingItem] = useState(null)
  const fileInputRef = useRef(null)

  function getAuth() {
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      return savedAuth ? JSON.parse(savedAuth) : null
    } catch {
      return null
    }
  }

  async function loadProfile() {
    const auth = getAuth()
    if (!auth?.token) {
      onLogout()
      return
    }

    try {
      setIsLoading(true)
      setError('')
      const [profileRes, summaryRes] = await Promise.all([
        fetchWithAuth(`${API_BASE_URL}/student/profile`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        }, API_BASE_URL, auth.token),
        fetchWithAuth(`${API_BASE_URL}/learning/summary`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        }, API_BASE_URL, auth.token).catch(() => null),
      ])

      const profileJson = await profileRes.json()
      if (isInvalidSessionResponse(profileRes, profileJson)) {
        onLogout()
        return
      }

      if (!profileRes.ok) {
        throw new Error(profileJson.message || 'Profile could not be loaded.')
      }

      setProfileData(profileJson.profile || {})
      setAccountData(profileJson.account || {})
      setPlatformCerts(profileJson.platformCertificates || [])
      setEnrollments(profileJson.enrollments || [])
      setCompletion(profileJson.completion || { percentage: 0, steps: [], suggestions: [] })

      if (summaryRes?.ok) {
        const summaryJson = await summaryRes.json()
        setLearningSummary(summaryJson.summary || null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profile could not be loaded.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
  }, [])

  async function handleAvatarUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return

    const auth = getAuth()
    if (!auth?.token) return onLogout()

    const formData = new FormData()
    formData.append('avatar', file)

    try {
      setIsUploadingAvatar(true)
      const response = await fetch(`${API_BASE_URL}/student/profile/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}` },
        body: formData,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Could not upload avatar.')

      setAccountData((prev) => ({ ...prev, avatarUrl: result.avatarUrl }))
      if (onAccountUpdated) {
        onAccountUpdated({ ...user, avatarUrl: result.avatarUrl })
      }
      setStatusMessage('Profile picture updated.')
      setTimeout(() => setStatusMessage(''), 3000)
      loadProfile()
    } catch (uploadErr) {
      setError(uploadErr instanceof Error ? uploadErr.message : 'Avatar upload failed.')
    } finally {
      setIsUploadingAvatar(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleAvatarDelete() {
    const auth = getAuth()
    if (!auth?.token) return onLogout()

    try {
      setIsUploadingAvatar(true)
      const response = await fetchWithAuth(`${API_BASE_URL}/student/profile/avatar`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${auth.token}` },
      }, API_BASE_URL, auth.token)
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Could not remove avatar.')

      setAccountData((prev) => ({ ...prev, avatarUrl: '' }))
      if (onAccountUpdated) {
        onAccountUpdated({ ...user, avatarUrl: '' })
      }
      setStatusMessage('Profile picture removed.')
      setTimeout(() => setStatusMessage(''), 3000)
      loadProfile()
    } catch (delErr) {
      setError(delErr instanceof Error ? delErr.message : 'Avatar removal failed.')
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  async function handleDownloadResume() {
    const auth = getAuth()
    if (!auth?.token) return onLogout()

    try {
      setIsDownloadingResume(true)
      const response = await fetchWithAuth(`${API_BASE_URL}/student/profile/resume`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      }, API_BASE_URL, auth.token)

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}))
        throw new Error(errorJson.message || 'Could not generate resume.')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(accountData?.fullName || user?.fullName || 'Student').replace(/[^a-zA-Z0-9_-]/g, '_')}_Resume.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      setStatusMessage('Resume downloaded successfully!')
      setTimeout(() => setStatusMessage(''), 3000)
    } catch (resumeErr) {
      setError(resumeErr instanceof Error ? resumeErr.message : 'Failed to download resume.')
    } finally {
      setIsDownloadingResume(false)
    }
  }

  async function saveProfilePatch(patch) {
    const auth = getAuth()
    if (!auth?.token) return onLogout()

    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/student/profile`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      }, API_BASE_URL, auth.token)

      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Failed to update profile.')

      setProfileData(result.profile)
      if (result.account) {
        setAccountData(result.account)
        if (onAccountUpdated) {
          onAccountUpdated({ ...user, ...result.account })
        }
      }
      if (result.completion) setCompletion(result.completion)
      setActiveModal(null)
      setEditingItem(null)
      setStatusMessage('Profile updated successfully.')
      setTimeout(() => setStatusMessage(''), 3000)
    } catch (patchErr) {
      setError(patchErr instanceof Error ? patchErr.message : 'Update failed.')
    }
  }

  // Skills CRUD
  function handleSaveSkill(skill) {
    const existingSkills = profileData?.skills || []
    let updated = []
    if (editingItem?._id) {
      updated = existingSkills.map((s) => (s._id === editingItem._id ? { ...s, ...skill } : s))
    } else {
      updated = [...existingSkills, skill]
    }
    saveProfilePatch({ skills: updated })
  }

  function handleDeleteSkill(skillId) {
    const updated = (profileData?.skills || []).filter((s) => s._id !== skillId)
    saveProfilePatch({ skills: updated })
  }

  // Projects CRUD
  function handleSaveProject(project) {
    const existing = profileData?.projects || []
    let updated = []
    if (editingItem?._id) {
      updated = existing.map((p) => (p._id === editingItem._id ? { ...p, ...project } : p))
    } else {
      updated = [...existing, project]
    }
    saveProfilePatch({ projects: updated })
  }

  function handleDeleteProject(projectId) {
    const updated = (profileData?.projects || []).filter((p) => p._id !== projectId)
    saveProfilePatch({ projects: updated })
  }

  // Experience CRUD
  function handleSaveExperience(exp) {
    const existing = profileData?.experience || []
    let updated = []
    if (editingItem?._id) {
      updated = existing.map((e) => (e._id === editingItem._id ? { ...e, ...exp } : e))
    } else {
      updated = [...existing, exp]
    }
    saveProfilePatch({ experience: updated })
  }

  function handleDeleteExperience(expId) {
    const updated = (profileData?.experience || []).filter((e) => e._id !== expId)
    saveProfilePatch({ experience: updated })
  }

  // Education CRUD
  function handleSaveEducation(edu) {
    const existing = profileData?.education || []
    let updated = []
    if (editingItem?._id) {
      updated = existing.map((e) => (e._id === editingItem._id ? { ...e, ...edu } : e))
    } else {
      updated = [...existing, edu]
    }
    saveProfilePatch({ education: updated })
  }

  function handleDeleteEducation(eduId) {
    const updated = (profileData?.education || []).filter((e) => e._id !== eduId)
    saveProfilePatch({ education: updated })
  }

  // External Certifications CRUD
  function handleSaveExternalCert(cert) {
    const existing = profileData?.externalCertifications || []
    let updated = []
    if (editingItem?._id) {
      updated = existing.map((c) => (c._id === editingItem._id ? { ...c, ...cert } : c))
    } else {
      updated = [...existing, cert]
    }
    saveProfilePatch({ externalCertifications: updated })
  }

  function handleDeleteExternalCert(certId) {
    const updated = (profileData?.externalCertifications || []).filter((c) => c._id !== certId)
    saveProfilePatch({ externalCertifications: updated })
  }

  const currentUser = accountData || user
  const fullName = currentUser?.fullName || 'Student'
  const initials = fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'S'
  const avatarUrl = currentUser?.avatarUrl || ''
  const headline = profileData?.headline || currentUser?.headline || ''
  const bio = profileData?.bio || currentUser?.bio || ''
  const location = profileData?.location || currentUser?.location || ''
  const phone = profileData?.phone || currentUser?.phone || ''
  const collegeName = currentUser?.collegeName || null
  const department = currentUser?.department || null
  const batch = currentUser?.batch || null

  const enrolledCount = learningSummary?.enrolledCourses ?? enrollments.length
  const completedCount = learningSummary?.completedCourses ?? enrollments.filter((e) => e.status === 'completed').length
  const inProgressCount = enrollments.filter((e) => e.status === 'active').length
  const streakDays = learningSummary?.learningStreak ?? 0
  const progressPercent = learningSummary?.completionPercentage ?? 0

  if (isLoading && !profileData) {
    return (
      <div className="student-state-card" aria-live="polite">
        <span className="student-spinner" aria-hidden="true" />
        <p>Loading your student profile & portfolio…</p>
      </div>
    )
  }

  return (
    <div className="student-portfolio-page">
      {statusMessage && (
        <div className="student-profile-alert is-success" role="status">
          <ProfileIcon name="check" size={16} /> {statusMessage}
        </div>
      )}
      {error && (
        <div className="student-profile-alert is-error" role="alert">
          <ProfileIcon name="x" size={16} /> {error}
        </div>
      )}

      {/* Hero Header */}
      <section className="student-portfolio-hero" aria-label="Student Profile Header">
        <div className="student-portfolio-hero__banner">
          <div className="student-portfolio-hero__banner-art" />
        </div>

        <div className="student-portfolio-hero__body">
          <div className="student-portfolio-hero__top-row">
            <div className="student-portfolio-avatar-wrap">
              <div className="student-portfolio-avatar">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={fullName} />
                ) : (
                  <span>{initials}</span>
                )}
                <label className="student-portfolio-avatar__overlay" title="Upload new photo">
                  <ProfileIcon name="camera" size={18} />
                  <span>{isUploadingAvatar ? 'Saving…' : 'Change'}</span>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleAvatarUpload}
                    disabled={isUploadingAvatar}
                  />
                </label>
              </div>
              <div className="student-portfolio-avatar-actions">
                <button
                  type="button"
                  className="student-portfolio-avatar-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingAvatar}
                >
                  <ProfileIcon name="camera" size={13} /> Photo
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    className="student-portfolio-avatar-btn is-delete"
                    onClick={handleAvatarDelete}
                    disabled={isUploadingAvatar}
                    title="Remove profile picture"
                  >
                    <ProfileIcon name="trash" size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="student-portfolio-hero__cta-group">
              <button
                type="button"
                className="student-portfolio-btn student-portfolio-btn--secondary"
                onClick={() => setActiveModal('editBasic')}
              >
                <ProfileIcon name="edit" size={15} /> Edit Profile
              </button>
              <button
                type="button"
                className="student-portfolio-btn student-portfolio-btn--resume"
                onClick={handleDownloadResume}
                disabled={isDownloadingResume}
              >
                <ProfileIcon name="download" size={15} />
                {isDownloadingResume ? 'Generating…' : 'Download Resume'}
              </button>
            </div>
          </div>

          <div className="student-portfolio-hero__info">
            <h1>{fullName}</h1>
            <p className="student-portfolio-hero__headline">
              {headline || 'Aspiring Professional · aiHustle Learner'}
            </p>

            <div className="student-portfolio-hero__pills">
              {currentUser?.studentType === 'college' ? (
                <span className="student-portfolio-pill is-gold">
                  <ProfileIcon name="graduation" size={14} />
                  {collegeName || 'College Student'}
                  {department ? ` · ${department}` : ''}
                  {batch ? ` (${batch})` : ''}
                </span>
              ) : (
                <span className="student-portfolio-pill is-gold">
                  <ProfileIcon name="user" size={14} /> Independent Student
                </span>
              )}
              {location && (
                <span className="student-portfolio-pill">
                  <ProfileIcon name="globe" size={13} /> {location}
                </span>
              )}
              {phone && (
                <span className="student-portfolio-pill">
                  📞 {phone}
                </span>
              )}
              <span className="student-portfolio-pill is-verified">
                <ProfileIcon name="check" size={13} />
                {currentUser?.emailVerified ? 'Email Verified' : 'Registered Student'}
              </span>
            </div>

            {bio && <p className="student-portfolio-hero__bio">{bio}</p>}
          </div>

          {/* Dynamic Profile Completion */}
          <div className="student-portfolio-completion">
            <div className="student-portfolio-completion__left">
              <span className="student-portfolio-completion__badge">
                Profile Strength: {completion.percentage}%
              </span>
              <div className="student-portfolio-completion__track" aria-hidden="true">
                <div
                  className="student-portfolio-completion__fill"
                  style={{ width: `${completion.percentage}%` }}
                />
              </div>
            </div>
            {completion.suggestions?.length > 0 && (
              <button
                type="button"
                className="student-portfolio-completion__toggle"
                onClick={() => setShowSuggestions((prev) => !prev)}
              >
                {showSuggestions ? 'Hide suggestions ▲' : `${completion.suggestions.length} suggestions available ▼`}
              </button>
            )}
          </div>

          {showSuggestions && completion.suggestions?.length > 0 && (
            <div className="student-portfolio-suggestions">
              <h4>Recommended steps to reach 100% profile strength:</h4>
              <ul>
                {completion.suggestions.map((sug, idx) => (
                  <li key={idx}>{sug}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Tabs Navigation */}
      <nav className="student-portfolio-nav" aria-label="Profile sections">
        <button
          type="button"
          className={`student-portfolio-tab${activeTab === 'portfolio' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('portfolio')}
        >
          <ProfileIcon name="code" size={16} /> Portfolio & Experience
        </button>
        <button
          type="button"
          className={`student-portfolio-tab${activeTab === 'certifications' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('certifications')}
        >
          <ProfileIcon name="award" size={16} /> Certifications & Achievements
        </button>
        <button
          type="button"
          className={`student-portfolio-tab${activeTab === 'career' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('career')}
        >
          <ProfileIcon name="briefcase" size={16} /> Career Goals & Links
        </button>
        <button
          type="button"
          className={`student-portfolio-tab${activeTab === 'account' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('account')}
        >
          <ProfileIcon name="user" size={16} /> Account & Learning
        </button>
      </nav>

      {/* Tab Panels */}
      <div className="student-portfolio-panel-grid">
        {/* TAB 1: PORTFOLIO & EXPERIENCE */}
        {activeTab === 'portfolio' && (
          <>
            {/* 1. Technical Skills */}
            <section className="student-portfolio-card" aria-label="Technical Skills">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="code" size={20} />
                  <div>
                    <h3>Technical Skills</h3>
                    <p>Organize your programming, framework, and tooling proficiencies.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="student-portfolio-add-btn"
                  onClick={() => {
                    setEditingItem(null)
                    setActiveModal('skill')
                  }}
                >
                  <ProfileIcon name="plus" size={14} /> Add Skill
                </button>
              </header>

              {(!profileData?.skills || profileData.skills.length === 0) ? (
                <div className="student-empty">
                  <span className="student-empty__icon"><ProfileIcon name="code" size={22} /></span>
                  <h3>No technical skills added yet</h3>
                  <p>Add languages, frameworks, databases, and tools to highlight your capabilities.</p>
                </div>
              ) : (
                <div className="student-skills-grid">
                  {SKILL_CATEGORIES.map((category) => {
                    const skillsInCategory = (profileData.skills || []).filter((s) => s.category === category)
                    if (skillsInCategory.length === 0) return null
                    return (
                      <div className="student-skill-category-card" key={category}>
                        <h4>
                          <span>{category}</span>
                          <small>({skillsInCategory.length})</small>
                        </h4>
                        <div className="student-skill-badges">
                          {skillsInCategory.map((skill) => (
                            <span className="student-skill-badge" key={skill._id || skill.name}>
                              <span>{skill.name}</span>
                              <span className={`student-skill-badge__level is-${skill.proficiency?.toLowerCase() || 'intermediate'}`}>
                                {skill.proficiency}
                              </span>
                              <button
                                type="button"
                                className="student-skill-badge__remove"
                                onClick={() => handleDeleteSkill(skill._id)}
                                title="Remove skill"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* 2. Projects & Portfolio */}
            <section className="student-portfolio-card" aria-label="Projects & Portfolio">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="spark" size={20} />
                  <div>
                    <h3>Projects & Practical Work</h3>
                    <p>Showcase applications, systems, and creative solutions you've developed.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="student-portfolio-add-btn"
                  onClick={() => {
                    setEditingItem(null)
                    setActiveModal('project')
                  }}
                >
                  <ProfileIcon name="plus" size={14} /> Add Project
                </button>
              </header>

              {(!profileData?.projects || profileData.projects.length === 0) ? (
                <div className="student-empty">
                  <span className="student-empty__icon"><ProfileIcon name="spark" size={22} /></span>
                  <h3>No projects showcased yet</h3>
                  <p>Add projects you've built with links to GitHub repos and live demonstrations.</p>
                </div>
              ) : (
                <div className="student-projects-grid">
                  {profileData.projects.map((proj) => (
                    <article className="student-project-card" key={proj._id || proj.title}>
                      <div className="student-project-card__top">
                        <div>
                          <h4>{proj.title}</h4>
                          {proj.role && <span className="student-project-card__role">{proj.role}</span>}
                        </div>
                        <div className="student-item-action-btns">
                          <button
                            type="button"
                            className="student-icon-action-btn"
                            onClick={() => {
                              setEditingItem(proj)
                              setActiveModal('project')
                            }}
                            title="Edit project"
                          >
                            <ProfileIcon name="edit" size={14} />
                          </button>
                          <button
                            type="button"
                            className="student-icon-action-btn is-delete"
                            onClick={() => handleDeleteProject(proj._id)}
                            title="Delete project"
                          >
                            <ProfileIcon name="trash" size={14} />
                          </button>
                        </div>
                      </div>

                      <p className="student-project-card__desc">{proj.description}</p>

                      {Array.isArray(proj.technologies) && proj.technologies.length > 0 && (
                        <div className="student-project-card__tags">
                          {proj.technologies.map((tech) => (
                            <span className="student-project-card__tag" key={tech}>{tech}</span>
                          ))}
                        </div>
                      )}

                      <footer className="student-project-card__footer">
                        <div className="student-project-card__links">
                          {proj.githubUrl && (
                            <a
                              href={ensureSafeUrl(proj.githubUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="student-project-link"
                            >
                              <ProfileIcon name="github" size={14} /> GitHub
                            </a>
                          )}
                          {proj.liveUrl && (
                            <a
                              href={ensureSafeUrl(proj.liveUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="student-project-link"
                            >
                              <ProfileIcon name="external" size={14} /> Live Demo
                            </a>
                          )}
                        </div>
                        {proj.completionDate && (
                          <small style={{ fontSize: '11px', color: 'var(--student-muted)' }}>
                            {proj.completionDate}
                          </small>
                        )}
                      </footer>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* 3. Professional Experience */}
            <section className="student-portfolio-card" aria-label="Professional Experience">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="briefcase" size={20} />
                  <div>
                    <h3>Professional Experience</h3>
                    <p>Internships, full-time positions, freelance contracts, and leadership roles.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="student-portfolio-add-btn"
                  onClick={() => {
                    setEditingItem(null)
                    setActiveModal('experience')
                  }}
                >
                  <ProfileIcon name="plus" size={14} /> Add Experience
                </button>
              </header>

              {(!profileData?.experience || profileData.experience.length === 0) ? (
                <div className="student-empty">
                  <span className="student-empty__icon"><ProfileIcon name="briefcase" size={22} /></span>
                  <h3>No experience entries yet</h3>
                  <p>Document your internships, freelancing, volunteering, and campus leadership.</p>
                </div>
              ) : (
                <div className="student-timeline-list">
                  {profileData.experience.map((exp) => (
                    <article className="student-timeline-item" key={exp._id || exp.position}>
                      <div className="student-timeline-item__top">
                        <div>
                          <h4 className="student-timeline-item__title">{exp.position}</h4>
                          <div className="student-timeline-item__org">{exp.organization}</div>
                        </div>
                        <div className="student-item-action-btns">
                          <button
                            type="button"
                            className="student-icon-action-btn"
                            onClick={() => {
                              setEditingItem(exp)
                              setActiveModal('experience')
                            }}
                            title="Edit experience"
                          >
                            <ProfileIcon name="edit" size={14} />
                          </button>
                          <button
                            type="button"
                            className="student-icon-action-btn is-delete"
                            onClick={() => handleDeleteExperience(exp._id)}
                            title="Delete experience"
                          >
                            <ProfileIcon name="trash" size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="student-timeline-item__meta">
                        <span className="student-portfolio-pill">{exp.employmentType}</span>
                        <span>
                          {exp.startDate} – {exp.isCurrent ? 'Present' : (exp.endDate || 'Present')}
                        </span>
                      </div>

                      {exp.description && (
                        <p className="student-timeline-item__desc">{exp.description}</p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* 4. Education */}
            <section className="student-portfolio-card" aria-label="Education">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="graduation" size={20} />
                  <div>
                    <h3>Education</h3>
                    <p>Degree, university/college, graduation timeline, and academic standing.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="student-portfolio-add-btn"
                  onClick={() => {
                    setEditingItem(null)
                    setActiveModal('education')
                  }}
                >
                  <ProfileIcon name="plus" size={14} /> Add Education
                </button>
              </header>

              {(!profileData?.education || profileData.education.length === 0) ? (
                <div className="student-empty">
                  <span className="student-empty__icon"><ProfileIcon name="graduation" size={22} /></span>
                  <h3>No education details added</h3>
                  <p>Add your college degree, department, and expected graduation year.</p>
                </div>
              ) : (
                <div className="student-timeline-list">
                  {profileData.education.map((edu) => (
                    <article className="student-timeline-item" key={edu._id || edu.institution}>
                      <div className="student-timeline-item__top">
                        <div>
                          <h4 className="student-timeline-item__title">{edu.degree}</h4>
                          <div className="student-timeline-item__org">
                            {edu.institution}
                            {edu.fieldOfStudy ? ` · ${edu.fieldOfStudy}` : ''}
                          </div>
                        </div>
                        <div className="student-item-action-btns">
                          <button
                            type="button"
                            className="student-icon-action-btn"
                            onClick={() => {
                              setEditingItem(edu)
                              setActiveModal('education')
                            }}
                            title="Edit education"
                          >
                            <ProfileIcon name="edit" size={14} />
                          </button>
                          <button
                            type="button"
                            className="student-icon-action-btn is-delete"
                            onClick={() => handleDeleteEducation(edu._id)}
                            title="Delete education"
                          >
                            <ProfileIcon name="trash" size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="student-timeline-item__meta">
                        <span>
                          {edu.startYear ? `${edu.startYear} – ` : ''}
                          {edu.isCurrent ? 'Currently Studying' : (edu.endYear || 'Present')}
                        </span>
                        {edu.academicDetails && <span>• {edu.academicDetails}</span>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* TAB 2: CERTIFICATIONS & ACHIEVEMENTS */}
        {activeTab === 'certifications' && (
          <>
            {/* aiHustle Platform Certificates */}
            <section className="student-portfolio-card" aria-label="Platform Certificates">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="award" size={20} />
                  <div>
                    <h3>aiHustle Course Certificates</h3>
                    <p>Verified certificates earned by completing LMS courses, quizzes, and projects.</p>
                  </div>
                </div>
                <Link to="/student/certificates" className="student-portfolio-add-btn">
                  View All Certificates →
                </Link>
              </header>

              {platformCerts.length === 0 ? (
                <div className="student-empty">
                  <span className="student-empty__icon"><ProfileIcon name="award" size={22} /></span>
                  <h3>No certificates earned yet</h3>
                  <p>Complete course lessons, pass required quizzes, and submit assignments to earn certificates.</p>
                </div>
              ) : (
                <div className="student-certs-grid">
                  {platformCerts.map((cert) => (
                    <article className="student-cert-card is-platform" key={cert.certificateId}>
                      <div className="student-cert-card__top">
                        <h4>{cert.courseName}</h4>
                        <span className="student-cert-badge is-platform">
                          <ProfileIcon name="check" size={11} /> Platform Verified
                        </span>
                      </div>
                      <div className="student-cert-card__id">ID: {cert.certificateId}</div>
                      <div className="student-cert-card__meta">
                        Issued: {new Date(cert.completedAt || cert.issuedAt).toLocaleDateString()}
                      </div>
                      <div style={{ marginTop: 'auto', display: 'flex', gap: '8px', paddingTop: '8px' }}>
                        <Link
                          to={`/student/certificates`}
                          className="student-portfolio-btn student-portfolio-btn--secondary"
                          style={{ fontSize: '11.5px', padding: '4px 10px' }}
                        >
                          View Certificate
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* Achievements & Milestones */}
            <section className="student-portfolio-card" aria-label="Learning Milestones">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="spark" size={20} />
                  <div>
                    <h3>Learning Milestones & Badges</h3>
                    <p>Real LMS milestones unlocked through consistent learning and course progression.</p>
                  </div>
                </div>
              </header>

              <div className="student-achievements-row">
                <div className={`student-achievement-card${completedCount > 0 ? '' : ' is-unearned'}`}>
                  <div className="student-achievement-card__icon"><ProfileIcon name="award" size={22} /></div>
                  <div>
                    <h4>Course Completer</h4>
                    <p>{completedCount > 0 ? `Finished ${completedCount} course(s)` : 'Finish your first course'}</p>
                  </div>
                </div>

                <div className={`student-achievement-card${enrolledCount > 0 ? '' : ' is-unearned'}`}>
                  <div className="student-achievement-card__icon"><ProfileIcon name="book" size={22} /></div>
                  <div>
                    <h4>Active Learner</h4>
                    <p>{enrolledCount > 0 ? `${enrolledCount} course(s) enrolled` : 'Enroll in a course'}</p>
                  </div>
                </div>

                <div className={`student-achievement-card${streakDays >= 3 ? '' : ' is-unearned'}`}>
                  <div className="student-achievement-card__icon"><ProfileIcon name="spark" size={22} /></div>
                  <div>
                    <h4>Dedicated Streak</h4>
                    <p>{streakDays > 0 ? `${streakDays} day streak active` : 'Study 3 days in a row'}</p>
                  </div>
                </div>

                <div className={`student-achievement-card${progressPercent >= 50 ? '' : ' is-unearned'}`}>
                  <div className="student-achievement-card__icon"><ProfileIcon name="chart" size={22} /></div>
                  <div>
                    <h4>Milestone Achiever</h4>
                    <p>{progressPercent >= 50 ? `${progressPercent}% overall completed` : 'Reach 50% course progress'}</p>
                  </div>
                </div>
              </div>
            </section>

            {/* External Certifications */}
            <section className="student-portfolio-card" aria-label="External Credentials">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="graduation" size={20} />
                  <div>
                    <h3>External Certifications</h3>
                    <p>Credentials earned from AWS, Google Cloud, Coursera, HackerRank, or other providers.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="student-portfolio-add-btn"
                  onClick={() => {
                    setEditingItem(null)
                    setActiveModal('externalCert')
                  }}
                >
                  <ProfileIcon name="plus" size={14} /> Add Credential
                </button>
              </header>

              {(!profileData?.externalCertifications || profileData.externalCertifications.length === 0) ? (
                <div className="student-empty">
                  <span className="student-empty__icon"><ProfileIcon name="graduation" size={22} /></span>
                  <h3>No external certifications added</h3>
                  <p>Add industry certifications to strengthen your professional portfolio.</p>
                </div>
              ) : (
                <div className="student-certs-grid">
                  {profileData.externalCertifications.map((cert) => (
                    <article className="student-cert-card" key={cert._id || cert.name}>
                      <div className="student-cert-card__top">
                        <h4>{cert.name}</h4>
                        <div className="student-item-action-btns">
                          <button
                            type="button"
                            className="student-icon-action-btn"
                            onClick={() => {
                              setEditingItem(cert)
                              setActiveModal('externalCert')
                            }}
                            title="Edit certificate"
                          >
                            <ProfileIcon name="edit" size={14} />
                          </button>
                          <button
                            type="button"
                            className="student-icon-action-btn is-delete"
                            onClick={() => handleDeleteExternalCert(cert._id)}
                            title="Delete certificate"
                          >
                            <ProfileIcon name="trash" size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="student-cert-card__id">{cert.issuingOrganization}</div>
                      {cert.issueDate && (
                        <div className="student-cert-card__meta">Issued: {cert.issueDate}</div>
                      )}

                      {cert.credentialUrl && (
                        <div style={{ marginTop: 'auto', paddingTop: '6px' }}>
                          <a
                            href={ensureSafeUrl(cert.credentialUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="student-project-link"
                          >
                            <ProfileIcon name="external" size={13} /> Verify Credential
                          </a>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* TAB 3: CAREER & SOCIAL LINKS */}
        {activeTab === 'career' && (
          <div className="student-career-grid">
            <section className="student-portfolio-card" aria-label="Career Interests">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="briefcase" size={20} />
                  <div>
                    <h3>Career Interests & Goals</h3>
                    <p>Desired roles, industries, and technical ambitions.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="student-portfolio-add-btn"
                  onClick={() => setActiveModal('careerSocial')}
                >
                  <ProfileIcon name="edit" size={14} /> Edit
                </button>
              </header>

              <dl>
                <div className="student-career-field">
                  <dt>Desired Job Role</dt>
                  <dd>{profileData?.careerInterests?.desiredRole || 'Not specified'}</dd>
                </div>
                <div className="student-career-field">
                  <dt>Preferred Industry</dt>
                  <dd>{profileData?.careerInterests?.preferredIndustry || 'Not specified'}</dd>
                </div>
                <div className="student-career-field">
                  <dt>Target Technologies</dt>
                  <dd>
                    {Array.isArray(profileData?.careerInterests?.interestedTechnologies) && profileData.careerInterests.interestedTechnologies.length > 0
                      ? profileData.careerInterests.interestedTechnologies.join(', ')
                      : 'Not specified'}
                  </dd>
                </div>
                <div className="student-career-field">
                  <dt>Career Goals & Vision</dt>
                  <dd style={{ fontWeight: 400, lineHeight: 1.5 }}>
                    {profileData?.careerInterests?.careerGoals || 'Not specified yet. Add your 1-year and 3-year career objectives.'}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="student-portfolio-card" aria-label="Social & Professional Profiles">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="link" size={20} />
                  <div>
                    <h3>Social & Professional Links</h3>
                    <p>Online presence and verified developer profiles.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="student-portfolio-add-btn"
                  onClick={() => setActiveModal('careerSocial')}
                >
                  <ProfileIcon name="edit" size={14} /> Edit
                </button>
              </header>

              <div className="student-social-links-list">
                <div className="student-social-link-row">
                  <strong>LinkedIn</strong>
                  {profileData?.socialLinks?.linkedin ? (
                    <a href={ensureSafeUrl(profileData.socialLinks.linkedin)} target="_blank" rel="noopener noreferrer">
                      {profileData.socialLinks.linkedin}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--student-muted)' }}>Not connected</span>
                  )}
                </div>

                <div className="student-social-link-row">
                  <strong>GitHub</strong>
                  {profileData?.socialLinks?.github ? (
                    <a href={ensureSafeUrl(profileData.socialLinks.github)} target="_blank" rel="noopener noreferrer">
                      {profileData.socialLinks.github}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--student-muted)' }}>Not connected</span>
                  )}
                </div>

                <div className="student-social-link-row">
                  <strong>Portfolio</strong>
                  {profileData?.socialLinks?.portfolio ? (
                    <a href={ensureSafeUrl(profileData.socialLinks.portfolio)} target="_blank" rel="noopener noreferrer">
                      {profileData.socialLinks.portfolio}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--student-muted)' }}>Not connected</span>
                  )}
                </div>

                <div className="student-social-link-row">
                  <strong>Other Link</strong>
                  {profileData?.socialLinks?.other ? (
                    <a href={ensureSafeUrl(profileData.socialLinks.other)} target="_blank" rel="noopener noreferrer">
                      {profileData.socialLinks.other}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--student-muted)' }}>Not connected</span>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 4: ACCOUNT & LEARNING ACTIVITY */}
        {activeTab === 'account' && (
          <>
            {/* Account Information */}
            <section className="student-portfolio-card" aria-label="Account Information">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="user" size={20} />
                  <div>
                    <h3>Account Information</h3>
                    <p>Primary LMS credentials and university affiliation.</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="student-portfolio-btn student-portfolio-btn--secondary"
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                    onClick={() => setActiveModal('editBasic')}
                  >
                    <ProfileIcon name="edit" size={14} /> Edit Info
                  </button>
                  <Link
                    to="/student/settings"
                    className="student-portfolio-btn student-portfolio-btn--secondary"
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Account Settings →
                  </Link>
                </div>
              </header>

              <dl className="student-profile-details">
                <div><dt>Full name</dt><dd>{fullName}</dd></div>
                <div><dt>Username</dt><dd>{currentUser?.username || 'Not available'}</dd></div>
                <div><dt>Email</dt><dd>{currentUser?.email || 'Not available'}</dd></div>
                <div>
                  <dt>Email verification</dt>
                  <dd>
                    <span className="student-portfolio-pill is-verified">
                      <ProfileIcon name="check" size={12} />
                      {currentUser?.emailVerified ? 'Verified' : 'Registered'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Account type</dt>
                  <dd>{currentUser?.studentType === 'college' ? 'College Student' : 'Independent Student'}</dd>
                </div>
                {currentUser?.studentType === 'college' && (
                  <>
                    <div><dt>College</dt><dd>{collegeName || 'Not recorded'}</dd></div>
                    {department && <div><dt>Department</dt><dd>{department}</dd></div>}
                    {batch && <div><dt>Batch</dt><dd>{batch}</dd></div>}
                  </>
                )}
                <div><dt>Phone number</dt><dd>{phone || 'Not provided'}</dd></div>
              </dl>
            </section>

            {/* Learning Overview */}
            <section className="student-portfolio-card" aria-label="Learning Overview">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="book" size={20} />
                  <div>
                    <h3>Learning Overview</h3>
                    <p>Live stats from your enrolled courses, completions, and streak.</p>
                  </div>
                </div>
              </header>

              <div className="student-stats" aria-label="Learning stats">
                <Link className="student-stat is-peach student-profile-stat-link" to="/student/courses?filter=enrolled">
                  <span className="student-stat__icon is-peach"><ProfileIcon name="book" size={19} /></span>
                  <span className="student-stat__label">Enrolled Courses</span>
                  <strong className="student-stat__value">{enrolledCount}</strong>
                  <small>Open enrolled courses</small>
                </Link>

                <Link className="student-stat is-mint student-profile-stat-link" to="/student/courses?filter=completed">
                  <span className="student-stat__icon is-mint"><ProfileIcon name="award" size={19} /></span>
                  <span className="student-stat__label">Completed Courses</span>
                  <strong className="student-stat__value">{completedCount}</strong>
                  <small>View completed courses</small>
                </Link>

                <Link className="student-stat is-gold student-profile-stat-link" to="/student/courses?filter=active">
                  <span className="student-stat__icon is-gold"><ProfileIcon name="chart" size={19} /></span>
                  <span className="student-stat__label">In Progress</span>
                  <strong className="student-stat__value">{inProgressCount}</strong>
                  <small>Continue current learning</small>
                </Link>

                <Link className="student-stat is-blue student-profile-stat-link" to="/student/learning-activity">
                  <span className="student-stat__icon is-blue"><ProfileIcon name="spark" size={19} /></span>
                  <span className="student-stat__label">Learning Streak</span>
                  <strong className="student-stat__value">{streakDays} days</strong>
                  <small>View daily activity</small>
                </Link>
              </div>
            </section>

            {/* Recent Learning Activity (Replaces empty Updates) */}
            <section className="student-portfolio-card" aria-label="Recent Learning Activity">
              <header className="student-portfolio-card__header">
                <div className="student-portfolio-card__header-left">
                  <ProfileIcon name="spark" size={20} />
                  <div>
                    <h3>Recent Learning Activity</h3>
                    <p>Recent courses and certificates recorded on the aiHustle platform.</p>
                  </div>
                </div>
              </header>

              {enrollments.length === 0 ? (
                <div className="student-empty">
                  <span className="student-empty__icon"><ProfileIcon name="spark" size={22} /></span>
                  <h3>No learning activity yet</h3>
                  <p>Start learning any course from your dashboard to see your activity stream here.</p>
                </div>
              ) : (
                <div className="student-activity-list">
                  {enrollments.slice(0, 5).map((enr) => {
                    const course = enr.courseId
                    const isDone = enr.status === 'completed'
                    return (
                      <div className="student-activity-item" key={enr._id}>
                        <div className="student-activity-item__icon">
                          <ProfileIcon name={isDone ? 'award' : 'book'} size={18} />
                        </div>
                        <div className="student-activity-item__details">
                          <strong>{course?.title || 'Course'}</strong>
                          <small>
                            Status: {isDone ? 'Completed' : 'In Progress'} • Updated:{' '}
                            {new Date(enr.updatedAt || enr.createdAt).toLocaleDateString()}
                          </small>
                        </div>
                        <Link
                          to={`/student/course/${course?._id || enr.courseId}/learn`}
                          className="student-portfolio-btn student-portfolio-btn--secondary"
                          style={{ fontSize: '11px', padding: '4px 10px' }}
                        >
                          {isDone ? 'Review' : 'Continue'}
                        </Link>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* MODALS */}
      {/* 1. Edit Basic Profile Modal */}
      {activeModal === 'editBasic' && (
        <EditBasicModal
          initialValues={{
            fullName,
            headline,
            bio,
            location,
            phone,
          }}
          onClose={() => setActiveModal(null)}
          onSave={(values) => saveProfilePatch(values)}
        />
      )}

      {/* 2. Skill Modal */}
      {activeModal === 'skill' && (
        <SkillModal
          initialValues={editingItem}
          onClose={() => {
            setActiveModal(null)
            setEditingItem(null)
          }}
          onSave={handleSaveSkill}
        />
      )}

      {/* 3. Project Modal */}
      {activeModal === 'project' && (
        <ProjectModal
          initialValues={editingItem}
          onClose={() => {
            setActiveModal(null)
            setEditingItem(null)
          }}
          onSave={handleSaveProject}
        />
      )}

      {/* 4. Experience Modal */}
      {activeModal === 'experience' && (
        <ExperienceModal
          initialValues={editingItem}
          onClose={() => {
            setActiveModal(null)
            setEditingItem(null)
          }}
          onSave={handleSaveExperience}
        />
      )}

      {/* 5. Education Modal */}
      {activeModal === 'education' && (
        <EducationModal
          initialValues={editingItem}
          onClose={() => {
            setActiveModal(null)
            setEditingItem(null)
          }}
          onSave={handleSaveEducation}
        />
      )}

      {/* 6. External Cert Modal */}
      {activeModal === 'externalCert' && (
        <ExternalCertModal
          initialValues={editingItem}
          onClose={() => {
            setActiveModal(null)
            setEditingItem(null)
          }}
          onSave={handleSaveExternalCert}
        />
      )}

      {/* 7. Career & Social Modal */}
      {activeModal === 'careerSocial' && (
        <CareerSocialModal
          initialValues={{
            careerInterests: profileData?.careerInterests || {},
            socialLinks: profileData?.socialLinks || {},
          }}
          onClose={() => setActiveModal(null)}
          onSave={(values) => saveProfilePatch(values)}
        />
      )}
    </div>
  )
}

// Modal Components
function EditBasicModal({ initialValues, onClose, onSave }) {
  const [fullName, setFullName] = useState(initialValues.fullName || '')
  const [headline, setHeadline] = useState(initialValues.headline || '')
  const [bio, setBio] = useState(initialValues.bio || '')
  const [location, setLocation] = useState(initialValues.location || '')
  const [phone, setPhone] = useState(initialValues.phone || '')

  function handleSubmit(e) {
    e.preventDefault()
    onSave({ fullName, headline, bio, location, phone })
  }

  return (
    <div className="student-modal-overlay" onClick={onClose}>
      <div className="student-modal" onClick={(e) => e.stopPropagation()}>
        <div className="student-modal__header">
          <h3>Edit Personal & Professional Details</h3>
          <button type="button" className="student-modal__close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="student-modal__body">
            <div className="student-form-group">
              <label>Full Name *</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={120}
              />
            </div>
            <div className="student-form-group">
              <label>Professional Headline (e.g. Aspiring Full Stack Developer)</label>
              <input
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                maxLength={160}
                placeholder="Aspiring Software Engineer | React, Node.js"
              />
            </div>
            <div className="student-form-row">
              <div className="student-form-group">
                <label>Location (City, Country)</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. San Francisco, CA"
                />
              </div>
              <div className="student-form-group">
                <label>Phone Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={40}
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </div>
            <div className="student-form-group">
              <label>Professional Bio</label>
              <textarea
                rows={4}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={2000}
                placeholder="Brief summary of your background, learning focus, and goals..."
              />
            </div>
          </div>
          <div className="student-modal__footer">
            <button type="button" className="student-portfolio-btn student-portfolio-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="student-portfolio-btn student-portfolio-btn--primary">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SkillModal({ initialValues, onClose, onSave }) {
  const [name, setName] = useState(initialValues?.name || '')
  const [category, setCategory] = useState(initialValues?.category || 'Programming Languages')
  const [proficiency, setProficiency] = useState(initialValues?.proficiency || 'Intermediate')

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSave({
      ...(initialValues?._id ? { _id: initialValues._id } : {}),
      name: name.trim(),
      category,
      proficiency,
    })
  }

  return (
    <div className="student-modal-overlay" onClick={onClose}>
      <div className="student-modal" onClick={(e) => e.stopPropagation()}>
        <div className="student-modal__header">
          <h3>{initialValues ? 'Edit Technical Skill' : 'Add Technical Skill'}</h3>
          <button type="button" className="student-modal__close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="student-modal__body">
            <div className="student-form-group">
              <label>Skill Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
                placeholder="e.g. JavaScript, Docker, React, MongoDB"
                autoFocus
              />
            </div>
            <div className="student-form-group">
              <label>Category *</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {SKILL_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="student-form-group">
              <label>Proficiency Level *</label>
              <select value={proficiency} onChange={(e) => setProficiency(e.target.value)}>
                {PROFICIENCY_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>{lvl}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="student-modal__footer">
            <button type="button" className="student-portfolio-btn student-portfolio-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="student-portfolio-btn student-portfolio-btn--primary">
              Save Skill
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProjectModal({ initialValues, onClose, onSave }) {
  const [title, setTitle] = useState(initialValues?.title || '')
  const [role, setRole] = useState(initialValues?.role || '')
  const [completionDate, setCompletionDate] = useState(initialValues?.completionDate || '')
  const [technologies, setTechnologies] = useState(
    Array.isArray(initialValues?.technologies) ? initialValues.technologies.join(', ') : ''
  )
  const [githubUrl, setGithubUrl] = useState(initialValues?.githubUrl || '')
  const [liveUrl, setLiveUrl] = useState(initialValues?.liveUrl || '')
  const [description, setDescription] = useState(initialValues?.description || '')

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    onSave({
      ...(initialValues?._id ? { _id: initialValues._id } : {}),
      title: title.trim(),
      role: role.trim(),
      completionDate: completionDate.trim(),
      technologies: technologies.split(',').map((t) => t.trim()).filter(Boolean),
      githubUrl: githubUrl.trim(),
      liveUrl: liveUrl.trim(),
      description: description.trim(),
    })
  }

  return (
    <div className="student-modal-overlay" onClick={onClose}>
      <div className="student-modal" onClick={(e) => e.stopPropagation()}>
        <div className="student-modal__header">
          <h3>{initialValues ? 'Edit Project' : 'Add Project to Portfolio'}</h3>
          <button type="button" className="student-modal__close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="student-modal__body">
            <div className="student-form-group">
              <label>Project Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={120}
                placeholder="e.g. E-Commerce Microservices Platform"
                autoFocus
              />
            </div>
            <div className="student-form-row">
              <div className="student-form-group">
                <label>Your Role</label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Full Stack Developer"
                />
              </div>
              <div className="student-form-group">
                <label>Completion Date</label>
                <input
                  type="text"
                  value={completionDate}
                  onChange={(e) => setCompletionDate(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. Oct 2026"
                />
              </div>
            </div>
            <div className="student-form-group">
              <label>Technologies Used (comma-separated)</label>
              <input
                type="text"
                value={technologies}
                onChange={(e) => setTechnologies(e.target.value)}
                placeholder="e.g. React, Node.js, Express, MongoDB, Tailwind"
              />
            </div>
            <div className="student-form-row">
              <div className="student-form-group">
                <label>GitHub Repository URL</label>
                <input
                  type="url"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="https://github.com/username/project"
                />
              </div>
              <div className="student-form-group">
                <label>Live Demo URL</label>
                <input
                  type="url"
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                  placeholder="https://myproject.vercel.app"
                />
              </div>
            </div>
            <div className="student-form-group">
              <label>Description & Contributions</label>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                placeholder="Explain the problem solved, architectural choices, and key outcomes..."
              />
            </div>
          </div>
          <div className="student-modal__footer">
            <button type="button" className="student-portfolio-btn student-portfolio-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="student-portfolio-btn student-portfolio-btn--primary">
              Save Project
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ExperienceModal({ initialValues, onClose, onSave }) {
  const [organization, setOrganization] = useState(initialValues?.organization || '')
  const [position, setPosition] = useState(initialValues?.position || '')
  const [employmentType, setEmploymentType] = useState(initialValues?.employmentType || 'Internship')
  const [startDate, setStartDate] = useState(initialValues?.startDate || '')
  const [endDate, setEndDate] = useState(initialValues?.endDate || '')
  const [isCurrent, setIsCurrent] = useState(Boolean(initialValues?.isCurrent))
  const [description, setDescription] = useState(initialValues?.description || '')

  function handleSubmit(e) {
    e.preventDefault()
    if (!organization.trim() || !position.trim()) return
    onSave({
      ...(initialValues?._id ? { _id: initialValues._id } : {}),
      organization: organization.trim(),
      position: position.trim(),
      employmentType,
      startDate: startDate.trim(),
      endDate: isCurrent ? '' : endDate.trim(),
      isCurrent,
      description: description.trim(),
    })
  }

  return (
    <div className="student-modal-overlay" onClick={onClose}>
      <div className="student-modal" onClick={(e) => e.stopPropagation()}>
        <div className="student-modal__header">
          <h3>{initialValues ? 'Edit Experience' : 'Add Professional Experience'}</h3>
          <button type="button" className="student-modal__close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="student-modal__body">
            <div className="student-form-group">
              <label>Organization / Company *</label>
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                required
                maxLength={140}
                placeholder="e.g. Google, Innovate Labs, Freelance"
                autoFocus
              />
            </div>
            <div className="student-form-row">
              <div className="student-form-group">
                <label>Position / Role *</label>
                <input
                  type="text"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  required
                  maxLength={120}
                  placeholder="e.g. Software Engineering Intern"
                />
              </div>
              <div className="student-form-group">
                <label>Employment Type *</label>
                <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
                  {EMPLOYMENT_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="student-form-row">
              <div className="student-form-group">
                <label>Start Date *</label>
                <input
                  type="text"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  placeholder="e.g. June 2025"
                />
              </div>
              <div className="student-form-group">
                <label>End Date</label>
                <input
                  type="text"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={isCurrent}
                  placeholder={isCurrent ? 'Present' : 'e.g. August 2025'}
                />
              </div>
            </div>
            <label className="student-checkbox-label">
              <input
                type="checkbox"
                checked={isCurrent}
                onChange={(e) => setIsCurrent(e.target.checked)}
              />
              <span>I currently work here</span>
            </label>
            <div className="student-form-group">
              <label>Responsibilities & Contributions</label>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                placeholder="Describe your role, key projects delivered, and technologies used..."
              />
            </div>
          </div>
          <div className="student-modal__footer">
            <button type="button" className="student-portfolio-btn student-portfolio-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="student-portfolio-btn student-portfolio-btn--primary">
              Save Experience
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EducationModal({ initialValues, onClose, onSave }) {
  const [institution, setInstitution] = useState(initialValues?.institution || '')
  const [degree, setDegree] = useState(initialValues?.degree || 'Bachelor of Technology')
  const [fieldOfStudy, setFieldOfStudy] = useState(initialValues?.fieldOfStudy || '')
  const [startYear, setStartYear] = useState(initialValues?.startYear || '')
  const [endYear, setEndYear] = useState(initialValues?.endYear || '')
  const [isCurrent, setIsCurrent] = useState(Boolean(initialValues?.isCurrent))
  const [academicDetails, setAcademicDetails] = useState(initialValues?.academicDetails || '')

  function handleSubmit(e) {
    e.preventDefault()
    if (!institution.trim() || !degree.trim()) return
    onSave({
      ...(initialValues?._id ? { _id: initialValues._id } : {}),
      institution: institution.trim(),
      degree: degree.trim(),
      fieldOfStudy: fieldOfStudy.trim(),
      startYear: startYear.trim(),
      endYear: isCurrent ? '' : endYear.trim(),
      isCurrent,
      academicDetails: academicDetails.trim(),
    })
  }

  return (
    <div className="student-modal-overlay" onClick={onClose}>
      <div className="student-modal" onClick={(e) => e.stopPropagation()}>
        <div className="student-modal__header">
          <h3>{initialValues ? 'Edit Education' : 'Add Education Entry'}</h3>
          <button type="button" className="student-modal__close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="student-modal__body">
            <div className="student-form-group">
              <label>Institution / College *</label>
              <input
                type="text"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                required
                maxLength={160}
                placeholder="e.g. Stanford University, ABC College of Engineering"
                autoFocus
              />
            </div>
            <div className="student-form-row">
              <div className="student-form-group">
                <label>Degree / Qualification *</label>
                <input
                  type="text"
                  value={degree}
                  onChange={(e) => setDegree(e.target.value)}
                  required
                  maxLength={120}
                  placeholder="e.g. B.Tech, B.S., M.S., Diploma"
                />
              </div>
              <div className="student-form-group">
                <label>Department / Field of Study</label>
                <input
                  type="text"
                  value={fieldOfStudy}
                  onChange={(e) => setFieldOfStudy(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Computer Science & Engineering"
                />
              </div>
            </div>
            <div className="student-form-row">
              <div className="student-form-group">
                <label>Start Year</label>
                <input
                  type="text"
                  value={startYear}
                  onChange={(e) => setStartYear(e.target.value)}
                  placeholder="e.g. 2022"
                />
              </div>
              <div className="student-form-group">
                <label>Graduation Year</label>
                <input
                  type="text"
                  value={endYear}
                  onChange={(e) => setEndYear(e.target.value)}
                  disabled={isCurrent}
                  placeholder={isCurrent ? 'Present' : 'e.g. 2026'}
                />
              </div>
            </div>
            <label className="student-checkbox-label">
              <input
                type="checkbox"
                checked={isCurrent}
                onChange={(e) => setIsCurrent(e.target.checked)}
              />
              <span>Currently Studying (Expected graduation)</span>
            </label>
            <div className="student-form-group">
              <label>Academic Standing / Details (Optional)</label>
              <input
                type="text"
                value={academicDetails}
                onChange={(e) => setAcademicDetails(e.target.value)}
                maxLength={200}
                placeholder="e.g. CGPA: 8.8 / 10 · Dean's Honor Roll"
              />
            </div>
          </div>
          <div className="student-modal__footer">
            <button type="button" className="student-portfolio-btn student-portfolio-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="student-portfolio-btn student-portfolio-btn--primary">
              Save Education
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ExternalCertModal({ initialValues, onClose, onSave }) {
  const [name, setName] = useState(initialValues?.name || '')
  const [issuingOrganization, setIssuingOrganization] = useState(initialValues?.issuingOrganization || '')
  const [issueDate, setIssueDate] = useState(initialValues?.issueDate || '')
  const [credentialUrl, setCredentialUrl] = useState(initialValues?.credentialUrl || '')

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !issuingOrganization.trim()) return
    onSave({
      ...(initialValues?._id ? { _id: initialValues._id } : {}),
      name: name.trim(),
      issuingOrganization: issuingOrganization.trim(),
      issueDate: issueDate.trim(),
      credentialUrl: credentialUrl.trim(),
    })
  }

  return (
    <div className="student-modal-overlay" onClick={onClose}>
      <div className="student-modal" onClick={(e) => e.stopPropagation()}>
        <div className="student-modal__header">
          <h3>{initialValues ? 'Edit External Certification' : 'Add External Certification'}</h3>
          <button type="button" className="student-modal__close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="student-modal__body">
            <div className="student-form-group">
              <label>Certificate Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={160}
                placeholder="e.g. AWS Certified Solutions Architect"
                autoFocus
              />
            </div>
            <div className="student-form-group">
              <label>Issuing Organization *</label>
              <input
                type="text"
                value={issuingOrganization}
                onChange={(e) => setIssuingOrganization(e.target.value)}
                required
                maxLength={140}
                placeholder="e.g. Amazon Web Services, Google, Coursera, Meta"
              />
            </div>
            <div className="student-form-row">
              <div className="student-form-group">
                <label>Issue Date</label>
                <input
                  type="text"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  placeholder="e.g. August 2025"
                />
              </div>
              <div className="student-form-group">
                <label>Credential Verification URL</label>
                <input
                  type="url"
                  value={credentialUrl}
                  onChange={(e) => setCredentialUrl(e.target.value)}
                  placeholder="https://www.credly.com/badges/..."
                />
              </div>
            </div>
          </div>
          <div className="student-modal__footer">
            <button type="button" className="student-portfolio-btn student-portfolio-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="student-portfolio-btn student-portfolio-btn--primary">
              Save Credential
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CareerSocialModal({ initialValues, onClose, onSave }) {
  const [desiredRole, setDesiredRole] = useState(initialValues?.careerInterests?.desiredRole || '')
  const [preferredIndustry, setPreferredIndustry] = useState(initialValues?.careerInterests?.preferredIndustry || '')
  const [interestedTechnologies, setInterestedTechnologies] = useState(
    Array.isArray(initialValues?.careerInterests?.interestedTechnologies)
      ? initialValues.careerInterests.interestedTechnologies.join(', ')
      : ''
  )
  const [careerGoals, setCareerGoals] = useState(initialValues?.careerInterests?.careerGoals || '')

  const [linkedin, setLinkedin] = useState(initialValues?.socialLinks?.linkedin || '')
  const [github, setGithub] = useState(initialValues?.socialLinks?.github || '')
  const [portfolio, setPortfolio] = useState(initialValues?.socialLinks?.portfolio || '')
  const [other, setOther] = useState(initialValues?.socialLinks?.other || '')

  function handleSubmit(e) {
    e.preventDefault()
    onSave({
      careerInterests: {
        desiredRole: desiredRole.trim(),
        preferredIndustry: preferredIndustry.trim(),
        interestedTechnologies: interestedTechnologies.split(',').map((t) => t.trim()).filter(Boolean),
        careerGoals: careerGoals.trim(),
      },
      socialLinks: {
        linkedin: linkedin.trim(),
        github: github.trim(),
        portfolio: portfolio.trim(),
        other: other.trim(),
      },
    })
  }

  return (
    <div className="student-modal-overlay" onClick={onClose}>
      <div className="student-modal" onClick={(e) => e.stopPropagation()}>
        <div className="student-modal__header">
          <h3>Edit Career Goals & Social Links</h3>
          <button type="button" className="student-modal__close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="student-modal__body">
            <h4 style={{ margin: '0 0 6px 0', fontSize: '13px', color: 'var(--student-ink)' }}>Career Goals & Interests</h4>
            <div className="student-form-row">
              <div className="student-form-group">
                <label>Desired Job Role</label>
                <input
                  type="text"
                  value={desiredRole}
                  onChange={(e) => setDesiredRole(e.target.value)}
                  placeholder="e.g. Full Stack Developer, DevOps Engineer"
                />
              </div>
              <div className="student-form-group">
                <label>Preferred Industry</label>
                <input
                  type="text"
                  value={preferredIndustry}
                  onChange={(e) => setPreferredIndustry(e.target.value)}
                  placeholder="e.g. FinTech, AI/ML, EdTech"
                />
              </div>
            </div>
            <div className="student-form-group">
              <label>Target Technologies (comma-separated)</label>
              <input
                type="text"
                value={interestedTechnologies}
                onChange={(e) => setInterestedTechnologies(e.target.value)}
                placeholder="e.g. Next.js, Kubernetes, Rust, GraphQL"
              />
            </div>
            <div className="student-form-group">
              <label>Career Goals & Vision</label>
              <textarea
                rows={3}
                value={careerGoals}
                onChange={(e) => setCareerGoals(e.target.value)}
                placeholder="Summarize your near-term and long-term professional aspirations..."
              />
            </div>

            <h4 style={{ margin: '12px 0 6px 0', fontSize: '13px', color: 'var(--student-ink)' }}>Professional Links</h4>
            <div className="student-form-group">
              <label>LinkedIn Profile URL</label>
              <input
                type="url"
                value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)}
                placeholder="https://linkedin.com/in/username"
              />
            </div>
            <div className="student-form-group">
              <label>GitHub Profile URL</label>
              <input
                type="url"
                value={github}
                onChange={(e) => setGithub(e.target.value)}
                placeholder="https://github.com/username"
              />
            </div>
            <div className="student-form-row">
              <div className="student-form-group">
                <label>Personal Portfolio URL</label>
                <input
                  type="url"
                  value={portfolio}
                  onChange={(e) => setPortfolio(e.target.value)}
                  placeholder="https://myportfolio.dev"
                />
              </div>
              <div className="student-form-group">
                <label>Other Professional Link</label>
                <input
                  type="url"
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  placeholder="e.g. LeetCode, Medium, Substack"
                />
              </div>
            </div>
          </div>
          <div className="student-modal__footer">
            <button type="button" className="student-portfolio-btn student-portfolio-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="student-portfolio-btn student-portfolio-btn--primary">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

