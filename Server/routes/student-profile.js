import { Router } from 'express'
import multer from 'multer'
import { Readable } from 'node:stream'
import PDFDocument from 'pdfkit'
import cloudinary from '../config/cloudinary.js'
import { authenticate, requireRoles } from '../middleware/auth.js'
import { accountModelsByCollection } from '../models/account-models.js'
import College from '../models/College.js'
import Certificate from '../models/Certificate.js'
import Enrollment from '../models/Enrollment.js'
import StudentProfile from '../models/StudentProfile.js'

const router = Router()
const requireStudent = [authenticate, requireRoles('student')]

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Only image files (PNG, JPG, WEBP, GIF) are allowed.'))
    }
  },
})

function getStudentAccountModel(req) {
  return accountModelsByCollection[req.auth.accountCollection] || null
}

function calculateCompletion(user, profile) {
  const steps = [
    {
      id: 'photo',
      title: 'Profile Photo',
      points: 10,
      completed: Boolean(user?.avatarUrl && user.avatarUrl.trim()),
      suggestion: 'Upload a professional profile photo to personalize your profile.',
    },
    {
      id: 'headline',
      title: 'Professional Headline',
      points: 15,
      completed: Boolean((profile?.headline || user?.headline || '').trim()),
      suggestion: 'Add a headline (e.g., Aspiring Full Stack Developer) to summarize your career identity.',
    },
    {
      id: 'bio',
      title: 'Professional Bio',
      points: 10,
      completed: Boolean((profile?.bio || user?.bio || '').trim()),
      suggestion: 'Write a short professional bio describing your learning journey and aspirations.',
    },
    {
      id: 'contact',
      title: 'Location & Phone',
      points: 10,
      completed: Boolean((profile?.location || user?.location || '').trim() || (profile?.phone || user?.phone || '').trim()),
      suggestion: 'Provide your location and phone number for recruiter reachability.',
    },
    {
      id: 'skills',
      title: 'Technical Skills (3+)',
      points: 15,
      completed: Array.isArray(profile?.skills) && profile.skills.length >= 3,
      suggestion: 'Add at least 3 technical skills categorized by language, frontend, backend, or tools.',
    },
    {
      id: 'projects',
      title: 'Projects & Portfolio',
      points: 15,
      completed: Array.isArray(profile?.projects) && profile.projects.length >= 1,
      suggestion: 'Showcase at least one project you built, including technologies and links.',
    },
    {
      id: 'education',
      title: 'Education Details',
      points: 15,
      completed: Array.isArray(profile?.education) && profile.education.length >= 1,
      suggestion: 'Add your institution, degree, and field of study.',
    },
    {
      id: 'social',
      title: 'Social & Professional Links',
      points: 10,
      completed: Boolean(
        profile?.socialLinks?.linkedin ||
        profile?.socialLinks?.github ||
        profile?.socialLinks?.portfolio ||
        profile?.socialLinks?.other,
      ),
      suggestion: 'Link your GitHub or LinkedIn profile to connect with employers.',
    },
  ]

  const totalPoints = steps.reduce((sum, step) => sum + step.points, 0)
  const earnedPoints = steps.reduce((sum, step) => (step.completed ? sum + step.points : sum), 0)
  const percentage = Math.round((earnedPoints / totalPoints) * 100)
  const pendingSuggestions = steps.filter((step) => !step.completed).map((step) => step.suggestion)

  return {
    percentage,
    steps,
    suggestions: pendingSuggestions,
  }
}

