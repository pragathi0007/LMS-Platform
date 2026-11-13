import assert from 'node:assert/strict'
import { test } from 'node:test'
import AssignmentSubmission from '../models/AssignmentSubmission.js'
import Certificate from '../models/Certificate.js'
import CertificateTemplate from '../models/CertificateTemplate.js'
import QuizAttempt from '../models/QuizAttempt.js'
import {
  evaluateCertificateEligibility,
  generateCertificatePdf,
  getRequiredCertificateActivities,
  issueCertificateIfEligible,
} from '../utils/certificates.js'
import { normalizeCourseDetails } from '../utils/course-validation.js'

function queryResult(value) {
  const result = Promise.resolve(value)
  result.select = () => result
  result.sort = () => result
  result.lean = () => result
  return result
}

function stub(target, name, implementation) {
  const original = target[name]
  target[name] = implementation
  return () => { target[name] = original }
}

test('required certificate activities include legacy and content item structures and preserve optional flags', () => {
  const course = {
    modules: [
      {
        lessons: [
          { _id: '68a000000000000000000001', title: 'Legacy video' },
          { _id: '68a000000000000000000002', title: 'Optional legacy video', requiredForCertificate: false },
        ],
        quiz: {
          _id: '68a000000000000000000003',
          title: 'Legacy quiz',
          questions: [{ prompt: 'Question' }],
        },
      },
      {
        lessons: [{ _id: '68a000000000000000000004', title: 'Mirrored legacy video' }],
        contentItems: [
          { _id: '68a000000000000000000004', type: 'video-lesson', title: 'Video item' },
          {
            _id: '68a000000000000000000005',
            type: 'quiz',
            title: 'Optional item quiz',
            requiredForCertificate: false,
            quiz: { _id: '68a000000000000000000005', questions: [{ prompt: 'Question' }] },
          },
          { _id: '68a000000000000000000006', type: 'assignment', title: 'Assignment item' },
        ],
      },
    ],
    quizzes: [{
      _id: '68a000000000000000000007',
      title: 'Course quiz',
      questions: [{ prompt: 'Question' }],
    }],
    assignments: [{
      _id: '68a000000000000000000008',
      title: 'Course assignment',
    }],
  }

  const activities = getRequiredCertificateActivities(course)
  assert.deepEqual(activities.videos.map(({ id }) => id), [
    '68a000000000000000000001',
    '68a000000000000000000004',
  ])
  assert.deepEqual(activities.quizzes.map(({ id }) => id), [
    '68a000000000000000000003',
    '68a000000000000000000007',
  ])
  assert.deepEqual(activities.assignments.map(({ id }) => id), [
    '68a000000000000000000006',
    '68a000000000000000000008',
  ])
})

test('course validation defaults existing activity requirements to required and preserves opt-outs', () => {
  const result = normalizeCourseDetails({
    title: 'Requirement course',
    modules: [{
      title: 'Module',
      lessons: [{ _id: '68a000000000000000000041', title: 'Legacy video' }],
      quiz: {
        _id: '68a000000000000000000042',
        title: 'Legacy quiz',
        questions: [{
          prompt: 'Question',
          options: ['A', 'B'],
          correctOptionIndices: [0],
        }],
      },
      contentItems: [
        { _id: '68a000000000000000000043', type: 'video-lesson', title: 'Content video' },
        {
          _id: '68a000000000000000000044',
          type: 'quiz',
          title: 'Optional quiz',
          requiredForCertificate: false,
          quiz: {
            _id: '68a000000000000000000044',
            title: 'Optional quiz',
            questions: [{
              prompt: 'Question',
              options: ['A', 'B'],
              correctOptionIndices: [1],
            }],
          },
        },
        { _id: '68a000000000000000000045', type: 'assignment', title: 'Content assignment' },
      ],
    }],
    assignments: [{ _id: '68a000000000000000000046', title: 'Legacy assignment' }],
    quizzes: [{
      _id: '68a000000000000000000047',
      title: 'Optional course quiz',
      requiredForCertificate: false,
      questions: [{
        prompt: 'Question',
        options: ['A', 'B'],
        correctOptionIndex: 0,
      }],
    }],
  })

  assert.equal(result.error, undefined)
  assert.equal(result.value.generateCertificate, true)
  assert.equal(result.value.modules[0].lessons[0].requiredForCertificate, true)
  assert.equal(result.value.modules[0].quiz.requiredForCertificate, true)
  assert.equal(result.value.modules[0].contentItems[0].requiredForCertificate, true)
  assert.equal(result.value.modules[0].contentItems[1].requiredForCertificate, false)
  assert.equal(result.value.modules[0].contentItems[2].requiredForCertificate, true)
  assert.equal(result.value.assignments[0].requiredForCertificate, true)
  assert.equal(result.value.quizzes[0].requiredForCertificate, false)

  const disabled = normalizeCourseDetails({ title: 'Disabled certificates', generateCertificate: false })
  assert.equal(disabled.value.generateCertificate, false)
  assert.match(normalizeCourseDetails({ title: 'Invalid certificates', generateCertificate: 'false' }).error, /certificates are enabled/)
})

