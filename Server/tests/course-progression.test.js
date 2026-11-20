import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  getCourseActivityProgression,
  getCourseActivitySequence,
} from '../utils/course-progress.js'

const ids = {
  firstVideo: '68a000000000000000000101',
  firstQuizItem: '68a000000000000000000102',
  firstQuiz: '68a000000000000000000103',
  secondVideo: '68a000000000000000000104',
  assignment: '68a000000000000000000105',
  finalVideo: '68a000000000000000000106',
}

function orderedCourse() {
  return {
    modules: [
      {
        order: 2,
        lessons: [{ _id: '68a000000000000000000108', order: 1 }],
        contentItems: [
          { _id: ids.finalVideo, type: 'video-lesson', order: 1 },
        ],
      },
      {
        order: 1,
        contentItems: [
          { _id: ids.secondVideo, type: 'video-lesson', order: 3 },
          { _id: ids.assignment, type: 'assignment', order: 4 },
          { _id: ids.firstQuizItem, type: 'quiz', order: 2, quiz: { _id: ids.firstQuiz } },
          { _id: ids.firstVideo, type: 'video-lesson', order: 1 },
          { _id: '68a000000000000000000107', type: 'note', order: 5 },
        ],
      },
    ],
  }
}

test('course activity sequence follows configured module and content item order', () => {
  assert.deepEqual(getCourseActivitySequence(orderedCourse()).map(({ type, id }) => ({ type, id })), [
    { type: 'video-lesson', id: ids.firstVideo },
    { type: 'quiz', id: ids.firstQuiz },
    { type: 'video-lesson', id: ids.secondVideo },
    { type: 'assignment', id: ids.assignment },
    { type: 'video-lesson', id: ids.finalVideo },
  ])
})

test('only the first incomplete activity is unlocked; submitted assignments unlock the next activity', () => {
  const course = orderedCourse()
  const base = {
    course,
    enrollment: { completedLessonIds: [ids.firstVideo] },
    quizAttempts: [{ quizId: ids.firstQuiz, status: 'submitted', passed: true }],
    assignmentSubmissions: [{ assignmentId: ids.assignment, reviewStatus: 'pending' }],
  }

  let progression = getCourseActivityProgression(base)
  assert.equal(progression.nextActivity.id, ids.secondVideo)
  assert.equal(progression.activities.find(({ id }) => id === ids.firstVideo).completed, true)
  assert.equal(progression.activities.find(({ id }) => id === ids.assignment).completed, true)

  progression = getCourseActivityProgression({
    ...base,
    enrollment: { completedLessonIds: [ids.firstVideo, ids.secondVideo] },
  })
  assert.equal(progression.nextActivity.id, ids.finalVideo)

  progression = getCourseActivityProgression({
    ...base,
    enrollment: { completedLessonIds: [ids.firstVideo, ids.secondVideo, ids.finalVideo] },
  })
  assert.equal(progression.nextActivity, null)
})

test('failed quizzes block progression while any assignment submission permits moving forward', () => {
  const progression = getCourseActivityProgression({
    course: orderedCourse(),
    enrollment: { completedLessonIds: [ids.firstVideo] },
    quizAttempts: [{ quizId: ids.firstQuiz, status: 'submitted', passed: false }],
    assignmentSubmissions: [
      { assignmentId: ids.assignment, reviewStatus: 'approved', submittedAt: new Date('2026-01-01T00:00:00Z') },
      { assignmentId: ids.assignment, reviewStatus: 'pending', submittedAt: new Date('2026-01-02T00:00:00Z') },
    ],
  })

  assert.equal(progression.nextActivity.id, ids.firstQuiz)
  assert.equal(progression.activities.find(({ id }) => id === ids.assignment).completed, true)
})
