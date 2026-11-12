import React, { useEffect, useMemo, useRef, useState } from 'react'
import { isInvalidSessionResponse } from './auth-session.js'
import { API_BASE_URL } from './api-base-url.js'
import './AdminCourseManagement.css'

const defaultCourseCategories = [
  'Python',
  'Prompt Engineering',
  'Digital Marketing',
  'Full Stack Development',
  'UI/UX Design',
]
const courseCategoriesStorageKey = 'lms.main-admin.course-categories'

function readCourseCategories() {
  try {
    const savedCategories = localStorage.getItem(courseCategoriesStorageKey)
    if (savedCategories === null) return [...defaultCourseCategories]
    const parsedCategories = JSON.parse(savedCategories)
    if (!Array.isArray(parsedCategories)) return [...defaultCourseCategories]
    return [...new Set(parsedCategories.filter((category) => typeof category === 'string').map((category) => category.trim()).filter(Boolean))]
  } catch {
    return [...defaultCourseCategories]
  }
}
const difficultyLabels = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  'all-levels': 'All levels',
}
const stepLabels = ['Course Details', 'Course Content', 'Settings', 'Review & Publish']

function localKey() {
  return globalThis.crypto?.randomUUID?.() || `course-item-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function newMongoId() {
  const bytes = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint8Array(12))
    : Array.from({ length: 12 }, () => Math.floor(Math.random() * 256))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function emptyCourse() {
  return {
    title: '',
    description: '',
    detailedDescription: '',
    category: defaultCourseCategories[0],
    difficulty: 'beginner',
    thumbnailUrl: '',
    thumbnailPublicId: '',
    learningObjectives: [],
    prerequisites: [],
    estimatedDurationMinutes: 0,
    status: 'draft',
    modules: [],
  }
}

function newModule(index) {
  return { _id: newMongoId(), _localId: localKey(), title: `Module ${index + 1}`, description: '', lessons: [], quiz: null, contentItems: [] }
}

function emptyContentItem(type) {
  if (type === 'quiz') {
    return {
      type,
      title: 'New quiz',
      quiz: {
        title: 'New quiz',
        passingPercentage: 70,
        maxAttempts: 3,
        timeLimitMinutes: 0,
        questions: [],
      },
    }
  }
  return {
    type,
    title: type === 'video-lesson' ? 'New lesson' : type === 'assignment' ? 'New assignment' : 'New note',
    description: '',
    content: '',
    videoUrl: '',
    videoPublicId: '',
    videoFormat: '',
    videoBytes: 0,
    durationSeconds: 0,
    resources: [],
    dueDate: '',
    points: 0,
  }
}

function emptyLesson() {
  return { title: '', content: '', videoUrl: '', videoPublicId: '', durationSeconds: 0, resources: [] }
}

function emptyQuestion() {
  return { _localId: localKey(), prompt: '', type: 'multiple-choice', options: ['', ''], correctOptionIndices: [0], marks: 1 }
}

function courseFromServer(course) {
  return {
    ...emptyCourse(),
    ...course,
    learningObjectives: course.learningObjectives || [],
    prerequisites: course.prerequisites || [],
    modules: (course.modules || []).map((module) => {
      const legacyItems = [
        ...(module.lessons || []).map((lesson) => ({ ...lesson, type: 'video-lesson' })),
        ...(module.quiz ? [{ type: 'quiz', title: module.quiz.title, quiz: module.quiz }] : []),
      ]
      return {
        ...module,
        _localId: module._id || localKey(),
        lessons: (module.lessons || []).map((lesson) => ({
          ...lesson,
          _localId: lesson._id || localKey(),
          resources: (lesson.resources || []).map((resource) => ({ ...resource, _localId: resource._id || localKey() })),
        })),
        quiz: module.quiz ? {
          ...module.quiz,
          questions: (module.quiz.questions || []).map((question) => ({
            ...question,
            _localId: question._id || localKey(),
            correctOptionIndices: question.correctOptionIndices || [],
          })),
        } : null,
        contentItems: (module.contentItems?.length ? module.contentItems : legacyItems).map((item) => ({
          ...item,
          _localId: item._id || localKey(),
          resources: (item.resources || []).map((resource) => ({ ...resource, _localId: resource._id || localKey() })),
          quiz: item.quiz ? {
            ...item.quiz,
            questions: (item.quiz.questions || []).map((question) => ({
              ...question,
              _localId: question._id || localKey(),
              correctOptionIndices: question.correctOptionIndices || [],
            })),
          } : undefined,
        })),
      }
    }),
  }
}

function serializeCourse(course, status = course.status) {
  return {
    title: course.title,
    description: course.description,
    detailedDescription: course.detailedDescription,
    category: course.category,
    difficulty: course.difficulty,
    thumbnailUrl: course.thumbnailUrl,
    thumbnailPublicId: course.thumbnailPublicId,
    learningObjectives: course.learningObjectives,
    prerequisites: course.prerequisites,
    estimatedDurationMinutes: Number(course.estimatedDurationMinutes) || 0,
    status,
    modules: course.modules.map((module) => ({
      ...(module._id ? { _id: module._id } : {}),
      title: module.title,
      description: module.description,
      lessons: module.contentItems.filter((item) => item.type === 'video-lesson').map((lesson) => ({
        ...(lesson._id ? { _id: lesson._id } : {}),
        title: lesson.title,
        content: lesson.content,
        videoUrl: lesson.videoUrl,
        videoPublicId: lesson.videoPublicId,
        videoFormat: lesson.videoFormat,
        videoBytes: Number(lesson.videoBytes) || 0,
        durationSeconds: Number(lesson.durationSeconds) || 0,
        resources: lesson.resources.map((resource) => ({
          ...(resource._id ? { _id: resource._id } : {}),
          title: resource.title,
          url: resource.url,
          publicId: resource.publicId,
          resourceType: resource.resourceType,
          format: resource.format,
          bytes: Number(resource.bytes) || 0,
        })),
      })),
      ...(module.contentItems.find((item) => item.type === 'quiz')?.quiz ? {
        quiz: serializeModuleQuiz(module.contentItems.find((item) => item.type === 'quiz').quiz),
      } : {}),
      contentItems: module.contentItems.map((item, index) => ({
        ...(item._id ? { _id: item._id } : {}),
        type: item.type,
        title: item.title,
        description: item.description || '',
        content: item.content || '',
        videoUrl: item.videoUrl || '',
        videoPublicId: item.videoPublicId || '',
        videoFormat: item.videoFormat || '',
        videoBytes: Number(item.videoBytes) || 0,
        durationSeconds: Number(item.durationSeconds) || 0,
        resources: (item.resources || []).map((resource) => ({
          ...(resource._id ? { _id: resource._id } : {}),
          title: resource.title,
          url: resource.url,
          publicId: resource.publicId,
          resourceType: resource.resourceType,
          format: resource.format,
          bytes: Number(resource.bytes) || 0,
        })),
        dueDate: item.dueDate || '',
        points: Number(item.points) || 0,
        ...(item.quiz ? { quiz: serializeModuleQuiz(item.quiz) } : {}),
        order: index,
      })),
    })),
  }
}

function serializeModuleQuiz(quiz) {
  return {
    ...(quiz._id ? { _id: quiz._id } : {}),
    title: quiz.title,
    passingPercentage: Number(quiz.passingPercentage) || 70,
    maxAttempts: Number(quiz.maxAttempts) || 3,
    timeLimitMinutes: Number(quiz.timeLimitMinutes) || 0,
    questions: (quiz.questions || []).filter((question) => question.prompt.trim()).map((question) => ({
      ...(question._id ? { _id: question._id } : {}),
      prompt: question.prompt,
      type: question.type || 'multiple-choice',
      options: question.options,
      correctOptionIndices: question.correctOptionIndices || [],
      marks: Number(question.marks) || 1,
    })),
  }
}
async function adminCourseRequest(path, onLogout, { method = 'GET', body } = {}) {
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
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let result
  try {
    result = text ? JSON.parse(text) : {}
  } catch {
    throw new Error('The server returned an invalid response.')
  }
  if (isInvalidSessionResponse(response, result)) onLogout()
  if (!response.ok) throw new Error(result.message || 'The course request could not be completed.')
  return result
}

function adminToken(onLogout) {
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
  return auth.token
}

function uploadWithProgress(path, file, onLogout, onProgress) {
  return new Promise((resolve, reject) => {
    let token
    try {
      token = adminToken(onLogout)
    } catch (error) {
      reject(error)
      return
    }
    const formData = new FormData()
    formData.append('file', file)
    const request = new XMLHttpRequest()
    request.open('POST', `${API_BASE_URL}${path}`)
    request.setRequestHeader('Authorization', `Bearer ${token}`)
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    })
    request.addEventListener('load', () => {
      let result
      try {
        result = request.responseText ? JSON.parse(request.responseText) : {}
      } catch {
        reject(new Error('The server returned an invalid upload response.'))
        return
      }
      if (isInvalidSessionResponse({ status: request.status }, result)) onLogout()
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(result.message || 'The file upload failed.'))
        return
      }
      resolve(result)
    })
    request.addEventListener('error', () => reject(new Error('The upload connection failed. Check your connection and try again.')))
    request.addEventListener('abort', () => reject(new Error('The upload was cancelled.')))
    request.send(formData)
  })
}

function collectCourseAssets(course) {
  const assets = []
  if (course.thumbnailPublicId) assets.push({ publicId: course.thumbnailPublicId, resourceType: 'image' })
  for (const module of course.modules || []) {
    const items = module.contentItems?.length ? module.contentItems : [
      ...(module.lessons || []),
    ]
    for (const item of items) {
      if (item.videoPublicId) assets.push({ publicId: item.videoPublicId, resourceType: 'video' })
      for (const resource of item.resources || []) {
        if (resource.publicId) assets.push({ publicId: resource.publicId, resourceType: resource.resourceType || 'raw' })
      }
    }
  }
  return assets
}

function courseCounts(course) {
  const lessons = (course.modules || []).reduce((total, module) => total + (
    module.contentItems?.length
      ? module.contentItems.filter((item) => item.type === 'video-lesson').length
      : (module.lessons?.length || 0)
  ), 0)
  return { modules: course.modules?.length || 0, lessons }
}

function formatDuration(minutes) {
  const value = Number(minutes) || 0
  if (value < 60) return `${value} min`
  const hours = Math.floor(value / 60)
  const remainder = value % 60
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`
}

function dateTimeLocalValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function CoverImage({ url, title, className = '' }) {
  return url
    ? <img className={className} src={url} alt={`${title || 'Course'} thumbnail`} />
    : <div className={`${className} ac-cover-fallback`} aria-label="No course thumbnail"><span aria-hidden="true">▤</span></div>
}

