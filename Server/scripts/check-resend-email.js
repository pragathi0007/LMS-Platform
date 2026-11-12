import { config } from '../config/env.js'
import { sendResendEmail } from '../utils/email.js'

if (config.nodeEnv === 'production') {
  console.error('Refusing to run the Resend email test in production.')
  process.exitCode = 1
} else {
  try {
    const result = await sendResendEmail({
      to: 'delivered@resend.dev',
      subject: 'AIHustle LMS Resend configuration test',
      text: 'This is a development-only test of the AIHustle LMS Resend configuration.',
      html: '<div style="font-family:Arial,sans-serif;color:#26332f"><strong>AIHustle LMS</strong><p>This is a development-only Resend configuration test.</p></div>',
    })
    console.log(JSON.stringify({
      event: 'resend_test_email.accepted',
      recipient: 'delivered@resend.dev',
      ...(typeof result?.id === 'string' ? { messageId: result.id } : {}),
    }))
  } catch (error) {
    console.error(JSON.stringify({
      event: 'resend_test_email.failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: typeof error?.code === 'string' ? error.code : undefined,
      statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : undefined,
      message: error instanceof Error ? error.message : 'Unknown Resend error',
    }))
    process.exitCode = 1
  }
}