// GET /api/student/profile
router.get('/', ...requireStudent, async (req, res, next) => {
  try {
    const AccountModel = getStudentAccountModel(req)
    if (!AccountModel) return res.status(403).json({ message: 'Account model could not be found.' })

    const user = await AccountModel.findById(req.auth.id).lean()
    if (!user) return res.status(404).json({ message: 'Student account could not be found.' })

    let collegeName = null
    if (user.collegeId) {
      const college = await College.findById(user.collegeId).select('name').lean()
      collegeName = college?.name || null
    }

    let profile = await StudentProfile.findOne({ userId: req.auth.id })
    if (!profile) {
      profile = new StudentProfile({
        userId: req.auth.id,
        studentType: user.studentType || 'independent',
        headline: user.headline || '',
        bio: user.bio || '',
        location: user.location || '',
        phone: user.phone || '',
        education: user.collegeId && collegeName ? [
          {
            institution: collegeName,
            degree: 'Bachelor Degree',
            fieldOfStudy: user.department || 'Engineering & Technology',
            startYear: '',
            endYear: user.batch || '',
            isCurrent: true,
            academicDetails: '',
          },
        ] : [],
      })
      await profile.save()
    } else if (profile.education.length === 0 && user.collegeId && collegeName) {
      profile.education.push({
        institution: collegeName,
        degree: 'Bachelor Degree',
        fieldOfStudy: user.department || 'Engineering & Technology',
        startYear: '',
        endYear: user.batch || '',
        isCurrent: true,
        academicDetails: '',
      })
      await profile.save()
    }

    // Platform certificates
    const studentType = req.auth.accountCollection === 'clg_students' ? 'college' : 'independent'
    const platformCertificates = await Certificate.find({
      $or: [
        { studentId: req.auth.id, studentType },
        { userId: req.auth.id },
      ],
    })
      .select('certificateId courseName courseId issuedAt completedAt viewUrl downloadUrl')
      .sort({ issuedAt: -1 })
      .lean()

    // Real enrollments
    const enrollments = await Enrollment.find({
      userId: req.auth.id,
      status: { $ne: 'cancelled' },
    })
      .populate('courseId', 'title thumbnailUrl category')
      .sort({ updatedAt: -1 })
      .lean()

    const account = {
      id: String(user._id),
      fullName: user.fullName || '',
      username: user.username || '',
      email: user.email || '',
      emailVerified: user.emailVerified ?? true,
      studentType: user.studentType || 'independent',
      role: 'student',
      collegeId: user.collegeId || null,
      collegeName,
      department: user.department || null,
      batch: user.batch || null,
      phone: user.phone || profile.phone || '',
      avatarUrl: user.avatarUrl || '',
      headline: profile.headline || user.headline || '',
      bio: profile.bio || user.bio || '',
      location: profile.location || user.location || '',
    }

    const completion = calculateCompletion(account, profile)

    return res.json({
      profile,
      account,
      platformCertificates,
      enrollments,
      completion,
    })
  } catch (error) {
    return next(error)
  }
})

