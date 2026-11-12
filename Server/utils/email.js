import { config } from '../config/env.js'
import nodemailer from 'nodemailer'

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
    const error = new Error('Email is not configured. Set RESEND_API_KEY and EMAIL_FROM in the backend environment.')
    error.code = 'RESEND_NOT_CONFIGURED'
    error.statusCode = 503
    throw error
  }
}

export async function sendResendEmail({ to, subject, text, html }) {
  assertResendConfigured()
  if (typeof to !== 'string' || !to.trim()) {
    const error = new Error('A valid email recipient is required.')
    error.code = 'EMAIL_RECIPIENT_MISSING'
    throw error
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [to.trim().toLowerCase()],
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  })

  if (!response.ok) {
    let responseMessage
    try {
      const body = await response.json()
      responseMessage = typeof body?.message === 'string'
        ? body.message
        : typeof body?.error === 'string'
          ? body.error
          : undefined
    } catch {
      responseMessage = undefined
    }

    const error = new Error(
      responseMessage
        ? `Resend could not deliver the email: ${responseMessage}`
        : `Resend could not deliver the email (HTTP ${response.status}).`,
    )
    error.code = 'RESEND_SEND_FAILED'
    error.statusCode = response.status
    throw error
  }

  try {
    return await response.json()
  } catch {
    return undefined
  }
}

async function sendGmailEmail({ to, subject, text, html }) {
  if (
    typeof config.emailUser !== 'string' ||
    !config.emailUser.trim() ||
    typeof config.emailPass !== 'string' ||
    !config.emailPass.trim()
  ) {
    const error = new Error('Gmail email is not configured. Set EMAIL_USER and EMAIL_PASS in the backend environment.')
    error.code = 'GMAIL_NOT_CONFIGURED'
    error.statusCode = 503
    throw error
  }
  if (typeof to !== 'string' || !to.trim()) {
    const error = new Error('A valid email recipient is required.')
    error.code = 'EMAIL_RECIPIENT_MISSING'
    throw error
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.emailUser, pass: config.emailPass },
  })
  await transporter.sendMail({
    from: config.emailUser,
    to: to.trim().toLowerCase(),
    subject,
    text,
    ...(html ? { html } : {}),
  })
}

export function logEmailDeliveryFailure({ event, accountId, error }) {
  console.error(JSON.stringify({
    event,
    ...(accountId ? { accountId: String(accountId) } : {}),
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown email delivery error',
    errorCode: typeof error?.code === 'string' ? error.code : undefined,
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : undefined,
  }))
}

function requireClientOrigin() {
  if (typeof config.clientOrigin !== 'string' || !config.clientOrigin.trim()) {
    const error = new Error('CLIENT_ORIGIN must be configured.')
    error.code = 'CLIENT_ORIGIN_NOT_CONFIGURED'
    throw error
  }
  return config.clientOrigin
}

function createBrandedLoginLinks() {
  const origin = requireClientOrigin()
  return {
    loginUrl: new URL('/', origin).toString(),
    logoUrl: new URL('/logo.png', origin).toString(),
  }
}

export async function sendStudentTwoFactorCodeEmail({ email, fullName, code }) {
  const greetingName = escapeHtml(fullName)
  const escapedCode = escapeHtml(code)
  await sendResendEmail({
    to: email,
    subject: 'Your AIHustle LMS security code',
    text: [
      `Hello${fullName ? ` ${fullName}` : ''},`,
      '',
      `Your AIHustle LMS verification code is ${code}.`,
      'It expires in 5 minutes and can only be used once.',
      '',
      'Log in to your AIHustle LMS account after verifying this code.',
      'If you did not request this code, secure your account and contact support.',
    ].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#26332f"><div style="border:1px solid #e5dfcf;border-radius:12px;padding:28px;background:#fffdf8"><p style="margin:0 0 8px;color:#477b70;font-size:12px;font-weight:700;letter-spacing:1px">AIHUSTLE LMS</p><h1 style="margin:0 0 18px;font-size:22px">Your security code</h1><p>Hello${greetingName ? ` ${greetingName}` : ''},</p><p>Enter this one-time code to continue:</p><p style="margin:24px 0;padding:16px;border-radius:8px;background:#f6f0dc;text-align:center;color:#26332f;font-size:30px;font-weight:700;letter-spacing:8px">${escapedCode}</p><p>This code expires in <strong>5 minutes</strong> and can only be used once.</p><p>After verifying this code, you can log in to your AIHustle LMS account.</p><p style="margin:22px 0 0;color:#68746e;font-size:13px">If you did not request this code, do not share it. Secure your account and contact support.</p></div></div>`,
  })
}

