export function isIndependentStudentAccount(user, accountCollection) {
  return accountCollection
    ? accountCollection === 'students'
    : user?.studentType === 'independent'
}

export function independentApprovalMessage(user, accountCollection) {
  if (!isIndependentStudentAccount(user, accountCollection)) return null

  const approvalStatus = String(user.approvalStatus || '').toLowerCase()
  const status = String(user.status || '').toLowerCase()
  if (approvalStatus === 'rejected' || status === 'rejected') {
    const reason = typeof user.rejectionReason === 'string' ? user.rejectionReason.trim() : ''
    return reason
      ? `Your account application was rejected. Reason: ${reason}`
      : 'Your account application was rejected. Please contact the administrator for more information.'
  }
  if (approvalStatus !== 'approved' || status === 'pending') {
    return 'Your account is awaiting approval from the administrator.'
  }
  return null
}
