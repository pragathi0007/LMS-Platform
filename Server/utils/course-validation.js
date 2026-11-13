const validDifficulties = ['beginner', 'intermediate', 'advanced', 'all-levels']

function validDocumentId(value) {
  if (value === undefined) return true
  const normalized = typeof value === 'string' ? value : value?.toHexString?.()
  return typeof normalized === 'string' && /^[a-f\d]{24}$/i.test(normalized)
}

function normalizedDocumentId(value) {
  return typeof value === 'string' ? value : value?.toHexString?.()
}

function validHttpUrl(value) {
  if (!value) return true
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function normalizeTextList(value, label, maxItems = 30, maxLength = 500) {
  if (value === undefined) return { value: [] }
  if (!Array.isArray(value) || value.length > maxItems || value.some((entry) => (
    typeof entry !== 'string' || entry.trim().length > maxLength
  ))) {
    return { error: `Check ${label}; use up to ${maxItems} entries of ${maxLength} characters each.` }
  }
  return { value: value.map((entry) => entry.trim()).filter(Boolean) }
}

function normalizeModuleQuiz(quiz, moduleIndex) {
  if (quiz === undefined || quiz === null) return { value: undefined }
  if (
    typeof quiz !== 'object' || Array.isArray(quiz) ||
    (quiz._id !== undefined && !validDocumentId(quiz._id)) ||
    (quiz.title !== undefined && (typeof quiz.title !== 'string' || quiz.title.length > 200)) ||
    (quiz.requiredForCertificate !== undefined && typeof quiz.requiredForCertificate !== 'boolean') ||
    (quiz.questions !== undefined && (!Array.isArray(quiz.questions) || quiz.questions.length > 100))
  ) return { error: `Check the quiz settings for module ${moduleIndex + 1}.` }

  const questions = []
  for (const [questionIndex, question] of (quiz.questions || []).entries()) {
    const optionIndices = question?.correctOptionIndices ?? (
      Number.isInteger(question?.correctOptionIndex) ? [question.correctOptionIndex] : []
    )
    if (
      !question || typeof question !== 'object' || Array.isArray(question) ||
      (question._id !== undefined && !validDocumentId(question._id)) ||
      typeof question.prompt !== 'string' || !question.prompt.trim() || question.prompt.trim().length > 2000 ||
      (question.explanation !== undefined && (typeof question.explanation !== 'string' || question.explanation.length > 5000)) ||
      !['multiple-choice', 'multiple-select', 'true-false'].includes(question.type || 'multiple-choice') ||
      !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 10 ||
      question.options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 500) ||
      !Array.isArray(optionIndices) || optionIndices.length < 1 ||
      optionIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= question.options.length) ||
      new Set(optionIndices).size !== optionIndices.length ||
      ((question.type || 'multiple-choice') !== 'multiple-select' && optionIndices.length !== 1) ||
      (question.marks !== undefined && (!Number.isFinite(Number(question.marks)) || Number(question.marks) < 1 || Number(question.marks) > 1000))
    ) return { error: `Check question ${questionIndex + 1} in the quiz for module ${moduleIndex + 1}.` }
    questions.push({
      ...(question._id ? { _id: question._id } : {}),
      prompt: question.prompt.trim(),
      type: question.type || 'multiple-choice',
      options: question.options.map((option) => option.trim()),
      correctOptionIndices: optionIndices,
      explanation: typeof question.explanation === 'string' ? question.explanation.trim() : '',
      marks: question.marks === undefined ? 1 : Number(question.marks),
      order: questionIndex,
    })
  }

  const passingPercentage = quiz.passingPercentage === undefined ? 70 : Number(quiz.passingPercentage)
  const maxAttempts = quiz.maxAttempts === undefined ? 3 : Number(quiz.maxAttempts)
  const timeLimitMinutes = quiz.timeLimitMinutes === undefined ? 0 : Number(quiz.timeLimitMinutes)
  if (!Number.isFinite(passingPercentage) || passingPercentage < 1 || passingPercentage > 100 ||
    !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 ||
    !Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 0 || timeLimitMinutes > 600) {
    return { error: `Check the quiz settings for module ${moduleIndex + 1}.` }
  }
  return {
    value: {
      ...(quiz._id ? { _id: normalizedDocumentId(quiz._id) } : {}),
      title: typeof quiz.title === 'string' ? quiz.title.trim() : '',
      passingPercentage,
      maxAttempts,
      timeLimitMinutes,
      requiredForCertificate: quiz.requiredForCertificate !== false,
      questions,
    },
  }
}