export async function sendRegistrationEmailVerificationCodeEmail({ email, fullName, code }) {
  const { logoUrl } = createBrandedLoginLinks()
  const greetingName = escapeHtml(fullName)
  const escapedCode = escapeHtml(code)
  await sendResendEmail({
    to: email,
    subject: 'Verify your AIHustle LMS email address',
    text: [
      `Hello${fullName ? ` ${fullName}` : ''},`,
      '',
      `Your AIHustle LMS registration verification code is ${code}.`,
      'It expires in 10 minutes and can only be used once.',
      '',
      'If you did not request this code, you can ignore this email.',
    ].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#26332f"><div style="border:1px solid #e5dfcf;border-radius:12px;padding:28px;background:#fffdf8"><p style="margin:0 0 24px;text-align:center"><img src="${escapeHtml(logoUrl)}" alt="AIHustle" style="display:inline-block;max-width:100%;height:auto;width:260px"></p><p style="margin:0 0 8px;color:#477b70;font-size:12px;font-weight:700;letter-spacing:1px">AIHUSTLE LMS</p><h1 style="margin:0 0 18px;font-size:22px">Verify your email address</h1><p>Hello${greetingName ? ` ${greetingName}` : ''},</p><p>Enter this one-time code to verify the email address for your registration:</p><p style="margin:24px 0;padding:16px;border-radius:8px;background:#f6f0dc;text-align:center;color:#26332f;font-size:30px;font-weight:700;letter-spacing:8px">${escapedCode}</p><p>This code expires in <strong>10 minutes</strong> and can only be used once.</p><p style="margin:22px 0 0;color:#68746e;font-size:13px">If you did not request this code, you can ignore this email.</p></div></div>`,
  })
}

export async function sendStudentRegistrationConfirmationEmail({ email, fullName }) {
  if (typeof fullName !== 'string' || !fullName.trim()) {
    fullName = ''
  }
  const { loginUrl, logoUrl } = createBrandedLoginLinks()
  const greetingName = escapeHtml(fullName)
  await sendGmailEmail({
    to: email,
    subject: 'Your AIHustle LMS registration was received',
    text: [
      `Hello${fullName ? ` ${fullName}` : ''},`,
      '',
      'We received your AIHustle LMS registration.',
      'Your account is awaiting administrator approval. We will notify you when it has been approved.',
      `You can visit the login page here: ${loginUrl}`,
    ].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#26332f"><div style="border:1px solid #e5dfcf;border-radius:12px;padding:28px;background:#fffdf8"><p style="margin:0 0 24px;text-align:center"><img src="${escapeHtml(logoUrl)}" alt="AIHustle" style="display:inline-block;max-width:100%;height:auto;width:360px"></p><p style="margin:0 0 8px;color:#477b70;font-size:12px;font-weight:700;letter-spacing:1px">AIHUSTLE LMS</p><h1 style="margin:0 0 18px;font-size:24px">Registration received</h1><p>Hello${greetingName ? ` ${greetingName}` : ''},</p><p>We received your AIHustle LMS registration. Your account is awaiting administrator approval, and we will notify you when it has been approved.</p><p style="margin:28px 0;text-align:center"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:13px 24px;border-radius:7px;background:#eebd17;color:#26332f;font-weight:700;text-decoration:none">Visit AIHustle LMS</a></p></div></div>`,
  })
}

export async function sendCollegeAdminActivationEmail({ email, fullName, token }) {
  const activationUrl = new URL('/activate', requireClientOrigin())
  activationUrl.searchParams.set('token', token)
  await sendResendEmail({
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
    html: `<p>Hello${fullName ? ` ${escapeHtml(fullName)}` : ''},</p><p>Use this one-time link to activate your LMS college administrator account and create your password:</p><p><a href="${escapeHtml(activationUrl.toString())}">Activate your account</a></p><p>This link expires in 24 hours and can only be used once.</p>`,
  })
}

