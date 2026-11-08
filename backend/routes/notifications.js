import { Router } from 'express'
import Notification from '../models/Notification.js'
import { authenticate, requireRoles } from '../middleware/auth.js'

const router = Router()

router.get('/me', authenticate, requireRoles('main_admin', 'student'), async (req, res, next) => {
  try {
    const filter = { recipientRole: req.auth.role }
    if (req.auth.role === 'student') filter.recipientId = req.auth.id

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
    return res.json({
      notifications: notifications.map((notification) => ({
        id: String(notification._id),
        type: notification.type,
        title: notification.title,
        message: notification.message,
        link: notification.link,
        metadata: notification.metadata,
        createdAt: notification.createdAt,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

export default router
