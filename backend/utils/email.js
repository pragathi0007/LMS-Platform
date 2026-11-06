import nodemailer from 'nodemailer'
import { config } from '../config/env.js'

export async function sendCollegeAdminActivationEmail({ email, fullName, token }) {
  const requiredSettings = [
    config.smtpHost,
    config.smtpUser,
    config.smtpPassword,
    config.smtpFrom,
    config.clientOrigin,
  ]
  if (requiredSettings.some((setting) => typeof setting !== 'string' || !setting.trim())) {
    const error = new Error('SMTP email settings and CLIENT_ORIGIN must be configured.')
    error.code = 'SMTP_NOT_CONFIGURED'
    throw error
  }

  const activationUrl = new URL('/activate', config.clientOrigin)
  activationUrl.searchParams.set('token', token)
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.smtpUser, pass: config.smtpPassword },
  })

  await transporter.sendMail({
    from: config.smtpFrom,
    to: email,
    subject: 'Activate your LMS college administrator account',
    text: [
      `Hello${fullName ? ` ${fullName}` : ''},`,
      '',
      'Use the one-time link below to activate your college administrator account and create your password:',
      activationUrl.toString(),
      '',
      'This link expires in 24 hours and can only be used once.',
      'If you were not expecting this email, you can ignore it.',
    ].join('\n'),
  })
}