// PATCH /api/student/profile
router.patch('/', ...requireStudent, async (req, res, next) => {
  try {
    const AccountModel = getStudentAccountModel(req)
    if (!AccountModel) return res.status(403).json({ message: 'Account model could not be found.' })

    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ message: 'Invalid profile details.' })
    }

    let profile = await StudentProfile.findOne({ userId: req.auth.id })
    if (!profile) {
      profile = new StudentProfile({ userId: req.auth.id })
    }

    const accountUpdates = {}

    if (Object.hasOwn(body, 'headline')) {
      if (typeof body.headline !== 'string' || body.headline.trim().length > 160) {
        return res.status(400).json({ message: 'Headline must be under 160 characters.' })
      }
      profile.headline = body.headline.trim()
      accountUpdates.headline = profile.headline
    }

    if (Object.hasOwn(body, 'bio')) {
      if (typeof body.bio !== 'string' || body.bio.trim().length > 2000) {
        return res.status(400).json({ message: 'Bio must be under 2000 characters.' })
      }
      profile.bio = body.bio.trim()
      accountUpdates.bio = profile.bio
    }

    if (Object.hasOwn(body, 'location')) {
      if (typeof body.location !== 'string' || body.location.trim().length > 120) {
        return res.status(400).json({ message: 'Location must be under 120 characters.' })
      }
      profile.location = body.location.trim()
      accountUpdates.location = profile.location
    }

    if (Object.hasOwn(body, 'phone')) {
      if (typeof body.phone !== 'string' || body.phone.trim().length > 40) {
        return res.status(400).json({ message: 'Phone must be under 40 characters.' })
      }
      profile.phone = body.phone.trim()
      accountUpdates.phone = profile.phone
    }

    if (Object.hasOwn(body, 'fullName') && typeof body.fullName === 'string' && body.fullName.trim().length >= 2) {
      accountUpdates.fullName = body.fullName.trim().slice(0, 120)
    }

    if (Array.isArray(body.skills)) {
      const allowedCategories = new Set([
        'Programming Languages',
        'Frontend Development',
        'Backend Development',
        'Databases',
        'Frameworks & Libraries',
        'Tools & Technologies',
        'Other Technical Skills',
      ])
      const allowedProficiencies = new Set(['Beginner', 'Intermediate', 'Advanced'])

      profile.skills = body.skills
        .filter((skill) => skill && typeof skill.name === 'string' && skill.name.trim())
        .map((skill) => ({
          ...(skill._id ? { _id: skill._id } : {}),
          name: String(skill.name).trim().slice(0, 80),
          category: allowedCategories.has(skill.category) ? skill.category : 'Other Technical Skills',
          proficiency: allowedProficiencies.has(skill.proficiency) ? skill.proficiency : 'Intermediate',
        }))
    }

    if (Array.isArray(body.projects)) {
      profile.projects = body.projects
        .filter((proj) => proj && typeof proj.title === 'string' && proj.title.trim())
        .map((proj) => ({
          ...(proj._id ? { _id: proj._id } : {}),
          title: String(proj.title).trim().slice(0, 120),
          description: String(proj.description || '').trim().slice(0, 2000),
          technologies: Array.isArray(proj.technologies)
            ? proj.technologies.map((t) => String(t).trim()).filter(Boolean).slice(0, 20)
            : typeof proj.technologies === 'string'
              ? proj.technologies.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20)
              : [],
          thumbnailUrl: String(proj.thumbnailUrl || '').trim().slice(0, 1000),
          githubUrl: String(proj.githubUrl || '').trim().slice(0, 1000),
          liveUrl: String(proj.liveUrl || '').trim().slice(0, 1000),
          role: String(proj.role || '').trim().slice(0, 120),
          completionDate: String(proj.completionDate || '').trim().slice(0, 60),
        }))
    }

    if (Array.isArray(body.experience)) {
      profile.experience = body.experience
        .filter((exp) => exp && typeof exp.organization === 'string' && exp.organization.trim())
        .map((exp) => ({
          ...(exp._id ? { _id: exp._id } : {}),
          organization: String(exp.organization).trim().slice(0, 140),
          position: String(exp.position || 'Contributor').trim().slice(0, 120),
          employmentType: String(exp.employmentType || 'Internship').slice(0, 60),
          startDate: String(exp.startDate || '').trim().slice(0, 60),
          endDate: String(exp.endDate || '').trim().slice(0, 60),
          isCurrent: Boolean(exp.isCurrent),
          description: String(exp.description || '').trim().slice(0, 2000),
        }))
    }

    if (Array.isArray(body.education)) {
      profile.education = body.education
        .filter((edu) => edu && typeof edu.institution === 'string' && edu.institution.trim())
        .map((edu) => ({
          ...(edu._id ? { _id: edu._id } : {}),
          institution: String(edu.institution).trim().slice(0, 160),
          degree: String(edu.degree || '').trim().slice(0, 120),
          fieldOfStudy: String(edu.fieldOfStudy || '').trim().slice(0, 120),
          startYear: String(edu.startYear || '').trim().slice(0, 20),
          endYear: String(edu.endYear || '').trim().slice(0, 20),
          isCurrent: Boolean(edu.isCurrent),
          academicDetails: String(edu.academicDetails || '').trim().slice(0, 200),
        }))
    }

    if (Array.isArray(body.externalCertifications)) {
      profile.externalCertifications = body.externalCertifications
        .filter((cert) => cert && typeof cert.name === 'string' && cert.name.trim())
        .map((cert) => ({
          ...(cert._id ? { _id: cert._id } : {}),
          name: String(cert.name).trim().slice(0, 160),
          issuingOrganization: String(cert.issuingOrganization || '').trim().slice(0, 140),
          issueDate: String(cert.issueDate || '').trim().slice(0, 60),
          credentialUrl: String(cert.credentialUrl || '').trim().slice(0, 1000),
        }))
    }

    if (body.careerInterests && typeof body.careerInterests === 'object') {
      profile.careerInterests = {
        desiredRole: String(body.careerInterests.desiredRole || '').trim().slice(0, 120),
        interestedTechnologies: Array.isArray(body.careerInterests.interestedTechnologies)
          ? body.careerInterests.interestedTechnologies.map((t) => String(t).trim()).filter(Boolean).slice(0, 20)
          : typeof body.careerInterests.interestedTechnologies === 'string'
            ? body.careerInterests.interestedTechnologies.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20)
            : [],
        careerGoals: String(body.careerInterests.careerGoals || '').trim().slice(0, 1000),
        preferredIndustry: String(body.careerInterests.preferredIndustry || '').trim().slice(0, 120),
      }
    }

    if (body.socialLinks && typeof body.socialLinks === 'object') {
      profile.socialLinks = {
        linkedin: String(body.socialLinks.linkedin || '').trim().slice(0, 1000),
        github: String(body.socialLinks.github || '').trim().slice(0, 1000),
        portfolio: String(body.socialLinks.portfolio || '').trim().slice(0, 1000),
        other: String(body.socialLinks.other || '').trim().slice(0, 1000),
      }
    }

    await profile.save()

    let updatedUser = null
    if (Object.keys(accountUpdates).length > 0) {
      updatedUser = await AccountModel.findByIdAndUpdate(
        req.auth.id,
        { $set: accountUpdates },
        { new: true },
      ).lean()
    } else {
      updatedUser = await AccountModel.findById(req.auth.id).lean()
    }

    let collegeName = null
    if (updatedUser?.collegeId) {
      const college = await College.findById(updatedUser.collegeId).select('name').lean()
      collegeName = college?.name || null
    }

    const account = {
      id: String(updatedUser._id),
      fullName: updatedUser.fullName || '',
      username: updatedUser.username || '',
      email: updatedUser.email || '',
      emailVerified: updatedUser.emailVerified ?? true,
      studentType: updatedUser.studentType || 'independent',
      role: 'student',
      collegeId: updatedUser.collegeId || null,
      collegeName,
      department: updatedUser.department || null,
      batch: updatedUser.batch || null,
      phone: updatedUser.phone || profile.phone || '',
      avatarUrl: updatedUser.avatarUrl || '',
      headline: profile.headline || updatedUser.headline || '',
      bio: profile.bio || updatedUser.bio || '',
      location: profile.location || updatedUser.location || '',
    }

    const completion = calculateCompletion(account, profile)

    return res.json({
      message: 'Profile updated successfully.',
      profile,
      account,
      completion,
    })
  } catch (error) {
    return next(error)
  }
})