function normalizeAttentionCheck(attentionCheck, lessonIndex, moduleIndex) {
  if (attentionCheck === undefined || attentionCheck === null) return { value: undefined }
  if (
    typeof attentionCheck !== 'object' ||
    Array.isArray(attentionCheck) ||
    (attentionCheck.enabled !== undefined && typeof attentionCheck.enabled !== 'boolean') ||
    (attentionCheck.questions !== undefined &&
      (!Array.isArray(attentionCheck.questions) || attentionCheck.questions.length > 100))
  ) {
    return { error: `Check the attention check settings for lesson ${lessonIndex + 1} in module ${moduleIndex + 1}.` }
  }

  const legacyQuestionSelection = attentionCheck.questionsDuringVideo === undefined
    && (attentionCheck.questions || []).every((question) => question?.selectedForPlayback === undefined)
  const questionsDuringVideo = attentionCheck.questionsDuringVideo === undefined
    ? Math.max(1, (attentionCheck.questions || []).length)
    : Number(attentionCheck.questionsDuringVideo)
  const minIntervalSeconds = attentionCheck.minIntervalSeconds === undefined
    ? 120
    : Number(attentionCheck.minIntervalSeconds)
  const maxIntervalSeconds = attentionCheck.maxIntervalSeconds === undefined
    ? 300
    : Number(attentionCheck.maxIntervalSeconds)
  if (
    !Number.isInteger(questionsDuringVideo) ||
    questionsDuringVideo < 1 ||
    questionsDuringVideo > 100 ||
    !Number.isInteger(minIntervalSeconds) ||
    minIntervalSeconds < 10 ||
    minIntervalSeconds > 7200 ||
    !Number.isInteger(maxIntervalSeconds) ||
    maxIntervalSeconds < minIntervalSeconds ||
    maxIntervalSeconds > 7200
  ) {
    return { error: `Choose valid minimum and maximum attention check intervals for lesson ${lessonIndex + 1} in module ${moduleIndex + 1}.` }
  }

  const questions = []
  for (const [questionIndex, question] of (attentionCheck.questions || []).entries()) {
    const type = question?.type || 'multiple-choice'
    const correctOptionIndices = question?.correctOptionIndices
    if (
      !question ||
      typeof question !== 'object' ||
      Array.isArray(question) ||
      (question._id !== undefined && !validDocumentId(question._id)) ||
      (question.selectedForPlayback !== undefined && typeof question.selectedForPlayback !== 'boolean') ||
      typeof question.prompt !== 'string' ||
      !question.prompt.trim() ||
      question.prompt.trim().length > 2000 ||
      !['multiple-choice', 'multiple-select', 'true-false'].includes(type) ||
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > 10 ||
      question.options.some((option) => (
        typeof option !== 'string' || !option.trim() || option.length > 500
      )) ||
      !Array.isArray(correctOptionIndices) ||
      correctOptionIndices.length < (type === 'multiple-select' ? 2 : 1) ||
      (type !== 'multiple-select' && correctOptionIndices.length !== 1) ||
      correctOptionIndices.some((index) => (
        !Number.isInteger(index) || index < 0 || index >= question.options.length
      )) ||
      new Set(correctOptionIndices).size !== correctOptionIndices.length ||
      (type === 'true-false' &&
        (question.options.length !== 2 || question.options[0] !== 'True' || question.options[1] !== 'False'))
    ) {
      return { error: `Check attention check question ${questionIndex + 1} for lesson ${lessonIndex + 1} in module ${moduleIndex + 1}.` }
    }
    questions.push({
      ...(question._id ? { _id: normalizedDocumentId(question._id) } : {}),
      prompt: question.prompt.trim(),
      type,
      options: question.options.map((option) => option.trim()),
      selectedForPlayback: legacyQuestionSelection && attentionCheck.enabled === true
        ? true
        : question.selectedForPlayback === true,
      correctOptionIndices,
    })
  }

  const enabled = attentionCheck.enabled === true
  if (enabled && questions.length === 0) {
    return { error: `Add at least one attention check question for lesson ${lessonIndex + 1} in module ${moduleIndex + 1}, or disable attention checks.` }
  }
  if (enabled && questions.filter((question) => question.selectedForPlayback).length !== questionsDuringVideo) {
    return { error: `Select exactly ${questionsDuringVideo} attention check question${questionsDuringVideo === 1 ? '' : 's'} for lesson ${lessonIndex + 1} in module ${moduleIndex + 1}.` }
  }
  return {
    value: {
      enabled,
      questionsDuringVideo,
      minIntervalSeconds,
      maxIntervalSeconds,
      questions,
    },
  }
}

