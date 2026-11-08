import { unzipSync } from 'fflate'

function escapeCsv(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function parseXml(bytes, fileName) {
  const text = new TextDecoder().decode(bytes)
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (document.querySelector('parsererror')) {
    throw new Error(`The Excel workbook contains invalid ${fileName} data.`)
  }
  return document
}

function columnIndex(reference) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]
  if (!letters) throw new Error('The Excel worksheet contains an invalid cell reference.')
  return [...letters.toUpperCase()].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

function excelToCsv(fileBytes) {
  const files = unzipSync(fileBytes)
  const workbookBytes = files['xl/workbook.xml']
  const relationshipBytes = files['xl/_rels/workbook.xml.rels']
  if (!workbookBytes || !relationshipBytes) {
    throw new Error('The selected file is not a supported Excel workbook.')
  }
  const workbook = parseXml(workbookBytes, 'workbook')
  const relationships = parseXml(relationshipBytes, 'workbook relationship')
  const firstSheet = workbook.getElementsByTagName('sheet')[0]
  const relationshipId = firstSheet?.getAttribute('r:id')
  const relationship = [...relationships.getElementsByTagName('Relationship')]
    .find((item) => item.getAttribute('Id') === relationshipId)
  if (!relationship || relationship.getAttribute('TargetMode') === 'External') {
    throw new Error('The Excel workbook does not contain a readable first worksheet.')
  }
  const target = relationship.getAttribute('Target')
  const sheetPath = new URL(target, 'https://xlsx.local/xl/').pathname.slice(1)
  const worksheetBytes = files[sheetPath]
  if (!worksheetBytes) throw new Error('The first Excel worksheet could not be found.')
  const worksheet = parseXml(worksheetBytes, 'worksheet')
  const sharedStrings = files['xl/sharedStrings.xml']
    ? [...parseXml(files['xl/sharedStrings.xml'], 'shared strings').getElementsByTagName('si')]
      .map((item) => [...item.getElementsByTagName('t')].map((text) => text.textContent || '').join(''))
    : []
  const sheetData = worksheet.getElementsByTagName('sheetData')[0]
  const rows = sheetData ? [...sheetData.getElementsByTagName('row')] : []
  if (!rows.length || rows.length > 501) {
    throw new Error('The Excel file must contain a header and no more than 500 student rows.')
  }
  const csvRows = rows.map((row) => {
    const values = []
    for (const cell of row.getElementsByTagName('c')) {
      const index = columnIndex(cell.getAttribute('r') || '')
      const value = cell.getElementsByTagName('v')[0]?.textContent || ''
      const cellType = cell.getAttribute('t')
      if (cellType === 's') values[index] = sharedStrings[Number(value)] ?? ''
      else if (cellType === 'inlineStr') {
        values[index] = [...cell.getElementsByTagName('t')].map((text) => text.textContent || '').join('')
      } else values[index] = value
    }
    return values.map(escapeCsv).join(',')
  })
  return csvRows.join('\r\n')
}

export async function readStudentFile(file) {
  if (!file || file.size > 2 * 1024 * 1024) {
    throw new Error('Choose a student file no larger than 2 MB.')
  }
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'csv') return file.text()
  if (extension !== 'xlsx') throw new Error('Choose a CSV or XLSX file.')
  return excelToCsv(new Uint8Array(await file.arrayBuffer()))
}