// POST /api/student/profile/avatar
router.post('/avatar', ...requireStudent, uploadAvatar.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file was uploaded.' })
    }

    const AccountModel = getStudentAccountModel(req)
    if (!AccountModel) return res.status(403).json({ message: 'Account model could not be found.' })

    let avatarUrl = ''
    if (cloudinary.isConfigured) {
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'student-avatars',
            resource_type: 'image',
            transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
          },
          (error, result) => {
            if (error) reject(error)
            else resolve(result)
          },
        )
        Readable.from(req.file.buffer).pipe(uploadStream)
      })
      avatarUrl = uploadResult.secure_url || uploadResult.url
    } else {
      const base64 = req.file.buffer.toString('base64')
      avatarUrl = `data:${req.file.mimetype};base64,${base64}`
    }

    const user = await AccountModel.findByIdAndUpdate(
      req.auth.id,
      { $set: { avatarUrl } },
      { new: true },
    )
    if (!user) return res.status(404).json({ message: 'Account could not be found.' })

    return res.json({
      message: 'Profile picture updated successfully.',
      avatarUrl,
    })
  } catch (error) {
    return next(error)
  }
})

// DELETE /api/student/profile/avatar
router.delete('/avatar', ...requireStudent, async (req, res, next) => {
  try {
    const AccountModel = getStudentAccountModel(req)
    if (!AccountModel) return res.status(403).json({ message: 'Account model could not be found.' })

    const user = await AccountModel.findByIdAndUpdate(
      req.auth.id,
      { $set: { avatarUrl: '' } },
      { new: true },
    )
    if (!user) return res.status(404).json({ message: 'Account could not be found.' })

    return res.json({
      message: 'Profile picture removed.',
      avatarUrl: '',
    })
  } catch (error) {
    return next(error)
  }
})

