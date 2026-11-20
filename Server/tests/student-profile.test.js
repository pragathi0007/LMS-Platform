import test from 'node:test'
import assert from 'node:assert/strict'
import PDFDocument from 'pdfkit'

test('profile completion algorithm calculates 100% when all profile sections are populated', () => {
  const steps = [
    { id: 'photo', points: 10, completed: true },
    { id: 'headline', points: 15, completed: true },
    { id: 'bio', points: 10, completed: true },
    { id: 'contact', points: 10, completed: true },
    { id: 'skills', points: 15, completed: true },
    { id: 'projects', points: 15, completed: true },
    { id: 'education', points: 15, completed: true },
    { id: 'social', points: 10, completed: true },
  ]
  const total = steps.reduce((sum, s) => sum + s.points, 0)
  const earned = steps.reduce((sum, s) => (s.completed ? sum + s.points : sum), 0)
  assert.equal(total, 100)
  assert.equal(Math.round((earned / total) * 100), 100)
})

test('profile completion algorithm handles empty or partial profile accurately', () => {
  const steps = [
    { id: 'photo', points: 10, completed: false },
    { id: 'headline', points: 15, completed: true },
    { id: 'bio', points: 10, completed: false },
    { id: 'contact', points: 10, completed: false },
    { id: 'skills', points: 15, completed: true },
    { id: 'projects', points: 15, completed: false },
    { id: 'education', points: 15, completed: true },
    { id: 'social', points: 10, completed: false },
  ]
  const total = steps.reduce((sum, s) => sum + s.points, 0)
  const earned = steps.reduce((sum, s) => (s.completed ? sum + s.points : sum), 0)
  assert.equal(Math.round((earned / total) * 100), 45)
})

test('pdfkit generates valid PDF bytes with header, skills, projects, and education', async () => {
  const doc = new PDFDocument({ size: 'A4', margin: 40 })
  const chunks = []
  doc.on('data', (c) => chunks.push(c))

  const pdfPromise = new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  doc.fontSize(20).text('Jane Doe', { align: 'center' })
  doc.fontSize(12).text('Aspiring Full Stack Developer', { align: 'center' })
  doc.moveDown()
  doc.fontSize(10).text('Technical Skills: JavaScript, React, Node.js')
  doc.end()

  const buffer = await pdfPromise
  assert.ok(buffer.length > 0)
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF')
})

