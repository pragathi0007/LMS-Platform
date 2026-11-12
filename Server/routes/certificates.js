import { Router } from 'express'
import Certificate from '../models/Certificate.js'
import Enrollment from '../models/Enrollment.js'
import { authenticate, requireRoles } from '../middleware/auth.js'
import { createCertificateSvg } from '../utils/certificate-document.js'

const router = Router()
const requireCertificateAccess = [authenticate, requireRoles('main_admin', 'student')]
const certificateIdPattern = /^AIH-(?:[A-F0-9]{32}|\d{4}-[A-Z0-9]{12})$/

function getStudentCertificateScope(req) {
  if (req.auth.role !== 'student') return {}
  const studentType = req.auth.accountCollection === 'clg_students' ? 'college' : 'independent'
  return {
    studentId: req.auth.id,
    studentType,
    ...(studentType === 'college'
      ? { collegeId: req.auth.user.collegeId }
      : { collegeId: { $exists: false } }),
  }
}

async function findCertificate(req, certificateId) {
  if (req.auth.role !== 'student') {
    return Certificate.findOne({ certificateId }).lean()
  }

  const certificate = await Certificate.findOne({
    certificateId,
    ...getStudentCertificateScope(req),
  }).lean()
  if (certificate) return certificate

  const legacyCertificate = await Certificate.findOne({
    certificateId,
    userId: req.auth.id,
  }).lean()
  if (!legacyCertificate) return null

  const studentType = req.auth.accountCollection === 'clg_students' ? 'college' : 'independent'
  const enrollment = await Enrollment.findOne({
    _id: legacyCertificate.enrollmentId,
    userId: req.auth.id,
    courseId: legacyCertificate.courseId,
    ...(studentType === 'college'
      ? { collegeId: req.auth.user.collegeId }
      : { $or: [{ collegeId: { $exists: false } }, { collegeId: null }] }),
  }).select('_id').lean()
  return enrollment ? legacyCertificate : null
}

async function sendCertificate(req, res, next, disposition) {
  try {
    const { certificateId } = req.params
    if (!certificateIdPattern.test(certificateId)) {
      return res.status(400).json({ message: 'Select a valid certificate.' })
    }

    const certificate = await findCertificate(req, certificateId)
    if (!certificate) return res.status(404).json({ message: 'The certificate was not found.' })

    const document = Buffer.from(createCertificateSvg(certificate), 'utf8')
    res.set({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Length': String(document.length),
      'Content-Disposition': `${disposition}; filename="${certificate.certificateId}.svg"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    })
    return res.send(document)
  } catch (error) {
    return next(error)
  }
}

router.get('/:certificateId/view', ...requireCertificateAccess, (req, res, next) => (
  sendCertificate(req, res, next, 'inline')
))

router.get('/:certificateId/download', ...requireCertificateAccess, (req, res, next) => (
  sendCertificate(req, res, next, 'attachment')
))

export default router
