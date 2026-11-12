import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildQuizSubmissionAnswers, getQuestionKey } from './student-quiz-answers.js'

test('quiz submission payload includes all ten answers using canonical question IDs', () => {
  const questions = [
    { _id: 'ABCDEF0123456789ABCDEF01', type: 'multiple-choice', options: ['A', 'B'] },
    { _id: 'abcdef0123456789abcdef02', type: 'multiple-select', options: ['A', 'B', 'C'] },
    { _id: 'abcdef0123456789abcdef03', type: 'true-false', options: ['True', 'False'] },
    ...Array.from({ length: 7 }, (_, index) => ({
      _id: `abcdef0123456789abcde${String(index + 4).padStart(3, '0')}`,
      type: 'multiple-choice',
      options: ['A', 'B'],
    })),
  ]
  const answersByQuestionId = Object.fromEntries(questions.map((question, index) => [
    getQuestionKey(question),
    index === 1 ? [0, 2] : [index % question.options.length],
  ]))

  const result = buildQuizSubmissionAnswers(questions, answersByQuestionId)

  assert.equal(result.error, undefined)
  assert.equal(result.answers.length, 10)
  assert.deepEqual(result.answers[0], {
    questionId: 'abcdef0123456789abcdef01',
    selectedOptionIndices: [0],
  })
  assert.deepEqual(result.answers[1], {
    questionId: 'abcdef0123456789abcdef02',
    selectedOptionIndices: [0, 2],
  })
  assert.deepEqual(result.answers.map((answer) => answer.questionId), questions.map(getQuestionKey))
})

test('quiz submission reports a genuinely missing answer by question number', () => {
  const questions = [
    { _id: 'abcdef0123456789abcdef01', type: 'multiple-choice', options: ['A', 'B'] },
    { _id: 'abcdef0123456789abcdef02', type: 'true-false', options: ['True', 'False'] },
  ]

  assert.deepEqual(
    buildQuizSubmissionAnswers(questions, { [getQuestionKey(questions[1])]: [1] }),
    { error: 'Please answer Question 1 before submitting.' },
  )
})
