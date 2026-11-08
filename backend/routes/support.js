import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { Router } from 'express'
import mongoose from 'mongoose'
import SupportTicket, { ticketCategories, ticketPriorities, ticketStatuses } from '../models/SupportTicket.js'
import { Admin, CollegeStudent, Student } from '../models/account-models.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()
const maxAttachmentBytes = 5 * 1024 * 1024
const attachmentTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])

router.use(authenticate)

function isValidText(value, minLength, maxLength) {
  return typeof value === 'string' && value.trim().length >= minLength && value.trim().length <= maxLength
}

function adminPermissions(req) {
  const permissions = req.auth.user.permissions
  return Array.isArray(permissions) ? permissions : []
}

function getTicketScope(req) {
  if (req.auth.role === 'student') {
    return {
      userId: new mongoose.Types.ObjectId(req.auth.id),
      userCollection: req.auth.accountCollection,
    }
  }
  if (req.auth.role === 'main_admin') return {}
  if (req.auth.role !== 'college_admin') return null

  const permissions = adminPermissions(req)
  if (permissions.includes('support:college') && mongoose.isValidObjectId(req.auth.user.collegeId)) {
    return { collegeId: new mongoose.Types.ObjectId(req.auth.user.collegeId) }
  }
  return null
}

function ticketJson(ticket, requester) {
  const result = ticket.toObject ? ticket.toObject() : { ...ticket }
  if (result.attachment) {
    delete result.attachment.data
    result.attachment = {
      id: String(result.attachment.id),
      fileName: result.attachment.fileName,
      contentType: result.attachment.contentType,
      size: result.attachment.size,
    }
  }
  if (requester) result.requester = requester
  return result
}

function cleanFileName(fileName) {
  return path.basename(fileName).replace(/[^\w.-]/g, '_').slice(0, 120) || 'attachment'
}

function decodeAttachment(input) {
  if (input === undefined || input === null) return undefined
  if (
    !input ||
    typeof input !== 'object' ||
    typeof input.fileName !== 'string' ||
    typeof input.contentType !== 'string' ||
    typeof input.data !== 'string' ||
    !attachmentTypes.has(input.contentType) ||
    input.data.length > Math.ceil(maxAttachmentBytes / 3) * 4 + 8 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)
  ) {
    const error = new Error('Choose a valid PNG, JPEG, WebP, or PDF attachment up to 5 MB.')
    error.statusCode = 400
    throw error
  }

  const data = Buffer.from(input.data, 'base64')
  if (!data.length || data.length > maxAttachmentBytes) {
    const error = new Error('Attachments must be 5 MB or smaller.')
    error.statusCode = 400
    throw error
  }

  const signatures = {
    'image/png': data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/jpeg': data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
    'image/webp': data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP',
    'application/pdf': data.subarray(0, 5).toString('ascii') === '%PDF-',
  }
  if (!signatures[input.contentType]) {
    const error = new Error('The attachment content does not match its file type.')
    error.statusCode = 400
    throw error
  }

  return {
    id: new mongoose.Types.ObjectId(),
    fileName: cleanFileName(input.fileName),
    contentType: input.contentType,
    size: data.length,
    data,
  }
}

function requireTicketScope(req, res) {
  const scope = getTicketScope(req)
  if (!scope) {
    res.status(403).json({ message: 'You do not have permission to access support tickets.' })
    return null
  }
  return scope
}

function createTicketId() {
  return `LMS-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`
}

function scopedTicketQuery(scope, ticketId) {
  return { ...scope, ticketId }
}

async function findScopedTicket(scope, ticketId, select = '') {
  return SupportTicket.findOne(scopedTicketQuery(scope, ticketId)).select(select)
}

