export function independentApprovalMessage(user) {
  if (user.studentType !== 'independent') return null

  const approvalStatus = String(user.approvalStatus || '').toLowerCase()
  const status = String(user.status || '').toLowerCase()
  if (approvalStatus === 'pending' || status === 'pending') {
    return 'Your account is awaiting approval from the administrator.'
  }
  if (approvalStatus === 'rejected' || status === 'rejected') {
    const reason = typeof user.rejectionReason === 'string' ? user.rejectionReason.trim() : ''
    return reason
      ? `Your account application was rejected. Reason: ${reason}`
      : 'Your account application was rejected. Please contact the administrator for more information.'
  }
  return null
}