export async function sendStudentEmailChangeVerificationEmail({ email, fullName, code }) {
  await sendResendEmail({
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
export async function sendIndependentStudentDecisionEmail({ email, fullName, approved, reason }) {
  if (approved) {
    return sendIndependentStudentApprovalEmail({ email, fullName })
  }

  const { loginUrl, logoUrl } = createBrandedLoginLinks()
  const greetingName = escapeHtml(fullName)
  const safeReason = typeof reason === 'string' ? reason.trim() : ''
  const supportContact = config.adminEmail?.trim()
  await sendResendEmail({
    to: email,
    subject: 'Update on your AIHustle LMS account application',
    text: [
      `Hello${fullName ? ` ${fullName}` : ''},`,
      '',
      'Thank you for your interest in AIHustle LMS. After review, your independent student registration was not approved.',
      ...(safeReason ? ['', `Reason: ${safeReason}`] : []),
      '',
      ...(supportContact ? [`For questions, contact support at ${supportContact}.`] : ['Please contact AIHustle support if you have questions.']),
      `You can visit AIHustle LMS at ${loginUrl}.`,
    ].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#26332f"><div style="border:1px solid #e5dfcf;border-radius:12px;padding:28px;background:#fffdf8"><p style="margin:0 0 24px;text-align:center"><img src="${escapeHtml(logoUrl)}" alt="AIHustle" style="display:inline-block;max-width:100%;height:auto;width:300px"></p><p style="margin:0 0 8px;color:#477b70;font-size:12px;font-weight:700;letter-spacing:1px">AIHUSTLE LMS</p><h1 style="margin:0 0 18px;font-size:24px">Update on your registration</h1><p>Hello${greetingName ? ` ${greetingName}` : ''},</p><p>Thank you for your interest in AIHustle LMS. After review, your independent student registration was not approved.</p>${safeReason ? `<p><strong>Reason:</strong> ${escapeHtml(safeReason)}</p>` : ''}<p>${supportContact ? `For questions, contact support at <a href="mailto:${escapeHtml(supportContact)}">${escapeHtml(supportContact)}</a>.` : 'Please contact AIHustle support if you have questions.'}</p><p><a href="${escapeHtml(loginUrl)}">Visit AIHustle LMS</a></p></div></div>`,
  })
}

export function createIndependentStudentApprovalEmail({ email, fullName }) {
  if (typeof email !== 'string' || !email.trim()) {
    const error = new Error('The approved student does not have a registered email address.')
    error.code = 'STUDENT_EMAIL_MISSING'
    throw error
  }
  const { loginUrl, logoUrl } = createBrandedLoginLinks()
  const greetingName = escapeHtml(fullName)
  const greetingText = fullName ? `Hello ${fullName},` : 'Hello,'
  const greetingHtml = greetingName ? `Hello ${greetingName},` : 'Hello,'
  return {
    to: email.trim().toLowerCase(),
    subject: 'Your AIHustle Registration Has Been Approved!',
    text: [
      greetingText,
      '',
      'Your AIHustle LMS registration has been approved.',
      'Welcome to AIHustle! We are excited to have you join our learning community.',
      'You can now log in to your account using the link below:',
      loginUrl,
    ].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;color:#26332f"><div style="border:1px solid #e5dfcf;border-radius:12px;padding:28px;background:#fffdf8"><p style="margin:0 0 24px;text-align:center"><img src="${escapeHtml(logoUrl)}" alt="AIHustle" style="display:inline-block;max-width:100%;height:auto;width:360px"></p><p style="margin:0 0 8px;color:#477b70;font-size:12px;font-weight:700;letter-spacing:1px">AIHUSTLE LMS</p><h1 style="margin:0 0 18px;font-size:24px">Registration approved</h1><p>${greetingHtml}</p><p>Your registration for AIHustle LMS has been approved.</p><p>Welcome to AIHustle! We are excited to have you join our learning community.</p><p>You can now log in and start learning.</p><p style="margin:28px 0;text-align:center"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:13px 24px;border-radius:7px;background:#eebd17;color:#26332f;font-weight:700;text-decoration:none">Log in to AIHustle LMS</a></p><p>If the button does not work, open <a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a>.</p></div></div>`,
  }
}

export async function sendIndependentStudentApprovalEmail({ email, fullName }) {
  await sendResendEmail(createIndependentStudentApprovalEmail({ email, fullName }))
}

export async function sendSupportTicketComplaintEmail({ email, fullName, ticket }) {
  await sendResendEmail({
    to: config.adminEmail,
    subject: `AIHustle LMS support complaint: ${ticket.ticketId}`,
    text: [
      'A student submitted a support request.',
      '',
      `Ticket: ${ticket.ticketId}`,
      `Student: ${fullName || 'Unknown student'} (${email || 'No email provided'})`,
      `Category: ${ticket.category}`,
      `Priority: ${ticket.priority}`,
      `Subject: ${ticket.subject}`,
      '',
      ticket.description,
    ].join('\n'),
  })
}
