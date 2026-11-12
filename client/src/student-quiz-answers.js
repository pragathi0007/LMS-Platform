export function getQuestionKey(question) {
  const id = question?._id == null ? '' : String(question._id).trim()
  return /^[a-f\d]{24}$/i.test(id) ? id.toLowerCase() : id
}

export function buildQuizSubmissionAnswers(questions, answerMap, { allowUnanswered = false } = {}) {
  const answers = []
  const submittedQuestionIds = new Set()

  for (const [index, question] of questions.entries()) {
    const questionId = getQuestionKey(question)
    const selectedOptionIndices = answerMap[questionId]
    if (!/^[a-f\d]{24}$/.test(questionId)) {
      return { error: `Question ${index + 1} is missing a valid saved question ID and cannot be submitted.` }
    }
    if (submittedQuestionIds.has(questionId)) {
      return { error: `Question ${index + 1} has a duplicate saved question ID and cannot be submitted.` }
    }
    submittedQuestionIds.add(questionId)

    if ((!Array.isArray(selectedOptionIndices) || selectedOptionIndices.length === 0) && !allowUnanswered) {
      return { error: `Please answer Question ${index + 1} before submitting.` }
    }

    const selected = selectedOptionIndices || []
    if (
      !Array.isArray(question.options)
      || (selectedOptionIndices !== undefined && !Array.isArray(selectedOptionIndices))
      || selected.some((optionIndex) => (
        !Number.isInteger(optionIndex)
        || optionIndex < 0
        || optionIndex >= question.options.length
      ))
      || (question.type === 'multiple-select'
        ? new Set(selected).size !== selected.length
        : selected.length > 1)
    ) {
      return { error: `The answer selected for Question ${index + 1} is invalid. Please review it and try again.` }
    }

    answers.push({
      questionId,
      selectedOptionIndices: [...selected].sort((a, b) => a - b),
    })
  }

  return { answers }
}
