import React, { useEffect, useRef, useState } from 'react'
import { isInvalidSessionResponse } from './auth-session.js'
import { buildQuizSubmissionAnswers, getQuestionKey } from './student-quiz-answers.js'
import { API_BASE_URL } from './api-base-url.js'

function getQuizAttempts(quizId, attempts) {
  return attempts.filter((attempt) => String(attempt.quizId) === String(quizId))
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

export default function StudentQuizPanel({
  courseId,
  enrollmentId,
  quiz,
  attempts,
  onAttemptAdded,
  onLearningDataChanged,
  onLogout,
  showHeader = true,
}) {
  const quizAttempts = getQuizAttempts(quiz._id, attempts)
  const latestSubmittedAttempt = quizAttempts.find((attempt) => attempt.status !== 'started')
  const savedActiveAttempt = quizAttempts.find((attempt) => attempt.status === 'started')
  const maxAttempts = quiz.maxAttempts || 3
  const [questionSet, setQuestionSet] = useState(() => (
    savedActiveAttempt?.questions?.length
      ? savedActiveAttempt.questions
      : latestSubmittedAttempt?.questions?.length
        ? latestSubmittedAttempt.questions
        : quiz.questions || []
  ))
  const [activeAttempt, setActiveAttempt] = useState(savedActiveAttempt || null)
  const [answers, setAnswers] = useState(() => Object.fromEntries(
    (savedActiveAttempt?.answers || []).map((answer) => [
      getQuestionKey({ _id: answer.questionId }),
      answer.selectedOptionIndices || [],
    ]),
  ))
  const [questionIndex, setQuestionIndex] = useState(0)
  const [view, setView] = useState(savedActiveAttempt ? 'quiz' : latestSubmittedAttempt ? 'results' : 'intro')
  const [secondsRemaining, setSecondsRemaining] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const submitLock = useRef(false)
  const submitRef = useRef(null)
  const timerSubmissionRequested = useRef(false)
  const answersRef = useRef(answers)
  const questions = questionSet
  const questionCount = questions.length
  const currentQuestion = questions[questionIndex]
  const answeredCount = questions.filter((question) => (
    (answers[getQuestionKey(question)] || []).length > 0
  )).length
  const hasAttemptsLeft = quizAttempts.length < maxAttempts
  const latestResult = activeAttempt?.status === 'submitted' ? activeAttempt : latestSubmittedAttempt
  const timeLimitMinutes = activeAttempt?.timeLimitMinutes ?? quiz.timeLimitMinutes ?? 0

  function setAnswer(questionId, optionIndex, multiple) {
    const questionKey = getQuestionKey({ _id: questionId })
    const selected = new Set(multiple ? answersRef.current[questionKey] || [] : [])
    if (multiple && selected.has(optionIndex)) selected.delete(optionIndex)
    else selected.add(optionIndex)
    const next = { ...answersRef.current, [questionKey]: [...selected].sort((a, b) => a - b) }
    answersRef.current = next
    setAnswers(next)
  }

  async function startQuiz() {
    if (!quiz._id) {
      setError('This quiz cannot be started because it has no saved ID.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      const auth = savedAuth ? JSON.parse(savedAuth) : null
      if (typeof auth?.token !== 'string') {
        onLogout()
        return
      }
      const response = await fetch(`${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(quiz._id)}/attempts/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enrollmentId }),
      })
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok) throw new Error(result.message || 'This quiz could not be started.')
      if (!result.attempt?._id || !result.attempt.startedAt) {
        throw new Error('The server did not confirm the quiz attempt start.')
      }
      if (!Array.isArray(result.questions) || !result.questions.length) {
        throw new Error('The server did not return the saved questions for this quiz attempt.')
      }
      setQuestionSet(result.questions)
      setActiveAttempt(result.attempt)
      setAnswers({})
      answersRef.current = {}
      timerSubmissionRequested.current = false
      setQuestionIndex(0)
      setView('quiz')
      onAttemptAdded(result.attempt)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'This quiz could not be started.')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitQuiz({ allowUnanswered = false } = {}) {
    if (!activeAttempt?._id || submitLock.current) return
    submitLock.current = true
    setSubmitting(true)
    setError('')
    const submission = buildQuizSubmissionAnswers(questions, answersRef.current, { allowUnanswered })
    if (submission.error) {
      setError(submission.error)
      submitLock.current = false
      setSubmitting(false)
      return
    }
    const quizAnswers = submission.answers
    try {
      const savedAuth = sessionStorage.getItem('lms.auth')
      const auth = savedAuth ? JSON.parse(savedAuth) : null
      if (typeof auth?.token !== 'string') {
        onLogout()
        return
      }
      const response = await fetch(`${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(quiz._id)}/attempts/${encodeURIComponent(activeAttempt._id)}/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ answers: quizAnswers }),
      })
      const result = await response.json()
      if (isInvalidSessionResponse(response, result)) {
        onLogout()
        return
      }
      if (!response.ok) throw new Error(result.message || 'Your quiz answers could not be submitted.')
      if (!result.attempt?._id || result.attempt.status !== 'submitted') {
        throw new Error('The server did not confirm your quiz submission.')
      }
      setActiveAttempt(result.attempt)
      setView('results')
      onAttemptAdded(result.attempt)
      onLearningDataChanged()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Your quiz answers could not be submitted.')
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }
  submitRef.current = () => submitQuiz({ allowUnanswered: true })

  useEffect(() => {
    if (view !== 'quiz' || !activeAttempt || timeLimitMinutes <= 0) {
      setSecondsRemaining(null)
      return undefined
    }
    const deadline = new Date(activeAttempt.startedAt).getTime() + timeLimitMinutes * 60 * 1000
    const updateTimeRemaining = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecondsRemaining(remaining)
      if (remaining === 0 && !timerSubmissionRequested.current) {
        timerSubmissionRequested.current = true
        void submitRef.current?.()
      }
    }
    updateTimeRemaining()
    const timerId = window.setInterval(updateTimeRemaining, 1000)
    return () => window.clearInterval(timerId)
  }, [activeAttempt, timeLimitMinutes, view])

  function findSavedAnswer(result, question) {
    const questionKey = getQuestionKey(question)
    return result?.answers?.find((answer) => getQuestionKey({ _id: answer.questionId }) === questionKey)
  }

  const correctCount = latestResult?.correctAnswers ?? latestResult?.answers?.filter((answer) => (
    answer.selectedOptionIndices?.length === answer.correctOptionIndices?.length
    && answer.selectedOptionIndices?.every((index, answerIndex) => index === answer.correctOptionIndices[answerIndex])
  )).length ?? 0

  return (
    <section className="student-course-activity student-quiz-experience">
      {showHeader && (
        <header>
          <span className="student-eyebrow">Quiz</span>
          <h2>{quiz.title || 'Quiz'}</h2>
          {quiz.description && <p>{quiz.description}</p>}
        </header>
      )}
      {error && <p className="student-courses__message is-error" role="alert">{error}</p>}

      {view === 'intro' && (
        <div className="student-quiz-intro">
          <p className="student-eyebrow">Before you begin</p>
          <h3>{quiz.title || 'Quiz'}</h3>
          {quiz.description && <p>{quiz.description}</p>}
          <div className="student-quiz-intro__facts">
            <span><small>Questions</small><strong>{questionCount}</strong></span>
            <span><small>Time limit</small><strong>{timeLimitMinutes > 0 ? `${timeLimitMinutes} minutes` : 'No time limit'}</strong></span>
            <span><small>Passing score</small><strong>{quiz.passingPercentage || 70}%</strong></span>
            <span><small>Attempts</small><strong>{maxAttempts} allowed · {maxAttempts - quizAttempts.length} remaining</strong></span>
          </div>
          <button className="student-button" type="button" onClick={startQuiz} disabled={submitting}>
            {submitting ? 'Starting…' : 'Start Quiz'}
          </button>
        </div>
      )}

      {view === 'quiz' && currentQuestion && (
        <div className="student-quiz-running">
          <div className="student-quiz-running__top">
            <span>Question {questionIndex + 1} of {questionCount}</span>
            <strong className={secondsRemaining !== null && secondsRemaining <= 60 ? 'is-urgent' : ''}>
              {secondsRemaining === null ? 'No time limit' : `Time remaining ${formatDuration(secondsRemaining)}`}
            </strong>
          </div>
          <nav className="student-quiz-question-nav" aria-label="Quiz questions">
            {questions.map((question, index) => {
              const isAnswered = (answers[getQuestionKey(question)] || []).length > 0
              return (
                <button
                  key={question._id || index}
                  type="button"
                  className={`${index === questionIndex ? 'is-current' : ''}${isAnswered ? ' is-answered' : ''}`}
                  aria-label={`Question ${index + 1}, ${isAnswered ? 'answered' : 'unanswered'}`}
                  aria-current={index === questionIndex ? 'step' : undefined}
                  onClick={() => setQuestionIndex(index)}
                >
                  {index + 1}
                </button>
              )
            })}
          </nav>
          <div className="student-quiz-running__status">
            <span>{answeredCount} answered</span>
            <span>{questionCount - answeredCount} unanswered</span>
          </div>
          <fieldset className="student-quiz-question">
            <legend>{currentQuestion.prompt}</legend>
            {(currentQuestion.options || []).map((option, optionIndex) => {
              const multiple = currentQuestion.type === 'multiple-select'
              const questionId = getQuestionKey(currentQuestion)
              const selected = (answers[questionId] || []).includes(optionIndex)
              return (
                <label key={`${questionId}-${optionIndex}`} className={selected ? 'is-selected' : ''}>
                  <input
                    type={multiple ? 'checkbox' : 'radio'}
                    name={`quiz-${quiz._id}-question-${questionId}`}
                    checked={selected}
                    onChange={() => setAnswer(questionId, optionIndex, multiple)}
                  />
                  <span>{option}</span>
                </label>
              )
            })}
          </fieldset>
          <div className="student-quiz-running__actions">
            <button type="button" className="student-button student-button--secondary" disabled={questionIndex === 0} onClick={() => setQuestionIndex((index) => index - 1)}>
              Previous
            </button>
            {questionIndex < questionCount - 1 ? (
              <button type="button" className="student-button" onClick={() => setQuestionIndex((index) => index + 1)}>
                Next
              </button>
            ) : (
              <button type="button" className="student-button" onClick={() => void submitQuiz()} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit Quiz'}
              </button>
            )}
          </div>
          <p className="student-quiz-running__hint">You can revisit any question and change your answers before submitting.</p>
        </div>
      )}

      {view === 'results' && latestResult && (
        <div className="student-quiz-results">
          <div className={`student-quiz-results__status${latestResult.passed ? ' is-passed' : ' is-failed'}`}>
            <span>{latestResult.passed ? 'Passed' : 'Failed'}</span>
            <strong>{latestResult.scorePercentage}%</strong>
          </div>
          <div className="student-quiz-results__summary">
            <span><small>Score</small><strong>{correctCount}/{questionCount}</strong></span>
            <span><small>Correct answers</small><strong>{correctCount}</strong></span>
            <span><small>Incorrect answers</small><strong>{latestResult.incorrectAnswers ?? questionCount - correctCount}</strong></span>
            <span><small>Percentage</small><strong>{latestResult.scorePercentage}%</strong></span>
          </div>
          <h3>Answer review</h3>
          <div className="student-quiz-review">
            {questions.map((question, index) => {
              const savedAnswer = findSavedAnswer(latestResult, question)
              const selected = savedAnswer?.selectedOptionIndices || []
              const correct = savedAnswer?.correctOptionIndices || []
              const correctIndices = new Set(correct)
              const selectedIndices = new Set(selected)
              const isCorrect = selected.length === correct.length
                && selected.every((optionIndex) => correctIndices.has(optionIndex))
              return (
                <fieldset key={question._id || index} className="student-quiz-question student-quiz-review__question">
                  <legend>
                    {index + 1}. {question.prompt}{' '}
                    <span className={`student-quiz-review__status${isCorrect ? ' is-correct' : ' is-incorrect'}`}>
                      {isCorrect ? 'Correct' : 'Incorrect'}
                    </span>
                  </legend>
                  {(question.options || []).map((option, optionIndex) => {
                    const wasSelected = selectedIndices.has(optionIndex)
                    const isCorrectOption = correctIndices.has(optionIndex)
                    const isIncorrectSelection = wasSelected && !isCorrectOption
                    const isMissingCorrectOption = !wasSelected && isCorrectOption
                    const optionClassName = [
                      wasSelected ? 'is-selected' : '',
                      isCorrectOption ? 'is-review-correct' : '',
                      isIncorrectSelection ? 'is-review-incorrect' : '',
                    ].filter(Boolean).join(' ')
                    return (
                      <label key={`${question._id || index}-${optionIndex}`} className={optionClassName}>
                        <input
                          type={question.type === 'multiple-select' ? 'checkbox' : 'radio'}
                          checked={wasSelected}
                          disabled
                          readOnly
                        />
                        <span>{option}</span>
                        {isIncorrectSelection && <small className="student-quiz-review__option-status">Your answer · Incorrect</small>}
                        {isMissingCorrectOption && <small className="student-quiz-review__option-status">Correct answer · Missing</small>}
                      </label>
                    )
                  })}
                  {!selected.length && <p className="student-quiz-review__not-answered">Not answered</p>}
                  {savedAnswer?.explanation && <small className="student-quiz-review__explanation">{savedAnswer.explanation}</small>}
                </fieldset>
              )
            })}
          </div>
          <div className="student-quiz-history">
            <h3>Attempt history</h3>
            {quizAttempts.filter((attempt) => attempt.status !== 'started').map((attempt, index, history) => (
              <p key={attempt._id}>Attempt {history.length - index}: {attempt.scorePercentage}% · {attempt.passed ? 'Passed' : 'Failed'}</p>
            ))}
          </div>
          {hasAttemptsLeft && (
            <button className="student-button" type="button" onClick={startQuiz} disabled={submitting}>
              {submitting ? 'Starting…' : 'Retake Quiz'}
            </button>
          )}
        </div>
      )}

      <small className="student-course-activity__attempts">{quizAttempts.length} of {maxAttempts} attempts used</small>
    </section>
  )
}
