import { randomUUID } from 'node:crypto'
import PDFDocument from 'pdfkit'
import AssignmentSubmission from '../models/AssignmentSubmission.js'
import Certificate from '../models/Certificate.js'
import CertificateTemplate from '../models/CertificateTemplate.js'
import QuizAttempt from '../models/QuizAttempt.js'

function documentId(value) {
  const id = value?._id ?? value
  return id === undefined || id === null ? '' : String(id)
}

function requiredActivity(activity, type) {
  const id = documentId(activity)
  const title = typeof activity?.title === 'string' ? activity.title.trim() : ''
  return id && title ? { id, title, type } : null
}

function collectModuleActivities(module) {
  const items = Array.isArray(module?.contentItems) ? module.contentItems : []
  const videos = items.filter((item) => item.type === 'video-lesson')
  const quizzes = items.filter((item) => item.type === 'quiz')
  const assignments = items.filter((item) => item.type === 'assignment')

  const lessonActivities = (videos.length ? videos : module?.lessons || [])
    .filter((item) => item.requiredForCertificate !== false)
    .map((item) => requiredActivity(item, 'video'))
  const quizActivities = (quizzes.length ? quizzes : module?.quiz ? [module.quiz] : [])
    .filter((item) => item.requiredForCertificate !== false && item.quiz?.requiredForCertificate !== false)
    .filter((item) => (item.quiz || item).questions?.length > 0)
    .map((item) => requiredActivity({
      ...(item.quiz || item),
      _id: item.quiz?._id || item._id,
      title: item.title || item.quiz?.title,
    }, 'quiz'))
  const assignmentActivities = assignments
    .filter((item) => item.requiredForCertificate !== false)
    .map((item) => requiredActivity(item, 'assignment'))

  return {
    videos: lessonActivities.filter(Boolean),
    quizzes: quizActivities.filter(Boolean),
    assignments: assignmentActivities.filter(Boolean),
  }
}

export function getRequiredCertificateActivities(course) {
  const collected = { videos: [], quizzes: [], assignments: [] }
  const seen = new Set()
  function add(type, activity) {
    if (!activity) return
    const key = `${type}:${activity.id}`
    if (seen.has(key)) return
    seen.add(key)
    const collection = type === 'quiz' ? 'quizzes' : `${type}s`
    collected[collection].push(activity)
  }

  for (const module of course?.modules || []) {
    const activities = collectModuleActivities(module)
    for (const activity of activities.videos) add('video', activity)
    for (const activity of activities.quizzes) add('quiz', activity)
    for (const activity of activities.assignments) add('assignment', activity)
  }
  for (const quiz of course?.quizzes || []) {
    if (quiz.requiredForCertificate === false || !quiz.questions?.length) continue
    add('quiz', requiredActivity(quiz, 'quiz'))
  }
  for (const assignment of course?.assignments || []) {
    if (assignment.requiredForCertificate === false) continue
    add('assignment', requiredActivity(assignment, 'assignment'))
  }
  return collected
}

export async function evaluateCertificateEligibility({ course, enrollment }) {
  const activities = getRequiredCertificateActivities(course)
  if (course?.generateCertificate === false) {
    return {
      eligible: false,
      activities,
      pendingRequirements: [{
        type: 'certificate',
        title: 'Certificate generation is disabled for this course',
        status: 'disabled',
      }],
    }
  }
  const [passedAttempts, submissions] = await Promise.all([
    activities.quizzes.length
      ? QuizAttempt.find({
        userId: enrollment.userId,
        enrollmentId: enrollment._id,
        courseId: course._id,
        quizId: { $in: activities.quizzes.map((activity) => activity.id) },
        status: 'submitted',
        passed: true,
      }).select('quizId').lean()
      : [],
    activities.assignments.length
      ? AssignmentSubmission.find({
        userId: enrollment.userId,
        enrollmentId: enrollment._id,
        courseId: course._id,
        assignmentId: { $in: activities.assignments.map((activity) => activity.id) },
      }).select('assignmentId reviewStatus submittedAt').sort({ submittedAt: -1, _id: -1 }).lean()
      : [],
  ])
  const completedLessons = new Set((enrollment.completedLessonIds || []).map(String))
  const passedQuizIds = new Set(passedAttempts.map((attempt) => String(attempt.quizId)))
  const latestSubmissionByAssignment = new Map()
  for (const submission of submissions) {
    const id = String(submission.assignmentId)
    if (!latestSubmissionByAssignment.has(id)) latestSubmissionByAssignment.set(id, submission)
  }

  const pendingRequirements = []
  for (const activity of activities.videos) {
    if (!completedLessons.has(activity.id)) pendingRequirements.push({ id: activity.id, type: 'video', title: activity.title, status: 'incomplete' })
  }
  for (const activity of activities.quizzes) {
    if (!passedQuizIds.has(activity.id)) pendingRequirements.push({ id: activity.id, type: 'quiz', title: activity.title, status: 'not-passed' })
  }
  for (const activity of activities.assignments) {
    const submission = latestSubmissionByAssignment.get(activity.id)
    if (submission?.reviewStatus !== 'approved') {
      pendingRequirements.push({
        id: activity.id,
        type: 'assignment',
        title: activity.title,
        status: submission?.reviewStatus === 'rejected' ? 'resubmit' : submission ? 'awaiting-review' : 'not-submitted',
      })
    }
  }

  if (!activities.quizzes.length && !activities.assignments.length) {
    pendingRequirements.push({ type: 'course', title: 'Add a required quiz or assignment before certificates can be issued', status: 'assessment-required' })
  }
  return {
    eligible: pendingRequirements.length === 0,
    activities,
    pendingRequirements,
  }
}

