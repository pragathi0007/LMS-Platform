import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLessons, normalizeArray } from '../utils/course-validation.js'
import { calculateCourseProgress } from '../utils/course-progress.js'
import { hideQuizAnswers } from '../routes/learning.js'

test('normalizeLessons handles standard array', () => {
  const lessons = [{ _id: '1', title: 'Lesson 1' }, { _id: '2', title: 'Lesson 2' }]
  const result = normalizeLessons(lessons)
  assert.deepEqual(result, lessons)
})

test('normalizeLessons handles empty array, null, undefined', () => {
  assert.deepEqual(normalizeLessons([]), [])
  assert.deepEqual(normalizeLessons(null), [])
  assert.deepEqual(normalizeLessons(undefined), [])
})

test('normalizeLessons handles empty object without crashing', () => {
  assert.deepEqual(normalizeLessons({}), [])
})

test('normalizeLessons extracts lessons from object with numeric keys', () => {
  const objectLessons = {
    '1': { _id: '2', title: 'Lesson Two', order: 1 },
    '0': { _id: '1', title: 'Lesson One', order: 0 },
  }
  const result = normalizeLessons(objectLessons)
  assert.equal(result.length, 2)
  assert.equal(result[0].title, 'Lesson One')
  assert.equal(result[1].title, 'Lesson Two')
})

test('normalizeLessons extracts lessons from object with custom keys and preserves order', () => {
  const customKeyLessons = {
    les_b: { _id: 'b', title: 'Second', order: 2 },
    les_a: { _id: 'a', title: 'First', order: 1 },
  }
  const result = normalizeLessons(customKeyLessons)
  assert.equal(result.length, 2)
  assert.equal(result[0].title, 'First')
  assert.equal(result[1].title, 'Second')
})

test('normalizeLessons handles single lesson object', () => {
  const single = { _id: 'single1', title: 'Single Lesson', videoUrl: 'https://example.com/v.mp4' }
  const result = normalizeLessons(single)
  assert.deepEqual(result, [single])
})

test('normalizeLessons parses JSON string', () => {
  const json = JSON.stringify([{ _id: 'json1', title: 'Parsed Lesson' }])
  const result = normalizeLessons(json)
  assert.equal(result.length, 1)
  assert.equal(result[0].title, 'Parsed Lesson')
})

test('normalizeLessons returns empty array for non-array non-object primitives', () => {
  assert.deepEqual(normalizeLessons(123), [])
  assert.deepEqual(normalizeLessons(true), [])
  assert.deepEqual(normalizeLessons('invalid string'), [])
})

test('normalizeArray handles arrays, objects with numeric keys, single objects, and empty objects', () => {
  assert.deepEqual(normalizeArray([1, 2]), [1, 2])
  assert.deepEqual(normalizeArray([]), [])
  assert.deepEqual(normalizeArray(null), [])
  assert.deepEqual(normalizeArray(undefined), [])
  assert.deepEqual(normalizeArray({}), [])
  assert.deepEqual(normalizeArray({ '0': { a: 1 }, '1': { a: 2 } }), [{ a: 1 }, { a: 2 }])
  assert.deepEqual(normalizeArray({ a: 1 }), [{ a: 1 }])
})

test('hideQuizAnswers safely normalizes courses with non-array lessons', () => {
  const courseWithNonArrayLessons = {
    _id: '68a000000000000000000001',
    title: 'Test Course',
    modules: [
      {
        _id: '68a000000000000000000002',
        title: 'Module with empty object lessons',
        lessons: {},
      },
      {
        _id: '68a000000000000000000003',
        title: 'Module with dictionary lessons',
        lessons: {
          '0': {
            _id: '68a000000000000000000004',
            title: 'Lesson from dict',
            attentionCheck: { enabled: false },
          },
        },
      },
      {
        _id: '68a000000000000000000005',
        title: 'Module with undefined lessons',
      },
    ],
  }

  const sanitized = hideQuizAnswers(courseWithNonArrayLessons)
  assert.ok(Array.isArray(sanitized.modules))
  assert.ok(Array.isArray(sanitized.modules[0].lessons))
  assert.equal(sanitized.modules[0].lessons.length, 0)
  assert.ok(Array.isArray(sanitized.modules[1].lessons))
  assert.equal(sanitized.modules[1].lessons.length, 1)
  assert.equal(sanitized.modules[1].lessons[0].title, 'Lesson from dict')
  assert.ok(Array.isArray(sanitized.modules[2].lessons))
  assert.equal(sanitized.modules[2].lessons.length, 0)
})

test('calculateCourseProgress does not crash when module.lessons is an empty object or object map', () => {
  const courseWithEmptyObjectLessons = {
    _id: '68a000000000000000000010',
    title: 'Test Course with Object Lessons',
    generateCertificate: true,
    modules: [
      {
        _id: '68a000000000000000000011',
        title: 'Module 1',
        lessons: {}, // Object instead of Array
        contentItems: [],
      },
      {
        _id: '68a000000000000000000012',
        title: 'Module 2',
        lessons: {
          '0': {
            _id: '68a000000000000000000013',
            title: 'Lesson in Object',
            requiredForCertificate: true,
          },
        },
        contentItems: [],
      },
    ],
  }

  const enrollment = {
    _id: '68a000000000000000000020',
    completedLessonIds: ['68a000000000000000000013'],
  }

  const progress = calculateCourseProgress({
    course: courseWithEmptyObjectLessons,
    enrollment,
    quizAttempts: [],
    assignmentSubmissions: [],
  })

  assert.equal(typeof progress, 'object')
  assert.equal(progress.completedActivities, 1)
  assert.equal(progress.totalActivities, 1)
  assert.equal(progress.isComplete, true)
})
