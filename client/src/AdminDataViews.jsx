import React, { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

async function adminRequest(path, onLogout, options = {}) {
  const savedAuth = sessionStorage.getItem('lms.auth')
  const auth = savedAuth ? JSON.parse(savedAuth) : null
  if (auth?.user?.role !== 'main_admin' || typeof auth.token !== 'string') {
    onLogout()
    throw new Error('Your administrator session has ended.')
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const text = await response.text()
  let result
  try {
    result = text ? JSON.parse(text) : {}
  } catch {
    throw new Error('The server returned an invalid response.')
  }
  if (response.status === 401 || response.status === 403) {
    onLogout()
    throw new Error('Your administrator session has ended.')
  }
  return { response, result }
}

function AdminDataPanel({ eyebrow, title, description, children }) {
  return (
    <section className="admin-panel admin-view-panel">
      <div className="admin-page-heading admin-page-heading--compact">
        <div><p className="admin-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      </div>
      {children}
    </section>
  )
}

export function CollegesManagement({ onLogout }) {
  const [colleges, setColleges] = useState([])
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingAccountId, setPendingAccountId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  async function loadColleges() {
    setLoadError('')
    try {
      const { response, result } = await adminRequest('/admin/colleges', onLogout)
      if (!response.ok) throw new Error(result.message || 'Unable to load colleges.')
      setColleges(result.colleges || [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load colleges.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadColleges() }, [])

  async function submitCollege(event) {
    event.preventDefault()
    setIsSaving(true)
    setFormError('')
    setMessage('')
    try {
      const form = event.currentTarget
      const payload = Object.fromEntries(new FormData(form).entries())
      const { response, result } = await adminRequest('/admin/colleges', onLogout, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(result.message || 'Unable to create the college.')
      form.reset()
      setMessage(`College created with ID ${result.college.id}.`)
      await loadColleges()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to create the college.')
    } finally {
      setIsSaving(false)
    }
  }

  async function sendSubAdmin(event) {
    event.preventDefault()
    setIsSaving(true)
    setFormError('')
    setMessage('')
    setPendingAccountId('')
    try {
      const form = event.currentTarget
      const data = Object.fromEntries(new FormData(form).entries())
      const { response, result } = await adminRequest(
        `/admin/colleges/${encodeURIComponent(data.collegeId)}/sub-admins`,
        onLogout,
        { method: 'POST', body: JSON.stringify(data) },
      )
      if (!response.ok) {
        if (result.accountId) setPendingAccountId(result.accountId)
        throw new Error(result.message || 'Unable to create the sub-admin account.')
      }
      form.reset()
      setMessage(result.message)
      await loadColleges()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to create the sub-admin account.')
    } finally {
      setIsSaving(false)
    }
  }

  async function resendActivation() {
    setIsSaving(true)
    setFormError('')
    setMessage('')
    try {
      const { response, result } = await adminRequest(
        `/admin/college-admins/${encodeURIComponent(pendingAccountId)}/activation`,
        onLogout,
        { method: 'POST' },
      )
      if (!response.ok) throw new Error(result.message || 'Unable to send the activation email.')
      setMessage(result.message)
      setPendingAccountId('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to send the activation email.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AdminDataPanel
      eyebrow="COLLEGE MANAGEMENT"
      title="Colleges"
      description="Create colleges and invite sub-admins. Accounts are stored in their designated collections."
    >
      <div className="admin-data-grid">
        <form className="admin-data-form" onSubmit={submitCollege}>
          <h2>Create a college</h2>
          <label><span>College name</span><input name="name" maxLength="200" required /></label>
          <label><span>College code</span><input name="code" minLength="2" maxLength="40" pattern="[A-Za-z0-9-]{2,40}" required /></label>
          <label><span>Address</span><input name="address" maxLength="500" /></label>
          <div className="admin-data-form__columns">
            <label><span>City</span><input name="city" maxLength="120" /></label>
            <label><span>State / region</span><input name="state" maxLength="120" /></label>
          </div>
          <div className="admin-data-form__columns">
            <label><span>Country</span><input name="country" maxLength="120" /></label>
            <label><span>Contact email</span><input name="contactEmail" type="email" maxLength="254" /></label>
          </div>
          <div className="admin-data-form__columns">
            <label><span>Contact name</span><input name="contactName" maxLength="120" /></label>
            <label><span>Contact phone</span><input name="contactPhone" maxLength="40" /></label>
          </div>
          <button className="admin-button admin-button--primary" disabled={isSaving}>Create college</button>
        </form>

        <form className="admin-data-form" onSubmit={sendSubAdmin}>
          <h2>Invite a college sub-admin</h2>
          <p>They set their own password through a single-use link that expires after 24 hours.</p>
          <label>
            <span>College</span>
            <select name="collegeId" required disabled={isLoading || colleges.length === 0}>
              <option value="">Select a college</option>
              {colleges.map((college) => <option key={college.id} value={college.id}>{college.name}</option>)}
            </select>
          </label>
          <label><span>Full name</span><input name="fullName" maxLength="120" required /></label>
          <label><span>Email</span><input name="email" type="email" maxLength="254" required /></label>
          <label><span>Username</span><input name="username" minLength="3" maxLength="30" pattern="[A-Za-z0-9._-]{3,30}" required /></label>
          <button className="admin-button admin-button--primary" disabled={isSaving || isLoading || !colleges.length}>
            Create account and send activation
          </button>
        </form>
      </div>
      {loadError && <p className="admin-inline-error" role="alert">{loadError}</p>}
      {formError && <p className="admin-inline-error" role="alert">{formError}</p>}
      {pendingAccountId && (
        <div className="admin-import-result" role="status">
          <p>Account {pendingAccountId} is pending activation. Configure SMTP and retry delivery.</p>
          <button className="admin-button admin-button--secondary" type="button" onClick={resendActivation} disabled={isSaving}>
            Retry activation email
          </button>
        </div>
      )}
      {message && <p className="admin-import-result" role="status">{message}</p>}
      <div className="admin-college-list">
        <h2>Existing colleges</h2>
        {isLoading ? <p className="admin-loading">Loading colleges…</p> : colleges.length === 0
          ? <p>No colleges have been added.</p>
          : colleges.map((college) => (
            <div className="admin-college-list__item" key={college.id}>
              <strong>{college.name}</strong><code>{college.id}</code>
            </div>
          ))}
      </div>
    </AdminDataPanel>
  )
}

function emptyModule() {
  return { title: '', description: '', lessons: [{ title: '', content: '', videoUrl: '' }] }
}

function emptyAssignment() {
  return { title: '', description: '', dueDate: '', points: 0 }
}

function emptyQuiz() {
  return {
    title: '',
    description: '',
    questions: [{ prompt: '', optionsText: '\n', correctOptionIndex: 0 }],
  }
}

export function CourseManagement({ onLogout }) {
  const [courses, setCourses] = useState([])
  const [modules, setModules] = useState([emptyModule()])
  const [assignments, setAssignments] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  async function loadCourses() {
    const { response, result } = await adminRequest('/admin/courses', onLogout)
    if (!response.ok) throw new Error(result.message || 'Unable to load courses.')
    setCourses(result.courses || [])
  }

  useEffect(() => {
    loadCourses().catch((loadError) => setError(loadError.message))
  }, [])

  function updateModule(moduleIndex, field, value) {
    setModules((current) => current.map((module, index) => (
      index === moduleIndex ? { ...module, [field]: value } : module
    )))
  }

  function updateLesson(moduleIndex, lessonIndex, field, value) {
    setModules((current) => current.map((module, index) => index !== moduleIndex ? module : {
      ...module,
      lessons: module.lessons.map((lesson, lessonPosition) => (
        lessonPosition === lessonIndex ? { ...lesson, [field]: value } : lesson
      )),
    }))
  }

  function updateAssignment(assignmentIndex, field, value) {
    setAssignments((current) => current.map((assignment, index) => (
      index === assignmentIndex ? { ...assignment, [field]: value } : assignment
    )))
  }

  function updateQuiz(quizIndex, field, value) {
    setQuizzes((current) => current.map((quiz, index) => (
      index === quizIndex ? { ...quiz, [field]: value } : quiz
    )))
  }

  function updateQuizQuestion(quizIndex, questionIndex, field, value) {
    setQuizzes((current) => current.map((quiz, index) => index !== quizIndex ? quiz : {
      ...quiz,
      questions: quiz.questions.map((question, position) => (
        position === questionIndex ? { ...question, [field]: value } : question
      )),
    }))
  }

  async function saveCourse(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsSaving(true)
    try {
      const form = event.currentTarget
      const values = new FormData(form)
      const payload = {
        title: values.get('title'),
        description: values.get('description'),
        status: values.get('status'),
        modules: modules.map((module) => ({
          ...module,
          lessons: module.lessons.filter((lesson) => lesson.title.trim()),
        })).filter((module) => module.title.trim()),
        assignments: assignments.filter((assignment) => assignment.title.trim()),
        quizzes: quizzes.filter((quiz) => quiz.title.trim()).map((quiz) => ({
          title: quiz.title,
          description: quiz.description,
          questions: quiz.questions.filter((question) => question.prompt.trim()).map((question) => ({
            prompt: question.prompt,
            options: question.optionsText.split(/\r?\n/).map((option) => option.trim()).filter(Boolean),
            correctOptionIndex: Number(question.correctOptionIndex),
          })),
        })),
      }
      const { response, result } = await adminRequest('/admin/courses', onLogout, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(result.message || 'Unable to save the course.')
      form.reset()
      setModules([emptyModule()])
      setAssignments([])
      setQuizzes([])
      setMessage(result.message)
      await loadCourses()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the course.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AdminDataPanel eyebrow="COURSE MANAGEMENT" title="Courses" description="Create courses with modules and lessons. Published courses are available for enrollment.">
      <form className="admin-data-form admin-course-form" onSubmit={saveCourse}>
        <h2>Create a course</h2>
        <label><span>Title</span><input name="title" maxLength="200" required /></label>
        <label><span>Description</span><textarea name="description" rows="3" maxLength="10000" /></label>
        <label><span>Status</span><select name="status"><option value="draft">Draft</option><option value="published">Published</option></select></label>
        {modules.map((module, moduleIndex) => (
          <fieldset className="admin-course-module" key={moduleIndex}>
            <legend>Module {moduleIndex + 1}</legend>
            <label><span>Module title</span><input value={module.title} maxLength="200" onChange={(event) => updateModule(moduleIndex, 'title', event.target.value)} /></label>
            <label><span>Module description</span><input value={module.description} maxLength="2000" onChange={(event) => updateModule(moduleIndex, 'description', event.target.value)} /></label>
            {module.lessons.map((lesson, lessonIndex) => (
              <div className="admin-course-lesson" key={lessonIndex}>
                <label><span>Lesson title</span><input value={lesson.title} maxLength="200" onChange={(event) => updateLesson(moduleIndex, lessonIndex, 'title', event.target.value)} /></label>
                <label><span>Lesson content</span><textarea rows="2" maxLength="20000" value={lesson.content} onChange={(event) => updateLesson(moduleIndex, lessonIndex, 'content', event.target.value)} /></label>
                <label><span>Video URL</span><input type="url" maxLength="2048" value={lesson.videoUrl} onChange={(event) => updateLesson(moduleIndex, lessonIndex, 'videoUrl', event.target.value)} /></label>
                {module.lessons.length > 1 && <button className="admin-text-button" type="button" onClick={() => updateModule(moduleIndex, 'lessons', module.lessons.filter((_, index) => index !== lessonIndex))}>Remove lesson</button>}
              </div>
            ))}
            <div className="admin-data-form__actions">
              <button className="admin-button admin-button--secondary" type="button" onClick={() => updateModule(moduleIndex, 'lessons', [...module.lessons, { title: '', content: '', videoUrl: '' }])}>Add lesson</button>
              {modules.length > 1 && <button className="admin-text-button" type="button" onClick={() => setModules((current) => current.filter((_, index) => index !== moduleIndex))}>Remove module</button>}
            </div>
          </fieldset>
        ))}
        <fieldset className="admin-course-module">
          <legend>Assignments</legend>
          {assignments.map((assignment, assignmentIndex) => (
            <div className="admin-course-lesson" key={assignmentIndex}>
              <label><span>Assignment title</span><input value={assignment.title} maxLength="200" onChange={(event) => updateAssignment(assignmentIndex, 'title', event.target.value)} /></label>
              <label><span>Description</span><textarea rows="2" maxLength="10000" value={assignment.description} onChange={(event) => updateAssignment(assignmentIndex, 'description', event.target.value)} /></label>
              <div className="admin-data-form__columns">
                <label><span>Due date</span><input type="date" value={assignment.dueDate} onChange={(event) => updateAssignment(assignmentIndex, 'dueDate', event.target.value)} /></label>
                <label><span>Points</span><input type="number" min="0" value={assignment.points} onChange={(event) => updateAssignment(assignmentIndex, 'points', event.target.value)} /></label>
              </div>
              <button className="admin-text-button" type="button" onClick={() => setAssignments((current) => current.filter((_, index) => index !== assignmentIndex))}>Remove assignment</button>
            </div>
          ))}
          <button className="admin-button admin-button--secondary" type="button" onClick={() => setAssignments((current) => [...current, emptyAssignment()])}>Add assignment</button>
        </fieldset>
        <fieldset className="admin-course-module">
          <legend>Quizzes</legend>
          {quizzes.map((quiz, quizIndex) => (
            <div className="admin-course-lesson" key={quizIndex}>
              <label><span>Quiz title</span><input value={quiz.title} maxLength="200" onChange={(event) => updateQuiz(quizIndex, 'title', event.target.value)} /></label>
              <label><span>Description</span><textarea rows="2" maxLength="10000" value={quiz.description} onChange={(event) => updateQuiz(quizIndex, 'description', event.target.value)} /></label>
              {quiz.questions.map((question, questionIndex) => (
                <div className="admin-course-lesson" key={questionIndex}>
                  <label><span>Question</span><input value={question.prompt} maxLength="2000" onChange={(event) => updateQuizQuestion(quizIndex, questionIndex, 'prompt', event.target.value)} /></label>
                  <label><span>Options (one per line)</span><textarea rows="3" maxLength="5000" value={question.optionsText} onChange={(event) => updateQuizQuestion(quizIndex, questionIndex, 'optionsText', event.target.value)} /></label>
                  <label><span>Correct option number (starting at 0)</span><input type="number" min="0" max="9" value={question.correctOptionIndex} onChange={(event) => updateQuizQuestion(quizIndex, questionIndex, 'correctOptionIndex', event.target.value)} /></label>
                  {quiz.questions.length > 1 && <button className="admin-text-button" type="button" onClick={() => updateQuiz(quizIndex, 'questions', quiz.questions.filter((_, index) => index !== questionIndex))}>Remove question</button>}
                </div>
              ))}
              <button className="admin-button admin-button--secondary" type="button" onClick={() => updateQuiz(quizIndex, 'questions', [...quiz.questions, { prompt: '', optionsText: '\n', correctOptionIndex: 0 }])}>Add question</button>
              <button className="admin-text-button" type="button" onClick={() => setQuizzes((current) => current.filter((_, index) => index !== quizIndex))}>Remove quiz</button>
            </div>
          ))}
          <button className="admin-button admin-button--secondary" type="button" onClick={() => setQuizzes((current) => [...current, emptyQuiz()])}>Add quiz</button>
        </fieldset>
        <div className="admin-data-form__actions">
          <button className="admin-button admin-button--secondary" type="button" onClick={() => setModules((current) => [...current, emptyModule()])}>Add module</button>
          <button className="admin-button admin-button--primary" type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save course'}</button>
        </div>
      </form>
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
      {message && <p className="admin-import-result" role="status">{message}</p>}
      <div className="admin-college-list">
        <h2>Saved courses</h2>
        {courses.length === 0 ? <p>No courses have been created.</p> : courses.map((course) => (
          <div className="admin-college-list__item" key={course._id}>
            <strong>{course.title}</strong>
            <span>{course.modules?.length || 0} modules · {course.modules?.reduce((total, module) => total + (module.lessons?.length || 0), 0) || 0} lessons · {course.status}</span>
          </div>
        ))}
      </div>
    </AdminDataPanel>
  )
}

export function EnrollmentManagement({ onLogout }) {
  const [enrollments, setEnrollments] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    adminRequest('/admin/enrollments', onLogout)
      .then(({ response, result }) => {
        if (!response.ok) throw new Error(result.message || 'Unable to load enrollments.')
        setEnrollments(result.enrollments || [])
      })
      .catch((loadError) => setError(loadError.message))
  }, [])

  return (
    <AdminDataPanel eyebrow="COURSE MANAGEMENT" title="Enrollments" description="Enrollment records saved in the enrollment collection.">
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
      {!error && enrollments.length === 0
        ? <p>No enrollment records have been created.</p>
        : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Student</th><th>Course</th><th>College</th><th>Status</th></tr></thead>
              <tbody>{enrollments.map((entry) => (
                <tr key={entry._id}>
                  <td>{entry.userId?.fullName || entry.userId?.email || 'Unknown student'}</td>
                  <td>{entry.courseId?.title || 'Unknown course'}</td>
                  <td>{entry.collegeId?.name || 'Independent'}</td>
                  <td>{entry.status}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
    </AdminDataPanel>
  )
}
