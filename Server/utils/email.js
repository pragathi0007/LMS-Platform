import { config } from '../config/env.js'
import nodemailer from 'nodemailer'

const gmailHost = 'smtp.gmail.com'
const gmailPort = 587
let transporter

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

export function assertEmailConfigured() {
  if (
    config.emailProvider !== 'gmail' ||
    typeof config.gmailUser !== 'string' ||
    !config.gmailUser.trim() ||
    typeof config.gmailAppPassword !== 'string' ||
    !config.gmailAppPassword.trim() ||
    typeof config.emailFrom !== 'string' ||
    !config.emailFrom.trim()
  ) {
    const error = new Error(
      'Email is not configured. Set EMAIL_PROVIDER=gmail, GMAIL_USER, GMAIL_APP_PASSWORD, and EMAIL_FROM in the backend environment.',
    )
    error.code = 'EMAIL_NOT_CONFIGURED'
    error.statusCode = 503
    throw error
  }
}

function getTransporter() {
  assertEmailConfigured()
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: gmailHost,
      port: gmailPort,
      secure: false,
      requireTLS: true,
      auth: {
        user: config.gmailUser,
        pass: config.gmailAppPassword,
      },
    })
  }
  return transporter
}

export async function sendEmail({ to, subject, text, html }) {
  assertEmailConfigured()
  if (typeof to !== 'string' || !to.trim()) {
    const error = new Error('A valid email recipient is required.')
    error.code = 'EMAIL_RECIPIENT_MISSING'
    throw error
  }

  return getTransporter().sendMail({
    from: config.emailFrom,
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
    errorName: error instanceof Error ? error.constructor.name : 'UnknownError',
    errorCode: typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code)
      ? error.code
      : undefined,
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : undefined,
    smtpResponseCode: Number.isInteger(error?.responseCode) ? error.responseCode : undefined,
  }))
}