export function normalizeCourseDetails(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Enter valid course details.' }
  const {
    title,
    description = '',
    detailedDescription = '',
    category = 'Other',
    difficulty = 'beginner',
    thumbnailUrl = '',
    thumbnailPublicId = '',
    learningObjectives,
    prerequisites,
    estimatedDurationMinutes = 0,
    generateCertificate = true,
    status = 'draft',
    modules = [],
    assignments = [],
    quizzes = [],
  } = input
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) return { error: 'Enter a course title of up to 200 characters.' }
  if (typeof description !== 'string' || description.length > 1000) return { error: 'Short description must be 1,000 characters or fewer.' }
  if (typeof detailedDescription !== 'string' || detailedDescription.length > 10000) return { error: 'Detailed description must be 10,000 characters or fewer.' }
  if (typeof category !== 'string' || !category.trim() || category.trim().length > 80) return { error: 'Choose a course category of up to 80 characters.' }
  if (!validDifficulties.includes(difficulty)) return { error: 'Choose a valid difficulty level.' }
  if (!validHttpUrl(thumbnailUrl) || typeof thumbnailUrl !== 'string' || thumbnailUrl.length > 2048) return { error: 'Enter a valid thumbnail URL.' }
  if (typeof thumbnailPublicId !== 'string' || thumbnailPublicId.length > 255) return { error: 'The course thumbnail reference is invalid.' }
  if (!['draft', 'published'].includes(status)) return { error: 'Choose draft or published for the course status.' }
  if (typeof generateCertificate !== 'boolean') return { error: 'Choose whether course completion certificates are enabled.' }
  if (!Number.isInteger(Number(estimatedDurationMinutes)) || Number(estimatedDurationMinutes) < 0 || Number(estimatedDurationMinutes) > 100000) return { error: 'Enter a valid estimated course duration.' }
  if (!Array.isArray(modules) || modules.length > 100) return { error: 'A course can contain up to 100 modules.' }
  if (!Array.isArray(assignments) || assignments.length > 100) return { error: 'A course can contain up to 100 assignments.' }
  if (!Array.isArray(quizzes) || quizzes.length > 100) return { error: 'A course can contain up to 100 quizzes.' }
  const objectives = normalizeTextList(learningObjectives, 'learning objectives', 30, 500)
  if (objectives.error) return objectives
  const required = normalizeTextList(prerequisites, 'prerequisites', 30, 500)
  if (required.error) return required

  const normalizedModules = []
  for (const [moduleIndex, module] of modules.entries()) {
    if (!module || typeof module !== 'object' || Array.isArray(module) ||
      (module._id !== undefined && !validDocumentId(module._id)) ||
      typeof module.title !== 'string' || !module.title.trim() || module.title.trim().length > 200 ||
      (module.description !== undefined && (typeof module.description !== 'string' || module.description.length > 2000)) ||
      (module.lessons !== undefined && !Array.isArray(module.lessons)) || (module.lessons?.length || 0) > 100 ||
      (module.contentItems !== undefined && (!Array.isArray(module.contentItems) || module.contentItems.length > 100))) {
      return { error: `Check the title, description, and lessons for module ${moduleIndex + 1}.` }
    }
    const lessons = []
    for (const [lessonIndex, lesson] of (module.lessons || []).entries()) {
      if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson) ||
        (lesson._id !== undefined && !validDocumentId(lesson._id)) ||
        (lesson.requiredForCertificate !== undefined && typeof lesson.requiredForCertificate !== 'boolean') ||
        typeof lesson.title !== 'string' || !lesson.title.trim() || lesson.title.trim().length > 200 ||
        (lesson.description !== undefined && (typeof lesson.description !== 'string' || lesson.description.length > 10000)) ||
        (lesson.content !== undefined && (typeof lesson.content !== 'string' || lesson.content.length > 20000)) ||
        (lesson.videoUrl !== undefined && (typeof lesson.videoUrl !== 'string' || lesson.videoUrl.length > 2048 || !validHttpUrl(lesson.videoUrl))) ||
        (lesson.durationSeconds !== undefined && (!Number.isFinite(Number(lesson.durationSeconds)) || Number(lesson.durationSeconds) < 0 || Number(lesson.durationSeconds) > 43200)) ||
        (lesson.videoPublicId !== undefined && (typeof lesson.videoPublicId !== 'string' || lesson.videoPublicId.length > 255)) ||
        (lesson.videoFormat !== undefined && (typeof lesson.videoFormat !== 'string' || lesson.videoFormat.length > 20)) ||
        (lesson.videoBytes !== undefined && (!Number.isSafeInteger(Number(lesson.videoBytes)) || Number(lesson.videoBytes) < 0)) ||
        (lesson.resources !== undefined && (!Array.isArray(lesson.resources) || lesson.resources.length > 30)) ||
        (lesson.resources || []).some((resource) => !resource || typeof resource !== 'object' || Array.isArray(resource) ||
          (resource._id !== undefined && !validDocumentId(resource._id)) ||
          typeof resource.title !== 'string' || !resource.title.trim() || resource.title.trim().length > 200 ||
          typeof resource.url !== 'string' || resource.url.length > 2048 || !validHttpUrl(resource.url) ||
          (resource.publicId !== undefined && (typeof resource.publicId !== 'string' || resource.publicId.length > 255)) ||
          (resource.format !== undefined && (typeof resource.format !== 'string' || resource.format.length > 20)) ||
          (resource.bytes !== undefined && (!Number.isSafeInteger(Number(resource.bytes)) || Number(resource.bytes) < 0)) ||
          !['raw', 'image', 'video'].includes(resource.resourceType || 'raw'))) {
        return { error: `Check lesson ${lessonIndex + 1} in module ${moduleIndex + 1}.` }
      }
      const attentionCheck = normalizeAttentionCheck(lesson.attentionCheck, lessonIndex, moduleIndex)
      if (attentionCheck.error) return attentionCheck
      lessons.push({
        ...(lesson._id ? { _id: normalizedDocumentId(lesson._id) } : {}),
        title: lesson.title.trim(),
        description: lesson.description?.trim() || '',
        content: lesson.content?.trim() || '',
        videoUrl: lesson.videoUrl?.trim() || '',
        videoPublicId: lesson.videoPublicId?.trim() || '',
        videoFormat: lesson.videoFormat?.trim() || '',
        videoBytes: lesson.videoBytes === undefined ? undefined : Number(lesson.videoBytes),
        durationSeconds: lesson.durationSeconds === undefined ? 0 : Number(lesson.durationSeconds),
        requiredForCertificate: lesson.requiredForCertificate !== false,
        ...(attentionCheck.value ? { attentionCheck: attentionCheck.value } : {}),
        resources: (lesson.resources || []).map((resource) => ({
          ...(resource._id ? { _id: normalizedDocumentId(resource._id) } : {}),
          title: resource.title.trim(),
          url: resource.url.trim(),
          publicId: resource.publicId || '',
          resourceType: resource.resourceType || 'raw',
          format: resource.format || '',
          bytes: resource.bytes === undefined ? undefined : Number(resource.bytes),
        })),
        order: lessonIndex,
      })
    }
    const quiz = normalizeModuleQuiz(module.quiz, moduleIndex)
    if (quiz.error) return quiz
    const contentItems = []
    for (const [itemIndex, item] of (module.contentItems || []).entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
        (item._id !== undefined && !validDocumentId(item._id)) ||
        (item.requiredForCertificate !== undefined && typeof item.requiredForCertificate !== 'boolean') ||
        !['video-lesson', 'quiz', 'assignment', 'note'].includes(item.type) ||
        typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 200 ||
        (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 10000)) ||
        (item.content !== undefined && (typeof item.content !== 'string' || item.content.length > 20000)) ||
        (item.videoUrl !== undefined && (typeof item.videoUrl !== 'string' || item.videoUrl.length > 2048 || !validHttpUrl(item.videoUrl))) ||
        (item.videoPublicId !== undefined && (typeof item.videoPublicId !== 'string' || item.videoPublicId.length > 255)) ||
        (item.videoFormat !== undefined && (typeof item.videoFormat !== 'string' || item.videoFormat.length > 20)) ||
        (item.videoBytes !== undefined && (!Number.isSafeInteger(Number(item.videoBytes)) || Number(item.videoBytes) < 0)) ||
        (item.durationSeconds !== undefined && (!Number.isFinite(Number(item.durationSeconds)) || Number(item.durationSeconds) < 0 || Number(item.durationSeconds) > 43200)) ||
        (item.resources !== undefined && (!Array.isArray(item.resources) || item.resources.length > 30)) ||
        (item.resources || []).some((resource) => !resource || typeof resource !== 'object' || Array.isArray(resource) ||
          (resource._id !== undefined && !validDocumentId(resource._id)) ||
          typeof resource.title !== 'string' || !resource.title.trim() || resource.title.trim().length > 200 ||
          typeof resource.url !== 'string' || resource.url.length > 2048 || !validHttpUrl(resource.url) ||
          (resource.publicId !== undefined && (typeof resource.publicId !== 'string' || resource.publicId.length > 255)) ||
          (resource.format !== undefined && (typeof resource.format !== 'string' || resource.format.length > 20)) ||
          (resource.bytes !== undefined && (!Number.isSafeInteger(Number(resource.bytes)) || Number(resource.bytes) < 0)) ||
          !['raw', 'image', 'video'].includes(resource.resourceType || 'raw')) ||
        (item.dueDate !== undefined && item.dueDate !== '' && (typeof item.dueDate !== 'string' || Number.isNaN(Date.parse(item.dueDate)))) ||
        (item.points !== undefined && (!Number.isFinite(Number(item.points)) || Number(item.points) < 0))) {
        return { error: `Check content item ${itemIndex + 1} in module ${moduleIndex + 1}.` }
      }
      const itemQuiz = item.type === 'quiz' ? normalizeModuleQuiz(item.quiz, moduleIndex) : { value: undefined }
      if (itemQuiz.error || (item.type === 'quiz' && !itemQuiz.value)) return itemQuiz.error ? itemQuiz : { error: `Check the quiz for content item ${itemIndex + 1} in module ${moduleIndex + 1}.` }
      const attentionCheck = item.type === 'video-lesson'
        ? normalizeAttentionCheck(item.attentionCheck, itemIndex, moduleIndex)
        : { value: undefined }
      if (attentionCheck.error) return attentionCheck
      contentItems.push({
        ...(item._id ? { _id: normalizedDocumentId(item._id) } : {}),
        type: item.type,
        title: item.title.trim(),
        description: item.description?.trim() || '',
        content: item.content?.trim() || '',
        videoUrl: item.videoUrl?.trim() || '',
        videoPublicId: item.videoPublicId?.trim() || '',
        videoFormat: item.videoFormat?.trim() || '',
        videoBytes: item.videoBytes === undefined ? undefined : Number(item.videoBytes),
        durationSeconds: item.durationSeconds === undefined ? 0 : Number(item.durationSeconds),
        requiredForCertificate: item.requiredForCertificate !== false,
        resources: (item.resources || []).map((resource) => ({
          ...(resource._id ? { _id: normalizedDocumentId(resource._id) } : {}),
          title: resource.title.trim(),
          url: resource.url.trim(),
          publicId: resource.publicId || '',
          resourceType: resource.resourceType || 'raw',
          format: resource.format || '',
          bytes: resource.bytes === undefined ? undefined : Number(resource.bytes),
        })),
        dueDate: item.dueDate || undefined,
        points: item.points === undefined ? 0 : Number(item.points),
        ...(attentionCheck.value ? { attentionCheck: attentionCheck.value } : {}),
        ...(itemQuiz.value ? { quiz: itemQuiz.value } : {}),
        order: itemIndex,
      })
    }
    normalizedModules.push({
      ...(module._id ? { _id: normalizedDocumentId(module._id) } : {}),
      title: module.title.trim(),
      description: module.description?.trim() || '',
      order: moduleIndex,
      lessons,
      ...(quiz.value ? { quiz: quiz.value } : {}),
      ...(module.contentItems !== undefined ? { contentItems } : {}),
    })
  }

  const normalizedAssignments = []
  for (const [index, assignment] of assignments.entries()) {
    if (!assignment || typeof assignment !== 'object' ||
        (assignment._id !== undefined && !validDocumentId(assignment._id)) ||
      (assignment.requiredForCertificate !== undefined && typeof assignment.requiredForCertificate !== 'boolean') ||
      typeof assignment.title !== 'string' || !assignment.title.trim() || assignment.title.trim().length > 200 ||
      (assignment.description !== undefined && (typeof assignment.description !== 'string' || assignment.description.length > 10000)) ||
      (assignment.dueDate !== undefined && assignment.dueDate !== '' && (typeof assignment.dueDate !== 'string' || Number.isNaN(Date.parse(assignment.dueDate)))) ||
      (assignment.points !== undefined && (!Number.isFinite(Number(assignment.points)) || Number(assignment.points) < 0))) {
      return { error: `Check assignment ${index + 1}.` }
    }
    normalizedAssignments.push({ ...(assignment._id ? { _id: normalizedDocumentId(assignment._id) } : {}), title: assignment.title.trim(), description: assignment.description?.trim() || '', dueDate: assignment.dueDate || undefined, points: assignment.points === undefined ? 0 : Number(assignment.points), requiredForCertificate: assignment.requiredForCertificate !== false })
  }

  const normalizedQuizzes = []
  for (const [quizIndex, quiz] of quizzes.entries()) {
    if (!quiz || typeof quiz !== 'object' || typeof quiz.title !== 'string' || !quiz.title.trim() || quiz.title.trim().length > 200 ||
        (quiz._id !== undefined && !validDocumentId(quiz._id)) ||
      (quiz.requiredForCertificate !== undefined && typeof quiz.requiredForCertificate !== 'boolean') ||
      (quiz.description !== undefined && (typeof quiz.description !== 'string' || quiz.description.length > 10000)) ||
      !Array.isArray(quiz.questions) || quiz.questions.length > 100) return { error: `Check quiz ${quizIndex + 1}.` }
    const passingPercentage = quiz.passingPercentage === undefined ? 70 : Number(quiz.passingPercentage)
    const maxAttempts = quiz.maxAttempts === undefined ? 3 : Number(quiz.maxAttempts)
    const timeLimitMinutes = quiz.timeLimitMinutes === undefined ? 0 : Number(quiz.timeLimitMinutes)
    if (!Number.isFinite(passingPercentage) || passingPercentage < 1 || passingPercentage > 100 ||
      !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 ||
      !Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 0 || timeLimitMinutes > 600) {
      return { error: `Check the quiz settings for quiz ${quizIndex + 1}.` }
    }
    const questions = []
    for (const [questionIndex, question] of quiz.questions.entries()) {
      if (!question || typeof question !== 'object' || typeof question.prompt !== 'string' || !question.prompt.trim() || question.prompt.trim().length > 2000 ||
          (question._id !== undefined && !validDocumentId(question._id)) ||
        (question.explanation !== undefined && (typeof question.explanation !== 'string' || question.explanation.length > 5000)) ||
        !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 10 ||
        question.options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 500) ||
        !Number.isInteger(question.correctOptionIndex) || question.correctOptionIndex < 0 || question.correctOptionIndex >= question.options.length) {
        return { error: `Check question ${questionIndex + 1} in quiz ${quizIndex + 1}.` }
      }
      questions.push({ ...(question._id ? { _id: normalizedDocumentId(question._id) } : {}), prompt: question.prompt.trim(), options: question.options.map((option) => option.trim()), correctOptionIndex: question.correctOptionIndex, explanation: typeof question.explanation === 'string' ? question.explanation.trim() : '' })
    }
    normalizedQuizzes.push({ ...(quiz._id ? { _id: normalizedDocumentId(quiz._id) } : {}), title: quiz.title.trim(), description: quiz.description?.trim() || '', passingPercentage, maxAttempts, timeLimitMinutes, requiredForCertificate: quiz.requiredForCertificate !== false, questions })
  }

  return {
    value: {
      title: title.trim(),
      description: description.trim(),
      detailedDescription: detailedDescription.trim(),
      category: category.trim(),
      difficulty,
      thumbnailUrl: thumbnailUrl.trim(),
      thumbnailPublicId: thumbnailPublicId.trim(),
      learningObjectives: objectives.value,
      prerequisites: required.value,
      estimatedDurationMinutes: Number(estimatedDurationMinutes),
      generateCertificate,
      status,
      modules: normalizedModules,
      assignments: normalizedAssignments,
      quizzes: normalizedQuizzes,
    },
  }
}