function CourseStats({ stats }) {
  const metrics = [
    ['Total courses', stats.totalCourses, '▤'],
    ['Published', stats.publishedCourses, '✓'],
    ['Drafts', stats.draftCourses, '◷'],
    ['Enrolled students', stats.totalEnrolledStudents, '♙'],
  ]
  return (
    <div className="ac-stats" aria-label="Course statistics">
      {metrics.map(([label, value, icon]) => (
        <article className="ac-stat" key={label}>
          <span className="ac-stat__icon" aria-hidden="true">{icon}</span>
          <span className="ac-stat__label">{label}</span>
          <strong>{Number(value || 0).toLocaleString()}</strong>
        </article>
      ))}
    </div>
  )
}

function CourseCard({ course, onEdit, onPreview, onToggleStatus, onDelete }) {
  const counts = courseCounts(course)
  return (
    <article className="ac-course-card">
      <CoverImage className="ac-course-card__image" url={course.thumbnailUrl} title={course.title} />
      <div className="ac-course-card__body">
        <div className="ac-course-card__heading">
          <div>
            <p className="ac-course-card__category">{course.category || 'Other'} <span>·</span> {difficultyLabels[course.difficulty] || 'Beginner'}</p>
            <h2>{course.title}</h2>
          </div>
          <span className={`ac-status ac-status--${course.status}`}>{course.status === 'published' ? 'Published' : 'Draft'}</span>
        </div>
        <p className="ac-course-card__description">{course.description || course.detailedDescription || 'No course description added yet.'}</p>
        <div className="ac-course-card__meta">
          <span>{counts.modules} modules</span><span>{counts.lessons} lessons</span><span>{formatDuration(course.estimatedDurationMinutes)}</span>
        </div>
        <div className="ac-course-card__actions">
          <button type="button" className="ac-button ac-button--quiet" onClick={() => onPreview(course)} aria-label={`Preview ${course.title}`}>
            <span aria-hidden="true">◉</span> Preview
          </button>
          {course.status !== 'published' && (
            <>
              <button type="button" className="ac-button ac-button--quiet" onClick={() => onEdit(course)} aria-label={`Edit ${course.title}`}>
                <span aria-hidden="true">✎</span> Edit
              </button>
              <button type="button" className="ac-button ac-button--quiet ac-button--danger" onClick={() => onDelete(course)} aria-label={`Delete ${course.title}`}>
                <span aria-hidden="true">▤</span> Delete
              </button>
            </>
          )}
          <button type="button" className="ac-button ac-button--gold" onClick={() => course.status === 'published' ? onToggleStatus(course) : onPreview(course)}>
            {course.status === 'published' ? 'Move to draft' : 'Review & publish'}
          </button>
        </div>
      </div>
    </article>
  )
}

function StepIndicator({ step, onStep }) {
  return (
    <nav className="ac-steps" aria-label="Course creation steps">
      {stepLabels.map((label, index) => {
        const number = index + 1
        const complete = number < step
        return (
          <React.Fragment key={label}>
            {index > 0 && <span className={`ac-steps__line${complete ? ' is-complete' : ''}`} aria-hidden="true" />}
            <button type="button" className={`ac-step${number === step ? ' is-active' : ''}${complete ? ' is-complete' : ''}`} onClick={() => onStep(number)}>
              <span className="ac-step__number">{complete ? '✓' : number}</span><span>{label}</span>
            </button>
          </React.Fragment>
        )
      })}
    </nav>
  )
}

