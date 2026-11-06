const requiredColumns = ['full name', 'student id', 'email', 'department', 'batch']

export function parseStudentCsv(csvText) {
  if (typeof csvText !== 'string' || Buffer.byteLength(csvText, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('Upload a CSV file no larger than 2 MB.')
  }

  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let recordStarted = false

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index]
    if (quoted) {
      if (character === '"') {
        if (csvText[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      recordStarted = true
      continue
    }

    if (character === '"' && field.length === 0) {
      quoted = true
      recordStarted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
      recordStarted = true
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && csvText[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      recordStarted = false
    } else if (character === '"') {
      throw new Error('The CSV contains a quote in an invalid position.')
    } else {
      field += character
      recordStarted = true
    }
  }

  if (quoted) throw new Error('The CSV contains an unterminated quoted field.')
  if (recordStarted || field.length || row.length) {
    row.push(field)
    rows.push(row)
  }

  const nonEmptyRows = rows
    .map((cells, index) => ({ cells, rowNumber: index + 1 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ''))
  if (nonEmptyRows.length < 2) {
    throw new Error('The CSV must include a header and at least one student row.')
  }

  const header = nonEmptyRows[0].cells.map((cell, index) => (
    (index === 0 ? cell.replace(/^\uFEFF/, '') : cell).trim().toLowerCase()
  ))
  if (header.length !== requiredColumns.length ||
    requiredColumns.some((column) => !header.includes(column))) {
    throw new Error('CSV headers must be Full Name, Student ID, Email, Department, Batch.')
  }
  const columnIndex = Object.fromEntries(
    requiredColumns.map((column) => [column, header.indexOf(column)]),
  )

  return nonEmptyRows.slice(1).map(({ cells }, index) => {
    if (cells.length !== header.length) {
      return { rowNumber: index + 2, error: 'Row must contain all five CSV columns.' }
    }
    return {
      rowNumber: index + 2,
      fullName: cells[columnIndex['full name']].trim(),
      studentId: cells[columnIndex['student id']].trim(),
      email: cells[columnIndex.email].trim().toLowerCase(),
      department: cells[columnIndex.department].trim(),
      batch: cells[columnIndex.batch].trim(),
    }
  })
}