test('disabled course certificates remain locked and are never issued', async () => {
  const course = {
    _id: '68a000000000000000000051',
    title: 'Certificate-disabled course',
    generateCertificate: false,
    modules: [],
  }
  const enrollment = { _id: '68a000000000000000000052', userId: '68a000000000000000000053' }
  const restoreFind = stub(Certificate, 'findOne', () => {
    throw new Error('Disabled course certificates must not query or issue existing certificates.')
  })

  try {
    const eligibility = await evaluateCertificateEligibility({ course, enrollment })
    assert.equal(eligibility.eligible, false)
    assert.equal(eligibility.pendingRequirements[0].status, 'disabled')
    assert.equal(await issueCertificateIfEligible({
      userId: enrollment.userId,
      studentName: 'Ada Lovelace',
      enrollment,
      course,
      eligibility: { eligible: true, activities: { videos: [], quizzes: [], assignments: [] } },
    }), null)
  } finally {
    restoreFind()
  }
})

test('certificate eligibility requires completed videos, a passed quiz, and an approved latest assignment', async () => {
  const studentId = '68a000000000000000000011'
  const courseId = '68a000000000000000000012'
  const enrollmentId = '68a000000000000000000013'
  const videoId = '68a000000000000000000014'
  const quizId = '68a000000000000000000015'
  const assignmentId = '68a000000000000000000016'
  const course = {
    _id: courseId,
    title: 'Required activity course',
    modules: [{
      contentItems: [
        { _id: videoId, type: 'video-lesson', title: 'Required video' },
        { _id: '68a000000000000000000017', type: 'quiz', title: 'Required quiz', quiz: { _id: quizId, questions: [{ prompt: 'Q' }] } },
        { _id: assignmentId, type: 'assignment', title: 'Required assignment' },
      ],
    }],
  }
  const enrollment = { _id: enrollmentId, userId: studentId, completedLessonIds: [] }
  let latestAttempt = []
  let latestSubmission = [{ assignmentId, reviewStatus: 'pending', submittedAt: new Date() }]
  const restoreQuizFind = stub(QuizAttempt, 'find', () => queryResult(latestAttempt))
  const restoreSubmissionFind = stub(AssignmentSubmission, 'find', () => queryResult(latestSubmission))

  try {
    const locked = await evaluateCertificateEligibility({ course, enrollment })
    assert.equal(locked.eligible, false)
    assert.deepEqual(locked.pendingRequirements.map(({ type, status }) => `${type}:${status}`), [
      'video:incomplete',
      'quiz:not-passed',
      'assignment:awaiting-review',
    ])
    assert.deepEqual(locked.pendingRequirements.map(({ id }) => id), [videoId, quizId, assignmentId])

    latestSubmission = [{ assignmentId, reviewStatus: 'rejected', submittedAt: new Date() }]
    const rejected = await evaluateCertificateEligibility({ course, enrollment })
    assert.equal(
      rejected.pendingRequirements.find((requirement) => requirement.type === 'assignment')?.status,
      'resubmit',
    )

    latestAttempt = [{ quizId }]
    latestSubmission = [{ assignmentId, reviewStatus: 'approved', submittedAt: new Date() }]
    const unlocked = await evaluateCertificateEligibility({
      course,
      enrollment: { ...enrollment, completedLessonIds: [videoId] },
    })
    assert.equal(unlocked.eligible, true)
    assert.deepEqual(unlocked.pendingRequirements, [])
  } finally {
    restoreSubmissionFind()
    restoreQuizFind()
  }
})

