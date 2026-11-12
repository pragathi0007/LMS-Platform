import nodemailer from 'nodemailer'
import { config } from '../config/env.js'

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

export function assertResendConfigured() {
  if (
    typeof config.resendApiKey !== 'string' ||
    !config.resendApiKey.trim() ||
    typeof config.emailFrom !== 'string' ||
    !config.emailFrom.trim()
  ) {
    const error = new Error('Email verification is not configured. Set RESEND_API_KEY and EMAIL_FROM in backend/.env.')
    error.code = 'RESEND_NOT_CONFIGURED'
    error.statusCode = 503
    throw error
  }
}

export async function sendStudentTwoFactorCodeEmail({ email, fullName, code }) {
  assertResendConfigured()
  const greetingName = escapeHtml(fullName)
  const escapedCode = escapeHtml(code)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [email],
      subject: 'Your Morrow Learning security code',
      text: [
        `Hello${fullName ? ` ${fullName}` : ''},`,
        '',
        `Your Morrow Learning verification code is ${code}.`,
        'It expires in 5 minutes and can only be used once.',
        '',
        'If you did not request this code, secure your account and contact support.',
      ].join('\n'),
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#26332f"><div style="border:1px solid #e5dfcf;border-radius:12px;padding:28px;background:#fffdf8"><p style="margin:0 0 8px;color:#477b70;font-size:12px;font-weight:700;letter-spacing:1px">MORROW LEARNING</p><h1 style="margin:0 0 18px;font-size:22px">Your security code</h1><p>Hello${greetingName ? ` ${greetingName}` : ''},</p><p>Enter this one-time code to continue:</p><p style="margin:24px 0;padding:16px;border-radius:8px;background:#f6f0dc;text-align:center;color:#26332f;font-size:30px;font-weight:700;letter-spacing:8px">${escapedCode}</p><p>This code expires in <strong>5 minutes</strong> and can only be used once.</p><p style="margin:22px 0 0;color:#68746e;font-size:13px">If you did not request this code, do not share it. Secure your account and contact support.</p></div></div>`,
    }),
  })

  if (!response.ok) {
    const error = new Error('Resend could not deliver the security code.')
    error.code = 'RESEND_SEND_FAILED'
    throw error
  }
}

function createTransporter() {
  const requiredSettings = [
    config.smtpHost,
    config.smtpUser,
    config.smtpPassword,
    config.smtpFrom,
  ]
  if (requiredSettings.some((setting) => typeof setting !== 'string' || !setting.trim())) {
    const error = new Error('SMTP email settings must be configured.')
    error.code = 'SMTP_NOT_CONFIGURED'
    throw error
  }
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.smtpUser, pass: config.smtpPassword },
  })
}

export async function sendCollegeAdminActivationEmail({ email, fullName, token }) {
  if (typeof config.clientOrigin !== 'string' || !config.clientOrigin.trim()) {
    const error = new Error('CLIENT_ORIGIN must be configured.')
    error.code = 'SMTP_NOT_CONFIGURED'
    throw error
  }

  const activationUrl = new URL('/activate', config.clientOrigin)
  activationUrl.searchParams.set('token', token)

  await createTransporter().sendMail({
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

export async function sendStudentEmailChangeVerificationEmail({ email, fullName, code }) {
  await createTransporter().sendMail({
    from: config.smtpFrom,
    to: email,
    subject: 'Verify your new LMS email address',
    text: [
      `Hello${fullName ? ` ${fullName}` : ''},`,
      '',
      `Your LMS email-change verification code is: ${code}`,
      '',
      'This code expires in 15 minutes and can only be used once.',
      'If you did not request this change, you can ignore this email. Your current email address remains active.',
    ].join('\n'),
  })
}
