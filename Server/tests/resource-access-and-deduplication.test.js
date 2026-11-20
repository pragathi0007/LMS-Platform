import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

// Helper implementations matching client/src/StudentDashboard.jsx
function normalizeResourceName(name) {
  if (!name || typeof name !== 'string') return ''
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonicalStoragePath(url) {
  if (!url || typeof url !== 'string') return ''
  const clean = url.split('?')[0].split('#')[0]
  return clean
    .replace(/\/s--[A-Za-z0-9_-]+--\//, '/')
    .replace(/\/v\d+\//, '/')
}

function isSameResource(a, b) {
  if (!a || !b) return false
  if (a._id && b._id && String(a._id) === String(b._id)) return true
  if (a.publicId && b.publicId && a.publicId === b.publicId) return true
  if (a.url && b.url && a.url.trim() === b.url.trim()) return true
  if (
    (a.fileHash && b.fileHash && a.fileHash === b.fileHash)
    || (a.etag && b.etag && a.etag === b.etag)
  ) {
    return true
  }
  const pathA = canonicalStoragePath(a.url)
  const pathB = canonicalStoragePath(b.url)
  if (pathA && pathB && pathA === pathB) return true

  const bytesA = Number(a.bytes)
  const bytesB = Number(b.bytes)
  if (Number.isFinite(bytesA) && Number.isFinite(bytesB) && bytesA > 0 && bytesA === bytesB) {
    const normA = normalizeResourceName(a.title || a.url)
    const normB = normalizeResourceName(b.title || b.url)
    if (normA && normB && normA === normB) return true
  }
  return false
}

function mergeResources(primary, duplicate) {
  const titleA = primary.title?.trim() || ''
  const titleB = duplicate.title?.trim() || ''
  const isAFilename = titleA.includes('_') || /\.[a-z0-9]{2,5}$/i.test(titleA)
  const isBFilename = titleB.includes('_') || /\.[a-z0-9]{2,5}$/i.test(titleB)

  let preferredTitle = titleA || titleB
  if (isAFilename && !isBFilename && titleB) {
    preferredTitle = titleB
  } else if (!isAFilename && isBFilename && titleA) {
    preferredTitle = titleA
  }

  const primarySources = primary.sourceType ? primary.sourceType.split(' & ') : []
  const duplicateSources = duplicate.sourceType ? duplicate.sourceType.split(' & ') : []
  const combinedSources = Array.from(new Set([...primarySources, ...duplicateSources])).filter(Boolean)
  const combinedSourceType = combinedSources.join(' & ')

  return {
    ...duplicate,
    ...primary,
    title: preferredTitle,
    format: primary.format || duplicate.format || '',
    bytes: primary.bytes || duplicate.bytes || 0,
    sourceType: combinedSourceType || primary.sourceType || duplicate.sourceType,
    alternatePublicIds: Array.from(new Set([...(primary.alternatePublicIds || []), primary.publicId, duplicate.publicId].filter(Boolean))),
    alternateUrls: Array.from(new Set([...(primary.alternateUrls || []), primary.url, duplicate.url].filter(Boolean))),
    alternateIds: Array.from(new Set([...(primary.alternateIds || []), primary._id, duplicate._id].filter(Boolean))),
  }
}

// Backend helper to test
function extractCloudinaryDetails(url) {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return null
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length < 4) return null
    const resourceType = segments[1]
    const deliveryType = segments[2]
    let pathSegments = segments.slice(3)
    if (pathSegments[0]?.startsWith('s--') && pathSegments[0]?.endsWith('--')) {
      pathSegments = pathSegments.slice(1)
    }
    while (pathSegments[0] && (pathSegments[0].includes(',') || pathSegments[0].includes(':') || pathSegments[0].startsWith('w_') || pathSegments[0].startsWith('fl_'))) {
      pathSegments = pathSegments.slice(1)
    }
    if (pathSegments[0] && /^v\d+$/.test(pathSegments[0])) {
      pathSegments = pathSegments.slice(1)
    }
    const publicId = decodeURIComponent(pathSegments.join('/'))
    return { resourceType, deliveryType, publicId }
  } catch {
    return null
  }
}

function findResourceInCourse(course, targetId, publicId = null, url = null) {
  function match(res) {
    if (!res) return false
    const resId = String(res._id || '')
    const resPublicId = String(res.publicId || '')
    const resUrl = String(res.url || '')
    const resTitle = String(res.title || '')
    const target = String(targetId || '').trim()

    if (target && (
      resId === target
      || resPublicId === target
      || resUrl === target
      || path.basename(resPublicId) === target
      || path.basename(resUrl) === target
      || resTitle === target
    )) {
      return true
    }
    if (publicId && (resPublicId === publicId || path.basename(resPublicId) === path.basename(publicId))) {
      return true
    }
    if (url && (resUrl === url || resUrl.split('?')[0] === url.split('?')[0])) {
      return true
    }
    return false
  }

  for (const res of course?.resources || []) {
    if (match(res)) return res
  }
  for (const module of course?.modules || []) {
    for (const res of module?.resources || []) {
      if (match(res)) return res
    }
    for (const lesson of module?.lessons || []) {
      for (const res of lesson?.resources || []) {
        if (match(res)) return res
      }
    }
    for (const item of module?.contentItems || []) {
      for (const res of item?.resources || []) {
        if (match(res)) return res
      }
    }
  }
  return null
}

test('normalizeResourceName normalizes variations of identical documents', () => {
  const variations = [
    'Python Programming Cheat Sheet',
    'Python_Programming_Cheat_Sheet.pdf',
    'Python Programming Cheat Sheet.pdf',
    'python-programming-cheat-sheet.pdf',
    'Python_Programming_Cheat_Sheet',
  ]
  const expected = 'python programming cheat sheet'
  for (const v of variations) {
    assert.equal(normalizeResourceName(v), expected)
  }
})

test('isSameResource detects duplicates by fileHash / etag', () => {
  const itemA = {
    _id: '6afab3216ea9b7d2f5619c92',
    title: 'Python Programming Cheat Sheet',
    etag: '266e8ab3df994a4d69d9748fe2e99a59',
    bytes: 5554,
  }
  const itemB = {
    _id: '6affe2e040a16d0e098286e6',
    title: 'Python_Programming_Cheat_Sheet.pdf',
    etag: '266e8ab3df994a4d69d9748fe2e99a59',
    bytes: 5554,
  }
  assert.equal(isSameResource(itemA, itemB), true)
})

test('isSameResource detects duplicates by identical bytes and normalized title', () => {
  const courseResource = {
    _id: '6afab3216ea9b7d2f5619c92',
    title: 'Python Programming Cheat Sheet',
    publicId: 'aihustle/courses/6af4039d66db9831d2ac821d/resources/fd5495af-8ed8-46f5-9e03-a376dcd3af0b.pdf',
    bytes: 5554,
    format: 'pdf',
    url: 'https://res.cloudinary.com/ikatezsn/raw/upload/s--HSwfUbLt--/v1/aihustle/courses/6af4039d66db9831d2ac821d/resources/fd5495af-8ed8-46f5-9e03-a376dcd3af0b.pdf?_a=BAMAROWQ0',
  }
  const noteResource = {
    _id: '6affe2e040a16d0e098286e6',
    title: 'Python_Programming_Cheat_Sheet.pdf',
    publicId: 'aihustle/courses/6af4039d66db9831d2ac821d/modules/64fe0b140b06f60ada53c924/15520809-92b6-4bb2-8fb0-f344565ae79d.pdf',
    bytes: 5554,
    format: '',
    url: 'https://res.cloudinary.com/ikatezsn/raw/upload/v1795154630/aihustle/courses/6af4039d66db9831d2ac821d/modules/64fe0b140b06f60ada53c924/15520809-92b6-4bb2-8fb0-f344565ae79d.pdf',
  }
  assert.equal(isSameResource(courseResource, noteResource), true)
})

test('isSameResource preserves genuinely different files even if filenames match', () => {
  // Two different files both named "Notes.pdf"
  const chapter1Notes = {
    _id: 'note_1',
    title: 'Notes.pdf',
    bytes: 12450,
    fileHash: 'hash_chapter_1',
    url: 'https://res.cloudinary.com/demo/raw/upload/chapter1/notes.pdf',
  }
  const chapter2Notes = {
    _id: 'note_2',
    title: 'Notes.pdf',
    bytes: 38900,
    fileHash: 'hash_chapter_2',
    url: 'https://res.cloudinary.com/demo/raw/upload/chapter2/notes.pdf',
  }
  assert.equal(isSameResource(chapter1Notes, chapter2Notes), false)
})

test('isSameResource preserves genuinely different files with same size but different names', () => {
  const fileA = {
    _id: 'f1',
    title: 'Syllabus',
    bytes: 5000,
  }
  const fileB = {
    _id: 'f2',
    title: 'Cheat Sheet',
    bytes: 5000,
  }
  assert.equal(isSameResource(fileA, fileB), false)
})

test('mergeResources selects cleaner human-readable title and combines source types', () => {
  const primary = {
    _id: '6afab3216ea9b7d2f5619c92',
    title: 'Python Programming Cheat Sheet',
    publicId: 'aihustle/courses/6af4039d66db9831d2ac821d/resources/fd5495af-8ed8-46f5-9e03-a376dcd3af0b.pdf',
    bytes: 5554,
    format: 'pdf',
    sourceType: 'Course',
  }
  const duplicate = {
    _id: '6affe2e040a16d0e098286e6',
    title: 'Python_Programming_Cheat_Sheet.pdf',
    publicId: 'aihustle/courses/6af4039d66db9831d2ac821d/modules/64fe0b140b06f60ada53c924/15520809-92b6-4bb2-8fb0-f344565ae79d.pdf',
    bytes: 5554,
    format: '',
    sourceType: 'Notes',
  }
  const merged = mergeResources(primary, duplicate)
  assert.equal(merged.title, 'Python Programming Cheat Sheet')
  assert.equal(merged.format, 'pdf')
  assert.equal(merged.bytes, 5554)
  assert.equal(merged.sourceType, 'Course & Notes')
  assert.deepEqual(merged.alternateIds, ['6afab3216ea9b7d2f5619c92', '6affe2e040a16d0e098286e6'])
})

test('extractCloudinaryDetails extracts resourceType and publicId with signed URLs', () => {
  const signedUrl = 'https://res.cloudinary.com/ikatezsn/raw/upload/s--HSwfUbLt--/v1/aihustle/courses/6af4039d66db9831d2ac821d/resources/fd5495af-8ed8-46f5-9e03-a376dcd3af0b.pdf?_a=BAMAROWQ0'
  const details = extractCloudinaryDetails(signedUrl)
  assert.ok(details)
  assert.equal(details.resourceType, 'raw')
  assert.equal(details.publicId, 'aihustle/courses/6af4039d66db9831d2ac821d/resources/fd5495af-8ed8-46f5-9e03-a376dcd3af0b.pdf')

  const versionedUrl = 'https://res.cloudinary.com/ikatezsn/raw/upload/v1795154630/aihustle/courses/6af4039d66db9831d2ac821d/modules/64fe0b140b06f60ada53c924/15520809-92b6-4bb2-8fb0-f344565ae79d.pdf'
  const details2 = extractCloudinaryDetails(versionedUrl)
  assert.ok(details2)
  assert.equal(details2.resourceType, 'raw')
  assert.equal(details2.publicId, 'aihustle/courses/6af4039d66db9831d2ac821d/modules/64fe0b140b06f60ada53c924/15520809-92b6-4bb2-8fb0-f344565ae79d.pdf')
})

test('findResourceInCourse finds resources across course and modules by various identifiers', () => {
  const course = {
    resources: [
      {
        _id: '6afab3216ea9b7d2f5619c92',
        title: 'Python Programming Cheat Sheet',
        publicId: 'aihustle/courses/python/resources/cheat.pdf',
        url: 'https://res.cloudinary.com/ikatezsn/raw/upload/cheat.pdf',
      },
    ],
    modules: [
      {
        _id: 'mod1',
        contentItems: [
          {
            _id: 'item1',
            type: 'note',
            resources: [
              {
                _id: '6affe2e040a16d0e098286e6',
                title: 'Python_Programming_Cheat_Sheet.pdf',
                publicId: 'aihustle/courses/python/modules/mod1/note.pdf',
                url: 'https://res.cloudinary.com/ikatezsn/raw/upload/note.pdf',
              },
            ],
          },
        ],
      },
    ],
  }

  // By _id
  assert.equal(findResourceInCourse(course, '6afab3216ea9b7d2f5619c92')?._id, '6afab3216ea9b7d2f5619c92')
  assert.equal(findResourceInCourse(course, '6affe2e040a16d0e098286e6')?._id, '6affe2e040a16d0e098286e6')

  // By publicId
  assert.equal(findResourceInCourse(course, 'aihustle/courses/python/resources/cheat.pdf')?._id, '6afab3216ea9b7d2f5619c92')

  // By basename
  assert.equal(findResourceInCourse(course, 'note.pdf')?._id, '6affe2e040a16d0e098286e6')

  // Not found returns null
  assert.equal(findResourceInCourse(course, 'non_existent_id'), null)
})

test('GET /courses/:courseId/resources/:resourceId/file endpoint logic', async () => {
  const { default: jwt } = await import('jsonwebtoken')
  const { config } = await import('../config/env.js')
  const { default: learningRouter } = await import('../routes/learning.js')
  const { default: Course } = await import('../models/Course.js')
  const { default: Enrollment } = await import('../models/Enrollment.js')
  const { Student } = await import('../models/account-models.js')

  const jwtSecret = config.jwtSecret || process.env.JWT_SECRET

  function stub(target, name, implementation) {
    const original = target[name]
    target[name] = implementation
    return () => { target[name] = original }
  }

  function queryResult(value) {
    return {
      select() { return this },
      sort() { return this },
      lean() { return Promise.resolve(value) },
      then(onFulfilled, onRejected) {
        return Promise.resolve(value).then(onFulfilled, onRejected)
      },
    }
  }

  function tokenFor(role, subject, collection = 'students') {
    return jwt.sign({ role, accountCollection: collection }, jwtSecret, { subject, expiresIn: '5m' })
  }

  const studentId = '64fe0b140b06f60ada53c924'
  const courseId = '6af4039d66db9831d2ac821d'
  const resourceId = '6afab3216ea9b7d2f5619c92'
  const validToken = tokenFor('student', studentId, 'students')

  const mockStudent = {
    _id: studentId,
    role: 'student',
    isActive: true,
    status: 'active',
    approvalStatus: 'approved',
  }

  const mockCourse = {
    _id: courseId,
    title: 'Python',
    resources: [
      {
        _id: resourceId,
        title: 'Python Programming Cheat Sheet',
        publicId: 'aihustle/courses/6af4039d66db9831d2ac821d/resources/fd5495af-8ed8-46f5-9e03-a376dcd3af0b.pdf',
        bytes: 5554,
        format: 'pdf',
        resourceType: 'raw',
        url: 'https://res.cloudinary.com/ikatezsn/raw/upload/fd5495af.pdf',
      },
    ],
    modules: [],
  }

  const restoreStudent = stub(Student, 'findById', () => queryResult(mockStudent))
  let enrolled = false
  const restoreEnrollment = stub(Enrollment, 'findOne', () => queryResult(enrolled ? { _id: 'enr_1', userId: studentId, courseId } : null))
  const restoreCourse = stub(Course, 'findById', () => queryResult(mockCourse))

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && (url.includes('cloudinary') || url.includes('fd5495af'))) {
      const pdfBytes = Buffer.from('%PDF-1.4 Mock PDF Content %%EOF')
      return new Response(pdfBytes, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(pdfBytes.length),
        },
      })
    }
    return originalFetch(url, opts)
  }

  // Find layer in router stack
  const routeLayer = learningRouter.stack.find((layer) => layer.route && layer.route.path === '/courses/:courseId/resources/:resourceId/file')
  assert.ok(routeLayer, 'Resource file route layer must exist in learningRouter')
  const handlers = routeLayer.route.stack.map((s) => s.handle)

  async function executePipeline({ headers = {}, query = {}, params = {} }) {
    const req = {
      method: 'GET',
      headers: { ...headers },
      get(name) { return this.headers[name.toLowerCase()] },
      query,
      params,
      on() {},
    }
    const resHeaders = {}
    let statusCode = 200
    let resolved = false
    let resolvePromise
    const promise = new Promise((resolve) => { resolvePromise = resolve })

    const res = {
      status(code) { statusCode = code; return this },
      setHeader(k, v) { resHeaders[k.toLowerCase()] = v; return this },
      getHeader(k) { return resHeaders[k.toLowerCase()] },
      json(data) {
        resolved = true
        resolvePromise({ status: statusCode, headers: resHeaders, body: data })
      },
      pipe(dest) {
        return dest
      },
      on() { return this },
      once() { return this },
      emit() { return true },
      write(chunk) {
        if (!res.bodyChunks) res.bodyChunks = []
        res.bodyChunks.push(chunk)
      },
      end(chunk) {
        if (chunk) {
          if (!res.bodyChunks) res.bodyChunks = []
          res.bodyChunks.push(chunk)
        }
        resolved = true
        const text = res.bodyChunks ? Buffer.concat(res.bodyChunks).toString() : ''
        resolvePromise({ status: statusCode, headers: resHeaders, body: text })
      },
    }

    let index = 0
    function next(err) {
      if (err) {
        resolvePromise({ status: statusCode >= 400 ? statusCode : 500, headers: resHeaders, error: err })
        return
      }
      if (index >= handlers.length) {
        resolvePromise({ status: statusCode, headers: resHeaders })
        return
      }
      const handler = handlers[index++]
      try {
        const ret = handler(req, res, next)
        if (ret && typeof ret.pipe === 'function') {
          // Stream piping to mock res
          ret.on('data', (d) => res.write(d))
          ret.on('end', () => res.end())
        } else if (ret && typeof ret.catch === 'function') {
          ret.catch(next)
        }
      } catch (e) {
        next(e)
      }
    }
    next()
    return promise
  }

  try {
    // 1. Unauthenticated request -> 401
    const unauth = await executePipeline({
      params: { courseId, resourceId },
    })
    assert.equal(unauth.status, 401)
    assert.equal(unauth.body?.message, 'A valid access token is required.')

    // 2. Unenrolled student with query token -> 403
    enrolled = false
    const unenrolled = await executePipeline({
      params: { courseId, resourceId },
      query: { token: validToken },
    })
    assert.equal(unenrolled.status, 403)
    assert.equal(unenrolled.body?.message, 'Enroll in this course before accessing its resources.')

    // 3. Enrolled student - View mode (inline disposition)
    enrolled = true
    const view = await executePipeline({
      params: { courseId, resourceId },
      query: { token: validToken },
    })
    assert.equal(view.status, 200)
    assert.equal(view.headers['content-type'], 'application/pdf')
    const viewDisp = view.headers['content-disposition'] || ''
    assert.ok(viewDisp.startsWith('inline'), `Expected inline disposition, got: ${viewDisp}`)
    assert.ok(viewDisp.includes('Python_Programming_Cheat_Sheet.pdf'))
    assert.ok(view.body.includes('%PDF-1.4 Mock PDF Content'))

    // 4. Enrolled student - Download mode (attachment disposition)
    const download = await executePipeline({
      params: { courseId, resourceId },
      query: { token: validToken, download: 'true' },
    })
    assert.equal(download.status, 200)
    assert.equal(download.headers['content-type'], 'application/pdf')
    const downloadDisp = download.headers['content-disposition'] || ''
    assert.ok(downloadDisp.startsWith('attachment'), `Expected attachment disposition, got: ${downloadDisp}`)
    assert.ok(downloadDisp.includes('Python_Programming_Cheat_Sheet.pdf'))
    assert.ok(download.body.includes('%PDF-1.4 Mock PDF Content'))

    // 5. Enrolled student - with Authorization header
    const authHeader = await executePipeline({
      params: { courseId, resourceId },
      headers: { authorization: `Bearer ${validToken}` },
    })
    assert.equal(authHeader.status, 200)
    assert.equal(authHeader.headers['content-type'], 'application/pdf')
  } finally {
    globalThis.fetch = originalFetch
    restoreStudent()
    restoreEnrollment()
    restoreCourse()
  }
})