export function requireClientOrigin() {
  const origin = (typeof config.clientOrigin === 'string' && config.clientOrigin.trim())
    ? config.clientOrigin.trim()
    : 'http://localhost:5173'
  return origin.replace(/\/+$/, '')
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
  await sendEmail({
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
  const greetingName = escapeHtml(fullName)
  const escapedCode = escapeHtml(code)
  const greetingText = typeof fullName === 'string' && fullName.trim()
    ? `Hello ${fullName},`
    : 'Hello,'
  const greetingHtml = greetingName ? `Hello ${greetingName},` : 'Hello,'
  await sendEmail({
    to: email,
    subject: 'Your AIHustle Email Verification Code',
    text: [
      greetingText,
      '',
      'You requested email verification to register for an AIHustle account.',
      '',
      `Your verification code is: ${code}`,
      'This code expires in 10 minutes and can only be used once.',
      '',
      'If you did not request this code, you can ignore this email. Do not share the code with anyone.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Your AIHustle Email Verification Code</title>
  </head>
  <body style="margin:0;background-color:#f4f6f5;color:#26332f;font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f6f5">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #dfe5e2;border-radius:12px">
            <tr>
              <td style="padding:32px">
                <p style="margin:0 0 24px;color:#477b70;font-size:13px;font-weight:700;letter-spacing:1.5px">AIHUSTLE</p>
                <h1 style="margin:0 0 20px;color:#26332f;font-size:24px;line-height:1.3">Verify your email address</h1>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6">${greetingHtml}</p>
                <p style="margin:0 0 20px;font-size:16px;line-height:1.6">You requested email verification to register for an AIHustle account.</p>
                <p style="margin:0 0 8px;color:#596761;font-size:13px;font-weight:700;letter-spacing:1px">YOUR VERIFICATION CODE</p>
                <p style="margin:0 0 20px;padding:18px 12px;border:1px solid #e5dfcf;border-radius:8px;background-color:#f8f6ef;text-align:center">
                  <strong style="color:#26332f;font-size:32px;letter-spacing:8px">${escapedCode}</strong>
                </p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6">This code expires in <strong>10 minutes</strong> and can only be used once.</p>
                <hr style="height:1px;border:0;background-color:#e5e9e7">
                <p style="margin:20px 0 0;color:#596761;font-size:14px;line-height:1.6">If you did not request this code, you can ignore this email. Do not share the code with anyone.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  })
}

export async function sendStudentRegistrationConfirmationEmail({ email, fullName }) {
  if (typeof fullName !== 'string' || !fullName.trim()) {
    fullName = ''
  }
  const { loginUrl, logoUrl } = createBrandedLoginLinks()
  const greetingName = escapeHtml(fullName)
  await sendEmail({
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
  await sendEmail({
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
  await sendEmail({
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
  await sendEmail({
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
  await sendEmail(createIndependentStudentApprovalEmail({ email, fullName }))
}

export async function sendSupportTicketComplaintEmail({ email, fullName, ticket }) {
  await sendEmail({
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

export async function sendEmailSupportMessage({ email, fullName, subject, message }) {
  await sendEmail({
    to: 'aihustle.notification@gmail.com',
    subject: `AIHustle LMS Email Support: ${subject}`,
    text: [
      'A student submitted an Email Support request.',
      '',
      `Student: ${fullName}`,
      `Email: ${email}`,
      `Subject: ${subject}`,
      '',
      'Message:',
      message,
    ].join('\n'),
  })
}

export async function sendEmailSupportReply({ email, fullName, subject, message }) {
  await sendEmail({
    to: email,
    subject: `Re: ${subject}`,
    text: [
      `Hello${fullName ? ` ${fullName}` : ''},`,
      '',
      'The AIHustle LMS support team replied to your Email Support request:',
      '',
      `Subject: ${subject}`,
      '',
      message,
    ].join('\n'),
  })
}

export async function sendPasswordResetEmail({ to, fullName, resetUrl, expiresInMinutes = 15 }) {
  const greetingName = escapeHtml(fullName)
  const greetingText = fullName ? `Hello ${fullName},` : 'Hello,'
  const greetingHtml = greetingName ? `Hello ${greetingName},` : 'Hello,'
  const escapedUrl = escapeHtml(resetUrl)

  return sendEmail({
    to,
    subject: 'Reset your aiHustle LMS password',
    text: [
      greetingText,
      '',
      'We received a request to reset your password for your aiHustle LMS account.',
      '',
      'Reset your password using the link below:',
      resetUrl,
      '',
      `This link will expire in ${expiresInMinutes} minutes and can only be used once.`,
      '',
      'If you did not request a password reset, you can safely ignore this email.',
      'Your password will remain unchanged and your account is secure.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reset your aiHustle password</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f6f5;color:#26332f;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f6f5">
      <tr>
        <td align="center" style="padding:40px 16px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #dfe5e2;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.04)">
            <tr>
              <td style="padding:36px">
                <p style="margin:0 0 20px;color:#477b70;font-size:13px;font-weight:700;letter-spacing:1.5px">AIHUSTLE LMS</p>
                <h1 style="margin:0 0 16px;color:#26332f;font-size:24px;line-height:1.3;font-weight:700">Reset your password</h1>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6">${greetingHtml}</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3b4742">
                  We received a request to reset your password for your aiHustle account. Click the button below to choose a new password:
                </p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px">
                  <tr>
                    <td align="center" style="border-radius:8px;background-color:#477b70">
                      <a href="${escapedUrl}" target="_blank" style="display:inline-block;padding:14px 28px;background-color:#477b70;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:8px;letter-spacing:0.3px">
                        Reset Password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6d7973">
                  Button not working? Copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all">
                  <a href="${escapedUrl}" style="color:#477b70;text-decoration:underline">${escapedUrl}</a>
                </p>
                <div style="background-color:#f8f9f8;border-left:4px solid #477b70;padding:12px 16px;margin:0 0 24px;border-radius:0 6px 6px 0">
                  <p style="margin:0;font-size:13px;line-height:1.5;color:#48544f">
                    This link expires in <strong>${expiresInMinutes} minutes</strong> and can only be used once.
                  </p>
                </div>
                <hr style="height:1px;border:0;background-color:#e5e9e7;margin:28px 0 20px">
                <p style="margin:0;color:#7a8680;font-size:13px;line-height:1.6">
                  If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged and your account is completely secure.
                </p>
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin-top:16px">
            <tr>
              <td align="center" style="color:#8a9690;font-size:12px">
                &copy; 2025 aiHustle LMS. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  })
}
