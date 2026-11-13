import React, { useEffect, useState } from 'react'
import { isInvalidSessionResponse } from './auth-session.js'
import './AdminCertificateTemplateSettings.css'

function resolveApiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL
    || import.meta.env.VITE_API_URL
    || 'http://localhost:5000/api'
  const url = new URL(configuredUrl, window.location.origin)
  const pathname = url.pathname.replace(/\/+$/, '')
  const apiPath = pathname.toLowerCase().endsWith('/api') ? pathname : `${pathname}/api`
  return `${url.origin}${apiPath}`
}

const API_BASE_URL = resolveApiBaseUrl()
const allowedTypes = ['image/png', 'image/jpeg']
const maxFileSize = 4 * 1024 * 1024

async function certificateTemplateRequest(path, onLogout, { method = 'GET', formData, responseType = 'json' } = {}) {
  let auth
  try {
    auth = JSON.parse(sessionStorage.getItem('lms.auth') || 'null')
  } catch {
    onLogout()
    throw new Error('Your saved administrator session is invalid. Please sign in again.')
  }
  if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
    onLogout()
    throw new Error('Your administrator session has ended.')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
    ...(formData ? { body: formData } : {}),
  })
  if (!response.ok) {
    const responseBody = await response.json().catch(() => ({}))
    if (isInvalidSessionResponse(response, responseBody)) onLogout()
    throw new Error(responseBody.message || 'The certificate template request could not be completed.')
  }
  return responseType === 'blob' ? response.blob() : response.json()
}

export default function AdminCertificateTemplateSettings({ onLogout }) {
  const [template, setTemplate] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [savedPreviewUrl, setSavedPreviewUrl] = useState('')
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    let active = true
    async function loadTemplate() {
      setIsLoading(true)
      setError('')
      try {
        const result = await certificateTemplateRequest('/admin/certificate-template', onLogout)
        if (!active) return
        setTemplate(result)
        if (result.uploaded) {
          if (!result.secureUrl) throw new Error('The active certificate template does not have a saved Cloudinary image URL.')
          if (active) setSavedPreviewUrl(result.secureUrl)
        } else {
          if (active) setSavedPreviewUrl('')
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'The certificate template could not be loaded.')
      } finally {
        if (active) setIsLoading(false)
      }
    }
    loadTemplate()
    return () => {
      active = false
    }
  }, [onLogout])

  useEffect(() => {
    if (!selectedFile || !allowedTypes.includes(selectedFile.type) || selectedFile.size > maxFileSize) {
      setSelectedPreviewUrl('')
      return undefined
    }
    const objectUrl = URL.createObjectURL(selectedFile)
    setSelectedPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [selectedFile])

  async function uploadTemplate(event) {
    event.preventDefault()
    const form = event.currentTarget
    if (!selectedFile) {
      setError('Choose a PNG or JPEG background image to upload.')
      return
    }
    if (!allowedTypes.includes(selectedFile.type) || selectedFile.size > maxFileSize) {
      setError('Choose a PNG or JPEG image that is 4 MB or smaller.')
      return
    }

    const formData = new FormData()
    formData.append('template', selectedFile)
    setIsSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await certificateTemplateRequest('/admin/certificate-template', onLogout, {
        method: 'POST',
        formData,
      })
      setTemplate(result)
      setSelectedFile(null)
      form.reset()
      setPreviewError('')
      setSavedPreviewUrl(result.secureUrl || '')
      if (!result.secureUrl) throw new Error('Cloudinary saved the template without returning a preview URL.')
      setNotice('The certificate background was saved. Newly issued certificates will use it.')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The certificate template could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  function handlePreviewError() {
    setNotice('')
    setPreviewError('The certificate background image could not be loaded. Check the image URL or replace the template.')
    setError('The certificate background image could not be loaded.')
    if (selectedPreviewUrl) setSelectedPreviewUrl('')
    else setSavedPreviewUrl('')
  }

  const previewUrl = selectedPreviewUrl || savedPreviewUrl
  const previewLabel = selectedPreviewUrl ? 'Selected background preview' : 'Active certificate background preview'

  return (
    <div className="certificate-template-settings">
      {error && <p className="settings-message is-error" role="alert">{error}</p>}
      {notice && <p className="settings-message is-success" role="status">{notice}</p>}
      <div className="certificate-template-settings__layout">
        <div className="certificate-template-settings__preview">
          <div className="certificate-template-settings__preview-frame">
            {previewUrl
              ? <img src={previewUrl} alt={previewLabel} onError={handlePreviewError} />
              : previewError || template?.uploaded
                ? <div className="certificate-template-settings__fallback" role="status">
                  <strong>Preview unavailable</strong>
                  <small>{previewError || 'The active background image could not be loaded.'}</small>
                </div>
              : <div className="certificate-template-settings__fallback">
                <strong>aiHustle</strong>
                <span>Certificate of Completion</span>
                <small>Built-in white and teal design</small>
              </div>}
          </div>
          <p role="status">
            {isLoading
              ? 'Loading the active template…'
              : selectedPreviewUrl
                ? `Previewing ${selectedFile?.name || 'selected image'}`
                : template?.uploaded
                  ? `Active template: ${template.fileName || 'uploaded background'}`
                  : 'No uploaded background. The built-in certificate design is active.'}
          </p>
        </div>
        <form className="certificate-template-settings__form" onSubmit={uploadTemplate}>
          <label htmlFor="certificate-template-upload">Certificate background</label>
          <input
            id="certificate-template-upload"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => {
              setSelectedFile(event.target.files?.[0] || null)
              setError('')
              setNotice('')
              setPreviewError('')
            }}
          />
          <small>Upload one PNG or JPG image, up to 4 MB. Preview it before saving; you can replace the active template later.</small>
          <button className="student-button" type="submit" disabled={isLoading || isSaving || !selectedFile}>
            {isSaving ? 'Saving…' : template?.uploaded ? 'Replace Certificate Template' : 'Save Certificate Template'}
          </button>
          <p className="certificate-template-settings__note">
            The active template is stored securely and used for new certificates. Replacing it preserves the design attached to previously issued certificates.
          </p>
        </form>
      </div>
    </div>
  )
}
