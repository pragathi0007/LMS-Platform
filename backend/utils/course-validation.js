export function normalizeCourseDetails(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Enter valid course details.' }
  }
  const {
    title,
    description = '',
    status = 'draft',
    modules = [],
    assignments = [],
    quizzes = [],
  } = input
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) {
    return { error: 'Enter a course title of up to 200 characters.' }
  }
  if (typeof description !== 'string' || description.length > 10000) {
    return { error: 'Course description must be 10,000 characters or fewer.' }
  }
  if (!['draft', 'published'].includes(status)) {
    return { error: 'Choose draft or published for the course status.' }
  }
  if (!Array.isArray(modules) || modules.length > 100) {
    return { error: 'A course can contain up to 100 modules.' }
  }
  if (!Array.isArray(assignments) || assignments.length > 100) {
    return { error: 'A course can contain up to 100 assignments.' }
  }
  if (!Array.isArray(quizzes) || quizzes.length > 100) {
    return { error: 'A course can contain up to 100 quizzes.' }
  }

  const normalizedModules = []
  for (const [moduleIndex, module] of modules.entries()) {
    if (
      !module ||
      typeof module !== 'object' ||
      typeof module.title !== 'string' ||
      !module.title.trim() ||
      module.title.trim().length > 200 ||
      (module.description !== undefined &&
        (typeof module.description !== 'string' || module.description.length > 2000)) ||
      (module.lessons !== undefined && !Array.isArray(module.lessons)) ||
      (module.lessons?.length || 0) > 100
    ) {
      return { error: `Check the title, description, and lessons for module ${moduleIndex + 1}.` }
    }

    const lessons = []
    for (const [lessonIndex, lesson] of (module.lessons || []).entries()) {
      if (
        !lesson ||
        typeof lesson !== 'object' ||
        typeof lesson.title !== 'string' ||
        !lesson.title.trim() ||
        lesson.title.trim().length > 200 ||
        (lesson.content !== undefined &&
          (typeof lesson.content !== 'string' || lesson.content.length > 20000)) ||
        (lesson.videoUrl !== undefined &&
          (typeof lesson.videoUrl !== 'string' || lesson.videoUrl.length > 2048))
      ) {
        return { error: `Check lesson ${lessonIndex + 1} in module ${moduleIndex + 1}.` }
      }
      lessons.push({
        title: lesson.title.trim(),
        content: lesson.content?.trim() || '',
        videoUrl: lesson.videoUrl?.trim() || '',
        order: lessonIndex,
      })
    }
    normalizedModules.push({
      title: module.title.trim(),
      description: module.description?.trim() || '',
      order: moduleIndex,
      lessons,
    })
  }

  const normalizedAssignments = []
  for (const [index, assignment] of assignments.entries()) {
    if (
      !assignment ||
      typeof assignment !== 'object' ||
      typeof assignment.title !== 'string' ||
      !assignment.title.trim() ||
      assignment.title.trim().length > 200 ||
      (assignment.description !== undefined &&
        (typeof assignment.description !== 'string' || assignment.description.length > 10000)) ||
      (assignment.dueDate !== undefined &&
        assignment.dueDate !== '' &&
        (typeof assignment.dueDate !== 'string' || Number.isNaN(Date.parse(assignment.dueDate)))) ||
      (assignment.points !== undefined &&
        (!Number.isFinite(Number(assignment.points)) || Number(assignment.points) < 0))
    ) {
      return { error: `Check assignment ${index + 1}.` }
    }
    normalizedAssignments.push({
      title: assignment.title.trim(),
      description: assignment.description?.trim() || '',
      dueDate: assignment.dueDate || undefined,
      points: assignment.points === undefined ? 0 : Number(assignment.points),
    })
  }

  const normalizedQuizzes = []
  for (const [quizIndex, quiz] of quizzes.entries()) {
    if (
      !quiz ||
      typeof quiz !== 'object' ||
      typeof quiz.title !== 'string' ||
      !quiz.title.trim() ||
      quiz.title.trim().length > 200 ||
      (quiz.description !== undefined &&
        (typeof quiz.description !== 'string' || quiz.description.length > 10000)) ||
      !Array.isArray(quiz.questions) ||
      quiz.questions.length > 100
    ) {
      return { error: `Check quiz ${quizIndex + 1}.` }
    }
    const questions = []
    for (const [questionIndex, question] of quiz.questions.entries()) {
      if (
        !question ||
        typeof question !== 'object' ||
        typeof question.prompt !== 'string' ||
        !question.prompt.trim() ||
        question.prompt.trim().length > 2000 ||
        !Array.isArray(question.options) ||
        question.options.length < 2 ||
        question.options.length > 10 ||
        question.options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 500) ||
        !Number.isInteger(question.correctOptionIndex) ||
        question.correctOptionIndex < 0 ||
        question.correctOptionIndex >= question.options.length
      ) {
        return { error: `Check question ${questionIndex + 1} in quiz ${quizIndex + 1}.` }
      }
      questions.push({
        prompt: question.prompt.trim(),
        options: question.options.map((option) => option.trim()),
        correctOptionIndex: question.correctOptionIndex,
      })
    }
    normalizedQuizzes.push({
      title: quiz.title.trim(),
      description: quiz.description?.trim() || '',
      questions,
    })
  }

  return {
    value: {
      title: title.trim(),
      description: description.trim(),
      status,
      modules: normalizedModules,
      assignments: normalizedAssignments,
      quizzes: normalizedQuizzes,
    },
  }
}
