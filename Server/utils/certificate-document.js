function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapText(value, maxLength) {
  const words = String(value).trim().split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const pieces = word.match(new RegExp(`.{1,${maxLength}}`, 'gu')) || ['']
    for (const piece of pieces) {
      const next = line ? `${line} ${piece}` : piece
      if (next.length > maxLength && line) {
        lines.push(line)
        line = piece
      } else {
        line = next
      }
    }
  }
  if (line) lines.push(line)
  return lines
}

export function createCertificateSvg(certificate) {
  const studentName = escapeXml(certificate.studentName)
  const courseLines = wrapText(certificate.courseName, 48)
    .map((line, index) => `<text x="600" y="${468 + index * 36}" class="course">${escapeXml(line)}</text>`)
    .join('')
  const issuedAt = certificate.issuedAt || certificate.completedAt || certificate.createdAt
  const issueDate = escapeXml(new Intl.DateTimeFormat('en', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(issuedAt)))
  const certificateId = escapeXml(certificate.certificateId)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850" role="img" aria-labelledby="title description">
  <title id="title">Certificate of Completion</title>
  <desc id="description">Certificate awarded to ${studentName} for completing ${escapeXml(certificate.courseName)}.</desc>
  <rect width="1200" height="850" fill="#fbfaf5"/>
  <rect x="28" y="28" width="1144" height="794" rx="8" fill="none" stroke="#34796e" stroke-width="4"/>
  <rect x="44" y="44" width="1112" height="762" rx="4" fill="none" stroke="#d3a83e" stroke-width="1.5"/>
  <text x="600" y="155" class="brand">AIHustle</text>
  <path d="M430 185h340" stroke="#d3a83e" stroke-width="2"/>
  <text x="600" y="260" class="title">Certificate of Completion</text>
  <text x="600" y="325" class="intro">This certificate is proudly presented to</text>
  <text x="600" y="390" class="student">${studentName}</text>
  <text x="600" y="435" class="intro">for successfully completing</text>
  ${courseLines}
  <text x="600" y="675" class="date">Issued ${issueDate}</text>
  <text x="600" y="720" class="id">Certificate ID: ${certificateId}</text>
  <path d="M465 765h270" stroke="#34796e" stroke-width="1.5"/>
  <text x="600" y="795" class="signature">AIHustle Learning</text>
  <style>
    text { text-anchor: middle; font-family: Arial, Helvetica, sans-serif; fill: #263b38; }
    .brand { font-size: 30px; font-weight: 700; letter-spacing: 3px; fill: #34796e; }
    .title { font-size: 44px; font-weight: 700; }
    .intro { font-size: 20px; fill: #64736f; }
    .student { font-size: 42px; font-weight: 700; fill: #34796e; }
    .course { font-size: 28px; font-weight: 600; }
    .date, .id { font-size: 17px; fill: #64736f; }
    .signature { font-size: 18px; font-weight: 600; }
  </style>
</svg>`
}