async function includeRequesterDetails(tickets) {
  const [independent, college] = await Promise.all([
    Student.find({ _id: { $in: tickets.filter((ticket) => ticket.userCollection === 'students').map((ticket) => ticket.userId) } })
      .select('fullName email').lean(),
    CollegeStudent.find({ _id: { $in: tickets.filter((ticket) => ticket.userCollection === 'clg_students').map((ticket) => ticket.userId) } })
      .select('fullName email').lean(),
  ])
  const usersByKey = new Map([
    ...independent.map((user) => [`students:${user._id}`, user]),
    ...college.map((user) => [`clg_students:${user._id}`, user]),
  ])
  return tickets.map((ticket) => {
    const requester = usersByKey.get(`${ticket.userCollection}:${ticket.userId}`)
    return ticketJson(ticket, requester ? { fullName: requester.fullName, email: requester.email } : undefined)
  })
}

async function findRequester(ticket) {
  const AccountModel = ticket.userCollection === 'clg_students' ? CollegeStudent : Student
  return AccountModel.findById(ticket.userId).select('fullName email').lean()
}

function validateTicketFilters(query) {
  const filters = {}
  for (const [field, values] of [
    ['status', ticketStatuses],
    ['category', ticketCategories],
    ['priority', ticketPriorities],
  ]) {
    if (query[field] !== undefined) {
      if (typeof query[field] !== 'string' || !values.includes(query[field])) {
        const error = new Error(`Invalid ${field} filter.`)
        error.statusCode = 400
        throw error
      }
      filters[field] = query[field]
    }
  }
  return filters
}

function requireAdmin(req, res) {
  if (!['main_admin', 'college_admin'].includes(req.auth.role)) {
    res.status(403).json({ message: 'Only authorized support administrators can perform this action.' })
    return false
  }
  if (!requireTicketScope(req, res)) return false
  return true
}

router.post('/tickets', async (req, res, next) => {
  try {
    if (req.auth.role !== 'student') {
      return res.status(403).json({ message: 'Only student accounts can submit support tickets.' })
    }
    const { subject, category, priority, description, attachment: attachmentInput } = req.body ?? {}
    if (!isValidText(subject, 3, 160)) {
      return res.status(400).json({ message: 'Enter a subject between 3 and 160 characters.' })
    }
    if (!ticketCategories.includes(category)) {
      return res.status(400).json({ message: 'Choose a valid support category.' })
    }
    if (!ticketPriorities.includes(priority)) {
      return res.status(400).json({ message: 'Choose a valid priority.' })
    }
    if (!isValidText(description, 10, 10000)) {
      return res.status(400).json({ message: 'Enter a description between 10 and 10,000 characters.' })
    }

    const user = req.auth.user
    const ticket = await SupportTicket.create({
      ticketId: createTicketId(),
      userId: new mongoose.Types.ObjectId(req.auth.id),
      userCollection: req.auth.accountCollection,
      accountType: user.studentType === 'college' ? 'college' : 'independent',
      ...(user.studentType === 'college' && mongoose.isValidObjectId(user.collegeId)
        ? { collegeId: new mongoose.Types.ObjectId(user.collegeId) }
        : {}),
      subject: subject.trim(),
      category,
      priority,
      description: description.trim(),
      attachment: decodeAttachment(attachmentInput),
      status: 'Open',
      statusHistory: [{
        to: 'Open',
        changedBy: new mongoose.Types.ObjectId(req.auth.id),
        changedByRole: 'student',
      }],
    })
    return res.status(201).json({ ticket: ticketJson(ticket) })
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ message: error.message })
    if (error?.code === 11000) return res.status(503).json({ message: 'A unique ticket ID could not be allocated. Please try again.' })
    return next(error)
  }
})

router.get('/tickets/mine', async (req, res, next) => {
  try {
    if (req.auth.role !== 'student') {
      return res.status(403).json({ message: 'Student access is required.' })
    }
    const tickets = await SupportTicket.find(getTicketScope(req))
      .select('-attachment.data')
      .sort({ updatedAt: -1 })
      .lean()
    return res.json({ tickets: tickets.map((ticket) => ticketJson(ticket)) })
  } catch (error) {
    return next(error)
  }
})