// GET /api/student/profile/resume
router.get('/resume', ...requireStudent, async (req, res, next) => {
  try {
    const AccountModel = getStudentAccountModel(req)
    if (!AccountModel) return res.status(403).json({ message: 'Account model could not be found.' })

    const user = await AccountModel.findById(req.auth.id).lean()
    if (!user) return res.status(404).json({ message: 'Student account could not be found.' })

    const profile = await StudentProfile.findOne({ userId: req.auth.id }).lean() || {}

    let collegeName = null
    if (user.collegeId) {
      const college = await College.findById(user.collegeId).select('name').lean()
      collegeName = college?.name || null
    }

    const studentType = req.auth.accountCollection === 'clg_students' ? 'college' : 'independent'
    const platformCertificates = await Certificate.find({
      $or: [
        { studentId: req.auth.id, studentType },
        { userId: req.auth.id },
      ],
    })
      .select('certificateId courseName issuedAt completedAt')
      .sort({ issuedAt: -1 })
      .lean()

    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: `${user.fullName || 'Student'} - Resume`,
        Author: 'aiHustle LMS Career Portfolio',
      },
    })

    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks)
      const filename = `${(user.fullName || 'Student').replace(/[^a-zA-Z0-9_-]/g, '_')}_Resume.pdf`
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.send(pdfBuffer)
    })

    const primaryColor = '#26332f'
    const accentColor = '#a47d10'
    const textMuted = '#53615c'
    const bodyColor = '#2b302c'
    const lightRule = '#e2ded5'

    // Name & Title
    doc.fillColor(primaryColor).fontSize(22).font('Helvetica-Bold').text(user.fullName || 'Student Name', { align: 'center' })

    const headline = (profile.headline || user.headline || '').trim()
    if (headline) {
      doc.moveDown(0.25)
      doc.fillColor(accentColor).fontSize(12).font('Helvetica-Bold').text(headline, { align: 'center' })
    }

    // Contact info line
    const contacts = [
      user.email,
      profile.phone || user.phone,
      profile.location || user.location,
      collegeName ? `${collegeName}` : '',
      profile.socialLinks?.linkedin ? `LinkedIn: ${profile.socialLinks.linkedin.replace(/^https?:\/\/(www\.)?/, '')}` : '',
      profile.socialLinks?.github ? `GitHub: ${profile.socialLinks.github.replace(/^https?:\/\/(www\.)?/, '')}` : '',
      profile.socialLinks?.portfolio ? `Portfolio: ${profile.socialLinks.portfolio.replace(/^https?:\/\/(www\.)?/, '')}` : '',
    ].filter(Boolean)

    if (contacts.length > 0) {
      doc.moveDown(0.3)
      doc.fillColor(textMuted).fontSize(8.5).font('Helvetica').text(contacts.join('  •  '), { align: 'center' })
    }

    doc.moveDown(0.6)
    doc.strokeColor(accentColor).lineWidth(1.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke()
    doc.moveDown(0.5)

    function renderSectionTitle(title) {
      doc.moveDown(0.6)
      doc.fillColor(primaryColor).fontSize(12).font('Helvetica-Bold').text(title.toUpperCase())
      doc.strokeColor(lightRule).lineWidth(0.8).moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).stroke()
      doc.moveDown(0.3)
    }

    // Professional Summary / Bio
    const bio = (profile.bio || user.bio || '').trim()
    if (bio) {
      renderSectionTitle('Professional Summary')
      doc.fillColor(bodyColor).fontSize(9.5).font('Helvetica').text(bio, { lineGap: 2 })
    }

    // Education
    const education = profile.education || []
    if (education.length > 0) {
      renderSectionTitle('Education')
      for (const edu of education) {
        doc.moveDown(0.2)
        const leftHeading = `${edu.degree || 'Degree'}${edu.fieldOfStudy ? ` in ${edu.fieldOfStudy}` : ''}`
        const yearSpan = [edu.startYear, edu.isCurrent ? 'Present' : edu.endYear].filter(Boolean).join(' – ')
        
        doc.fillColor(bodyColor).fontSize(10).font('Helvetica-Bold').text(leftHeading, { continued: Boolean(yearSpan) })
        if (yearSpan) {
          doc.fillColor(textMuted).fontSize(9).font('Helvetica').text(yearSpan, { align: 'right' })
        }
        
        doc.fillColor(accentColor).fontSize(9).font('Helvetica-Bold').text(edu.institution || '')
        if (edu.academicDetails) {
          doc.fillColor(textMuted).fontSize(8.5).font('Helvetica').text(edu.academicDetails)
        }
      }
    }

    // Technical Skills
    const skills = profile.skills || []
    if (skills.length > 0) {
      renderSectionTitle('Technical Skills')
      const byCategory = {}
      for (const skill of skills) {
        if (!byCategory[skill.category]) byCategory[skill.category] = []
        byCategory[skill.category].push(`${skill.name}${skill.proficiency ? ` (${skill.proficiency})` : ''}`)
      }
      for (const [category, items] of Object.entries(byCategory)) {
        doc.moveDown(0.15)
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text(`${category}: `, { continued: true })
        doc.fillColor(bodyColor).fontSize(9).font('Helvetica').text(items.join(', '))
      }
    }

    // Projects
    const projects = profile.projects || []
    if (projects.length > 0) {
      renderSectionTitle('Projects & Portfolio')
      for (const proj of projects) {
        doc.moveDown(0.25)
        doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(proj.title, { continued: Boolean(proj.completionDate) })
        if (proj.completionDate) {
          doc.fillColor(textMuted).fontSize(8.5).font('Helvetica').text(proj.completionDate, { align: 'right' })
        }
        if (proj.role) {
          doc.fillColor(accentColor).fontSize(8.5).font('Helvetica-Bold').text(`Role: ${proj.role}`)
        }
        if (Array.isArray(proj.technologies) && proj.technologies.length > 0) {
          doc.fillColor(textMuted).fontSize(8.5).font('Helvetica-Oblique').text(`Technologies: ${proj.technologies.join(', ')}`)
        }
        if (proj.description) {
          doc.moveDown(0.1)
          doc.fillColor(bodyColor).fontSize(9).font('Helvetica').text(proj.description, { lineGap: 1.5 })
        }
        const links = [
          proj.githubUrl ? `GitHub: ${proj.githubUrl}` : '',
          proj.liveUrl ? `Live: ${proj.liveUrl}` : '',
        ].filter(Boolean)
        if (links.length > 0) {
          doc.fillColor(accentColor).fontSize(8).font('Helvetica').text(links.join('  |  '))
        }
      }
    }

    // Professional Experience
    const experience = profile.experience || []
    if (experience.length > 0) {
      renderSectionTitle('Experience')
      for (const exp of experience) {
        doc.moveDown(0.25)
        const dateSpan = [exp.startDate, exp.isCurrent ? 'Present' : exp.endDate].filter(Boolean).join(' – ')
        doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(exp.position, { continued: Boolean(dateSpan) })
        if (dateSpan) {
          doc.fillColor(textMuted).fontSize(8.5).font('Helvetica').text(dateSpan, { align: 'right' })
        }
        doc.fillColor(accentColor).fontSize(9).font('Helvetica-Bold').text(`${exp.organization}  •  ${exp.employmentType || 'Role'}`)
        if (exp.description) {
          doc.moveDown(0.1)
          doc.fillColor(bodyColor).fontSize(9).font('Helvetica').text(exp.description, { lineGap: 1.5 })
        }
      }
    }

    // Certifications & Achievements
    const hasPlatformCerts = platformCertificates.length > 0
    const externalCerts = profile.externalCertifications || []
    if (hasPlatformCerts || externalCerts.length > 0) {
      renderSectionTitle('Certifications & Achievements')
      for (const cert of platformCertificates) {
        doc.moveDown(0.2)
        const dateStr = cert.completedAt || cert.issuedAt ? new Date(cert.completedAt || cert.issuedAt).toLocaleDateString() : ''
        doc.fillColor(primaryColor).fontSize(9.5).font('Helvetica-Bold').text(cert.courseName, { continued: Boolean(dateStr) })
        if (dateStr) {
          doc.fillColor(textMuted).fontSize(8.5).font('Helvetica').text(dateStr, { align: 'right' })
        }
        doc.fillColor(accentColor).fontSize(8.5).font('Helvetica').text(`aiHustle LMS Verified Certificate  •  ID: ${cert.certificateId}`)
      }
      for (const ext of externalCerts) {
        doc.moveDown(0.2)
        doc.fillColor(primaryColor).fontSize(9.5).font('Helvetica-Bold').text(ext.name, { continued: Boolean(ext.issueDate) })
        if (ext.issueDate) {
          doc.fillColor(textMuted).fontSize(8.5).font('Helvetica').text(ext.issueDate, { align: 'right' })
        }
        doc.fillColor(textMuted).fontSize(8.5).font('Helvetica').text(`Issued by: ${ext.issuingOrganization}${ext.credentialUrl ? `  •  ${ext.credentialUrl}` : ''}`)
      }
    }

    // Career Interests
    if (profile.careerInterests?.desiredRole || profile.careerInterests?.careerGoals) {
      renderSectionTitle('Career Interests & Goals')
      if (profile.careerInterests.desiredRole) {
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('Desired Role: ', { continued: true })
        doc.fillColor(bodyColor).fontSize(9).font('Helvetica').text(profile.careerInterests.desiredRole)
      }
      if (profile.careerInterests.preferredIndustry) {
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text('Preferred Industry: ', { continued: true })
        doc.fillColor(bodyColor).fontSize(9).font('Helvetica').text(profile.careerInterests.preferredIndustry)
      }
      if (profile.careerInterests.careerGoals) {
        doc.fillColor(bodyColor).fontSize(8.5).font('Helvetica').text(profile.careerInterests.careerGoals)
      }
    }

    doc.end()
  } catch (error) {
    return next(error)
  }
})

export default router