test('video completion alone cannot issue a certificate when no required assessment exists', async () => {
  const restoreQuizFind = stub(QuizAttempt, 'find', () => {
    throw new Error('No quiz query is expected')
  })
  const restoreSubmissionFind = stub(AssignmentSubmission, 'find', () => {
    throw new Error('No assignment query is expected')
  })
  try {
    const eligibility = await evaluateCertificateEligibility({
      course: {
        _id: '68a000000000000000000021',
        modules: [{ lessons: [{ _id: '68a000000000000000000022', title: 'Only video' }] }],
      },
      enrollment: {
        _id: '68a000000000000000000023',
        userId: '68a000000000000000000024',
        completedLessonIds: ['68a000000000000000000022'],
      },
    })
    assert.equal(eligibility.eligible, false)
    assert.equal(eligibility.pendingRequirements[0].status, 'assessment-required')
  } finally {
    restoreSubmissionFind()
    restoreQuizFind()
  }
})

test('certificate issuance snapshots the account name and exact course name and prevents duplicates', async () => {
  const studentId = '68a000000000000000000031'
  const courseId = '68a000000000000000000032'
  const enrollmentId = '68a000000000000000000033'
  const quizId = '68a000000000000000000034'
  const course = {
    _id: courseId,
    title: 'Exact Course Name',
    modules: [{ contentItems: [{
      _id: quizId,
      type: 'quiz',
      title: 'Required quiz',
      quiz: { _id: quizId, questions: [{ prompt: 'Q' }] },
    }] }],
  }
  const enrollment = { _id: enrollmentId, userId: studentId }
  let existing = null
  let insertCount = 0
  let insertedDocument
  const restores = [
    stub(Certificate, 'findOne', () => queryResult(existing)),
    stub(Certificate, 'findOneAndUpdate', (_query, update) => {
      insertCount += 1
      insertedDocument = update.$setOnInsert
      existing = { _id: '68a000000000000000000035', ...insertedDocument }
      return queryResult(existing)
    }),
    stub(CertificateTemplate, 'findById', () => queryResult({ activeTemplateId: 'template-v1' })),
    stub(QuizAttempt, 'find', () => queryResult([{ quizId }])),
  ]

  try {
    const issued = await issueCertificateIfEligible({
      userId: studentId,
      studentName: 'Ada Lovelace',
      enrollment,
      course,
    })
    assert.equal(issued.studentName, 'Ada Lovelace')
    assert.equal(issued.courseName, 'Exact Course Name')
    assert.match(issued.certificateId, /^AIH-\d{4}-[A-F0-9]{12}$/)
    assert.equal(insertedDocument.enrollmentId, enrollmentId)
    assert.equal(insertedDocument.templateId, 'template-v1')
    assert.equal(insertCount, 1)

    const existingAfterCourseChange = await issueCertificateIfEligible({
      userId: studentId,
      studentName: 'Changed Name',
      enrollment,
      course: { ...course, title: 'Changed course title', modules: [] },
    })
    assert.equal(existingAfterCourseChange.studentName, 'Ada Lovelace')
    assert.equal(existingAfterCourseChange.courseName, 'Exact Course Name')
    assert.equal(insertCount, 1)
  } finally {
    restores.reverse().forEach((restore) => restore())
  }
})

test('certificate PDF is generated as a valid landscape PDF', async () => {
  const pdf = await generateCertificatePdf({
    studentName: 'Ada Lovelace',
    courseName: 'Mathematics',
    completedAt: new Date('2025-03-15T00:00:00.000Z'),
    certificateId: 'AIH-2025-ABCDEF012345',
  })
  assert.ok(Buffer.isBuffer(pdf))
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-')
  assert.ok(pdf.length > 2000)
})