function LessonPanel({
  draft,
  setDraft,
  onSave,
  onCancel,
  onVideoUpload,
  onResourceUpload,
  isUploadingVideo,
  isUploadingResource,
  uploadProgress,
  error,
}) {
  const videoInput = useRef(null)
  const resourceInput = useRef(null)
  const [isDraggingVideo, setIsDraggingVideo] = useState(false)
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }))
  return (
    <aside className="ac-side-panel">
      <div className="ac-side-panel__heading">
        <div className="ac-side-panel__title"><span className="ac-side-panel__mark" aria-hidden="true">▶</span><h3>{draft._localId ? 'Edit Lesson' : 'Add New Lesson'}</h3></div>
        <button type="button" className="ac-icon-button" onClick={onCancel} aria-label="Close lesson editor">×</button>
      </div>
      <form className="ac-editor-form" onSubmit={onSave}>
        <label className="ac-field"><span>Lesson title <b>*</b></span><input autoFocus value={draft.title} maxLength="200" required onChange={(event) => update('title', event.target.value)} placeholder="Introduction to React" /></label>
        <label className="ac-field"><span>Description</span><textarea rows="3" maxLength="20000" value={draft.content} onChange={(event) => update('content', event.target.value)} placeholder="What will students learn in this lesson?" /></label>
        <fieldset className="ac-editor-fieldset">
          <legend>Video upload <b>*</b></legend>
          <div
            className={`ac-upload-box${isDraggingVideo ? ' is-dragging' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setIsDraggingVideo(true) }}
            onDragLeave={() => setIsDraggingVideo(false)}
            onDrop={(event) => {
              event.preventDefault()
              setIsDraggingVideo(false)
              const file = event.dataTransfer.files?.[0]
              if (file) onVideoUpload(file)
            }}
          >
            {draft.videoPublicId ? <span className="ac-upload-box__file">Cloudinary video uploaded</span> : <><strong>Drag & drop a video file here</strong><small>or click to browse · MP4, MOV, WebM, AVI, MKV, or OGV · Max 2 GB</small></>}
            <button type="button" className="ac-button ac-button--quiet" disabled={isUploadingVideo || isUploadingResource} onClick={() => videoInput.current?.click()}>{isUploadingVideo ? `Uploading ${uploadProgress}%` : draft.videoPublicId ? 'Replace video' : 'Browse files'}</button>
            <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm,video/ogg,video/x-msvideo,video/x-matroska,.m4v,.mkv,.avi,.ogv" hidden onChange={onVideoUpload} />
            {isUploadingVideo && <div className="ac-upload-progress"><progress max="100" value={uploadProgress} /><small>{uploadProgress >= 100 ? 'Finishing upload to Cloudinary…' : `Uploading to server · ${uploadProgress}%`}</small></div>}
          </div>
          {draft.videoPublicId && draft.videoUrl && <div className="ac-video-preview"><video controls preload="metadata" src={draft.videoUrl} /><small>{draft.videoFormat ? `${draft.videoFormat.toUpperCase()} · ` : ''}{draft.durationSeconds ? `${Math.round(draft.durationSeconds / 60)} min` : 'Video ready'}</small></div>}
          <label className="ac-field ac-field--nested ac-duration-field"><span>Video Duration (minutes)</span><span className="ac-duration-input"><span aria-hidden="true">◷</span><input type="number" min="0" max="720" value={draft.durationSeconds ? Math.round((Number(draft.durationSeconds) || 0) / 60) : ''} placeholder="Enter duration" onChange={(event) => update('durationSeconds', Number(event.target.value) * 60)} /></span></label>
        </fieldset>
        <div className="ac-editor-fieldset">
          <div className="ac-resource-heading"><span>Additional Resources</span><small>Optional</small></div>
          <button type="button" className="ac-resource-add" disabled={isUploadingResource || isUploadingVideo} onClick={() => resourceInput.current?.click()}>
            <span aria-hidden="true">↥</span>{isUploadingResource ? `Uploading resource · ${uploadProgress}%` : 'Add PDF or reference file'}
          </button>
          <input ref={resourceInput} type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp" hidden onChange={onResourceUpload} />
          {draft.resources?.length > 0 && <ul className="ac-resource-list">{draft.resources.map((resource, index) => (
            <li key={resource._localId || resource._id || `${resource.title}-${index}`}>
              <a href={resource.url} target="_blank" rel="noreferrer">{resource.title}</a>
              <button type="button" className="ac-icon-button ac-icon-button--small" onClick={() => update('resources', draft.resources.filter((_, position) => position !== index))} aria-label={`Remove ${resource.title}`}>×</button>
            </li>
          ))}</ul>}
        </div>
        {error && <p className="ac-inline-error" role="alert">{error}</p>}
        <div className="ac-panel-actions"><button type="button" className="ac-button ac-button--outline" onClick={onCancel} disabled={isUploadingVideo || isUploadingResource}>Cancel</button><button type="submit" className="ac-button ac-button--gold" disabled={isUploadingVideo || isUploadingResource}>Save lesson</button></div>
      </form>
    </aside>
  )
}

function QuizPanel({ quiz, setQuiz, onSave, onCancel, moduleTitle, error }) {
  const updateQuestion = (questionIndex, field, value) => setQuiz((current) => ({
    ...current,
    questions: current.questions.map((question, index) => index === questionIndex ? { ...question, [field]: value } : question),
  }))
  const updateOption = (questionIndex, optionIndex, value) => setQuiz((current) => ({
    ...current,
    questions: current.questions.map((question, index) => index !== questionIndex ? question : {
      ...question,
      options: question.options.map((option, position) => position === optionIndex ? value : option),
    }),
  }))
  const updateAnswer = (questionIndex, optionIndex, checked, type) => setQuiz((current) => ({
    ...current,
    questions: current.questions.map((question, index) => {
      if (index !== questionIndex) return question
      const selected = question.correctOptionIndices || []
      return {
        ...question,
        correctOptionIndices: type === 'multiple-select'
          ? checked ? [...new Set([...selected, optionIndex])] : selected.filter((item) => item !== optionIndex)
          : [optionIndex],
      }
    }),
  }))
  return (
    <aside className="ac-side-panel ac-quiz-panel">
      <div className="ac-side-panel__heading"><div><p className="ac-eyebrow">{moduleTitle}</p><h3>Module quiz</h3></div><button type="button" className="ac-icon-button" onClick={onCancel} aria-label="Close quiz editor">×</button></div>
      <div className="ac-editor-form">
        <label className="ac-field"><span>Quiz title <b>*</b></span><input value={quiz.title} maxLength="200" onChange={(event) => setQuiz((current) => ({ ...current, title: event.target.value }))} placeholder="Module quiz" /></label>
        <div className="ac-quiz-settings">
          <label className="ac-field"><span>Passing score (%)</span><input type="number" min="1" max="100" value={quiz.passingPercentage} onChange={(event) => setQuiz((current) => ({ ...current, passingPercentage: event.target.value }))} /></label>
          <label className="ac-field"><span>Max attempts</span><input type="number" min="1" max="20" value={quiz.maxAttempts} onChange={(event) => setQuiz((current) => ({ ...current, maxAttempts: event.target.value }))} /></label>
          <label className="ac-field"><span>Time limit (min)</span><input type="number" min="0" max="600" value={quiz.timeLimitMinutes} onChange={(event) => setQuiz((current) => ({ ...current, timeLimitMinutes: event.target.value }))} /></label>
        </div>
        <div className="ac-quiz-question-list">
          {quiz.questions.map((question, questionIndex) => (
            <section className="ac-quiz-question" key={question._localId || question._id || questionIndex}>
              <div className="ac-quiz-question__top"><strong>Question {questionIndex + 1}</strong><button type="button" className="ac-text-button" onClick={() => setQuiz((current) => ({ ...current, questions: current.questions.filter((_, index) => index !== questionIndex) }))}>Remove</button></div>
              <label className="ac-field"><span>Question prompt</span><textarea rows="2" maxLength="2000" value={question.prompt} onChange={(event) => updateQuestion(questionIndex, 'prompt', event.target.value)} placeholder="Enter a question" /></label>
              <label className="ac-field"><span>Question type</span><select value={question.type} onChange={(event) => {
                const type = event.target.value
                if (type === 'true-false') {
                  updateQuestion(questionIndex, 'type', type)
                  updateQuestion(questionIndex, 'options', ['True', 'False'])
                  updateQuestion(questionIndex, 'correctOptionIndices', [0])
                } else updateQuestion(questionIndex, 'type', type)
              }}><option value="multiple-choice">Multiple choice</option><option value="multiple-select">Multiple select</option><option value="true-false">True / False</option></select></label>
              <div className="ac-answer-options"><span>Answer options</span>
                {question.options.map((option, optionIndex) => (
                  <div className="ac-answer-option" key={optionIndex}>
                    <input
                      aria-label={`Mark option ${optionIndex + 1} correct`}
                      type={question.type === 'multiple-select' ? 'checkbox' : 'radio'}
                      name={`correct-${question._localId || questionIndex}`}
                      checked={(question.correctOptionIndices || []).includes(optionIndex)}
                      onChange={(event) => updateAnswer(questionIndex, optionIndex, event.currentTarget.checked, question.type)}
                    />
                    <input value={option} disabled={question.type === 'true-false'} maxLength="500" onChange={(event) => updateOption(questionIndex, optionIndex, event.target.value)} placeholder={`Option ${optionIndex + 1}`} />
                    {question.type !== 'true-false' && question.options.length > 2 && <button type="button" className="ac-icon-button ac-icon-button--small" onClick={() => {
                      const nextOptions = question.options.filter((_, index) => index !== optionIndex)
                      const nextAnswers = question.correctOptionIndices.filter((index) => index !== optionIndex).map((index) => index > optionIndex ? index - 1 : index)
                      updateQuestion(questionIndex, 'options', nextOptions)
                      updateQuestion(questionIndex, 'correctOptionIndices', nextAnswers)
                    }} aria-label="Remove answer option">×</button>}
                  </div>
                ))}
                {question.type !== 'true-false' && question.options.length < 10 && <button type="button" className="ac-text-button" onClick={() => updateQuestion(questionIndex, 'options', [...question.options, ''])}>+ Add answer option</button>}
                <small>Select the correct {question.type === 'multiple-select' ? 'answers' : 'answer'} using the controls.</small>
              </div>
              <label className="ac-field ac-field--marks"><span>Marks</span><input type="number" min="1" max="1000" value={question.marks} onChange={(event) => updateQuestion(questionIndex, 'marks', event.target.value)} /></label>
            </section>
          ))}
        </div>
        <button type="button" className="ac-button ac-button--outline ac-add-question" onClick={() => setQuiz((current) => ({ ...current, questions: [...current.questions, emptyQuestion()] }))}>+ Add question</button>
        {error && <p className="ac-inline-error" role="alert">{error}</p>}
        <div className="ac-panel-actions"><button type="button" className="ac-button ac-button--outline" onClick={onCancel}>Cancel</button><button type="button" className="ac-button ac-button--gold" onClick={onSave}>Save quiz</button></div>
      </div>
    </aside>
  )
}

function PreviewContent({ course, onBack, onEdit, onSave, isSaving, error }) {
  const counts = courseCounts(course)
  return (
    <div className="ac-preview-page">
      <div className="ac-builder-topline"><button type="button" className="ac-back-link" onClick={onBack}>← Back to courses</button><span className={`ac-status ac-status--${course.status}`}>{course.status === 'published' ? 'Published' : 'Draft'}</span></div>
      <div className="ac-preview-hero">
        <CoverImage className="ac-preview-hero__image" url={course.thumbnailUrl} title={course.title} />
        <div className="ac-preview-hero__copy"><p className="ac-eyebrow">{course.category} · {difficultyLabels[course.difficulty]}</p><h1>{course.title || 'Untitled course'}</h1><p>{course.description || course.detailedDescription || 'No description added yet.'}</p><div className="ac-course-card__meta"><span>{counts.modules} modules</span><span>{counts.lessons} lessons</span><span>{formatDuration(course.estimatedDurationMinutes)}</span></div></div>
      </div>
      {course.detailedDescription && <section className="ac-preview-section"><h2>About this course</h2><p>{course.detailedDescription}</p></section>}
      {course.learningObjectives?.length > 0 && <section className="ac-preview-section"><h2>Learning objectives</h2><ul>{course.learningObjectives.map((objective) => <li key={objective}>{objective}</li>)}</ul></section>}
      <section className="ac-preview-section"><h2>Course content</h2>
        {course.modules.length === 0 ? <p className="ac-muted">No modules have been added.</p> : course.modules.map((module, index) => (
          <article className="ac-preview-module" key={module._localId || module._id || index}>
            <div><span className="ac-preview-module__number">{String(index + 1).padStart(2, '0')}</span><div><h3>{module.title}</h3>{module.description && <p>{module.description}</p>}</div></div>
            <ul>{(module.contentItems?.length ? module.contentItems : [
              ...(module.lessons || []).map((lesson) => ({ ...lesson, type: 'video-lesson' })),
              ...(module.quiz ? [{ type: 'quiz', title: module.quiz.title, quiz: module.quiz }] : []),
            ]).map((item, itemIndex) => (
              <li key={item._localId || item._id || itemIndex}>
                <span>{item.title}</span>
                <span>{item.type === 'quiz' ? `Quiz · ${item.quiz?.questions?.length || 0} questions` : item.type === 'assignment' ? 'Assignment' : item.type === 'note' ? 'Notes / PDF' : 'Video lesson'}</span>
                <span>{item.resources?.length || 0} resources</span>
              </li>
            ))}</ul>
          </article>
        ))}
      </section>
      {error && <p className="ac-inline-error" role="alert">{error}</p>}
      <div className="ac-preview-actions"><button type="button" className="ac-button ac-button--outline" onClick={onEdit}>Edit course</button><button type="button" className="ac-button ac-button--outline" onClick={() => onSave('draft')} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save as draft'}</button><button type="button" className="ac-button ac-button--gold" onClick={() => onSave('published')} disabled={isSaving}>{isSaving ? 'Saving…' : 'Publish course'}</button></div>
    </div>
  )
}

export default function AdminCourseManagement({ onLogout }) {
  const [courses, setCourses] = useState([])
  const [stats, setStats] = useState({ totalCourses: 0, publishedCourses: 0, draftCourses: 0, totalEnrolledStudents: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [cloudinaryHealth, setCloudinaryHealth] = useState('checking')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [deleteCandidate, setDeleteCandidate] = useState(null)
  const [view, setView] = useState('list')
  const [step, setStep] = useState(1)
  const [courseCategories, setCourseCategories] = useState(readCourseCategories)
  const [selectedCourseCategory, setSelectedCourseCategory] = useState('')
  const [categoryEditor, setCategoryEditor] = useState(null)
  const [categoryDraft, setCategoryDraft] = useState('')
  const [categoryManagerError, setCategoryManagerError] = useState('')
  const [categoryPendingDelete, setCategoryPendingDelete] = useState('')
  const [course, setCourse] = useState(emptyCourse)
  const [thumbnailPreview, setThumbnailPreview] = useState('')
  const [editingId, setEditingId] = useState('')
  const [previewFromList, setPreviewFromList] = useState(false)
  const [lessonTarget, setLessonTarget] = useState(null)
  const [lessonDraft, setLessonDraft] = useState(emptyLesson)
  const [quizTarget, setQuizTarget] = useState(null)
  const [quizDraft, setQuizDraft] = useState(null)
  const [activeContentEditor, setActiveContentEditor] = useState(null)
  const [contentDraft, setContentDraft] = useState(null)
  const [contentDrag, setContentDrag] = useState(null)
  const [aiQuestionCount, setAiQuestionCount] = useState(5)
  const [aiDifficulty, setAiDifficulty] = useState('intermediate')
  const [aiQuestionTypes, setAiQuestionTypes] = useState(['multiple-choice'])
  const [aiLessonContent, setAiLessonContent] = useState('')
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false)
  const [panelError, setPanelError] = useState('')
  const [reorderEnabled, setReorderEnabled] = useState(false)
  const [draggedModuleIndex, setDraggedModuleIndex] = useState(null)
  const [collapsedModules, setCollapsedModules] = useState({})
  const detailsForm = useRef(null)
  const originalAssets = useRef([])
  const pendingAssets = useRef([])
  const thumbnailPreviewUrl = useRef('')

  async function loadCourses() {
    setError('')
    setIsLoading(true)
    try {
      const result = await adminCourseRequest('/admin/courses', onLogout)
      if (!Array.isArray(result.courses)) {
        throw new Error('The server returned an invalid course catalog response. Please try again.')
      }
      const statValues = [
        result.stats?.totalCourses,
        result.stats?.publishedCourses,
        result.stats?.draftCourses,
        result.stats?.totalEnrolledStudents,
      ]
      if (!statValues.every((value) => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error('The server returned invalid course statistics. Please try again.')
      }
      setCourses(result.courses)
      setStats(result.stats)
      return true
    } catch (loadError) {
      setError(loadError instanceof TypeError
        ? 'Could not connect to the LMS server. Check that the backend is running and try again.'
        : loadError instanceof Error && loadError.message === 'Something went wrong. Please try again.'
          ? 'The server could not load course data (HTTP 500). Try again later.'
          : loadError instanceof Error ? loadError.message : 'Unable to load courses.')
      return false
    } finally {
      setIsLoading(false)
    }
  }

  async function checkCloudinaryHealth() {
    setCloudinaryHealth('checking')
    try {
      const result = await adminCourseRequest('/admin/cloudinary/health', onLogout)
      setCloudinaryHealth(result.connected ? 'connected' : 'unavailable')
    } catch {
      setCloudinaryHealth('unavailable')
    }
  }

  useEffect(() => { loadCourses() }, [])
  useEffect(() => { checkCloudinaryHealth() }, [])
  useEffect(() => () => {
    if (thumbnailPreviewUrl.current) URL.revokeObjectURL(thumbnailPreviewUrl.current)
  }, [])

  const filteredCourses = useMemo(() => courses.filter((item) => {
    const query = search.trim().toLowerCase()
    const matchesText = !query || [item.title, item.description, item.category].some((value) => String(value || '').toLowerCase().includes(query))
    const matchesCategory = categoryFilter === 'all' || (item.category || 'Other') === categoryFilter
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter
    return matchesText && matchesCategory && matchesStatus
  }), [courses, search, categoryFilter, statusFilter])
  const catalogCategories = useMemo(() => [...new Set([
    ...courseCategories,
    ...courses.map((item) => item.category || 'Other'),
  ])].sort((left, right) => left.localeCompare(right)), [courseCategories, courses])

  function persistCourseCategories(nextCategories) {
    setCourseCategories(nextCategories)
    try {
      localStorage.setItem(courseCategoriesStorageKey, JSON.stringify(nextCategories))
    } catch {
      setCategoryManagerError('Course options could not be saved in this browser.')
    }
  }

  function startAddingCourseCategory() {
    setCategoryDraft('')
    setCategoryEditor({ mode: 'add' })
    setCategoryManagerError('')
    setCategoryPendingDelete('')
  }

  function startEditingCourseCategory(category) {
    setCategoryDraft(category)
    setCategoryEditor({ mode: 'edit', original: category })
    setCategoryManagerError('')
    setCategoryPendingDelete('')
  }

  function saveCourseCategory(event) {
    event.preventDefault()
    const normalizedName = categoryDraft.trim()
    if (!normalizedName || normalizedName.length > 80) {
      setCategoryManagerError('Enter a course name between 1 and 80 characters.')
      return
    }
    const duplicate = courseCategories.some((category) => (
      category.toLowerCase() === normalizedName.toLowerCase() && category !== categoryEditor.original
    ))
    if (duplicate) {
      setCategoryManagerError('That course name already exists.')
      return
    }

    const nextCategories = categoryEditor.mode === 'add'
      ? [...courseCategories, normalizedName]
      : courseCategories.map((category) => category === categoryEditor.original ? normalizedName : category)
    persistCourseCategories(nextCategories)
    if (categoryEditor.mode === 'add' || selectedCourseCategory === categoryEditor.original) {
      setSelectedCourseCategory(normalizedName)
    }
    setCategoryEditor(null)
    setCategoryManagerError('')
  }

  function deleteCourseCategory(category) {
    const nextCategories = courseCategories.filter((item) => item !== category)
    persistCourseCategories(nextCategories)
    if (selectedCourseCategory === category) setSelectedCourseCategory('')
    setCategoryPendingDelete('')
    setCategoryEditor(null)
  }

  function beginNewCourse() {
    setCourse(emptyCourse())
    setSelectedCourseCategory('')
    setCategoryEditor(null)
    setCategoryManagerError('')
    setCategoryPendingDelete('')
    setEditingId('')
    originalAssets.current = []
    pendingAssets.current = []
    setStep(1)
    setView('category')
    setPreviewFromList(false)
    setLessonTarget(null)
    setQuizTarget(null)
    setActiveContentEditor(null)
    setContentDraft(null)
    setError('')
    setNotice('')
  }

  function beginEdit(courseToEdit) {
    const editableCourse = courseFromServer(courseToEdit)
    setCourse(editableCourse)
    setEditingId(courseToEdit._id)
    originalAssets.current = collectCourseAssets(editableCourse)
    pendingAssets.current = []
    setStep(1)
    setView('builder')
    setPreviewFromList(false)
    setLessonTarget(null)
    setQuizTarget(null)
    setActiveContentEditor(null)
    setContentDraft(null)
    setError('')
    setNotice('')
  }

  function continueWithCourseCategory() {
    if (!selectedCourseCategory) return
    setCourse((current) => ({ ...current, title: selectedCourseCategory, category: selectedCourseCategory }))
    setStep(1)
    setView('builder')
  }

  function openPreview(courseToPreview) {
    const previewCourse = courseFromServer(courseToPreview)
    setCourse(previewCourse)
    setEditingId(courseToPreview._id)
    originalAssets.current = collectCourseAssets(previewCourse)
    pendingAssets.current = []
    setPreviewFromList(true)
    setView('preview')
    setError('')
    setNotice('')
  }

  function backToList(message = '') {
    const pending = pendingAssets.current
    pendingAssets.current = []
    if (pending.length) void deleteMediaAssets(pending)
    setView('list')
    setLessonTarget(null)
    setQuizTarget(null)
    setActiveContentEditor(null)
    setContentDraft(null)
    setNotice(message)
    setError('')
  }

  function cancelCourseDetails() {
    if (!editingId) {
      setView('category')
      setError('')
      return
    }
    backToList()
  }

  function updateCourse(field, value) {
    setCourse((current) => ({ ...current, [field]: value }))
    setError('')
  }

  async function deleteMediaAssets(assets) {
    return Promise.allSettled(assets.map((asset) => adminCourseRequest('/admin/course-assets/delete', onLogout, {
      method: 'POST',
      body: { publicId: asset.publicId, resourceType: asset.resourceType },
    })))
  }

  function openNewLessonPanel(moduleIndex = 0) {
    setLessonTarget({ moduleIndex, lessonIndex: -1 })
    setLessonDraft(emptyLesson())
    setQuizTarget(null)
    setPanelError('')
  }

  async function continueToContent(event) {
    event.preventDefault()
    if (detailsForm.current && !detailsForm.current.reportValidity()) return
    setIsSaving(true)
    setError('')
    try {
      if (!editingId) {
        const draftPayload = serializeCourse(course, 'draft')
        const result = await adminCourseRequest('/admin/courses', onLogout, {
          method: 'POST',
          body: draftPayload,
        })
        setEditingId(result.course._id)
        setCourse((current) => ({ ...current, _id: result.course._id, status: 'draft' }))
        originalAssets.current = collectCourseAssets(draftPayload)
      }
      setStep(2)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The course draft could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  function enterStep(nextStep) {
    if (nextStep > step && step === 1 && detailsForm.current && !detailsForm.current.reportValidity()) return
    setError('')
    setStep(nextStep)
  }

  async function uploadAsset(file, resourceType) {
    if (!file) return null
    if (resourceType !== 'image' || file.size > 10 * 1024 * 1024) throw new Error('Choose an image up to 10 MB.')
    const signature = await adminCourseRequest('/admin/course-assets/signature', onLogout, { method: 'POST', body: { resourceType } })
    const uploadBody = new FormData()
    uploadBody.append('file', file)
    uploadBody.append('api_key', signature.apiKey)
    uploadBody.append('timestamp', String(signature.timestamp))
    uploadBody.append('folder', signature.folder)
    uploadBody.append('public_id', signature.publicId)
    uploadBody.append('signature', signature.signature)
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(signature.cloudName)}/${resourceType}/upload`, { method: 'POST', body: uploadBody })
    let result
    try { result = await response.json() } catch { throw new Error('The media provider returned an invalid response.') }
    if (!response.ok || !result.secure_url || typeof result.public_id !== 'string') {
      throw new Error(result.error?.message || 'The file could not be uploaded.')
    }
    return { url: result.secure_url, publicId: result.public_id, duration: result.duration }
  }

  async function uploadCourseMedia(file, assetType, module) {
    if (!editingId || !module?._id) throw new Error('Save course details and add a module before uploading lesson media.')
    const extension = file.name.split('.').pop()?.toLowerCase()
    const allowedVideo = new Map([
      ['mp4', ['video/mp4']], ['m4v', ['video/mp4', 'video/x-m4v']], ['mov', ['video/quicktime']],
      ['webm', ['video/webm']], ['ogv', ['video/ogg', 'application/ogg']], ['avi', ['video/x-msvideo', 'video/avi']],
      ['mkv', ['video/x-matroska']],
    ])
    const allowedResources = new Map([
      ['pdf', ['application/pdf']], ['png', ['image/png']], ['jpg', ['image/jpeg']],
      ['jpeg', ['image/jpeg']], ['webp', ['image/webp']],
    ])
    const allowed = assetType === 'video' ? allowedVideo : allowedResources
    const limit = assetType === 'video' ? 2 * 1024 * 1024 * 1024 : 50 * 1024 * 1024
    const acceptedMimes = allowed.get(extension)
    const mimeMatches = acceptedMimes?.includes(file.type) || (
      assetType === 'video' && (!file.type || file.type === 'application/octet-stream')
    )
    if (!mimeMatches) {
      throw new Error(assetType === 'video' ? 'Choose an MP4, MOV, WebM, AVI, MKV, or OGV video file.' : 'Choose a PDF, PNG, JPEG, or WebP resource.')
    }
    if (file.size > limit) throw new Error(`This file exceeds the ${assetType === 'video' ? '2 GB' : '50 MB'} upload limit.`)
    setUploadProgress(0)
    const result = await uploadWithProgress(
      `/admin/courses/${encodeURIComponent(editingId)}/modules/${encodeURIComponent(module._id)}/media/${assetType}`,
      file,
      onLogout,
      setUploadProgress,
    )
    pendingAssets.current.push({ publicId: result.publicId, resourceType: result.resourceType })
    return result
  }

  function addModule() {
    const moduleIndex = course.modules.length
    const module = newModule(moduleIndex)
    setCourse((current) => ({ ...current, modules: [...current.modules, module] }))
    setCollapsedModules((current) => ({ ...current, [module._localId]: false }))
    setActiveContentEditor({ moduleIndex, itemIndex: -1 })
    setContentDraft(emptyContentItem('video-lesson'))
    setAiLessonContent('')
    setPanelError('')
    setError('')
  }

  function updateModule(moduleIndex, field, value) {
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module, index) => index === moduleIndex ? { ...module, [field]: value } : module),
    }))
  }

  function openContentEditor(moduleIndex, type, itemIndex = -1) {
    const module = course.modules[moduleIndex]
    const existing = itemIndex >= 0 ? module.contentItems[itemIndex] : null
    const draft = existing
      ? { ...existing, resources: [...(existing.resources || [])], quiz: existing.quiz ? { ...existing.quiz, questions: existing.quiz.questions.map((question) => ({ ...question, options: [...question.options], correctOptionIndices: [...question.correctOptionIndices] })) } : undefined }
      : emptyContentItem(type)
    setActiveContentEditor({ moduleIndex, itemIndex })
    setContentDraft(draft)
    setAiLessonContent(module.contentItems.filter((item) => item.type === 'video-lesson' || item.type === 'note').map((item) => item.content || '').filter(Boolean).join('\n\n'))
    setAiQuestionCount(5)
    setAiDifficulty('intermediate')
    setAiQuestionTypes(['multiple-choice'])
    setPanelError('')
  }

  function saveContentItem(event) {
    event.preventDefault()
    if (!activeContentEditor || !contentDraft?.title.trim()) {
      setPanelError('Enter a title for this course item.')
      return
    }
    if (contentDraft.type === 'video-lesson' && (!contentDraft.videoUrl?.trim() || !contentDraft.videoPublicId)) {
      setPanelError('Upload a video to Cloudinary before saving this lesson.')
      return
    }
    if (contentDraft.type === 'quiz') {
      const questions = contentDraft.quiz.questions.filter((question) => question.prompt.trim())
      const validQuestions = questions.filter((question) => (
        question.options.length >= 2 &&
        question.options.length <= 10 &&
        question.options.every((option) => option.trim()) &&
        question.correctOptionIndices.length >= (question.type === 'multiple-select' ? 2 : 1) &&
        (question.type === 'multiple-select' || question.correctOptionIndices.length === 1) &&
        new Set(question.correctOptionIndices).size === question.correctOptionIndices.length &&
        question.correctOptionIndices.every((index) => question.options[index]?.trim()) &&
        (question.type !== 'true-false' || (question.options.length === 2 && question.options[0] === 'True' && question.options[1] === 'False'))
      ))
      if (!validQuestions.length || validQuestions.length !== questions.length) {
        setPanelError('Add at least one valid question. Finish or remove any incomplete questions before saving.')
        return
      }
    }
    const { moduleIndex, itemIndex } = activeContentEditor
    const saved = {
      ...contentDraft,
      title: contentDraft.title.trim(),
      _localId: contentDraft._localId || localKey(),
      ...(contentDraft.type === 'quiz' ? {
        quiz: { ...contentDraft.quiz, title: contentDraft.title.trim(), questions: contentDraft.quiz.questions.filter((question) => question.prompt.trim()) },
      } : {}),
    }
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module, index) => {
        if (index !== moduleIndex) return module
        const contentItems = [...module.contentItems]
        if (itemIndex < 0) contentItems.push(saved)
        else contentItems[itemIndex] = saved
        return { ...module, contentItems }
      }),
    }))
    setActiveContentEditor(null)
    setContentDraft(null)
    setPanelError('')
  }

  function deleteContentItem(moduleIndex, itemIndex) {
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module, index) => index === moduleIndex
        ? { ...module, contentItems: module.contentItems.filter((_, itemPosition) => itemPosition !== itemIndex) }
        : module),
    }))
    setActiveContentEditor(null)
    setContentDraft(null)
  }

  function moveContentItem(moduleIndex, fromIndex, toIndex) {
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module, index) => {
        if (index !== moduleIndex || toIndex < 0 || toIndex >= module.contentItems.length || fromIndex === toIndex) return module
        const contentItems = [...module.contentItems]
        const [moved] = contentItems.splice(fromIndex, 1)
        contentItems.splice(toIndex, 0, moved)
        return { ...module, contentItems }
      }),
    }))
  }

  async function generateQuizQuestions() {
    if (!aiLessonContent.trim()) {
      setPanelError('Add lesson content for the AI to use when generating questions.')
      return
    }
    if (!aiQuestionTypes.length) {
      setPanelError('Choose at least one question type.')
      return
    }
    setIsGeneratingQuiz(true)
    setPanelError('')
    try {
      const result = await adminCourseRequest('/admin/courses/generate-quiz-questions', onLogout, {
        method: 'POST',
        body: { lessonContent: aiLessonContent, questionCount: Number(aiQuestionCount), difficulty: aiDifficulty, questionTypes: aiQuestionTypes },
      })
      const questions = (result.questions || []).map((question) => ({
        ...question,
        _localId: localKey(),
        marks: 1,
        correctOptionIndices: question.correctOptionIndices || [],
      }))
      setContentDraft((current) => ({ ...current, quiz: { ...current.quiz, questions: [...current.quiz.questions, ...questions] } }))
    } catch (generationError) {
      setPanelError(generationError instanceof Error ? generationError.message : 'Quiz questions could not be generated.')
    } finally {
      setIsGeneratingQuiz(false)
    }
  }

  async function uploadContentVideo(fileOrEvent) {
    const file = typeof File !== 'undefined' && fileOrEvent instanceof File ? fileOrEvent : fileOrEvent.currentTarget.files?.[0]
    if (fileOrEvent.currentTarget) fileOrEvent.currentTarget.value = ''
    if (!file || !activeContentEditor) return
    setIsUploading('video')
    setPanelError('')
    try {
      const result = await uploadCourseMedia(file, 'video', course.modules[activeContentEditor.moduleIndex])
      setContentDraft((current) => ({ ...current, videoUrl: result.url, videoPublicId: result.publicId, videoFormat: result.format, videoBytes: result.bytes, durationSeconds: result.duration ? Math.round(result.duration) : current.durationSeconds }))
    } catch (uploadError) {
      setPanelError(uploadError instanceof Error ? uploadError.message : 'The video could not be uploaded.')
    } finally {
      setIsUploading('')
      setUploadProgress(0)
    }
  }

  async function uploadContentResource(event) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !activeContentEditor) return
    setIsUploading('resource')
    setPanelError('')
    try {
      const result = await uploadCourseMedia(file, 'resource', course.modules[activeContentEditor.moduleIndex])
      setContentDraft((current) => ({
        ...current,
        resources: [...current.resources, { _localId: localKey(), title: file.name, url: result.url, publicId: result.publicId, resourceType: result.resourceType, format: result.format, bytes: result.bytes }],
      }))
    } catch (uploadError) {
      setPanelError(uploadError instanceof Error ? uploadError.message : 'The resource could not be uploaded.')
    } finally {
      setIsUploading('')
      setUploadProgress(0)
    }
  }

  async function uploadThumbnail(event) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    const supportedImageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'])
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!file.type.startsWith('image/') && !supportedImageExtensions.has(extension)) {
      setError('Choose a JPG, PNG, WebP, GIF, or AVIF image.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Choose an image up to 10 MB.')
      return
    }
    if (thumbnailPreviewUrl.current) URL.revokeObjectURL(thumbnailPreviewUrl.current)
    thumbnailPreviewUrl.current = URL.createObjectURL(file)
    setThumbnailPreview(thumbnailPreviewUrl.current)
    setIsUploading('thumbnail')
    setError('')
    try {
      const result = await uploadAsset(file, 'image')
      setCourse((current) => ({ ...current, thumbnailUrl: result.url, thumbnailPublicId: result.publicId }))
      if (result.publicId) pendingAssets.current.push({ publicId: result.publicId, resourceType: 'image' })
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The thumbnail could not be uploaded.')
    } finally {
      if (thumbnailPreviewUrl.current) URL.revokeObjectURL(thumbnailPreviewUrl.current)
      thumbnailPreviewUrl.current = ''
      setThumbnailPreview('')
      setIsUploading('')
    }
  }

  async function uploadLessonVideo(fileOrEvent) {
    const file = typeof File !== 'undefined' && fileOrEvent instanceof File
      ? fileOrEvent
      : fileOrEvent.currentTarget.files?.[0]
    if (fileOrEvent.currentTarget) fileOrEvent.currentTarget.value = ''
    if (!file) return
    setIsUploading('video')
    setPanelError('')
    try {
      const result = await uploadCourseMedia(file, 'video', course.modules[lessonTarget?.moduleIndex])
      setLessonDraft((current) => ({ ...current, videoUrl: result.url, videoPublicId: result.publicId, videoFormat: result.format, videoBytes: result.bytes, durationSeconds: result.duration ? Math.round(result.duration) : current.durationSeconds }))
    } catch (uploadError) {
      setPanelError(uploadError instanceof Error ? uploadError.message : 'The video could not be uploaded.')
    } finally {
      setIsUploading('')
      setUploadProgress(0)
    }
  }

  async function uploadLessonResource(event) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setIsUploading('resource')
    setPanelError('')
    try {
      const result = await uploadCourseMedia(file, 'resource', course.modules[lessonTarget?.moduleIndex])
      setLessonDraft((current) => ({
        ...current,
        resources: [...current.resources, { _localId: localKey(), title: file.name, url: result.url, publicId: result.publicId, resourceType: result.resourceType, format: result.format, bytes: result.bytes }],
      }))
    } catch (uploadError) {
      setPanelError(uploadError instanceof Error ? uploadError.message : 'The resource could not be uploaded.')
    } finally {
      setIsUploading('')
      setUploadProgress(0)
    }
  }

  function openLessonEditor(moduleIndex, lessonIndex = -1) {
    const existing = lessonIndex >= 0 ? course.modules[moduleIndex].lessons[lessonIndex] : emptyLesson()
    setLessonTarget({ moduleIndex, lessonIndex })
    setLessonDraft({ ...existing, resources: (existing.resources || []).map((resource) => ({ ...resource })) })
    setQuizTarget(null)
    setPanelError('')
  }

  function saveLesson(event) {
    event.preventDefault()
    if (!lessonTarget || !lessonDraft.title.trim()) return
    if (!lessonDraft.videoUrl?.trim() || !lessonDraft.videoPublicId) {
      setPanelError('Wait for the video upload to finish before saving this lesson.')
      return
    }
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module, moduleIndex) => {
        if (moduleIndex !== lessonTarget.moduleIndex) return module
        const lessons = [...module.lessons]
        const saved = { ...lessonDraft, title: lessonDraft.title.trim(), _localId: lessonDraft._localId || localKey() }
        if (lessonTarget.lessonIndex < 0) lessons.push(saved)
        else lessons[lessonTarget.lessonIndex] = saved
        return { ...module, lessons }
      }),
    }))
    setLessonTarget(null)
    setPanelError('')
  }

  function openQuizEditor(moduleIndex) {
    const existing = course.modules[moduleIndex].quiz || {
      title: `${course.modules[moduleIndex].title} Quiz`,
      passingPercentage: 70,
      maxAttempts: 3,
      timeLimitMinutes: 0,
      questions: [],
    }
    setQuizTarget({ moduleIndex })
    setQuizDraft({ ...existing, questions: existing.questions.map((question) => ({ ...question, _localId: question._localId || question._id || localKey(), options: [...question.options], correctOptionIndices: [...question.correctOptionIndices] })) })
    setLessonTarget(null)
    setPanelError('')
  }

  function saveQuiz() {
    if (!quizTarget) return
    const completeQuestions = quizDraft.questions.filter((question) => question.prompt.trim())
    if (!quizDraft.title.trim() || !completeQuestions.length || completeQuestions.some((question) => (
      question.options.some((option) => !option.trim()) || !question.correctOptionIndices.length ||
      question.correctOptionIndices.some((index) => !question.options[index]?.trim())
    ))) {
      setPanelError('Add a quiz title, at least one complete question, and select the correct answer for each question.')
      return
    }
    const savedQuiz = { ...quizDraft, questions: completeQuestions }
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module, index) => index === quizTarget.moduleIndex ? { ...module, quiz: savedQuiz } : module),
    }))
    setQuizTarget(null)
    setPanelError('')
  }

  function moveModule(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= course.modules.length || fromIndex === toIndex) return
    setCourse((current) => {
      const modules = [...current.modules]
      const [moved] = modules.splice(fromIndex, 1)
      modules.splice(toIndex, 0, moved)
      return { ...current, modules }
    })
  }

  async function saveCourse(status) {
    setIsSaving(true)
    setError('')
    try {
      const payload = serializeCourse(course, status)
      const result = await adminCourseRequest(editingId ? `/admin/courses/${encodeURIComponent(editingId)}` : '/admin/courses', onLogout, {
        method: editingId ? 'PUT' : 'POST',
        body: payload,
      })
      const savedAssets = collectCourseAssets(payload)
      const savedAssetIds = new Set(savedAssets.map((asset) => asset.publicId))
      const cleanupAssets = [...originalAssets.current, ...pendingAssets.current]
        .filter((asset, index, assets) => !savedAssetIds.has(asset.publicId) && assets.findIndex((entry) => entry.publicId === asset.publicId) === index)
      const cleanupResults = await deleteMediaAssets(cleanupAssets)
      const cleanupWarning = cleanupResults.some((resultItem) => (
        resultItem.status === 'rejected' || resultItem.value?.shared
      ))
      originalAssets.current = savedAssets
      pendingAssets.current = []
      await loadCourses()
      const successMessage = result.message || (status === 'published' ? 'Course published.' : 'Course saved as draft.')
      backToList(cleanupWarning ? `${successMessage} Some media is still in use or could not be removed.` : successMessage)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The course could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  async function toggleCourseStatus(courseToUpdate) {
    const status = courseToUpdate.status === 'published' ? 'draft' : 'published'
    setError('')
    setNotice('')
    try {
      const result = await adminCourseRequest(`/admin/courses/${encodeURIComponent(courseToUpdate._id)}/status`, onLogout, { method: 'PATCH', body: { status } })
      setNotice(result.message)
      await loadCourses()
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'The course status could not be changed.')
    }
  }

  async function deleteCourse(courseToDelete) {
    if (!courseToDelete?._id || courseToDelete.status !== 'draft') return
    const previousCourses = [...courses]
    const previousStats = { ...stats }
    setDeleteCandidate(null)
    setError('')
    setNotice('Deleting draft course…')
    setCourses((current) => current.filter((item) => item._id !== courseToDelete._id))
    setStats((current) => ({
      ...current,
      totalCourses: Math.max((Number(current.totalCourses) || 0) - 1, 0),
      draftCourses: Math.max((Number(current.draftCourses) || 0) - 1, 0),
    }))

    try {
      const result = await adminCourseRequest(`/admin/courses/${encodeURIComponent(courseToDelete._id)}`, onLogout, { method: 'DELETE' })
      setNotice('')
      const refreshed = await loadCourses()
      if (result.assetCleanupFailed) {
        setError('The course was deleted, but some associated Cloudinary files could not be removed.')
      } else if (refreshed) {
        setNotice(result.message || 'Draft course deleted.')
      }
    } catch (deleteError) {
      setCourses(previousCourses)
      setStats(previousStats)
      setError(deleteError instanceof Error ? deleteError.message : 'The draft course could not be deleted.')
      setNotice('')
    }
  }

  function renderCourseList() {
    return (
      <div className="ac-library">
        <div className="ac-page-heading">
          <div><p className="ac-eyebrow">PLATFORM CONTENT</p><h1>Course management</h1><p>Build, organize, and publish courses for the LMS.</p></div>
          <div className="ac-page-heading__actions">
            <div className={`ac-cloudinary-status ac-cloudinary-status--${cloudinaryHealth}`} role="status">
              <span aria-hidden="true" />Cloudinary {cloudinaryHealth === 'checking' ? 'checking' : cloudinaryHealth}
              {cloudinaryHealth === 'unavailable' && <button type="button" onClick={checkCloudinaryHealth}>Retry</button>}
            </div>
            <button type="button" className="ac-button ac-button--gold ac-add-course" onClick={beginNewCourse}><span aria-hidden="true">＋</span> Add new course</button>
          </div>
        </div>
        <CourseStats stats={stats} />
        {notice && <p className="ac-success" role="status">{notice}</p>}
        {error && <p className="ac-inline-error" role="alert">{error}</p>}
        <section className="ac-library-section">
          <div className="ac-library-heading"><div><p className="ac-eyebrow">YOUR CATALOG</p><h2>All courses <span>{filteredCourses.length}</span></h2></div></div>
          <div className="ac-filters">
            <label className="ac-search"><span aria-hidden="true">⌕</span><input aria-label="Search courses" placeholder="Search courses..." value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <label className="ac-filter"><span>Category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{catalogCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label className="ac-filter"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option></select></label>
          </div>
          {isLoading ? <div className="ac-empty-state"><span className="ac-spinner" />Loading courses...</div>
            : error && courses.length === 0 ? <div className="ac-empty-state"><span aria-hidden="true">!</span><strong>Courses could not be loaded</strong><p>Check that the server is available, then try again.</p><button type="button" className="ac-button ac-button--gold" onClick={loadCourses}>Retry</button></div>
            : filteredCourses.length === 0 ? <div className="ac-empty-state"><span aria-hidden="true">▤</span><strong>{courses.length ? 'No matching courses' : 'No courses yet'}</strong><p>{courses.length ? 'Try another search or filter.' : 'Create the first course for your catalog.'}</p>{!courses.length && <button type="button" className="ac-button ac-button--gold" onClick={beginNewCourse}>Add new course</button>}</div>
              : <div className="ac-course-grid">{filteredCourses.map((item) => <CourseCard key={item._id} course={item} onEdit={beginEdit} onPreview={openPreview} onToggleStatus={toggleCourseStatus} onDelete={() => setDeleteCandidate(item)} />)}</div>}
        </section>

        {deleteCandidate && (
          <div className="ac-delete-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-course-title">
              <div className="ac-delete-confirm">
                <p className="ac-eyebrow">DELETE DRAFT</p>
                <h3 id="delete-course-title">Delete this course?</h3>
                <p>"{deleteCandidate.title || 'Untitled course'}" will be permanently removed. This action cannot be undone.</p>
                <div className="ac-delete-confirm__actions">
                  <button type="button" className="ac-button ac-button--outline" onClick={() => setDeleteCandidate(null)}>Cancel</button>
                  <button type="button" className="ac-button ac-button--gold" onClick={() => deleteCourse(deleteCandidate)}>Delete</button>
                </div>
              </div>
          </div>
        )}
      </div>
    )
  }

  function renderCategoryPicker() {
    const categoryMarks = {
      Python: 'Py',
      'Prompt Engineering': '✧',
      'Digital Marketing': '↗',
      'Full Stack Development': '⌘',
      'UI/UX Design': '◫',
    }
    return (
      <section className="ac-category-picker" aria-labelledby="ac-category-picker-title">
        <div className="ac-category-picker__heading"><p className="ac-eyebrow">NEW COURSE</p><h1 id="ac-category-picker-title">Which course are you adding?</h1><p>Choose a category to start building your course.</p></div>
        <div className="ac-category-picker__grid" role="group" aria-label="Course category">
          {courseCategories.map((category) => {
            const isEditing = categoryEditor?.mode === 'edit' && categoryEditor.original === category
            const isConfirmingDelete = categoryPendingDelete === category
            return (
              <article className={`ac-category-choice${selectedCourseCategory === category ? ' is-selected' : ''}`} key={category}>
                <button type="button" className="ac-category-choice__select" aria-pressed={selectedCourseCategory === category} onClick={() => setSelectedCourseCategory(category)}>
                  <span className="ac-category-choice__mark" aria-hidden="true">{categoryMarks[category] || '✦'}</span>
                  <span className="ac-category-choice__name">{category}</span>
                  <span className="ac-category-choice__radio" aria-hidden="true" />
                </button>
                <div className="ac-category-choice__controls">
                  <button type="button" className="ac-icon-button ac-icon-button--small" aria-label={`Edit ${category}`} onClick={() => startEditingCourseCategory(category)}>✎</button>
                  <button type="button" className="ac-icon-button ac-icon-button--small ac-icon-button--danger" aria-label={`Delete ${category}`} onClick={() => { setCategoryPendingDelete(category); setCategoryEditor(null); setCategoryManagerError('') }}>×</button>
                </div>
                {isEditing && <form className="ac-category-inline-form" onSubmit={saveCourseCategory}>
                  <label className="ac-field"><span>Edit course name</span><input autoFocus maxLength="80" value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} /></label>
                  {categoryManagerError && <p className="ac-inline-error" role="alert">{categoryManagerError}</p>}
                  <div><button type="button" className="ac-text-button" onClick={() => { setCategoryEditor(null); setCategoryManagerError('') }}>Cancel</button><button type="submit" className="ac-text-button">Save</button></div>
                </form>}
                {isConfirmingDelete && <div className="ac-category-delete-confirm"><span>Remove {category}?</span><button type="button" className="ac-text-button" onClick={() => setCategoryPendingDelete('')}>Cancel</button><button type="button" className="ac-text-button ac-text-button--danger" onClick={() => deleteCourseCategory(category)}>Delete</button></div>}
              </article>
            )
          })}
          {categoryEditor?.mode === 'add' ? <form className="ac-category-add-form" onSubmit={saveCourseCategory}>
            <span className="ac-category-choice__mark" aria-hidden="true">＋</span>
            <label className="ac-field"><span>Course name</span><input autoFocus maxLength="80" value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="Enter a course name" /></label>
            {categoryManagerError && <p className="ac-inline-error" role="alert">{categoryManagerError}</p>}
            <div><button type="button" className="ac-text-button" onClick={() => { setCategoryEditor(null); setCategoryManagerError('') }}>Cancel</button><button type="submit" className="ac-button ac-button--gold">Save course</button></div>
          </form> : <button type="button" className="ac-category-add" onClick={startAddingCourseCategory}><span className="ac-category-choice__mark" aria-hidden="true">＋</span><span className="ac-category-choice__name">Add Course</span><span className="ac-category-add__hint">Enter a custom course name</span></button>}
        </div>
        <div className="ac-category-picker__actions">
          <button type="button" className="ac-button ac-button--outline" onClick={() => backToList()}>Cancel</button>
          <button type="button" className="ac-button ac-button--gold" disabled={!selectedCourseCategory} onClick={continueWithCourseCategory}>Continue to course details <span aria-hidden="true">→</span></button>
        </div>
      </section>
    )
  }

  function renderDetailsStep() {
    return (
      <form className="ac-details-step" ref={detailsForm} onSubmit={continueToContent}>
        <div className="ac-details-grid">
          <div className="ac-details-fields">
            <label className="ac-field"><span>Course title <b>*</b></span><input required maxLength="200" value={course.title} onChange={(event) => updateCourse('title', event.target.value)} placeholder="Full Stack Web Development" /></label>
            <label className="ac-field"><span>Short description <b>*</b></span><textarea required minLength="10" maxLength="1000" rows="3" value={course.description} onChange={(event) => updateCourse('description', event.target.value)} placeholder="A concise introduction shown in the course catalog." /></label>
            <label className="ac-field"><span>Detailed description</span><textarea maxLength="10000" rows="6" value={course.detailedDescription} onChange={(event) => updateCourse('detailedDescription', event.target.value)} placeholder="Describe the course, its audience, and what learners will build." /></label>
            <section className="ac-thumbnail-upload" aria-labelledby="ac-thumbnail-upload-title">
              <div>
                <h3 id="ac-thumbnail-upload-title">Course thumbnail</h3>
                <p>Choose an image up to 10 MB. It will appear on the course card and preview.</p>
              </div>
              <CoverImage className="ac-thumbnail-upload__preview" url={thumbnailPreview || course.thumbnailUrl} title={course.title} />
              <div className="ac-thumbnail-upload__actions">
                <label className={`ac-button ac-button--outline${isUploading === 'thumbnail' ? ' is-disabled' : ''}`} htmlFor="ac-course-thumbnail">
                  {isUploading === 'thumbnail' ? 'Uploading…' : course.thumbnailUrl ? 'Change thumbnail' : 'Upload thumbnail'}
                  <input
                    className="ac-thumbnail-upload__input"
                    id="ac-course-thumbnail"
                    type="file"
                    accept="image/*"
                    onChange={uploadThumbnail}
                    disabled={isUploading === 'thumbnail'}
                  />
                </label>
                {course.thumbnailUrl && (
                  <button
                    type="button"
                    className="ac-button ac-button--quiet ac-button--danger"
                    onClick={() => {
                      setCourse((current) => ({ ...current, thumbnailUrl: '', thumbnailPublicId: '' }))
                      setError('')
                    }}
                    disabled={isUploading === 'thumbnail'}
                  >
                    Remove thumbnail
                  </button>
                )}
              </div>
            </section>
            <label className="ac-field"><span>Difficulty level</span><select value={course.difficulty} onChange={(event) => updateCourse('difficulty', event.target.value)}>{Object.entries(difficultyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="ac-field"><span>Estimated duration (minutes)</span><input type="number" min="0" max="100000" value={course.estimatedDurationMinutes} onChange={(event) => updateCourse('estimatedDurationMinutes', event.target.value)} /></label>
            <label className="ac-field"><span>Learning objectives <small>One per line</small></span><textarea rows="4" value={course.learningObjectives.join('\n')} onChange={(event) => updateCourse('learningObjectives', event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))} placeholder="Build responsive web interfaces\nUnderstand modern JavaScript" /></label>
            <label className="ac-field"><span>Prerequisites <small>One per line</small></span><textarea rows="3" value={course.prerequisites.join('\n')} onChange={(event) => updateCourse('prerequisites', event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))} placeholder="Basic computer skills" /></label>
          </div>
        </div>
        {error && <p className="ac-inline-error" role="alert">{error}</p>}
        <div className="ac-builder-footer"><button type="button" className="ac-button ac-button--outline" onClick={cancelCourseDetails}>Cancel</button><button type="submit" className="ac-button ac-button--gold" disabled={isSaving}>{isSaving ? 'Saving draft…' : <>Continue to content <span aria-hidden="true">→</span></>}</button></div>
      </form>
    )
  }

  function renderContentStep() {
    const updateDraft = (field, value) => setContentDraft((current) => ({ ...current, [field]: value }))
    const updateQuiz = (field, value) => setContentDraft((current) => ({ ...current, quiz: { ...current.quiz, [field]: value } }))
    const updateQuestion = (questionIndex, field, value) => setContentDraft((current) => ({
      ...current,
      quiz: {
        ...current.quiz,
        questions: current.quiz.questions.map((question, index) => index === questionIndex ? { ...question, [field]: value } : question),
      },
    }))
    const addQuestion = () => updateQuiz('questions', [...contentDraft.quiz.questions, emptyQuestion()])
    const typeLabels = {
      'video-lesson': 'Video lesson',
      quiz: 'Quiz',
      assignment: 'Assignment',
      note: 'Notes / PDF',
    }

    return (
      <div className="ac-content-step">
        <div className="ac-content-intro">
          <div><p className="ac-eyebrow">COURSE BUILDER</p><h2>Course content</h2><p>Add modules, then arrange lessons and learning activities in the order students should see them.</p></div>
        </div>
        <section className="ac-modules-container" aria-label="Course modules">
          <div className="ac-modules-container__heading">
            <div><h3>Course modules</h3><p>Organize course material into expandable sections.</p></div>
            <button type="button" className="ac-button ac-button--gold" onClick={addModule}><span aria-hidden="true">＋</span> Add Module</button>
          </div>
          {course.modules.length === 0 ? (
            <div className="ac-content-empty"><span aria-hidden="true">▤</span><h3>No modules yet</h3><p>Add a module to start building your course content.</p></div>
          ) : (
            <div className="ac-module-list">
              {course.modules.map((module, moduleIndex) => (
              <article
                className={`ac-module${contentDrag?.kind === 'module' && contentDrag.fromIndex === moduleIndex ? ' is-dragging' : ''}`}
                key={module._localId || module._id}
                onDragOver={(event) => { if (contentDrag?.kind === 'module') event.preventDefault() }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (contentDrag?.kind === 'module') moveModule(contentDrag.fromIndex, moduleIndex)
                  setContentDrag(null)
                }}
              >
                <header className="ac-module__header">
                  <button type="button" className="ac-content-drag" draggable aria-label={`Reorder module ${module.title}`} onDragStart={() => setContentDrag({ kind: 'module', fromIndex: moduleIndex })} onDragEnd={() => setContentDrag(null)}>⠿</button>
                  <span className="ac-module__folder" aria-hidden="true">▰</span>
                  <label className="ac-module__title">
                    <span className="ac-sr-only">Module {moduleIndex + 1} title</span>
                    <input value={module.title} maxLength="200" onChange={(event) => updateModule(moduleIndex, 'title', event.target.value)} />
                    <small>{module.contentItems.length} {module.contentItems.length === 1 ? 'item' : 'items'}</small>
                  </label>
                  <button type="button" className="ac-icon-button ac-module__expand" aria-label={`${collapsedModules[module._localId] ? 'Expand' : 'Collapse'} ${module.title}`} aria-expanded={!collapsedModules[module._localId]} aria-controls={`module-body-${module._localId}`} onClick={() => setCollapsedModules((current) => ({ ...current, [module._localId]: !current[module._localId] }))}>{collapsedModules[module._localId] ? '⌄' : '⌃'}</button>
                  <button type="button" className="ac-icon-button ac-icon-button--danger" aria-label={`Delete ${module.title}`} onClick={() => {
                    setCourse((current) => ({ ...current, modules: current.modules.filter((_, index) => index !== moduleIndex) }))
                    setActiveContentEditor(null)
                    setContentDraft(null)
                  }}>×</button>
                </header>
                <div className="ac-module__body" id={`module-body-${module._localId}`} hidden={Boolean(collapsedModules[module._localId])}>
                  <label className="ac-field"><span>Module description</span><input value={module.description || ''} maxLength="2000" placeholder="What this module covers" onChange={(event) => updateModule(moduleIndex, 'description', event.target.value)} /></label>
                  {module.contentItems.length === 0 && <p className="ac-module-empty">No content in this module yet.</p>}
                  <div className="ac-content-item-list">
                    {module.contentItems.map((item, itemIndex) => (
                      <div
                        key={item._localId || item._id || `${item.type}-${itemIndex}`}
                        className={`ac-content-item${contentDrag?.kind === 'item' && contentDrag.moduleIndex === moduleIndex && contentDrag.fromIndex === itemIndex ? ' is-dragging' : ''}`}
                        onDragOver={(event) => { if (contentDrag?.kind === 'item' && contentDrag.moduleIndex === moduleIndex) event.preventDefault() }}
                        onDrop={(event) => {
                          event.preventDefault()
                          if (contentDrag?.kind === 'item' && contentDrag.moduleIndex === moduleIndex) moveContentItem(moduleIndex, contentDrag.fromIndex, itemIndex)
                          setContentDrag(null)
                        }}
                      >
                        <button type="button" className="ac-content-drag" draggable aria-label={`Reorder ${item.title}`} onDragStart={(event) => { event.stopPropagation(); setContentDrag({ kind: 'item', moduleIndex, fromIndex: itemIndex }) }} onDragEnd={() => setContentDrag(null)}>⠿</button>
                        <span className={`ac-content-type ac-content-type--${item.type}`} aria-hidden="true">{item.type === 'video-lesson' ? '▶' : item.type === 'quiz' ? '?' : item.type === 'assignment' ? '✓' : '▤'}</span>
                        <div className="ac-content-item__text"><strong>{item.title || typeLabels[item.type]}</strong><small>{typeLabels[item.type]}{item.type === 'quiz' ? ` · ${item.quiz?.questions?.length || 0} questions` : item.type === 'assignment' && item.dueDate ? ` · Due ${new Date(item.dueDate).toLocaleDateString()}` : ''}</small></div>
                        <div className="ac-content-item__actions">
                          <button type="button" className="ac-icon-button ac-icon-button--small" aria-label={`Edit ${item.title}`} onClick={() => openContentEditor(moduleIndex, item.type, itemIndex)}>✎</button>
                          <button type="button" className="ac-icon-button ac-icon-button--small ac-icon-button--danger" aria-label={`Delete ${item.title}`} onClick={() => deleteContentItem(moduleIndex, itemIndex)}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="ac-add-content-actions" aria-label={`Add content to ${module.title}`}>
                    {Object.entries(typeLabels).map(([type, label]) => <button type="button" className="ac-button ac-button--outline" key={type} onClick={() => openContentEditor(moduleIndex, type)}>＋ {type === 'video-lesson' ? 'Add Video' : type === 'note' ? 'Add Notes/PDF' : `Add ${label}`}</button>)}
                  </div>
                  {activeContentEditor?.moduleIndex === moduleIndex && contentDraft && (
                    <form className="ac-content-editor" onSubmit={saveContentItem}>
                      <label className="ac-field"><span>Title <b>*</b></span><input autoFocus required maxLength="200" value={contentDraft.title} onChange={(event) => updateDraft('title', event.target.value)} /></label>
                      {contentDraft.type === 'video-lesson' && <>
                        <label className="ac-field"><span>Lesson description</span><textarea rows="3" maxLength="20000" value={contentDraft.content} onChange={(event) => updateDraft('content', event.target.value)} placeholder="What will learners learn?" /></label>
                        <label className="ac-resource-add ac-content-upload"><span aria-hidden="true">↑</span>{isUploading === 'video' ? `Uploading video · ${uploadProgress}%` : contentDraft.videoPublicId ? 'Replace uploaded video' : 'Upload video'}<input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska,video/ogg,.m4v,.mkv,.avi,.ogv" onChange={uploadContentVideo} disabled={Boolean(isUploading)} /></label>
                        {isUploading === 'video' && <><progress className="ac-content-progress" max="100" value={uploadProgress} aria-label={`Video upload ${uploadProgress}%`} /><small className="ac-content-uploaded">{uploadProgress >= 100 ? 'Finishing upload to Cloudinary…' : `Uploading to server · ${uploadProgress}%`}</small></>}
                        {contentDraft.videoPublicId && <small className="ac-content-uploaded">Video uploaded successfully.</small>}
                      </>}
                      {contentDraft.type === 'assignment' && <>
                        <label className="ac-field"><span>Instructions</span><textarea rows="4" maxLength="10000" value={contentDraft.description} onChange={(event) => updateDraft('description', event.target.value)} /></label>
                        <div className="ac-form-columns"><label className="ac-field"><span>Due date</span><input type="datetime-local" value={dateTimeLocalValue(contentDraft.dueDate)} onChange={(event) => updateDraft('dueDate', event.target.value)} /></label><label className="ac-field"><span>Points</span><input type="number" min="0" max="100000" value={contentDraft.points} onChange={(event) => updateDraft('points', event.target.value)} /></label></div>
                      </>}
                      {contentDraft.type === 'note' && <>
                        <label className="ac-field"><span>Notes</span><textarea rows="5" maxLength="20000" value={contentDraft.content} onChange={(event) => updateDraft('content', event.target.value)} placeholder="Write the lesson notes here." /></label>
                        <label className="ac-resource-add ac-content-upload"><span aria-hidden="true">＋</span>{isUploading === 'resource' ? 'Uploading file…' : 'Attach PDF or resource'}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={uploadContentResource} disabled={Boolean(isUploading)} /></label>
                        {contentDraft.resources.length > 0 && <ul className="ac-resource-list">{contentDraft.resources.map((resource, index) => <li key={resource._localId || resource._id || index}><a href={resource.url} target="_blank" rel="noreferrer">{resource.title}</a><button type="button" className="ac-text-button ac-text-button--danger" onClick={() => updateDraft('resources', contentDraft.resources.filter((_, resourceIndex) => resourceIndex !== index))}>Remove</button></li>)}</ul>}
                      </>}
                      {contentDraft.type === 'quiz' && <>
                        <div className="ac-quiz-settings"><label className="ac-field"><span>Passing %</span><input type="number" min="1" max="100" value={contentDraft.quiz.passingPercentage} onChange={(event) => updateQuiz('passingPercentage', event.target.value)} /></label><label className="ac-field"><span>Attempts</span><input type="number" min="1" max="20" value={contentDraft.quiz.maxAttempts} onChange={(event) => updateQuiz('maxAttempts', event.target.value)} /></label><label className="ac-field"><span>Time (min)</span><input type="number" min="0" max="600" value={contentDraft.quiz.timeLimitMinutes} onChange={(event) => updateQuiz('timeLimitMinutes', event.target.value)} /></label></div>
                        <section className="ac-ai-quiz">
                          <h5>AI Generate Quiz</h5>
                          <label className="ac-field"><span>Lesson content for question generation</span><textarea rows="3" maxLength="20000" value={aiLessonContent} onChange={(event) => setAiLessonContent(event.target.value)} placeholder="Paste or edit lesson content for the AI to use." /></label>
                          <div className="ac-form-columns"><label className="ac-field"><span>Questions</span><input type="number" min="1" max="20" value={aiQuestionCount} onChange={(event) => setAiQuestionCount(event.target.value)} /></label><label className="ac-field"><span>Difficulty</span><select value={aiDifficulty} onChange={(event) => setAiDifficulty(event.target.value)}>{Object.entries(difficultyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
                          <div className="ac-ai-quiz__types"><span>Question types</span>{[['multiple-choice', 'MCQ'], ['multiple-select', 'Multiple select'], ['true-false', 'True / False']].map(([value, label]) => <label key={value}><input type="checkbox" checked={aiQuestionTypes.includes(value)} onChange={(event) => setAiQuestionTypes((current) => event.target.checked ? [...current, value] : current.filter((type) => type !== value))} />{label}</label>)}</div>
                          <button type="button" className="ac-button ac-button--outline" disabled={isGeneratingQuiz} onClick={generateQuizQuestions}>{isGeneratingQuiz ? 'Generating…' : 'Generate questions'}</button>
                        </section>
                        <h5 className="ac-manual-quiz-heading">Manual questions (optional)</h5>
                        <p className="ac-manual-quiz-help">Generate questions above or add them manually. Review and edit any questions before saving; the quiz needs at least one valid question.</p>
                        <div className="ac-quiz-question-list">
                          {contentDraft.quiz.questions.map((question, questionIndex) => (
                            <section className="ac-quiz-question" key={question._localId || question._id || questionIndex}>
                              <div className="ac-quiz-question__top"><strong>Question {questionIndex + 1}</strong><button type="button" className="ac-icon-button ac-icon-button--small ac-icon-button--danger" aria-label={`Delete question ${questionIndex + 1}`} onClick={() => updateQuiz('questions', contentDraft.quiz.questions.filter((_, index) => index !== questionIndex))}>×</button></div>
                              <label className="ac-field"><span>Question type</span><select value={question.type} onChange={(event) => {
                                const nextType = event.target.value
                                const options = nextType === 'true-false' ? ['True', 'False'] : question.options.length >= 2 ? question.options : ['', '']
                                updateQuestion(questionIndex, 'type', nextType)
                                updateQuestion(questionIndex, 'options', options)
                                updateQuestion(questionIndex, 'correctOptionIndices', [0])
                              }}><option value="multiple-choice">MCQ</option><option value="multiple-select">Multiple select</option><option value="true-false">True / False</option></select></label>
                              <label className="ac-field"><span>Prompt</span><textarea rows="2" maxLength="2000" value={question.prompt} onChange={(event) => updateQuestion(questionIndex, 'prompt', event.target.value)} /></label>
                              <div className="ac-answer-options"><span>Options and correct answer</span>{question.options.map((option, optionIndex) => <label className="ac-answer-option" key={optionIndex}><input type={question.type === 'multiple-select' ? 'checkbox' : 'radio'} name={`content-question-${question._localId || questionIndex}`} checked={question.correctOptionIndices.includes(optionIndex)} onChange={(event) => {
                                const selected = question.type === 'multiple-select'
                                  ? event.target.checked ? [...question.correctOptionIndices, optionIndex] : question.correctOptionIndices.filter((selectedIndex) => selectedIndex !== optionIndex)
                                  : [optionIndex]
                                updateQuestion(questionIndex, 'correctOptionIndices', selected)
                              }} /><input aria-label={`Option ${optionIndex + 1}`} value={option} disabled={question.type === 'true-false'} onChange={(event) => updateQuestion(questionIndex, 'options', question.options.map((entry, index) => index === optionIndex ? event.target.value : entry))} /><button type="button" className="ac-icon-button ac-icon-button--small ac-icon-button--danger" disabled={question.type === 'true-false' || question.options.length <= 2} aria-label={`Remove option ${optionIndex + 1}`} onClick={() => {
                                updateQuestion(questionIndex, 'options', question.options.filter((_, index) => index !== optionIndex))
                                updateQuestion(questionIndex, 'correctOptionIndices', question.correctOptionIndices.filter((index) => index !== optionIndex).map((index) => index > optionIndex ? index - 1 : index))
                              }}>×</button></label>)}
                                {question.type !== 'true-false' && <button type="button" className="ac-text-button" onClick={() => updateQuestion(questionIndex, 'options', [...question.options, ''])}>+ Add option</button>}
                              </div>
                            </section>
                          ))}
                        </div>
                        <button type="button" className="ac-button ac-button--outline" onClick={addQuestion}>+ Add question manually</button>
                      </>}
                      {panelError && <p className="ac-inline-error" role="alert">{panelError}</p>}
                      <div className="ac-panel-actions"><button type="button" className="ac-button ac-button--outline" onClick={() => { setActiveContentEditor(null); setContentDraft(null); setPanelError('') }}>Cancel</button><button type="submit" className="ac-button ac-button--gold" disabled={Boolean(isUploading) || isGeneratingQuiz}>Save item</button></div>
                    </form>
                  )}
                </div>
              </article>
              ))}
            </div>
          )}
        </section>
        {error && <p className="ac-inline-error" role="alert">{error}</p>}
        <div className="ac-builder-footer">
          <button type="button" className="ac-button ac-button--outline" onClick={() => enterStep(1)}>← Back</button>
          <button type="button" className="ac-button ac-button--gold" onClick={() => enterStep(3)}>Continue <span aria-hidden="true">→</span></button>
        </div>
      </div>
    )
  }

  function renderSettingsStep() {
    return (
      <div className="ac-settings-step">
        <div className="ac-builder-intro"><p className="ac-eyebrow">STEP 03 · SETTINGS</p><h2>Choose how this course is shared</h2><p>Draft courses stay visible only to authorized administrators.</p></div>
        <section className="ac-settings-panel"><div><span className="ac-settings-icon" aria-hidden="true">◷</span><div><h3>Course visibility</h3><p>Only published courses are served to students.</p></div></div><label className="ac-field"><span>Save status</span><select value={course.status} onChange={(event) => updateCourse('status', event.target.value)}><option value="draft">Draft · Admins only</option><option value="published">Published · Available to students</option></select></label></section>
        <section className="ac-settings-panel"><div><span className="ac-settings-icon" aria-hidden="true">◉</span><div><h3>Course details</h3><p>{course.category} · {difficultyLabels[course.difficulty]} · {formatDuration(course.estimatedDurationMinutes)}</p></div></div><button type="button" className="ac-button ac-button--outline" onClick={() => enterStep(1)}>Edit details</button></section>
        {error && <p className="ac-inline-error" role="alert">{error}</p>}
        <div className="ac-builder-footer"><button type="button" className="ac-button ac-button--outline" onClick={() => enterStep(2)}>← Course content</button><button type="button" className="ac-button ac-button--gold" onClick={() => enterStep(4)}>Review course <span aria-hidden="true">→</span></button></div>
      </div>
    )
  }

  if (view === 'list') return <div className="admin-course-workspace">{renderCourseList()}</div>
  if (view === 'category') return <div className="admin-course-workspace">{renderCategoryPicker()}</div>
  if (view === 'preview') return <div className="admin-course-workspace"><PreviewContent course={course} onBack={() => previewFromList ? backToList() : setView('builder')} onEdit={() => { setView('builder'); setStep(1); setPreviewFromList(false) }} onSave={saveCourse} isSaving={isSaving} error={error} /></div>

  return (
    <div className="admin-course-workspace">
      <div className="ac-builder-title-row ac-builder-title-row--steps-only">
        <StepIndicator step={step} onStep={(nextStep) => nextStep <= step && enterStep(nextStep)} />
      </div>
      <section className={`ac-builder-surface${step === 2 ? ' ac-builder-surface--content' : ''}`}>
        {step === 1 ? renderDetailsStep() : step === 2 ? renderContentStep() : step === 3 ? renderSettingsStep() : <PreviewContent course={course} onBack={() => enterStep(3)} onEdit={() => enterStep(1)} onSave={saveCourse} isSaving={isSaving} error={error} />}
      </section>
    </div>
  )
}