router.get('/tickets/mine/:ticketId', async (req, res, next) => {
  try {
    if (req.auth.role !== 'student') {
      return res.status(403).json({ message: 'Student access is required.' })
    }
    const ticket = await findScopedTicket(getTicketScope(req), req.params.ticketId, '-attachment.data')
    if (!ticket) return res.status(404).json({ message: 'Support request not found.' })
    return res.json({ ticket: ticketJson(ticket) })
  } catch (error) {
    return next(error)
  }
})

router.post('/tickets/mine/:ticketId/replies', async (req, res, next) => {
  try {
    if (req.auth.role !== 'student') {
      return res.status(403).json({ message: 'Student access is required.' })
    }
    if (!isValidText(req.body?.message, 1, 5000)) {
      return res.status(400).json({ message: 'Enter a reply of no more than 5,000 characters.' })
    }
    const ticket = await findScopedTicket(getTicketScope(req), req.params.ticketId)
    if (!ticket) return res.status(404).json({ message: 'Support request not found.' })
    if (!['Open', 'Waiting for User'].includes(ticket.status)) {
      return res.status(409).json({ message: 'Replies are only available while a ticket is open or waiting for your response.' })
    }
    const previousStatus = ticket.status
    ticket.replies.push({
      authorId: req.auth.id,
      authorRole: 'student',
      message: req.body.message.trim(),
    })
    if (ticket.status === 'Waiting for User') {
      ticket.status = 'In Progress'
      ticket.statusHistory.push({
        from: previousStatus,
        to: 'In Progress',
        changedBy: req.auth.id,
        changedByRole: 'student',
      })
    }
    await ticket.save()
    return res.json({ ticket: ticketJson(ticket) })
  } catch (error) {
    return next(error)
  }
})

router.get('/tickets/mine/:ticketId/attachment', async (req, res, next) => {
  try {
    if (req.auth.role !== 'student') {
      return res.status(403).json({ message: 'Student access is required.' })
    }
    const ticket = await SupportTicket.findOne({
      ...scopedTicketQuery(getTicketScope(req), req.params.ticketId),
      'attachment.id': req.query.id,
    }).select('+attachment.data')
    if (!ticket?.attachment?.data) return res.status(404).json({ message: 'Attachment not found.' })
    res.type(ticket.attachment.contentType)
    res.set('Content-Disposition', `attachment; filename="${ticket.attachment.fileName}"`)
    res.set('X-Content-Type-Options', 'nosniff')
    return res.send(ticket.attachment.data)
  } catch (error) {
    return next(error)
  }
})

