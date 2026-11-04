import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { authenticateDemo, demoCookie } from './account-fixture.mjs'

test('availability handles weekly hours, breaks, closures, existing bookings and concurrent writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-availability-'))
  const options = convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/worker/index.js',
    compatibilityDate: '2026-10-19', d1Databases: { booking_saas_db: 'availability-integration' } })
  options.resourcePersistencePath = directory
  let runtime = new Miniflare(options)
  const request = (path, method = 'GET', body, cookie = demoCookie) => runtime.dispatchFetch(`http://localhost/api/${path}`, {
    method, headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const date = '2090-01-01'
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  const periods = [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '20:00' }]
  const weekly = Array.from({ length: 7 }, (_, index) => index === weekday ? periods : [])
  const config = { weekly, closures: [] }
  const book = (start_time, bookingDate = date) => request('bookings', 'POST', {
    customer_name: 'Cliente', service_id: 'service', date: bookingDate, start_time,
  })
  try {
    let db = await runtime.getD1Database('booking_saas_db')
    const schema = await readFile('migrations/0001_initial_schema.sql', 'utf8')
    for (const statement of schema.split(';').filter((part) => part.trim())) await db.prepare(statement).run()
    await db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org-demo', 'Demo', 'demo'), ('other', 'Outro', 'outro')").run()
    await authenticateDemo(db)
    await db.prepare("INSERT INTO services (id, organization_id, name, duration_minutes, price_cents) VALUES ('service', 'org-demo', 'Serviço', 30, 1000)").run()
    assert.equal((await request('availability', 'GET', undefined, '')).status, 401)
    const legacy = await (await request('availability')).json()
    assert.equal(legacy.weekly.length, 7)
    assert.deepEqual(legacy.weekly[weekday], [{ start: '09:00', end: '18:00' }])
    for (const invalid of [
      { weekly: [], closures: [] },
      { ...config, weekly: weekly.map(() => [{ start: '14:00', end: '12:00' }]) },
      { ...config, weekly: weekly.map(() => [{ start: '08:00', end: '13:00' }, { start: '12:00', end: '14:00' }]) },
      { ...config, weekly: weekly.map(() => [{ start: '24:00', end: '25:00' }]) },
      { ...config, closures: [{ start_date: '2090-02-30', end_date: '2090-03-01', reason: '' }] },
      { ...config, closures: [{ start_date: '2090-03-02', end_date: '2090-03-01', reason: '' }] },
    ]) assert.equal((await request('availability', 'PUT', invalid)).status, 400)
    assert.equal((await request('availability', 'PUT', { ...config, organization_id: 'other' })).status, 200)
    assert.deepEqual(JSON.parse((await db.prepare("SELECT availability FROM organizations WHERE id = 'other'").first()).availability), legacy)
    for (const time of ['07:59', '11:45', '12:00', '13:59', '19:31', '20:00']) assert.equal((await book(time)).status, 400)
    assert.equal((await book('10:00', '2090-01-02')).status, 400)
    for (const time of ['08:00', '11:30', '14:00', '19:30']) assert.equal((await book(time)).status, 201)
    const blocked = await request('availability', 'PUT', { weekly: Array.from({ length: 7 }, () => []), closures: [] })
    assert.equal(blocked.status, 409)
    assert.equal((await blocked.json()).conflicts.length, 4)
    assert.deepEqual(await (await request('availability')).json(), config)
    const review = await (await request('services/service/duration-preview', 'POST', { duration_minutes: 60 })).json()
    assert.equal(review.has_conflicts, true)
    assert.equal((await request('services/service', 'PATCH', { duration_minutes: 60,
      apply_to_future_bookings: true, bookings_snapshot: review.snapshot })).status, 409)
    const expanded = { weekly: Array.from({ length: 7 }, () => periods),
      closures: [{ start_date: '2090-01-08', end_date: '2090-01-10', reason: 'Férias' }] }
    assert.equal((await request('availability', 'PUT', expanded)).status, 200)
    for (const day of ['2090-01-08', '2090-01-09', '2090-01-10']) assert.equal((await book('10:00', day)).status, 400)
    assert.equal((await book('10:00', '2090-01-07')).status, 201)
    assert.equal((await book('10:00', '2090-01-11')).status, 201)
    assert.equal((await request('availability', 'PUT', { ...expanded,
      closures: [...expanded.closures, { start_date: date, end_date: date, reason: 'Fechado' }] })).status, 409)
    const closing = { ...expanded, closures: [...expanded.closures,
      { start_date: '2090-02-01', end_date: '2090-02-01', reason: 'Encerrado' }] }
    const [scheduleResponse, bookingResponse] = await Promise.all([
      request('availability', 'PUT', closing), book('10:00', '2090-02-01'),
    ])
    assert.ok(!(scheduleResponse.status === 200 && bookingResponse.status === 201))
    assert.ok([200, 409].includes(scheduleResponse.status))
    assert.ok([201, 400, 409].includes(bookingResponse.status))
    // Adjacent periods are continuous availability, not an artificial break.
    const adjacent = { weekly: Array.from({ length: 7 }, () => [
      { start: '08:00', end: '12:00' }, { start: '12:00', end: '20:00' },
    ]), closures: [] }
    const normalized = await request('availability', 'PUT', adjacent)
    assert.equal(normalized.status, 200)
    assert.deepEqual((await normalized.json()).weekly[0], [{ start: '08:00', end: '20:00' }])
    assert.equal((await book('11:45', '2090-03-01')).status, 201)
    await runtime.dispose()
    runtime = new Miniflare(options)
    db = await runtime.getD1Database('booking_saas_db')
    const saved = await (await request('availability')).json()
    assert.deepEqual(saved.weekly[0], [{ start: '08:00', end: '20:00' }])
    assert.deepEqual((await (await request('export')).json()).availability, saved)
    await db.prepare("UPDATE organizations SET trial_ends_at = 0 WHERE id = 'org-demo'").run()
    assert.equal((await request('availability')).status, 200)
    assert.equal((await request('availability', 'PUT', config)).status, 402)
  } finally {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