export async function getActiveCertificateTemplateId() {
  const activeTemplate = await CertificateTemplate.findById('default')
    .select('activeTemplateId contentType')
    .lean()
  if (activeTemplate?.activeTemplateId) return activeTemplate.activeTemplateId
  return activeTemplate?.contentType ? 'default' : 'builtin'
}

export async function issueCertificateIfEligible({ userId, studentName, enrollment, course, eligibility: providedEligibility }) {
  if (course?.generateCertificate === false) return null
  const existing = await Certificate.findOne({ userId, courseId: course._id }).lean()
  if (existing) return existing
  const normalizedStudentName = typeof studentName === 'string' ? studentName.trim() : ''
  if (!normalizedStudentName) return null

  const eligibility = providedEligibility || await evaluateCertificateEligibility({ course, enrollment })
  if (!eligibility.eligible) return null

  const completedAt = new Date()
  const year = completedAt.getUTCFullYear()
  const certificateId = `AIH-${year}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`
  const activitySnapshot = [
    ...eligibility.activities.videos.map((activity) => `video:${activity.title}`),
    ...eligibility.activities.quizzes.map((activity) => `quiz:${activity.title}`),
    ...eligibility.activities.assignments.map((activity) => `assignment:${activity.title}`),
  ]
  const templateId = await getActiveCertificateTemplateId()
  const certificateIdentity = {
    userId,
    studentId: userId,
    studentType: enrollment.collegeId ? 'college' : 'independent',
    courseId: course._id,
  }
  try {
    return await Certificate.findOneAndUpdate(
      { userId, courseId: course._id },
      {
        $setOnInsert: {
          ...certificateIdentity,
          ...(enrollment.collegeId ? { collegeId: enrollment.collegeId } : {}),
          courseId: course._id,
          enrollmentId: enrollment._id,
          templateId,
          certificateId,
          studentName: normalizedStudentName,
          courseName: course.title,
          name: `${course.title} Certificate of Completion`,
          issuedAt: completedAt,
          completedAt,
          viewUrl: `/certificates/${certificateId}/view`,
          downloadUrl: `/certificates/${certificateId}/download`,
          requirementSnapshot: activitySnapshot,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean()
  } catch (error) {
    if (error?.code !== 11000) throw error
    const concurrentCertificate = await Certificate.findOne({
      $or: [
        { userId, courseId: course._id },
        { studentType: certificateIdentity.studentType, studentId: userId, courseId: course._id },
      ],
    }).lean()
    if (concurrentCertificate) return concurrentCertificate
    throw error
  }
}

function fitFontSize(document, text, font, initialSize, maxWidth, minSize = 17) {
  let fontSize = initialSize
  while (fontSize > minSize && document.widthOfString(text, { font, size: fontSize }) > maxWidth) {
    fontSize -= 1
  }
  return fontSize
}

export function generateCertificatePdf(certificate, templateImage) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, compress: true })
    const chunks = []
    document.on('data', (chunk) => chunks.push(chunk))
    document.on('error', reject)
    document.on('end', () => resolve(Buffer.concat(chunks)))
    const width = 841.89
    const height = 595.28
    document.info.Title = `Certificate of Completion - ${certificate.courseName}`
    document.info.Author = 'aiHustle'

    if (templateImage?.length) {
      document.image(templateImage, 0, 0, { width, height })
    } else {
      document.rect(0, 0, width, height).fill('#ffffff')
      document.lineWidth(5).strokeColor('#34796e').rect(26, 26, width - 52, height - 52).stroke()
      document.lineWidth(1.4).strokeColor('#8eb6ad').rect(39, 39, width - 78, height - 78).stroke()
      document.fillColor('#34796e').rect(54, 54, 14, 14).fill()
      document.fillColor('#34796e').rect(width - 68, 54, 14, 14).fill()
      document.fillColor('#34796e').rect(54, height - 68, 14, 14).fill()
      document.fillColor('#34796e').rect(width - 68, height - 68, 14, 14).fill()
    }

    document.font('Helvetica-Bold').fontSize(32)
      .text('Certificate of Completion', 70, 132, { width: width - 140, align: 'center' })
    document.fillColor('#536b66').font('Helvetica').fontSize(15)
      .text('This certificate is proudly presented to', 70, 198, { width: width - 140, align: 'center' })

    const nameFontSize = fitFontSize(document, certificate.studentName, 'Helvetica-Bold', 38, width - 150, 16)
    document.fillColor('#174c47').font('Helvetica-Bold').fontSize(nameFontSize)
      .text(certificate.studentName, 70, 232, { width: width - 140, align: 'center', height: 82 })
    document.moveTo(270, 322).lineTo(width - 270, 322).lineWidth(1).strokeColor('#8eb6ad').stroke()
    document.fillColor('#536b66').font('Helvetica').fontSize(15)
      .text('for successfully completing the course', 70, 345, { width: width - 140, align: 'center' })

    const courseFontSize = fitFontSize(document, certificate.courseName, 'Helvetica-Bold', 23, width - 170, 15)
    document.fillColor('#174c47').font('Helvetica-Bold').fontSize(courseFontSize)
      .text(certificate.courseName, 80, 374, { width: width - 160, align: 'center', height: 82 })
    const completionDate = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(certificate.completedAt))
    document.fillColor('#536b66').font('Helvetica').fontSize(12)
      .text(`Completed ${completionDate}`, 70, 466, { width: width - 140, align: 'center' })
    document.fillColor('#6f8f88').fontSize(9)
      .text(`Certificate ID: ${certificate.certificateId}`, 70, 495, { width: width - 140, align: 'center' })
    document.end()
  })
}