router.get('/admin/tickets/handlers', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return
    const scope = getTicketScope(req)
    const query = { permissions: { $in: ['*', 'support:all', 'support:handle'] } }
    if (scope.collegeId) query.collegeId = scope.collegeId
    const handlers = await Admin.find(query).select('fullName email collegeId').lean()
    return res.json({
      handlers: handlers.map(({ _id, fullName, email }) => ({
        id: String(_id),
        fullName: fullName || 'Support administrator',
        email,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/admin/tickets', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return
    const scope = getTicketScope(req)
    const filters = validateTicketFilters(req.query)
    const tickets = await SupportTicket.find({ ...scope, ...filters })
      .select('-attachment.data')
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean()
    return res.json({ tickets: await includeRequesterDetails(tickets) })
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ message: error.message })
    return next(error)
  }
})

router.get('/admin/tickets/:ticketId', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return
    const ticket = await findScopedTicket(getTicketScope(req), req.params.ticketId, '-attachment.data')
    if (!ticket) return res.status(404).json({ message: 'Support request not found.' })
    const requester = await findRequester(ticket)
    return res.json({
      ticket: ticketJson(ticket, requester ? { fullName: requester.fullName, email: requester.email } : undefined),
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/admin/tickets/:ticketId/replies', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return
    if (!isValidText(req.body?.message, 1, 5000)) {
      return res.status(400).json({ message: 'Enter a reply of no more than 5,000 characters.' })
    }
    const ticket = await findScopedTicket(getTicketScope(req), req.params.ticketId)
    if (!ticket) return res.status(404).json({ message: 'Support request not found.' })
    if (['Resolved', 'Closed'].includes(ticket.status)) {
      return res.status(409).json({ message: 'This support request is closed to replies.' })
    }
    const previousStatus = ticket.status
    ticket.replies.push({
      authorId: req.auth.id,
      authorRole: 'admin',
      message: req.body.message.trim(),
    })
    ticket.status = 'Waiting for User'
    ticket.statusHistory.push({
      from: previousStatus,
      to: ticket.status,
      changedBy: req.auth.id,
      changedByRole: 'admin',
    })
    await ticket.save()
    return res.json({ ticket: ticketJson(ticket) })
  } catch (error) {
    return next(error)
  }
})

router.patch('/admin/tickets/:ticketId/status', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return
    const { status } = req.body ?? {}
    if (!ticketStatuses.includes(status)) {
      return res.status(400).json({ message: 'Choose a valid ticket status.' })
    }
    const ticket = await findScopedTicket(getTicketScope(req), req.params.ticketId)
    if (!ticket) return res.status(404).json({ message: 'Support request not found.' })
    if (ticket.status !== status) {
      ticket.statusHistory.push({
        from: ticket.status,
        to: status,
        changedBy: req.auth.id,
        changedByRole: 'admin',
      })
      ticket.status = status
      await ticket.save()
    }
    return res.json({ ticket: ticketJson(ticket) })
  } catch (error) {
    return next(error)
  }
})

router.patch('/admin/tickets/:ticketId/assignment', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return
    const { assignedTo } = req.body ?? {}
    if (assignedTo !== null && (typeof assignedTo !== 'string' || !mongoose.isValidObjectId(assignedTo))) {
      return res.status(400).json({ message: 'Choose a valid support handler.' })
    }
    const ticket = await findScopedTicket(getTicketScope(req), req.params.ticketId)
    if (!ticket) return res.status(404).json({ message: 'Support request not found.' })
    if (assignedTo === null) {
      ticket.assignedTo = undefined
    } else {
      const handler = await Admin.findOne({
        _id: assignedTo,
        permissions: { $in: ['*', 'support:all', 'support:handle'] },
      }).select('_id collegeId').lean()
      if (!handler) return res.status(400).json({ message: 'The selected account is not an authorized support handler.' })
      const scope = getTicketScope(req)
      if (scope.collegeId && String(handler.collegeId) !== String(scope.collegeId)) {
        return res.status(403).json({ message: 'You cannot assign tickets outside your college.' })
      }
      if (scope.collegeId && String(ticket.collegeId) !== String(scope.collegeId)) {
        return res.status(404).json({ message: 'Support request not found.' })
      }
      ticket.assignedTo = handler._id
    }
    await ticket.save()
    return res.json({ ticket: ticketJson(ticket) })
  } catch (error) {
    return next(error)
  }
})

router.get('/admin/tickets/:ticketId/attachment', async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return
    const ticket = await SupportTicket.findOne({
      ...scopedTicketQuery(getTicketScope(req), req.params.ticketId),
      'attachment.id': req.query.id,
    }).select('+attachment.data')
    if (!ticket?.attachment?.data) return res.status(404).json({ message: 'Attachment not found.' })
    res.type(ticket.attachment.contentType)
    res.set('Content-Disposition', `attachment; filename="${ticket.attachment.fileName}"`)
    res.set('X-Content-Type-Options', 'nosniff')
    return res.send(ticket.attachment.data)
  } catch (error) {
    return next(error)
  }
})

export default router
